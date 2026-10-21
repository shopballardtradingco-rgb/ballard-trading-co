import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {draftInput,hash,receiveDraft} from '../domain.mjs';
import {inspectPhoto} from '../photos.mjs';
import {storePhoto} from '../object-storage.mjs';
import {approveListings} from '../preparation.mjs';
import {listingContent} from '../public/preparation-policy.mjs';
import {stagePublicationBatch} from '../publication.mjs';
const origin='http://127.0.0.1:3221',store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const app=await createApp({store,origin,allowLocal:true,accessMode:'open',workerAutoStart:false});
const owner=(await store.query('SELECT id FROM core_owner'))[0],state=await store.workspace();
const bytes=await sharp({create:{width:600,height:800,channels:3,background:'#aac5bb'}}).jpeg().toBuffer();
for(let n=0;n<7;n++){
 const d=draftInput({kind:n===5?'comic':'card',title:'Synthetic selection '+n,subject:'Synthetic',setName:'Test set',location:'TEST',description:'Synthetic original only',conditionNotes:'Owner review required',condition:n===0?'5':n===1?'VG-EX':n===5?'Good':'Excellent',askCents:1000,...(n===4?{gradeCompany:'PSA',grade:'9',cert:'12345678',condition:'Graded'}:{})});
 const p=await inspectPhoto(bytes,{role:'front',filename:'synthetic-'+n+'.jpg'});await storePhoto(store.query,owner.id,d.id,p,bytes);const {preview,...ref}=p;d.photos=[ref];state.drafts.push(d);
}
const entries=state.drafts.slice(0,4).map(d=>({id:d.id,fingerprint:hash(listingContent(d))}));approveListings(state,entries);
receiveDraft(state,state.drafts[3].id);state.drafts[6].preparation={status:'running'};
const batchId=stagePublicationBatch(state,entries.slice(0,3)).batchId,stock=structuredClone(state.inventory.items[0]),originals=state.drafts.map(d=>d.photos);
await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);
await new Promise(r=>app.server.listen(3221,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:664}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin);await page.locator('.sidebar [data-nav="intake"]').click();
 const row=n=>page.locator('[data-quick-edit="'+state.drafts[n].id+'"]'),check=n=>page.locator('[data-edit-select="'+state.drafts[n].id+'"]');
 const expected=['Choose condition…','Near mint or better','Excellent','Very good','Poor'];
 for(const n of [0,1]){assert.deepEqual(await row(n).locator('[name="condition"] option').allTextContents(),expected);assert.equal(await row(n).locator('[name="condition"]').inputValue(),'Very good');await row(n).getByText('Default: Older or unknown year. Change if needed.',{exact:true}).waitFor();}
 assert.equal(await check(6).count(),0);
 await row(2).getByLabel('Price ($)',{exact:true}).fill('17');
 await check(0).check();await check(1).check();await page.getByRole('button',{name:'Edit 2 selected',exact:true}).click();
 await page.getByRole('heading',{name:'Bulk edit 2 cards'}).waitFor();
 await page.getByLabel('Price for selected cards ($)',{exact:true}).fill('5');await page.getByLabel('eBay condition',{exact:true}).selectOption('Very good');await page.getByLabel('Shipping for selected cards',{exact:true}).selectOption('auto');
 assert.equal(await page.locator('#bulk-row-form').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 assert.equal(await page.locator('#modal[open]').count(),0);
 if(process.env.BTCORE_BULK_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_BULK_SCREENSHOT_PATH});
 // A background update elsewhere must not interrupt these selected edits.
 const background=await store.workspace();background.revision++;background.inventory.revision=background.revision;background.drafts[6].conditionNotes='Updated by background preparation';await store.query('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[background.revision,JSON.stringify(background)]);
 await page.getByRole('button',{name:'Save 2 selected',exact:true}).click();await page.getByText('2 selected cards updated. Unselected cards unchanged.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 let saved=await store.workspace();for(const d of saved.drafts.slice(0,2)){assert.equal(d.askCents,500);assert.equal(d.condition,'Very good');assert.equal(d.shippingMode,'auto');}
 assert.equal(saved.drafts[2].askCents,1000);assert.equal(await row(2).getByLabel('Price ($)',{exact:true}).inputValue(),'17');assert.equal(saved.publicationBatches[0].id,batchId);assert.equal(saved.publicationBatches[0].publicationApproved,false);assert.deepEqual(saved.drafts.map(d=>d.photos),originals);assert.deepEqual(saved.inventory.items[0],stock);
 await page.locator('#intake-search').fill('selection 2');await page.getByRole('button',{name:'Select all shown (1)',exact:true}).click();assert.equal(await page.locator('[data-edit-select]:checked').count(),1);
 await page.getByRole('button',{name:'Edit 1 selected',exact:true}).click();await page.getByLabel('eBay condition',{exact:true}).selectOption('Poor');
 // A change to an actual selected card must fail atomically and retain the open editor.
 saved=await store.workspace();saved.revision++;saved.inventory.revision=saved.revision;saved.drafts[2].conditionNotes='New saved condition notes';await store.query('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[saved.revision,JSON.stringify(saved)]);
 const conflictResponse=page.waitForResponse(r=>r.url().endsWith('/api/listing-rows'));await page.getByRole('button',{name:'Save 1 selected',exact:true}).click();const conflict=await conflictResponse;assert.equal(conflict.status(),409,await conflict.text());await page.locator('#desk-bulk .form-error').waitFor();
 assert.equal((await store.workspace()).drafts[2].condition,'Excellent');assert.equal(await page.getByLabel('eBay condition',{exact:true}).inputValue(),'Poor');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#intake-search').waitFor();
 await page.getByRole('button',{name:'Clear',exact:true}).click();await page.locator('#intake-search').fill('');
 await page.getByRole('button',{name:'Select all shown (5)',exact:true}).click();await page.getByRole('button',{name:'Edit 5 selected',exact:true}).click();assert.equal(await page.getByLabel('eBay condition',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Clear',exact:true}).click();
 await page.locator('.sidebar [data-nav="inventory"]').click();await check(3).check();await page.getByRole('button',{name:'Edit 1 selected',exact:true}).click();await page.getByLabel('Price for selected cards ($)',{exact:true}).fill('12');await page.getByRole('button',{name:'Save 1 selected',exact:true}).click();await page.getByText('1 selected card updated. Unselected cards unchanged.',{exact:true}).waitFor();
 saved=await store.workspace();assert.equal(saved.inventory.items[0].askCents,1200);for(const key of ['quantity','sku','costCents','source'])assert.deepEqual(saved.inventory.items[0][key],stock[key]);assert.equal(saved.publicationBatches[0].publicationApproved,false);
 await page.locator('.sidebar [data-nav="intake"]').click();await row(2).getByRole('button',{name:'Discard row changes',exact:true}).click();
 for(const viewport of [{width:320,height:568},{width:390,height:664},{width:844,height:390}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await check(0).check();await page.locator('#quick-save-bar [data-action="quick-bulk-edit"]').first().click();const box=await page.locator('#bulk-row-form').boundingBox();assert.ok(box.x>=0&&box.width<=viewport.width);assert.equal(await page.locator('#modal[open]').count(),0);await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Clear',exact:true}).click();}
 await page.setViewportSize({width:390,height:664});await page.locator('#quick-save-bar').scrollIntoViewIfNeeded();if(process.env.BTCORE_BULK_LIST_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_BULK_LIST_SCREENSHOT_PATH});
 assert.deepEqual(errors,[]);console.log('Bulk editor mobile: exact eBay choices, selected-only atomic saves, pending edits, filters, mixed types, stale conflicts, stock preservation and responsive inline editors passed.');
}finally{await browser.close();await app.preparation.stop();await app.mirror.stop();await new Promise(r=>app.server.close(r));await store.close();}
