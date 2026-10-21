import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {digest} from '../auth.mjs';
import {parseBackup} from '../backup.mjs';
import {hash} from '../domain.mjs';

const output=process.env.BTCORE_SCREENSHOT_DIR??join(tmpdir(),'btcore-acceptance');await mkdir(output,{recursive:true});
const port=Number(process.env.BTCORE_TEST_PORT??3200),origin=`http://127.0.0.1:${port}`;
const store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const {server}=await createApp({store,origin,allowLocal:true,setupTokenHash:digest('synthetic-preview-setup')});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures=[],external=[];
const context=await browser.newContext({viewport:{width:1440,height:1050}});
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
const page=await context.newPage();page.on('pageerror',e=>failures.push(e.message));
const shot=async name=>{await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:join(output,name),fullPage:true});};
try{
 await page.goto(origin);await page.locator('#auth-form').waitFor();
 await page.getByLabel('Private setup code').fill('synthetic-preview-setup');await page.getByLabel('Email address').fill('owner@example.test');await page.getByLabel('Create a password').fill('synthetic-password-123');await page.getByRole('button',{name:'Create owner account'}).click();
 await page.getByRole('heading',{name:'Make room for what’s next.'}).waitFor();
 await page.getByRole('button',{name:'New intake',exact:true}).first().click();
 await page.getByLabel('Title',{exact:true}).fill('Synthetic comic · browser acceptance');await page.getByLabel('Storage location',{exact:true}).fill('TEST-COMIC-01');await page.getByLabel('Set / series',{exact:true}).fill('Synthetic series');await page.getByLabel('Card / issue number',{exact:true}).fill('1');await page.getByLabel('Year',{exact:true}).fill('2026');await page.getByLabel('Acquisition cost ($)',{exact:false}).fill('2');await page.getByLabel('Asking price per unit ($)',{exact:false}).fill('10');await page.getByLabel('Visible condition notes').fill('Synthetic fixture. No real collectible or market claim.');await page.getByLabel('Listing preparation text').fill('Synthetic browser acceptance record.');
 for(const role of ['front','back']){
  const svg=`<svg width="360" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="360" height="500" fill="${role==='front'?'#234d3b':'#b5bda2'}"/><rect x="25" y="25" width="310" height="450" fill="none" stroke="#e8e9cf" stroke-width="2"/><text x="180" y="180" text-anchor="middle" font-size="23" fill="#e8e9cf" font-family="sans-serif">SYNTHETIC</text><text x="180" y="230" text-anchor="middle" font-size="23" fill="#e8e9cf" font-family="sans-serif">TEST ${role.toUpperCase()}</text></svg>`;
  const buffer=await sharp(Buffer.from(svg)).jpeg().toBuffer();await page.getByLabel('Upload '+role+' photo').setInputFiles({name:`synthetic-${role}.jpg`,mimeType:'image/jpeg',buffer});await page.locator(`.photo-slot img[alt="${role} original preview"]`).waitFor();
 }
 await shot('btcore-intake-desktop.png');
 await page.getByRole('button',{name:'Review intake',exact:false}).click();await page.locator('#review-form').waitFor();
 await shot('btcore-review-desktop.png');
 await page.getByLabel('I checked the identity', {exact:false}).check();await page.getByLabel('I checked both sides',{exact:false}).check();await page.getByRole('button',{name:'Confirm into Vault'}).click();
 await page.getByRole('button',{name:'Record a sale',exact:true}).waitFor();await page.getByRole('button',{name:'Close dialog'}).click();
 await page.locator('.sidebar [data-nav="home"]').click();await shot('btcore-home-desktop.png');
 await page.locator('.sidebar [data-nav="inventory"]').click();await page.getByRole('button',{name:'Add item',exact:true}).click();await page.locator('#item-form [name="title"]').fill('Synthetic card · hold test');await page.locator('#item-form [name="location"]').fill('TEST-CARD-01');await page.locator('#item-form [name="status"]').selectOption('hold');await page.locator('#item-form [name="cost"]').fill('5');await page.locator('#item-form [name="ask"]').fill('15');await page.getByRole('button',{name:'Save inventory'}).click();
 await page.getByRole('button',{name:'Record a sale',exact:true}).click();await page.locator('#sale-form [name="revenueCents"]').fill('15');await page.locator('#sale-form [name="sellingFeeCents"]').fill('2');await page.getByRole('button',{name:'Record sale',exact:true}).click();await page.getByText('Sale recorded.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#auth-form').waitFor();await page.getByLabel('Email address').fill('owner@example.test');await page.getByLabel('Password',{exact:true}).fill('synthetic-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Make room for what’s next.'}).waitFor();
 assert.equal((await store.workspace()).inventory.items.length,2);assert.equal((await store.workspace()).inventory.sales.length,1);
 await page.locator('.sidebar [data-nav="settings"]').click();const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download full backup'}).click();const download=await downloadPromise;const parsed=await parseBackup(await readFile(await download.path(),'utf8'));assert.equal(parsed.photos.length,2);assert.equal(parsed.state.inventory.items.length,2);
 await page.locator('.sidebar [data-nav="activity"]').click();await page.getByRole('button',{name:'Correct',exact:true}).click();await page.getByRole('button',{name:'Reverse record',exact:true}).click();await page.getByText('Sale reversed; history preserved.',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.locator('.sidebar [data-nav="home"]').click();await shot('btcore-home-mobile.png');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile page must not overflow horizontally');
 await page.locator('.sidebar [data-nav="inventory"]').click();await shot('btcore-vault-mobile.png');
 // A batch must recover when a draft or photo commits but its response is lost.
 await page.setViewportSize({width:1440,height:1050});await page.locator('.sidebar [data-nav="intake"]').click();
 await page.getByRole('button',{name:'Batch photos',exact:true}).click();
 const batchFiles=await Promise.all(['#38694d','#c5bd9e','#475c7e','#c6a68c'].map(async(color,n)=>({name:`synthetic-pair-${n+1}.jpg`,mimeType:'image/jpeg',buffer:await sharp({create:{width:240,height:340,channels:3,background:color}}).jpeg().toBuffer()})));
 await page.getByLabel('Choose paired photos',{exact:true}).setInputFiles(batchFiles.slice(0,3));await page.getByRole('alert').filter({hasText:'even number'}).waitFor();
 await page.getByLabel('Choose paired photos',{exact:true}).setInputFiles(batchFiles);
 await page.getByLabel('Storage location for this batch',{exact:false}).fill('TEST-BATCH-01');
 await page.getByRole('button',{name:'Swap photos for piece 1',exact:true}).click();
 await shot('btcore-batch-desktop.png');
 let dropDraft=true,dropPhoto=true;
 const droppedResponse=async route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==='POST'&&((dropDraft&&url.pathname==='/api/drafts')||(dropPhoto&&url.pathname.endsWith('/photos')))){
   if(url.pathname==='/api/drafts')dropDraft=false;else dropPhoto=false;
   const response=await route.fetch();assert.ok(response.ok());return route.abort('failed');
  }
  return route.continue();
 };
 await page.route('**/api/drafts**',droppedResponse);
 await page.getByRole('button',{name:'Save batch',exact:true}).click();await page.getByRole('button',{name:'Retry unfinished',exact:true}).waitFor();
 assert.equal((await store.workspace()).drafts.length,2,'Lost draft response must leave one saved draft');
 await page.getByRole('button',{name:'Retry unfinished',exact:true}).click();await page.getByRole('button',{name:'Retry unfinished',exact:true}).waitFor();
 assert.equal((await store.workspace()).drafts.length,2,'Retry must replay draft creation');
 assert.equal((await store.workspace()).drafts[1].photos.length,1,'Lost photo response must preserve its original');
 await page.getByRole('button',{name:'Retry unfinished',exact:true}).click();await page.getByText('2 / 2 pieces saved',{exact:true}).waitFor();await page.unroute('**/api/drafts**',droppedResponse);
 let state=await store.workspace();assert.equal(state.drafts.length,3);assert.equal(state.inventory.items.length,2,'Unreviewed batch pieces stay out of stock');
 const paired=state.drafts.slice(1);assert.deepEqual(paired.map(d=>d.photos.length),[2,2]);assert.equal(paired[0].photos.find(p=>p.role==='front').sha256,hash(batchFiles[1].buffer));
 await page.setViewportSize({width:390,height:844});await shot('btcore-batch-mobile.png');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.getByRole('button',{name:'Review saved intake',exact:true}).click();await page.locator(`[data-draft="${paired[0].id}"]`).click();
 await page.getByRole('button',{name:'Swap front and back',exact:true}).click();await page.getByText('Front and back swapped. Review both sides again.',{exact:true}).waitFor();
 state=await store.workspace();assert.equal(state.drafts[1].photos.find(p=>p.role==='front').sha256,hash(batchFiles[0].buffer));
 await page.getByLabel('Replace front photo',{exact:true}).setInputFiles(batchFiles[3]);await page.getByText('Photo replaced. Previous original kept; review both sides again.',{exact:true}).waitFor();
 await page.getByText('Previous originals (1)',{exact:true}).click();await page.getByRole('link',{name:'Download original',exact:true}).waitFor();
 await shot('btcore-photo-correction-mobile.png');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.getByRole('button',{name:'Archive',exact:true}).click();await page.getByRole('button',{name:'Archive intake',exact:true}).click();await page.getByText('Intake archived. Photos and details kept.',{exact:true}).waitFor();
 await page.locator('[data-intake-filter="archived"]').click();await page.locator(`[data-draft="${paired[0].id}"]`).click();await page.getByRole('button',{name:'Restore intake',exact:true}).click();await page.getByText('Intake restored. Review it again before confirming.',{exact:true}).waitFor();
 state=await store.workspace();assert.equal(state.drafts[1].status,'draft');assert.equal(state.drafts[1].photoHistory.length,1);assert.equal(state.drafts[1].identityReviewed,false);
 await page.locator('.sidebar [data-nav="settings"]').click();const correctedDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download full backup'}).click();const fullBackup=await parseBackup(await readFile(await (await correctedDownload).path(),'utf8'));assert.equal(fullBackup.photos.length,7);assert.equal(fullBackup.state.drafts.length,3);
 // Pause finishes the active piece, then resumes without saving another draft prematurely.
 await page.locator('.sidebar [data-nav="intake"]').click();await page.getByRole('button',{name:'Batch photos',exact:true}).click();await page.getByRole('button',{name:'Clear queue',exact:true}).click();
 await page.getByLabel('Choose paired photos',{exact:true}).setInputFiles(batchFiles);
 let signal,release;const reached=new Promise(resolve=>signal=resolve),resume=new Promise(resolve=>release=resolve);let gated=true;
 const delayedUpload=async route=>{if(gated){gated=false;signal();await resume;}return route.continue();};
 await page.route('**/api/drafts/*/photos?**',delayedUpload);await page.getByRole('button',{name:'Save batch',exact:true}).click();await reached;
 await page.getByRole('button',{name:'Pause after this piece',exact:true}).click();release();await page.getByRole('button',{name:'Resume batch',exact:true}).waitFor();
 assert.equal((await store.workspace()).drafts.length,4);assert.equal((await store.workspace()).drafts[3].photos.length,2);
 await page.getByRole('button',{name:'Resume batch',exact:true}).click();await page.getByText('2 / 2 pieces saved',{exact:true}).waitFor();await page.unroute('**/api/drafts/*/photos?**',delayedUpload);assert.equal((await store.workspace()).drafts.length,5);
 // Mix front-only cards with a paired card in one queue, then confirm an above-cutoff card with no classification step.
 await page.getByRole('button',{name:'Clear queue',exact:true}).click();
 await page.locator('#batch-kind').selectOption('card');
 await page.getByLabel('Add card fronts only',{exact:true}).setInputFiles(Array.from({length:11},(_,i)=>({...batchFiles[0],name:`single-${i}.jpg`})));
 await page.getByLabel('Choose paired photos',{exact:true}).setInputFiles(batchFiles.slice(0,2));
 assert.equal(await page.locator('.batch-card').count(),12);
 await page.getByRole('button',{name:'Save batch',exact:true}).click();await page.getByText('12 / 12 pieces saved',{exact:true}).waitFor();
 const mixed=(await store.workspace()).drafts.slice(5);assert.equal(mixed.length,12);assert.deepEqual(mixed.map(d=>d.photos.length),[1,1,1,1,1,1,1,1,1,1,1,2]);
 await shot('btcore-mixed-card-batch.png');
 await page.getByRole('button',{name:'Review saved intake',exact:true}).click();await page.locator(`[data-draft="${mixed[0].id}"]`).click();
 await page.getByLabel('Title',{exact:true}).fill('Synthetic front-only card');await page.getByLabel('Storage location',{exact:true}).fill('TEST-SINGLE');
 await page.getByLabel('Asking price per unit ($)',{exact:false}).fill('15');assert.equal(await page.getByLabel('Card classification',{exact:true}).count(),0);
 await page.getByLabel('Visible condition notes').fill('Front reviewed; reverse unpictured and unassessed.');
 await page.getByRole('button',{name:'Review intake',exact:false}).click();await page.locator('#review-form').waitFor();
 await page.getByLabel('I checked the identity',{exact:false}).check();await page.getByLabel('I checked the front',{exact:false}).check();
 await page.getByRole('button',{name:'Confirm into Vault'}).click();await page.getByRole('button',{name:'Record a sale',exact:true}).waitFor();
 assert.equal((await store.workspace()).drafts.find(d=>d.id===mixed[0].id).status,'received');
 assert.deepEqual(failures,[]);assert.deepEqual(external,[],'Standalone workflow should make no requests to ChatGPT, OpenAI, or third-party services');
 console.log(JSON.stringify({passed:true,checks:['owner setup','photo upload','saved intake','full review','confirm inventory','manual inventory','sale','logout/login recovery','backup download/verification','sale reversal','390px responsive layout','batch pairing','lost draft response recovery','lost photo response recovery','no duplicated intake','pause/resume at piece boundary','swap assignments','photo replacement/history','archive/restore','v2 backup with previous originals','no external requests','no browser errors'],screenshots:output}));
}finally{await browser.close();await new Promise(r=>server.close(r));await store.close();}

