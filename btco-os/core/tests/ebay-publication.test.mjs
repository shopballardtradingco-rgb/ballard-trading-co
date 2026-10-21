import test from 'node:test';
import {campaign,envelope,mailer,envelopeParcel,mailerParcel,policies} from './fixtures/ebay-policies.mjs';
import {inventoryLocation,paymentPolicy,campaignChoices,checkedParcel,shippingChoices,conditionValue} from '../public/ebay-settings.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {draftInput,hash} from '../domain.mjs';
import {listingContent} from '../public/preparation-policy.mjs';
import {approveListings} from '../preparation.mjs';
import {stagePublicationBatch,cancelPublicationBatch} from '../publication.mjs';
import {editListingRows} from '../listing-editor.mjs';
import {createEbayPublication,compileCard} from '../ebay-publication.mjs';
import {createConnector} from '../connector.mjs';
test('inventory location prefers a valid saved choice or the sole named enabled location',()=>{
 const postal={merchantLocationKey:'postal',merchantLocationStatus:'ENABLED'},named={...postal,merchantLocationKey:'store',name:'Synthetic shop'},disabled={...named,merchantLocationKey:'disabled',merchantLocationStatus:'DISABLED'},data={locations:{locations:[postal,disabled,named]}};
 assert.equal(inventoryLocation(data).merchantLocationKey,'store');assert.equal(inventoryLocation(data,'postal').merchantLocationKey,'postal');assert.equal(inventoryLocation(data,'disabled').merchantLocationKey,'store');
 assert.equal(inventoryLocation({locations:{locations:[named,{...named,merchantLocationKey:'other'}]}}),null);
});
test('payment policy is automatic, live and never an arbitrary first policy',()=>{
 assert.equal(paymentPolicy(policies,'stale').paymentPolicyId,'22');
 assert.equal(paymentPolicy({},'22'),null);
 const multiple={payment_policy:{paymentPolicies:[{paymentPolicyId:'22'},{paymentPolicyId:'23'}]}};
 assert.equal(paymentPolicy(multiple,'23').paymentPolicyId,'23');
 assert.equal(paymentPolicy(multiple,'stale'),null);
 assert.equal(paymentPolicy({payment_policy:{paymentPolicies:[{paymentPolicyId:22},{paymentPolicyId:'22'}]}}).paymentPolicyId,'22');
});
test('two Managed Payments policies resolve the non-immediate card setup, with saved preference retained',()=>{
 const standard={marketplaceId:'EBAY_US',categoryTypes:[{name:'ALL_EXCLUDING_MOTORS_VEHICLES',default:false}],paymentMethods:[],name:'eBay Managed Payments'};
 const regular={...standard,paymentPolicyId:'22',immediatePay:false},immediate={...standard,paymentPolicyId:'23',immediatePay:true};
 const options=rows=>({payment_policy:{paymentPolicies:rows}});
 for(const rows of [[immediate,regular],[regular,immediate]])assert.equal(paymentPolicy(options(rows)).paymentPolicyId,'22');
 assert.equal(paymentPolicy(options([regular,immediate]),'23').paymentPolicyId,'23');
 assert.equal(paymentPolicy(options([regular,immediate]),'deleted').paymentPolicyId,'22');
 assert.equal(paymentPolicy(options([regular,{...regular,paymentPolicyId:'24'}])),null);
 assert.equal(paymentPolicy(options([regular,{...immediate,paymentMethods:[{paymentMethodType:'CASH_ON_PICKUP'}]}])),null);
 assert.equal(paymentPolicy(options([regular,{...immediate,marketplaceId:'EBAY_GB'}])),null);
});
function fixture(){
 const bytes=Buffer.from('synthetic-original');let state={revision:0,inventory:{events:[],items:[]},drafts:[1,2,3].map(n=>({...draftInput({kind:'card',title:'Synthetic '+n,subject:'Player '+n,setName:'Test Set',year:n===3?'':'2024',sport:'Baseball',number:String(n),location:'TEST',description:'Front pictured. Reverse unassessed.',conditionNotes:'Reverse unassessed.',condition:'Excellent',askCents:800}),photos:[{id:randomUUID(),role:'front',sha256:hash(bytes),sizeBytes:bytes.length,width:600,height:800,filename:'test.jpg',mediaType:'image/jpeg'}]}))};
 const entries=state.drafts.map(d=>({id:d.id,fingerprint:hash(listingContent(d))}));approveListings(state,entries);const id=stagePublicationBatch(state,entries).batchId;
 const remote=new Map(),counts={uploads:0,publishes:0,approvals:0};let lost=false;
 const client={seller:'ballardtradingco',upload:async(b,p)=>{assert.deepEqual(b,bytes);counts.uploads++;return {object_key:'photos/'+ 'a'.repeat(64)+'/'+p.sha256+'.jpeg',sha256_hex:p.sha256,role:p.role};},call:async(name,args)=>{
  if(name==='get_card_listing_options')return {category:{itemConditionPolicies:[{itemConditions:[{conditionId:'4000',conditionDescriptors:[{conditionDescriptorId:'40001',conditionDescriptorName:'Card condition',conditionDescriptorValues:[{conditionDescriptorValueId:'400011',conditionDescriptorValueName:'Excellent'}]}]}]}]}};
  if(name==='get_listing_policy_snapshot')return {snapshots_sha256:'a'.repeat(64),policies:{fulfillment_policy:{shippingOptions:[{costType:'FLAT_RATE'}]}}};
  if(name==='get_listing_campaign_snapshot')return {snapshots_sha256:'b'.repeat(64),campaign:structuredClone(campaign)};
  if(name==='validate_listing_draft')return {valid:true};
  if(name==='get_listing_draft')throw Error('Listing draft not found for this seller');
  if(name==='prepare_listing_batch'){
   if(!remote.has(args.batch.batch_id))remote.set(args.batch.batch_id,{batch_id:args.batch.batch_id,review_revision:hash(args.batch),listings:args.batch.items.map(e=>({draft_id:e.draft.draft_id,draft:e.draft,publication:{all_checks_verified:false,status:'incomplete'}})),exceptions:[],continue_preparation:false,approval_current:false,verified_count:0,next_offset:null});
   if(lost){lost=false;throw Error('Lost submit response');}return {};
  }
  const r=remote.get(args.batch_id);assert.ok(r,name);
  if(['get_listing_batch','get_listing_batch_review'].includes(name))return structuredClone(r);
  if(name==='approve_listing_batch'){assert.equal(args.review_revision,r.review_revision);counts.approvals++;r.approval_current=true;return {};}
  if(name==='publish_approved_batch'){assert.ok(r.approval_current);const next=r.listings.find(l=>!l.publication.all_checks_verified);if(next){counts.publishes++;next.publication={all_checks_verified:true,item_id:String(counts.publishes),status:'verified'};r.verified_count++;}return structuredClone(r);}
  throw Error(name);
 }};
 const store={workspace:async()=>structuredClone(state),query:async()=>[{original:bytes,sha256:hash(bytes)}]};
 const service=createEbayPublication({store,commit:async fn=>{const copy=structuredClone(state),r=await fn(copy);if(r.changed)state=copy;return r;}});
 const settings={categoryId:'261328',locationKey:'test',fulfillmentPolicyId:'11',paymentPolicyId:'22',returnPolicyId:'33',campaignId:'44',combinedShipping:true,cards:Object.fromEntries(state.drafts.map(d=>[d.id,{conditionId:'4000',descriptors:[{name:'40001',values:['400011']}]}]))};
 return {id,service,client,settings,counts,read:()=>structuredClone(state),change:fn=>fn(state),lose:()=>lost=true};
}
test('real nested campaign options select only the existing fixed five percent campaign',()=>{
 assert.deepEqual(campaignChoices(policies).map(c=>c.campaignId),['44']);
 assert.deepEqual(campaignChoices({promotion_campaigns:{campaigns:[campaign]}}).map(c=>c.campaignId),['44']);
 for(const patch of [{campaignStatus:'PAUSED'},{fundingStrategy:{...campaign.fundingStrategy,bidPercentage:'9'}},{campaignCriterion:{...campaign.campaignCriterion,autoSelectFutureInventory:false}}])assert.equal(campaignChoices({promotion_campaigns:{campaigns:[{campaign:{...campaign,...patch}}]}}).length,0);
 assert.deepEqual(shippingChoices(policies,'high').map(p=>p.fulfillmentPolicyId),['12']);assert.deepEqual(shippingChoices(policies,'graded').map(p=>p.fulfillmentPolicyId),['12']);
 assert.equal(conditionValue([{conditionDescriptorValueName:'Near mint or better'}],'NM').conditionDescriptorValueName,'Near mint or better');
});
test('missing campaign or policy is caught before any remote call and preserves saved batch',async()=>{
 for(const field of ['campaignId','fulfillmentPolicyId','paymentPolicyId','returnPolicyId','locationKey']){
  const f=fixture(),before=f.read();let calls=0;f.client.call=async()=>{calls++;throw Error('must not call');};
  await assert.rejects(f.service.configure(f.client,f.id,{...f.settings,[field]:''}),field==='paymentPolicyId'?/could not load your eBay payment policy/:/Choose|choose/);assert.equal(calls,0);assert.deepEqual(f.read(),before);
 }
});
test('changed campaign rate is rejected without saving configuration or publishing',async()=>{
 const f=fixture(),before=f.read(),call=f.client.call;
 f.client.call=async(name,args)=>name==='get_listing_campaign_snapshot'?{campaign:{...campaign,fundingStrategy:{...campaign.fundingStrategy,bidPercentage:'9'}},snapshots_sha256:'b'.repeat(64)}:call(name,args);
 await assert.rejects(f.service.configure(f.client,f.id,f.settings),/fixed 5%/);assert.deepEqual(f.read(),before);assert.equal(f.counts.publishes,0);
});
test('missing packed measurements or condition leave the same saved batch retryable',async()=>{
 const f=fixture(),call=f.client.call,before=f.read();f.client.call=async(name,args)=>name==='get_listing_policy_snapshot'?{snapshots_sha256:'a'.repeat(64),policies:{fulfillment_policy:envelope}}:call(name,args);
 await assert.rejects(f.service.configure(f.client,f.id,f.settings),/measured packed weight/);assert.deepEqual(f.read(),before);
 const settings={...f.settings,parcel:envelopeParcel,cards:{}};await assert.rejects(f.service.configure(f.client,f.id,settings),/choose the eBay condition/);assert.deepEqual(f.read(),before);
 await f.service.configure(f.client,f.id,{...settings,cards:f.settings.cards});assert.equal(f.read().publicationBatches.length,1);assert.equal(f.counts.uploads,0);assert.equal(f.counts.publishes,0);
});
test('calculated parcel requires measured owner confirmation and eligible envelope dimensions',()=>{
 assert.equal(checkedParcel(envelope,envelopeParcel,'raw').basis,'measured');
 for(const patch of [{weight_oz:''},{height_in:'0.25'},{weight_oz:'4'},{length_in:'12'},{verified:false},{envelopeConfirmed:false}])assert.throws(()=>checkedParcel(envelope,{...envelopeParcel,...patch},'raw'));
 assert.throws(()=>checkedParcel(envelope,envelopeParcel,'high'),/parcel policy/);assert.throws(()=>checkedParcel(envelope,envelopeParcel,'graded'),/parcel policy/);
 assert.equal(checkedParcel(mailer,mailerParcel,'high').weight_oz,'4');
});
test('calculated policies and measured parcels bind separately to low and high cards in one batch',async()=>{
 const f=fixture(),call=f.client.call;f.change(s=>{s.drafts[1]=draftInput({askCents:2500},s.drafts[1]);const entry={id:s.drafts[1].id,fingerprint:hash(listingContent(s.drafts[1]))};approveListings(s,[entry]);Object.assign(s.publicationBatches[0].entries[1],{fingerprint:entry.fingerprint,askCents:2500});});
 f.client.call=async(name,args)=>name==='get_listing_policy_snapshot'?{snapshots_sha256:(args.fulfillment_policy_id==='11'?'a':'c').repeat(64),policies:{fulfillment_policy:args.fulfillment_policy_id==='11'?envelope:mailer}}:call(name,args);
 const settings={...f.settings,shipping:{raw:{fulfillmentPolicyId:'11',parcel:envelopeParcel},high:{fulfillmentPolicyId:'12',parcel:mailerParcel}}};
 await f.service.configure(f.client,f.id,settings);const b=f.read().publicationBatches[0],s=f.read();
 const low=compileCard(s.drafts[0],b.bridge.settings,[]),high=compileCard(s.drafts[1],b.bridge.settings,[]);
 assert.equal(low.policies.fulfillment_policy_id,'11');assert.equal(high.policies.fulfillment_policy_id,'12');assert.equal(low.packed_parcel.weight_oz,'1');assert.equal(high.packed_parcel.weight_oz,'4');assert.equal(high.policies.snapshots_sha256,'c'.repeat(64));assert.equal(low.promotion_mode,'automatic_existing');assert.equal(f.counts.publishes,0);
});
test('prepare isolates missing year, preserves originals, resumes lost submit and publishes only exact approval',async()=>{
 const f=fixture();await f.service.configure(f.client,f.id,f.settings);assert.equal(f.counts.publishes,0);f.lose();
 for(let n=0;n<10;n++){try{const r=await f.service.prepare(f.client,f.id,'owner');if(!r.continuePreparation)break;}catch(e){assert.match(e.message,/Lost/);}}
 let b=f.read().publicationBatches[0];assert.equal(b.status,'ready');assert.equal(b.bridge.entries.filter(e=>e.error).length,1);assert.equal(f.counts.uploads,2);
 assert.equal(b.bridge.reviews[0].listings[0].draft.identity.year,2024);
 await assert.rejects(f.service.publish(f.client,f.id,b.bridge.reviewFingerprint),/Approve/);assert.equal(f.counts.publishes,0);
 await assert.rejects(f.service.publish(f.client,f.id,'stale',true),/changed/);
 await f.service.publish(f.client,f.id,b.bridge.reviewFingerprint,true);
 await f.service.publish(f.client,f.id,b.bridge.reviewFingerprint);
 await f.service.publish(f.client,f.id,b.bridge.reviewFingerprint);
 b=f.read().publicationBatches[0];assert.equal(b.status,'published');assert.equal(f.counts.publishes,2);assert.equal(f.counts.approvals,1);
 assert.throws(()=>cancelPublicationBatch(f.read(),f.id),/cannot/);
});
test('changed cards prevent final approval, and unapproved preparation can be rebuilt',async()=>{
 const f=fixture();await f.service.configure(f.client,f.id,f.settings);for(let n=0;n<10;n++){const r=await f.service.prepare(f.client,f.id,'owner');if(!r.continuePreparation)break;}
 const b=f.read().publicationBatches[0];f.change(s=>s.drafts[0].title='Changed after review');await assert.rejects(f.service.publish(f.client,f.id,b.bridge.reviewFingerprint,true),/changed/);assert.equal(f.counts.publishes,0);
 const s=f.read();cancelPublicationBatch(s,f.id);assert.equal(s.publicationBatches[0].status,'cancelled');
});
test('publishing connection uses PKCE, browser-bound callback, encrypted HttpOnly credential and server-side token',async()=>{
 const calls=[];const fetcher=async(url,opts)=>{calls.push({url,opts});if(url.endsWith('/register'))return Response.json({client_id:'synthetic-client'});if(url.endsWith('/token'))return Response.json({access_token:'SECRET_ACCESS',refresh_token:'SECRET_REFRESH',expires_in:3600});return Response.json({result:{structuredContent:{seller:'ballardtradingco',connector_listing_scope:true,missing_ebay_scopes:[]}}});};
 const c=createConnector({origin:'https://core.example',connectorOrigin:'https://connect.example',key:'a'.repeat(64),fetcher});const headers={},res={setHeader:(k,v)=>headers[k]=v};
 const target=new URL(await c.begin({headers:{}},res)),state=target.searchParams.get('state'),flowCookie=headers['Set-Cookie'].split(';')[0];assert.equal(target.searchParams.get('code_challenge_method'),'S256');
 const callback=new URL('https://core.example/api/ebay/callback?code=synthetic&state='+state);
 await assert.rejects(c.callback({headers:{cookie:'btcore_ebay_flow=forged'}},res,callback),/expired/);
 await c.callback({headers:{cookie:flowCookie}},res,callback);const cookie=headers['Set-Cookie'];assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.doesNotMatch(cookie,/SECRET/);
 const req={headers:{cookie:cookie.split(';')[0]}};assert.equal(c.status(req).connected,true);await (await c.client(req,res)).call('get_listing_readiness');assert.equal(calls.at(-1).opts.headers.Authorization,'Bearer SECRET_ACCESS');
 const grant=await c.mirrorGrant(req,res);assert.doesNotMatch(grant,/SECRET/);const reader=await c.mirrorClient(grant,async()=>{});await reader.call('get_active_listings',{page:1});assert.throws(()=>reader.call('publish_approved_batch',{}),/reading only/);await assert.rejects(()=>c.mirrorClient(grant+'tampered',async()=>{}),/Reconnect/);
 assert.equal(c.status({headers:{cookie:cookie.split(';')[0]+'tampered'}}).connected,false);await assert.rejects(c.client({headers:{}},res),/Connect/);
});

