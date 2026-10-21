import {seedFixture,channelFactsFixture} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyChannelFacts,listingPrice,updateListingPrices,isEbayOnlyOpen,validateState,validateItem,makeItem,inventoryCSV,summary,mergeImport,emptyState} from '../domain/core.mjs';
import {parseCSV,ebayCSVState} from '../domain/ebay-import.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL('../public/data/'+name,import.meta.url),'utf8'));
const seed=seedFixture(),facts=channelFactsFixture();

test('synthetic source enrichment preserves every existing field, count, cost and sale',()=>{
  const original=JSON.stringify(seed),enriched=applyChannelFacts(seed,facts);
  assert.equal(JSON.stringify(seed),original);
  assert.deepEqual(summary(enriched),summary(seed));
  assert.deepEqual(enriched.sales,seed.sales);assert.deepEqual(enriched.externalSales,seed.externalSales);
  for(let n=0;n<seed.items.length;n++){
    const old=seed.items[n],now=enriched.items[n];
    for(const [k,v] of Object.entries(old)){
      if(k==='source'){for(const [key,value] of Object.entries(v))assert.deepEqual(now.source[key],value);}
      else assert.deepEqual(now[k],v);
    }
  }
  assert.strictEqual(applyChannelFacts(enriched,facts),enriched);
  validateState(JSON.parse(JSON.stringify(enriched)));
});
test('eBay prices use fixture export values; CDP generic prices never become CollX prices',()=>{
  const s=applyChannelFacts(seed,facts);
  assert.equal(s.items.filter(i=>listingPrice(i,'ebay').priceCents!==null).length,3532);
  assert.equal(s.items.filter(i=>listingPrice(i,'collx').priceCents!==null).length,0);
  assert.equal(s.items.filter(i=>i.source.cdpCollxStatus==='listed').length,2178);
  const i=s.items.find(i=>i.source.cdpCollxStatus==='listed');
  assert.equal(i.source.cdpChannelAsOf,'2026-09-26');
  assert.ok(Object.hasOwn(i.source,'cdpStartPriceReported'));
  assert.equal(listingPrice(i,'collx').priceCents,null);
});
test('eBay-only count uses exactly the record filter and excludes sold/review records',()=>{
  const rows=seed.items.filter(i=>isEbayOnlyOpen(seed,i));
  assert.equal(rows.length,1329);
  assert.ok(rows.every(i=>!i.source.cdpId&&i.quantity>i.sourceSoldQuantity&&i.availability!=='review'));
  const local={...seed,sales:[{itemId:rows[0].id,quantity:rows[0].quantity,voidedAt:null}]};
  assert.equal(local.items.filter(i=>isEbayOnlyOpen(local,i)).length,1328);
});
test('enrichment preserves manual channel prices and a changed legacy price',()=>{
  const s=structuredClone(seed),a=s.items[0],b=s.items[1];
  a.listingPrices={ebay:{priceCents:8765,asOf:'2026-10-11',source:'Manual'},collx:{priceCents:4321,asOf:'2026-10-11',source:'Manual'}};
  b.askCents=123456;
  const next=applyChannelFacts(s,facts);
  assert.deepEqual(next.items[0].listingPrices,a.listingPrices);
  assert.equal(listingPrice(next.items[1],'ebay').priceCents,123456);
  assert.equal(listingPrice(next.items[1],'ebay').asOf,'');
});
test('editing each channel preserves other prices, zero, unknown and original source dates',()=>{
  const i=applyChannelFacts(seed,facts).items[0],old=structuredClone(listingPrice(i,'ebay'));
  i.listingPrices=updateListingPrices(i,{ebay:old.priceCents,collx:0},'2026-10-11');
  assert.deepEqual(listingPrice(i,'ebay'),old);
  assert.equal(listingPrice(i,'collx').priceCents,0);
  i.listingPrices=updateListingPrices(i,{ebay:null,collx:375},'2026-10-11');
  assert.equal(listingPrice(i,'ebay').priceCents,null); // Never fall back to old askCents after clearing.
  assert.equal(listingPrice(i,'collx').priceCents,375);
  assert.equal(listingPrice(i,'collx').asOf,'2026-10-11');
  validateItem(JSON.parse(JSON.stringify(i)));
});
test('a legacy price stays with its original channel when the primary channel changes',()=>{
  const i=makeItem({sku:'TEST',title:'Test',channel:'eBay',askCents:750});
  i.listingPrices=updateListingPrices(i,{ebay:750,collx:null},'2026-10-11');i.channel='CollX';
  assert.equal(listingPrice(i,'ebay').priceCents,750);assert.equal(listingPrice(i,'collx').priceCents,null);
  for(const invalid of [-1,1.5,NaN,'100',undefined])assert.throws(()=>validateItem({...i,listingPrices:{ebay:{priceCents:invalid,source:'Manual',asOf:'2026-10-11'}}}));
});
test('CSV carries independent prices, provenance and blanks without conflating acquisition cost',()=>{
  const i=makeItem({sku:'TEST',title:'Test',channel:'eBay',costCents:125,askCents:750});
  i.listingPrices=updateListingPrices(i,{ebay:750,collx:925},'2026-10-11');
  const rows=parseCSV(inventoryCSV({...emptyState(),items:[i]})),r=Object.fromEntries(rows[0].map((k,n)=>[k,rows[1][n]]));
  assert.equal(r['eBay listing price USD'],'7.50');assert.equal(r['CollX listing price USD'],'9.25');
  assert.equal(r['CollX price date'],'2026-10-11');assert.equal(r['Total allocated acquisition cost USD'],'1.25');
  i.listingPrices.collx.priceCents=null;
  assert.equal(parseCSV(inventoryCSV({...emptyState(),items:[i]}))[1][rows[0].indexOf('CollX listing price USD')],'');
});
test('future eBay imports retain price attribution and new backup records can be enriched',()=>{
  const csv='Item number,Title,Custom label (SKU),Available quantity,Currency,Current price,Sold quantity\n820123456789,Test,NEW,1,USD,4.99,0';
  const incoming=ebayCSVState(csv,{asOf:'2026-10-11'});
  assert.deepEqual(listingPrice(incoming.items[0],'ebay'),{priceCents:499,asOf:'2026-10-11',source:'eBay active-listings export'});
  const s=applyChannelFacts(emptyState(),facts),merged=mergeImport(s,seed);
  assert.equal(merged.channelFactsVersion,undefined);
  assert.equal(applyChannelFacts(merged,facts).items.filter(i=>i.source.cdpCollxStatus==='listed').length,2178);
});
