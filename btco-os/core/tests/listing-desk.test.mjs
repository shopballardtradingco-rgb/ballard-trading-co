import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {draftInput,hash,receiveDraft} from '../domain.mjs';
import {listingContent} from '../public/preparation-policy.mjs';
import {approveListings} from '../preparation.mjs';
import {stagePublicationBatch,prepareListingSelection} from '../publication.mjs';
import {deskFixFields} from '../public/listing-desk-policy.mjs';
import {harness} from './helpers.mjs';
import {editListingRows} from '../listing-editor.mjs';
const entry=d=>({id:d.id,fingerprint:hash(listingContent(d))});
const input=ds=>({entries:ds.map(entry),confirmedDetails:true});
function fixture(){return {drafts:[1,2,3,4].map(n=>({...draftInput({kind:'card',title:'Synthetic '+n,subject:'Test',year:'2024',sport:'Baseball',setName:'Test',location:'TEST',condition:'Excellent',conditionNotes:'Front only',description:'Synthetic fixture',askCents:500}),photos:[{id:randomUUID(),role:'front',sha256:'a'.repeat(64),sizeBytes:100,width:180,height:240,filename:'synthetic.jpg',mediaType:'image/jpeg'}]})),inventory:{schemaVersion:1,workspace:'btco-local',mode:'work',revision:0,items:[],sales:[],events:[]}};}
test('only broken fields surface; all-incomplete selection returns a repair queue without staging',()=>{
 const s=fixture();s.drafts[0].year='2001-02';s.drafts[0].condition='VG-EX';
 assert.deepEqual(deskFixFields(s.drafts[0]),['year','condition']);
 const before=structuredClone(s),r=prepareListingSelection(s,input([s.drafts[0]]));assert.equal(r.count,0);assert.equal(r.batchId,null);assert.equal(r.excluded.length,1);assert.deepEqual(s,before);
});
test('inline year and condition corrections preserve stock, originals and ready peers',()=>{
 const s=fixture();s.drafts[0].year='2001-02';s.drafts[0].condition='VG-EX';const ready=prepareListingSelection(s,input(s.drafts));assert.equal(ready.count,3);const stable=structuredClone(s.publicationBatches[0]),photos=structuredClone(s.drafts.map(d=>d.photos));
 editListingRows(s,[{...entry(s.drafts[0]),fields:{year:'2001',condition:'Very good'}}]);assert.deepEqual(deskFixFields(s.drafts[0]),[]);assert.deepEqual(s.publicationBatches[0],stable);assert.deepEqual(s.drafts.map(d=>d.photos),photos);assert.equal(s.inventory.items.length,0);
 const all=prepareListingSelection(s,input(s.drafts));assert.equal(all.count,4);assert.equal(s.publicationBatches.find(b=>b.id===all.batchId).publicationApproved,false);
 for(const fields of [{year:'2001-02'},{year:2001},{title:'x'.repeat(81)},{sku:'new'},{quantity:9}]){const before=structuredClone(s);assert.throws(()=>editListingRows(s,[{...entry(s.drafts[0]),fields}]));assert.deepEqual(s,before);}
});
test('received metadata corrections keep the same Vault item and reject newer Vault details',()=>{
 const s=fixture();approveListings(s,s.drafts.map(entry));receiveDraft(s,s.drafts[0].id);const original=structuredClone(s.inventory.items[0]),photos=structuredClone(s.drafts[0].photos);
 editListingRows(s,[{...entry(s.drafts[0]),fields:{year:'2001',title:'Corrected synthetic title'}}]);
 assert.equal(s.inventory.items[0].year,'2001');assert.equal(s.inventory.items[0].title,'Corrected synthetic title');
 for(const key of ['id','sku','quantity','costCents','source'])assert.deepEqual(s.inventory.items[0][key],original[key]);assert.deepEqual(s.drafts[0].photos,photos);
 s.inventory.items[0].year='2002';const before=structuredClone(s);assert.throws(()=>editListingRows(s,[{...entry(s.drafts[0]),fields:{year:'2003'}}]),/Vault year changed/);assert.deepEqual(s,before);
});
test('selection joins previous batches, keeps omitted cards and excludes incomplete rows without approving publication',()=>{
 const s=fixture();approveListings(s,s.drafts.map(entry));const old=stagePublicationBatch(s,s.drafts.slice(0,2).map(entry)).batchId;
 s.drafts[2].condition='VG-EX';const before=structuredClone(s.drafts),r=prepareListingSelection(s,input([s.drafts[0],s.drafts[2],s.drafts[3]]));
 assert.equal(r.count,2);assert.equal(r.excluded.length,1);assert.equal(r.excluded[0].draftId,s.drafts[2].id);
 const active=s.publicationBatches.filter(b=>b.status!=='cancelled');assert.equal(active.length,2);assert.deepEqual(active.flatMap(b=>b.entries.map(e=>e.draftId)).sort(),[s.drafts[0].id,s.drafts[1].id,s.drafts[3].id].sort());assert.ok(active.every(b=>b.publicationApproved===false&&!b.bridge));
 assert.equal(s.publicationBatches.find(b=>b.id===old).status,'cancelled');assert.deepEqual(s.drafts.map(d=>[d.askCents,d.photos]),before.map(d=>[d.askCents,d.photos]));
 assert.equal(s.drafts[2].condition,'VG-EX');assert.equal(s.inventory.items.length,0);
});
test('an unchanged prepared selection reuses its review; subset changes retire unapproved remote previews',()=>{
 const s=fixture(),first=prepareListingSelection(s,input(s.drafts.slice(0,3))),b=s.publicationBatches[0];b.status='ready';b.bridge={reviewFingerprint:'synthetic',reviews:[]};
 const snapshot=structuredClone(s),again=prepareListingSelection(s,input(s.drafts.slice(0,3)));assert.equal(again.batchId,first.batchId);assert.equal(again.reused,true);assert.deepEqual(s,snapshot);
 const subset=prepareListingSelection(s,input([s.drafts[0]]));assert.notEqual(subset.batchId,first.batchId);assert.equal(s.publicationBatches[0].status,'cancelled');
 assert.equal(s.publicationBatches.find(b=>b.id===subset.batchId).bridge,undefined);assert.equal(s.publicationBatches.filter(b=>b.status!=='cancelled').flatMap(b=>b.entries).length,3);
});
test('stale, duplicate and unconfirmed selections reject atomically; publishing and unavailable stock stay untouched',()=>{
 for(const mode of ['stale','duplicate','unconfirmed','empty','oversized']){const s=fixture(),data=input(s.drafts);if(mode==='stale')data.entries[1].fingerprint='old';if(mode==='duplicate')data.entries.push(data.entries[0]);if(mode==='unconfirmed')data.confirmedDetails=false;if(mode==='empty')data.entries=[];if(mode==='oversized')data.entries=Array(501).fill(data.entries[0]);const before=structuredClone(s);assert.throws(()=>prepareListingSelection(s,data));assert.deepEqual(s,before);}
 const s=fixture();approveListings(s,s.drafts.map(entry));receiveDraft(s,s.drafts[1].id);s.inventory.items[0].status='listed';
 const first=stagePublicationBatch(s,[entry(s.drafts[0])]),b=s.publicationBatches[0];b.status='publishing';b.publicationApproved=true;b.bridge={approvedFingerprint:'old'};
 const locked=structuredClone(b),stock=structuredClone(s.inventory);const r=prepareListingSelection(s,input(s.drafts));assert.equal(r.count,2);assert.equal(r.excluded.length,2);assert.deepEqual(s.publicationBatches.find(b=>b.id===first.batchId),locked);assert.deepEqual(s.inventory.items,stock.items);
});
test('selection API is revision checked and idempotent; it never sends a marketplace approval',async()=>{
 const h=await harness({accessMode:'open'});try{await h.request('/api/session');const s=await h.store.workspace();s.drafts=fixture().drafts;await h.store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(s)]);
 const data=input(s.drafts),operationId='synthetic-selection';assert.equal((await h.request('/api/publication/selection',{method:'POST',auth:false,data})).status,401);
 assert.equal((await h.save('/api/publication/selection',data,{expectedRevision:s.revision+1})).status,409);
 const first=await h.save('/api/publication/selection',data,{operationId});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal((await h.save('/api/publication/selection',data,{operationId})).body.batchId,first.body.batchId);
 const saved=await h.store.workspace();assert.equal(saved.publicationBatches.length,1);assert.equal(saved.publicationBatches[0].publicationApproved,false);
 }finally{await h.close();}
});

