import {seedFixture,channelFactsFixture} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {emptyState,makeItem,applyChannelFacts} from '../domain/core.mjs';
import {validateListingPages,refreshFromListings} from '../domain/ebay-api-refresh.mjs';
import {handleInventorySync} from '../server/inventory-sync.mjs';
import {handleVault,readState,commitManifest} from '../server/vault-api.mjs';
import {packState} from '../domain/sync-pack.mjs';
const seller='ballardtradingco',sellerId='seller-test',owner='owner-test';
const row=(id='820111111111',sku='MARKET-1')=>({item_id:id,sku,title:'A card',listing_type:'FixedPriceItem',quantity_available:1,price:{value:'9.99',currency:'USD'},variations:[],requires_variation_review:false});
const pages=(records=[row()],time=new Date().toISOString())=>[{seller,seller_id:sellerId,source:'ebay_trading_active_listings',retrieved_at_utc:time,provider_timestamp:time,page:1,page_size:200,returned:records.length,total_matching:records.length,total_pages:1,has_more:false,next_page:null,records}];
const snapshot=p=>validateListingPages(p,{seller,sellerId});
const fixture=()=>({...emptyState(),items:[makeItem({id:'existing',sku:'MARKET-1',title:'Original identity',channel:'eBay',externalId:'820111111111',costCents:500,askCents:300,location:'Box A',source:{cdpSku:'CDP-MASTER',cdpId:'cdp-1',asOf:'2026-09-26'},listingPrices:{collx:{priceCents:400,asOf:'2026-10-01',source:'manual'}}})]});
function database(){const sqlite=new DatabaseSync(':memory:');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')))sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {values:[],bind(...v){this.values=v;return this;},async first(){return sqlite.prepare(sql).get(...this.values)??null;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...this.values).changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
async function seed(db,state=fixture(),target=owner,revision=0){const p=await packState(state);for(const c of p.chunks)await db.prepare('INSERT OR IGNORE INTO vault_chunks(owner_id,hash,body,created_at) VALUES(?,?,?,?)').bind(target,c.hash,c.body,new Date().toISOString()).run();return commitManifest(db,target,{manifest:p.manifest,expectedRevision:revision,operationId:crypto.randomUUID()});}
const env=db=>({DB:db,BTCO_INVENTORY_OWNER_ID:owner,BTCO_EBAY_SELLER:seller,BTCO_EBAY_SELLER_ID:sellerId});
async function call(e,body,headers={}){const response=await handleInventorySync(new Request('https://os.test/api/inventory-sync',{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:response.status,data:await response.json()};}
test('collector rejects incomplete, duplicate, drifting, stale, foreign seller and invalid-price inputs',async()=>{
  const valid=pages([row(),row('820111111112',null)]);assert.equal((await snapshot(valid)).records[1].sku,'');
  for(const mutate of [p=>p[0].total_matching=201,p=>p[0].records[1].item_id=p[0].records[0].item_id,p=>p[0].seller='someone-else',p=>p[0].seller_id='foreign',p=>p[0].next_page=2,p=>p[0].returned=1,p=>p[0].records[0].price.value='NaN',p=>p[0].records[0].price.currency='EUR',p=>p[0].retrieved_at_utc='2020-01-01T00:00:00Z']){const p=structuredClone(valid);mutate(p);await assert.rejects(snapshot(p));}
});
test('exact ID refresh preserves master SKU, marketplace alias, physical quantity, costs and CollX price',async()=>{
  const state=fixture(),before=structuredClone(state),r=row();r.sku='CDP-MASTER';r.quantity_available=3;
  const plan=refreshFromListings(state,await snapshot(pages([r]))),item=plan.next.items[0];
  for(const field of Object.keys(before.items[0]).filter(x=>x!=='listingPrices'))assert.deepEqual(item[field],before.items[0][field],field);
  assert.deepEqual(item.listingPrices.collx,before.items[0].listingPrices.collx);assert.equal(item.ebaySnapshot.quantityConflict,true);assert.equal(item.ebaySnapshot.skuConflict,false);assert.equal(item.listingPrices.ebay.priceCents,999);assert.deepEqual(state,before);
});
test('manual prices, SKU conflicts, held stock, missing listings and same-SKU relistings remain protected',async()=>{
  const state=fixture();state.items[0].availability='review';state.items[0].listingPrices.ebay={priceCents:123,asOf:'2026-09-01',source:'Manually recorded in Vault'};
  const p=await snapshot(pages([row('820111111111','UNEXPECTED'),row('820111111112','CDP-MASTER')]));const plan=refreshFromListings(state,p);
  assert.equal(plan.next.items.length,1);assert.equal(plan.summary.blocked,1);assert.equal(plan.summary.skuConflicts,1);assert.equal(plan.summary.priceConflicts,1);assert.equal(plan.next.items[0].listingPrices.ebay.priceCents,123);assert.equal(plan.next.items[0].availability,'review');
  const missing=refreshFromListings(state,await snapshot(pages([]))).next;assert.equal(missing.items[0].ebaySnapshot.status,'missing');assert.equal(missing.items[0].quantity,1);assert.deepEqual(missing.sales,state.sales);
});
test('unmatched and SKU-less listings become review records, variations stay blocked, replay adds nothing',async()=>{
  const variation={...row('820111111113','VAR'),requires_variation_review:true};const p=await snapshot(pages([row('820111111112',null),variation]));
  const plan=refreshFromListings(fixture(),p),added=plan.next.items[1];assert.equal(added.quantity,0);assert.equal(added.availability,'review');assert.equal(added.source.cdpSku,undefined);assert.equal(added.sku,'EBAY-820111111112');assert.equal(plan.summary.variations,1);assert.equal(plan.summary.blocked,1);assert.equal(refreshFromListings(plan.next,p).replayed,true);
});
test('all synthetic inventory CDP mappings and physical records survive API observations unchanged',async()=>{
  const seed=seedFixture(),facts=channelFactsFixture(),state=applyChannelFacts(seed,facts);
  const rows=state.items.filter(i=>i.channel==='eBay'&&/^\d{9,15}$/.test(i.externalId)).slice(0,200).map(i=>({...row(i.externalId,i.sku),quantity_available:2}));
  const next=refreshFromListings(state,await snapshot(pages(rows))).next;
  assert.equal(next.items.length,state.items.length);for(let n=0;n<state.items.length;n++){const before=structuredClone(state.items[n]),after=structuredClone(next.items[n]);delete before.listingPrices;delete after.listingPrices;delete before.ebaySnapshot;delete after.ebaySnapshot;assert.deepEqual(after,before);}
  assert.deepEqual(next.sales,state.sales);assert.deepEqual(next.externalSales,state.externalSales);
});
test('scoped writer fails closed, cannot redirect owners and does not relax existing visitor authorization',async()=>{
  const db=database();await seed(db);assert.equal((await call({DB:db})).status,503);assert.equal((await call(env(db),undefined,{'oai-authenticated-user-id':'foreign-owner'})).status,403);assert.equal((await call(env(db),{action:'preview',pages:pages()}, {origin:'https://other.test'})).status,403);
  assert.equal((await call(env(db),{action:'preview',pages:pages(),ownerId:'foreign-owner'})).status,400);
  const response=await handleVault(new Request('https://os.test/api/vault'),db);assert.equal(response.status,401);
});
test('real SQLite apply is atomic, verifies persisted data, preserves other owners and replays safely',async()=>{
  const db=database(),e=env(db);await seed(db);await seed(db,fixture(),'other-owner');const p=pages(),preview=(await call(e,{action:'preview',pages:p})).data;
  assert.equal(preview.revision,1);assert.equal((await call(e)).data.revision,1);
  const request={action:'apply',pages:p,expectedRevision:preview.revision,checksum:preview.checksum};const applied=await call(e,request);assert.equal(applied.status,200,JSON.stringify(applied));assert.equal(applied.data.revision,2);assert.equal((await call(e,request)).data.replayed,true);assert.equal((await call(e)).data.refresh.checksum,preview.checksum);
  const workspace=await db.prepare('SELECT manifest FROM vault_workspaces WHERE owner_id=?').bind(owner).first();const saved=await readState(db,owner,JSON.parse(workspace.manifest));assert.equal(saved.items[0].source.cdpSku,'CDP-MASTER');assert.equal(saved.items[0].quantity,1);assert.equal(saved.items[0].listingPrices.ebay.priceCents,999);
  assert.equal((await db.prepare('SELECT revision FROM vault_workspaces WHERE owner_id=?').bind('other-owner').first()).revision,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM vault_snapshots WHERE owner_id=?').bind(owner).first()).count,2);
});
test('a device save after preview rejects the refresh without overwriting its edits',async()=>{
  const db=database(),e=env(db);await seed(db);const p=pages(),preview=(await call(e,{action:'preview',pages:p})).data;const edited=fixture();edited.items[0].location='Phone shelf';await seed(db,edited,owner,1);
  const rejected=await call(e,{action:'apply',pages:p,expectedRevision:1,checksum:preview.checksum});assert.equal(rejected.status,409);assert.equal((await call(e)).data.revision,2);
});
