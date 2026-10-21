// Structural evidence checks are not independent verification of a sale.
const strings=['subject','year','setName','number','parallel','gradeCompany','grade'];
export const soldComparisonSchema={type:'object',additionalProperties:false,properties:{url:{type:'string'},title:{type:'string'},soldDate:{type:'string'},priceCents:{type:'integer'},shippingCents:{type:['integer','null']},currency:{type:'string',enum:['USD']},saleType:{type:'string',enum:['completed_sale']},priceVisibility:{type:'string',enum:['actual','hidden_offer','unknown']},identity:{type:'object',additionalProperties:false,properties:{...Object.fromEntries(strings.map(k=>[k,{type:'string'}])),autograph:{type:'boolean'},printRun:{type:['integer','null']}},required:[...strings,'autograph','printRun']}},required:['url','title','soldDate','priceCents','shippingCents','currency','saleType','priceVisibility','identity']};
const normalize=x=>String(x??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ').replace(/^#/,'');
const printRun=d=>{const m=String(d.serial??'').match(/\/\s*(\d+)\s*$/);return m?Number(m[1]):null;};
export function checkSoldComparisons(assessment,sourceURLs,now=Date.now()){
 const accepted=[],rejected=[],seen=new Set(),allowed=new Set(sourceURLs),items=assessment.soldComparisons??[];
 if(!Array.isArray(items)||items.length>10)return {accepted,rejected:['Sold comparison data is invalid.']};
 for(const c of items){
  let reason='';const same=c?.identity&&strings.every(k=>normalize(c.identity[k])===normalize(assessment[k]))&&c.identity.autograph===assessment.autograph&&c.identity.printRun===printRun(assessment);
  const day=typeof c?.soldDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(c.soldDate)?Date.parse(c.soldDate+'T00:00:00Z'):NaN;
  if(!c||!allowed.has(c.url)||!/^https:\/\//.test(c.url??''))reason='Source was not returned by research.';
  else if(assessment.confidence!=='high'||!['subject','year','setName','number'].every(k=>String(assessment[k]??'').trim())||!same)reason='Card identity, parallel, print run or grade does not match.';
  else if(c.saleType!=='completed_sale'||c.priceVisibility!=='actual')reason='A completed sale with a visible actual price is required.';
  else if(c.currency!=='USD'||!Number.isSafeInteger(c.priceCents)||c.priceCents<1||c.priceCents>100000000||!(c.shippingCents===null||Number.isSafeInteger(c.shippingCents)&&c.shippingCents>=0&&c.shippingCents<=10000000))reason='Sale amount, shipping or currency is invalid.';
  else if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==c.soldDate||day>now||now-day>180*86400000)reason='Sale date must be valid and within the last 180 days.';
  else if(seen.has(c.url))reason='Duplicate sale source.';
  if(reason){rejected.push(reason);continue;}
  seen.add(c.url);accepted.push({url:c.url,title:String(c.title??'Sale reference').slice(0,300),soldDate:c.soldDate,priceCents:c.priceCents,shippingCents:c.shippingCents,currency:'USD',identity:{...c.identity},verification:'needs_owner_check'});
 }
 return {accepted,rejected};
}
