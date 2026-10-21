import {identifiedYear} from './public/card-defaults.mjs';
import {confirmPrice,priceNeedsReview} from './public/price-review.mjs';
import {checkedCondition} from './public/listing-controls.mjs';
import {draftInput,editInventory,event,fail,hash} from './domain.mjs';
import {isListingApproved,approveListings} from './preparation.mjs';
import {listingContent,listingProblems} from './public/preparation-policy.mjs';
import {cancelPublicationBatch,stagePublicationBatch} from './publication.mjs';
import {remaining} from '../web/domain/core.mjs';

// One transaction: stale rows, sold stock, or approved remote work stop every edit.
export function editListingRows(state,entries,{identifiedDefaults=false}={}){
 if(!Array.isArray(entries)||!entries.length||entries.length>500||new Set(entries.map(e=>e?.id)).size!==entries.length)fail('Choose 1–500 rows to save.');
 const next=structuredClone(state),affected=new Set();
 for(const e of entries){
  const d=next.drafts.find(d=>d.id===e?.id),fields=e?.fields;
  if(!d||hash(listingContent(d))!==e.fingerprint)fail('Saved details changed for '+(d?.title??'a selected card')+'. Your edits are still open; refresh in Core and review this card before saving.',409);
  const textFields=['title','subject','setName','year','location','conditionNotes','description','sport'];
  if(!fields||!Object.keys(fields).length||Object.keys(fields).some(k=>!['askCents','condition','shippingMode',...textFields].includes(k)))fail('Only listing details can be edited here.');
  for(const key of textFields)if(Object.hasOwn(fields,key)&&(typeof fields[key]!=='string'||fields[key].length>4000))fail('Enter valid '+key+'.');
  if(Object.hasOwn(fields,'year')&&fields.year&&!/^(18|19|20)\d{2}$|^2100$/.test(fields.year))fail('Enter a four-digit card year.');
  if(Object.hasOwn(fields,'title')&&fields.title.length>80)fail('Shorten title to 80 characters.');
  if(!['draft','received'].includes(d.status)||['queued','running'].includes(d.preparation?.status))fail('Wait for preparation to finish or restore this intake before editing.',409);
  const batches=(next.publicationBatches??[]).filter(b=>b.status!=='cancelled'&&b.entries.some(x=>x.draftId===d.id||x.sku===d.sku));
  if(batches.some(b=>b.publicationApproved||!['staged','preparing','ready'].includes(b.status)))fail('This listing has publishing approval or a live/unknown outcome. Review its eBay status before editing.',409);
  if(Object.hasOwn(fields,'askCents')&&(!Number.isSafeInteger(fields.askCents)||fields.askCents<100))fail('Enter an asking price of at least $1.');
  if(Object.hasOwn(fields,'condition')){try{checkedCondition(d,fields.condition);}catch(e){fail(e.message);}}
  let item;
  if(d.status==='received'){
   item=next.inventory.items.find(i=>i.id===d.itemId);
   if(!item||item.source?.draftId!==d.id||item.sku!==d.sku||remaining(next.inventory,item)<1||['listed','hold'].includes(item.status))fail('This Vault item is listed, sold, on hold, or needs a link review. Check its status first.',409);
   if(Object.hasOwn(fields,'askCents')&&item.askCents!==d.askCents)fail('The Vault price changed for '+d.title+'. Review its current price before saving.',409);
   for(const key of ['title','subject','setName','year','location'])if(Object.hasOwn(fields,key)&&String(item[key]??'')!==String(d[key]??''))fail('The Vault '+key+' changed for '+d.title+'. Review its current details before saving.',409);
  }
  const approved=isListingApproved(d),updated=draftInput(fields,{...d,status:'draft'});updated.status=d.status;
  if(identifiedDefaults&&Object.hasOwn(fields,'year')&&identifiedYear(d)===updated.year&&d.priceReview?.source==='owner'&&!priceNeedsReview(d))updated.priceReview=confirmPrice(updated);
  next.drafts[next.drafts.indexOf(d)]=updated;
  if(item){const linked=Object.fromEntries(['askCents','title','subject','setName','year','location'].filter(k=>Object.hasOwn(fields,k)).map(k=>[k,updated[k]]));if(Object.keys(linked).length)editInventory(next,linked,item.id);}
  if(approved&&!listingProblems(updated).length)approveListings(next,[{id:d.id,fingerprint:hash(listingContent(updated))}]);
  if(batches.length&&!isListingApproved(updated))fail('This change needs a complete card review before it can stay in the saved batch.',409);
  batches.forEach(b=>affected.add(b.id));event(next,'core.listing-row-edited',d.id,{fields:Object.keys(fields)});
 }
 const batchReplacements={};
 for(const id of affected){
  const b=next.publicationBatches.find(b=>b.id===id);
  const rows=b.entries.map(e=>{const d=next.drafts.find(d=>d.id===e.draftId);return {id:d.id,fingerprint:hash(listingContent(d))};});
  // Old remote previews never carry approval into the replacement batch.
  if(!b.bridge){for(const entry of b.entries){const d=next.drafts.find(d=>d.id===entry.draftId);if(!isListingApproved(d))fail('Another card in this batch needs review.',409);Object.assign(entry,{fingerprint:hash(listingContent(d)),askCents:d.askCents,condition:d.condition});}}
  else {cancelPublicationBatch(next,id);const result=stagePublicationBatch(next,rows);batchReplacements[id]=result.batchId;b.replacedBy=result.batchId;}
 }
 Object.assign(state,next);return {saved:entries.length,batchReplacements};
}
