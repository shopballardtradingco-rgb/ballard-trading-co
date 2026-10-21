import {shippingRoute} from './listing-controls.mjs';
// Shared UI/server checks for the existing BTConnect policy contract.
export function eligibleCampaign(c){
 const s=c?.fundingStrategy??{},criterion=c?.campaignCriterion;
 if(!/^\d{1,30}$/.test(c?.campaignId??'')||c.marketplaceId!=='EBAY_US'||c.campaignStatus!=='RUNNING'||s.fundingModel!=='COST_PER_SALE'||(s.adRateStrategy??'FIXED')!=='FIXED'||Number(s.bidPercentage)!==5||s.dynamicAdRatePreferences||c.budget||JSON.stringify(c.channels??['ON_SITE'])!==JSON.stringify(['ON_SITE']))return false;
 return !criterion||(criterion.autoSelectFutureInventory===true&&criterion.criterionType==='INVENTORY_PARTITION'&&JSON.stringify(criterion.selectionRules)===JSON.stringify([{categoryScope:'MARKETPLACE'}]));
}
export function campaignChoices(p){return (p?.promotion_campaigns?.campaigns??[]).map(row=>row.campaign??row).filter(eligibleCampaign).map(c=>({...c,name:c.campaignName+' · 5%'+(c.campaignCriterion?' · existing automatic campaign':'')}));}
export const shippingGroup=shippingRoute;
export const shippingGroupLabel={raw:'Raw cards $20 and under',high:'Raw cards over $20',graded:'Graded cards',parcel:'Parcel shipping override',lot:'Card lots — measured parcel required',review:'Shipping cost review required'};
export function conditionValue(values,label){
 const normalized=String(label??'').toLowerCase().trim(),aliases={nm:'near mint or better','near mint':'near mint or better',ex:'excellent',vg:'very good'};
 return values.find(v=>v.conditionDescriptorValueName?.toLowerCase()===(aliases[normalized]??normalized));
}
export const isEnvelope=p=>(p?.shippingOptions??[]).some(o=>(o.shippingServices??[]).some(s=>(s.shippingServiceCode??'').toLowerCase().replaceAll('_','').includes('ebaystandardenvelope')));
export const isCalculated=p=>(p?.shippingOptions??[]).some(o=>o.costType==='CALCULATED');
export const shippingChoices=(policies,key)=>(policies?.fulfillment_policy?.fulfillmentPolicies??[]).filter(p=>key==='raw'||!isEnvelope(p));
export function paymentPolicy(policies,savedId){
 const rows=(policies?.payment_policy?.paymentPolicies??[]).filter(p=>/^\d{1,30}$/.test(String(p.paymentPolicyId??'')));
 const unique=[...new Map(rows.map(p=>[String(p.paymentPolicyId),p])).values()];
 const saved=unique.find(p=>String(p.paymentPolicyId)===String(savedId??''));
 if(saved)return saved;
 if(unique.length===1)return unique[0];
 // eBay can return two Managed Payments policies for the same method.
 // Core's combined-shipping card workflow uses the non-immediate policy.
 // Resolve that explicit distinction; never choose based on API row order.
 const managed=unique.filter(p=>p.marketplaceId==='EBAY_US'&&p.categoryTypes?.some(c=>c.name==='ALL_EXCLUDING_MOTORS_VEHICLES')&&Array.isArray(p.paymentMethods)&&p.paymentMethods.length===0&&typeof p.immediatePay==='boolean');
 const combined=managed.filter(p=>p.immediatePay===false);
 return managed.length===unique.length&&combined.length===1?combined[0]:null;
}
export function inventoryLocation(policies,savedKey){
 const rows=(policies?.locations?.locations??[]).filter(l=>l.merchantLocationStatus==='ENABLED');
 const saved=rows.find(l=>l.merchantLocationKey===savedKey);if(saved)return saved;
 if(rows.length===1)return rows[0];
 const named=rows.filter(l=>l.name?.trim());
 return named.length===1?named[0]:null;
}
export function checkSelections(input){
 if(!/^\d{1,30}$/.test(input.paymentPolicyId??''))throw Error('Core could not load your eBay payment policy. Reload shipping settings to retry.');
 for(const [key,label] of [['returnPolicyId','a return policy'],['campaignId','an existing 5% promotion campaign']])if(!/^\d{1,30}$/.test(input[key]??''))throw Error('Choose '+label+' before continuing.');
 if(typeof input.locationKey!=='string'||!input.locationKey.trim()||input.locationKey==='undefined')throw Error('Choose your eBay inventory location before continuing.');
 if(input.combinedShipping!==true)throw Error('Confirm buyer-paid and combined shipping before continuing.');
}
export function checkedParcel(policy,input,key){
 if(isEnvelope(policy)&&key!=='raw')throw Error(shippingGroupLabel[key]+': choose a parcel policy without eBay Standard Envelope.');
 if(!isCalculated(policy)&&!['lot','review'].includes(key))return null;
 const parcel={};
 for(const [field,label] of [['weight_oz','weight (oz)'],['length_in','length (in)'],['width_in','width (in)'],['height_in','thickness (in)']]){
  const value=String(input?.[field]??'').trim(),max=field==='weight_oz'?1120:120;
  if(!/^\d+(\.\d{1,3})?$/.test(value)||Number(value)<=0||Number(value)>max)throw Error(shippingGroupLabel[key]+': enter the measured packed '+label+'.');
  parcel[field]=value;
 }
 if(input?.verified!==true)throw Error(shippingGroupLabel[key]+': confirm these are actual packed measurements for every card in this group.');
 if(isEnvelope(policy)){
  const length=Math.max(Number(parcel.length_in),Number(parcel.width_in)),width=Math.min(Number(parcel.length_in),Number(parcel.width_in));
  if(Number(parcel.weight_oz)>3||length<5||length>11.5||width<3.5||width>6.125||Number(parcel.height_in)>=0.25)throw Error('eBay Standard Envelope needs a packed envelope no heavier than 3 oz, 5–11.5 inches long, 3.5–6.125 inches wide and less than 0.25 inches thick. Choose a parcel policy if it does not fit.');
  if(input.envelopeConfirmed!==true)throw Error('Confirm the envelope is flexible, uniformly thick and meets eBay Standard Envelope requirements.');
 }
 return {...parcel,verified:true,basis:'measured',evidence:'Owner confirmed actual packed weight and dimensions apply to every card in this shipping group in BTCore.'+(isEnvelope(policy)?' Owner also confirmed a flexible, uniformly thick, eligible paper/card envelope.':'')};
}

export function checkedShippingCost(input,key){
 if(!['lot','review'].includes(key))return null;
 if(input?.confirmed!==true||!Number.isSafeInteger(input?.estimatedLabelCents)||input.estimatedLabelCents<1)throw Error(shippingGroupLabel[key]+': enter a current packed-shipment cost estimate and confirm the buyer charge covers shipping and packaging.');
 return {estimatedLabelCents:input.estimatedLabelCents,confirmed:true,basis:'owner-reviewed estimate, not a purchased label'};
}
