import {skuAliases} from './intake-contract.mjs';
import {validateState,remaining,listingPrice,uid} from './core.mjs';
export function previewEbayRefresh(state,incoming,{complete=false,checksum}={}){
  validateState(state);validateState(incoming);
  if(state.mode!=='work'||incoming.mode!=='work')throw Error('Refresh is available only in working inventory.');
  if(!/^[a-f0-9]{64}$/.test(checksum??''))throw Error('The report checksum is required.');
  const asOf=incoming.importBatches?.[0]?.listingAsOf;
  if(!asOf)throw Error('The report date is required.');
  const last=state.ebayRefresh?.asOf??'2026-10-06';
  if(asOf<last)throw Error('This report is older than the saved eBay snapshot.');
  if((state.importBatches??[]).some(b=>b.id==='ebay-refresh-'+checksum))throw Error('This exact report has already been applied.');
  const report=new Map(incoming.items.map(i=>[i.externalId,i]));
  if(report.size!==incoming.items.length||incoming.items.some(i=>i.channel.toLowerCase()!=='ebay'||!i.externalId))throw Error('Invalid or duplicate eBay listing IDs.');
  const existing=new Map(state.items.filter(i=>i.channel.toLowerCase()==='ebay'&&i.externalId).map(i=>[i.externalId,i]));
  const ids=new Set(state.items.map(i=>i.id)),skus=new Set(state.items.flatMap(skuAliases));
  const added=[],matched=[],missing=[],blocked=[];
  for(const row of incoming.items){
    const item=existing.get(row.externalId);
    if(!item){
      if(ids.has(row.id)||skus.has(row.sku.toLowerCase()))blocked.push({id:row.id,sku:row.sku,title:row.title,reason:'SKU or identity already belongs to another record. Review the relisting; no duplicate added.'});
      else{added.push(row);ids.add(row.id);skus.add(row.sku.toLowerCase());}continue;
    }
    const price=listingPrice(item,'ebay'),latest=item.ebaySnapshot?.asOf??item.source?.asOf??'';
    if(latest>asOf){blocked.push({id:item.id,sku:item.sku,title:item.title,reason:'This record has a newer source date.'});continue;}
    const protectPrice=price.asOf>asOf||(price.source==='Manually recorded in Vault'&&price.asOf>=asOf);
    const available=remaining(state,item),quantityConflict=row.quantity!==available;
    matched.push({id:item.id,row,available,quantityConflict,priceConflict:protectPrice&&price.priceCents!==row.askCents,updatePrice:!protectPrice&&price.priceCents!==row.askCents,protectPrice});
  }
  if(complete)for(const item of existing.values()){
    if(!report.has(item.externalId)&&remaining(state,item)>0&&(item.ebaySnapshot?.asOf??item.source?.asOf??'')<=asOf)missing.push({id:item.id,sku:item.sku,title:item.title});
  }
  return {asOf,complete,checksum,fileName:incoming.importBatches[0].fileName??'eBay report',added,matched,missing,blocked,
    stats:{added:added.length,matched:matched.length,priceUpdates:matched.filter(m=>m.updatePrice).length,priceConflicts:matched.filter(m=>m.priceConflict).length,quantityConflicts:matched.filter(m=>m.quantityConflict).length,missing:missing.length,blocked:blocked.length}};
}
export function applyEbayRefresh(state,plan){
  const next=structuredClone(state),now=new Date().toISOString(),lookup=new Map(next.items.map(i=>[i.id,i]));
  for(const m of plan.matched){
    const item=lookup.get(m.id);if(!item)throw Error('Inventory changed. Preview the report again.');
    item.ebaySnapshot={asOf:plan.asOf,checkedAt:now,status:'active',reportedAvailable:m.row.quantity,reportedPriceCents:m.row.askCents,titleReported:m.row.title,quantityConflict:m.quantityConflict,priceConflict:m.priceConflict,recordedAvailable:m.available};
    if(!m.protectPrice)item.listingPrices={...item.listingPrices,ebay:{priceCents:m.row.askCents,asOf:plan.asOf,source:'eBay active-listings export'}};
    if(m.quantityConflict){item.availability='review';item.ebaySnapshot.reviewReason=`eBay reports ${m.row.quantity} available; Vault recorded ${m.available}. Reconcile physical stock and sales before releasing this record.`;}
  }
  for(const m of plan.missing){
    const item=lookup.get(m.id);item.ebaySnapshot={asOf:plan.asOf,checkedAt:now,status:'missing',reviewReason:'Absent from a report marked complete. Could be ended, sold or relisted. No sale has been inferred.'};item.availability='review';
  }
  for(const row of plan.added){const item=structuredClone(row);item.ebaySnapshot={asOf:plan.asOf,checkedAt:now,status:'active',reportedAvailable:row.quantity,reportedPriceCents:row.askCents,titleReported:row.title,quantityConflict:false,priceConflict:false};next.items.push(item);}
  next.importBatches=[...(next.importBatches??[]),{id:'ebay-refresh-'+plan.checksum,listingAsOf:plan.asOf,importedAt:now,fileName:plan.fileName,complete:plan.complete,stats:plan.stats}];
  next.ebayRefresh={asOf:plan.asOf,importedAt:now,fileName:plan.fileName,complete:plan.complete,checksum:plan.checksum,stats:plan.stats,blocked:plan.blocked};
  next.events.push({id:uid(),at:now,action:'ebay.snapshot-refreshed',entityId:'workspace',detail:{asOf:plan.asOf,...plan.stats}});
  return validateState(next);
}
