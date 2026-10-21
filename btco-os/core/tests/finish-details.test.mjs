import test from 'node:test';
import assert from 'node:assert/strict';
import {draftInput,hash} from '../domain.mjs';
import {listingContent} from '../public/preparation-policy.mjs';
import {updateListingDetails,approveListings,isListingApproved} from '../preparation.mjs';
import {harness} from './helpers.mjs';
const card=()=>({...draftInput({kind:'card',photoPolicy:'value-based',title:'Synthetic',subject:'Test',setName:'Synthetic Set',location:'TEST',description:'Synthetic description',conditionNotes:'Front pictured; reverse unassessed.'}),photos:[{id:'test-front',role:'front',sha256:'synthetic'}]});
const entry=(d,changes={askCents:499,condition:'Excellent'})=>({id:d.id,fingerprint:hash(listingContent(d)),changes});
const fixture=()=>({drafts:[card(),card()],inventory:{items:[],events:[]}});
test('bulk details round prices, preserve originals and selectability without approving',()=>{
 const state=fixture(),photos=JSON.stringify(state.drafts.map(d=>d.photos));
 assert.deepEqual(updateListingDetails(state,state.drafts.map(d=>entry(d))),{updated:2});
 assert.ok(state.drafts.every(d=>d.askCents===500&&d.condition==='Excellent'&&!isListingApproved(d)));
 assert.equal(JSON.stringify(state.drafts.map(d=>d.photos)),photos);assert.equal(state.inventory.items.length,0);
 assert.deepEqual(approveListings(state,state.drafts.map(d=>({id:d.id,fingerprint:hash(listingContent(d))}))),{approved:2});
 assert.ok(state.drafts.every(isListingApproved));
});
test('invalid rows and stale cards fail before changing any draft or event',()=>{
 for(const change of [e=>e.fingerprint='stale',e=>e.changes={askCents:0},e=>e.changes={askCents:49},e=>e.changes={askCents:'500'},e=>e.changes={condition:''},e=>e.changes={condition:'x'.repeat(4001)},e=>e.changes={identityReviewed:true},e=>e.changes={},e=>e.changes=null]){
  const state=fixture(),entries=state.drafts.map(d=>entry(d)),before=JSON.stringify(state);change(entries[1]);assert.throws(()=>updateListingDetails(state,entries));assert.equal(JSON.stringify(state),before);
 }
 for(const entries of [[],[null],Array.from({length:501},()=>entry(card()))])assert.throws(()=>updateListingDetails(fixture(),entries));
 const state=fixture(),e=entry(state.drafts[0]);assert.throws(()=>updateListingDetails(state,[e,e]));
});
test('approved, received and preparing cards cannot be changed by bulk completion',()=>{
 for(const type of ['approved','received','queued','running']){
  const state=fixture();if(type==='approved'){updateListingDetails(state,[entry(state.drafts[0])]);approveListings(state,[{id:state.drafts[0].id,fingerprint:hash(listingContent(state.drafts[0]))}]);}else if(type==='received')state.drafts[0].status='received';else state.drafts[0].preparation={status:type};
  const before=JSON.stringify(state);assert.throws(()=>updateListingDetails(state,[entry(state.drafts[0])]));assert.equal(JSON.stringify(state),before);
 }
});
test('details API requires session and current content and keeps approval separate',async()=>{
 const h=await harness({accessMode:'open'});try{
  await h.request('/api/session');const saved=await h.save('/api/drafts',{kind:'card',title:'Synthetic',location:'TEST'});assert.equal(saved.status,200);
  let w=(await h.request('/api/workspace')).body.state,d=w.drafts[0];
  const changes=entry(d);assert.equal((await h.save('/api/preparation/details',{entries:[changes]})).status,200);
  w=(await h.request('/api/workspace')).body.state;assert.equal(w.drafts[0].askCents,500);assert.equal(w.drafts[0].condition,'Excellent');assert.equal(w.drafts[0].listingReview,undefined);
  assert.equal((await h.save('/api/preparation/details',{entries:[changes]})).status,409);
  assert.notEqual((await h.request('/api/preparation/details',{method:'POST',auth:false,data:{entries:[changes]}})).status,200);
 }finally{await h.close();}
});

