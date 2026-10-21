// Core Dev migration step; never point this command at Connect or a production database.
import pg from 'pg';
import {objectStorageFromEnv} from './object-storage.mjs';
import {openStore} from './store.mjs';
import {fileURLToPath} from 'node:url';
export async function provision({databaseUrl,password}={}){
 if(!databaseUrl||typeof password!=='string'||password.length<32)throw Error('Dedicated migration URL and a random application password of at least 32 characters are required.');
 const url=new URL(databaseUrl);if(!/(?:dev|test)/i.test(url.pathname))throw Error('This provisioner is restricted to a development or test database.');
 const store=await openStore({databaseUrl});await store.close();
 const client=new pg.Client({connectionString:databaseUrl,connectionTimeoutMillis:10000});await client.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(719252628)');
  const existing=await client.query("SELECT rolname FROM pg_roles WHERE rolname='btcore_app'");
  // PostgreSQL utility statements cannot bind parameters; format quotes the password server-side.
  const sql=await client.query("SELECT format($1::text, $2::text) AS statement",[`${existing.rowCount?'ALTER':'CREATE'} ROLE btcore_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L`,password]);
  await client.query(sql.rows[0].statement);
  await client.query('GRANT USAGE ON SCHEMA public TO btcore_app');
  for(const table of ['core_owner','core_workspace','core_sessions','core_login_limits','core_photos','core_operations','core_snapshots','core_mirror_connection'])await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE ${table} TO btcore_app`);
  await client.query('COMMIT');return {migrated:true,role:'btcore_app'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{const objectStore=objectStorageFromEnv();if(objectStore){await objectStore.check();await objectStore.put('btcore/system/storage-check-v1',Buffer.from('BTCore object storage read/write verification v1'),'text/plain');}console.log(JSON.stringify(await provision({databaseUrl:process.env.DATABASE_URL,password:process.env.BTCORE_APP_DB_PASSWORD})));}
 catch{console.error('Core Dev provisioning failed. Check the dedicated migration connection and password configuration.');process.exitCode=1;}
}

