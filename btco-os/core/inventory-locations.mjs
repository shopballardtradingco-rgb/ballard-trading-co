import {createHash} from 'node:crypto';
import {makeItem,validateItem} from '../web/domain/core.mjs';
import {normalizeLocation,locationLabel,locationStatus,sameLocation,inventorySearchText,locationFields} from './public/locations.mjs';
export {normalizeLocation,locationLabel,locationStatus};
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status});};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const text=v=>typeof v==='string'&&v.length<=4000;
export function checkedRaw(raw){
 if(!raw||Array.isArray(raw)||typeof raw!=='object'||Object.keys(raw).length>100||Object.entries(raw).some(([k,v])=>!k||k.length>100||!text(v)))fail('Invalid original export fields.');
 return structuredClone(raw);
}
export function identifiers(state,item){
 const ids=[{channel:'cdp',kind:'sku',value:item.source?.cdpSku??item.cdpLink?.sku??item.sku},...(item.identifiers??[])];
 if(item.source?.cdpId)ids.push({channel:'cdp',kind:'id',value:item.source.cdpId});
 const ebay=item.ebayPublication?.itemId??(item.channel?.toLowerCase()==='ebay'?item.externalId:'');
 if(ebay)ids.push({channel:'ebay',kind:'id',value:ebay});
 for(const r of state.channelRecords??[]){const d=state.drafts.find(d=>r.key==='draft:'+d.id);if((r.key==='item:'+item.id||d?.itemId===item.id)&&r.observation?.externalId)ids.push({channel:r.channel,kind:'id',value:r.observation.externalId});}
 return ids.filter(r=>r.value);
}
export function resolveInventory(state,{channel,kind,value,query}={}){
 if(value!==undefined&&(!text(value)||!value.trim()))fail('Use an exact identifier.');
 let matches=state.inventory.items.filter(i=>value!==undefined?identifiers(state,i).some(r=>(!channel||r.channel===channel)&&(!kind||r.kind===kind)&&r.value===value):!query||inventorySearchText(i).includes(String(query).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()));
 return {status:matches.length===1?'matched':matches.length?'ambiguous':'unmatched',matches:matches.map(i=>({itemId:i.id,sku:i.sku,title:i.title,location:i.location,physicalLocation:i.physicalLocation??null,locationStatus:i.locationConflicts?.length?'conflict':locationStatus(i.physicalLocation,i.location),identifiers:identifiers(state,i)}))};
}
export function linkIdentifier(state,{itemId,channel,kind,value,evidence}){
 if(!['collx','ebay','cdp','hipcomic','mercari'].includes(channel)||!['id','sku'].includes(kind)||!text(value)||!value.trim()||value!==value.trim()||!text(evidence)||!evidence.trim())fail('An exact identifier and matching evidence are required.');
 const item=state.inventory.items.find(i=>i.id===itemId);if(!item)fail('Inventory record not found.',404);
 const matches=resolveInventory(state,{channel,kind,value}).matches;
 if(matches.some(i=>i.itemId!==itemId))fail('That identifier belongs to another inventory record.',409);
 if(matches.length)return {itemId,replayed:true};
 if(identifiers(state,item).some(r=>r.channel===channel&&r.kind===kind&&r.value!==value))fail('A different identifier is already linked; reconcile it before replacement.',409);
 (item.identifiers??=[]).push({channel,kind,value,evidence,linkedAt:new Date().toISOString()});
 return {itemId};
}
export function migrateCDP(state,input){
 if(!input||!stamp(input.observedAt)||Date.parse(input.observedAt)>Date.now()+300000||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>20000)fail('A dated CDP inventory export is required.');
 const rows=input.rows.map(checkedRaw);if(rows.some(r=>!Object.hasOwn(r,'ID')||!Object.hasOwn(r,'SKU')||!Object.hasOwn(r,'Title')))fail('Use the original CDP inventory export with ID, SKU and Title.');
 const fingerprint=hash(input),previous=(state.locationImports??[]).find(r=>r.fingerprint===fingerprint);
 if(previous)return {...previous,replayed:true};
 if(input.observedAtBasis!==undefined&&!text(input.observedAtBasis))fail('Invalid observation provenance.');
 const report={fingerprint,observedAt:input.observedAt,observedAtBasis:input.observedAtBasis??'Owner-supplied export date',rows:rows.length,created:0,enriched:0,unchanged:0,exceptions:[]};
 const ids=new Map(),skus=new Map();for(const r of rows){ids.set(r.ID,(ids.get(r.ID)??0)+1);skus.set(r.SKU.toLowerCase(),(skus.get(r.SKU.toLowerCase())??0)+1);}
 for(const [index,raw] of rows.entries()){
  const issue=reason=>report.exceptions.push({row:index+2,cdpId:raw.ID,sku:raw.SKU,reason});
  if(!raw.ID.trim()||!raw.SKU.trim()||!raw.Title.trim()||ids.get(raw.ID)>1||skus.get(raw.SKU.toLowerCase())>1){issue('Missing or duplicate CDP ID / master SKU / title');continue;}
  const byId=state.inventory.items.filter(i=>String(i.source?.cdpId??'')===raw.ID);
  const bySku=state.inventory.items.filter(i=>[i.sku,i.source?.cdpSku,i.cdpLink?.sku].filter(Boolean).some(s=>s.toLowerCase()===raw.SKU.toLowerCase()));
  const matches=[...new Set([...byId,...bySku])];
  if(matches.length>1){issue('CDP ID and master SKU resolve to different or duplicate Core records');continue;}
  let item=matches[0];
  if(item&&(item.sku!==raw.SKU||(item.source?.cdpSku&&item.source.cdpSku!==raw.SKU)||(item.source?.cdpId&&String(item.source.cdpId)!==raw.ID))){issue('Existing master identity conflicts; preserved without changes');continue;}
  const location=normalizeLocation(raw,'cdp'),label=locationLabel(location);
  if(!item){
   if(!/^\d{1,6}$/.test(raw.Quantity??'')){issue('Invalid or missing inventory quantity');continue;}
   const qty=Number(raw.Quantity);
   item=makeItem({sku:raw.SKU,title:raw.Title,subject:raw.Player??'',year:raw.Year??'',setName:raw.Set??'',number:raw.Number??'',serial:raw['Serial Number']??'',gradeCompany:raw.Grader??'',grade:raw.Grade??'',cert:raw['Cert Number']??'',kind:/comic/i.test(raw.Sport??'')?'comic':'card',quantity:qty,availability:qty?'tracked':'review',location:label,physicalLocation:location,source:{system:'cdp-migration',cdpId:raw.ID,cdpSku:raw.SKU,asOf:input.observedAt,cdpPurchasePriceReported:raw['Purchase Price']??''},cdpMigration:{observedAt:input.observedAt,observedAtBasis:report.observedAtBasis,raw}});
   // Source costs and prices remain exact evidence. They are not new reviewed financial allocations.
   item.orderSyncAfter=input.observedAt;
   validateItem(item);state.inventory.items.push(item);report.created++;
  }else{
   if(item.cdpMigration&&Date.parse(input.observedAt)<Date.parse(item.cdpMigration.observedAt)){issue('Older migration observation; existing record preserved');continue;}
   let conflict=false;
   const existing=item.physicalLocation;
   if(label&&item.location&&(!existing||!sameLocation(existing,location))&&item.location!==label&&item.location!==locationFields.map(k=>location[k]).join('/')){
    const entry={source:'cdp',observedAt:input.observedAt,location,previous:item.location};
    if(!(item.locationConflicts??[]).some(c=>sameLocation(c.location,location)&&c.previous===item.location))(item.locationConflicts??=[]).push(entry);
    conflict=true;issue('Location conflict; existing location retained');
   }
   const before=JSON.stringify(item);
   if(!conflict&&label){if(!item.location)item.location=label;if(!item.physicalLocation)item.physicalLocation=location;}
   item.source={...item.source,cdpId:raw.ID,cdpSku:raw.SKU};
   if(!item.cdpMigration)item.cdpMigration={observedAt:input.observedAt,raw};
   // Existing quantity, costs, status, master SKU, and owner edits never change on reimport.
   if(JSON.stringify(item)!==before)report.enriched++;else report.unchanged++;
  }
  if(locationStatus(location)==='missing')issue('CDP location missing');else if(locationStatus(location)==='partial')issue('CDP location incomplete');
 }
 (state.locationImports??=[]).push(report);return report;
}
export function locationAudit(state){
 const missing=[],partial=[],conflicts=[],keys=new Map();
 for(const i of state.inventory.items){const entry={itemId:i.id,sku:i.sku,title:i.title,location:i.location};const status=locationStatus(i.physicalLocation,i.location);if(status==='missing')missing.push(entry);if(['partial','unstructured'].includes(status))partial.push({...entry,status});if(i.locationConflicts?.length)conflicts.push({...entry,observations:i.locationConflicts});
  for(const r of identifiers(state,i)){const key=JSON.stringify([r.channel,r.kind,r.value]),set=keys.get(key)??new Set();set.add(i.id);keys.set(key,set);}
 }
 const duplicateIdentifiers=[...keys].filter(([,v])=>v.size>1).map(([k,v])=>({identifier:JSON.parse(k),itemIds:[...v]}));
 return {total:state.inventory.items.length,missing,partial,conflicts,duplicateIdentifiers,imports:state.locationImports??[]};
}
export function validateLocations(state){
 for(const i of state.inventory.items){
  if(i.physicalLocation){const p=i.physicalLocation;if([...locationFields,'detail','source'].some(k=>!text(p[k])))fail('Invalid physical location.');checkedRaw(p.raw);}
  if(i.cdpMigration){if(!stamp(i.cdpMigration.observedAt))fail('Invalid migration date.');checkedRaw(i.cdpMigration.raw);}
  if(i.identifiers!==undefined&&(!Array.isArray(i.identifiers)||i.identifiers.some(r=>!['cdp','collx','ebay','mercari','hipcomic'].includes(r.channel)||!['id','sku'].includes(r.kind)||!text(r.value)||!r.value||!text(r.evidence)||!stamp(r.linkedAt))))fail('Invalid linked identifier.');
 }
}

