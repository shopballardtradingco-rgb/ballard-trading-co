import test from 'node:test';
import assert from 'node:assert/strict';
import {draftInput,hash,receiveDraft,reviewReceivedPrice} from '../domain.mjs';
import {priceNeedsReview} from '../public/price-review.mjs';
import {listingContent,listingProblems} from '../public/preparation-policy.mjs';
import {approveListings,isListingApproved,updateListingDetails} from '../preparation.mjs';
import {stagePublicationBatch} from '../publication.mjs';
import {checkSoldComparisons} from '../price-evidence.mjs';
import {normalizeAssessment} from '../ai-provider.mjs';
import {emptyState} from '../../web/domain/core.mjs';
const assessment={title:'Synthetic Purple Auto',subject:'Synthetic Player',year:'2026',setName:'Synthetic Chrome',number:'RA-TEST',parallel:'Purple',serial:'168/250',gradeCompany:'',grade:'',cert:'',team:'Test',sport:'Baseball',condition:'Excellent',conditionNotes:'Front only.',description:'Synthetic card.',priceReason:'Synthetic only.',identityNotes:'Synthetic only.',autograph:true,rookie:true,memorabilia:false,confidence:'high',cardClass:'premium',askCents:15000,priceBasis:'sold',warnings:[],sources:[]};
const url='https://example.test/sale/1',now=Date.parse('2026-10-20T17:00:00Z');
const comp=()=>({url,title:'Synthetic completed sale',soldDate:'2026-10-01',priceCents:2000,shippingCents:null,currency:'USD',saleType:'completed_sale',priceVisibility:'actual',identity:{subject:'Synthetic Player',year:'2026',setName:'Synthetic Chrome',number:'RA-TEST',parallel:'Purple',gradeCompany:'',grade:'',autograph:true,printRun:250}});
test('sold references reject mismatches, hidden offers, checklist-only claims, invalid dates and unreturned URLs',()=>{
 const valid=checkSoldComparisons({...assessment,soldComparisons:[comp()]},[url],now);assert.equal(valid.accepted.length,1);assert.equal(valid.accepted[0].shippingCents,null);assert.equal(valid.accepted[0].verification,'needs_owner_check');
 for(const mutate of [c=>c.identity.parallel='Orange',c=>c.identity.year='2025',c=>c.identity.number='OTHER',c=>c.identity.setName='Other',c=>c.identity.subject='Other',c=>c.identity.gradeCompany='PSA',c=>c.identity.grade='10',c=>c.identity.autograph=false,c=>c.identity.printRun=99,c=>c.priceVisibility='hidden_offer',c=>c.saleType='asking',c=>c.priceCents=-1,c=>c.currency='CAD',c=>c.shippingCents=-1,c=>c.soldDate='2026-02-30',c=>c.soldDate='2025-01-01',c=>c.soldDate='2027-01-01',c=>c.url='https://unreturned.test']){
  const c=comp();mutate(c);assert.equal(checkSoldComparisons({...assessment,soldComparisons:[c]},[url],now).accepted.length,0,JSON.stringify(c));
 }
 assert.equal(checkSoldComparisons({...assessment,soldComparisons:[comp(),comp()]},[url],now).accepted.length,1);
 const checklist='https://example.test/checklist';const result=normalizeAssessment({...assessment,sources:[{url:checklist,title:'Checklist',note:'Identity only'}]},[checklist]);assert.equal(result.priceBasis,'unknown');assert.equal(result.askCents,null);assert.equal(result.soldComparisons.length,0);
});
function legacy(){const d=draftInput({kind:'card',title:'Synthetic',subject:'Synthetic Player',year:'2026',setName:'Synthetic Chrome',number:'RA-TEST',parallel:'Purple',serial:'168/250',autograph:true,location:'TEST',description:'Front only.',condition:'Excellent',conditionNotes:'Back unassessed.',askCents:15000});delete d.priceReview;d.photos=[{id:'front',role:'front',sha256:'a'.repeat(64)}];d.preparation={status:'complete',result:assessment,applied:{askCents:15000}};d.identityReviewed=true;d.conditionReviewed=true;d.listingReview={fingerprint:hash(listingContent(d)),photoToken:'test'};return d;}
test('old AI prices remain intact but old approval cannot export or stage until price is explicitly confirmed',()=>{
 const d=legacy(),state={drafts:[d],inventory:{items:[],events:[]}},entry=()=>({id:state.drafts[0].id,content:listingContent(state.drafts[0])});
 assert.equal(d.askCents,15000);assert.equal(priceNeedsReview(d),true);assert.equal(isListingApproved(d),false);assert.ok(listingProblems(d).includes('Confirm asking price'));
 assert.throws(()=>approveListings(state,[entry()]),/Confirm asking price/);assert.throws(()=>stagePublicationBatch(state,[entry()]));
 const unrelated=draftInput({notes:'Owner note'},d);assert.equal(priceNeedsReview(unrelated),true);
 const originalPhotos=JSON.stringify(d.photos);state.drafts[0]=draftInput({askCents:15000},d);assert.equal(priceNeedsReview(state.drafts[0]),false);assert.equal(isListingApproved(state.drafts[0]),false);approveListings(state,[entry()]);assert.equal(isListingApproved(state.drafts[0]),true);assert.equal(JSON.stringify(state.drafts[0].photos),originalPhotos);
 const changed=draftInput({parallel:'Orange'},state.drafts[0]);assert.equal(priceNeedsReview(changed),true);assert.equal(changed.askCents,15000);
 assert.throws(()=>draftInput({priceReview:{source:'owner'}},d),/Unsupported/);
});
test('bulk entering the same legacy price confirms only that row and preserves other unresolved prices',()=>{
 const a=legacy(),b=legacy(),state={drafts:[a,b],inventory:{items:[],events:[]}};
 updateListingDetails(state,[{id:a.id,fingerprint:hash(listingContent(a)),changes:{askCents:15000}}]);assert.equal(priceNeedsReview(state.drafts[0]),false);assert.equal(priceNeedsReview(state.drafts[1]),true);assert.equal(isListingApproved(state.drafts[0]),false);
});

