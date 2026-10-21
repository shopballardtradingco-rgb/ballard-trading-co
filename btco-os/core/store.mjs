import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';
import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {emptyState} from '../web/domain/core.mjs';

export const initialWorkspace=()=>({schemaVersion:1,revision:0,inventory:emptyState('work'),drafts:[]});
const schema=blob=>[
 `CREATE TABLE IF NOT EXISTS core_mirror_connection (id INTEGER PRIMARY KEY CHECK(id=1), encrypted_grant TEXT NOT NULL, enabled_until BIGINT NOT NULL, last_attempt BIGINT NOT NULL, last_success BIGINT NOT NULL, error TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS core_owner (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS core_workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS core_sessions (token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES core_owner(id), csrf TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS core_login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at BIGINT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS core_photos (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES core_owner(id), draft_id TEXT NOT NULL, role TEXT NOT NULL, filename TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, original ${blob} NOT NULL, preview ${blob} NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,draft_id,role))`,
 `CREATE TABLE IF NOT EXISTS core_operations (owner_id TEXT NOT NULL, id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id))`,
 `CREATE TABLE IF NOT EXISTS core_snapshots (revision INTEGER PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)`
];
export async function openStore({databaseUrl,sqlitePath,allowSqlite=false,migrate=true}={}) {
 let pool,sqlite,tail=Promise.resolve();
 if(databaseUrl)pool=new pg.Pool({connectionString:databaseUrl,max:4,connectionTimeoutMillis:10000,statement_timeout:15000});
 else {
  if(!allowSqlite||!sqlitePath)throw Error('DATABASE_URL is required. Local SQLite needs explicit BTCORE_LOCAL=1.');
  if(sqlitePath!==':memory:')await mkdir(dirname(sqlitePath),{recursive:true,mode:0o700});
  sqlite=new DatabaseSync(sqlitePath);sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 }
 const run=async (sql,params=[],client=pool)=>{
  if(pool){let n=0;return (await client.query(sql.replace(/\?/g,()=>'$'+(++n)),params)).rows;}
  const stmt=sqlite.prepare(sql);if(/^\s*(SELECT|WITH|PRAGMA|INSERT.*RETURNING|UPDATE.*RETURNING)/is.test(sql)&&(/RETURNING/i.test(sql)||/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)))return stmt.all(...params);
  stmt.run(...params);return [];
 };
 const transaction=async fn=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn((sql,params=[])=>run(sql,params,client));await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  const work=tail.then(async()=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=await fn(run);sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}});tail=work.catch(()=>{});return work;
 };
 if(migrate)await transaction(async q=>{
  if(pool)await q('SELECT pg_advisory_xact_lock(719252627)');
  for(const sql of schema(pool?'BYTEA':'BLOB'))await q(sql);
  for(const column of ['original_key','preview_key']){
   if(pool)await q(`ALTER TABLE core_photos ADD COLUMN IF NOT EXISTS ${column} TEXT`);
   else if(!(await q('PRAGMA table_info(core_photos)')).some(c=>c.name===column))sqlite.exec(`ALTER TABLE core_photos ADD COLUMN ${column} TEXT`);
  }
  await q('INSERT INTO core_workspace(id,revision,body) VALUES(1,0,?) ON CONFLICT(id) DO NOTHING',[JSON.stringify(initialWorkspace())]);
 });
 await run('SELECT revision FROM core_workspace WHERE id=1');
 const query=pool?run:(sql,params=[])=>tail.then(()=>run(sql,params));
 return {kind:pool?'postgres':'sqlite-local',query,transaction,lockSuffix:pool?' FOR UPDATE':'',
  workspace:async()=>JSON.parse((await query('SELECT body FROM core_workspace WHERE id=1'))[0].body),
  close:async()=>pool?pool.end():sqlite.close()};
}

