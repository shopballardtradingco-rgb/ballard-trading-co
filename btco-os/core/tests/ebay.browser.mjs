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
import {campaign,policies as policy,envelope,mailer,envelopeParcel,mailerParcel} from './fixtures/ebay-policies.mjs';
const origin='http://127.0.0.1:3218',store=await openStore({sqlitePath:':memory:',allowSqlite:true}),groups=new Map();let published=0,uploaded=0,publishCalls=0,rejectNext=false;
// Match the real account's response shape, with synthetic IDs and immediate first.
const cardPolicies={...policy,locations:{locations:[{merchantLocationKey:'postal-only',merchantLocationStatus:'ENABLED'},...policy.locations.locations]},payment_policy:{total:2,paymentPolicies:[true,false].map(immediatePay=>({paymentPolicyId:immediatePay?'23':'22',name:'eBay Managed Payments',marketplaceId:'EBAY_US',categoryTypes:[{name:'ALL_EXCLUDING_MOTORS_VEHICLES',default:false}],paymentMethods:[],immediatePay}))}};
const client={seller:'ballardtradingco',upload:async(bytes,p)=>{assert.equal(hash(bytes),p.sha256);uploaded++;return {object_key:'photos/'+'a'.repeat(64)+'/'+p.sha256+'.jpeg',sha256_hex:p.sha256,role:p.role};},call:async(name,args)=>{
 if(name==='get_card_listing_options')return {policies:cardPolicies,category:{itemConditionPolicies:[{itemConditions:[{conditionId:'4000',conditionDescriptors:[{conditionDescriptorId:'40001',conditionDescriptorName:'Card condition',conditionDescriptorValues:[{conditionDescriptorValueId:'400011',conditionDescriptorValueName:'Excellent'},{conditionDescriptorValueId:'400012',conditionDescriptorValueName:'Very good'}]}]}]}]}};
 if(name==='get_listing_policy_snapshot'){assert.equal(args.payment_policy_id,'22');return {snapshots_sha256:(args.fulfillment_policy_id==='11'?'a':'c').repeat(64),policies:{fulfillment_policy:args.fulfillment_policy_id==='11'?envelope:mailer,payment_policy:{name:'Managed payments'},return_policy:{name:'Returns'}}};}
 if(name==='get_listing_campaign_snapshot'){assert.equal(args.campaign_id,'44');return {snapshots_sha256:'b'.repeat(64),campaign};}
 if(name==='validate_listing_draft'){assert.equal(args.draft.packed_parcel.verified,true);assert.equal(args.draft.promotion_mode,'automatic_existing');assert.equal(args.draft.promotion_campaign_id,'44');assert.equal(args.draft.policies.fulfillment_policy_id,Number(args.draft.price_usd)>20?'12':'11');return {valid:true};}if(name==='get_listing_draft')throw Error('Listing draft not found for this seller');
 if(name==='prepare_listing_batch'){if(!groups.has(args.batch.batch_id))groups.set(args.batch.batch_id,{batch_id:args.batch.batch_id,review_revision:hash(args.batch),listings:args.batch.items.map(e=>({draft_id:e.draft.draft_id,draft:e.draft,publication:{all_checks_verified:false,status:'incomplete'}})),exceptions:[],continue_preparation:false,approval_current:false,verified_count:0,next_offset:null});return {};}
 const r=groups.get(args.batch_id);assert.ok(r,name);
 if(['get_listing_batch','get_listing_batch_review'].includes(name))return structuredClone(r);
 if(name==='approve_listing_batch'){r.approval_current=true;return {};}
 if(name==='publish_approved_batch'){assert.ok(r.approval_current);publishCalls++;const l=r.listings.find(l=>!l.publication.all_checks_verified&&l.last_attempt?.disposition!=='owner_action');if(l){if(rejectNext){rejectNext=false;l.last_attempt={disposition:'owner_action',attempts:1,at:1,errors:[{message:'Synthetic eBay rejection: review this card.'}]};return {...structuredClone(r),processed_item_keys:[l.draft_id]};}published++;l.publication={all_checks_verified:true,status:'verified',item_id:'12345678912'+published};r.verified_count++;}return {...structuredClone(r),processed_item_keys:l?[l.draft_id]:[]};}
 throw Error(name);
}};
let connected=true;
const connector={status:()=>({configured:true,connected,seller:'ballardtradingco'}),client:async()=>client,begin:async()=>origin+'/api/ebay/callback',callback:async()=>{connected=true;}};
const app=await createApp({store,origin,allowLocal:true,accessMode:'open',connector,workerAutoStart:false});
const owner=(await store.query('SELECT id FROM core_owner'))[0],state=await store.workspace();
for(let n=1;n<=4;n++){
 const d=draftInput({kind:'card',title:'2024 Synthetic Player '+n,subject:'Player '+n,year:n===3?'unknown':'2024',setName:'Synthetic Set',sport:'Baseball',number:String(n),location:'TEST',description:'Synthetic front photo. Reverse unassessed.',conditionNotes:'Synthetic test only.',condition:n===3?'VG-EX':'Excellent',askCents:n===1?2500:800});
 const bytes=await sharp({create:{width:600,height:800,channels:3,background:n===1?'#aabbcc':'#ccddee'}}).jpeg().toBuffer(),p=await inspectPhoto(bytes,{role:'front',filename:'synthetic-'+n+'.jpg'});await storePhoto(store.query,owner.id,d.id,p,bytes);const {preview,...ref}=p;d.photos=[ref];state.drafts.push(d);
}
const entries=state.drafts.map(d=>({id:d.id,fingerprint:hash(listingContent(d))}));approveListings(state,entries);
const received=state.drafts[1];received.photoPolicy='value-based';received.cardClass='standard';received.singlePhotoMaxCents=1000;receiveDraft(state,received.id);received.preparation={status:'complete'};delete received.priceReview;
stagePublicationBatch(state,[entries[0]]);
await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);
await new Promise(r=>app.server.listen(3218,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BTCORE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:664}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#publication');await page.getByRole('heading',{name:'Manage listings',exact:true}).waitFor();
 const row=n=>page.locator('[data-quick-edit="'+state.drafts[n].id+'"]'),check=n=>page.locator('[data-edit-select="'+state.drafts[n].id+'"]'),top=page.locator('#quick-save-bar .bulk-edit-actions'),final=page.locator('#desk-review-actions');
 const cardId=state.drafts[0].id;
 assert.equal(await row(0).locator('[name="condition"]').evaluate(el=>el.tagName),'SELECT');
 await row(0).getByLabel('Price ($)',{exact:true}).fill('20');await row(0).getByLabel('Condition',{exact:true}).selectOption('Very good');await row(0).getByText('PWE · $20 or less · $0.78 owner cost baseline',{exact:true}).waitFor();
 await row(0).getByLabel('Price ($)',{exact:true}).fill('25');await row(0).getByLabel('Condition',{exact:true}).selectOption('Excellent');await row(0).getByText('Over $20 · parcel shipping',{exact:true}).waitFor();
 await row(1).getByLabel('Price ($)',{exact:true}).fill('7');
 // Pending edits on an unselected row must not be saved by preparing or publishing.
 await row(3).getByLabel('Price ($)',{exact:true}).fill('17');
 await check(0).check();await check(1).check();await top.getByRole('button',{name:'Edit selected (2)',exact:true}).click();
 await page.getByLabel('eBay condition',{exact:true}).selectOption('Excellent');await page.getByLabel('Shipping for selected cards',{exact:true}).selectOption('auto');
 assert.equal(await page.locator('#modal[open]').count(),0);
 if(process.env.BTCORE_INLINE_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_INLINE_SCREENSHOT_PATH});
 await page.getByRole('button',{name:'Save 2 selected',exact:true}).click();await page.getByText('2 selected cards updated. Unselected cards unchanged.',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-edit-select]:checked').count(),2);
 await check(2).check();
 const background=await store.workspace();background.revision++;background.inventory.revision=background.revision;await store.query('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[background.revision,JSON.stringify(background)]);
 await top.getByRole('button',{name:'Get ready to publish (3)',exact:true}).click();
 await page.getByRole('heading',{name:'Shared shipping for 2 selected cards',exact:true}).waitFor();
 await page.getByRole('heading',{name:'1 card needs attention',exact:true}).waitFor();
 await row(2).getByLabel(/Card year/).waitFor();assert.equal(await row(2).getByLabel('Condition',{exact:true}).count(),0);assert.equal((await store.workspace()).drafts[2].condition,'Very good');assert.equal(await page.locator('#ebay-location').inputValue(),'test-location');
 assert.equal(await page.locator('#desk-other-cards').getAttribute('open'),null);
 assert.equal(await page.locator('#modal[open]').count(),0);assert.equal(await check(2).isChecked(),false);assert.equal((await store.workspace()).drafts[3].askCents,800);assert.equal(await row(3).getByLabel('Price ($)',{exact:true}).inputValue(),'17');
 assert.equal(await page.locator('[data-shipping-group] details[open]').count(),0);assert.equal(await page.locator('[data-ebay-card][open]').count(),0);
 assert.equal(await page.locator('#ebay-shipping-high').inputValue(),'12');assert.equal(await page.locator('#ebay-shipping-high option[value="11"]').count(),0);
 await page.locator('#ebay-shipping-raw').selectOption('11');assert.equal(await page.locator('#ebay-payment').inputValue(),'22');assert.equal(await page.locator('select#ebay-payment').count(),0);assert.equal(await page.locator('#ebay-payment').isVisible(),false);await page.locator('#ebay-combined').check();
 assert.equal(await page.locator('#ebay-campaign').inputValue(),'44');assert.equal(await page.locator('#ebay-campaign option[value="45"]').count(),0);
 let configureRequests=0;page.on('request',r=>{if(r.url().endsWith('/api/ebay/configure'))configureRequests++;});
 const prepare=page.locator('#desk-shipping').getByRole('button',{name:'Get 2 selected ready to publish',exact:true});
 await page.locator('#desk-account-settings > summary').click();await page.locator('#ebay-campaign').selectOption('');await prepare.click();await page.getByRole('alert').filter({hasText:'existing 5% promotion campaign'}).waitFor();assert.equal(configureRequests,0);assert.equal(uploaded,0);
 await page.locator('#ebay-campaign').selectOption('44');await prepare.click();await page.getByRole('alert').filter({hasText:'measured packed weight'}).waitFor();assert.equal(configureRequests,0);
 for(const [key,parcel] of [['raw',envelopeParcel],['high',mailerParcel]]){const group=page.locator('[data-shipping-group="'+key+'"]');for(const [field,value] of Object.entries(parcel))if(typeof value==='string')await group.locator('[data-parcel="'+field+'"]').fill(value);await group.locator('[data-parcel-verified]').check();if(key==='raw')await group.locator('[data-envelope-confirmed]').check();}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.BTCORE_SHIPPING_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_SHIPPING_SCREENSHOT_PATH,fullPage:true});
 await prepare.click();await final.getByRole('button',{name:'Publish selected (2)',exact:true}).waitFor();assert.equal(uploaded,2);assert.equal(published,0);assert.equal(await page.locator('#modal[open]').count(),0);
 const oldId=(await store.workspace()).publicationBatches.find(b=>b.status==='ready').id;
 // Selected edits invalidate the preview on this same page and carry shipping forward.
 await page.locator('#desk-other-cards > summary').click();await row(0).getByLabel('Price ($)',{exact:true}).fill('26');assert.equal(await page.getByRole('button',{name:'Publish selected (2)',exact:true}).count(),0);
 await row(0).getByRole('button',{name:'Save row',exact:true}).click();await page.getByRole('heading',{name:'Shared shipping for 2 selected cards',exact:true}).waitFor();
 const changed=await store.workspace(),active=changed.publicationBatches.filter(b=>b.status!=='cancelled');assert.equal(active.length,1);assert.notEqual(active[0].id,oldId);assert.equal(published,0);
 assert.equal(await page.locator('[data-shipping-group="high"] [data-parcel="weight_oz"]').inputValue(),'4');
 await top.getByRole('button',{name:'Get ready to publish (2)',exact:true}).click();await final.getByRole('button',{name:'Publish selected (2)',exact:true}).waitFor();assert.equal(uploaded,4);assert.equal(published,0);
 await page.locator('#desk-other-cards > summary').click();await check(1).uncheck();assert.equal(await page.getByRole('button',{name:'Publish selected (2)',exact:true}).count(),0);
 await check(1).check();await final.getByRole('button',{name:'Publish selected (2)',exact:true}).waitFor();
 assert.equal((await store.workspace()).drafts[3].askCents,800);await row(3).getByRole('button',{name:'Discard row changes',exact:true}).click();
 await page.reload();await final.getByRole('button',{name:'Publish selected (2)',exact:true}).waitFor();assert.equal(uploaded,4);assert.equal(published,0);assert.equal(await page.locator('#modal[open]').count(),0);
 const saved=(await (await page.request.get(origin+'/api/workspace')).json()).state;assert.equal(saved.publicationBatches.filter(b=>b.status!=='cancelled').length,1);assert.equal(saved.inventory.items.length,1);assert.equal(saved.inventory.items[0].askCents,700);assert.equal(saved.inventory.items[0].quantity,1);
 for(const width of [320,390]){await page.setViewportSize({width,height:664});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.locator('#desk-panel').scrollIntoViewIfNeeded();if(process.env.BTCORE_SCREENSHOT_PATH)await page.screenshot({path:process.env.BTCORE_SCREENSHOT_PATH});
 page.once('dialog',d=>d.dismiss());await final.getByRole('button',{name:'Publish selected (2)',exact:true}).click();assert.equal(published,0);
 page.once('dialog',d=>{assert.match(d.message(),/Are you sure.*2 cards/);return d.accept();});await final.getByRole('button',{name:'Publish selected (2)',exact:true}).click();await page.getByRole('heading',{name:'Published on eBay',exact:true}).waitFor();assert.equal(published,2);
 assert.equal((await store.workspace()).drafts[3].askCents,800);assert.equal(await page.locator('.desk-row-status a').count(),2);
 await page.reload();await page.locator('.desk-row-status a').first().waitFor();assert.equal(published,2);
 // Repair the held card on this page after the ready cards have moved on.
 await top.getByRole('button',{name:'Get ready to publish (0)',exact:true}).waitFor();
 // Reload clears the completed batch selection; resume the saved unfinished group via its visible controls.
 await page.getByRole('button',{name:'Select all shown (2)',exact:true}).click();await top.getByRole('button',{name:'Get ready to publish (2)',exact:true}).click();await final.getByRole('button',{name:'Publish selected (1)',exact:true}).waitFor();await page.locator('#main:not([inert])').waitFor();
 await row(2).getByLabel(/Card year/).fill('bad');
 await page.getByRole('button',{name:'Save fixes & continue ready cards',exact:true}).click();await final.getByRole('button',{name:'Publish selected (1)',exact:true}).waitFor();await page.locator('#main:not([inert])').waitFor();
 assert.equal(await row(2).getByLabel(/Card year/).inputValue(),'bad');assert.equal((await store.workspace()).drafts[2].year,'unknown');assert.equal(published,2);
 await row(2).getByLabel(/Card year/).fill('2001');
 await page.getByRole('button',{name:'Save fixes & continue ready cards',exact:true}).click();await final.getByRole('button',{name:'Publish selected (2)',exact:true}).waitFor();
 assert.equal((await store.workspace()).drafts[2].year,'2001');assert.equal((await store.workspace()).drafts[2].condition,'Very good');assert.equal(published,2);assert.equal(await page.locator('#desk-attention').isVisible(),false);
 // Existing identified cards receive defaults on load without blocking on year/condition.
 const defaultsState=await store.workspace();
 for(const [i,year,vendor] of [[0,'2001-02',''],[1,'2024',''],[2,'1990','Hoody’s']]){const d=draftInput({kind:'card',title:'Synthetic default '+i,subject:'Synthetic',setName:'Set',year,vendor,location:'TEST',condition:'VG-EX',description:'Synthetic only',conditionNotes:'Keep these notes',askCents:500});const bytes=await sharp({create:{width:600,height:800,channels:3,background:'#aabbcc'}}).jpeg().toBuffer(),p=await inspectPhoto(bytes,{role:'front',filename:'default-'+i+'.jpg'});await storePhoto(store.query,owner.id,d.id,p,bytes);const {preview,...ref}=p;d.photos=[ref];defaultsState.drafts.push(d);}
 await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(defaultsState)]);await page.reload();await page.getByRole('heading',{name:'Manage listings',exact:true}).waitFor();
 const defaulted=(await store.workspace()).drafts.slice(-3);assert.deepEqual(defaulted.map(d=>d.year),['2001','2024','1990']);assert.deepEqual(defaulted.map(d=>d.condition),['Very good','Near mint or better','Near mint or better']);assert.equal(published,2);
 if(await page.locator('#desk-other-cards').count())await page.locator('#desk-other-cards').evaluate(el=>el.open=true);
 const old=defaulted[0],defaultRow=page.locator('[data-quick-edit="'+old.id+'"]');await defaultRow.getByLabel('Condition',{exact:true}).selectOption('Poor');await defaultRow.getByRole('button',{name:'Save row',exact:true}).click();await page.locator('#main:not([inert])').waitFor();await page.reload();await page.getByRole('heading',{name:'Manage listings',exact:true}).waitFor();assert.equal((await store.workspace()).drafts.find(d=>d.id===old.id).condition,'Poor');assert.equal(published,2);
 // A failed first card must not stop the second card, and its actual error stays visible.
 const failureState=await store.workspace(),failureIds=[];
 for(let i=0;i<2;i++){
  const d=draftInput({kind:'card',title:'Synthetic publishing recovery '+i,subject:'Synthetic recovery '+i,setName:'Test Set',year:'2024',sport:'Baseball',location:'RECOVERY',condition:'Very good',description:'Synthetic front-only test. Reverse unassessed.',conditionNotes:'Synthetic test only.',askCents:800});
  const bytes=await sharp({create:{width:600,height:800,channels:3,background:i?'#99aabb':'#88aabb'}}).jpeg().toBuffer(),p=await inspectPhoto(bytes,{role:'front',filename:'recovery-'+i+'.jpg'});await storePhoto(store.query,owner.id,d.id,p,bytes);const {preview,...ref}=p;d.photos=[ref];failureState.drafts.push(d);failureIds.push(d.id);
 }
 await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(failureState)]);await page.reload();await page.getByRole('heading',{name:'Manage listings',exact:true}).waitFor();
 await page.locator('#quick-save-bar').getByRole('button',{name:'Clear',exact:true}).click();
 if(await page.locator('#desk-other-cards').count())await page.locator('#desk-other-cards').evaluate(el=>el.open=true);
 for(const id of failureIds)await page.locator('[data-edit-select="'+id+'"]').check();
 await top.getByRole('button',{name:'Get ready to publish (2)',exact:true}).click();await final.getByRole('button',{name:'Publish selected (2)',exact:true}).waitFor();
 const before=published,callsBefore=publishCalls;rejectNext=true;
 page.once('dialog',d=>d.accept());await final.getByRole('button',{name:'Publish selected (2)',exact:true}).click();
 await page.locator('.desk-row-status a').filter({hasText:'View listing'}).first().waitFor();
 await page.waitForFunction(expected=>document.querySelector('#desk-panel')?.textContent.includes(expected),'1 verified live');
 assert.equal(published,before+1);assert.equal(publishCalls,callsBefore+2);
 await page.locator('#desk-panel .batch-error').filter({hasText:'Synthetic eBay rejection: review this card.'}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Publication progress',exact:true}).waitFor();
 await final.getByRole('button',{name:'Resume / verify publication',exact:true}).click();await page.locator('#main:not([inert])').waitFor();
 assert.equal(publishCalls,callsBefore+2);assert.equal(published,before+1);
 assert.deepEqual(errors,[]);console.log('Same-page mobile eBay: bulk edits, selected-only saves, excluded rows, saved batches, shipping reuse, exact review, simulated bulk publication and reload passed.');
}finally{await browser.close();await app.preparation.stop();await app.mirror.stop();await new Promise(r=>app.server.close(r));await store.close();}
