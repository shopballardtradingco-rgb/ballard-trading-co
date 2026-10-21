import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,makeItem} from '../domain/core.mjs';
import {marketRows,duplicateGroups,reconciliationRows} from '../domain/module-views.mjs';
import {collectListingPages} from '../domain/listing-collector.mjs';
import {moduleMarkup} from '../public/modules-ui.mjs';

test('Market preserves unknown and independent prices, exposes exact duplicate identities without merging',()=>{
 const state=emptyState();state.items=[makeItem({id:'a',sku:'001',title:'A',channel:'eBay',externalId:'900000000001',source:{cdpSku:'001'},askCents:250,listingPrices:{collx:{priceCents:0,asOf:'2026-10-11',source:'manual'}}}),makeItem({id:'b',sku:'002',title:'B',channel:'eBay',externalId:'900000000001',source:{cdpSku:'001'}})];
 const original=JSON.stringify(state),rows=marketRows(state);assert.equal(rows[0].ebay.priceCents,250);assert.equal(rows[0].collx.priceCents,0);assert.equal(rows[1].collx.priceCents,null);assert.equal(duplicateGroups(state).length,2);assert.equal(JSON.stringify(state),original);
});
test('Flow keeps review reasons separate from inferred sales and escapes untrusted listing text',()=>{
 const state={...emptyState(),items:[makeItem({id:'a',sku:'001',title:'<img onerror="bad()">',availability:'review',ebaySnapshot:{status:'missing',quantityConflict:true,skuConflict:true,priceConflict:true}})]};
 assert.equal(reconciliationRows(state)[0].reasons.length,5);assert.equal(state.sales.length,0);assert.ok(!moduleMarkup('flow',state).includes('<img'));assert.match(moduleMarkup('scout',state),/at least 5/);
});
function pages(){const time=new Date().toISOString(),records=Array.from({length:401},(_,n)=>({item_id:String(900000000000+n),sku:'FIXTURE-'+n,title:'Synthetic',listing_type:'FixedPriceItem',quantity_available:1,price:{value:'2.99',currency:'USD'},variations:[],requires_variation_review:false}));return [0,1,2].map(n=>({seller:'test',seller_id:'test-id',source:'ebay_trading_active_listings',retrieved_at_utc:time,provider_timestamp:time,page:n+1,page_size:200,returned:Math.min(200,401-n*200),total_matching:401,total_pages:3,has_more:n<2,next_page:n<2?n+2:null,records:records.slice(n*200,(n+1)*200)}));}
const scope={seller:'test',sellerId:'test-id'};
test('collector follows all pages sequentially and validates the final partial page',async()=>{const p=pages(),seen=[];const result=await collectListingPages(async n=>{seen.push(n);return p[n-1]},scope);assert.deepEqual(seen,[1,2,3]);assert.equal(result.snapshot.records.length,401);});
test('collector rejects interrupted, repeated, drifting and duplicate pages without a partial result',async()=>{
 for(const change of [p=>p[1].total_matching++,p=>p[1].next_page=2,p=>p[2].records[0].item_id=p[0].records[0].item_id,p=>p[2].returned=0]){const p=pages();change(p);await assert.rejects(collectListingPages(async n=>p[n-1],scope));}
 await assert.rejects(collectListingPages(async n=>{if(n===2)throw Error('upstream unavailable');return pages()[n-1]},scope));
});
