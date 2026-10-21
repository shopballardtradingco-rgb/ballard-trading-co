import {seedFixture,channelFactsFixture} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {packState} from '../domain/sync-pack.mjs';
import {applyChannelFacts} from '../domain/core.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('full inventory refresh persists through real workerd/D1 with service scope and readback',async()=>{
  const modules=[{type:'ESModule',path:path.join(root,'inventory-runtime-test.mjs'),contents:"import {handleInventorySync} from './server/inventory-sync.mjs';export default {fetch(request,env){return handleInventorySync(request,env)}};"}];
  for(const dir of ['domain','server'])for(const name of await readdir(path.join(root,dir)))if(name.endsWith('.mjs'))modules.push({type:'ESModule',path:path.join(root,dir,name)});
  const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{BTCO_INVENTORY_OWNER_ID:'runtime-owner',BTCO_EBAY_SELLER:'ballardtradingco',BTCO_EBAY_SELLER_ID:'runtime-seller'}});
  try{
    const db=await mf.getD1Database('DB');
    for(const name of (await readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(path.join(root,'drizzle',name),'utf8');await db.batch(sql.split('--> statement-breakpoint').flatMap(p=>p.split(';')).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));}
    const state=applyChannelFacts(seedFixture(),channelFactsFixture()),packed=await packState(state),now=new Date().toISOString();
    for(let n=0;n<packed.chunks.length;n+=20)await db.batch(packed.chunks.slice(n,n+20).map(c=>db.prepare('INSERT INTO vault_chunks(owner_id,hash,body,created_at) VALUES(?,?,?,?)').bind('runtime-owner',c.hash,c.body,now)));
    await db.prepare('INSERT INTO vault_workspaces(owner_id,revision,manifest,operation_id,updated_at) VALUES(?,?,?,?,?)').bind('runtime-owner',1,JSON.stringify(packed.manifest),'initial-test',now).run();
    const records=state.items.filter(i=>i.channel.toLowerCase()==='ebay'&&/^\d{9,15}$/.test(i.externalId)).map(i=>({item_id:i.externalId,sku:i.sku,title:i.title,listing_type:'FixedPriceItem',quantity_available:1,price:{value:'2.99',currency:'USD'},variations:[],requires_variation_review:false}));
    const pages=[];for(let n=0;n<records.length;n+=200){const page=n/200+1,total=Math.ceil(records.length/200),part=records.slice(n,n+200);pages.push({seller:'ballardtradingco',seller_id:'runtime-seller',source:'ebay_trading_active_listings',retrieved_at_utc:now,provider_timestamp:now,page,page_size:200,returned:part.length,total_matching:records.length,total_pages:total,has_more:page<total,next_page:page<total?page+1:null,records:part});}
    const call=async body=>{const res=await mf.dispatchFetch('https://os.test/api/inventory-sync',{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};};
    const preview=await call({action:'preview',pages});assert.equal(preview.status,200,JSON.stringify(preview));
    const saved=await call({action:'apply',pages,expectedRevision:1,checksum:preview.data.checksum});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.data.revision,2);
    const result=await call();assert.equal(result.data.refresh.checksum,preview.data.checksum);assert.equal(result.data.itemCount,state.items.length);assert.equal(result.data.refresh.stats.matched,records.length);
  }finally{await mf.dispose();}
});
