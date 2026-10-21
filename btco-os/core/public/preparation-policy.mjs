import {priceNeedsReview} from './price-review.mjs';
import {missingPhotos} from './photo-policy.mjs';
import {roundAskingCents} from './pricing.mjs';
export const listingFields=['title','kind','location','subject','year','setName','number','parallel','serial','gradeCompany','grade','cert','autograph','memorabilia','askCents','costCents','acquiredDate','description','conditionNotes','photoPolicy','cardClass','singlePhotoMaxCents','team','sport','condition','rookie'];
export const listingContent=d=>JSON.stringify({sku:d.sku,fields:[...listingFields.map(k=>[k,d[k]??null]),...['shippingMode'].filter(k=>Object.hasOwn(d,k)).map(k=>[k,d[k]])],photos:d.photos.map(p=>[p.id,p.role,p.sha256])});
export function listingProblems(d){
 const problems=[];d={...d,askCents:roundAskingCents(d.askCents)};
 if(d.kind!=='card')problems.push('Trading cards only');
 if(d.status==='archived')problems.push('Archived');
 if(!d.title?.trim()||!d.subject?.trim()||!d.setName?.trim())problems.push('Identity incomplete');
 if(!d.location?.trim())problems.push('Storage location needed');
 const priceNeeded=!Number.isSafeInteger(d.askCents)||d.askCents<1;
 if(priceNeeded)problems.push('Price needed');
 else if(priceNeedsReview(d))problems.push('Confirm asking price');
 if(!d.condition?.trim())problems.push('Listing condition needed');
 if(!d.conditionNotes?.trim())problems.push('Visible condition notes needed');
 if(!d.description?.trim())problems.push('Listing description needed');
 const missing=missingPhotos(d);
 if(missing.length)problems.push('Add '+missing.join(' and ')+' photo');
 if(d.preparation?.status==='running'||d.preparation?.status==='queued')problems.push('Preparation in progress');
 return problems;
}

