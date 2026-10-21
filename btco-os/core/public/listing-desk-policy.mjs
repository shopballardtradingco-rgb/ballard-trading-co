import {listingProblems} from './preparation-policy.mjs';
import {conditionChoices} from './listing-controls.mjs';
import {priceNeedsReview} from './price-review.mjs';
export function deskFixFields(d){
 const fields=[];
 if(!d.title?.trim()||d.title.length>80)fields.push('title');
 for(const key of ['subject','setName','location','conditionNotes','description'])if(!d[key]?.trim())fields.push(key);
 if(d.kind==='card'&&(!/^\d{4}$/.test(String(d.year))||Number(d.year)<1800||Number(d.year)>2100))fields.push('year');
 if(!Number.isSafeInteger(d.askCents)||d.askCents<1||priceNeedsReview(d))fields.push('askCents');
 if(!conditionChoices(d).value)fields.push('condition');
 return fields;
}
export function deskIssues(d){
 const issues=listingProblems(d);
 if(d.kind==='card'&&!conditionChoices(d).value)issues.push('Choose eBay condition');
 if(d.title?.length>80)issues.push('Shorten title to 80 characters');
 if(d.kind==='card'&&(!/^\d{4}$/.test(String(d.year))||Number(d.year)<1800||Number(d.year)>2100))issues.push('Card year needed');
 return [...new Set(issues)];
}
export const sameSelection=(batch,ids)=>Boolean(batch&&batch.entries.length===ids.size&&batch.entries.every(e=>ids.has(e.draftId)));
