import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {recoveryEnvironment,runRecovery} from '../render-runtime.mjs';

function input(){return {PATH:process.env.PATH,BTCORE_ACCESS_MODE:'private',DATABASE_URL:'postgresql://migration:synthetic-admin@database.internal:5432/btcore_recovery_dev',BTCORE_APP_DB_PASSWORD:'synthetic-app-password-with-:/@%?#-characters',BTCORE_RECOVERY_SETUP_CODE:'synthetic-owner-setup-code-with-32-characters',BTCORE_ORIGIN:'https://core.example.test',BTCORE_S3_ENDPOINT:'https://objects.example.test',BTCORE_S3_BUCKET:'isolated',BTCORE_S3_REGION:'auto',BTCORE_S3_ACCESS_KEY_ID:'synthetic-access',BTCORE_S3_SECRET_ACCESS_KEY:'synthetic-object-secret',BTCORE_S3_PATH_STYLE:'1',PORT:'3000'};}

test('app gets restricted credentials and digest, without migration or setup secrets',()=>{
 const source=input(),env=recoveryEnvironment(source),url=new URL(env.BTCORE_APP_DATABASE_URL);
 assert.equal(url.username,'btcore_app');assert.equal(decodeURIComponent(url.password),source.BTCORE_APP_DB_PASSWORD);
 assert.equal(url.hostname,'database.internal');assert.equal(url.pathname,'/btcore_recovery_dev');
 assert.equal(env.BTCORE_SETUP_TOKEN_HASH,createHash('sha256').update(source.BTCORE_RECOVERY_SETUP_CODE).digest('hex'));
 for(const key of ['DATABASE_URL','BTCORE_APP_DB_PASSWORD','BTCORE_RECOVERY_SETUP_CODE'])assert.equal(env[key],undefined);
 assert.equal(env.BTCORE_S3_SECRET_ACCESS_KEY,source.BTCORE_S3_SECRET_ACCESS_KEY);
 assert.equal(source.DATABASE_URL.includes('migration'),true);
});

test('recovery refuses open mode, live integrations and incomplete storage',()=>{
 for(const change of [{BTCORE_ACCESS_MODE:'open'},{BTCORE_LOCAL:'1'},{BTCONNECT_ORIGIN:'https://connector.example.test'},{BTCORE_CONNECTOR_KEY:'synthetic'},{OPENAI_API_KEY:'synthetic'},{BTCORE_AI_KEY_ENCRYPTED:'synthetic'},{BTCORE_AI_KEY_WRAPPING_KEY:'synthetic'},{BTCORE_S3_SECRET_ACCESS_KEY:''}])assert.throws(()=>recoveryEnvironment({...input(),...change}));
});

test('invalid URL and credential errors never echo connection strings or secrets',()=>{
 for(const change of [{DATABASE_URL:'malformed-synthetic-secret'},{DATABASE_URL:'postgresql://admin:synthetic-secret@db/production'},{BTCORE_ORIGIN:'http://core.example.test'},{BTCORE_ORIGIN:'https://core.example.test/path'},{BTCORE_S3_ENDPOINT:'https://user:synthetic-secret@objects.example.test'},{BTCORE_APP_DB_PASSWORD:'short'},{BTCORE_RECOVERY_SETUP_CODE:'short'}]){
  assert.throws(()=>recoveryEnvironment({...input(),...change}),error=>!error.message.includes('synthetic-secret')&&!error.message.includes('postgresql://'));
 }
});

test('launcher removes parent migration credentials, avoids a shell, and forwards shutdown',()=>{
 const source=input(),child=new EventEmitter(),kills=[];child.kill=signal=>kills.push(signal);
 let invocation;runRecovery({input:source,launch:(...args)=>(invocation=args,child),entry:'/app/core/server.mjs'});
 assert.deepEqual(invocation.slice(0,2),[process.execPath,['/app/core/server.mjs']]);assert.equal(invocation[2].shell,false);
 assert.equal(source.DATABASE_URL,undefined);assert.equal(source.BTCORE_RECOVERY_SETUP_CODE,undefined);
 assert.equal(invocation[2].env.DATABASE_URL,undefined);
 process.emit('SIGTERM');assert.deepEqual(kills,['SIGTERM']);child.emit('exit',0,null);assert.equal(process.exitCode,0);
});

test('real child receives only app credentials and survives launcher restart consistently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'btcore-render-test-'));const entry=join(dir,'probe.mjs');
 try{
  await writeFile(entry,"process.stdout.write(JSON.stringify({user:new URL(process.env.BTCORE_APP_DATABASE_URL).username,adminPresent:'DATABASE_URL' in process.env,setupPresent:'BTCORE_RECOVERY_SETUP_CODE' in process.env,digest:process.env.BTCORE_SETUP_TOKEN_HASH}));");
  const results=[];
  for(let i=0;i<2;i++){
   let output='';const child=runRecovery({input:input(),entry,launch:(exe,args,options)=>spawn(exe,args,{...options,stdio:['ignore','pipe','pipe']})});
   child.stdout.on('data',chunk=>output+=chunk);const [code]=await once(child,'exit');assert.equal(code,0);results.push(JSON.parse(output));
  }
  assert.deepEqual(results[0],results[1]);assert.equal(results[0].user,'btcore_app');assert.equal(results[0].adminPresent,false);assert.equal(results[0].setupPresent,false);assert.match(results[0].digest,/^[a-f0-9]{64}$/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