// Both fields must agree with the retained CDP source row; aliases and titles alone are not identity.
export function reconcileEbayLinks(state){
 const byKey=new Map();
 for(const i of state.inventory.items){const r=i.cdpMigration?.raw;if(!r)continue;const k=JSON.stringify([r.SKU,r.Title]);const group=byKey.get(k)??[];group.push(i);byKey.set(k,group);}
 const feed=state.marketplaceMirror?.sources.ebay;if(!feed)return {linked:0,unlinked:0,conflicts:[]};
 const candidates=[...feed.records.filter(r=>!r.variationReview),...(feed.orders?.records??[]).flatMap(o=>o.lines.filter(l=>l.itemId).map(l=>({id:l.itemId,sku:l.sku,title:l.title})))];
 const eligible=[...new Map(candidates.map(r=>[JSON.stringify([r.id,r.sku,r.title]),r])).values()],byListing=new Map();
 for(const r of eligible){const k=JSON.stringify([r.sku,r.title]);const group=byListing.get(k)??[];group.push(r);byListing.set(k,group);}
 const result={linked:0,unlinked:0,conflicts:[]};
 for(const [k,rows] of byListing){const items=byKey.get(k)??[];
  if(rows.length!==1||items.length!==1){result.unlinked+=rows.length;continue;}
  const item=items[0],r=rows[0];
  try{const added=linkIdentifier(state,{itemId:item.id,channel:'ebay',kind:'id',value:r.id,evidence:'Exact CDP master SKU and exact CDP export title agree with eBay observation at '+feed.observedAt});if(!added.replayed)result.linked++;}catch(e){result.conflicts.push({itemId:item.id,ebayId:r.id,reason:e.message});}
 }
 return result;
}
