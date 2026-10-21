import {fail} from './domain.mjs';
import {isListingApproved} from './preparation.mjs';
import {roundAskingCents} from './public/pricing.mjs';
export const CDP_HEADERS=['SKU','Player','Team','Set','Year','Number','Sport','Condition','Graded','Grader','Grade','Quantity','Start Price','Purchase Price','Purchase Date','Cabinet','Shelf','Box','Row','Section','Serial Number','Restockable','Title','Description','Rookie','Autograph','Memorabilia','Front Image URL','Back Image URL'];
const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
const amount=c=>c===null||c===undefined?'':(c/100).toFixed(2);
export function cdpCSV(drafts,origin){
 if(!drafts.length)fail('Approve cards for CDP before exporting.');
 if(drafts.some(d=>!isListingApproved(d)))fail('Review all selected cards before exporting.',409);
 const rows=drafts.map(d=>{
  const url=role=>{const p=d.photos.find(p=>p.role===role);return p?`${origin}/media/cdp/${p.id}/${d.listingReview.photoToken}.jpg`:'';};
  // Only explicitly structured locations are split; arbitrary location strings stay intact.
  const loc=d.location.match(/^\s*(B\d+)\s*,\s*section\s+(.+?)\s*$/i);
  return [d.sku,d.subject,d.team,d.setName,d.year,d.number,d.sport,d.condition,d.gradeCompany?'TRUE':'FALSE',d.gradeCompany,d.grade,1,amount(roundAskingCents(d.askCents)),amount(d.costCents),d.acquiredDate,'','',loc?loc[1]:d.location,'',loc?loc[2]:'',d.serial,'FALSE',d.title,[d.description,d.conditionNotes].filter(Boolean).join('\n\n'),d.rookie?'TRUE':'FALSE',d.autograph?'TRUE':'FALSE',d.memorabilia?'TRUE':'FALSE',url('front'),url('back')];
 });return '\uFEFF'+[CDP_HEADERS,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
