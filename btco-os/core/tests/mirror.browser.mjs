import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
const origin='http://127.0.0.1:3222',store=await openStore({sqlitePath:':memory:',allowSqlite:true});let reads=0;
const client={call:async(name)=>{
 reads++;const at=new Date().toISOString();
 if(name==='get_connection_status')return {seller:'ballardtradingco',seller_id:'3uxyv64dtp6'};
 if(name==='get_active_listings')return {seller:'ballardtradingco',seller_id:'3uxyv64dtp6',source:'ebay_trading_active_listings',retrieved_at_utc:at,provider_timestamp:at,page:1,page_size:200,returned:1,total_matching:1,total_pages:1,next_page:null,has_more:false,records:[{item_id:'123456789012',sku:'EXACT-SKU',title:'Synthetic mirror card',listing_type:'FixedPriceItem',quantity_available:1,price:{value:'1.49',currency:'USD'},variations:[],requires_variation_review:false}]};
 if(name==='get_orders')return {retrieved_at_utc:at,date_timezone:'America/Los_Angeles',offset:0,returned:0,total_matching:0,next_offset:null,has_more:false,records:[]};throw Error('Unexpected tool '+name);
}};
const connector={status:()=>({configured:true,connected:true,seller:'ballardtradingco'}),client:async()=>client,mirrorGrant:async()=> 'synthetic-encrypted-credential'};
const app=await createApp({store,origin,allowLocal:true,accessMode:'open',connector,workerAutoStart:false});await new Promise(r=>app.server.listen(3222,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/#mirror');await page.getByRole('heading',{name:'Side-by-side trial',exact:true}).waitFor();await page.getByRole('button',{name:'Start 3-week eBay sync',exact:true}).click();await page.getByText('eBay mirrored. Read-only sync runs for three weeks.',{exact:true}).waitFor();await page.getByRole('heading',{name:'Synthetic mirror card',exact:true}).waitFor({timeout:3000});assert.equal(reads,3);assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
 await page.locator('#mirror-csv').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from('master,sku,title,usd,qty,ebay,collx\nCDP-EXACT,EXACT-SKU,Synthetic card,1.99,2,123456789012,CX-1\n')});await page.getByRole('heading',{name:'Map comparison export',exact:true}).waitFor();await page.locator('[name="observedAt"]').fill(await page.evaluate(()=>{const d=new Date(Date.now()-60000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}));for(const [k,v] of Object.entries({id:0,sku:1,title:2,price:3,quantity:4,ebayId:5,collxId:6}))await page.locator('#mirror-import-form [name="'+k+'"]').selectOption(String(v));await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('button',{name:'Save comparison records',exact:true}).click({timeout:3000});await page.getByText('CDP / eBay price differs',{exact:true}).waitFor();await page.getByText('CDP / eBay quantity differs',{exact:true}).waitFor();
 assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);if(process.env.BTCORE_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_PATH});
 await page.reload();await page.getByText('CDP / eBay price differs',{exact:true}).waitFor();await page.getByRole('button',{name:'Stop scheduled sync',exact:true}).click();await page.getByText('Scheduled sync stopped. Saved observations kept.',{exact:true}).waitFor();
 const state=await store.workspace();assert.equal(state.inventory.items.length,0);assert.equal(state.inventory.sales.length,0);assert.equal(state.marketplaceMirror.sources.cdp.records[0].id,'CDP-EXACT');assert.equal(state.marketplaceMirror.sources.ebay.records[0].priceCents,149);const backup=await page.request.get(origin+'/api/backup');assert.ok(!(await backup.text()).includes('synthetic-encrypted-credential'));assert.deepEqual(errors,[]);
 console.log('PASS: mobile mirror sync, CSV column mapping and preview, exact prices, variance, reload, stop, and no stock/credential leakage.');
}finally{await browser.close();await app.mirror.stop();await new Promise(r=>app.server.close(r));await store.close();}
