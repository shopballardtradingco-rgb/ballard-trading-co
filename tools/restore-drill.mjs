// Offline recovery exercise only. No production URLs, credentials or marketplace calls.
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve, sep} from 'node:path';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {openStore} from '../btco-os/core/store.mjs';
import {restoreBackupFile} from '../btco-os/core/backup.mjs';
import {photoBytes} from '../btco-os/core/object-storage.mjs';
import {hash} from '../btco-os/core/domain.mjs';

const input = process.argv[2];
if (!input) throw Error('Usage: node tools/restore-drill.mjs /private/backup.ndjson');
const directory = await mkdtemp(join(tmpdir(), 'btcore-recovery-'));
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
    try { await writeFile(path, bytes, {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (hash(await readFile(path)) !== hash(bytes)) throw Error('Local object integrity mismatch');
  },
  get: key => readFile(pathFor(key)),
};
const firstLine = createInterface({input: createReadStream(input, {encoding:'utf8'}), crlfDelay:Infinity});
let source;
for await (const line of firstLine) { if (line.trim()) {source=JSON.parse(line); break;} }
firstLine.close();
if (source?.type !== 'manifest') throw Error('Missing backup manifest');
const store = await openStore({sqlitePath: join(directory, 'recovered.sqlite'), allowSqlite: true});
try {
  await store.query('INSERT INTO core_owner(id,email,password_hash,created_at) VALUES(?,?,?,?)',
    ['offline-recovery-owner','recovery@example.invalid','disabled-no-login',new Date().toISOString()]);
  const result = await restoreBackupFile(store, input, {objectStore: storage});
  const state = await store.workspace();
  if (state.inventory.items.length !== source.state.inventory.items.length ||
      state.inventory.sales.length !== source.state.inventory.sales.length ||
      state.drafts.length !== source.state.drafts.length) throw Error('Recovered record counts differ');
  const rows = await store.query('SELECT * FROM core_photos');
  for (const row of rows) await photoBytes(row, storage);
  let overwriteRejected = false;
  try { await restoreBackupFile(store, input, {objectStore: storage}); }
  catch (error) { if (/empty workspace/.test(error.message)) overwriteRejected = true; else throw error; }
  if (!overwriteRejected) throw Error('Non-empty restore was not rejected');
  console.log(JSON.stringify({restored: result.restored, items: state.inventory.items.length,
    drafts: state.drafts.length, sales: state.inventory.sales.length, photos: rows.length,
    originalHashesVerified: true, nonEmptyRestoreRejected: true, offlineOnly: true,
    privateRecoveryDirectory: directory}, null, 2));
} finally {await store.close();}
