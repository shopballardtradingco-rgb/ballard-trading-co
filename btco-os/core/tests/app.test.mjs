import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {harness} from './helpers.mjs';
import {hash} from '../domain.mjs';
import {parseBackup,restoreBackup} from '../backup.mjs';
import {createApp} from '../server.mjs';
const image=()=>sharp({create:{width:180,height:240,channels:3,background:'#426b54'}}).jpeg().toBuffer();
const item={title:'Synthetic test comic',kind:'comic',askCents:1000,costCents:200,location:'TEST-01',quantity:1};

test('independent owner setup, session, CSRF, forged identity, logout and password rotation',async()=>{
 const h=await harness();try{
  assert.equal((await h.request('/api/workspace',{auth:false,headers:{'oai-authenticated-user-id':'owner'}})).status,401);
  assert.equal((await h.request('/api/setup',{method:'POST',data:{},headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await h.setup()).status,201);assert.match(h.getCookie(),/^btcore_session=/);
  assert.equal((await h.setup()).status,409);
  assert.equal((await h.request('/api/items',{method:'POST',data:{},headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await h.request('/api/items',{method:'POST',data:{},headers:{Origin:'https://evil.test'}})).status,403);
  const oldCookie=h.getCookie();assert.equal((await h.request('/api/password',{method:'POST',data:{currentPassword:'synthetic-password-123',newPassword:'changed-synthetic-password'}})).status,200);
  assert.equal((await h.request('/api/workspace',{headers:{Cookie:oldCookie}})).status,401);
  assert.equal((await h.request('/api/logout',{method:'POST'})).status,200);assert.equal((await h.request('/api/workspace')).status,401);
  assert.equal((await h.request('/api/login',{method:'POST',data:{email:'owner@example.test',password:'synthetic-password-123'}})).status,401);
  assert.equal((await h.request('/api/login',{method:'POST',data:{email:'owner@example.test',password:'changed-synthetic-password'}})).status,200);
 }finally{await h.close();}
});
test('owner login rate limit is persistent and cannot be bypassed by spoofed forwarding headers',async()=>{
 const h=await harness();try{await h.setup();for(let n=0;n<10;n++)assert.equal((await h.request('/api/login',{method:'POST',data:{email:'wrong@example.test',password:'wrong'},headers:{'X-Forwarded-For':`192.0.2.${n}`}})).status,401);assert.equal((await h.request('/api/login',{method:'POST',data:{email:'owner@example.test',password:'synthetic-password-123'}})).status,429);}finally{await h.close();}
});
test('SKU and comic price rules, conflicts, replay and sales allocation survive restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'btcore-'));let h=await harness({sqlitePath:join(dir,'core.sqlite')});try{
  await h.setup();const op=randomUUID();const created=await h.save('/api/items',item,{operationId:op});assert.equal(created.status,200,created.text);
  const retry=await h.request('/api/items',{method:'POST',data:{expectedRevision:0,operationId:op,data:item}});assert.equal(retry.body.replayed,true);
  assert.equal((await h.request('/api/items',{method:'POST',data:{expectedRevision:1,operationId:op,data:{...item,title:'Changed'}}})).status,409);
  assert.equal((await h.save('/api/items/'+created.body.itemId,{askCents:999})).status,200);assert.equal((await h.request('/api/workspace')).body.state.inventory.items[0].askCents,1000);
  assert.equal((await h.save('/api/items',item,{expectedRevision:0})).status,409);
  const ws=(await h.request('/api/workspace')).body.state;const stored=ws.inventory.items[0];assert.equal((await h.save('/api/items',{...item,sku:stored.sku})).status,400);
  assert.equal((await h.save('/api/items',{...item,owner_id:'spoof'})).status,400);
  const sale={itemId:created.body.itemId,quantity:1,date:'2026-10-17',revenueCents:1000,shippingCollectedCents:0,sellingFeeCents:150,promoFeeCents:50,postageCents:0,suppliesCents:30,refundCents:0,channel:'test',reference:'synthetic',notes:''};
  const sold=await h.save('/api/sales',sale);assert.equal(sold.status,200,sold.text);
  assert.equal((await h.save('/api/sales',sale)).status,400);
  const report=(await h.request('/api/workspace')).body;assert.equal(report.summary.units,0);assert.equal(report.summary.net,570);
  assert.equal((await h.save('/api/items/'+stored.id,{costCents:0})).status,400);
  await h.close();h=await harness({sqlitePath:join(dir,'core.sqlite')});await h.request('/api/login',{method:'POST',data:{email:'owner@example.test',password:'synthetic-password-123'}});
  assert.equal((await h.request('/api/workspace')).body.summary.net,570);
  assert.equal((await h.save('/api/sales/'+sold.body.saleId+'/reverse',{})).status,200);assert.equal((await h.request('/api/workspace')).body.summary.units,1);
 }finally{await h.close();await rm(dir,{recursive:true});}
});
test('two simultaneous saves have one winner',async()=>{
 const h=await harness();try{await h.setup();const results=await Promise.all([1,2].map(n=>h.request('/api/items',{method:'POST',data:{expectedRevision:0,operationId:randomUUID(),data:{...item,title:'Synthetic '+n}}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await h.request('/api/workspace')).body.state.inventory.items.length,1);}finally{await h.close();}
});
test('photo intake preserves bytes, requires review, clears changed reviews, and restores a complete backup',async()=>{
 const h=await harness(),target=await harness();try{
  await h.setup();await target.setup();const created=await h.save('/api/drafts',{...item,quantity:undefined});
  assert.equal(created.status,200,created.text);const id=created.body.draftId;
  assert.equal((await h.save('/api/drafts/'+id+'/receive',{})).status,400);
  const original=await image();const photoIds=[];
  for(const role of ['front','back']){
   const revision=(await h.request('/api/workspace')).body.state.revision;
   const r=await h.request(`/api/drafts/${id}/photos?role=${role}&filename=synthetic-${role}.jpg`,{method:'POST',raw:original,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':String(revision),'Idempotency-Key':randomUUID()}});
   assert.equal(r.status,201,r.text);assert.equal(r.body.photo.sha256,hash(original));photoIds.push(r.body.photo.id);
  }
  assert.equal((await h.request('/api/photos/'+photoIds[0]+'/original',{auth:false})).status,401);
  const raw=await fetch(h.url+'/api/photos/'+photoIds[0]+'/original',{headers:{Cookie:h.getCookie()}});assert.deepEqual(Buffer.from(await raw.arrayBuffer()),original);
  await h.save('/api/drafts/'+id,{conditionNotes:'Synthetic image; test fixture only.'});
  await h.save('/api/drafts/'+id,{identityReviewed:true,conditionReviewed:true});
  await h.save('/api/drafts/'+id,{title:'Corrected synthetic identity',identityReviewed:true});
  assert.equal((await h.request('/api/workspace')).body.state.drafts[0].identityReviewed,false);
  assert.equal((await h.save('/api/drafts/'+id+'/receive',{})).status,400);
  await h.save('/api/drafts/'+id,{identityReviewed:true});
  const received=await h.save('/api/drafts/'+id+'/receive',{});assert.equal(received.status,200,received.text);
  assert.equal((await h.save('/api/drafts/'+id+'/receive',{})).status,409);
  assert.equal((await h.request('/api/drafts/'+id+'/packet')).body.publicationApproved,false);
  const backup=await h.request('/api/backup');assert.equal(backup.status,200);assert.equal((await parseBackup(backup.text)).photos.length,2);
  const restored=await restoreBackup(target.store,backup.text);assert.equal(restored.items,1);assert.equal(restored.photos,2);
  const targetRaw=await fetch(target.url+'/api/photos/'+photoIds[0]+'/original',{headers:{Cookie:target.getCookie()}});assert.deepEqual(Buffer.from(await targetRaw.arrayBuffer()),original);
  await assert.rejects(()=>restoreBackup(target.store,backup.text),/empty workspace/);
  await assert.rejects(()=>parseBackup(backup.text.trim().split('\n').slice(0,-1).join('\n')),/incomplete/);
  const rows=backup.text.trim().split('\n').map(x=>JSON.parse(x));rows[1].sha256='0'.repeat(64);await assert.rejects(()=>parseBackup(rows.map(x=>JSON.stringify(x)).join('\n')),/integrity/);
 }finally{await h.close();await target.close();}
});
test('hosted runtime requires HTTPS, malformed images fail, and private resources are not static assets',async()=>{
 const h=await harness();try{
  await assert.rejects(()=>createApp({store:h.store,origin:'http://example.test'}),/HTTPS/);
  await h.setup();const d=await h.save('/api/drafts',{});
  assert.equal((await h.request(`/api/drafts/${d.body.draftId}/photos?role=front&filename=x.jpg`,{method:'POST',raw:Buffer.from('not an image'),headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':'1','Idempotency-Key':randomUUID()}})).status,400);
  assert.equal((await h.request('/core.sqlite')).status,404);assert.equal((await h.request('/server.mjs')).status,404);
  const index=await h.request('/');assert.match(index.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(!index.text.includes('signin-with-chatgpt'));
 }finally{await h.close();}
});
