import test from 'node:test';
import assert from 'node:assert/strict';
import {photoRequirement,missingPhotos} from '../public/photo-policy.mjs';
import {BatchIntake} from '../public/batch.mjs';
import {draftInput,receiveDraft} from '../domain.mjs';
import {listingProblems} from '../public/preparation-policy.mjs';
const ordinary={kind:'card',photoPolicy:'value-based',cardClass:'standard',askCents:500,singlePhotoMaxCents:500,photos:[{role:'front'}]};
test('all cards allow one front regardless of price, classification or legacy photo policy',()=>{
 for(const change of [{},{askCents:1000000},{askCents:null},{cardClass:'unknown'},{cardClass:'premium'},{autograph:true},{memorabilia:true},{serial:'1/99'},{parallel:'refractor'},{gradeCompany:'PSA'},{cert:'123'},{photoPolicy:'two-sided'},{singlePhotoMaxCents:0}])assert.deepEqual(missingPhotos({...ordinary,...change}),[]);
 assert.deepEqual(photoRequirement({...ordinary,photoPolicy:'two-sided',askCents:1500,autograph:true}).roles,['front']);
 assert.deepEqual(missingPhotos({...ordinary,photos:[{role:'back'}]}),['front']);
 for(const kind of ['comic','other'])assert.deepEqual(missingPhotos({...ordinary,kind}),['back']);
});
test('unknown price asks for price first, and missing listing fields are named precisely',()=>{
 const d={...ordinary,title:'Synthetic',subject:'Test',setName:'Test',location:'TEST',condition:'Good',conditionNotes:'Front checked; reverse unassessed.',description:'Synthetic card'};
 assert.deepEqual(listingProblems({...d,askCents:null}),['Price needed']);
 assert.deepEqual(listingProblems({...d,condition:''}),['Listing condition needed']);
 assert.deepEqual(listingProblems({...d,conditionNotes:''}),['Visible condition notes needed']);
 assert.deepEqual(listingProblems({...d,description:''}),['Listing description needed']);
 assert.deepEqual(listingProblems({...d,photos:[]}),['Add front photo']);
 assert.deepEqual(listingProblems({...d,askCents:1500}),[]);
});
test('price changes invalidate review and receiving needs a front but no back',()=>{
 const {photos,...details}=ordinary;const d=draftInput({...details,title:'Synthetic ordinary card',location:'TEST',conditionNotes:'Front only; reverse unassessed.',identityReviewed:true,conditionReviewed:true});
 d.photos=photos;
 const changed=draftInput({askCents:599},d);assert.equal(changed.identityReviewed,false);
 const state={drafts:[{...changed,identityReviewed:true}],inventory:{schemaVersion:1,workspace:'btco-local',mode:'work',revision:0,items:[],sales:[],events:[]}};
 receiveDraft(state,d.id);assert.equal(state.inventory.items.length,1);
 state.drafts=[{...d,photos:[]}];assert.throws(()=>receiveDraft(state,d.id),/front/);

});
test('mixed queue keeps group boundaries, rejects odd pairs atomically and resumes partial uploads',async()=>{
 let next=0,fail=true;const uploads=[];
 const b=new BatchIntake({onChange:()=>{},save:async()=>({draftId:String(++next)}),upload:async(id,role)=>{if(id==='13'&&role==='back'&&fail){fail=false;throw Error('connection interrupted');}uploads.push(id+':'+role);}});
 const f=()=>new File(['synthetic'],'test.jpg',{type:'image/jpeg'});
 b.addFiles(Array.from({length:12},f),'single');b.addFiles([f(),f()]);
 assert.equal(b.items.length,13);assert.equal(b.photoCount,14);
 assert.throws(()=>b.addFiles([f()]),/even number/);assert.equal(b.photoCount,14);
 b.swap(b.items[12].id);assert.deepEqual(b.items[12].files.map(x=>x.role),['front','back']);
 await b.start({kind:'card'});assert.equal(b.items[12].status,'error');assert.equal(next,13);
 await b.start({kind:'card'});assert.equal(b.unfinished,false);assert.equal(next,13);assert.equal(new Set(uploads).size,14);assert.equal(uploads.length,14);b.clear();
 b.addFiles(Array.from({length:500},f),'single');assert.throws(()=>b.addFiles([f()],'single'),/500/);b.remove(b.items[0].id);assert.equal(b.photoCount,499);b.clear();
});
