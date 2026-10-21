import {validateState,makeItem,listingPrice} from './core.mjs';
import {skuAliases,skuKey} from './intake-contract.mjs';
import {hashText} from './sync-pack.mjs';

const fail=message=>{throw Error(message);};
const encoder=new TextEncoder();
const bounded=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function decode(value,max){
  if(!bounded(value,max)||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('Invalid signed-receipt encoding.');
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  if(btoa(String.fromCharCode(...bytes))!==value)fail('Noncanonical receipt encoding.');
  return bytes;
}
export async function verifyPublicationReceipt(envelope,{publicKeyB64,sellerId,now=Date.now()}={}){
  if(!object(envelope)||envelope.schema!=='btco.signed-publication.v1'||envelope.algorithm!=='Ed25519')fail('A signed connector publication receipt is required.');
  const publicKey=decode(publicKeyB64,44),signature=decode(envelope.signature_b64,88),payload=decode(envelope.payload_b64,16000);
  if(publicKey.length!==32||signature.length!==64)fail('Invalid receipt key or signature.');
  const keyId=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',publicKey)),b=>b.toString(16).padStart(2,'0')).join('');
  if(envelope.key_id!==keyId)fail('Receipt signing key is not trusted by this workspace.');
  const key=await crypto.subtle.importKey('raw',publicKey,{name:'Ed25519'},false,['verify']);
  const prefix=encoder.encode('BTCo publication receipt v1\0'),message=new Uint8Array(prefix.length+payload.length);message.set(prefix);message.set(payload,prefix.length);
  if(!await crypto.subtle.verify('Ed25519',key,signature,message))fail('Publication receipt signature failed.');
  const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
  if(!object(receipt)||receipt.schema!=='btco.publication.v1'||receipt.seller_id!==sellerId)fail('Unexpected publication seller or schema.');
  if(!/^\d{9,15}$/.test(receipt.item_id)||receipt.url!=='https://www.ebay.com/itm/'+receipt.item_id||!/^btco-comic-[a-z0-9-]{1,80}$/.test(receipt.draft_id)||!/^[a-f0-9]{64}$/.test(receipt.revision))fail('Invalid publication identity.');
  if(!bounded(receipt.physical_item_id,100)||!bounded(receipt.listing_sku,100)||!receipt.listing_sku.trim()||!bounded(receipt.title,80)||!receipt.title.trim())fail('Missing publication identity fields.');
  if(!(receipt.master_sku===null||bounded(receipt.master_sku,50)&&receipt.master_sku.trim()))fail('Invalid CDP master SKU.');
  if(typeof receipt.price_usd!=='string'||!/^[1-9]\d{0,6}$/.test(receipt.price_usd)||Number(receipt.price_usd)>1000000||receipt.currency!=='USD')fail('Publication prices must be whole USD dollars.');
  if(typeof receipt.verified_at!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)$/.test(receipt.verified_at)||!Number.isFinite(Date.parse(receipt.verified_at))||Date.parse(receipt.verified_at)>now+300000)fail('Invalid publication verification time.');
  const promotion=receipt.promotion;
  if(!object(promotion)||promotion.requested_percent!==5||!['verified','unsupported'].includes(promotion.status))fail('Missing promotion verification.');
  if(promotion.status==='verified'&&(!/^\d{1,30}$/.test(promotion.campaign_id)||!bounded(promotion.ad_id,100)))fail('Missing verified promotion reference.');
  if(promotion.status==='unsupported'&&!bounded(promotion.reason,1000))fail('Missing promotion eligibility reason.');
  if(receipt.vault_reconciliation!=='pending')fail('Unexpected connector receipt state.');
  return {receipt,envelope:structuredClone(envelope),checksum:await hashText(envelope.payload_b64)};
}

