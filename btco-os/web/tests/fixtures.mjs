// Deterministic synthetic scale fixture. No production records are embedded.
import {emptyState,makeItem,validateState} from '../domain/core.mjs';
export function seedFixture(){
  const s=emptyState();
  for(let n=0;n<3817;n++){
    const historical=n>=3535, sold=n>=3514&&n<3535;
    s.items.push(makeItem({id:'fixture-'+n,sku:'FIXTURE-'+n,title:'Synthetic collectible '+n,channel:historical?'CDP':'eBay',externalId:historical?'':String(900000000000+n),quantity:n<10?2:1,status:'listed',availability:historical?'review':'tracked',sourceSoldQuantity:sold?1:0,source:{system:historical?'cdp-historical':'ebay-fixture',asOf:'2026-10-06',...(n<2178||historical?{cdpId:'CDP-'+n,cdpSku:'MASTER-'+n}:{}),cdpPurchasePriceReported:n%2?'0.00':'29.00'}}));
  }
  // CDP coverage leaves exactly 1329 available eBay-only records.
  for(let n=2178;n<2185;n++){s.items[n].source.cdpId='CDP-'+n;s.items[n].source.cdpSku='MASTER-'+n;}
  s.externalSales=Array.from({length:21},(_,n)=>({id:'fixture-sale-'+n,itemId:'fixture-'+(3514+n),quantity:1,revenueCents:200,createdAt:'2026-10-10T12:00:00Z'}));
  s.importBatches=[{id:'synthetic-fixture',listingAsOf:'2026-10-06',stats:{remainingSnapshotUnits:3524}}];
  for(let n=0;n<3532;n++)s.items[n].askCents=199+n%100;
  return validateState(s);
}
export function channelFactsFixture(){
  const s=seedFixture();
  return {version:1,cdpAsOf:'2026-09-26',ebayAsOf:'2026-10-06',cdp:Object.fromEntries(s.items.slice(0,2178).map(i=>[i.source.cdpId,{status:'listed',quantity:1,startPriceReported:'2.99'}])),ebay:Object.fromEntries(s.items.slice(0,3532).map(i=>[i.externalId,i.askCents]))};
}
