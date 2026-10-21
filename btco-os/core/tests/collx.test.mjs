import test from 'node:test';
import assert from 'node:assert/strict';
import {draftInput,receiveDraft,validateWorkspace,saveSale} from '../domain.mjs';
import {collxRows,saveCollxPrice,saveCollxObservation,collxCSV,validateChannelRecords} from '../collx.mjs';
import {emptyState} from '../../web/domain/core.mjs';
import {harness} from './helpers.mjs';
import {randomUUID} from 'node:crypto';
const fixture=()=>({schemaVersion:1,revision:0,drafts:[1,2].map(n=>({...draftInput({kind:'card',title:'Synthetic '+n,location:'TEST',subject:'Test',setName:'Test',askCents:500,conditionNotes:'Synthetic condition.',identityReviewed:true,conditionReviewed:true}),photos:[{id:randomUUID(),role:'front',sha256:'a'.repeat(64),sizeBytes:100,width:180,height:240,filename:'synthetic.jpg',mediaType:'image/jpeg'}]})),inventory:emptyState()});
const edit=(s,n=0)=>{const r=collxRows(s)[n];return {key:r.key,fingerprint:r.fingerprint};};
const observe=(s,extra={},n=0)=>saveCollxObservation(s,{...edit(s,n),externalId:'TEST-LISTING',url:'https://share.collx.app/card/test-listing',status:'active',priceCents:99,checked:true,...extra});
test('CollX cents and unknowns stay independent of Core/eBay, identity review, photos and stock',()=>{
 const s=fixture(),before=structuredClone(s.drafts);assert.equal(collxRows(s)[0].priceCents,null);
 saveCollxPrice(s,{...edit(s),priceCents:99});assert.equal(collxRows(s)[0].priceCents,99);assert.equal(collxRows(s)[0].askCents,500);assert.deepEqual(s.drafts,before);assert.equal(s.inventory.items.length,0);
 saveCollxPrice(s,{...edit(s,1),priceCents:149});assert.equal(collxRows(s)[1].priceCents,149);
 s.drafts[0].parallel='Blue';assert.equal(collxRows(s)[0].priceNeedsReview,true);saveCollxPrice(s,{...edit(s),priceCents:99});assert.equal(collxRows(s)[0].priceNeedsReview,false);
 observe(s);saveCollxPrice(s,{...edit(s),priceCents:149});assert.equal(collxRows(s)[0].observation.priceCents,99);assert.match(collxRows(s)[0].issues.join(' '),/differs/);
 const restored=JSON.parse(JSON.stringify(s));validateWorkspace(restored);assert.deepEqual(collxRows(restored),collxRows(s));
 saveCollxPrice(s,{...edit(s),priceCents:null});assert.equal(collxRows(s)[0].priceCents,null);assert.equal(collxRows(s)[0].observation.priceCents,99);
});
test('observed listings reject stale saves, duplicates and hostile URLs without mutation',()=>{
 const s=fixture(),old=edit(s);observe(s);for(const data of [{...old,priceCents:99},{...edit(s),priceCents:-1},{...edit(s),priceCents:1.99}]){const before=JSON.stringify(s);assert.throws(()=>saveCollxPrice(s,data));assert.equal(JSON.stringify(s),before);}
 for(const extra of [{url:'https://share.collx.app.evil.test/a'},{url:'javascript:alert(1)'},{url:'https://secret@share.collx.app/card/a'},{url:'https://share.collx.app:8000/card/a'},{checked:false},{externalId:'DIFFERENT'},{priceCents:0}]){const before=JSON.stringify(s);assert.throws(()=>observe(s,extra));assert.equal(JSON.stringify(s),before);}
 assert.throws(()=>observe(s,{},1),/already linked/);assert.throws(()=>observe(s,{externalId:'OTHER'},1),/already linked/);
 observe(s,{url:'https://share.collx.app/card/test-listing?rc=1#tracking'});assert.equal(collxRows(s)[0].observation.url,'https://share.collx.app/card/test-listing');
 const bad=structuredClone(s);bad.channelRecords[0].observation.source='api';assert.throws(()=>validateChannelRecords(bad));
});
test('receiving a card keeps its channel mapping; observations never infer sales or delist',()=>{
 const s=fixture();saveCollxPrice(s,{...edit(s),priceCents:99});observe(s);const key=collxRows(s)[0].key;
 receiveDraft(s,s.drafts[0].id);validateWorkspace(s);assert.equal(collxRows(s).length,2);assert.equal(collxRows(s)[0].key,key);assert.equal(collxRows(s)[0].available,1);assert.equal(collxRows(s)[0].priceCents,99);
 observe(s,{status:'sold'});assert.equal(s.inventory.sales.length,0);assert.equal(collxRows(s)[0].available,1);assert.match(collxRows(s)[0].issues.join(' '),/Reconcile/);
 observe(s);saveSale(s,{itemId:s.inventory.items[0].id,quantity:1,date:'2026-10-20',channel:'eBay',reference:'TEST-SALE',notes:'',revenueCents:500,shippingCollectedCents:0,sellingFeeCents:0,promoFeeCents:0,postageCents:0,suppliesCents:0,refundCents:0});
 assert.equal(collxRows(s)[0].available,0);assert.equal(collxRows(s)[0].observation.status,'active');assert.match(collxRows(s)[0].issues.join(' '),/end or adjust/);
 s.inventory.items[0].kind='other';validateWorkspace(s);assert.equal(collxRows(s)[0].priceCents,99);assert.match(collxRows(s)[0].issues.join(' '),/type changed/);
});
test('CSV preserves exact prices and labels observations without spreadsheet formulas',()=>{
 const s=fixture();s.drafts[0].title='=SYNTHETIC()';saveCollxPrice(s,{...edit(s),priceCents:99});observe(s,{priceCents:149});const csv=collxCSV(s);assert.match(csv,/CollX target price USD/);assert.match(csv,/'=SYNTHETIC/);assert.match(csv,/"0.99"/);assert.match(csv,/"1.49"/);assert.match(csv,/"owner"/);assert.match(csv,/"untracked"/);
});
test('CollX API enforces authentication, revisions, idempotency and honest capability',async()=>{
 const h=await harness({accessMode:'open'});try{
  await h.request('/api/session');const d=await h.save('/api/drafts',{kind:'card',title:'Synthetic API',askCents:500});let w=(await h.request('/api/workspace')).body;
  assert.equal(w.collx.capabilities.publishing,false);assert.equal(w.collx.capabilities.salesSync,false);assert.equal(w.collx.rows[0].priceCents,null);
  const data={key:'draft:'+d.body.draftId,fingerprint:w.collx.rows[0].fingerprint,priceCents:99},operationId='collx-test-operation';
  assert.equal((await h.request('/api/collx/price',{method:'POST',auth:false,data})).status,401);
  assert.equal((await h.request('/api/collx/price',{method:'POST',data,headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await h.save('/api/collx/price',data,{operationId})).status,200);assert.equal((await h.save('/api/collx/price',data,{operationId})).body.replayed,true);
  assert.equal((await h.save('/api/collx/price',data)).status,409);
  w=(await h.request('/api/workspace')).body;assert.equal(w.state.drafts[0].askCents,500);assert.equal(w.collx.rows[0].priceCents,99);assert.equal(w.state.inventory.events.filter(e=>e.action==='core.collx-price-saved').length,1);
  assert.equal((await h.request('/api/export/collx.csv',{auth:false})).status,401);const backup=await h.request('/api/backup');assert.match(backup.text,/channelRecords/);assert.match(backup.text,/"priceCents":99/);
 }finally{await h.close();}
});