// Physical facts are separate owner input, never inferred from an eBay receipt.
export function validatePhysicalConfirmation(value){
  if(value===undefined)return null;
  if(!object(value)||Object.keys(value).some(k=>!['quantity','location','owner_evidence'].includes(k))||value.quantity!==1||!bounded(value.location,200)||!value.location.trim()||!bounded(value.owner_evidence,2000)||value.owner_evidence.trim().length<10)fail('Confirm one physical copy, its location and owner evidence.');
  return {quantity:1,location:value.location.trim(),owner_evidence:value.owner_evidence.trim()};
}
export const publicationEvents=state=>state.events.filter(e=>e.action==='ebay.publication-reconciled');
export function reconcilePublication(state,verified,{now=new Date().toISOString(),physicalConfirmation}={}){
  validateState(state);if(state.mode!=='work')fail('Only working inventory can receive publication receipts.');
  const {receipt:r,checksum,envelope}=verified;
  const confirmation=validatePhysicalConfirmation(physicalConfirmation);
  const previous=publicationEvents(state);
  const replay=previous.find(e=>e.detail.checksum===checksum);
  if(replay){
    if(confirmation&&JSON.stringify(confirmation)!==JSON.stringify(replay.detail.physicalConfirmation))fail('Physical confirmation differs from the saved receipt; review the existing record.');
    return {next:state,replayed:true,summary:replay.detail.summary};
  }
  if(previous.some(e=>e.detail.receipt.seller_id===r.seller_id&&
    (e.detail.receipt.item_id===r.item_id||e.detail.receipt.draft_id===r.draft_id||e.detail.receipt.physical_item_id===r.physical_item_id)))fail('Publication identity conflicts with prior reconciliation.');
  const next=structuredClone(state),listed=next.items.filter(i=>i.ebayPublication?.itemId===r.item_id||i.channel.trim().toLowerCase()==='ebay'&&i.externalId===r.item_id);
  if(listed.length>1)fail('Duplicate existing listing IDs require review.');
  const physical=next.items.find(i=>i.id===r.physical_item_id||i.ebayPublication?.physicalItemId===r.physical_item_id);
  if(physical&&listed[0]&&physical.id!==listed[0].id)fail('Physical item and listing map to different inventory records.');
  let item=physical??listed[0];
  if(next.items.some(i=>i.id!==item?.id&&skuAliases(i).includes(skuKey(r.listing_sku))))fail('Listing SKU already belongs to another inventory record.');
  const added=!item;
  if(item&&(item.kind!=='comic'||item.gradeCompany||item.grade||item.cert))fail('Review comic classification and raw/graded identity before linking publication.');
  if(!item){
    if(r.master_sku!==null)fail('A CDP publication must reference an existing verified master record.');
    const id=confirmation?r.physical_item_id:'ebay-'+r.item_id;if(next.items.some(i=>i.id===id))fail('Inventory identifier conflict.');
    item=makeItem({id,sku:r.listing_sku,title:r.title,kind:'comic',channel:'eBay',externalId:r.item_id,
      quantity:confirmation?1:0,availability:confirmation?'tracked':'review',status:'listed',verification:confirmation?'verified':'unverified',location:confirmation?.location??'',askCents:Number(r.price_usd)*100,
      source:{system:'ebay-publication-receipt',listingSku:r.listing_sku},
      notes:confirmation?'Owner confirmed this physical copy and storage location. Interior, completeness, page quality and hidden defects remain unverified.':'Verified listing publication. Physical ownership and stock remain unverified; publication does not establish either.'});
    next.items.push(item);
  }
  if(confirmation&&item.location&&item.location!==confirmation.location)fail('Existing physical location differs; use a separate reviewed move.');
  if(confirmation&&!item.location)item.location=confirmation.location;
  const masters=[item.source?.cdpSku,item.cdpLink?.sku].filter(v=>v!==undefined&&v!==null&&v!=='');
  if(item.source?.cdpId&&!masters.length)fail('Resolve the existing CDP master SKU before linking publication.');
  if(masters.some(v=>v!==r.master_sku)||r.master_sku!==null&&(!masters.length||!physical))fail('CDP master SKU or physical record mismatch; identifiers are unchanged.');
  if(item.ebayPublication||item.channel.trim().toLowerCase()==='ebay'&&item.externalId&&item.externalId!==r.item_id)fail('Existing listing link requires explicit relisting review.');
  const priceCents=Number(r.price_usd)*100,asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.verified_at));
  const price=listingPrice(item,'ebay');
  const pricePreserved=price.source==='Manually recorded in Vault'||price.asOf>asOf||Date.parse(item.ebaySnapshot?.observedAt??'')>Date.parse(r.verified_at);
  if(!pricePreserved)item.listingPrices={...item.listingPrices,ebay:{priceCents,asOf,source:'Verified eBay publication receipt'}};
  item.ebayPublication={itemId:r.item_id,url:r.url,listingSku:r.listing_sku,physicalItemId:r.physical_item_id,draftId:r.draft_id,revision:r.revision,verifiedAt:r.verified_at,checksum};
  const summary={itemId:item.id,ebayItemId:r.item_id,url:r.url,added,pricePreserved,physicalStockChanged:added&&!!confirmation,masterSkuChanged:false,physicalItemId:r.physical_item_id,listingSku:r.listing_sku,quantity:item.quantity,location:item.location};
  next.events.push({id:'ebay-pub-'+checksum,at:now,action:'ebay.publication-reconciled',entityId:item.id,detail:{checksum,receipt:r,envelope,summary,...(confirmation?{physicalConfirmation:confirmation}:{})}});
  return {next:validateState(next),replayed:false,summary};
}
