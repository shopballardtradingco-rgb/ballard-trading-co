import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspace} from '../store.mjs';
import {migrateCDP,linkIdentifier,resolveInventory,locationAudit,reconcileEbayLinks} from '../inventory-locations.mjs';
import {normalizeLocation,locationLabel} from '../public/locations.mjs';
import {recordMarketplaceOrder,reconcileFulfillment,fulfillmentReport} from '../fulfillment.mjs';
import {validateWorkspace,editInventory,saveSale,reverseSale} from '../domain.mjs';
import {remaining,makeItem,validateState} from '../../web/domain/core.mjs';
import {exportSnapshot,applySnapshot} from '../mirror.mjs';
import {parseCSV,mappedExport} from '../public/mirror-ui.mjs';
import {harness} from './helpers.mjs';
const at='2026-01-01T12:00:00Z';
const row=(extra={})=>({ID:'SOURCE-1',SKU:'MASTER-007-ABC',Player:'Synthetic Player',Title:'2026 Synthetic card #96 Blue /275',Year:'2026',Number:'96',Set:'Synthetic Chrome',Quantity:'1',Cabinet:'Office',Shelf:'01',Box:'B005',Row:'1',Section:'2','Purchase Price':'12.34','Custom Detail':'Keep this',...extra});
const input=(rows=[row()],observedAt=at)=>({rows,observedAt});
function migrated(){const s=initialWorkspace();migrateCDP(s,input());return s;}
function linked(){const s=migrated(),id=s.inventory.items[0].id;for(const [channel,kind,value] of [['collx','sku','007'],['collx','id','9007199254740993123'],['ebay','id','123456789012']])linkIdentifier(s,{itemId:id,channel,kind,value,evidence:'Reviewed synthetic record and images'});return s;}
const order=(extra={})=>({channel:'collx',id:'ORDER-1',createdAt:'2026-01-02T12:00:00Z',payment:'PAID',cancellation:'NONE_REQUESTED',fulfillment:'NOT_STARTED',lines:[{id:'LINE-1',itemId:'9007199254740993123',sku:'007',title:'Synthetic card',quantity:1}],...extra});
test('CDP migration preserves complete original fields, leading zeros, exact master SKU and cost evidence',()=>{
 const s=migrated(),i=s.inventory.items[0];validateWorkspace(s);
 assert.equal(i.sku,'MASTER-007-ABC');assert.equal(i.physicalLocation.shelf,'01');assert.equal(i.location,'Office → Box B005 → Row 1 → Section 2 (Shelf 01)');assert.deepEqual(i.cdpMigration.raw,row());assert.equal(i.costCents,null);assert.equal(i.source.cdpPurchasePriceReported,'12.34');
 assert.equal(migrateCDP(s,input()).replayed,true);assert.equal(s.inventory.items.length,1);
 assert.equal(locationLabel(normalizeLocation({location:'Office/01/B005/1/2'},'collx')),i.location);
 assert.equal(normalizeLocation({location:'Office/B005/1/2'},'collx').office,'');
});
test('reimport cannot overwrite owner master identity, location, costs, stock or status',()=>{
 const s=migrated(),i=s.inventory.items[0];i.costCents=999;i.quantity=3;i.status='hold';const exact=i.sku;
 const r=migrateCDP(s,input([row({Box:'B999',Quantity:'10','Purchase Price':'0.00'})],'2026-01-02T00:00:00Z'));
 assert.ok(r.exceptions.some(e=>/conflict/.test(e.reason)));assert.equal(i.sku,exact);assert.equal(i.quantity,3);assert.equal(i.costCents,999);assert.equal(i.status,'hold');assert.equal(i.physicalLocation.box,'B005');assert.equal(locationAudit(s).conflicts.length,1);
 migrateCDP(s,input([row({Cabinet:'',Shelf:'',Box:'',Row:'',Section:''})],'2026-01-03T00:00:00Z'));assert.match(i.location,/B005/);
 const j=migrateCDP(s,input([row({SKU:'DIFFERENT'})],'2026-01-04T00:00:00Z'));assert.match(j.exceptions[0].reason,/identity/);assert.equal(s.inventory.items.length,1);
 assert.throws(()=>editInventory(s,{sku:'RENAMED'},i.id),/locked/);validateWorkspace(s);
});
test('duplicate source IDs, duplicate master SKUs and partial or missing locations are reported',()=>{
 const s=initialWorkspace(),r=migrateCDP(s,input([row(),row({ID:'SOURCE-2'}),row({ID:'SOURCE-3',SKU:'OTHER',Cabinet:'',Shelf:'',Box:'',Row:'',Section:''}),row({ID:'SOURCE-4',SKU:'PARTIAL',Box:'',Row:'',Section:''})]));
 assert.equal(r.created,2);assert.equal(r.exceptions.filter(e=>/duplicate/.test(e.reason)).length,2);assert.equal(locationAudit(s).missing.length,1);assert.equal(locationAudit(s).partial.length,1);
});
test('all linked identifier namespaces resolve to the same location; no short-SKU or title auto-link',()=>{
 const s=linked(),expected=s.inventory.items[0].location;
 for(const q of [{channel:'cdp',kind:'sku',value:'MASTER-007-ABC'},{channel:'cdp',kind:'id',value:'SOURCE-1'},{channel:'collx',kind:'sku',value:'007'},{channel:'collx',kind:'id',value:'9007199254740993123'},{channel:'ebay',kind:'id',value:'123456789012'},{query:'synthetic card'}])assert.equal(resolveInventory(s,q).matches[0].location,expected);
 assert.equal(resolveInventory(s,{channel:'ebay',kind:'sku',value:'MASTER-007-ABC'}).status,'unmatched');
 const other=makeItem({sku:'OTHER',title:'Other'});s.inventory.items.push(other);assert.throws(()=>linkIdentifier(s,{itemId:other.id,channel:'collx',kind:'sku',value:'007',evidence:'guess'}),/another/);assert.equal(other.sku,'OTHER');
});
test('marketplace CSV comparison retains raw physical fields and does not replace the Core location',()=>{
 const csv=parseCSV('id,sku,title,location,price,quantity\nCX1,,Synthetic,Office/01/B005/1/2,5.00,1\n');const snap=exportSnapshot(mappedExport(csv,{id:'0',sku:'1',title:'2',price:'4',quantity:'5'},{source:'collx',observedAt:at}));
 assert.equal(snap.records[0].physicalLocation.box,'B005');const s=migrated(),before=JSON.stringify(s.inventory);applySnapshot(s,snap);assert.equal(JSON.stringify(s.inventory),before);
});
test('confirmed sales lower stock once, keep costs/location/SKU, expose other channels, and survive backup validation',()=>{
 const s=linked(),i=s.inventory.items[0];i.costCents=1234;recordMarketplaceOrder(s,{checked:true,order:order()});
 assert.equal(remaining(s.inventory,i),0);assert.equal(i.costCents,1234);assert.equal(i.sku,'MASTER-007-ABC');assert.equal(i.physicalLocation.box,'B005');assert.equal(s.inventory.sales.length,0);
 assert.equal(recordMarketplaceOrder(s,{checked:true,order:order()}).replayed,true);reconcileFulfillment(s);assert.equal(s.inventory.marketplaceAllocations.length,1);
 assert.deepEqual(fulfillmentReport(s)[0].lines[0].closureRequired,['ebay']);validateWorkspace(JSON.parse(JSON.stringify(s)));
 assert.throws(()=>editInventory(s,{costCents:1},i.id),/locked/);
});
test('eBay order sync uses exact links, blocks historical/ambiguous orders, retains sold stock on refund, handles partial sales',()=>{
 const s=linked(),i=s.inventory.items[0];i.quantity=2;
 const eb=order({channel:'ebay',lines:[{id:'LINE-1',itemId:'123456789012',sku:'',title:'Synthetic',quantity:1}]});
 const snapshot=o=>({source:'ebay',observedAt:o.createdAt,records:[],orders:{records:[{...o,modifiedAt:o.modifiedAt??o.createdAt}]}});
 applySnapshot(s,snapshot({...eb,createdAt:'2025-12-31T12:00:00Z'}));assert.equal(remaining(s.inventory,i),2);assert.match(fulfillmentReport(s)[0].lines[0].blocker,/historical/);
 applySnapshot(s,snapshot(eb));assert.equal(remaining(s.inventory,i),1);applySnapshot(s,{...snapshot(eb),observedAt:'2026-01-03T12:00:00Z'});assert.equal(remaining(s.inventory,i),1);
 applySnapshot(s,{...snapshot({...eb,payment:'FULLY_REFUNDED',modifiedAt:'2026-01-04T12:00:00Z'}),observedAt:'2026-01-04T12:00:00Z'});assert.equal(remaining(s.inventory,i),1);
 validateState(s.inventory);
});
test('two order lines cannot oversell one physical unit; unrelated IDs never consume stock',()=>{
 const s=linked();const lines=[...order().lines,{...order().lines[0],id:'LINE-2'},{...order().lines[0],id:'LINE-3',sku:'unknown',itemId:'unknown'}];recordMarketplaceOrder(s,{checked:true,order:order({lines})});assert.equal(s.inventory.marketplaceAllocations.length,1);assert.equal(fulfillmentReport(s)[0].lines[1].blocker,'insufficient_or_unverified_stock');assert.equal(fulfillmentReport(s)[0].lines[2].blocker,'unmatched');validateWorkspace(s);
});
test('migration API preview is read-only; import requires auth/CSRF/revision; lookup persists after restore',async()=>{
 const h=await harness({accessMode:'open'});try{
  await h.request('/api/session');const preview=await h.request('/api/inventory/import/preview',{method:'POST',data:{data:input()}});assert.equal(preview.status,200,preview.text);assert.equal(preview.body.created,1);assert.equal((await h.store.workspace()).inventory.items.length,0);
  assert.equal((await h.request('/api/inventory/import/cdp',{auth:false,method:'POST',data:{data:input()}})).status,401);
  assert.equal((await h.request('/api/inventory/import/cdp',{method:'POST',headers:{'X-CSRF-Token':'wrong'},data:{data:input()}})).status,403);
  const saved=await h.save('/api/inventory/import/cdp',input(),{operationId:'location-migration-test'});assert.equal(saved.status,200,saved.text);
  assert.equal((await h.save('/api/inventory/import/cdp',input(),{operationId:'location-migration-test'})).body.replayed,true);
  const lookup=await h.request('/api/inventory/lookup?channel=cdp&kind=sku&value=MASTER-007-ABC');assert.match(lookup.body.matches[0].location,/B005/);
  assert.equal((await h.request('/api/inventory/locations')).body.total,1);assert.match((await h.request('/api/backup')).text,/Custom Detail/);
 }finally{await h.close();}
});

