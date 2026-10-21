import {cardDefaults} from './public/card-defaults.mjs';
import {checkedCondition} from './public/listing-controls.mjs';
import {randomUUID,randomBytes} from 'node:crypto';
import {hash,fail,event,draftInput} from './domain.mjs';
import {listingContent,listingProblems} from './public/preparation-policy.mjs';
import {photoBytes} from './object-storage.mjs';
import {RESERVE_MICROS} from './ai-provider.mjs';
import {roundAskingCents} from './public/pricing.mjs';
const now=()=>new Date().toISOString();
const fingerprint=d=>hash(listingContent(d));
export const needsPreparation=d=>d.kind==='card'&&d.status==='draft'&&d.photos.some(p=>p.role==='front')&&!['queued','running'].includes(d.preparation?.status)&&(d.preparation?.status!=='complete'||d.preparation.outputFingerprint!==fingerprint(d));
export const isListingApproved=d=>Boolean(d.identityReviewed&&d.conditionReviewed&&d.listingReview?.fingerprint===fingerprint(d)&&!listingProblems(d).length);
export function enqueuePreparation(state,ids,{retry=false}={}){
 if(!Array.isArray(ids)||ids.length<1||ids.length>500||new Set(ids).size!==ids.length)fail('Select between 1 and 500 cards.');
 let count=0;for(const id of ids){const d=state.drafts.find(d=>d.id===id);if(!d||d.kind!=='card'||d.status!=='draft'||!d.photos.some(p=>p.role==='front'))fail('Every selected card needs a saved front photo and an unfinished intake.');const p=d.preparation;if(p&&['running','queued'].includes(p.status))continue;if(p?.status==='complete'&&p.outputFingerprint===fingerprint(d))continue;if(p?.status==='error'&&!retry)continue;d.preparation={status:'queued',queuedAt:now(),attempts:p?.attempts??0,previousApplied:p?.applied??p?.previousApplied??{}};count++;}return {queued:count};
}
export function approveListings(state,entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>500||new Set(entries.map(x=>x.id)).size!==entries.length)fail('Select cards to approve.');
 const drafts=entries.map(e=>{const d=state.drafts.find(x=>x.id===e.id);if(!d||(e.fingerprint!==undefined?e.fingerprint!==fingerprint(d):e.content!==listingContent(d)))fail('A selected card changed. Refresh and review it again.',409);const issues=listingProblems(d);if(issues.length)fail((d.title||d.sku)+': '+issues.join('; '));return d;});
 for(const d of drafts){const oldAsk=d.askCents,oldFingerprint=fingerprint(d);d.askCents=roundAskingCents(oldAsk);if(d.preparation?.applied?.askCents===oldAsk)d.preparation.applied.askCents=d.askCents;if(d.preparation?.outputFingerprint===oldFingerprint)d.preparation.outputFingerprint=fingerprint(d);d.identityReviewed=true;d.conditionReviewed=true;d.listingReview={fingerprint:fingerprint(d),at:now(),photoToken:d.listingReview?.photoToken??randomBytes(24).toString('hex')};event(state,'core.listing-approved',d.id);}
 return {approved:drafts.length};
}
export function updateListingDetails(state,entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>500||entries.some(e=>!e||typeof e.id!=='string')||new Set(entries.map(e=>e.id)).size!==entries.length)fail('Select between 1 and 500 cards to finish.');
 // Validate every row before changing any draft or recording events.
 const updates=entries.map(e=>{
  const d=state.drafts.find(d=>d.id===e.id);
  if(!d||e.fingerprint!==fingerprint(d))fail('A card changed. Reopen Finish remaining to review the latest details.',409);
  if(d.kind!=='card'||d.status!=='draft'||isListingApproved(d)||['queued','running'].includes(d.preparation?.status))fail('Only unfinished cards that are not preparing can be edited here.',409);
  const c=e.changes;
  if(!c||typeof c!=='object'||Array.isArray(c)||!Object.keys(c).length||Object.keys(c).some(k=>!['askCents','condition'].includes(k)))fail('Only asking price and listing condition can be updated here.');
  if('askCents' in c&&(!Number.isSafeInteger(c.askCents)||roundAskingCents(c.askCents)<100))fail('Enter a positive asking price.');
  if('condition' in c){try{checkedCondition(d,c.condition);}catch(e){fail(e.message);}}
  return {previous:d,next:draftInput(c,d)};
 });
 for(const {previous,next} of updates){state.drafts[state.drafts.indexOf(previous)]=next;event(state,'core.listing-details-updated',next.id);}
 return {updated:updates.length};
}
export function createPreparationWorker({store,objectStore,assessor,monthlyBudgetMicros=10000000,commit,clock=()=>Date.now()}){
 let running=false,stopped=false,timer,idle=null;
 const tick=async()=>{
  if(running||stopped||!assessor)return;running=true;
  try{
   // Idle checks read only the revision, avoiding a full workspace parse and
   // row lock every 1.5 seconds. Other processes still wake us through revisions.
   if(idle&&clock()<idle.until){const row=(await store.query('SELECT revision FROM core_workspace WHERE id=1'))[0];if(row.revision===idle.revision)return;}
   idle=null;
   const job=await commit(async(state,q)=>{
    let changed=false;for(const d of state.drafts){if(d.preparation?.status==='running'&&d.preparation.leaseUntil<clock()){d.preparation.status='error';d.preparation.error='Preparation was interrupted. Retry this card.';changed=true;}}
    const d=state.drafts.find(d=>d.status==='draft'&&d.preparation?.status==='queued');if(!d)return {changed,idle:{revision:state.revision,until:Math.min(Infinity,...state.drafts.filter(d=>d.preparation?.status==='running').map(d=>d.preparation.leaseUntil))}};
    const period=new Date(clock()).toISOString().slice(0,7);state.aiUsage??={};const usage=state.aiUsage[period]??={chargedMicros:0,attempts:0};
    if(usage.chargedMicros+RESERVE_MICROS>monthlyBudgetMicros){d.preparation.status='error';d.preparation.error='Monthly AI allowance reached. Saved photos remain available.';return {changed:true};}
    const owner=(await q('SELECT id FROM core_owner'))[0];if(!owner)return {changed};
    usage.chargedMicros+=RESERVE_MICROS;usage.attempts++;const token=randomUUID();d.preparation={...d.preparation,status:'running',token,startedAt:now(),leaseUntil:clock()+240000,attempts:d.preparation.attempts+1,inputFingerprint:fingerprint(d)};
    return {changed:true,job:{draft:structuredClone(d),ownerId:owner.id,token,period}};
   });
   if(!job?.job){idle=job?.idle??null;return;}const {draft,ownerId,token,period}=job.job;
   let assessment,error,errorStatus;
   try{const photos=[];for(const ref of draft.photos){const p=(await store.query('SELECT * FROM core_photos WHERE id=? AND owner_id=?',[ref.id,ownerId]))[0];if(!p)fail('An original photo could not be read.',502);photos.push({role:ref.role,bytes:await photoBytes(p,objectStore)});}assessment=await assessor({draft,photos});}
   catch(e){errorStatus=e.status;error=e.status?e.message:'Card preparation failed. Your saved photos are safe.';}
   await commit(async state=>{
    const d=state.drafts.find(x=>x.id===draft.id);if(!d||d.preparation?.token!==token||d.preparation.status!=='running')return {changed:false};
    if(assessment){const usage=state.aiUsage[period];usage.chargedMicros+=Math.max(0,assessment.costMicros??RESERVE_MICROS)-RESERVE_MICROS;}
    if(d.status!=='draft'||fingerprint(d)!==draft.preparation.inputFingerprint){d.preparation={status:'error',attempts:d.preparation.attempts,previousApplied:d.preparation.previousApplied,error:'Photos or details changed during preparation. Retry to assess the current card.'};return {changed:true};}
    if(error){d.preparation={status:'error',attempts:d.preparation.attempts,previousApplied:d.preparation.previousApplied,error};if([429,503].includes(errorStatus))for(const other of state.drafts)if(other.preparation?.status==='queued'){other.preparation.status='error';other.preparation.error='Queue paused: '+error;}return {changed:true};}
    const r=assessment.result,changes={};
    for(const k of ['title','subject','year','setName','number','parallel','serial','gradeCompany','grade','cert','conditionNotes','description','team','sport','condition'])if(!(k==='condition'&&d.conditionChoice?.source==='owner'&&d.conditionChoice.value===d.condition)&&(!d[k]||d[k]===d.preparation.previousApplied?.[k])&&r[k]!==undefined)changes[k]=r[k];
    // Research suggestions never write the owner's asking price. Existing prices remain intact.

    if(d.cardClass==='unknown'||d.cardClass===d.preparation.previousApplied?.cardClass)changes.cardClass=r.cardClass;
    for(const k of ['autograph','memorabilia','rookie'])if(r[k]||d[k]===d.preparation.previousApplied?.[k])changes[k]=r[k];
    Object.assign(d,draftInput(changes,d,{ownerPrice:false}));
    const defaults=cardDefaults({...d,preparation:{...d.preparation,applied:changes}},Number(new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'America/Los_Angeles'}).format(new Date(clock()))));
    if(Object.hasOwn(defaults.fields,'year'))d.identifiedYearOriginal??=d.year||r.year||d.title;
    if(Object.hasOwn(defaults.fields,'condition'))d.conditionChoice={...defaults.condition,previous:d.condition};
    Object.assign(d,defaults.fields);Object.assign(changes,defaults.fields);d.identityReviewed=false;d.conditionReviewed=false;
    d.preparation={status:'complete',attempts:d.preparation.attempts,completedAt:now(),model:assessment.model,result:r,applied:changes};d.preparation.outputFingerprint=fingerprint(d);event(state,'core.card-prepared',d.id);return {changed:true};
   });
  }finally{running=false;}
 };
 const start=()=>{timer=setInterval(()=>tick().catch(()=>{}),1500);timer.unref();};
 const stop=async()=>{stopped=true;clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,50));};
 return {tick,start,stop};
}

