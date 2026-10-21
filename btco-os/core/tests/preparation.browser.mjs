import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
const origin='http://127.0.0.1:3213',store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const result={title:'2024 Synthetic Set Test Player #12',subject:'Test Player',year:'2024',setName:'Synthetic Set',number:'12',parallel:'',serial:'',gradeCompany:'',grade:'',cert:'',team:'Test Team',sport:'Baseball',condition:'Excellent',conditionNotes:'Front visible. Reverse unpictured and unassessed.',description:'Synthetic test card. Reverse unpictured and unassessed.',priceReason:'Synthetic estimate, not sold evidence.',identityNotes:'Synthetic fixture.',rookie:false,autograph:false,memorabilia:false,confidence:'high',cardClass:'standard',askCents:400,priceBasis:'estimate',sources:[],warnings:[]};
let prepared=0;const app=await createApp({store,origin,allowLocal:true,accessMode:'open',assessor:async()=>{const n=++prepared;return {result:{...result,askCents:399,title:`Synthetic Player ${n}`,subject:`Player ${n}`,...(n>3?{askCents:n===6?400:null,condition:n===4?'Excellent':''}:n===3?{cardClass:'premium',parallel:'Gold',askCents:999,condition:''}:n===1?{cardClass:'premium',parallel:'Refractor'}:{cardClass:'unknown',parallel:'Base'})},model:'synthetic',costMicros:10000};}});await new Promise(r=>app.server.listen(3213,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByRole('button',{name:'Bulk upload',exact:true}).click();await page.locator('#batch-kind').selectOption('card');await page.locator('[name="batchLocation"]').fill('B007, section 2');
 const jpeg=await sharp({create:{width:180,height:240,channels:3,background:'#5d937f'}}).jpeg().toBuffer();await page.getByLabel('Add card fronts only',{exact:true}).setInputFiles([1,2,3].map(n=>({name:`synthetic-${n}.jpg`,mimeType:'image/jpeg',buffer:jpeg})));await page.getByRole('button',{name:'Save batch',exact:true}).click();await page.getByRole('heading',{name:'Review your cards'}).waitFor();
 await page.getByRole('heading',{name:'Synthetic Player 3',exact:true}).waitFor({timeout:30000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(await page.locator('.prep-title>strong').allTextContents(),['Unknown','Unknown','Unknown']);
 assert.equal(await page.getByText('AI price research',{exact:true}).count(),3);
 for(const [n,price] of [[1,'4'],[2,'4']]){const card=page.locator('[data-prep-card]').filter({has:page.getByRole('heading',{name:'Synthetic Player '+n,exact:true})});await card.getByRole('button',{name:'Edit price',exact:true}).click();await page.locator('#price-form [name="ask"]').fill(price);await page.getByRole('button',{name:'Save price',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});}
 assert.deepEqual(await page.locator('.prep-title>strong').allTextContents(),['$4','$4','Unknown']);
 assert.equal(await page.getByRole('button',{name:'Approve selected (0)',exact:true}).isDisabled(),true);
 assert.equal(await page.getByLabel('Select Synthetic Player 3',{exact:true}).isDisabled(),true);
 assert.equal(await page.getByText('Near mint or better · 1 photo · Back photo optional',{exact:true}).count(),3);assert.equal(await page.getByText('Add back photo',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Select all ready (2)',exact:true}).click();assert.equal(await page.locator('[data-review-card]:checked').count(),2);
 await page.getByLabel('Select Synthetic Player 1',{exact:true}).uncheck();assert.equal(await page.locator('#prep-selection-count').textContent(),'1 selected');
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();assert.equal(await page.locator('[data-review-card]:checked').count(),0);
 await page.getByRole('button',{name:'Select all ready (2)',exact:true}).click();
 // Edit existing values together without changing an unselected blocked card.
 await page.locator('#prep-filter').selectOption('attention');assert.equal(await page.locator('[data-prep-card]').count(),1);assert.equal(await page.locator('#prep-selection-count').textContent(),'2 selected');
 await page.getByRole('button',{name:'Edit selected (2)',exact:true}).click();
 const edit=page.locator('#finish-form');assert.equal(await edit.locator('[data-finish-row]').count(),2);
 await edit.getByLabel('Price for displayed cards ($)',{exact:true}).fill('7.99');await edit.getByLabel('Condition for displayed cards',{exact:true}).selectOption('Excellent');await edit.getByRole('button',{name:'Apply to displayed cards',exact:true}).click();
 assert.deepEqual(await edit.locator('[name="ask"]').evaluateAll(xs=>xs.map(x=>x.value)),['7.99','7.99']);
 await edit.getByRole('button',{name:'Save details & select ready',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
 const edited=(await (await page.request.get(origin+'/api/workspace')).json());assert.equal(edited.approvedListings.length,0);
 assert.ok(edited.state.drafts.filter(d=>d.title!=='Synthetic Player 3').every(d=>d.askCents===800&&d.condition==='Excellent'&&d.photos.length===1));assert.equal(edited.state.drafts.find(d=>d.title==='Synthetic Player 3').condition,'Near mint or better');
 assert.equal(await page.locator('[data-review-card]:checked').count(),2);
 await page.locator('#prep-filter').selectOption('ready');assert.equal(await page.locator('[data-prep-card]').count(),2);await page.locator('#prep-filter').selectOption('all');
 await page.evaluate(()=>scrollTo(0,1000));const bar=await page.locator('.prep-bulk').boundingBox();assert.ok(bar.y>=0&&bar.y+bar.height<600,'bulk actions remain visible while scrolling');
 await page.evaluate(()=>scrollTo(0,0));if(process.env.BTCORE_SCREENSHOT_DIR)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_DIR+'/bulk-approval-mobile.png'});
 await page.getByRole('button',{name:'Approve selected (2)',exact:true}).click();await page.locator('#modal').getByRole('button',{name:'Keep reviewing',exact:true}).click();assert.equal(await page.locator('[data-review-card]:checked').count(),2);
 await page.setViewportSize({width:1440,height:1000});if(process.env.BTCORE_SCREENSHOT_DIR)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_DIR+'/bulk-approval-desktop.png'});await page.setViewportSize({width:390,height:844});
 const approval=page.waitForRequest(r=>r.url().endsWith('/api/preparation/approve')&&r.method()==='POST');await page.getByRole('button',{name:'Approve selected (2)',exact:true}).click();await page.locator('#modal').getByRole('button',{name:'Confirm approval of 2 cards',exact:true}).click();const payload=(await approval).postDataJSON();assert.equal(payload.data.entries.length,2);assert.ok(payload.data.entries.every(e=>/^[a-f0-9]{64}$/.test(e.fingerprint)&&!e.content));await page.getByRole('link',{name:'Download CDP CSV'}).waitFor();
 const download=await page.request.get(origin+'/api/export/cdp.csv');assert.equal(download.status(),200);const csv=await download.text();assert.match(csv,/Front Image URL/);assert.match(csv,/B007/);assert.match(csv,/Synthetic Player 1/);assert.match(csv,/Synthetic Player 2/);assert.doesNotMatch(csv,/Synthetic Player 3/);
 const image=csv.match(/http:\/\/127.0.0.1:3213\/media\/cdp\/[^"\r\n]+/)[0];const external=await browser.newContext();assert.equal((await external.request.get(image)).status(),200);await external.close();
 await page.reload();await page.locator('.sidebar [data-nav="intake"]').click();await page.getByRole('button',{name:'Review & export'}).click();await page.getByText('Ready for listing',{exact:true}).first().waitFor();assert.equal(await page.getByText('Ready for listing',{exact:true}).count(),2);assert.equal(await page.locator('.prep-title h2').first().textContent(),'Synthetic Player 3');assert.equal(await page.getByRole('button',{name:'Select all ready (0)',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Approve selected (0)',exact:true}).isDisabled(),true);
 // Defaults remove condition blockers; only unconfirmed asking prices remain.
 await page.locator('.sidebar [data-nav="home"]').click();await page.getByRole('button',{name:'Bulk upload',exact:true}).click();await page.locator('#batch-kind').selectOption('card');await page.locator('[name="batchLocation"]').fill('TEST-FINISH');
 await page.getByLabel('Add card fronts only',{exact:true}).setInputFiles([4,5,6].map(n=>({name:`synthetic-${n}.jpg`,mimeType:'image/jpeg',buffer:jpeg})));await page.getByRole('button',{name:'Save batch',exact:true}).click();await page.getByRole('heading',{name:'Synthetic Player 6',exact:true}).waitFor({timeout:30000});
 assert.equal(await page.getByRole('button',{name:'Select all ready (0)',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Finish remaining (4)',exact:true}).click();
 const finish=page.locator('#finish-form'),row=n=>finish.locator('[data-finish-row]').filter({hasText:`Synthetic Player ${n}`});
 assert.equal(await finish.locator('[name="ask"]').count(),4);assert.equal(await finish.locator('[name="condition"]').count(),0);
 await row(4).getByLabel('Asking price ($)',{exact:true}).fill('3');
 await finish.getByLabel('Price for blank rows ($)',{exact:true}).fill('4.99');await finish.getByLabel('Condition for blank rows',{exact:true}).selectOption('Excellent');await finish.getByRole('button',{name:'Apply to blank fields',exact:true}).click();
 assert.equal(await row(4).getByLabel('Asking price ($)',{exact:true}).inputValue(),'3');assert.equal(await row(5).getByLabel('Asking price ($)',{exact:true}).inputValue(),'4.99');
 // Leave one unresolved card behind while completing three, including an optional back upload.
 await row(5).getByLabel('Asking price ($)',{exact:true}).fill('');
 const upload=page.waitForResponse(r=>r.url().includes('/photos?role=back')&&r.request().method()==='POST');await row(3).getByLabel('Upload back photo (optional)',{exact:true}).setInputFiles({name:'synthetic-back.jpg',mimeType:'image/jpeg',buffer:jpeg});assert.equal((await upload).status(),201);await page.getByText('3 ready after saving. Other cards stay in the queue.',{exact:true}).waitFor();
 assert.equal(await row(4).getByLabel('Asking price ($)',{exact:true}).inputValue(),'3');assert.equal(await finish.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 if(process.env.BTCORE_SCREENSHOT_DIR)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_DIR+'/finish-remaining-mobile.png'});
 await finish.getByRole('button',{name:'Save details & select ready',exact:true}).click();await page.getByRole('button',{name:'Approve selected (3)',exact:true}).waitFor();assert.equal(await page.locator('[data-review-card]:checked').count(),3);
 // Saving only selects; it does not approve without the owner's final confirmation.
 const before=(await (await page.request.get(origin+'/api/workspace')).json());assert.equal(before.approvedListings.length,2);
 await page.getByRole('button',{name:'Approve selected (3)',exact:true}).click();const finishedApproval=page.waitForResponse(r=>r.url().endsWith('/api/preparation/approve')&&r.request().method()==='POST');await page.locator('#modal').getByRole('button',{name:'Confirm approval of 3 cards',exact:true}).click();assert.equal((await finishedApproval).status(),200);await page.locator('#modal').waitFor({state:'hidden'});await page.getByRole('button',{name:'Finish remaining (1)',exact:true}).waitFor();
 const after=(await (await page.request.get(origin+'/api/workspace')).json());assert.equal(after.approvedListings.length,5);assert.equal(after.state.drafts.find(d=>d.title==='Synthetic Player 4').askCents,300);assert.equal(after.state.drafts.find(d=>d.title==='Synthetic Player 5').askCents,null);
 const finishedCSV=await (await page.request.get(origin+'/api/export/cdp.csv')).text();assert.match(finishedCSV,/Synthetic Player 3/);assert.match(finishedCSV,/Synthetic Player 4/);assert.match(finishedCSV,/Synthetic Player 6/);assert.doesNotMatch(finishedCSV,/Synthetic Player 5/);
 // Stage a selection on the listing page, retain it across reloads and reuse it without duplicates.
 await page.locator('#main').getByRole('button',{name:'eBay listings',exact:true}).click();
 await page.getByRole('button',{name:'Select all shown (6)',exact:true}).click();
 for(const n of [1,5]){const d=after.state.drafts.find(d=>d.title==='Synthetic Player '+n);await page.locator('[data-edit-select="'+d.id+'"]').uncheck();}
 await page.locator('#quick-save-bar .bulk-edit-actions').getByRole('button',{name:'Get ready to publish (4)',exact:true}).click();
 await page.getByRole('heading',{name:'Connect eBay',exact:true}).waitFor();assert.equal(await page.locator('#modal[open]').count(),0);
 const staged=await store.workspace();assert.equal(staged.publicationBatches.length,1);assert.equal(staged.publicationBatches[0].entries.length,4);assert.equal(staged.publicationBatches[0].publicationApproved,false);
 await page.reload();await page.getByRole('heading',{name:'Connect eBay',exact:true}).waitFor();assert.equal(await page.locator('[data-edit-select]:checked').count(),4);
 await page.locator('#quick-save-bar .bulk-edit-actions').getByRole('button',{name:'Get ready to publish (4)',exact:true}).click();await page.getByRole('heading',{name:'Connect eBay',exact:true}).waitFor();
 assert.equal((await store.workspace()).publicationBatches.length,1);
 // Mobile quick price editing remains available for an approved, unselected card.
 await page.locator('.sidebar [data-nav="intake"]').click();await page.getByRole('button',{name:'Review & export',exact:true}).click();
 const priceCard=page.locator('[data-prep-card]').filter({has:page.getByRole('heading',{name:'Synthetic Player 1',exact:true})});
 await priceCard.getByRole('button',{name:'Edit price',exact:true}).click();
 await page.locator('#price-form').getByLabel('Asking price ($)',{exact:true}).fill('12.99');
 await page.getByRole('button',{name:'Save price',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
 const repriced=await (await page.request.get(origin+'/api/workspace')).json();const repricedCard=repriced.state.drafts.find(d=>d.title==='Synthetic Player 1');
 assert.equal(repricedCard.askCents,1300);assert.ok(!repriced.approvedListings.includes(repricedCard.id));
 assert.deepEqual(repricedCard.photos,after.state.drafts.find(d=>d.id===repricedCard.id).photos);
 await priceCard.getByRole('button',{name:'Edit details / photos',exact:true}).click();
 await page.getByRole('button',{name:'Edit price',exact:true}).click();assert.equal(await page.locator('#price-form [name="ask"]').inputValue(),'13');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.reload();
 const persisted=await (await page.request.get(origin+'/api/workspace')).json();assert.equal(persisted.state.drafts.find(d=>d.id===repricedCard.id).askCents,1300);
 console.log('PASS: mobile approved-card quick price editing, rounding, review invalidation, unchanged originals and reload.');
 assert.deepEqual(errors,[]);console.log('PASS: zero-ready bulk completion, fill blanks without overwriting, photo upload preserving edits, explicit approval and unresolved-card exclusion.');
 assert.deepEqual(errors,[]);console.log('PASS: mobile bulk selection, exceptions, clear/cancel, sticky actions, compact approval, mixed-batch exclusion, persisted approvals, CDP CSV and external images.');
}finally{await browser.close();await app.preparation.stop();await new Promise(r=>app.server.close(r));await store.close();}