test('exact eBay master SKU and title link once; aliases, altered titles and duplicate observations do not',()=>{
 const s=migrated();s.marketplaceMirror={sources:{ebay:{observedAt:at,records:[{id:'EB1',sku:row().SKU,title:row().Title}]}}};assert.equal(reconcileEbayLinks(s).linked,1);assert.equal(reconcileEbayLinks(s).linked,0);
 s.marketplaceMirror.sources.ebay.records=[{id:'EB2',sku:'007',title:row().Title},{id:'EB3',sku:row().SKU,title:'Other card'}];assert.equal(reconcileEbayLinks(s).linked,0);
 assert.equal(resolveInventory(s,{channel:'ebay',kind:'id',value:'EB1'}).status,'matched');
});
test('financial reconciliation consumes the stock allocation once and a financial correction does not restock a confirmed sale',()=>{
 const s=linked(),i=s.inventory.items[0];i.costCents=100;recordMarketplaceOrder(s,{checked:true,order:order()});
 const result=saveSale(s,{itemId:i.id,quantity:1,date:'2026-01-02',channel:'collx',reference:'ORDER-1',notes:'',revenueCents:500,shippingCollectedCents:0,sellingFeeCents:40,promoFeeCents:0,postageCents:0,suppliesCents:0,refundCents:0});
 assert.equal(remaining(s.inventory,i),0);assert.equal(s.inventory.sales[0].cogsCents,100);validateWorkspace(s);
 reverseSale(s,result.saleId);assert.equal(remaining(s.inventory,i),0);validateWorkspace(s);
});

test('legacy reviewed CDP mappings resolve the master and prevent duplicate migration or SKU rewrite',()=>{
 const s=initialWorkspace(),i=makeItem({sku:'LEGACY-ALIAS',title:row().Title,location:'Verified drawer',costCents:777,cdpLink:{sku:row().SKU}});s.inventory.items.push(i);
 assert.equal(resolveInventory(s,{channel:'cdp',kind:'sku',value:row().SKU}).matches[0].itemId,i.id);
 assert.throws(()=>editInventory(s,{sku:'CHANGED'},i.id),/locked/);
 const r=migrateCDP(s,input());assert.equal(r.created,0);assert.equal(s.inventory.items.length,1);assert.match(r.exceptions[0].reason,/identity/);assert.equal(i.costCents,777);assert.equal(i.location,'Verified drawer');
});
