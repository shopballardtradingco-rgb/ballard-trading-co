import test from 'node:test';
import assert from 'node:assert/strict';
import {promote, repository, sourceBranch, releaseBranch} from './promote-core.mjs';

const sha = 'a'.repeat(40), previous = 'b'.repeat(40), newer = 'c'.repeat(40);
const env = {GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'push', GITHUB_REF: `refs/heads/${sourceBranch}`, GITHUB_SHA: sha, CORE_RUNTIME_RESULT: 'success'};
const run = (changes = {}) => ({id: 10, event: 'push', head_sha: sha, head_branch: sourceBranch, status: 'completed', conclusion: 'success', ...changes});
function fixture({runs = [[run()]], heads = [sha], released = previous, comparison = 'ahead', patchError} = {}) {
  const writes = [], sleeps = [];
  let headIndex = 0, runIndex = 0;
  const request = async (method, path, body) => {
    if (method === 'PATCH') {
      writes.push({path, body});
      if (patchError) throw patchError;
      return {object: {sha}};
    }
    if (path === `/git/ref/heads/${sourceBranch}`) return {object: {sha: heads[Math.min(headIndex++, heads.length - 1)]}};
    if (path === `/git/ref/heads/${releaseBranch}`) return {object: {sha: released}};
    if (path.startsWith('/actions/workflows/ci.yml/runs?')) {
      const query = new URLSearchParams(path.split('?')[1]);
      assert.equal(query.get('head_sha'), sha);
      assert.equal(query.get('branch'), sourceBranch);
      assert.equal(query.get('event'), 'push');
      return {workflow_runs: runs[Math.min(runIndex++, runs.length - 1)]};
    }
    if (path === `/compare/${released}...${sha}`) return {status: comparison};
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  return {writes, sleeps, options: {env, request, sleep: async ms => sleeps.push(ms), log: () => {}, attempts: 2}};
}

test('promotes only the tested exact commit without forcing history', async () => {
  const f = fixture();
  assert.equal(await promote(f.options), 'promoted');
  assert.deepEqual(f.writes, [{path: `/git/refs/heads/${releaseBranch}`, body: {sha, force: false}}]);
});

test('PR, foreign repository, wrong branch, malformed SHA and failed runtime cannot write', async () => {
  for (const changes of [{GITHUB_EVENT_NAME: 'pull_request'}, {GITHUB_REPOSITORY: 'other/repo'}, {GITHUB_REF: 'refs/heads/main'}, {GITHUB_SHA: 'short'}, {CORE_RUNTIME_RESULT: 'failure'}]) {
    const f = fixture();
    await assert.rejects(promote({...f.options, env: {...env, ...changes}}));
    assert.equal(f.writes.length, 0);
  }
});

test('Verify failure, cancellation or skipped checks leave the release untouched', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', null]) {
    const f = fixture({runs: [[run({conclusion})]]});
    await assert.rejects(promote(f.options), /Verify did not pass/);
    assert.equal(f.writes.length, 0);
  }
});

test('missing, wrong-SHA and PR-only runs cannot qualify', async () => {
  for (const runs of [[], [run({head_sha: previous})], [run({event: 'pull_request'})], [run({head_branch: 'main'})]]) {
    const f = fixture({runs: [runs]});
    await assert.rejects(promote(f.options), /Timed out/);
    assert.equal(f.writes.length, 0);
  }
});

test('waits for the latest Verify run and never uses an earlier successful run', async () => {
  const f = fixture({runs: [[run(), run({id: 11, status: 'in_progress', conclusion: null})], [run({id: 11})]]});
  assert.equal(await promote(f.options), 'promoted');
  assert.deepEqual(f.sleeps, [15_000]);
  const failed = fixture({runs: [[run(), run({id: 11, conclusion: 'failure'})]]});
  await assert.rejects(promote(failed.options), /Verify did not pass/);
  assert.equal(failed.writes.length, 0);
});

test('superseded commits are skipped before checks and immediately before promotion', async () => {
  for (const heads of [[newer], [sha, newer], [sha, sha, newer]]) {
    const f = fixture({heads});
    assert.equal(await promote(f.options), 'superseded');
    assert.equal(f.writes.length, 0);
  }
});

test('rerunning a release is idempotent and rollback/divergence are refused', async () => {
  const f = fixture({released: sha});
  assert.equal(await promote(f.options), 'unchanged');
  assert.equal(f.writes.length, 0);
  for (const comparison of ['behind', 'diverged']) {
    const bad = fixture({comparison});
    await assert.rejects(promote(bad.options), /fast-forward/);
    assert.equal(bad.writes.length, 0);
  }
});

test('a rejected GitHub write is reported without retrying or forcing', async () => {
  const f = fixture({patchError: new Error('GitHub conflict')});
  await assert.rejects(promote(f.options), /GitHub conflict/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].body.force, false);
});
