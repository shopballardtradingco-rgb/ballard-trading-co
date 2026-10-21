import {validateIntakeState,intakeRecords,INTAKE_ACTIONS,cdpSku,skuAliases} from './intake-contract.mjs';
// Framework-independent Vault domain. Money is integer USD cents.
export const VERSION = 1;
export const TYPES = ['card', 'comic', 'bulk', 'other'];
export const STATUSES = ['intake', 'ready', 'listed', 'hold'];
export const VERIFY = ['unverified', 'verified', 'awaiting'];
export const uid = () => crypto.randomUUID();
const fail = message => { throw new Error(message); };
export const money = c => c == null ? 'Unknown' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
export function cents(value, optional=false) {
  const s=String(value??'').trim();
  if (!s && optional) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) fail('Enter a positive dollar amount or 0, with no more than two decimal places.');
  const [whole, decimal='']=s.split('.');
  return Number(whole)*100+Number(decimal.padEnd(2,'0'));
}
export const emptyState = (mode='work') => ({schemaVersion:VERSION, workspace: mode==='demo'?'btco-demo':'btco-local', mode, revision:0, items:[], sales:[], events:[]});
export function remaining(state, item) { return item.availability==='review'?0:item.quantity-(item.sourceSoldQuantity??0)-state.sales.filter(s=>s.itemId===item.id&&!s.voidedAt).reduce((n,s)=>n+s.quantity,0); }
export function status(state,item) { return item.availability==='review'?'review':remaining(state,item)===0?'sold':item.status; }
export function profit(sale) {
  if(sale.cogsCents==null) return null;
  return sale.revenueCents+sale.shippingCollectedCents-sale.cogsCents-sale.sellingFeeCents-sale.promoFeeCents-sale.postageCents-sale.suppliesCents-sale.refundCents;
}
export function remainingCost(state,item) {
  if(item.costCents==null || item.availability==='review') return null;
  return item.costCents-state.sales.filter(s=>s.itemId===item.id&&!s.voidedAt).reduce((n,s)=>n+(s.cogsCents??0),0);
}
export function summary(state) {
  const active=state.items.filter(i=>remaining(state,i)>0), sales=state.sales.filter(s=>!s.voidedAt);
  const known=sales.filter(s=>profit(s)!=null);
  return {units:active.reduce((n,i)=>n+remaining(state,i),0), skus:active.length,
    cost:active.reduce((n,i)=>n+(remainingCost(state,i)??0),0), unknownCosts:active.filter(i=>i.costCents==null).length,
    listed:active.filter(i=>i.status==='listed').length, ready:active.filter(i=>i.status==='ready').length,
    unverified:active.filter(i=>i.verification!=='verified').length,
    sales:sales.length, net:known.reduce((n,s)=>n+profit(s),0), unknownProfit:sales.length-known.length,
    review:state.items.filter(i=>i.availability==='review').length,externalSales:(state.externalSales??[]).length};
}
const textFields=['id','sku','title','kind','location','subject','year','setName','number','parallel','serial','gradeCompany','grade','cert','notes','vendor','acquisitionRef','acquiredDate','status','verification','channel','externalId'];
function integer(n,low=0) { return Number.isSafeInteger(n)&&n>=low&&n<=100_000_000_000; }
function validId(s) {return typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);}
function validDate(s) {return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function validateItem(i) {
  for(const f of textFields) if(typeof i[f]!=='string'||i[f].length>4000) fail(`Invalid item field: ${f}`);
  if(!validId(i.id)||!i.sku.trim()||!i.title.trim()) fail('Valid ID, title and SKU are required.');
  if(!TYPES.includes(i.kind)||!STATUSES.includes(i.status)||!VERIFY.includes(i.verification)) fail('Invalid inventory classification.');
  if(!integer(i.quantity,i.availability==='review'?0:1)||i.quantity>1_000_000) fail('Quantity must be a whole number; only review records may have zero units.');
  if(i.availability!==undefined&&!['tracked','review'].includes(i.availability)) fail('Invalid inventory reconciliation state.');
  if(i.sourceSoldQuantity!==undefined&&(!integer(i.sourceSoldQuantity)||i.sourceSoldQuantity>i.quantity)) fail('Invalid imported sold quantity.');
  if((i.sourceSoldQuantity??0)>0&&i.costCents!==null) fail('Imported sale costs need a financial reconciliation before a cost can be assigned.');
  if(i.source!==undefined&&(!i.source||typeof i.source!=='object'||Array.isArray(i.source))) fail('Invalid source provenance.');
  for(const f of ['costCents','askCents']) if(i[f]!==null&&!integer(i[f])) fail(`Invalid amount: ${f}`);
  if(i.listingPrices!==undefined){
    if(!i.listingPrices||typeof i.listingPrices!=='object'||Array.isArray(i.listingPrices))fail('Invalid listing prices.');
    for(const [channel,p] of Object.entries(i.listingPrices)){
      if(!['ebay','collx'].includes(channel)||!p||typeof p!=='object'||(p.priceCents!==null&&!integer(p.priceCents))||typeof p.source!=='string'||p.source.length>200||typeof p.asOf!=='string'||(p.asOf&&!validDate(p.asOf)))fail('Invalid channel listing price.');
    }
  }
  if(typeof i.autograph!=='boolean') fail('Invalid autograph field.');
  if(i.acquiredDate&&!validDate(i.acquiredDate)) fail('Invalid acquisition date.');
  return i;
}
export function makeItem(input={}) {
  return {...Object.fromEntries(textFields.map(f=>[f,''])),id:uid(),sku:'',kind:'card',status:'intake',verification:'unverified',quantity:1,autograph:false,costCents:null,askCents:null,...input};
}
// Unknown prices stay null. A legacy asking price belongs only to its named channel.
export function listingPrice(item,channel){
  if(Object.hasOwn(item.listingPrices??{},channel))return item.listingPrices[channel];
  return {priceCents:item.channel.trim().toLowerCase()===channel?item.askCents:null,asOf:'',source:item.channel.trim().toLowerCase()===channel&&item.askCents!==null?'Existing Vault record':''};
}
export function updateListingPrices(item,prices,asOf){
  const result=structuredClone(item.listingPrices??{});
  for(const [channel,priceCents] of Object.entries(prices)){
    const previous=listingPrice(item,channel);
    result[channel]=priceCents!==previous.priceCents?{priceCents,asOf,source:'Manually recorded in Vault'}:structuredClone(previous);
  }
  return result;
}
export function isEbayOnlyOpen(state,item){
  return item.channel.trim().toLowerCase()==='ebay'&&!item.source?.cdpId&&!item.cdpLink&&remaining(state,item)>0;
}
export function applyChannelFacts(state,facts){
  if(facts.version!==1||!facts.cdp||!facts.ebay||!validDate(facts.cdpAsOf)||!validDate(facts.ebayAsOf))fail('Unsupported channel source details.');
  if(state.channelFactsVersion===facts.version)return state;
  const next=structuredClone(state);let enriched=0;
  for(const item of next.items){
    let changed=false;
    const row=facts.cdp[item.source?.cdpId];
    if(row){
      const additions={cdpCollxStatus:row.status,cdpCollxQuantity:row.quantity,cdpStartPriceReported:row.startPriceReported,cdpChannelAsOf:facts.cdpAsOf};
      for(const [key,value] of Object.entries(additions))if(item.source[key]===undefined){item.source[key]=value;changed=true;}
    }
    // Only attach source attribution when the retained price still matches the export.
    // Local prices, quantities, costs, and workflow decisions are never overwritten.
    if(item.channel.trim().toLowerCase()==='ebay'&&Object.hasOwn(facts.ebay,item.externalId)&&item.askCents===facts.ebay[item.externalId]&&!Object.hasOwn(item.listingPrices??{},'ebay')){
      item.listingPrices={...item.listingPrices,ebay:{priceCents:item.askCents,asOf:facts.ebayAsOf,source:'eBay active-listings export'}};changed=true;
    }
    if(changed)enriched++;
  }
  next.channelFactsVersion=facts.version;
  audit(next,'listing.sources.added','workspace',{enriched,sourceVersion:facts.version});
  return validateState(next);
}
function audit(state,action,entityId,detail) {
  state.events.push({id:uid(),at:new Date().toISOString(),action,entityId,detail:structuredClone(detail)});
}
export function saveItem(state,input) {
  const next=structuredClone(state), item=validateItem(structuredClone(input));
  if(next.items.some(i=>i.id!==item.id&&i.sku.toLowerCase()===item.sku.toLowerCase())) fail('That SKU already exists. Choose a unique SKU.');
  const index=next.items.findIndex(i=>i.id===item.id), old=next.items[index];
  if(old && (next.sales.some(s=>s.itemId===old.id&&!s.voidedAt)||(old.sourceSoldQuantity??0)>0) && (item.quantity!==old.quantity||item.costCents!==old.costCents)) fail('Quantity and acquisition cost are locked while this item has recorded sales. Imported sales need a financial reconciliation.');
  if(old?.availability==='review'&&item.availability!=='review'&&item.verification!=='verified') fail('Physically verify this historical item before counting it as available stock.');
  if(old) next.items[index]=item; else next.items.push(item);
  audit(next,old?'item.updated':'item.created',item.id,{before:old??null,after:item});
  return next;
}
export const saleAmounts=['revenueCents','shippingCollectedCents','sellingFeeCents','promoFeeCents','postageCents','suppliesCents','refundCents'];
function validateSale(s) {
  if(!s||!validId(s.id)||!validId(s.itemId)||!integer(s.quantity,1)||!validDate(s.date)) fail('Invalid sale record.');
  for(const f of saleAmounts) if(!integer(s[f])) fail(`Actual ${f} is required; enter 0 if none.`);
  if(s.cogsCents!==null&&!integer(s.cogsCents)) fail('Invalid sale cost snapshot.');
  for(const f of ['channel','reference','notes']) if(typeof s[f]!=='string'||s[f].length>4000) fail('Invalid sale details.');
  if(s.voidedAt!==null&&(typeof s.voidedAt!=='string'||isNaN(Date.parse(s.voidedAt)))) fail('Invalid sale reversal.');
}
export function recordSale(state,input) {
  const next=structuredClone(state), item=next.items.find(i=>i.id===input.itemId);
  if(!item) fail('Item not found.');
  if(item.verification==='awaiting') fail('Receive this item before recording a sale.');
  if(!integer(input.quantity,1)||input.quantity>remaining(next,item)) fail('Sale quantity exceeds available stock.');
  const sold=item.quantity-remaining(next,item);
  const used=next.sales.filter(s=>s.itemId===item.id&&!s.voidedAt).reduce((n,s)=>n+(s.cogsCents??0),0);
  // Proportional allocation, with all remaining cents assigned to the final sale.
  const cogs=item.costCents==null?null:Number(BigInt(item.costCents-used)*BigInt(input.quantity)/BigInt(item.quantity-sold));
  const sale={...input,id:uid(),cogsCents:cogs,voidedAt:null};
  validateSale(sale); next.sales.push(sale); audit(next,'sale.recorded',sale.id,{itemId:item.id,quantity:sale.quantity});
  return next;
}
export function voidSale(state,id) {
  const next=structuredClone(state), sale=next.sales.find(s=>s.id===id);
  if(!sale||sale.voidedAt) fail('This sale has already been voided or is missing.');
  sale.voidedAt=new Date().toISOString(); audit(next,'sale.voided',id,{reason:'Correction: stock and cost restored. No external refund or restock performed.'});
  return next;
}
export function validateState(s) {
  if(!s||s.schemaVersion!==VERSION||!['work','demo'].includes(s.mode)||s.workspace!==(s.mode==='demo'?'btco-demo':'btco-local')) fail('This is not a supported BTCo OS v1 backup.');
  if(!integer(s.revision)||!Array.isArray(s.items)||!Array.isArray(s.sales)||!Array.isArray(s.events)) fail('Invalid backup structure.');
  if(s.items.length>50000||s.sales.length>100000||s.events.length>200000) fail('Backup exceeds prototype capacity.');
  const ids=new Set(),skus=new Set();
  for(const i of s.items) { validateItem(i); if(ids.has(i.id)||skus.has(i.sku.toLowerCase())) fail('Backup contains duplicate IDs or SKUs.'); ids.add(i.id);skus.add(i.sku.toLowerCase()); }
  const saleIds=new Set();
  for(const sale of s.sales) {validateSale(sale);if(saleIds.has(sale.id)||!ids.has(sale.itemId)) fail('Duplicate or orphan sale in backup.');saleIds.add(sale.id);}
  for(const item of s.items) {
    if(remaining(s,item)<0) fail('Backup contains oversold stock.');
    const live=s.sales.filter(x=>x.itemId===item.id&&!x.voidedAt);
    if(live.some(x=>(item.costCents===null)!==(x.cogsCents===null))) fail('Inconsistent acquisition cost in backup.');
    const used=live.reduce((n,x)=>n+(x.cogsCents??0),0);
    if(item.costCents!==null&&(used>item.costCents||(item.availability!=='review'&&remaining(s,item)===0&&used!==item.costCents))) fail('Inconsistent cost allocations in backup.');
  }
  if(s.externalSales!==undefined){
    if(!Array.isArray(s.externalSales)||s.externalSales.length>100000) fail('Invalid external sales.');
    const externalIds=new Set(),totals=new Map();
    for(const sale of s.externalSales){
      if(!validId(sale.id)||externalIds.has(sale.id)||!ids.has(sale.itemId)||!integer(sale.quantity,1)||!integer(sale.revenueCents)||typeof sale.createdAt!=='string'||isNaN(Date.parse(sale.createdAt))) fail('Invalid imported sale evidence.');
      externalIds.add(sale.id);totals.set(sale.itemId,(totals.get(sale.itemId)??0)+sale.quantity);
    }
    for(const i of s.items)if((i.sourceSoldQuantity??0)!==(totals.get(i.id)??0)) fail('Imported sales and source quantities do not reconcile.');
  }else if(s.items.some(i=>(i.sourceSoldQuantity??0)>0))fail('Missing imported sales evidence.');
  if(s.importBatches!==undefined&&(!Array.isArray(s.importBatches)||s.importBatches.some(b=>!b||!validId(b.id)||typeof b.listingAsOf!=='string'||!b.stats||typeof b.stats!=='object'||(b.limitations!==undefined&&(!Array.isArray(b.limitations)||b.limitations.some(v=>typeof v!=='string'))))))fail('Invalid import provenance.');
  if(s.events.some(e=>!e||!validId(e.id)||typeof e.action!=='string'||!validId(e.entityId)||typeof e.at!=='string'||isNaN(Date.parse(e.at)))) fail('Invalid audit log.');
  validateIntakeState(s);
  return s;
}
export function previewImport(state,incoming) {
  validateState(incoming);
  if(state.mode!==incoming.mode) fail('Demo backups cannot be imported into working inventory, or vice versa.');
  const accepted=[],skipped=[],idsPresent=new Set(state.items.map(i=>i.id)),skusPresent=new Set(state.items.flatMap(skuAliases)),externalPresent=new Set(state.items.filter(i=>i.channel&&i.externalId).map(i=>i.channel.toLowerCase()+':'+i.externalId));
  for(const i of incoming.items) (idsPresent.has(i.id)||skuAliases(i).some(sku=>skusPresent.has(sku))||(i.channel&&i.externalId&&externalPresent.has(i.channel.toLowerCase()+':'+i.externalId))?skipped:accepted).push(i);
  const ids=new Set(accepted.map(i=>i.id));
  const sales=incoming.sales.filter(s=>ids.has(s.itemId));
  if(sales.some(s=>state.sales.some(x=>x.id===s.id))) fail('Conflicting sale ID; no data was imported.');
  const externalSales=(incoming.externalSales??[]).filter(s=>ids.has(s.itemId));
  if(externalSales.some(s=>(state.externalSales??[]).some(x=>x.id===s.id))) fail('Conflicting imported sale ID.');
  const priorIntakes=intakeRecords(state),incomingIntakes=intakeRecords(incoming),availableItems=[...state.items,...accepted];
  const acceptedIntakes=incomingIntakes.filter(r=>!priorIntakes.some(old=>old.id===r.id||(r.evidence&&old.evidence?.scanId===r.evidence.scanId)));
  for(const r of acceptedIntakes)if(r.status==='linked'&&!availableItems.some(i=>i.id===r.linkedItemId&&cdpSku(i).toLowerCase()===r.cdpSku.toLowerCase()))fail('A linked intake conflicts with current inventory. Preserve this backup and reconcile the CDP record first.');
  return {accepted,skipped,sales,externalSales,acceptedIntakes,skippedIntakes:incomingIntakes.length-acceptedIntakes.length};
}
export function mergeImport(state,incoming) {
  const p=previewImport(state,incoming), next=structuredClone(state);
  next.items.push(...structuredClone(p.accepted)); next.sales.push(...structuredClone(p.sales));
  if(p.accepted.length)delete next.channelFactsVersion;
  next.externalSales=[...(next.externalSales??[]),...structuredClone(p.externalSales)];
  next.importBatches=[...(next.importBatches??[]),...structuredClone((incoming.importBatches??[]).filter(b=>!(next.importBatches??[]).some(x=>x.id===b.id)))];
  const intakeIds=new Set(p.acceptedIntakes.map(r=>r.id)),ids=new Set(p.accepted.map(i=>i.id)),saleIds=new Set(p.sales.map(s=>s.id)),eventIds=new Set(next.events.map(e=>e.id));
  next.events.push(...structuredClone(incoming.events.filter(e=>(ids.has(e.entityId)||saleIds.has(e.entityId)||(INTAKE_ACTIONS.includes(e.action)&&intakeIds.has(e.entityId)))&&!eventIds.has(e.id))));
  audit(next,'backup.imported','workspace',{added:p.accepted.length,skipped:p.skipped.length,intakes:p.acceptedIntakes.length});
  return validateState(next);
}
export function loadState(storage,key,mode) {
  const raw=storage.getItem(key); if(raw===null) return mode==='demo'?demoState():emptyState(mode);
  let result;try{result=JSON.parse(raw);}catch{fail('Saved data could not be read. It has been preserved. Export the raw backup before repairing it.');}
  validateState(result); if(result.mode!==mode) fail('Workspace mismatch. Saved data has been preserved.');return result;
}
export function commitState(storage,key,previous,next) {
  const raw=storage.getItem(key), latest=raw===null?null:JSON.parse(raw);
  if(latest&&latest.revision!==previous.revision) fail('Another tab changed this inventory. Reload before saving; your existing data is safe.');
  const stored=validateState({...next,revision:previous.revision+1});
  storage.setItem(key,JSON.stringify(stored)); // Caller updates UI state only after this succeeds.
  return stored;
}
function csvCell(v) {const s=String(v??'');return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';}
export function inventoryCSV(state) {
  const headers=['SKU','Title','Type','Subject','Year','Set','Number','Parallel','Serial','Autograph verified','Grader','Grade','Cert','Recorded reference quantity','Quantity available','Location','Physical verification','Status','Channel','External listing ID','Acquisition reference','Vendor','Acquired date','Total allocated acquisition cost USD','Remaining cost USD','Asking price per unit USD','Notes','Source date','CDP purchase price UNCONFIRMED','Imported sold quantity','eBay listing price USD','eBay price date','eBay price source','CollX listing price USD','CollX price date','CollX price source','CDP CollX status','CDP CollX status date','CDP master SKU','CDP link basis'];
  const dollars=v=>v==null?'':(v/100).toFixed(2);
  return [headers,...state.items.map(i=>[i.sku,i.title,i.kind,i.subject,i.year,i.setName,i.number,i.parallel,i.serial,i.autograph?'yes':'no',i.gradeCompany,i.grade,i.cert,i.quantity,remaining(state,i),i.location,i.verification,status(state,i),i.channel,i.externalId,i.acquisitionRef,i.vendor,i.acquiredDate,dollars(i.costCents),dollars(remainingCost(state,i)),dollars(i.askCents),i.notes,i.source?.asOf??'',i.source?.cdpPurchasePriceReported??'',i.sourceSoldQuantity??0,dollars(listingPrice(i,'ebay').priceCents),listingPrice(i,'ebay').asOf,listingPrice(i,'ebay').source,dollars(listingPrice(i,'collx').priceCents),listingPrice(i,'collx').asOf,listingPrice(i,'collx').source,i.source?.cdpCollxStatus??'',i.source?.cdpChannelAsOf??'',cdpSku(i),i.cdpLink?'Manually confirmed':i.source?.cdpSku?'Imported source':''])].map(r=>r.map(csvCell).join(',')).join('\r\n');
}
export function salesCSV(state) {
  const headers=['Sale ID','SKU','Date','Channel','Reference','Quantity','Item proceeds USD','Shipping collected USD','COGS USD','Selling fees USD','Promotion USD','Postage USD','Supplies USD','Refund USD','Net profit USD','Voided at'];
  const dollars=v=>v==null?'':(v/100).toFixed(2);
  return [headers,...state.sales.map(s=>[s.id,state.items.find(i=>i.id===s.itemId)?.sku,s.date,s.channel,s.reference,s.quantity,...[s.revenueCents,s.shippingCollectedCents,s.cogsCents,s.sellingFeeCents,s.promoFeeCents,s.postageCents,s.suppliesCents,s.refundCents,profit(s)].map(dollars),s.voidedAt??''])].map(r=>r.map(csvCell).join(',')).join('\r\n');
}
export function demoState() {
  let s=emptyState('demo');
  const samples=[
    {sku:'DEMO-001',title:'Ken Griffey Jr. · Chrome refractor',subject:'Ken Griffey Jr.',year:'1990s',setName:'Sample card',parallel:'Refractor',costCents:1200,askCents:2500,status:'listed',verification:'verified',location:'Office / Card box A / Row 1',channel:'eBay'},
    {sku:'DEMO-002',title:'Modern Batman · Variant cover',kind:'comic',subject:'Batman',number:'1',parallel:'Variant',costCents:800,askCents:2400,status:'ready',verification:'verified',location:'Closet / Comic short box 01'},
    {sku:'DEMO-003',title:'Prospect autograph · First Chrome',subject:'Sample prospect',setName:'Bowman Chrome',autograph:true,costCents:650,askCents:1800,status:'hold',verification:'verified',location:'Office / Prospect box'},
    {sku:'DEMO-004',title:'Basketball rookie · Graded 9',subject:'Sample player',gradeCompany:'PSA',grade:'9',cert:'DEMO-CERT',costCents:2400,askCents:4800,status:'listed',verification:'unverified',location:'Office / Slab case',channel:'eBay'},
    {sku:'DEMO-005',title:'1990s basketball · 100-card lot',kind:'bulk',subject:'Basketball',costCents:500,askCents:2000,status:'intake',verification:'verified',location:'Closet / Unsorted box',notes:'One sellable lot containing 100 cards. Fictional sample.'},
    {sku:'DEMO-006',title:'Numbered baseball parallel · /199',subject:'Sample player',parallel:'Aqua',serial:'001/199',costCents:null,askCents:2200,status:'intake',verification:'unverified',location:'Receiving tray'},
    {sku:'DEMO-007',title:'Modern comic · Reader copy',kind:'comic',subject:'Sample series',costCents:200,askCents:1200,status:'ready',verification:'verified',location:'Closet / Comic short box 02'},
    {sku:'DEMO-008',title:'Premium insert · Incoming',costCents:400,askCents:1200,status:'intake',verification:'awaiting',location:'In transit'}
  ];
  for(const x of samples) s=saveItem(s,makeItem({...x,acquisitionRef:'DEMO PURCHASE',vendor:'Fictional supplier',acquiredDate:'2026-10-01',notes:x.notes??'Illustrative data only. Not actual BTCo inventory.'}));
  s=recordSale(s,{itemId:s.items[6].id,date:'2026-10-10',quantity:1,channel:'eBay',reference:'DEMO SALE',notes:'Fictional example',revenueCents:1200,shippingCollectedCents:200,sellingFeeCents:226,promoFeeCents:60,postageCents:150,suppliesCents:35,refundCents:0});
  return s;
}
