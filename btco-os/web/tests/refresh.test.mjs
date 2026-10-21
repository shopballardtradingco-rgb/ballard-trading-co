import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,makeItem,saveItem,listingPrice,remaining,recordSale} from '../domain/core.mjs';
import {ebayCSVState} from '../domain/ebay-import.mjs';
import {previewEbayRefresh,applyEbayRefresh} from '../domain/ebay-refresh.mjs';
const checksum='a'.repeat(64);
const report=(rows,date='2026-10-11')=>ebayCSVState('Item number,Title,Custom label (SKU),Available quantity,Currency,Current price,Sold quantity\n'+rows,{asOf:date,fileName:'eBay.csv'});
const fixture=()=>saveItem(emptyState(),makeItem({id:'ebay-820123456789',sku:'A',title:'My verified title',channel:'eBay',externalId:'820123456789',quantity:2,askCents:500,costCents:300,location:'Box A',verification:'verified',source:{system:'ebay-export',asOf:'2026-10-06'}}));
test('refresh adds new records and updates eBay prices while preserving costs, identity and CollX',()=>{
  const s=fixture();s.items[0].listingPrices={collx:{priceCents:450,asOf:'2026-10-10',source:'Manual'}};
  const before=JSON.stringify(s),p=previewEbayRefresh(s,report('820123456789,Reported title,A,2,USD,6.99,9\n820987654321,New item,B,1,USD,3.99,0'),{checksum});
  assert.equal(p.stats.added,1);assert.equal(p.stats.priceUpdates,1);
  const next=applyEbayRefresh(s,p),i=next.items[0];assert.equal(JSON.stringify(s),before);assert.equal(i.title,'My verified title');assert.equal(i.costCents,300);assert.equal(i.location,'Box A');assert.equal(i.quantity,2);assert.equal(listingPrice(i,'collx').priceCents,450);assert.equal(listingPrice(i,'ebay').priceCents,699);assert.equal(next.items.length,2);
  assert.deepEqual(next.events.slice(0,s.events.length),s.events);
});
test('quantity discrepancies exclude stock for review without rewriting sale history or costs',()=>{
  let s=fixture();s=recordSale(s,{itemId:'ebay-820123456789',quantity:1,date:'2026-10-11',revenueCents:500,shippingCollectedCents:0,sellingFeeCents:50,promoFeeCents:25,postageCents:100,suppliesCents:10,refundCents:0,channel:'eBay',reference:'order',notes:''});
  const p=previewEbayRefresh(s,report('820123456789,Title,A,2,USD,6.99,1'),{checksum}),next=applyEbayRefresh(s,p);
  assert.equal(p.stats.quantityConflicts,1);assert.equal(next.items[0].quantity,2);assert.equal(next.items[0].costCents,300);assert.deepEqual(next.sales,s.sales);assert.equal(next.items[0].availability,'review');assert.equal(remaining(next,next.items[0]),0);
});
test('missing rows are flagged only for explicitly complete reports and never become inferred sales',()=>{
  const s=fixture(),incoming=report('820987654321,New item,B,1,USD,3.99,0');
  assert.equal(previewEbayRefresh(s,incoming,{checksum}).missing.length,0);
  const p=previewEbayRefresh(s,incoming,{checksum,complete:true}),next=applyEbayRefresh(s,p);assert.equal(p.missing.length,1);assert.equal(next.items[0].availability,'review');assert.equal(next.items[0].ebaySnapshot.status,'missing');assert.equal(next.sales.length,0);
});
test('manual same-day prices are protected, older reports rejected, repeat reports blocked',()=>{
  const s=fixture();s.items[0].listingPrices={ebay:{priceCents:899,asOf:'2026-10-11',source:'Manually recorded in Vault'}};
  const incoming=report('820123456789,Title,A,2,USD,6.99,0'),p=previewEbayRefresh(s,incoming,{checksum});assert.equal(p.stats.priceConflicts,1);const next=applyEbayRefresh(s,p);assert.equal(listingPrice(next.items[0],'ebay').priceCents,899);
  assert.throws(()=>previewEbayRefresh(next,incoming,{checksum}),/already/);
  assert.throws(()=>previewEbayRefresh(next,report('820123456789,Title,A,2,USD,6.99,0','2026-10-10'),{checksum:'b'.repeat(64)}),/older/);
});
test('a relisted SKU is blocked instead of becoming a duplicate physical item',()=>{
  const p=previewEbayRefresh(fixture(),report('820987654321,Relisted,A,1,USD,6.99,0'),{checksum});assert.equal(p.added.length,0);assert.equal(p.blocked.length,1);
});
