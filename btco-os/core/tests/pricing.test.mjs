import test from 'node:test';
import assert from 'node:assert/strict';
import {roundAskingCents} from '../public/pricing.mjs';
import {draftInput,itemInput,hash} from '../domain.mjs';
import {listingContent,listingProblems} from '../public/preparation-policy.mjs';
import {approveListings,isListingApproved,needsPreparation} from '../preparation.mjs';
import {cdpCSV} from '../cdp.mjs';

test('asking prices round to nearest whole dollar, with half dollars up and unknowns preserved',()=>{
 for(const [input,expected] of [[599,600],[799,800],[549,500],[550,600],[600,600],[49,0],[0,0],[null,null],[undefined,undefined]])assert.equal(roundAskingCents(input),expected);
 for(const invalid of [-1,'599',599.5,NaN])assert.ok(Object.is(roundAskingCents(invalid),invalid));
 for(const kind of ['card','comic','other']){
  const item=itemInput({kind,title:'Synthetic',askCents:799,costCents:275});assert.equal(item.askCents,800);assert.equal(item.costCents,275);
  const draft=draftInput({kind,askCents:599,costCents:275});assert.equal(draft.askCents,600);assert.equal(draft.costCents,275);
 }
 assert.throws(()=>draftInput({kind:'card',askCents:599.5}));assert.throws(()=>draftInput({kind:'card',askCents:'599'}));
});

function legacyCard(){
 const d=draftInput({kind:'card',title:'Synthetic card',subject:'Test Player',setName:'Test Set',location:'TEST-01',askCents:600,costCents:275,description:'Synthetic description',condition:'Good',conditionNotes:'Both sides visible.'});
 d.askCents=599;d.photos=[{id:'front',role:'front',sha256:'a'.repeat(64)},{id:'back',role:'back',sha256:'b'.repeat(64)}];
 d.preparation={status:'complete',applied:{askCents:599},outputFingerprint:hash(listingContent(d))};return d;
}

test('bulk approval persists the displayed whole-dollar ask and keeps preparation tracking and exact cost',()=>{
 const d=legacyCard(),state={drafts:[d],inventory:{items:[],events:[]}},content=listingContent(d);
 assert.deepEqual(approveListings(state,[{id:d.id,content}]),{approved:1});assert.equal(d.askCents,600);assert.equal(d.costCents,275);
 assert.equal(d.preparation.applied.askCents,600);assert.equal(needsPreparation(d),false);assert.equal(isListingApproved(d),true);
 const row=cdpCSV([d],'https://example.test').split('\r\n')[1];assert.match(row,/"1","6.00","2.75"/);
 assert.equal(state.inventory.items.length,0);assert.equal(d.photos.length,2);
 d.askCents=800;assert.equal(isListingApproved(d),false);
});

test('previously approved fractional asks export at whole dollars without changing history or photo links',()=>{
 const d=legacyCard();d.identityReviewed=true;d.conditionReviewed=true;d.listingReview={fingerprint:hash(listingContent(d)),photoToken:'c'.repeat(48)};
 const before=JSON.stringify(d),csv=cdpCSV([d],'https://example.test');assert.match(csv,/"1","6.00","2.75"/);assert.equal(JSON.stringify(d),before);
 assert.match(csv,new RegExp('/media/cdp/front/'+d.listingReview.photoToken));
});

test('rounding still rejects free prices but backs are optional above the old cutoff',()=>{
 const d=legacyCard();d.photos=d.photos.slice(0,1);d.photoPolicy='value-based';d.cardClass='standard';
 assert.ok(!listingProblems(d).includes('Add back photo'));d.askCents=49;assert.ok(listingProblems(d).includes('Price needed'));
});
