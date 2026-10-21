import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {draftInput,hash,receiveDraft} from '../domain.mjs';
import {inspectPhoto} from '../photos.mjs';
import {storePhoto} from '../object-storage.mjs';
import {listingContent} from '../public/preparation-policy.mjs';
const origin='http://127.0.0.1:3219',store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const app=await createApp({store,origin,allowLocal:true,accessMode:'open',workerAutoStart:false});
const owner=(await store.query('SELECT id FROM core_owner'))[0],state=await store.workspace();
const d=draftInput({kind:'card',title:'Synthetic Purple Auto',subject:'Synthetic Player',year:'2026',setName:'Synthetic Chrome',number:'RA-TEST',parallel:'Purple',serial:'168/250',autograph:true,location:'TEST',description:'Synthetic front. Reverse unassessed.',conditionNotes:'Test fixture only.',condition:'Excellent',askCents:15000});
const bytes=await sharp({create:{width:180,height:240,channels:3,background:'#aabbcc'}}).jpeg().toBuffer(),p=await inspectPhoto(bytes,{role:'front',filename:'synthetic.jpg'});await storePhoto(store.query,owner.id,d.id,p,bytes);const {preview,...ref}=p;d.photos=[ref];
delete d.priceReview;d.preparation={status:'complete',result:{confidence:'high',identityNotes:'Synthetic test card.',askCents:15000,priceBasis:'estimate',priceReason:'Synthetic old unsupported estimate.',sources:[],warnings:[]},applied:{askCents:15000}};d.identityReviewed=true;d.conditionReviewed=true;d.listingReview={fingerprint:hash(listingContent(d)),photoToken:'synthetic'};state.drafts.push(d);await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);
await new Promise(r=>app.server.listen(3219,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('.sidebar [data-nav="intake"]').click();await page.getByRole('button',{name:'Review & export'}).click();
 await page.getByRole('button',{name:'Check price',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Select all ready (0)',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('link',{name:'Download CDP CSV'}).count(),0);
 await page.getByRole('button',{name:'Edit details / photos'}).click();await page.locator('[name="notes"]').fill('Keep this note');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Intake saved. Pick it up whenever you’re ready.',{exact:true}).waitFor();
 let w=await (await page.request.get(origin+'/api/workspace')).json();assert.equal(w.approvedListings.length,0);assert.equal(w.state.drafts[0].priceReview,undefined);assert.equal(w.state.drafts[0].askCents,15000);
 await page.getByRole('button',{name:'Check price',exact:true}).click();await page.locator('#price-form [name="ask"]').fill('24.99');assert.equal(await page.locator('#price-form').evaluate(e=>e.scrollWidth<=e.clientWidth),true);if(process.env.BTCORE_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_PATH});await page.getByRole('button',{name:'Save price',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
 w=await (await page.request.get(origin+'/api/workspace')).json();assert.equal(w.state.drafts[0].askCents,2500);assert.equal(w.state.drafts[0].priceReview.source,'owner');assert.equal(w.state.drafts[0].preparation.result.askCents,15000);assert.deepEqual(w.state.drafts[0].photos,d.photos);assert.equal(w.state.drafts[0].notes,'Keep this note');assert.equal(w.approvedListings.length,0);
 await page.reload();await page.locator('.sidebar [data-nav="intake"]').click();await page.getByRole('button',{name:'Review & export'}).click();await page.getByRole('button',{name:'Edit price',exact:true}).waitFor();assert.equal(await page.locator('.prep-title>strong').textContent(),'$25');assert.equal(await page.getByText('Ready for listing',{exact:true}).count(),0);assert.deepEqual(errors,[]);
 // Regression: already received cards must still expose price confirmation on mobile.
 const received=await store.workspace();const rd=received.drafts[0];rd.identityReviewed=true;rd.conditionReviewed=true;rd.photoPolicy='value-based';rd.cardClass='standard';rd.singlePhotoMaxCents=5000;
 receiveDraft(received,rd.id);delete rd.priceReview;
 await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(received)]);
 await page.reload();await page.locator('.sidebar [data-nav="intake"]').click();await page.getByRole('button',{name:'Review & export'}).click();
 await page.getByRole('button',{name:'Check price',exact:true}).click();await page.locator('#price-form [name="ask"]').fill('7');await page.getByRole('button',{name:'Save price',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
 w=await (await page.request.get(origin+'/api/workspace')).json();assert.equal(w.state.drafts[0].status,'received');assert.equal(w.state.drafts[0].askCents,700);assert.equal(w.state.inventory.items.length,1);assert.equal(w.state.inventory.items[0].askCents,700);assert.equal(w.state.inventory.items[0].quantity,1);assert.equal(w.approvedListings.length,0);
 await page.getByRole('button',{name:'Select all ready (1)',exact:true}).click();await page.getByRole('button',{name:'Approve selected (1)',exact:true}).click();await page.getByRole('button',{name:'Confirm approval of 1 card',exact:true}).click();
 await page.getByText('Ready for listing',{exact:true}).waitFor();
 w=await (await page.request.get(origin+'/api/workspace')).json();assert.equal(w.approvedListings.length,1);assert.equal((w.state.publicationBatches??[]).length,0);assert.deepEqual(errors,[]);
 console.log('PASS: mobile legacy AI price requires review, unrelated saves do not confirm it, manual price survives reload and research remains separate.');
}finally{await browser.close();await new Promise(r=>app.server.close(r));await store.close();}
