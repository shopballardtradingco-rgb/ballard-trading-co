import test from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {draftInput,hash} from '../domain.mjs';
import {listingContent} from '../public/preparation-policy.mjs';
import {approveListings} from '../preparation.mjs';
import {stagePublicationBatch,publicationBatches,cancelPublicationBatch,startListingFlow} from '../publication.mjs';
import {harness} from './helpers.mjs';
const entry=d=>({id:d.id,fingerprint:hash(listingContent(d))});
const flowEntries=s=>s.drafts.map(d=>({...entry(d),askCents:700}));
test('unified listing flow confirms prices and stages once, without approving publication',()=>{
 const s=fixture();for(const d of s.drafts){d.preparation={status:'complete'};delete d.priceReview;d.identityReviewed=false;}
 const originalPhotos=JSON.stringify(s.drafts.map(d=>d.photos));
 const r=startListingFlow(s,{entries:flowEntries(s),confirmedDetails:true});
 assert.equal(s.publicationBatches.length,1);assert.equal(r.count,2);assert.equal(s.publicationBatches[0].publicationApproved,false);assert.equal(s.publicationBatches[0].status,'staged');assert.ok(s.drafts.every(d=>d.askCents===700&&d.priceReview.source==='owner'));assert.equal(JSON.stringify(s.drafts.map(d=>d.photos)),originalPhotos);
 assert.throws(()=>startListingFlow(s,{entries:flowEntries(s),confirmedDetails:true}),/already/);assert.equal(s.publicationBatches.length,1);
});
test('unified flow rejects missing review, stale data, missing details and invalid prices atomically',()=>{
 for(const mode of ['unconfirmed','stale','missing','price']){
  const s=fixture();if(mode==='missing')s.drafts[1].condition='';const entries=flowEntries(s);if(mode==='stale')entries[1].fingerprint='old';if(mode==='price')entries[1].askCents=0;const before=structuredClone(s);
  assert.throws(()=>startListingFlow(s,{entries,confirmedDetails:mode!=='unconfirmed'}));assert.deepEqual(s,before);
 }
});
function fixture(){const state={drafts:[1,2].map(n=>({...draftInput({kind:'card',title:`Synthetic ${n}`,subject:'Test',setName:'Test',location:'TEST',description:'Front pictured.',conditionNotes:'Reverse unassessed.',condition:'Good',askCents:1599}),photos:[{id:randomUUID(),role:'front',sha256:'a'.repeat(64),sizeBytes:100,width:180,height:240,filename:'synthetic.jpg',mediaType:'image/jpeg'}]})),inventory:{items:[],events:[]}};approveListings(state,state.drafts.map(entry));return state;}
test('staging preserves original data, survives serialization and never approves publication',()=>{
 const s=fixture(),before=JSON.stringify(s.drafts),r=stagePublicationBatch(s,s.drafts.map(entry));
 assert.equal(r.count,2);assert.equal(JSON.stringify(s.drafts),before);assert.equal(s.inventory.items.length,0);
 const restored=JSON.parse(JSON.stringify(s)),b=publicationBatches(restored)[0];assert.equal(b.publicationApproved,false);assert.equal(b.status,'staged');assert.ok(b.entries.every(e=>!e.changed&&e.askCents===1600));
 assert.throws(()=>stagePublicationBatch(restored,restored.drafts.map(entry)),/already/);
 restored.drafts[0].description='Changed';assert.equal(publicationBatches(restored)[0].entries[0].changed,true);assert.equal(b.entries[0].description,'Front pictured.');
 cancelPublicationBatch(restored,r.batchId);assert.equal(restored.publicationBatches[0].status,'cancelled');
});
test('invalid, stale and duplicate batches fail atomically; cancellation releases cards',()=>{
 for(const mode of ['stale','unapproved','title','sku']){const s=fixture();if(mode==='unapproved')s.drafts[1].identityReviewed=false;if(mode==='title'){s.drafts[1].title='x'.repeat(81);approveListings(s,s.drafts.map(entry));}if(mode==='sku'){s.drafts[1].sku=s.drafts[0].sku;approveListings(s,s.drafts.map(entry));}const entries=s.drafts.map(entry);if(mode==='stale')entries[1].fingerprint='bad';const before=JSON.stringify(s);assert.throws(()=>stagePublicationBatch(s,entries));assert.equal(JSON.stringify(s),before);}
 const s=fixture(),entries=s.drafts.map(entry);for(const bad of [[],[null],[entries[0],entries[0]],Array(501).fill(entries[0])])assert.throws(()=>stagePublicationBatch(s,bad));
 const first=stagePublicationBatch(s,entries);cancelPublicationBatch(s,first.batchId);assert.notEqual(stagePublicationBatch(s,entries).batchId,first.batchId);
});
test('publication API has session protection, operation replay and honest capability',async()=>{
 const h=await harness({accessMode:'open'});try{await h.request('/api/session');const s=fixture();await h.store.transaction(async q=>{const row=(await q('SELECT body FROM core_workspace WHERE id=1'))[0],state=JSON.parse(row.body);state.drafts=s.drafts;await q('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);});
 const data={entries:s.drafts.map(entry)},operationId='synthetic-publication-1';const first=await h.save('/api/publication/batches',data,{operationId});assert.equal(first.status,200);const replay=await h.save('/api/publication/batches',data,{operationId});assert.equal(replay.body.batchId,first.body.batchId);assert.equal(replay.body.replayed,true);
 const w=(await h.request('/api/workspace')).body;assert.equal(w.publication.enabled,false);assert.equal(w.capabilities.marketplacePublishing,false);assert.equal(w.publication.batches.length,1);
 assert.equal((await h.request('/api/publication/batches',{method:'POST',auth:false,data})).status,401);
 assert.equal((await h.save('/api/publication/cancel',{id:first.body.batchId})).status,200);
 }finally{await h.close();}
});

test('unified listing API replays safely and rejects stale revisions without creating duplicate groups',async()=>{
 const h=await harness({accessMode:'open'});try{
  await h.request('/api/session');const s=fixture(),state=await h.store.workspace();state.drafts=s.drafts;await h.store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);
  const data={entries:flowEntries(s),confirmedDetails:true},operationId='synthetic-flow-1';
  assert.equal((await h.save('/api/publication/start',data,{expectedRevision:state.revision+1})).status,409);
  const first=await h.save('/api/publication/start',data,{operationId});assert.equal(first.status,200);
  const replay=await h.save('/api/publication/start',data,{operationId});assert.equal(replay.body.replayed,true);assert.equal(replay.body.batchId,first.body.batchId);
  assert.equal((await h.request('/api/publication/start',{method:'POST',auth:false,data})).status,401);
  const saved=(await h.request('/api/workspace')).body.state;assert.equal(saved.publicationBatches.length,1);assert.equal(saved.publicationBatches[0].publicationApproved,false);
 }finally{await h.close();}
});