test('supported suggestions use the reported sales median, never the model’s invented target',()=>{
 const sale=comp();sale.soldDate=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const second={...sale,url:'https://example.test/sale/2',priceCents:3000};
 const result=normalizeAssessment({...assessment,askCents:15000,soldComparisons:[sale,second]},[sale.url,second.url]);
 assert.equal(result.askCents,2500);assert.equal(result.pricingMethod,'median_reported_item_price');assert.match(result.priceReason,/before shipping and fees/);
 const estimate=normalizeAssessment({...assessment,priceBasis:'estimate',sources:[]});assert.equal(estimate.askCents,null);
});

test('received price confirmation preserves stock and originals, rejects batch locks and nonprice edits',()=>{
 const d=legacy();d.photoPolicy='value-based';d.cardClass='standard';d.singlePhotoMaxCents=20000;
 const state={drafts:[d],inventory:emptyState()};receiveDraft(state,d.id);
 const before=structuredClone(state),photos=JSON.stringify(d.photos),itemId=d.itemId;
 for(const input of [{askCents:700,title:'Overwrite'},{askCents:0},{askCents:null}])assert.throws(()=>reviewReceivedPrice(state,d.id,input));
 assert.deepEqual(state,before);
 state.publicationBatches=[{status:'staged',entries:[{draftId:d.id}]}];assert.throws(()=>reviewReceivedPrice(state,d.id,{askCents:700}),/saved eBay batch/);delete state.publicationBatches;
 state.inventory.items[0].status='listed';assert.throws(()=>reviewReceivedPrice(state,d.id,{askCents:700}),/live listing/);state.inventory.items[0].status='ready';
 reviewReceivedPrice(state,d.id,{askCents:700});const updated=state.drafts[0];
 assert.equal(updated.status,'received');assert.equal(updated.itemId,itemId);assert.equal(updated.askCents,700);assert.equal(priceNeedsReview(updated),false);assert.equal(isListingApproved(updated),false);
 assert.equal(state.inventory.items.length,1);assert.equal(state.inventory.items[0].quantity,1);assert.equal(state.inventory.items[0].askCents,700);assert.equal(JSON.stringify(updated.photos),photos);
 approveListings(state,[{id:updated.id,content:listingContent(updated)}]);assert.equal(isListingApproved(updated),true);
});
