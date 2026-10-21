import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {harness} from './helpers.mjs';
import {hash} from '../domain.mjs';
import {parseBackup,restoreBackup} from '../backup.mjs';

const photo=color=>sharp({create:{width:180,height:240,channels:3,background:color}}).jpeg().toBuffer();
async function upload(h,id,role,bytes,{replace,operationId=randomUUID(),expectedRevision}={}){
 const revision=expectedRevision??(await h.store.workspace()).revision;
 return h.request(`/api/drafts/${id}/photos?role=${role}&filename=synthetic-${role}.jpg${replace?'&replace='+replace:''}`,{method:'POST',raw:bytes,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':String(revision),'Idempotency-Key':operationId}});
}
const draftDetails={title:'Synthetic correction comic',kind:'comic',askCents:1000,location:'TEST-02',conditionNotes:'Synthetic test only.'};

test('photo corrections preserve every byte, invalidate review, replay once, and round-trip history',async()=>{
 const h=await harness(),target=await harness();
 try{
  await h.setup();await target.setup();const id=(await h.save('/api/drafts',draftDetails)).body.draftId;
  const originals=await Promise.all(['red','blue','green','yellow'].map(photo));
  const front=(await upload(h,id,'front',originals[0])).body.photo;
  const back=(await upload(h,id,'back',originals[1])).body.photo;
  await h.save('/api/drafts/'+id,{identityReviewed:true,conditionReviewed:true});
  assert.equal((await h.save('/api/drafts/'+id+'/swap-photos',{})).status,200);
  let d=(await h.store.workspace()).drafts[0];assert.equal(d.photos[0].id,back.id);assert.equal(d.photos[1].id,front.id);assert.equal(d.identityReviewed,false);assert.equal(d.conditionReviewed,false);
  assert.equal((await upload(h,id,'front',originals[2])).status,409,'Replacement must explicitly identify the current original');
  assert.equal((await upload(h,id,'front',originals[2],{replace:front.id})).status,409,'A stale assignment cannot overwrite a new one');
  const operationId=randomUUID();const replacement=await upload(h,id,'front',originals[2],{replace:back.id,operationId});assert.equal(replacement.status,201,replacement.text);
  const replay=await upload(h,id,'front',originals[2],{replace:back.id,operationId,expectedRevision:0});assert.equal(replay.body.replayed,true);
  const latest=await upload(h,id,'front',originals[3],{replace:replacement.body.photo.id});assert.equal(latest.status,201,latest.text);
  d=(await h.store.workspace()).drafts[0];assert.equal(d.photoHistory.length,2);assert.equal(d.photoHistory[0].replacedBy,replacement.body.photo.id);assert.equal(d.photoHistory[1].replacedBy,latest.body.photo.id);
  const stored=await h.store.query('SELECT id,role,original FROM core_photos');assert.equal(stored.length,4);assert.equal(stored.filter(p=>p.role.startsWith('retired:')).length,2);
  for(const [index,id] of [front.id,back.id,replacement.body.photo.id,latest.body.photo.id].entries()){
   assert.deepEqual(Buffer.from(stored.find(p=>p.id===id).original),originals[index]);
   const r=await fetch(h.url+'/api/photos/'+id+'/original',{headers:{Cookie:h.getCookie()}});assert.deepEqual(Buffer.from(await r.arrayBuffer()),originals[index]);
  }
  assert.equal((await h.save('/api/drafts/'+id+'/receive',{})).status,400,'Corrections require renewed review');
  await h.save('/api/drafts/'+id+'/archive',{});
  const backup=await h.request('/api/backup'),parsed=await parseBackup(backup.text);assert.equal(parsed.photos.length,4);assert.equal(parsed.state.drafts[0].status,'archived');
  const receipt=await restoreBackup(target.store,backup.text);assert.equal(receipt.photos,4);assert.equal((await target.store.workspace()).drafts[0].photoHistory.length,2);
  await target.save('/api/drafts/'+id+'/restore',{});assert.equal((await target.save('/api/drafts/'+id+'/swap-photos',{})).status,200,'Restored role assignments satisfy uniqueness constraints');
  const rows=backup.text.trim().split('\n').map(JSON.parse);rows.find(r=>r.retired).retired=false;
  await assert.rejects(()=>parseBackup(rows.map(JSON.stringify).join('\n')),/assignment/);
 }finally{await h.close();await target.close();}
});

test('archived intake stays out of stock, rejects writes, restores for review, and locks after receiving',async()=>{
 const h=await harness();try{
  await h.setup();const id=(await h.save('/api/drafts',draftDetails)).body.draftId;const bytes=await photo('white');
  await upload(h,id,'front',bytes);await upload(h,id,'back',bytes);await h.save('/api/drafts/'+id,{identityReviewed:true,conditionReviewed:true});
  const op=randomUUID();const archived=await h.save('/api/drafts/'+id+'/archive',{},{operationId:op});assert.equal(archived.status,200);
  assert.equal((await h.save('/api/drafts/'+id+'/archive',{},{operationId:op,expectedRevision:0})).body.replayed,true);
  for(const [path,data] of [['',{title:'Changed'}],['/receive',{}],['/swap-photos',{}],['/archive',{}]])assert.equal((await h.save('/api/drafts/'+id+path,data)).status,409);
  assert.equal((await upload(h,id,'front',bytes)).status,409);
  assert.equal((await h.request('/api/workspace')).body.summary.units,0);
  assert.equal((await h.save('/api/drafts/'+id+'/restore',{})).status,200);
  let d=(await h.store.workspace()).drafts[0];assert.equal(d.photos.length,2);assert.equal(d.identityReviewed,false);assert.equal(d.conditionReviewed,false);
  await h.save('/api/drafts/'+id,{identityReviewed:true,conditionReviewed:true});assert.equal((await h.save('/api/drafts/'+id+'/receive',{})).status,200);
  for(const action of ['archive','restore','swap-photos'])assert.equal((await h.save('/api/drafts/'+id+'/'+action,{})).status,409);
  assert.equal((await upload(h,id,'front',bytes,{replace:d.photos[0].id})).status,409);
  assert.equal((await h.request('/api/workspace')).body.summary.units,1);
 }finally{await h.close();}
});

test('old v1 backups remain restorable and stale photo corrections cannot change state',async()=>{
 const h=await harness();try{
  await h.setup();const id=(await h.save('/api/drafts',{})).body.draftId;const bytes=await photo('black');
  const front=(await upload(h,id,'front',bytes)).body.photo;
  const previous=await h.store.workspace();const failed=await upload(h,id,'front',await photo('pink'),{replace:front.id,expectedRevision:0});assert.equal(failed.status,409);assert.deepEqual(await h.store.workspace(),previous);
  const backup=await h.request('/api/backup'),rows=backup.text.trim().split('\n').map(JSON.parse);rows[0].format='btcore-backup-v1';for(const row of rows)delete row.retired;
  const restored=await parseBackup(rows.map(JSON.stringify).join('\n'));assert.equal(restored.photos[0].sha256,hash(bytes));
 }finally{await h.close();}
});

test('a backup keeps its captured assignments when photos are corrected during streaming',async()=>{
 const h=await harness();let release;
 try{
  await h.setup();const id=(await h.save('/api/drafts',draftDetails)).body.draftId;
  const front=(await upload(h,id,'front',await photo('red'))).body.photo;await upload(h,id,'back',await photo('blue'));
  const originalQuery=h.store.query;let reached;
  const blocked=new Promise(resolve=>reached=resolve),resume=new Promise(resolve=>release=resolve);let first=true;
  h.store.query=async(sql,params)=>{if(first&&sql==='SELECT * FROM core_photos WHERE id=? AND owner_id=?'){first=false;reached();await resume;}return originalQuery(sql,params);};
  const download=h.request('/api/backup');await blocked;
  await h.save('/api/drafts/'+id+'/swap-photos',{});
  assert.equal((await upload(h,id,'back',await photo('green'),{replace:front.id})).status,201);
  release();const parsed=await parseBackup((await download).text);
  assert.equal(parsed.photos.length,2);assert.equal(parsed.state.drafts[0].photos.find(p=>p.role==='front').id,front.id);
  assert.equal((await h.store.workspace()).drafts[0].photoHistory.length,1);
 }finally{release?.();await h.close();}
});
