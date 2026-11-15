// Offline recovery exercise only. No production URLs, credentials or marketplace calls.
import {mkdtemp, mkdir, readFile, writeFile, rm, readdir, lstat, statfs} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve, sep} from 'node:path';
import {openStore} from '../btco-os/core/store.mjs';
import {restoreBackupFile,backupFileLines} from '../btco-os/core/backup.mjs';
import {photoBytes} from '../btco-os/core/object-storage.mjs';
import {hash} from '../btco-os/core/domain.mjs';

const input = process.argv[2];
if (!input) throw Error('Usage: node tools/restore-drill.mjs /private/backup.ndjson');
const option=(name,fallback)=>{const i=process.argv.indexOf(name);const value=i<0?fallback:Number(process.argv[i+1]);if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid restore budget');return value;};
const maxBytes=option('--max-export-bytes',512*1024*1024),maxWork=option('--max-work-bytes',512*1024*1024);
const compressed=process.argv.includes('--gzip');
// Limit SQLite pages and leave twice that budget for WAL/journal overhead.
// Object bytes are charged before writing, including regenerated previews.
const databaseBudget=Math.floor(maxWork/8);
const objectBudget=maxWork-3*databaseBudget;
let storedBytes=0,allocatedObjectBytes=0;const storedKeys=new Set();
const firstLine = backupFileLines(input,{compressed,maxBytes});
let source;
for await (const line of firstLine) { if (line.trim()) {source=JSON.parse(line); break;} }
await firstLine.return();
if (source?.type !== 'manifest') throw Error('Missing backup manifest');
const directory = await mkdtemp(join(tmpdir(), 'btcore-recovery-'));
let blockSize;
let peakAllocatedBytes=0;
async function fileUsage(path){
  const info=await lstat(path);
  if(info.isSymbolicLink())throw Error('Unexpected recovery symlink');
  let bytes=info.isDirectory()?0:info.size,allocated=info.blocks*512;
  if(info.isDirectory())for(const entry of await readdir(path)){
    const child=await fileUsage(join(path,entry));bytes+=child.bytes;allocated+=child.allocated;
  }
  return {bytes,allocated};
}
async function checkWork(additional=0){
  const usage=await fileUsage(directory);
  peakAllocatedBytes=Math.max(peakAllocatedBytes,usage.allocated);
  if(usage.allocated+additional>maxWork)throw Error('Restore working-space budget exceeded');
  return usage;
}
// Check actual blocks around each SQL statement and object write, not only at
// completion. SQLite page and object caps also bound individual writes. These
// checks fail closed; they are not an OS quota or a filesystem reservation.
const checkedQuery=q=>async(...args)=>{await checkWork();const result=await q(...args);await checkWork();return result;};
const objects = join(directory, 'objects');
const pathFor = key => {
  const path = resolve(objects, key);
  if (!path.startsWith(objects + sep)) throw Error('Invalid object path');
  return path;
};
const storage = {
  kind: 'offline-drill',
  async put(key, bytes) {
    const path = pathFor(key);
    await mkdir(dirname(path), {recursive: true, mode: 0o700});
    const allocated=Math.ceil(bytes.length/blockSize)*blockSize;
    if(!storedKeys.has(key)&&allocatedObjectBytes+allocated>objectBudget)throw Error('Restore working-space budget exceeded');
    await checkWork(storedKeys.has(key)?0:allocated);
    try { await writeFile(path, bytes, {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (hash(await readFile(path)) !== hash(bytes)) throw Error('Local object integrity mismatch');
    if(!storedKeys.has(key)){storedKeys.add(key);storedBytes+=bytes.length;allocatedObjectBytes+=allocated;}
    await checkWork();
  },
  get: key => readFile(pathFor(key)),
};
let store;
try {
  blockSize=(await statfs(directory)).bsize;
  if(!Number.isSafeInteger(blockSize)||blockSize<1)throw Error('Restore filesystem capacity is unknown');
  store = await openStore({sqlitePath: join(directory, 'recovered.sqlite'), allowSqlite: true});
  await checkWork();
  const rawTransaction=store.transaction;
  store.query=checkedQuery(store.query);
  store.transaction=async fn=>{
    const result=await rawTransaction(q=>fn(checkedQuery(q)));
    await checkWork();
    return result;
  };
  const pageSize=(await store.query('PRAGMA page_size'))[0].page_size;
  if(databaseBudget<pageSize)throw Error('Restore database budget is too small');
  const maxPages=(await store.query('PRAGMA max_page_count = '+Math.floor(databaseBudget/pageSize)))[0].max_page_count;
  if(maxPages*pageSize>databaseBudget)throw Error('Restore database exceeds its budget');
  await store.query('INSERT INTO core_owner(id,email,password_hash,created_at) VALUES(?,?,?,?)',
    ['offline-recovery-owner','recovery@example.invalid','disabled-no-login',new Date().toISOString()]);
  const result = await restoreBackupFile(store, input, {objectStore: storage,compressed,maxBytes});
  const state = await store.workspace();
  if (state.inventory.items.length !== source.state.inventory.items.length ||
      state.inventory.sales.length !== source.state.inventory.sales.length ||
      state.drafts.length !== source.state.drafts.length) throw Error('Recovered record counts differ');
  const rows = await store.query('SELECT * FROM core_photos');
  for (const row of rows) await photoBytes(row, storage);
  let overwriteRejected = false;
  try { await restoreBackupFile(store, input, {objectStore: storage,compressed,maxBytes}); }
  catch (error) { if (/empty workspace/.test(error.message)) overwriteRejected = true; else throw error; }
  if (!overwriteRejected) throw Error('Non-empty restore was not rejected');
  const usage=await checkWork(),restoredFileBytes=usage.bytes;
  console.log(JSON.stringify({restored: result.restored, items: state.inventory.items.length,
    drafts: state.drafts.length, sales: state.inventory.sales.length, photos: rows.length,
    originalHashesVerified: true, nonEmptyRestoreRejected: true, offlineOnly: true,
    objectBytes:storedBytes,restoredFileBytes,restoredAllocatedBytes:usage.allocated,
    peakAllocatedBytes,peakMeasurement:'sql-and-object-write-boundaries',
    workBudgetBytes:maxWork,maxRssKiB:process.resourceUsage().maxRSS,
    ...(process.argv.includes('--cleanup')?{}:{privateRecoveryDirectory: directory})}, null, 2));
} finally {await store?.close();if(process.argv.includes('--cleanup'))await rm(directory,{recursive:true,force:true});}
