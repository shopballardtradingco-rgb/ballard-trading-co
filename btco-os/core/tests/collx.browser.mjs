import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {draftInput} from '../domain.mjs';
import {inspectPhoto} from '../photos.mjs';
import {storePhoto} from '../object-storage.mjs';
const origin='http://127.0.0.1:3221',store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const app=await createApp({store,origin,allowLocal:true,accessMode:'open',workerAutoStart:false});
const owner=(await store.query('SELECT id FROM core_owner'))[0],state=await store.workspace();
const d=draftInput({kind:'card',title:'Synthetic CollX card',subject:'Synthetic Player',year:'2026',setName:'Synthetic',number:'TEST',location:'TEST-BOX',description:'Synthetic description.',conditionNotes:'Synthetic condition.',condition:'Excellent',askCents:500});
const bytes=await sharp({create:{width:180,height:240,channels:3,background:'#aabbcc'}}).jpeg().toBuffer(),p=await inspectPhoto(bytes,{role:'front',filename:'synthetic-collx.jpg'});await storePhoto(store.query,owner.id,d.id,p,bytes);const {preview,...ref}=p;d.photos=[ref];state.drafts.push(d);await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);
await new Promise(r=>app.server.listen(3221,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/#collx');
 await page.getByRole('heading',{name:'CollX',exact:true}).waitFor();await page.getByText('Direct posting is not connected yet.',{exact:true}).waitFor();assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'Open CollX details',exact:true}).click();await page.locator('#collx-price-form [name="price"]').fill('0.99');await page.getByRole('button',{name:'Save CollX price',exact:true}).click();await page.getByText('CollX price saved in Core.',{exact:true}).waitFor();
 let w=await (await page.request.get(origin+'/api/workspace')).json();assert.equal(w.collx.rows[0].priceCents,99);assert.equal(w.state.drafts[0].askCents,500);assert.equal(w.collx.capabilities.publishing,false);
 await page.getByRole('button',{name:'Record listing status',exact:true}).click();await page.locator('[name="externalId"]').fill('SYNTHETIC-COLLX-ID');await page.locator('[name="url"]').fill('https://share.collx.app/card/synthetic-test');await page.locator('[name="status"]').selectOption('active');await page.locator('#collx-observation-form [name="price"]').fill('0.99');await page.locator('[name="checked"]').check();assert.equal(await page.locator('#modal').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await page.getByRole('button',{name:'Save listing record',exact:true}).click();await page.getByText('CollX observation saved.',{exact:true}).waitFor();
 await page.locator('#collx-price-form [name="price"]').fill('1.49');await page.getByRole('button',{name:'Save CollX price',exact:true}).click();await page.getByText('CollX price saved in Core.',{exact:true}).waitFor();await page.locator('#modal').getByText('Saved CollX price differs from last checked listing',{exact:true}).waitFor();
 if(process.env.BTCORE_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_PATH});
 const original=await page.request.get(origin+'/api/photos/'+p.id+'/original');assert.deepEqual(await original.body(),bytes);
 await page.reload();await page.getByRole('button',{name:'Open CollX details',exact:true}).click();assert.equal(await page.locator('#collx-price-form [name="price"]').inputValue(),'1.49');await page.getByText('Last checked price: $0.99',{exact:false}).waitFor();
 // A newer device save must not be overwritten by an open dialog.
 w=await (await page.request.get(origin+'/api/workspace')).json();const session=await (await page.request.get(origin+'/api/session')).json();const r=w.collx.rows[0];const changed=await page.request.post(origin+'/api/collx/price',{headers:{Origin:origin,'X-CSRF-Token':session.csrf},data:{expectedRevision:w.state.revision,operationId:'collx-second-device-test',data:{key:r.key,fingerprint:r.fingerprint,priceCents:199}}});assert.equal(changed.status(),200);
 await page.locator('#collx-price-form [name="price"]').fill('2.49');const conflictResponse=page.waitForResponse(r=>r.url().endsWith('/api/collx/price')&&r.request().method()==='POST');await page.getByRole('button',{name:'Save CollX price',exact:true}).click();assert.equal((await conflictResponse).status(),409);await page.locator('#modal .form-error').getByText('The workspace changed since this page loaded.',{exact:false}).waitFor();assert.equal(await page.locator('#collx-price-form [name="price"]').inputValue(),'2.49');
 w=await (await page.request.get(origin+'/api/workspace')).json();assert.equal(w.collx.rows[0].priceCents,199);assert.equal(w.collx.rows[0].observation.priceCents,99);assert.equal(w.state.drafts[0].askCents,500);assert.deepEqual(w.state.drafts[0].photos,d.photos);assert.equal(w.state.inventory.items.length,0);assert.equal(w.state.inventory.sales.length,0);assert.ok(requests.every(url=>url.startsWith(origin)));assert.deepEqual(errors,[]);
 console.log('PASS: mobile CollX cents, independent observed price, reload, original bytes, no external writes and stale-device protection.');
}finally{await browser.close();await new Promise(r=>app.server.close(r));await store.close();}
