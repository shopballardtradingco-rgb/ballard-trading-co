import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './helpers.mjs';
import {randomUUID} from 'node:crypto';
import {restoreBackup} from '../backup.mjs';
import {openStore} from '../store.mjs';
import sharp from 'sharp';
import {provision} from '../provision.mjs';
const enabled=process.env.BTCORE_TEST_POSTGRES==='1';
test('PostgreSQL transactions, persistence, photos and restore use disposable isolated databases',{skip:!enabled},async()=>{
 assert.ok(process.env.BTCORE_TEST_DATABASE_URL,'Set a disposable BTCORE_TEST_DATABASE_URL');
 const dbUrl=new URL(process.env.BTCORE_TEST_DATABASE_URL);assert.match(dbUrl.pathname,/test/,'Database name must contain test.');
 const password='synthetic-application-password-for-CI-only';
 await provision({databaseUrl:dbUrl.href,password});
 const runtimeUrl=new URL(dbUrl);runtimeUrl.username='btcore_app';runtimeUrl.password=password;
 const h=await harness({databaseUrl:runtimeUrl.href,migrate:false});let second;
 try{
  assert.equal((await h.setup()).status,201);
  assert.equal((await h.request('/api/mirror')).status,200,'Runtime role can read the provisioned mirror connection table');
  await h.store.query('INSERT INTO core_mirror_connection(id,encrypted_grant,enabled_until,last_attempt,last_success,error) VALUES(1,?,?,?,?,?)',['synthetic-encrypted',Date.now()+86400000,0,0,'']);
  assert.equal((await h.store.query('UPDATE core_mirror_connection SET last_attempt=? WHERE id=1 AND enabled_until>? AND last_attempt<? RETURNING encrypted_grant',[Date.now(),Date.now(),Date.now()-900000]))[0].encrypted_grant,'synthetic-encrypted');
  assert.equal((await h.request('/api/mirror/stop',{method:'POST',data:{}})).status,200);
  assert.equal((await h.store.query('SELECT encrypted_grant FROM core_mirror_connection WHERE id=1'))[0].encrypted_grant,'');
  await assert.rejects(()=>h.store.query('CREATE TABLE public.btcore_should_not_create(id INTEGER)'),e=>e.code==='42501');
  const first=await h.save('/api/drafts',{title:'Synthetic PostgreSQL comic',kind:'comic',askCents:1000,location:'TEST-PG'});assert.equal(first.status,200,first.text);
  const bytes=await sharp({create:{width:150,height:200,channels:3,background:'green'}}).png().toBuffer();
  const photo=await h.request(`/api/drafts/${first.body.draftId}/photos?role=front&filename=synthetic.png`,{method:'POST',raw:bytes,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':'1','Idempotency-Key':randomUUID()}});assert.equal(photo.status,201,photo.text);
  const results=await Promise.all([1,2].map(n=>h.request('/api/items',{method:'POST',data:{expectedRevision:2,operationId:randomUUID(),data:{title:'Synthetic parallel '+n,kind:'card',quantity:1}}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  second=await openStore({databaseUrl:runtimeUrl.href,migrate:false});assert.equal((await second.workspace()).revision,3);
  const id=first.body.draftId;
  const upload=async(role,content,replace)=>h.request(`/api/drafts/${id}/photos?role=${role}&filename=synthetic.png${replace?'&replace='+replace:''}`,{method:'POST',raw:content,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':String((await h.store.workspace()).revision),'Idempotency-Key':randomUUID()}});
  assert.equal((await upload('back',bytes)).status,201);
  assert.equal((await h.save('/api/drafts/'+id+'/swap-photos',{})).status,200,'PostgreSQL unique role slots must swap atomically');
  const current=(await h.store.workspace()).drafts[0].photos.find(p=>p.role==='front');
  const corrected=await sharp({create:{width:150,height:200,channels:3,background:'blue'}}).png().toBuffer();
  assert.equal((await upload('front',corrected,current.id)).status,201,'PostgreSQL replacement preserves the previous original under its retired slot');
  assert.equal((await h.save('/api/drafts/'+id+'/archive',{})).status,200);
  assert.equal((await second.workspace()).drafts[0].photoHistory.length,1);
  assert.equal((await h.store.query('SELECT role FROM core_photos')).filter(p=>p.role.startsWith('retired:')).length,1);
  const backup=await h.request('/api/backup');assert.equal(backup.status,200);
  const target=await harness();try{await target.setup();assert.equal((await restoreBackup(target.store,backup.text)).photos,3);assert.equal((await target.store.workspace()).drafts[0].status,'archived');}finally{await target.close();}
  const raw=await fetch(h.url+'/api/photos/'+photo.body.photo.id+'/original',{headers:{Cookie:h.getCookie()}});assert.deepEqual(Buffer.from(await raw.arrayBuffer()),bytes);
 }finally{await second?.close();await h.close();}
});

