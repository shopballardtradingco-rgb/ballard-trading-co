import {roundAskingCents} from './pricing.mjs';
const identity=['subject','year','setName','number','parallel','serial','gradeCompany','grade','autograph','memorabilia'];
export const priceContent=d=>JSON.stringify([roundAskingCents(d.askCents),...identity.map(k=>[k,d[k]??null])]);
export const confirmPrice=d=>({content:priceContent(d),at:new Date().toISOString(),source:'owner'});
export const priceNeedsReview=d=>d.kind==='card'&&Boolean(d.preparation)&&Number.isSafeInteger(d.askCents)&&roundAskingCents(d.askCents)>0&&d.priceReview?.content!==priceContent(d);
