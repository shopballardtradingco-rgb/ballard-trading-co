import {deskIssues} from './public/listing-desk-policy.mjs';
import {randomUUID} from 'node:crypto';
import {fail,hash,event,draftInput,reviewReceivedPrice} from './domain.mjs';
import {isListingApproved,approveListings} from './preparation.mjs';
import {listingContent} from './public/preparation-policy.mjs';
import {remaining} from '../web/domain/core.mjs';

// One owner-reviewed step saves prices, approves card details and stages a snapshot.
// Work on a copy so one stale/invalid row cannot partially approve the selection.
export function startListingFlow(state,{entries,confirmedDetails}={}){
 if(confirmedDetails!==true)fail('Review the card details and prices before continuing.');
 if(!Array.isArray(entries)||!entries.length||entries.length>500||new Set(entries.map(e=>e?.id)).size!==entries.length)fail('Choose 1–500 cards to list.');
 const next=structuredClone(state);
 for(const e of entries){
  const d=next.drafts.find(d=>d.id===e?.id);
  if(!d||hash(listingContent(d))!==e.fingerprint)fail('A card changed. Reopen List on eBay to review the latest version.',409);
  if((next.publicationBatches??[]).some(b=>b.status!=='cancelled'&&b.entries.some(x=>x.draftId===d.id||x.sku===d.sku)))fail('This card is already in an eBay listing group. Continue that group.',409);
  if(d.status==='received'){
   const item=next.inventory.items.find(i=>i.id===d.itemId);
   if(!item||remaining(next.inventory,item)<1||item.status==='hold')fail('This card is sold or on hold. Review its Vault record first.',409);
   reviewReceivedPrice(next,d.id,{askCents:e.askCents});
  }else{
   if(!Number.isSafeInteger(e.askCents)||e.askCents<100)fail('Enter an asking price of at least $1.');
   next.drafts[next.drafts.indexOf(d)]=draftInput({askCents:e.askCents},d);
  }
 }
 const reviewed=entries.map(e=>{const d=next.drafts.find(d=>d.id===e.id);return {id:d.id,fingerprint:hash(listingContent(d))};});
 approveListings(next,reviewed);
 const result=stagePublicationBatch(next,reviewed);
 Object.assign(state,next);return result;
}

// Local snapshots remain separate from revision-bound eBay publication approval.
export const publicationCapability={enabled:false,reason:'Direct card publishing is not connected yet. Saved batches will need shipping, eBay condition and seller-policy review before publication.'};
export function publicationBatches(state){
 return (state.publicationBatches??[]).map(batch=>({...batch,entries:batch.entries.map(entry=>{
  const current=state.drafts.find(d=>d.id===entry.draftId);
  return {...entry,changed:!current||current.status==='archived'||!isListingApproved(current)||hash(listingContent(current))!==entry.fingerprint};
 })}));
}
export function stagePublicationBatch(state,entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>500||entries.some(e=>!e||typeof e.id!=='string'||typeof e.fingerprint!=='string')||new Set(entries.map(e=>e.id)).size!==entries.length)fail('Select 1–500 approved cards.');
 const batches=state.publicationBatches??[];
 const active=batches.filter(b=>b.status!=='cancelled');
 const snapshots=entries.map(e=>{
  const d=state.drafts.find(d=>d.id===e.id);
  if(!d||!isListingApproved(d)||d.status==='archived'||hash(listingContent(d))!==e.fingerprint)fail('A card changed or needs approval. Refresh and review it again.',409);
  if(d.title.length>80)fail(d.sku+': shorten the title to 80 characters before preparing an eBay batch.');
  if(active.some(b=>b.entries.some(x=>x.draftId===d.id||x.sku===d.sku)))fail(d.sku+' is already in a saved eBay batch. Open that batch instead.',409);
  return {draftId:d.id,sku:d.sku,fingerprint:e.fingerprint,title:d.title,askCents:d.askCents,condition:d.condition,location:d.location,description:d.description,conditionNotes:d.conditionNotes,photos:structuredClone(d.photos)};
 });
 if(new Set(snapshots.map(e=>e.sku)).size!==snapshots.length)fail('Duplicate SKUs must be resolved before preparing this batch.',409);
 const batch={id:randomUUID(),createdAt:new Date().toISOString(),marketplace:'EBAY_US',currency:'USD',status:'staged',publicationApproved:false,entries:snapshots};
 (state.publicationBatches??=[]).push(batch);event(state,'core.publication-staged',batch.id,{count:snapshots.length});return {batchId:batch.id,count:snapshots.length};
}
export function cancelPublicationBatch(state,id){
 const batch=state.publicationBatches?.find(b=>b.id===id);if(!batch)fail('Batch not found.',404);
 if(batch.publicationApproved||!['staged','preparing','ready','cancelled'].includes(batch.status))fail('This batch cannot be removed from the queue.',409);
 if(batch.status!=='cancelled'){batch.status='cancelled';batch.cancelledAt=new Date().toISOString();event(state,'core.publication-cancelled',id);}
 return {batchId:id};
}


