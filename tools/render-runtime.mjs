// Deployment adapter for an isolated, private recovery instance of unchanged Core.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const objectKeys=['BTCORE_S3_ENDPOINT','BTCORE_S3_BUCKET','BTCORE_S3_REGION','BTCORE_S3_ACCESS_KEY_ID','BTCORE_S3_SECRET_ACCESS_KEY'];
const forbiddenKeys=['BTCONNECT_ORIGIN','BTCORE_CONNECTOR_KEY','OPENAI_API_KEY','BTCORE_AI_KEY_ENCRYPTED','BTCORE_AI_KEY_WRAPPING_KEY'];
const migrationKeys=['DATABASE_URL','BTCORE_APP_DB_PASSWORD','BTCORE_RECOVERY_SETUP_CODE'];
export function recoveryEnvironment(input){
  if(input.BTCORE_ACCESS_MODE!=='private'||input.BTCORE_LOCAL==='1')throw Error('Recovery requires private hosted mode.');
  if(forbiddenKeys.some(k=>input[k]?.trim()))throw Error('Marketplace and AI credentials must remain absent during recovery.');
  if(objectKeys.some(k=>!input[k]?.trim()))throw Error('Complete independent object-storage configuration is required.');
  let database,origin,endpoint;
  try{database=new URL(input.DATABASE_URL);origin=new URL(input.BTCORE_ORIGIN);endpoint=new URL(input.BTCORE_S3_ENDPOINT);}catch{throw Error('Recovery URLs are invalid.');}
  if(!['postgres:','postgresql:'].includes(database.protocol)||!/(?:dev|test)/i.test(database.pathname)||!database.hostname||!database.username||!database.password)throw Error('A dedicated development database migration connection is required.');
  if(origin.protocol!=='https:'||origin.origin!==input.BTCORE_ORIGIN||origin.username||origin.password)throw Error('An exact HTTPS recovery origin is required.');
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('An HTTPS object-storage endpoint is required.');
  if(typeof input.BTCORE_APP_DB_PASSWORD!=='string'||input.BTCORE_APP_DB_PASSWORD.length<32)throw Error('A generated application-role password is required.');
  if(typeof input.BTCORE_RECOVERY_SETUP_CODE!=='string'||input.BTCORE_RECOVERY_SETUP_CODE.length<32)throw Error('A generated owner setup code is required.');
  database.username='btcore_app';
  database.password=encodeURIComponent(input.BTCORE_APP_DB_PASSWORD);
  const env={...input,BTCORE_APP_DATABASE_URL:database.href,BTCORE_SETUP_TOKEN_HASH:createHash('sha256').update(input.BTCORE_RECOVERY_SETUP_CODE).digest('hex')};
  for(const key of [...migrationKeys,...forbiddenKeys,'BTCORE_LOCAL','BTCORE_SQLITE_PATH'])delete env[key];
  return env;
}

export function runRecovery({input=process.env,launch=spawn,entry='/app/core/server.mjs'}={}){
  const env=recoveryEnvironment(input);
  // Clear migration/setup credentials before starting the long-running app.
  for(const key of migrationKeys)delete input[key];
  const child=launch(process.execPath,[entry],{env,stdio:'inherit',shell:false});
  const forward=signal=>()=>child.kill(signal);
  const interrupt=forward('SIGINT'),terminate=forward('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  const clean=()=>{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);};
  child.once('error',()=>{clean();console.error('Core recovery process could not start.');process.exitCode=1;});
  child.once('exit',(code,signal)=>{clean();process.exitCode=code??(signal==='SIGTERM'?143:signal==='SIGINT'?130:1);});
  return child;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{runRecovery();}catch{console.error('Core recovery configuration is incomplete or invalid. Check the deployment runbook.');process.exitCode=1;}
}
