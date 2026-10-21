import {createHash,randomUUID} from 'node:crypto';
import {remaining} from '../web/domain/core.mjs';

// CollX is deliberately an owner-maintained record until a supported posting contract is available.
export const collxCapability=Object.freeze({prices:true,tracking:true,publishing:false,salesSync:false,automaticDelisting:false});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const amount=v=>v===null||(Number.isSafeInteger(v)&&v>0&&v<=100_000_000_000);
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const statuses=['unknown','active','ended','sold'];
const identityFields=['sku','kind','title','subject','year','setName','number','parallel','serial','gradeCompany','grade','cert','autograph','memorabilia'];
function entities(state){
 const linked=new Set(state.drafts.map(d=>d.itemId).filter(Boolean)),items=new Map(state.inventory.items.map(i=>[i.id,i]));
 return [...state.drafts.map(d=>({key:'draft:'+d.id,draft:d,item:items.get(d.itemId)})),...state.inventory.items.filter(i=>!linked.has(i.id)).map(i=>({key:'item:'+i.id,item:i}))];
}
const identity=e=>digest(identityFields.map(k=>[k,(e.item??e.draft)[k]??null]));
const fingerprint=(e,r)=>digest({draft:e.draft??null,item:e.item??null,record:r??null});
function lookup(state,key){const e=entities(state).find(e=>e.key===key);if(!e)fail('Card not found.',404);if((e.item??e.draft).kind!=='card')fail('CollX card tracking is for trading cards.');return e;}
function listingURL(value){
 if(value==='')return '';
 if(typeof value!=='string'||value.length>2000)fail('Use the CollX listing share link.');
 let u;try{u=new URL(value);}catch{fail('Use the CollX listing share link.');}
 if(u.protocol!=='https:'||!['collx.app','www.collx.app','share.collx.app'].includes(u.hostname)||u.username||u.password||u.port||u.pathname==='/')fail('Use an HTTPS CollX listing share link.');
 // A share link is evidence supplied by the owner, never a fetch target or authentication token.
 u.hash='';u.search='';return u.href;
}
function observation(input){
 if(!input||!statuses.includes(input.status)||typeof input.externalId!=='string'||!input.externalId.trim()||input.externalId.length>200||/[\u0000-\u001f]/.test(input.externalId)||!amount(input.priceCents)||typeof input.url!=='string')fail('Record a CollX listing ID, status and valid price (or leave price unknown).');
 return {externalId:input.externalId.trim(),url:listingURL(input.url),status:input.status,priceCents:input.priceCents};
}
function audit(state,action,e,detail){state.inventory.events.push({id:randomUUID(),at:new Date().toISOString(),action,entityId:(e.item??e.draft).id,detail});}
function checkedRecord(state,input){
 if(!input||typeof input.key!=='string')fail('Select a card.');
 const e=lookup(state,input.key),record=(state.channelRecords??[]).find(r=>r.channel==='collx'&&r.key===input.key);
 if(input.fingerprint!==fingerprint(e,record))fail('This card or CollX record changed. Reopen it before saving.',409);
 const next=structuredClone(record??{key:input.key,channel:'collx',priceCents:null,priceIdentity:null,priceConfirmedAt:null,observation:null});
 return {e,record,next};
}
function persist(state,next){
 const records=state.channelRecords??[],index=records.findIndex(r=>r.channel===next.channel&&r.key===next.key);
 if(index<0&&records.length>=20000)fail('The channel record limit has been reached.');
 if(index<0)records.push(next);else records[index]=next;state.channelRecords=records;
}
export function saveCollxPrice(state,input){
 const {e,next}=checkedRecord(state,input);
 if(!amount(input.priceCents))fail('Enter a positive CollX price with at most two decimal places, or leave it blank.');
 next.priceCents=input.priceCents;next.priceIdentity=input.priceCents===null?null:identity(e);next.priceConfirmedAt=input.priceCents===null?null:new Date().toISOString();
 persist(state,next);audit(state,'core.collx-price-saved',e,{key:next.key,priceCents:next.priceCents});return {key:next.key};
}
export function saveCollxObservation(state,input){
 const {e,next}=checkedRecord(state,input);
 if(input.checked!==true)fail('Check the listing in CollX before recording its status.');
 const value=observation(input);
 if(next.observation&&next.observation.externalId!==value.externalId)fail('This card already has a different CollX listing ID. Reconcile that mapping before replacing it.',409);
 if((state.channelRecords??[]).some(r=>r.channel==='collx'&&r.key!==next.key&&r.observation&&(r.observation.externalId===value.externalId||(value.url&&r.observation.url===value.url))))fail('That CollX listing is already linked to another card.',409);
 const previous=next.observation;next.observation={...value,source:'owner',checkedAt:new Date().toISOString()};
 persist(state,next);audit(state,'core.collx-observation-saved',e,{key:next.key,previous,observation:next.observation});return {key:next.key};
}
export function validateChannelRecords(state){
 if(state.channelRecords===undefined)return;
 if(!Array.isArray(state.channelRecords)||state.channelRecords.length>20000)fail('Invalid channel records.');
 const keys=new Set(),ids=new Set(),urls=new Set(),entityKeys=new Set(entities(state).map(e=>e.key));
 for(const r of state.channelRecords){
  if(!r||r.channel!=='collx'||typeof r.key!=='string'||keys.has(r.key)||!amount(r.priceCents))fail('Invalid CollX record.');keys.add(r.key);if(!entityKeys.has(r.key))fail('Channel card is missing.');
  if(r.priceCents===null){if(r.priceIdentity!==null||r.priceConfirmedAt!==null)fail('Invalid CollX price review.');}
  else if(typeof r.priceIdentity!=='string'||!/^[a-f0-9]{64}$/.test(r.priceIdentity)||!timestamp(r.priceConfirmedAt))fail('Invalid CollX price review.');
  if(r.observation!==null){const o=observation(r.observation);if(r.observation.source!=='owner'||!timestamp(r.observation.checkedAt)||r.observation.url!==o.url||ids.has(o.externalId)||(o.url&&urls.has(o.url)))fail('Invalid CollX listing observation.');ids.add(o.externalId);if(o.url)urls.add(o.url);}
 }
}
export function collxRows(state){
 const records=new Map((state.channelRecords??[]).filter(r=>r.channel==='collx').map(r=>[r.key,r]));
 return entities(state).filter(e=>(e.item??e.draft).kind==='card'||records.has(e.key)).map(e=>{
  const d=e.item??e.draft,r=records.get(e.key),o=r?.observation??null,priceCents=r?.priceCents??null,issues=[];
  const priceNeedsReview=priceCents!==null&&r.priceIdentity!==identity(e);
  if(d.kind!=='card')issues.push('Item type changed; reconcile the saved CollX record');
  if(e.draft?.status==='archived')issues.push('Intake archived');
  if(priceCents===null)issues.push('Set a separate CollX price');else if(priceNeedsReview)issues.push('Review CollX price after identity changes');
  if(!d.location?.trim())issues.push('Storage location needed');
  const available=e.item?remaining(state.inventory,e.item):null;
  if(e.item&&(available<=0||e.item.status==='hold'||e.item.verification!=='verified'))issues.push(o?.status==='active'?'Check and end or adjust the active CollX listing':'Verify availability before listing');
  if(o?.status==='sold')issues.push('Reconcile this reported sale with the Vault');
  if(o?.status==='active'&&priceCents!==null&&o.priceCents!==priceCents)issues.push('Saved CollX price differs from last checked listing');
  const ebayBatches=(state.publicationBatches??[]).filter(b=>b.status!=='cancelled'&&b.entries.some(x=>x.draftId===e.draft?.id));
  const ebayRecorded=ebayBatches.some(b=>['published','publishing'].includes(b.status))||Boolean(e.item?.channel?.toLowerCase()==='ebay'&&e.item.externalId);
  if(ebayRecorded&&['active','sold'].includes(o?.status))issues.push('Check eBay too; cross-channel delisting is not connected');
  return {key:e.key,fingerprint:fingerprint(e,r),sku:d.sku,title:d.title,location:d.location,kind:d.kind,askCents:d.askCents,priceCents,priceNeedsReview,priceConfirmedAt:r?.priceConfirmedAt??null,observation:o,issues,available,ebayRecorded,draftId:e.draft?.id??null,itemId:e.item?.id??null,archived:e.draft?.status==='archived',photos:e.draft?.photos??[],description:e.draft?.description??'',conditionNotes:e.draft?.conditionNotes??'',identity:identityFields.filter(k=>!['sku','kind','title'].includes(k)).map(k=>[k,d[k]??''])};
 });
}
const csvCell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function collxCSV(state){
 const rows=[['Core key','Exact SKU','Title','Location','CollX target price USD','Price confirmed at','Price review needed','CollX listing ID','CollX share URL','Last checked status','Last checked price USD','Checked at','Observation source','Available physical units','Attention']];
 for(const r of collxRows(state))rows.push([r.key,r.sku,r.title,r.location,r.priceCents===null?'':(r.priceCents/100).toFixed(2),r.priceConfirmedAt,r.priceNeedsReview?'yes':'no',r.observation?.externalId,r.observation?.url,r.observation?.status??'untracked',r.observation?.priceCents==null?'':(r.observation.priceCents/100).toFixed(2),r.observation?.checkedAt,r.observation?.source,r.available,r.issues.join('; ')]);
 return rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