test('legacy saved batch cannot bypass the new price review before remote approval',async()=>{
 const f=fixture();await f.service.configure(f.client,f.id,f.settings);for(let n=0;n<10;n++){const r=await f.service.prepare(f.client,f.id,'owner');if(!r.continuePreparation)break;}
 const b=f.read().publicationBatches[0];f.change(s=>{delete s.drafts[0].priceReview;s.drafts[0].preparation={status:'complete',applied:{askCents:800}};});
 await assert.rejects(f.service.publish(f.client,f.id,b.bridge.reviewFingerprint,true),/Confirm each asking price/);assert.equal(f.counts.approvals,0);assert.equal(f.counts.publishes,0);
});

test('scheduled refresh and the connected browser share the latest rotating grant after restart',async()=>{
 let n=0,saved='';const fetcher=async(url,opts)=>{if(url.endsWith('/register'))return Response.json({client_id:'test-client'});if(url.endsWith('/token'))return Response.json({access_token:'ACCESS-'+(++n),refresh_token:'REFRESH-'+n,expires_in:n<=2?0:3600});return Response.json({result:{structuredContent:{seller:'ballardtradingco',connector_listing_scope:true,missing_ebay_scopes:[],authorization:opts.headers.Authorization}}});};
 const make=()=>createConnector({origin:'https://core.example',connectorOrigin:'https://connect.example',key:'b'.repeat(64),fetcher});let c=make();const headers={},res={setHeader:(k,v)=>headers[k]=v};const target=new URL(await c.begin({headers:{}},res)),flowCookie=headers['Set-Cookie'].split(';')[0];await c.callback({headers:{cookie:flowCookie}},res,new URL('https://core.example/api/ebay/callback?code=x&state='+target.searchParams.get('state')));
 const req={headers:{cookie:headers['Set-Cookie'].split(';')[0]}};saved=await c.mirrorGrant(req,res);const linkedCookie=headers['Set-Cookie'].split(';')[0];assert.equal(n,2);
 c=make();c.bindMirrorStorage({read:async()=>saved,write:async(old,value)=>{assert.equal(old,saved);saved=value;}});
 const reader=await c.mirrorClient(saved,async v=>saved=v);assert.equal((await reader.call('get_connection_status')).authorization,'Bearer ACCESS-3');const browser=await c.client({headers:{cookie:linkedCookie}},res);assert.equal((await browser.call('get_connection_status')).authorization,'Bearer ACCESS-3');assert.equal(n,3);
});

test('concurrent quick edit prevents stale shipping configuration from binding to a changed batch',async()=>{
 const f=fixture(),call=f.client.call;let edited=false;
 f.client.call=async(name,args)=>{if(!edited&&name==='get_listing_campaign_snapshot'){edited=true;f.change(s=>editListingRows(s,[{id:s.drafts[0].id,fingerprint:hash(listingContent(s.drafts[0])),fields:{askCents:900}}]));}return call(name,args);};
 await assert.rejects(f.service.configure(f.client,f.id,f.settings),/changed this batch/);
 assert.equal(f.read().publicationBatches[0].bridge,undefined);assert.equal(f.read().drafts[0].askCents,900);assert.equal(f.counts.publishes,0);
});