/** Stage the selected ready cards, retaining incomplete cards and all previous history. */
export function prepareListingSelection(state,{entries,confirmedDetails}={}){
 if(confirmedDetails!==true)fail('Confirm the selected card details before preparing listings.');
 if(!Array.isArray(entries)||!entries.length||entries.length>500||new Set(entries.map(e=>e?.id)).size!==entries.length)fail('Select 1–500 cards.');
 const next=structuredClone(state),ready=[],excluded=[];
 for(const e of entries){
  const d=next.drafts.find(d=>d.id===e?.id);
  if(!d||hash(listingContent(d))!==e.fingerprint)fail('A selected card changed on another device. Refresh before continuing.',409);
  const issues=deskIssues(d),batches=(next.publicationBatches??[]).filter(b=>b.status!=='cancelled'&&b.entries.some(x=>x.draftId===d.id||x.sku===d.sku));
  if(batches.some(b=>b.publicationApproved||!['staged','preparing','ready'].includes(b.status)))issues.push('Already publishing or live; check eBay status');
  if(d.status==='received'){const item=next.inventory.items.find(i=>i.id===d.itemId);if(!item||item.source?.draftId!==d.id||item.sku!==d.sku||item.askCents!==d.askCents||remaining(next.inventory,item)<1||['listed','hold'].includes(item.status))issues.push('Vault price, stock or listing status needs review');}
  if(issues.length)excluded.push({draftId:d.id,title:d.title,issues});else ready.push(d);
 }
 if(!ready.length)return {batchId:null,count:0,excluded,reused:false};
 const ids=new Set(ready.map(d=>d.id)),affected=(next.publicationBatches??[]).filter(b=>b.status!=='cancelled'&&b.entries.some(e=>ids.has(e.draftId)));
 // A ready, unchanged selection resumes its exact remote review instead of rebuilding it.
 if(affected.length===1&&affected[0].entries.length===ids.size&&affected[0].entries.every(e=>ids.has(e.draftId)&&isListingApproved(next.drafts.find(d=>d.id===e.draftId))&&e.fingerprint===hash(listingContent(next.drafts.find(d=>d.id===e.draftId)))))return {batchId:affected[0].id,count:ids.size,excluded,reused:true};
 for(const b of affected){
  cancelPublicationBatch(next,b.id);
  const leftovers=b.entries.filter(e=>!ids.has(e.draftId));
  if(leftovers.length){const retained={id:randomUUID(),createdAt:new Date().toISOString(),marketplace:b.marketplace,currency:b.currency,status:'staged',publicationApproved:false,entries:structuredClone(leftovers)};next.publicationBatches.push(retained);b.remainingBatchId=retained.id;}
 }
 const reviewed=ready.map(d=>({id:d.id,fingerprint:hash(listingContent(d))}));
 approveListings(next,reviewed);const result=stagePublicationBatch(next,reviewed);
 for(const b of affected)b.replacedBy=result.batchId;
 event(next,'core.listing-selection-prepared',result.batchId,{selected:entries.length,ready:ready.length,excluded:excluded.map(e=>e.draftId)});
 Object.assign(state,next);return {...result,excluded,reused:false};
}

