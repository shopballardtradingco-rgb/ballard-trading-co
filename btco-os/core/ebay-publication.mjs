import {priceNeedsReview} from './public/price-review.mjs';
import {eligibleCampaign,shippingGroup,shippingGroupLabel,checkSelections,checkedParcel,isEnvelope,checkedShippingCost} from './public/ebay-settings.mjs';
import {fail,hash,event} from './domain.mjs';
import {publicationBatches} from './publication.mjs';
import {photoBytes} from './object-storage.mjs';
const batchFor=(state,id)=>{const b=state.publicationBatches?.find(b=>b.id===id);if(!b||b.status==='cancelled')fail('Batch not found.',404);return b;};
function unchanged(state,b){if(b.entries.some(e=>priceNeedsReview(state.drafts.find(d=>d.id===e.draftId)??{})))fail('Confirm each asking price in card review, then rebuild this batch.',409);if(publicationBatches(state).find(x=>x.id===b.id)?.entries.some(e=>e.changed))fail('A card changed. Review it again before continuing.',409);}
export function compileCard(d,settings,photos){
 const choice=settings.cards?.[d.id];
 if(!choice||!['2750','4000'].includes(choice.conditionId))fail(d.sku+': select the eBay card condition.');
 if(choice.conditionId!==(d.gradeCompany?'2750':'4000'))fail(d.sku+': graded status does not match the reviewed card.');
 if(!/^\d{4}$/.test(String(d.year))||Number(d.year)<1800||Number(d.year)>2100)fail(d.sku+': add the card year.');
 if(!d.sport&&settings.categoryId==='261328')fail(d.sku+': add the sport.');
 const aspects={'Type':[settings.categoryId==='261328'?'Sports Trading Card':'Non-Sport Trading Card'],'Set':[d.setName],'Year Manufactured':[String(d.year)],'Graded':[choice.conditionId==='2750'?'Yes':'No']};
 if(settings.categoryId==='183454')aspects.Type=['Collectible Card Game'];
 if(settings.categoryId==='261328')aspects['Player/Athlete']=[d.subject];else aspects.Character=[d.subject];
 for(const [k,v] of [['Sport',d.sport],['Team',d.team],['Card Number',d.number],['Parallel/Variety',d.parallel]])if(v)aspects[k]=[String(v)];
 if(d.autograph===true)aspects.Autographed=['Yes'];
 if(d.rookie===true)aspects.Features=['Rookie'];
 const price=String(d.askCents/100),shipping=settings.shippingGroups?.[shippingGroup(d)];
 return {product_type:'card',draft_id:'btco-card-'+d.id,physical_item_id:'core:'+d.id,master_sku:d.sku,title:d.title,description:d.description,price_usd:price,
  best_offer:{enabled:d.askCents>500,minimum_offer_usd:d.askCents>500?String(d.askCents/100-2):null},photos,
  identity:{subject:d.subject,set_name:d.setName,year:Number(d.year),number:String(d.number??''),verified:true,evidence:'Owner-reviewed Core card details and original photos; Core draft '+d.id},
  condition:choice.conditionId==='2750'?'LIKE_NEW':'USED_VERY_GOOD',condition_descriptors:choice.descriptors,condition_description:d.conditionNotes,
  item_specifics:aspects,category_id:settings.categoryId,merchant_location_key:settings.locationKey,policies:shipping?.policies??settings.policies,...(shipping?.parcel?{packed_parcel:shipping.parcel}:{}),
  promotion_percent:5,promotion_campaign_id:settings.campaignId,promotion_campaign_sha256:settings.campaignHash,promotion_mode:settings.campaignMode??'manual',promotion_unavailable_reason:null,
 };
}
export async function reviewAll(client,ids){const reviews=[];for(const id of ids){let offset=0,review;do{const page=await client.call('get_listing_batch_review',{batch_id:id,offset,limit:20,...(review?{expected_review_revision:review.review_revision}:{})});if(!review)review={...page,listings:[]};review.listings.push(...page.listings);offset=page.next_offset;}while(offset!==null&&offset!==undefined);reviews.push(review);}return reviews;}
const canAttempt=(listing,now)=>!listing.publication?.all_checks_verified&&listing.last_attempt?.disposition!=='owner_action'&&Number(listing.last_attempt?.retry_after??0)<=now;
// Approval revisions intentionally exclude progress. Use journaled outcomes to
// detect progress, including a failed card that has released the next card.
const progressFingerprint=reviews=>hash(reviews.map(r=>[r.batch_id,r.listings.map(l=>[l.draft_id,l.publication,l.last_attempt??null])]));
export function createEbayPublication({store,objectStore,commit}){
 const locks=new Set();
 async function lock(id,fn){if(locks.has(id))fail('This batch is already running. Refresh its status.',409);locks.add(id);try{return await fn();}finally{locks.delete(id);}}
 async function update(id,fn){return commit(state=>{const b=batchFor(state,id);const value=fn(b,state);return {changed:true,...value};});}
 return {
 async configure(client,id,input){return lock(id,async()=>{
  const state=await store.workspace(),batch=batchFor(state,id);unchanged(state,batch);
  if(batch.bridge)fail('This batch already has saved eBay settings. Continue its preparation.',409);
  if(!['261328','183050','183454'].includes(input.categoryId)||input.combinedShipping!==true)fail('Choose a category and confirm combined shipping.');
  try{checkSelections(input);}catch(e){fail(e.message);}
  const groupKeys=[...new Set(batch.entries.map(e=>shippingGroup(state.drafts.find(d=>d.id===e.draftId))))];
  for(const key of groupKeys)if(!/^\d{1,30}$/.test((input.shipping?.[key]?.fulfillmentPolicyId??input.fulfillmentPolicyId)??''))fail(shippingGroupLabel[key]+': choose a shipping policy before continuing.');
  const campaign=await client.call('get_listing_campaign_snapshot',{campaign_id:input.campaignId});
  if(campaign.campaign?.campaignId!==input.campaignId||!eligibleCampaign(campaign.campaign))fail('That campaign is not an eligible running fixed 5% campaign. Refresh shipping settings and choose an existing 5% campaign. No campaign was changed.');
  const shippingGroups={};
  for(const key of groupKeys){
   const selection=input.shipping?.[key]??{fulfillmentPolicyId:input.fulfillmentPolicyId,parcel:input.parcel};
   const snapshot=await client.call('get_listing_policy_snapshot',{fulfillment_policy_id:selection.fulfillmentPolicyId,payment_policy_id:input.paymentPolicyId,return_policy_id:input.returnPolicyId});
   let parcel,costReview;try{parcel=checkedParcel(snapshot.policies.fulfillment_policy,selection.parcel,key);costReview=checkedShippingCost(selection.costReview,key);}catch(e){fail(e.message);}
   shippingGroups[key]={label:shippingGroupLabel[key],snapshot:snapshot.policies,parcel,costReview,policies:{fulfillment_policy_id:selection.fulfillmentPolicyId,payment_policy_id:input.paymentPolicyId,return_policy_id:input.returnPolicyId,snapshots_sha256:snapshot.snapshots_sha256,buyer_paid_shipping:true,combined_shipping_confirmed:true,combined_shipping_evidence:'Owner confirmed combined shipping while reviewing the existing eBay policy in BTCore.'}};
  }
  const options=await client.call('get_card_listing_options',{category_id:input.categoryId});
  const cards=structuredClone(input.cards??{});
  for(const entry of batch.entries){const choice=cards[entry.draftId],required=choice?.conditionId==='2750'?['27501','27502']:['40001'];if(required.some(id=>!choice?.descriptors?.some(d=>d.name===id&&d.values?.[0])))fail(entry.title+': choose the eBay condition or grade below before continuing.');}
  for(const choice of Object.values(cards)){const condition=options.category.itemConditionPolicies?.[0]?.itemConditions?.find(c=>c.conditionId===choice.conditionId);choice.labels=(choice.descriptors??[]).map(d=>{const definition=condition?.conditionDescriptors?.find(x=>x.conditionDescriptorId===d.name);if(!definition)fail('A selected card condition is unavailable.');if(d.additionalInfo)return definition.conditionDescriptorName+': '+d.additionalInfo;const value=definition.conditionDescriptorValues?.find(v=>v.conditionDescriptorValueId===d.values?.[0]);if(!value)fail('A selected grade or condition is unavailable.');return definition.conditionDescriptorName+': '+value.conditionDescriptorValueName;});}
  const firstShipping=shippingGroups[groupKeys[0]],settings={categoryId:input.categoryId,locationKey:input.locationKey,cards,shippingGroups,policies:firstShipping.policies,campaignId:input.campaignId,campaignHash:campaign.snapshots_sha256,campaignMode:campaign.campaign?.campaignCriterion?'automatic_existing':'manual'};
  const entries=batch.entries.map(e=>{const d=state.drafts.find(d=>d.id===e.draftId);let error=null;try{compileCard(d,settings,[]);}catch(e){error=e.message;}return {draftId:e.draftId,sku:e.sku,title:e.title,location:e.location,photos:[],error,status:error?'exception':'pending'};});
  await update(id,(b,current)=>{unchanged(current,b);if(hash(b.entries)!==hash(batch.entries))fail('Card edits changed this batch while shipping was loading. Reopen shipping to review the saved changes.',409);if(b.bridge)fail('Batch settings changed.',409);b.status='preparing';b.bridge={seller:client.seller,settings,policySnapshot:firstShipping.snapshot,campaignSnapshot:campaign.campaign,entries,groups:[],createdAt:new Date().toISOString()};current.ebayListingDefaults={seller:client.seller,paymentPolicyId:input.paymentPolicyId,returnPolicyId:input.returnPolicyId,locationKey:input.locationKey,campaignId:input.campaignId,pwe:shippingGroups.raw&&isEnvelope(shippingGroups.raw.snapshot.fulfillment_policy)?{fulfillmentPolicyId:shippingGroups.raw.policies.fulfillment_policy_id,parcel:shippingGroups.raw.parcel}:current.ebayListingDefaults?.seller===client.seller?current.ebayListingDefaults.pwe:null};event(current,'core.ebay-preparing',id);});return {configured:true};
 });},
 async prepare(client,id,ownerId,retryExceptions=false){return lock(id,async()=>{
  let state=await store.workspace(),b=batchFor(state,id);unchanged(state,b);if(!b.bridge)fail('Choose eBay settings first.');if(b.bridge.seller!==client.seller)fail('Seller connection changed.',403);
  if(retryExceptions){
   if(b.publicationApproved)fail('This batch has already been approved. Refresh its publication status.',409);
   await update(id,b=>{const grouped=new Set(b.bridge.groups.flatMap(g=>g.ids));for(const e of b.bridge.entries)if(e.status==='exception'&&!grouped.has(e.draftId)){e.status='pending';e.error=null;}b.status='preparing';delete b.bridge.reviewFingerprint;delete b.bridge.reviews;});
   state=await store.workspace();b=batchFor(state,id);
  }
  const pending=b.bridge.entries.find(e=>e.status==='pending');
  if(pending){
   const d=state.drafts.find(d=>d.id===pending.draftId);const refs=[...pending.photos];
   try{
    for(const p of [...d.photos].sort((a,b)=>a.role==='front'?-1:1)){
     if(refs.some(x=>x.sha256_hex===p.sha256))continue;
     if(!['image/jpeg','image/png'].includes(p.mediaType))fail('This photo needs a JPEG or PNG original for eBay.');
     const row=(await store.query('SELECT * FROM core_photos WHERE id=? AND owner_id=?',[p.id,ownerId]))[0];if(!row)fail('Original photo is missing.');const bytes=await photoBytes(row,objectStore);if(hash(bytes)!==p.sha256)fail('Original checksum mismatch.');
     refs.push(await client.upload(bytes,p));await update(id,b=>{b.bridge.entries.find(e=>e.draftId===d.id).photos=refs;});
    }
    const draft=compileCard(d,b.bridge.settings,refs),valid=await client.call('validate_listing_draft',{draft});if(!valid.valid)fail(valid.errors.map(e=>e.message).join(' '));
    let expectedRevision;try{const previous=await client.call('get_listing_draft',{draft_id:draft.draft_id});expectedRevision=previous.revision;}catch(e){if(!/not found/i.test(e.message))throw e;}
    await update(id,b=>Object.assign(b.bridge.entries.find(e=>e.draftId===d.id),{status:'transferred',draft,expectedRevision}));
   }catch(e){await update(id,b=>Object.assign(b.bridge.entries.find(e=>e.draftId===d.id),{status:'exception',error:e.message}));}
   return {continuePreparation:true};
  }
  const grouped=new Set(b.bridge.groups.flatMap(g=>g.ids));
  if(b.bridge.entries.some(e=>e.status==='transferred'&&!grouped.has(e.draftId))){
   const groups=[],offset=b.bridge.groups.length;for(const entry of b.bridge.entries.filter(e=>e.status==='transferred'&&!grouped.has(e.draftId))){let group=groups.find(g=>g.location===entry.location&&g.ids.length<10&&g.bytes+JSON.stringify(entry.draft).length<190000);if(!group){group={id:'btco-batch-'+id+'-'+(offset+groups.length),location:entry.location,ids:[],submitted:false,bytes:0};groups.push(group);}group.ids.push(entry.draftId);group.bytes+=JSON.stringify(entry.draft).length;}
   await update(id,b=>{b.bridge.groups.push(...groups);});state=await store.workspace();b=batchFor(state,id);
  }
  for(const group of b.bridge.groups){
   if(!group.submitted){const items=group.ids.map(id=>{const e=b.bridge.entries.find(e=>e.draftId===id);return {item_key:id,label:e.title,draft:e.draft,...(e.expectedRevision?{expected_draft_revision:e.expectedRevision}:{})};});
    await client.call('prepare_listing_batch',{batch:{batch_id:group.id,inventory_location:group.location,items,confirmed_rejection_retry_limit:0}});await update(id,b=>{b.bridge.groups.find(g=>g.id===group.id).submitted=true;});return {continuePreparation:true};}
   const current=await client.call('get_listing_batch',{batch_id:group.id});if(current.continue_preparation){await client.call('resume_listing_batch',{batch_id:group.id});return {continuePreparation:true};}
  }
  const reviews=await reviewAll(client,b.bridge.groups.map(g=>g.id));await update(id,(b,s)=>{unchanged(s,b);b.status='ready';b.bridge.reviews=reviews;b.bridge.reviewFingerprint=hash(reviews.map(r=>[r.batch_id,r.review_revision]));});return {continuePreparation:false};
 });},
 async refresh(client,id){return lock(id,async()=>{
  const b=batchFor(await store.workspace(),id);
  if(!b.bridge||b.bridge.seller!==client.seller)fail('Connect the matching eBay seller.',403);
  const groups=b.bridge.groups.filter(g=>g.submitted),reviews=await reviewAll(client,groups.map(g=>g.id));
  // Observe existing jobs only. Never approve, prepare, retry or publish here.
  for(const [i,r] of reviews.entries()){
   const group=groups[i],expected=new Set(group.ids.map(id=>'btco-card-'+id)),seen=new Set();
   if(r.batch_id!==group.id)fail('The returned eBay batch does not match this saved group.',409);
   const previous=b.bridge.reviews?.find(old=>old.batch_id===r.batch_id);
   if(previous&&previous.review_revision!==r.review_revision)fail('The saved eBay review changed. Review the batch before continuing.',409);
   for(const l of r.listings){
    if(!expected.has(l.draft_id)||seen.has(l.draft_id))fail('The returned eBay listings do not match this saved group.',409);
    seen.add(l.draft_id);
   }
  }
  const all=reviews.flatMap(r=>r.listings),total=b.bridge.groups.reduce((n,g)=>n+g.ids.length,0),verified=all.filter(l=>l.publication?.all_checks_verified&&l.publication?.item_id).length;
  const complete=groups.length>0&&groups.length===b.bridge.groups.length&&b.bridge.entries.every(e=>e.status==='exception'||groups.some(g=>g.ids.includes(e.draftId)))&&reviews.every((r,i)=>
   !r.continue_preparation&&!r.exceptions?.length&&r.listings.length===groups[i].ids.length)&&all.length>0&&verified===all.length;
  const checkedAt=new Date().toISOString();
  await update(id,(current,state)=>{
   if(hash(current.bridge)!==hash(b.bridge))fail('This batch changed while checking eBay. Check its status again.',409);
   current.bridge.reviews=reviews;current.bridge.reviewFingerprint=hash(reviews.map(r=>[r.batch_id,r.review_revision]));current.bridge.lastCheckedAt=checkedAt;
   if(complete)current.status='published';
   event(state,'core.ebay-status-checked',id,{verified,total,complete});
  });
  return {refreshed:true,complete,verified,total,checkedAt};
 });},
 async publish(client,id,reviewFingerprint,approve=false){return lock(id,async()=>{
  const state=await store.workspace(),b=batchFor(state,id);if(!b.bridge||b.bridge.seller!==client.seller)fail('Connect the matching eBay seller.',403);
  if(approve){unchanged(state,b);if(b.status!=='ready')fail('Finish preparing the batch first.');}
  if(reviewFingerprint!==b.bridge.reviewFingerprint)fail('The review changed. Refresh it before publishing.',409);
  const reviews=await reviewAll(client,b.bridge.groups.map(g=>g.id));if(hash(reviews.map(r=>[r.batch_id,r.review_revision]))!==reviewFingerprint)fail('The eBay review changed. Refresh before approving.',409);
  if(approve){if(reviews.some(r=>r.continue_preparation)||!reviews.some(r=>r.listings.length))fail('There are no prepared listings to publish.');
   // Persist the exact owner click BEFORE remote approval; a lost response resumes the same revisions.
   await update(id,(b,s)=>{unchanged(s,b);b.status='publishing';b.publicationApproved=true;b.bridge.approvedFingerprint=reviewFingerprint;b.bridge.approvedAt=new Date().toISOString();event(s,'core.ebay-approved',id,{reviewFingerprint});});
  }else if(!b.publicationApproved||b.bridge.approvedFingerprint!==reviewFingerprint)fail('Approve the complete eBay review first.',403);
  const beforeProgress=progressFingerprint(reviews);
  for(const review of reviews){
   if(!review.listings.length)continue;
   if(!review.listings.some(l=>canAttempt(l,Date.now()/1000)))continue;
   if(!review.approval_current)await client.call('approve_listing_batch',{batch_id:review.batch_id,review_revision:review.review_revision,owner_approval_evidence:'Owner clicked Approve and publish in BTCore after reviewing the exact complete batch, original photos, listing text, prices, shipping, policies, promotion and no automatic confirmed-rejection retries. Core review '+reviewFingerprint});
   const result=await client.call('publish_approved_batch',{batch_id:review.batch_id,review_revision:review.review_revision,max_items:1});
   if(result.processed_item_keys?.length||result.verified_count>review.verified_count)break;
  }
  const next=await reviewAll(client,b.bridge.groups.map(g=>g.id));const all=next.flatMap(r=>r.listings);const complete=all.length>0&&all.every(l=>l.publication?.all_checks_verified);
  const now=Date.now()/1000,remaining=all.filter(l=>!l.publication?.all_checks_verified),waiting=remaining.filter(l=>l.last_attempt?.disposition!=='owner_action'&&Number(l.last_attempt?.retry_after)>now);
  await update(id,b=>{b.bridge.reviews=next;b.status=complete?'published':'publishing';});
  return {complete,verified:all.filter(l=>l.publication?.all_checks_verified).length,
   continueAutomatically:progressFingerprint(next)!==beforeProgress&&remaining.some(l=>canAttempt(l,now)),
   needsAttention:remaining.filter(l=>l.last_attempt?.disposition==='owner_action').length,
   nextRetryAt:waiting.length?Math.min(...waiting.map(l=>Number(l.last_attempt.retry_after))):null};
 });},
 };
}
