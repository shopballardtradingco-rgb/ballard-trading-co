import {pathToFileURL} from 'node:url';

export const repository = 'shopballardtradingco-rgb/btco-os';
export const sourceBranch = 'feature/card-bulk-upload';
export const releaseBranch = 'release/btcore-development';
const refPath = branch => `/git/ref/heads/${branch}`;

// Only this trusted push job has write permission. Pull requests only run tests.
export async function promote({env, request, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log, attempts = 40}) {
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== `refs/heads/${sourceBranch}`) {
    throw new Error('Promotion is restricted to the BTCore development push workflow.');
  }
  const sha = env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('A complete candidate commit SHA is required.');
  if (env.CORE_RUNTIME_RESULT !== 'success') throw new Error('BTCore runtime acceptance must pass before promotion.');

  const currentHead = async () => (await request('GET', refPath(sourceBranch))).object.sha;
  const superseded = async () => {
    if (await currentHead() === sha) return false;
    log('A newer development commit exists; skipping this release.');
    return true;
  };
  const query = new URLSearchParams({event: 'push', branch: sourceBranch, head_sha: sha, per_page: '100'});
  let verified = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await superseded()) return 'superseded';
    const {workflow_runs: runs} = await request('GET', `/actions/workflows/ci.yml/runs?${query}`);
    // Never substitute a PR merge SHA, a previous commit, or an earlier successful
    // run for a newer failed/restarted run of the exact candidate.
    const run = runs.filter(r => r.head_sha === sha && r.head_branch === sourceBranch && r.event === 'push')
      .sort((a, b) => b.id - a.id)[0];
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Verify did not pass (${run.conclusion}); release unchanged.`);
      verified = true;
      break;
    }
    if (attempt + 1 < attempts) await sleep(15_000);
  }
  if (!verified) throw new Error('Timed out waiting for Verify on this commit; release unchanged.');
  if (await superseded()) return 'superseded';
  const released = (await request('GET', refPath(releaseBranch))).object.sha;
  if (released === sha) {
    log(`Already released ${sha}.`);
    return 'unchanged';
  }
  const comparison = await request('GET', `/compare/${released}...${sha}`);
  if (comparison.status !== 'ahead') throw new Error('Release update must be a fast-forward; refusing rollback or divergent history.');
  if (await superseded()) return 'superseded';
  // GitHub also enforces fast-forward at mutation time, including concurrent moves.
  const result = await request('PATCH', `/git/refs/heads/${releaseBranch}`, {sha, force: false});
  if (result.object?.sha !== sha) throw new Error('GitHub did not confirm the requested release commit.');
  log(`Promoted ${sha} to ${releaseBranch}; Railway will deploy this branch.`);
  return 'promoted';
}

export function githubClient(token) {
  if (!token) throw new Error('The workflow GitHub token is required.');
  return async (method, path, body) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(25_000),
      headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Do not echo response bodies or request headers into CI logs.
    if (!response.ok) throw new Error(`GitHub ${method} request failed (${response.status}); release not confirmed.`);
    return response.json();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await promote({env: process.env, request: githubClient(process.env.GITHUB_TOKEN)}); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
