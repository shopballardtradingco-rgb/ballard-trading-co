import test from 'node:test';
import assert from 'node:assert/strict';
import {approveListings,isListingApproved} from '../preparation.mjs';
import {listingContent,listingProblems} from '../public/preparation-policy.mjs';
import {cdpCSV} from '../cdp.mjs';
import {hash} from '../domain.mjs';

function fixture(count=3){return {drafts:Array.from({length:count},(_,i)=>({id:`card-${i}`,sku:`CORE-${i}`,kind:'card',status:'draft',title:`Synthetic card ${i}`,subject:'Test Player',setName:'Test Set',location:'TEST-BOX',askCents:400,condition:'Good',conditionNotes:'Visible front checked; reverse unassessed.',description:'Synthetic '.repeat(500),photoPolicy:'value-based',cardClass:'standard',singlePhotoMaxCents:500,photos:[{id:`photo-${i}`,role:'front',sha256:'synthetic'}]})),inventory:{items:[],events:[]}};}
const entries=state=>state.drafts.map(d=>({id:d.id,fingerprint:hash(listingContent(d))}));

test('500 cards approve in one compact request without changing inventory or originals',()=>{
 const state=fixture(500),input=entries(state),photos=JSON.stringify(state.drafts.map(d=>d.photos));
 assert.ok(Buffer.byteLength(JSON.stringify({data:{entries:input}}))<100_000);
 assert.deepEqual(approveListings(state,input),{approved:500});assert.ok(state.drafts.every(isListingApproved));
 assert.equal(JSON.stringify(state.drafts.map(d=>d.photos)),photos);assert.equal(state.inventory.items.length,0);
});

test('a stale title, price or photo rejects the whole batch before any card is approved',()=>{
 for(const change of [d=>d.title='Changed title',d=>d.askCents=300,d=>d.photos[0].sha256='replaced']){
  const state=fixture(),input=entries(state);change(state.drafts[1]);
  assert.throws(()=>approveListings(state,input),/changed/);assert.ok(state.drafts.every(d=>!d.listingReview));assert.equal(state.inventory.events.length,0);
 }
});

test('missing fronts and active preparation cannot be approved even with a matching fingerprint',()=>{
 for(const change of [d=>{d.photos=[];},d=>{d.preparation={status:'queued'};}]){
  const state=fixture();change(state.drafts[1]);assert.throws(()=>approveListings(state,entries(state)));assert.ok(state.drafts.every(d=>!d.listingReview));
 }
});

test('one-photo premium cards approve and export while missing fronts and details stay queued',()=>{
 const state=fixture(5);
 Object.assign(state.drafts[0],{cardClass:'premium',parallel:'Refractor',askCents:100000});
 Object.assign(state.drafts[1],{cardClass:'unknown',parallel:'Base'});
 state.drafts[2].photos=[];state.drafts[3].askCents=null;state.drafts[4].condition='';
 const originals=JSON.stringify(state.drafts.map(d=>d.photos));
 const ready=state.drafts.filter(d=>!listingProblems(d).length);
 assert.equal(ready.length,2);
 assert.deepEqual(approveListings(state,entries({drafts:ready})),{approved:2});
 assert.deepEqual(state.drafts.map(isListingApproved),[true,true,false,false,false]);
 const csv=cdpCSV(ready,'https://example.test');
 assert.match(csv,/Synthetic card 0/);assert.match(csv,/Synthetic card 1/);assert.doesNotMatch(csv,/Synthetic card [234]/);
 assert.equal(JSON.stringify(state.drafts.map(d=>d.photos)),originals);assert.equal(state.inventory.items.length,0);
});

test('completed approvals are revoked by edits and empty/duplicate/oversized selections fail',()=>{
 const state=fixture();approveListings(state,entries(state));state.drafts[0].askCents=300;assert.equal(isListingApproved(state.drafts[0]),false);
 for(const input of [[],[entries(state)[0],entries(state)[0]],entries(fixture(501))])assert.throws(()=>approveListings(state,input),/Select cards/);
});
