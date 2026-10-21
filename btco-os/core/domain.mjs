import {validateLocations,normalizeLocation} from './inventory-locations.mjs';
import {validateFulfillment} from './fulfillment.mjs';
import {conditionChoices} from './public/listing-controls.mjs';
import {validateMirror} from './mirror.mjs';
import {validateChannelRecords} from './collx.mjs';
import {confirmPrice,priceNeedsReview} from './public/price-review.mjs';
import {missingPhotos} from './public/photo-policy.mjs';
import {roundAskingCents} from './public/pricing.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {makeItem,saveItem as saveItemRaw,validateState as validateStateRaw,recordSale as recordSaleRaw,voidSale as voidSaleRaw,summary,inventoryCSV,salesCSV} from '../web/domain/core.mjs';
export {summary,inventoryCSV,salesCSV};
export const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const checked=fn=>(...args)=>{try{return fn(...args);}catch(e){fail(e.message);}};
const saveItem=checked(saveItemRaw),validateState=checked(validateStateRaw),recordSale=checked(recordSaleRaw),voidSale=checked(voidSaleRaw);
export const hash=value=>createHash('sha256').update((typeof value==='string'||Buffer.isBuffer(value))?value:JSON.stringify(value)).digest('hex');
export function requireRevision(value){if(!Number.isSafeInteger(value)||value<0)fail('A current workspace revision is required.');}
const fields=['sku','title','kind','location','subject','year','setName','number','parallel','serial','gradeCompany','grade','cert','notes','vendor','acquisitionRef','acquiredDate','status','verification','quantity','autograph','costCents','askCents'];
export function itemInput(input,previous){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Item details are required.');
 for(const k of Object.keys(input))if(!fields.includes(k))fail('Unsupported item field: '+k);
 const item={...(previous??makeItem()),...input};
 if(!previous){item.id=randomUUID();if(!item.sku)item.sku='CORE-'+item.id.slice(0,8).toUpperCase();}
 item.askCents=roundAskingCents(item.askCents);
 if((previous?.source?.cdpSku||previous?.cdpLink?.sku)&&item.sku!==previous.sku)fail('The confirmed master SKU is locked.');
 if(previous&&Object.hasOwn(input,'location')&&input.location!==previous.location){item.physicalLocation=normalizeLocation({Location:input.location},'owner');}
 return item;
}
const draftFields=['shippingMode','team','sport','condition','rookie','title','kind','location','subject','year','setName','number','parallel','serial','gradeCompany','grade','cert','notes','vendor','acquisitionRef','acquiredDate','autograph','costCents','askCents','description','conditionNotes','identityReviewed','conditionReviewed','photoPolicy','cardClass','singlePhotoMaxCents','memorabilia'];
export function draftInput(input,previous,{ownerPrice=true,ownerCondition=ownerPrice}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Draft details are required.');
 for(const k of Object.keys(input))if(!draftFields.includes(k))fail('Unsupported draft field: '+k);
 if(previous&&previous.status!=='draft')fail(previous.status==='received'?'This intake is already in the Vault. Edit its inventory record.':'Restore this intake before editing it.',409);
 const d={id:randomUUID(),sku:'',title:'',kind:'comic',location:'',subject:'',year:'',setName:'',number:'',parallel:'',serial:'',gradeCompany:'',grade:'',cert:'',notes:'',vendor:'',acquisitionRef:'',acquiredDate:'',photoPolicy:'two-sided',cardClass:'unknown',singlePhotoMaxCents:500,team:'',sport:'',condition:'',rookie:false,memorabilia:false,autograph:false,costCents:null,askCents:null,description:'',conditionNotes:'',identityReviewed:false,conditionReviewed:false,photos:[],status:'draft',createdAt:new Date().toISOString(),...previous,...input};
 d.askCents=roundAskingCents(d.askCents);
 if(d.shippingMode!==undefined&&!['auto','parcel','review','lot'].includes(d.shippingMode))fail('Choose a valid shipping method.');
 d.sku=d.sku||'CORE-'+d.id.slice(0,8).toUpperCase();
 for(const [key,val] of Object.entries(d))if(draftFields.includes(key)&&typeof val==='string'&&val.length>4000)fail('Draft field is too long: '+key);
 if(!['two-sided','value-based'].includes(d.photoPolicy)||!['unknown','standard','premium'].includes(d.cardClass))fail('Invalid photo classification.');
 if(!Number.isSafeInteger(d.singlePhotoMaxCents)||d.singlePhotoMaxCents<0)fail('Invalid single-photo cutoff.');
 for(const k of ['identityReviewed','conditionReviewed','memorabilia','rookie'])if(typeof d[k]!=='boolean')fail('Review selections must be true or false.');
 for(const k of ['description','conditionNotes','team','sport','condition'])if(typeof d[k]!=='string')fail('Invalid '+k);
 // Reuse inventory validation without claiming that an unfinished draft is owned inventory.
 const probe=itemInput(Object.fromEntries(fields.filter(k=>k in d&&!['sku','status'].includes(k)).map(k=>[k,d[k]])));probe.title=d.title||'Unidentified intake';
 validateState(saveItem({schemaVersion:1,workspace:'btco-local',mode:'work',revision:0,items:[],sales:[],events:[]},probe));
 if(previous){
  const identity=['title','kind','subject','year','setName','number','parallel','serial','gradeCompany','grade','cert','autograph','memorabilia','photoPolicy','cardClass','singlePhotoMaxCents','askCents'];
  if(identity.some(k=>d[k]!==previous[k]))d.identityReviewed=false;
  if(d.conditionNotes!==previous.conditionNotes)d.conditionReviewed=false;
 }
 if(ownerPrice&&Object.hasOwn(input,'askCents')){if(priceNeedsReview(d))d.identityReviewed=false;d.priceReview=Number.isSafeInteger(d.askCents)&&d.askCents>0?confirmPrice(d):null;}
 if(ownerCondition&&Object.hasOwn(input,'condition')&&conditionChoices(d).value)d.conditionChoice={source:'owner',value:d.condition};
 d.updatedAt=new Date().toISOString();return d;
}
// Received originals remain locked; price review updates the existing Vault item atomically.
export function reviewReceivedPrice(state,id,input){
 const d=state.drafts.find(d=>d.id===id);
 if(!d||d.status!=='received')fail('Received intake not found.',404);
 if(!input||Object.keys(input).length!==1||!Object.hasOwn(input,'askCents'))fail('Only the asking price can be changed here.');
 if((state.publicationBatches??[]).some(b=>b.status!=='cancelled'&&b.entries.some(e=>e.draftId===id)))fail('Open the saved eBay batch before changing this price.',409);
 const item=state.inventory.items.find(i=>i.id===d.itemId);
 if(!item||item.source?.draftId!==d.id||item.sku!==d.sku)fail('The linked Vault record needs review.',409);
 if(item.status==='listed')fail('Review the live listing before changing this price.',409);
 const askCents=roundAskingCents(input.askCents);
 if(!Number.isSafeInteger(askCents)||askCents<100)fail('Enter an asking price of at least $1.');
 const updated=draftInput({askCents},{...d,status:'draft'});updated.status='received';updated.identityReviewed=false;
 const inventory=saveItem(state.inventory,itemInput({askCents},item));
 state.inventory=inventory;state.drafts[state.drafts.indexOf(d)]=updated;
 event(state,'core.received-price-reviewed',id,{itemId:item.id,askCents});return {draftId:id};
}
export function event(state,action,id,detail={}){state.inventory.events.push({id:randomUUID(),at:new Date().toISOString(),action,entityId:id,detail});}
export function editableDraft(state,id){
 const d=state.drafts.find(d=>d.id===id);if(!d)fail('Intake not found.',404);
 if(d.status!=='draft')fail(d.status==='received'?'Originals are locked after intake is confirmed.':'Restore this intake before editing it.',409);
 return d;
}
export function archiveDraft(state,id,restore=false){
 const d=state.drafts.find(d=>d.id===id);if(!d)fail('Intake not found.',404);
 if(d.status!==(restore?'archived':'draft'))fail(restore?'Only archived intake can be restored.':'Only unfinished intake can be archived.',409);
 d.status=restore?'draft':'archived';d.updatedAt=new Date().toISOString();
 if(restore){delete d.archivedAt;d.identityReviewed=false;d.conditionReviewed=false;}else d.archivedAt=d.updatedAt;
 event(state,restore?'core.draft-restored':'core.draft-archived',id);return {draftId:id};
}
export async function swapDraftPhotos(state,id,q){
 const d=editableDraft(state,id);if(d.photos.length!==2)fail('Add both sides before swapping them.');
 // Vacate unique assignment slots inside the same workspace transaction.
 for(const p of d.photos)await q('UPDATE core_photos SET role=? WHERE id=?',['swap:'+p.id,p.id]);
 const previous=d.photos.map(p=>({photoId:p.id,from:p.role,to:p.role==='front'?'back':'front'}));
 for(const p of d.photos){p.role=p.role==='front'?'back':'front';await q('UPDATE core_photos SET role=? WHERE id=?',[p.role,p.id]);}
 d.photos.sort((a,b)=>a.role==='front'?-1:1);d.identityReviewed=false;d.conditionReviewed=false;d.updatedAt=new Date().toISOString();
 event(state,'core.photos-swapped',id,{assignments:previous});return {draftId:id};
}
export function receiveDraft(state,draftId){
 const d=editableDraft(state,draftId);
 if(!d.title.trim()||!d.location.trim()||d.askCents===null)fail('Add a title, storage location, and asking price before confirming intake.');
 if(!d.identityReviewed||!d.conditionReviewed||!d.conditionNotes.trim())fail('Review the identity and record the visible condition before confirming intake.');
 if(missingPhotos(d).length)fail('Upload and review the required photos: '+missingPhotos(d).join(', ')+'.');
 const input=Object.fromEntries(fields.filter(k=>k in d).map(k=>[k,d[k]]));
 const item=itemInput({...input,quantity:1,verification:'verified',status:'ready'});item.source={system:'btcore-intake',draftId:d.id};
 state.inventory=saveItem(state.inventory,item);d.status='received';d.itemId=item.id;d.receivedAt=new Date().toISOString();event(state,'core.intake-confirmed',d.id,{itemId:item.id});return {itemId:item.id};
}
export function editInventory(state,input,itemId){
 const old=itemId?state.inventory.items.find(x=>x.id===itemId):undefined;if(itemId&&!old)fail('Item not found.',404);
 const item=itemInput(input,old);state.inventory=saveItem(state.inventory,item);return {itemId:item.id};
}
export function saveSale(state,input){
 if(input.id||input.cogsCents!==undefined||input.voidedAt!==undefined)fail('Sale identifiers and cost allocation are calculated by BTCore.');
 const allocations=state.inventory.marketplaceAllocations??[];
 const matches=allocations.filter(a=>a.itemId===input.itemId&&!a.accountedSaleId&&a.channel===input.channel?.toLowerCase()&&a.orderId===input.reference);
 if(matches.length){
  if(matches.length!==1||matches[0].quantity!==input.quantity)fail('Select and reconcile the exact marketplace order line before recording its finances.',409);
  const a=matches[0],inventory=structuredClone(state.inventory);inventory.marketplaceAllocations=inventory.marketplaceAllocations.filter(x=>x.id!==a.id);
  const next=recordSale(inventory,{...input});next.marketplaceAllocations.push({...a,accountedSaleId:next.sales.at(-1).id});state.inventory=next;
 }else state.inventory=recordSale(state.inventory,{...input});
 return {saleId:state.inventory.sales.at(-1).id};
}
export function reverseSale(state,id){state.inventory=voidSale(state.inventory,id);for(const a of state.inventory.marketplaceAllocations??[])if(a.accountedSaleId===id)delete a.accountedSaleId;return {saleId:id};}
export function validateWorkspace(state){
 if(!state||state.schemaVersion!==1||!Array.isArray(state.drafts)||state.drafts.length>10000||!Number.isSafeInteger(state.revision)||state.revision<0)fail('Invalid workspace.');
 validateState(state.inventory);if(state.inventory.mode!=='work'||state.inventory.revision!==state.revision)fail('Invalid workspace revision.');
 const draftIds=new Set(),photoIds=new Set();
 for(const d of state.drafts){
  if(!d||typeof d.id!=='string'||!/^[a-f0-9-]{36}$/.test(d.id)||draftIds.has(d.id)||typeof d.sku!=='string'||!d.sku.trim()||d.sku.length>200||!Array.isArray(d.photos)||d.photos.length>2||!['draft','received','archived'].includes(d.status))fail('Invalid saved intake.');
  draftIds.add(d.id);draftInput(Object.fromEntries(draftFields.filter(k=>k in d).map(k=>[k,d[k]])));
  if(!Number.isFinite(Date.parse(d.createdAt)))fail('Invalid intake date.');
  if(d.status==='received'&&!state.inventory.items.some(i=>i.id===d.itemId))fail('Intake inventory record is missing.');
  if(d.status==='archived'&&!Number.isFinite(Date.parse(d.archivedAt)))fail('Invalid archive date.');
  if(d.photoHistory!==undefined&&(!Array.isArray(d.photoHistory)||d.photoHistory.length>50))fail('Invalid photo history.');
  const roles=new Set();
  for(const [photos,retired] of [[d.photos,false],[d.photoHistory??[],true]])for(const p of photos){
   if(!p||typeof p.id!=='string'||!/^[a-f0-9-]{36}$/.test(p.id)||photoIds.has(p.id)||!['front','back'].includes(p.role)||(!retired&&roles.has(p.role))||!/^[a-f0-9]{64}$/.test(p.sha256)||!Number.isSafeInteger(p.sizeBytes)||p.sizeBytes<1||p.sizeBytes>12*1024*1024||!Number.isSafeInteger(p.width)||!Number.isSafeInteger(p.height)||p.width<100||p.height<100||p.width*p.height>40000000||typeof p.filename!=='string'||p.filename.length>180||!['image/jpeg','image/png','image/webp','image/heic'].includes(p.mediaType))fail('Invalid saved photo reference.');
   if(retired&&(!Number.isFinite(Date.parse(p.supersededAt))||![...d.photos,...d.photoHistory].some(next=>next.id===p.replacedBy&&next.id!==p.id)))fail('Invalid photo replacement history.');
   photoIds.add(p.id);if(!retired)roles.add(p.role);
  }
 }
 validateLocations(state);
 validateFulfillment(state);
 validateChannelRecords(state);
 validateMirror(state);
 return state;
}


