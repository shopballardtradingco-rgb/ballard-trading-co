import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {harness} from './helpers.mjs';
import {createApp} from '../server.mjs';
import {createOpenAccess} from '../open-access.mjs';

test('open workspace needs no setup, reuses sessions, and retains CSRF and origin checks',async()=>{
 const h=await harness({accessMode:'open'});try{
  const first=await h.request('/api/session');
  assert.equal(first.body.authenticated,true);assert.equal(first.body.loginRequired,false);
  const cookie=h.getCookie();assert.match(cookie,/^btcore_open_session=/);
  assert.equal((await h.request('/api/session')).body.csrf,first.body.csrf);
  assert.equal((await h.request('/api/workspace')).status,200);
  assert.equal((await h.request('/api/workspace',{auth:false})).status,401);
  assert.equal((await h.request('/api/workspace',{headers:{Cookie:cookie+'tampered'}})).status,401);
  for(const headers of [{'X-CSRF-Token':'wrong'},{Origin:'https://other.test'},{'Sec-Fetch-Site':'cross-site'}]){
   assert.equal((await h.request('/api/items',{method:'POST',data:{},headers})).status,403);
  }
  for(const path of ['/api/setup','/api/login','/api/password','/api/logout'])assert.equal((await h.request(path,{method:'POST',data:{}})).status,409);
  assert.equal((await h.save('/api/items',{title:'Synthetic open workspace item',kind:'card',quantity:1})).status,200);
  assert.equal((await h.store.query('SELECT * FROM core_sessions')).length,0);
  await assert.rejects(()=>createApp({store:h.store,origin:'https://example.test',accessMode:'oops'}),/ACCESS_MODE/);
  const secure=await createOpenAccess(h.store,true);assert.match(secure.issue().cookie,/; Secure$/);
 }finally{await h.close();}
});

test('open workspace data and photo ownership survive restart and private setup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'btcore-open-')),sqlitePath=join(dir,'core.sqlite');
 let h=await harness({sqlitePath,accessMode:'open'});try{
  await h.request('/api/session');const openCookie=h.getCookie();
  const ownerId=(await h.store.query('SELECT id FROM core_owner'))[0].id;
  const d=await h.save('/api/drafts',{title:'Synthetic saved intake',kind:'card'});
  const original=await sharp({create:{width:160,height:220,channels:3,background:'#35664a'}}).jpeg().toBuffer();
  const uploaded=await h.request(`/api/drafts/${d.body.draftId}/photos?role=front&filename=synthetic.jpg`,{method:'POST',raw:original,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':'1','Idempotency-Key':randomUUID()}});
  assert.equal(uploaded.status,201,uploaded.text);const photoId=uploaded.body.photo.id;
  const saved=await h.store.workspace();
  await h.close();h=await harness({sqlitePath,accessMode:'open'});await h.request('/api/session');
  assert.deepEqual(await h.store.workspace(),saved);assert.equal((await h.store.query('SELECT id FROM core_owner')).length,1);
  await h.close();h=await harness({sqlitePath});
  assert.equal((await h.request('/api/workspace',{headers:{Cookie:openCookie}})).status,401);
  assert.equal((await h.request('/api/session')).body.setupRequired,true);
  assert.equal((await h.setup()).status,201);
  assert.equal((await h.store.query('SELECT id FROM core_owner'))[0].id,ownerId);
  assert.deepEqual(await h.store.workspace(),saved);
  const raw=await fetch(h.url+'/api/photos/'+photoId+'/original',{headers:{Cookie:h.getCookie()}});
  assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),original);
  assert.equal((await h.request('/api/workspace',{headers:{Cookie:openCookie}})).status,401);
 }finally{await h.close();await rm(dir,{recursive:true,force:true});}
});

test('existing private account and records are preserved when opening and closing access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'btcore-private-')),sqlitePath=join(dir,'core.sqlite');
 let h=await harness({sqlitePath});try{
  await h.setup();await h.save('/api/items',{title:'Synthetic existing record',kind:'card',quantity:1});
  const owner=(await h.store.query('SELECT * FROM core_owner'))[0],saved=await h.store.workspace();
  await h.close();h=await harness({sqlitePath,accessMode:'open'});await h.request('/api/session');const openCookie=h.getCookie();
  assert.deepEqual((await h.store.query('SELECT * FROM core_owner'))[0],owner);
  assert.deepEqual(await h.store.workspace(),saved);
  await h.close();h=await harness({sqlitePath});
  assert.equal((await h.request('/api/session')).body.setupRequired,false);
  assert.equal((await h.request('/api/workspace',{headers:{Cookie:openCookie}})).status,401);
  assert.equal((await h.request('/api/login',{method:'POST',data:{email:'owner@example.test',password:'synthetic-password-123'}})).status,200);
  assert.deepEqual(await h.store.workspace(),saved);
 }finally{await h.close();await rm(dir,{recursive:true,force:true});}
});