test('stale workspace saves use current selected-card fingerprints, preserve unrelated work and replay once',async()=>{
 const h=await harness({accessMode:'open'});try{
  await h.request('/api/session');const s=await h.store.workspace();s.drafts=fixture().drafts;await h.store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(s)]);
  const revision=s.revision,data={entries:s.drafts.slice(0,2).map(d=>({...entry(d),fields:{askCents:700}}))};
  s.revision+=3;s.inventory.revision=s.revision;s.drafts[3].conditionNotes='Background preparation completed';
  await h.store.query('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[s.revision,JSON.stringify(s)]);
  const first=await h.save('/api/listing-rows',data,{expectedRevision:revision,operationId:'stale-rows-replay'});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.revision,s.revision+1);
  const saved=await h.store.workspace();assert.deepEqual(saved.drafts.slice(0,2).map(d=>d.askCents),[700,700]);assert.deepEqual(saved.drafts[3],s.drafts[3]);assert.deepEqual(saved.drafts.map(d=>d.photos),s.drafts.map(d=>d.photos));
  assert.equal((await h.save('/api/listing-rows',data,{expectedRevision:revision,operationId:'stale-rows-replay'})).body.replayed,true);assert.deepEqual(await h.store.workspace(),saved);
  const selected=input(saved.drafts.slice(0,2)),prepared=await h.save('/api/publication/selection',selected,{expectedRevision:revision,operationId:'stale-selection-replay'});assert.equal(prepared.status,200,JSON.stringify(prepared.body));assert.equal(prepared.body.revision,saved.revision+1);
  assert.equal((await h.save('/api/publication/selection',selected,{expectedRevision:revision,operationId:'stale-selection-replay'})).body.replayed,true);
  const final=await h.store.workspace();assert.equal(final.publicationBatches.length,1);assert.equal(final.publicationBatches[0].publicationApproved,false);assert.deepEqual(final.drafts[3],s.drafts[3]);
 }finally{await h.close();}
});
test('stale selected content and current stock locks still reject every row atomically; other endpoints stay revision checked',async()=>{
 for(const mode of ['content','hold','vault-price','publishing','preparing']){
  const h=await harness({accessMode:'open'});try{
   await h.request('/api/session');const s=await h.store.workspace();s.drafts=fixture().drafts;approveListings(s,s.drafts.map(entry));receiveDraft(s,s.drafts[1].id);
   const revision=s.revision,data={entries:s.drafts.slice(0,2).map(d=>({...entry(d),fields:{askCents:700}}))},selection=input(s.drafts.slice(0,2));
   if(mode==='content')s.drafts[1].conditionNotes='Saved on another device';
   if(mode==='hold')s.inventory.items[0].status='hold';
   if(mode==='vault-price')s.inventory.items[0].askCents=1200;
   if(mode==='publishing'){stagePublicationBatch(s,[entry(s.drafts[1])]);s.publicationBatches[0].publicationApproved=true;s.publicationBatches[0].status='publishing';}
   if(mode==='preparing')s.drafts[1].preparation={status:'running'};
   s.revision++;s.inventory.revision=s.revision;await h.store.query('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[s.revision,JSON.stringify(s)]);
   const rejected=await h.save('/api/listing-rows',data,{expectedRevision:revision});assert.equal(rejected.status,409,mode);assert.deepEqual(await h.store.workspace(),s);
   if(mode==='content'){assert.match(rejected.body.error,/Synthetic 2/);assert.equal((await h.save('/api/publication/selection',selection,{expectedRevision:revision})).status,409);assert.deepEqual(await h.store.workspace(),s);}
   assert.equal((await h.save('/api/drafts/'+s.drafts[0].id,{askCents:900},{expectedRevision:revision})).status,409);assert.deepEqual(await h.store.workspace(),s);
  }finally{await h.close();}
 }
});
test('concurrent disjoint card edits both save; competing edits to the same card have one winner',async()=>{
 const h=await harness({accessMode:'open'});try{
  await h.request('/api/session');const s=await h.store.workspace();s.drafts=fixture().drafts;await h.store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(s)]);
  const request=(d,askCents,revision)=>h.request('/api/listing-rows',{method:'POST',data:{expectedRevision:revision,operationId:randomUUID(),data:{entries:[{...entry(d),fields:{askCents}}]}}});
  const disjoint=await Promise.all([request(s.drafts[0],700,s.revision),request(s.drafts[1],900,s.revision)]);assert.deepEqual(disjoint.map(r=>r.status),[200,200]);
  const next=await h.store.workspace();assert.equal(next.revision,s.revision+2);assert.deepEqual(next.drafts.slice(0,2).map(d=>d.askCents),[700,900]);
  const competing=await Promise.all([request(next.drafts[0],800,next.revision),request(next.drafts[0],1000,next.revision)]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  const final=await h.store.workspace();assert.equal(final.revision,next.revision+1);assert.ok([800,1000].includes(final.drafts[0].askCents));assert.equal(final.drafts[1].askCents,900);
 }finally{await h.close();}
});
