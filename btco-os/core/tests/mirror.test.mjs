import test from 'node:test';
import assert from 'node:assert/strict';
import {ebaySnapshot,applySnapshot,exportSnapshot,mirrorReport,collectEbay,validateMirror} from '../mirror.mjs';
import {initialWorkspace} from '../store.mjs';
import {harness} from './helpers.mjs';
import {parseCSV,mappedExport} from '../public/mirror-ui.mjs';
export function fixture(now=Date.now()){
 const at=new Date(now).toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(now);
 return {source:'btconnect-ebay-baseline',startDate:date,endDate:date,listingPages:[{seller:'ballardtradingco',seller_id:'3uxyv64dtp6',source:'ebay_trading_active_listings',retrieved_at_utc:at,provider_timestamp:at,page:1,page_size:200,returned:1,total_matching:1,total_pages:1,has_more:false,next_page:null,records:[{item_id:'123456789012',sku:'EXACT-SKU',title:'Synthetic card',listing_type:'FixedPriceItem',quantity_available:1,price:{value:'1.49',currency:'USD'},variations:[],requires_variation_review:false}]}],orderPages:[{retrieved_at_utc:at,date_timezone:'America/Los_Angeles',offset:0,returned:1,total_matching:1,has_more:false,next_offset:null,records:[{orderId:'TEST-ORDER',creationDate:at,lastModifiedDate:at,orderPaymentStatus:'PAID',orderFulfillmentStatus:'NOT_STARTED',cancelStatus:{cancelState:'NONE_REQUESTED'},buyer_username:'must-not-copy',line_items:[{lineItemId:'LINE',legacyItemId:'123456789012',sku:'EXACT-SKU',title:'Synthetic card',quantity:1}]}]}]};
}
test('complete eBay observations preserve exact IDs and cents without duplicating stock or buyer data',async()=>{
 const data=fixture(),s=initialWorkspace(),before=JSON.stringify(s.inventory),snap=await ebaySnapshot(data);applySnapshot(s,snap);validateMirror(s);
 assert.equal(s.marketplaceMirror.sources.ebay.records[0].priceCents,149);assert.equal(JSON.stringify(s.inventory),before);assert.ok(!JSON.stringify(s).includes('must-not-copy'));assert.equal(applySnapshot(s,snap).replayed,true);
 const r=mirrorReport(s);assert.equal(r.summary.listings,1);assert.equal(r.summary.orders,1);assert.equal(r.summary.unresolvedOrders,1);assert.equal(r.rows[0].core,null);
});
test('partial, changing, duplicate, stale, wrong-seller and out-of-window feeds are rejected before mutation',async()=>{
 for(const change of [d=>d.listingPages[0].total_matching=2,d=>d.listingPages[0].seller='other',d=>d.listingPages[0].has_more=true,d=>d.listingPages[0].provider_timestamp='2000-01-01',d=>d.orderPages[0].next_offset=200,d=>d.orderPages[0].total_matching=2,d=>d.orderPages[0].records.push(d.orderPages[0].records[0]),d=>d.orderPages[0].records[0].creationDate='2000-01-01T00:00:00Z']){const d=fixture();change(d);await assert.rejects(()=>ebaySnapshot(d));}
 const s=initialWorkspace();applySnapshot(s,await ebaySnapshot(fixture()));const before=JSON.stringify(s);const old=await ebaySnapshot(fixture(Date.now()-1000));assert.throws(()=>applySnapshot(s,old),/not newer/);assert.equal(JSON.stringify(s),before);
});
test('disappearances remain unresolved; updated order status never infers sales or relists',async()=>{
 const now=Date.now(),s=initialWorkspace();applySnapshot(s,await ebaySnapshot(fixture(now)));
 const d=fixture(now+1000),p=d.listingPages[0];p.total_matching=0;p.total_pages=0;p.records=[];p.returned=0;d.orderPages[0].records[0].orderPaymentStatus='FULLY_REFUNDED';d.orderPages[0].records[0].cancelStatus.cancelState='CANCELED';applySnapshot(s,await ebaySnapshot(d,{now:now+1000}));
 assert.equal(s.marketplaceMirror.sources.ebay.records[0].status,'active');assert.ok(s.marketplaceMirror.sources.ebay.records[0].notSeenSince);assert.equal(mirrorReport(s).summary.listings,0);assert.equal(s.inventory.sales.length,0);assert.equal(s.inventory.items.length,0);assert.ok(s.marketplaceMirror.history.some(h=>h.fields.includes('order_changed')));
 applySnapshot(s,await ebaySnapshot(fixture(now+2000),{now:now+2000}));assert.equal(s.marketplaceMirror.sources.ebay.records[0].notSeenSince,undefined);
});
test('CSV mapping handles quoted content, exact master SKU, independent CollX cents and missing values',()=>{
 const csv=parseCSV('id,sku,title,price,quantity,ebay,collx\r\nMASTER,Exact SKU,"Synthetic, card",1.49,1,123456789012,CX1\r\n');
 const map={id:'0',sku:'1',title:'2',price:'3',quantity:'4',ebayId:'5',collxId:'6'};const snapshot=exportSnapshot(mappedExport(csv,map,{source:'cdp',observedAt:new Date().toISOString()}));assert.equal(snapshot.records[0].sku,'Exact SKU');assert.equal(snapshot.records[0].title,'Synthetic, card');assert.equal(snapshot.records[0].priceCents,149);
 assert.throws(()=>parseCSV('a,a\n1,2'),/unique/);assert.throws(()=>parseCSV('a,b\n"bad,b'),/Unclosed/);assert.throws(()=>exportSnapshot({...snapshot,records:[snapshot.records[0],snapshot.records[0]]}),/duplicate/);
 const unknown=mappedExport(csv,{...map,price:'',quantity:''},{source:'collx',observedAt:new Date().toISOString()});assert.equal(unknown.records[0].priceCents,null);assert.equal(unknown.records[0].quantity,null);
});
test('comparison links only exact external IDs and never treats SKU aliases or absent sources as parity',async()=>{
 const s=initialWorkspace();applySnapshot(s,await ebaySnapshot(fixture()));
 applySnapshot(s,exportSnapshot({source:'cdp',observedAt:new Date().toISOString(),records:[{id:'master',sku:'EXACT-SKU',title:'Synthetic',priceCents:199,quantity:2,status:'active',ebayId:'123456789012',collxId:'CX'}]}));
 applySnapshot(s,exportSnapshot({source:'collx',observedAt:new Date().toISOString(),records:[{id:'CX',sku:'separate',title:'Synthetic',priceCents:99,quantity:1,status:'active'}]}));
 const r=mirrorReport(s).rows[0];assert.equal(r.core,null);assert.equal(r.cdp.sku,'EXACT-SKU');assert.equal(r.collx.priceCents,99);assert.ok(r.issues.includes('CDP / eBay price differs'));assert.ok(!r.issues.some(i=>i.includes('CollX price differs')));assert.equal(s.inventory.items.length,0);
});
test('mirror import API requires session and CSRF, preserves state and supports idempotent retry',async()=>{
 const h=await harness({accessMode:'open'});try{await h.request('/api/session');const data=fixture();assert.equal((await h.request('/api/mirror')).status,200);assert.equal((await h.request('/api/mirror',{auth:false})).status,401);assert.equal((await h.request('/api/mirror/import',{method:'POST',data:{data},headers:{'X-CSRF-Token':'wrong'}})).status,403);
 const first=await h.save('/api/mirror/import',data,{operationId:'test-mirror-import'});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal((await h.save('/api/mirror/import',data,{operationId:'test-mirror-import'})).body.replayed,true);const r=(await h.request('/api/mirror')).body;assert.equal(r.summary.listings,1);assert.equal(r.sync.enabled,false);assert.equal((await h.store.workspace()).inventory.items.length,0);assert.match((await h.request('/api/backup')).text,/marketplaceMirror/);
 }finally{await h.close();}
});
test('collector calls read tools only and stops on invalid pagination',async()=>{
 const d=fixture(),calls=[];const client={call:async(name)=>{calls.push(name);if(name==='get_connection_status')return {seller:'ballardtradingco',seller_id:'3uxyv64dtp6'};if(name==='get_active_listings')return d.listingPages[0];if(name==='get_orders')return d.orderPages[0];throw Error(name);}};
 const s=await collectEbay(client);assert.equal(s.records.length,1);assert.deepEqual(calls,['get_connection_status','get_active_listings','get_orders']);d.listingPages[0].next_page=1;await assert.rejects(()=>collectEbay(client),/pagination/);
});
