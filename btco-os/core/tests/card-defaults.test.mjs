import test from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {cardYear,identifiedYear,cardDefaults} from '../public/card-defaults.mjs';
import {listingDefaultCandidates,applyListingDefaults} from '../listing-defaults.mjs';
import {draftInput,hash,receiveDraft} from '../domain.mjs';
import {approveListings} from '../preparation.mjs';
import {stagePublicationBatch} from '../publication.mjs';
import {editListingRows} from '../listing-editor.mjs';
import {listingContent} from '../public/preparation-policy.mjs';
import {confirmPrice,priceNeedsReview} from '../public/price-review.mjs';
import {harness} from './helpers.mjs';
function fixture(extra={}){const d=draftInput({kind:'card',title:'2001-02 Synthetic Player',subject:'Synthetic',year:'2001-02',setName:'Synthetic Set',location:'TEST',condition:'VG-EX',conditionNotes:'Original visible notes',description:'Synthetic only',askCents:500,...extra});d.photos=[{id:randomUUID(),role:'front',sha256:'a'.repeat(64),sizeBytes:100,width:180,height:240,filename:'synthetic.jpg',mediaType:'image/jpeg'}];return {drafts:[d],inventory:{schemaVersion:1,workspace:'btco-local',mode:'work',revision:0,items:[],sales:[],events:[]}};}
test('identified seasons use first year; blank years reuse identification without guessing ambiguous dates',()=>{
 for(const value of ['2001-02','2001–2002','1999/00','2001'])assert.equal(cardYear(value),value.startsWith('1999')?'1999':'2001');
 for(const value of ['2001-05','2001-2003','bad','1799'])assert.equal(cardYear(value),'');
 assert.equal(identifiedYear({year:'',title:'Synthetic 2001-02 Player',setName:'Synthetic'}),'2001');
 assert.equal(identifiedYear({year:'',title:'2024 and 2025 lot'}),'');
 assert.equal(identifiedYear({year:'bad',title:'2024 Synthetic'}),'');
 assert.equal(identifiedYear({year:'',title:'Synthetic /2024'}),'');
 assert.equal(identifiedYear({year:'',preparation:{result:{year:'2001-02'}}}),'2001');
});
test('Hoody’s or less than three years old gets Near mint; older/unknown gets Very good, with owner and slab overrides',()=>{
 for(const [year,vendor,condition] of [['2026','','Near mint or better'],['2024','','Near mint or better'],['2023','','Very good'],['2027','','Very good'],['','','Very good'],['1990','Hoody’s','Near mint or better'],['1990',"Hoody's",'Near mint or better'],['1990','Hoodys','Near mint or better']]){const d=fixture({year,vendor,title:'Synthetic card'}).drafts[0];assert.equal(cardDefaults(d,2026).fields.condition,condition);}
 const d=fixture({year:'2026',condition:'Poor'}).drafts[0];assert.equal(cardDefaults(d,2026).fields.condition,undefined);delete d.conditionChoice;d.preparation={applied:{condition:'Poor'}};assert.equal(cardDefaults(d,2026).fields.condition,'Near mint or better');
 assert.equal(cardDefaults({...d,gradeCompany:'PSA',condition:'Graded'},2026).fields.condition,undefined);
 assert.deepEqual(cardDefaults({...d,kind:'comic'},2026).fields,{});
});
test('existing cards normalize once, retain reviewed price/notes/originals, and manual choices survive refresh',()=>{
 const s=fixture(),d=s.drafts[0];d.preparation={status:'complete',applied:{condition:'VG-EX',year:'2001-02'},outputFingerprint:hash(listingContent(d))};d.priceReview=confirmPrice(d);approveListings(s,[{id:d.id,fingerprint:hash(listingContent(d))}]);
 const id=stagePublicationBatch(s,[{id:d.id,fingerprint:hash(listingContent(d))}]).batchId;s.publicationBatches[0].bridge={reviewFingerprint:'obsolete'};s.publicationBatches[0].status='ready';const photos=structuredClone(d.photos);
 assert.equal(applyListingDefaults(s,listingDefaultCandidates(s,2026),2026).updated,1);const saved=s.drafts[0];assert.equal(saved.year,'2001');assert.equal(saved.condition,'Very good');assert.equal(saved.identifiedYearOriginal,'2001-02');assert.equal(saved.conditionChoice.previous,'VG-EX');assert.equal(saved.conditionNotes,'Original visible notes');assert.deepEqual(saved.photos,photos);assert.equal(saved.sku,d.sku);assert.equal(priceNeedsReview(saved),false);assert.equal(s.publicationBatches.find(b=>b.id===id).status,'cancelled');assert.ok(s.publicationBatches.every(b=>!b.publicationApproved));assert.equal(listingDefaultCandidates(s,2026).length,0);
 editListingRows(s,[{id:saved.id,fingerprint:hash(listingContent(saved)),fields:{condition:'Poor'}}]);assert.equal(listingDefaultCandidates(s,2026).length,0);assert.equal(s.drafts[0].conditionChoice.source,'owner');
});
test('source and content races, publishing locks and unavailable Vault stock cannot be overwritten',()=>{
 for(const mode of ['source','content','publishing','hold']){const s=fixture(),d=s.drafts[0],entries=listingDefaultCandidates(s,2026);if(mode==='source')d.vendor='Hoody’s';if(mode==='content')d.conditionNotes='Owner edit';if(mode==='publishing'){approveListings(s,[{id:d.id,fingerprint:hash(listingContent(d))}]);stagePublicationBatch(s,[{id:d.id,fingerprint:hash(listingContent(d))}]);s.publicationBatches[0].publicationApproved=true;}if(mode==='hold'){approveListings(s,[{id:d.id,fingerprint:hash(listingContent(d))}]);receiveDraft(s,d.id);s.inventory.items[0].status='hold';}const before=structuredClone(s);assert.equal(applyListingDefaults(s,entries,2026).updated,0);assert.deepEqual(s,before);}
});
test('received year normalization updates the linked Vault record without changing stock or master identity',()=>{
 const s=fixture(),d=s.drafts[0];approveListings(s,[{id:d.id,fingerprint:hash(listingContent(d))}]);receiveDraft(s,d.id);const original=structuredClone(s.inventory.items[0]);assert.equal(applyListingDefaults(s,listingDefaultCandidates(s,2026),2026).updated,1);const item=s.inventory.items[0];assert.equal(item.year,'2001');for(const key of ['id','sku','quantity','costCents','source'])assert.deepEqual(item[key],original[key]);
});
test('defaults API requires authentication/CSRF, preserves GET semantics, and replays idempotently',async()=>{
 const h=await harness({accessMode:'open'});try{await h.request('/api/session');const s=await h.store.workspace();s.drafts=fixture().drafts;await h.store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(s)]);const read=await h.request('/api/workspace');assert.deepEqual(await h.store.workspace(),s);const data={entries:read.body.listingDefaults};assert.equal((await h.request('/api/listing-defaults',{method:'POST',auth:false,data})).status,401);const result=await h.save('/api/listing-defaults',data,{operationId:'synthetic-defaults'});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.updated,1);assert.equal((await h.save('/api/listing-defaults',data,{operationId:'synthetic-defaults'})).body.replayed,true);assert.equal((await h.request('/api/workspace')).body.listingDefaults.length,0);assert.equal((await h.store.workspace()).drafts[0].condition,'Very good');}finally{await h.close();}
});
