import {cardDefaults} from './public/card-defaults.mjs';
import {listingContent} from './public/preparation-policy.mjs';
import {editListingRows} from './listing-editor.mjs';
import {hash,fail,event} from './domain.mjs';
import {remaining} from '../web/domain/core.mjs';

const basis=d=>hash([listingContent(d),d.vendor,d.acquisitionRef,d.conditionChoice,d.preparation]);
function eligible(state,d){
 if(!['draft','received'].includes(d.status)||['queued','running'].includes(d.preparation?.status))return false;
 if((state.publicationBatches??[]).some(b=>b.status!=='cancelled'&&b.entries.some(e=>e.draftId===d.id||e.sku===d.sku)&&(b.publicationApproved||!['staged','preparing','ready'].includes(b.status))))return false;
 if(d.status==='received'){const item=state.inventory.items.find(i=>i.id===d.itemId);if(!item||item.source?.draftId!==d.id||item.sku!==d.sku||String(item.year??'')!==String(d.year??'')||remaining(state.inventory,item)<1||['listed','hold'].includes(item.status))return false;}
 return true;
}
export function listingDefaultCandidates(state,currentYear){
 return state.drafts.filter(d=>eligible(state,d)&&Object.keys(cardDefaults(d,currentYear).fields).length).slice(0,500).map(d=>({id:d.id,basis:basis(d)}));
}
export function applyListingDefaults(state,entries,currentYear){
 if(!Array.isArray(entries)||!entries.length||entries.length>500||new Set(entries.map(e=>e?.id)).size!==entries.length)fail('Choose 1–500 cards for listing defaults.');
 let updated=0;const skipped=[],batchReplacements={};
 for(const e of entries){
  const d=state.drafts.find(d=>d.id===e?.id);
  if(!d||basis(d)!==e.basis||!eligible(state,d)){skipped.push(e?.id);continue;}
  const {fields,condition}=cardDefaults(d,currentYear);if(!Object.keys(fields).length)continue;
  const previous={year:d.year,condition:d.condition};
  try{const result=editListingRows(state,[{id:d.id,fingerprint:hash(listingContent(d)),fields}],{identifiedDefaults:true});for(const [oldId,newId] of Object.entries(result.batchReplacements)){for(const key of Object.keys(batchReplacements))if(batchReplacements[key]===oldId)batchReplacements[key]=newId;batchReplacements[oldId]=newId;}}
  catch(error){if(error.status===400||error.status===409){skipped.push(d.id);continue;}throw error;}
  const saved=state.drafts.find(x=>x.id===d.id);
  if(saved.preparation?.outputFingerprint===hash(listingContent(d))){Object.assign(saved.preparation.applied??={},fields);saved.preparation.outputFingerprint=hash(listingContent(saved));}
  if(Object.hasOwn(fields,'condition'))saved.conditionChoice={...condition,previous:previous.condition};
  if(Object.hasOwn(fields,'year'))saved.identifiedYearOriginal??=previous.year||d.preparation?.result?.year||d.title;
  event(state,'core.listing-defaults-applied',d.id,{fields:Object.keys(fields),rule:condition?.rule});updated++;
 }
 return {updated,skipped,batchReplacements};
}
