import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {draftInput,hash,receiveDraft} from '../domain.mjs';
import {approveListings} from '../preparation.mjs';
import {listingContent,listingFields} from '../public/preparation-policy.mjs';
import {shippingRoute,conditionChoices,checkedCondition,sharedConditionChoices,PWE_LABEL_BASELINE_CENTS} from '../public/listing-controls.mjs';
import {checkedParcel,shippingChoices,checkedShippingCost} from '../public/ebay-settings.mjs';
import {envelope,envelopeParcel,policies} from './fixtures/ebay-policies.mjs';
import {stagePublicationBatch,publicationBatches} from '../publication.mjs';
import {editListingRows} from '../listing-editor.mjs';
import {harness} from './helpers.mjs';
const entry=(d,fields)=>({id:d.id,fingerprint:hash(listingContent(d)),fields});
function fixture(){const s={drafts:[1,2].map(n=>({...draftInput({kind:'card',title:'Synthetic '+n,subject:'Test',setName:'Test',location:'TEST',description:'Test original',conditionNotes:'Front reviewed',condition:'Excellent',askCents:2000}),photos:[{id:randomUUID(),role:'front',sha256:'a'.repeat(64),sizeBytes:100,width:180,height:240,filename:'synthetic.jpg',mediaType:'image/jpeg'}]})),inventory:{schemaVersion:1,workspace:'btco-local',mode:'work',revision:0,items:[],sales:[],events:[]}};approveListings(s,s.drafts.map(d=>entry(d)));return s;}
test('PWE eligibility and condition choices are conservative; old fingerprints remain identical',()=>{
 const d=fixture().drafts[0];assert.equal(shippingRoute(d),'raw');assert.equal(shippingRoute({...d,askCents:2100}),'high');
 for(const patch of [{kind:'comic'},{askCents:null},{shippingMode:'review'}])assert.equal(shippingRoute({...d,...patch}),'review');
 assert.equal(shippingRoute({...d,gradeCompany:'PSA'}),'graded');assert.equal(shippingRoute({...d,title:'Synthetic 3 card lot'}),'lot');assert.equal(shippingRoute({...d,shippingMode:'parcel'}),'parcel');assert.equal(PWE_LABEL_BASELINE_CENTS,78);
 assert.equal(listingContent(d),JSON.stringify({sku:d.sku,fields:listingFields.map(k=>[k,d[k]??null]),photos:d.photos.map(p=>[p.id,p.role,p.sha256])}));
 assert.notEqual(listingContent({...d,shippingMode:'parcel'}),listingContent(d));
 assert.throws(()=>checkedShippingCost(null,'lot'),/cost estimate/);assert.equal(checkedShippingCost({estimatedLabelCents:550,confirmed:true},'lot').estimatedLabelCents,550);assert.equal(checkedShippingCost(null,'raw'),null);
 assert.equal(conditionChoices({...d,condition:'NM'}).value,'Near mint or better');for(const legacy of ['5','VG-EX','Near Mint-Mint','Legacy assessment']){const choice=conditionChoices({...d,condition:legacy});assert.equal(choice.value,'');assert.equal(choice.legacy,legacy);assert.ok(!choice.values.includes(legacy));assert.throws(()=>checkedCondition(d,legacy),/eBay condition/);}
 assert.deepEqual(sharedConditionChoices([d,{...d,gradeCompany:'PSA'}]),[]);assert.equal(checkedCondition(d,'Very good'),'Very good');assert.equal(checkedCondition({...d,kind:'comic'},'Good'),'Good');assert.throws(()=>checkedCondition({...d,gradeCompany:'PSA'},'Excellent'),/eBay condition/);
 for(const key of ['lot','review','parcel','graded','high']){assert.throws(()=>checkedParcel(envelope,envelopeParcel,key),/parcel policy/);assert.ok(shippingChoices(policies,key).every(p=>p.fulfillmentPolicyId!=='11'));}
});
test('inline edits keep staged batch identity and approvals but never approve publication',()=>{
 const s=fixture(),id=stagePublicationBatch(s,s.drafts.map(d=>entry(d))).batchId,originals=structuredClone(s.drafts.map(d=>d.photos));s.channelRecords={synthetic:'untouched'};
 const r=editListingRows(s,[entry(s.drafts[0],{askCents:2100,condition:'Very good',shippingMode:'auto'})]);
 assert.deepEqual(r.batchReplacements,{});assert.equal(s.publicationBatches.length,1);assert.equal(s.publicationBatches[0].id,id);assert.equal(s.publicationBatches[0].publicationApproved,false);assert.ok(publicationBatches(s)[0].entries.every(e=>!e.changed));assert.equal(s.publicationBatches[0].entries[0].askCents,2100);assert.deepEqual(s.drafts.map(d=>d.photos),originals);assert.deepEqual(s.channelRecords,{synthetic:'untouched'});
});
test('unapproved remote preview is retired and replaced, never reused or approved',()=>{
 const s=fixture(),id=stagePublicationBatch(s,s.drafts.map(d=>entry(d))).batchId;s.publicationBatches[0].bridge={reviews:[],groups:[{id:'old-remote'}]};s.publicationBatches[0].status='ready';
 const r=editListingRows(s,[entry(s.drafts[0],{condition:'Poor'})]),b=s.publicationBatches[1];assert.equal(r.batchReplacements[id],b.id);assert.notEqual(id,b.id);assert.equal(s.publicationBatches[0].status,'cancelled');assert.equal(b.status,'staged');assert.equal(b.bridge,undefined);assert.equal(b.publicationApproved,false);assert.equal(b.entries.length,2);
});
test('stale, malformed, active preparation and publishing edits fail atomically',()=>{
 for(const mode of ['stale','bad-price','bad-field','bad-shipping','bad-condition','preparing','approved','publishing','published']){
  const s=fixture();stagePublicationBatch(s,s.drafts.map(d=>entry(d)));
  if(mode==='preparing')s.drafts[1].preparation={status:'running'};
  if(mode==='approved')s.publicationBatches[0].publicationApproved=true;
  if(['publishing','published'].includes(mode))s.publicationBatches[0].status=mode;
  const entries=s.drafts.map(d=>entry(d,{askCents:700}));
  if(mode==='stale')entries[1].fingerprint='stale';if(mode==='bad-price')entries[1].fields.askCents=0;if(mode==='bad-field')entries[1].fields.sku='changed';if(mode==='bad-shipping')entries[1].fields.shippingMode='free';if(mode==='bad-condition')entries[1].fields.condition='VG-EX';
  const before=structuredClone(s);assert.throws(()=>editListingRows(s,entries));assert.deepEqual(s,before);
 }
});
test('received quick edits preserve quantities, originals and cost; listed, sold and held stock are locked',()=>{
 const s=fixture(),d=s.drafts[0];receiveDraft(s,d.id);const item=s.inventory.items[0],before=structuredClone(item);
 editListingRows(s,[entry(d,{askCents:900,condition:'Very good'})]);assert.equal(s.inventory.items[0].askCents,900);for(const k of ['quantity','costCents','sku','source'])assert.deepEqual(s.inventory.items[0][k],before[k]);assert.equal(s.drafts[0].status,'received');
 for(const status of ['listed','hold']){s.inventory.items[0].status=status;const before=structuredClone(s);assert.throws(()=>editListingRows(s,[entry(s.drafts[0],{askCents:800})]),/listed, sold, on hold/);assert.deepEqual(s,before);}
});
test('quick-edit API enforces auth, revision and idempotency',async()=>{
 const h=await harness({accessMode:'open'});try{await h.request('/api/session');const state=await h.store.workspace();state.drafts=fixture().drafts;await h.store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);
 const data={entries:[entry(state.drafts[0],{askCents:2100})]},operationId='synthetic-row-edit';
 assert.equal((await h.request('/api/listing-rows',{method:'POST',auth:false,data})).status,401);
 assert.equal((await h.save('/api/listing-rows',data,{expectedRevision:state.revision+1})).status,409);
 const first=await h.save('/api/listing-rows',data,{operationId});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal((await h.save('/api/listing-rows',data,{operationId})).body.replayed,true);
 }finally{await h.close();}
});
