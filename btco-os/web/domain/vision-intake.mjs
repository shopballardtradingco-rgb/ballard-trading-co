import {uid,validateState,saveItem} from './core.mjs';
import {normalizeCard,suggestedTitle,visionMatches,addVisionItem} from './vision.mjs';
import {intakeRecords,cdpSku,skuKey,skuAliases,validateCDPSku} from './intake-contract.mjs';
export {intakeRecords,cdpSku};
const event=(state,action,record,now)=>state.events.push({id:uid(),at:now,action,entityId:record.id,detail:{record:structuredClone(record)}});
export function saveIntakeDraft(state,input,{id=null,title='',location='',costCents=null,evidence=null,now=new Date().toISOString()}={}){
  const card=normalizeCard(input),records=intakeRecords(state);
  const old=id?records.find(r=>r.id===id):evidence?records.find(r=>r.evidence?.scanId===evidence.scanId):null;
  if(id&&!old)throw Error('Intake draft not found. Reload shared inventory.');
  if(old?.status==='linked')throw Error('This scan is already linked. Open the existing inventory record.');
  const savedEvidence=old?.evidence??(evidence?{scanId:evidence.scanId,identifiedAt:evidence.identifiedAt,provider:String(evidence.provider??'').slice(0,100),model:String(evidence.model??'').slice(0,100),card:normalizeCard(evidence.card)}:null);
  const record={id:old?.id??uid(),status:'draft',createdAt:old?.createdAt??now,updatedAt:now,card,title:(title.trim()||suggestedTitle(card)).slice(0,4000),location:String(location).trim(),costCents,evidence:savedEvidence,linkedItemId:null,cdpSku:'',linkedAt:null};
  if(!record.title)throw Error('Enter a title or identify the card before saving a draft.');
  const next=structuredClone(state);event(next,'vision.intake.saved',record,now);validateState(next);return {next,record};
}
export function cdpCandidates(state,sku){const key=skuKey(sku);return key?state.items.filter(item=>skuAliases(item).includes(key)):[];}
export function linkIntake(state,id,{sku,existingItemId=null,reviewed=false,cdpConfirmed=false,separateCopy=false,now=new Date().toISOString()}={}){
  const record=intakeRecords(state).find(r=>r.id===id);
  if(!record)throw Error('Save this intake draft before linking CDP.');
  if(record.status==='linked')throw Error('This intake is already linked. Open the existing inventory record.');
  if(!reviewed||!cdpConfirmed)throw Error('Confirm the physical card and check its SKU in CDP before linking.');
  let canonical=validateCDPSku(sku);const matches=cdpCandidates(state,canonical);
  if(matches.length>1)throw Error('Multiple inventory records match this CDP SKU. Reconcile them before linking.');
  const existing=existingItemId?state.items.find(i=>i.id===existingItemId):matches[0];
  if(existingItemId&&!existing)throw Error('Selected inventory record no longer exists.');
  if(existing&&matches.some(i=>i.id!==existing.id))throw Error('This CDP SKU belongs to a different inventory record.');
  if(existing&&cdpSku(existing)&&skuKey(cdpSku(existing))!==skuKey(canonical))throw Error('The selected record has a different CDP SKU.');
  // Normalized aliases help find candidates; they never redefine master identity.
  if(existing&&cdpSku(existing))canonical=validateCDPSku(cdpSku(existing));
  if(existing&&existing.kind!=='card')throw Error('Link this card to a card inventory record.');
  if(existing&&record.card.gradingCompany&&existing.gradeCompany&&skuKey(record.card.gradingCompany)!==skuKey(existing.gradeCompany))throw Error('The scanned grader and selected inventory record disagree. Review them first.');
  const certMatches=visionMatches(state,record.card).filter(m=>m.certMatch);
  if(certMatches.some(m=>m.item.id!==existing?.id))throw Error('That certificate belongs to another inventory record. Link that record instead.');
  if(existing&&record.card.certificationNumber&&existing.cert&&record.card.certificationNumber!==existing.cert)throw Error('The scanned certificate and selected inventory record disagree. Review them first.');
  const scanId=record.evidence?.scanId;
  if(scanId&&state.items.some(i=>i.source?.visionScan?.scanId===scanId&&i.id!==existing?.id))throw Error('This scan is already attached to another inventory record.');
  let item,next;
  if(existing){
    item={...structuredClone(existing),cdpLink:{sku:canonical,method:'manual-confirmation',confirmedAt:now}};
    next=saveItem(state,item);
  }else{
    ({item,next}=addVisionItem(state,record.card,{title:record.title,sku:canonical,reviewed:true,separateCopy,location:record.location,costCents:record.costCents,evidence:record.evidence}));
    item.sku=canonical;next.items.find(i=>i.id===item.id).sku=canonical;next.events.at(-1).detail.after.sku=canonical;
    item.cdpLink={sku:canonical,method:'manual-confirmation',confirmedAt:now};
    // Include the link in the same item creation event and atomic workspace save.
    next.items.find(i=>i.id===item.id).cdpLink=structuredClone(item.cdpLink);
    next.events.at(-1).detail.after.cdpLink=structuredClone(item.cdpLink);
  }
  const linked={...record,status:'linked',updatedAt:now,linkedAt:now,linkedItemId:item.id,cdpSku:canonical};
  event(next,'vision.intake.linked',linked,now);validateState(next);return {next,item,record:linked,created:!existing};
}
