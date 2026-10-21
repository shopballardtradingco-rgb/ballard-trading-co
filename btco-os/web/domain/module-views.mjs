import {listingPrice} from './core.mjs';
import {cdpSku} from './intake-contract.mjs';

export function marketRows(state){
  return state.items.map(item=>({id:item.id,title:item.title,sku:item.sku,cdpSku:cdpSku(item),externalId:item.externalId,
    ebay:listingPrice(item,'ebay'),collx:listingPrice(item,'collx'),observedStatus:item.ebaySnapshot?.status??'unobserved'}));
}
export function duplicateGroups(state){
  const indexes=new Map();
  for(const item of state.items){
    const keys=[...(item.externalId&&item.channel?['listing:'+item.channel.toLowerCase()+':'+item.externalId]:[]),
      ...(cdpSku(item)?['cdp:'+cdpSku(item)]:[]),
      ...(item.cert&&item.gradeCompany?['cert:'+item.gradeCompany.toLowerCase()+':'+item.cert]:[])];
    for(const key of keys){if(!indexes.has(key))indexes.set(key,[]);indexes.get(key).push(item.id);}
  }
  return [...indexes].filter(([,ids])=>ids.length>1).map(([key,ids])=>({key,ids}));
}
export function reconciliationRows(state){
  return state.items.flatMap(item=>{
    const o=item.ebaySnapshot,reasons=[];
    if(o?.status==='missing')reasons.push('Missing from active feed');
    if(o?.quantityConflict)reasons.push('Quantity differs');
    if(o?.skuConflict)reasons.push('SKU needs review');
    if(o?.priceConflict)reasons.push('Manual price protected');
    if(item.availability==='review')reasons.push('Inventory held for review');
    return reasons.length?[{id:item.id,title:item.title,sku:item.sku,reasons}]:[];
  });
}
