import {checkedRaw,normalizeLocation,locationStatus,reconcileEbayLinks} from './inventory-locations.mjs';
import {reconcileFulfillment,fulfillmentReport} from './fulfillment.mjs';
import {createHash} from 'node:crypto';
import {validateListingPages} from '../web/domain/ebay-api-refresh.mjs';
import {remaining,listingPrice,cents} from '../web/domain/core.mjs';
const fail=m=>{const e=Error(m);e.status=400;throw e;};
const text=(v,max=4000)=>typeof v==='string'&&v.length<=max;
const stamp=v=>text(v,40)&&Number.isFinite(Date.parse(v));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const SELLER={seller:'ballardtradingco',sellerId:'3uxyv64dtp6'};
export const pacificDate=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export function validateOrderPages(pages,{startDate,endDate,now=Date.now()}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||!Number.isFinite(Date.parse(startDate))||!Number.isFinite(Date.parse(endDate))||endDate<startDate||Date.parse(endDate)-Date.parse(startDate)>89*86400000)fail('Use an order window of at most 90 days.');
 if(!Array.isArray(pages)||!pages.length||pages.length>100)fail('Complete order pages are required.');
 const total=pages[0].total_matching,ids=new Set(),records=[];let offset=0;const times=[];
 if(!Number.isSafeInteger(total)||total<0||total>20000)fail('Unsupported order total.');
 for(const [index,p] of pages.entries()){
  const last=index===pages.length-1;
  if(p.date_timezone!=='America/Los_Angeles'||p.offset!==offset||p.total_matching!==total||!Array.isArray(p.records)||p.returned!==p.records.length||p.has_more!==!last||p.next_offset!==(last?null:offset+p.returned)||(!last&&!p.returned)||p.warnings?.length)fail('Incomplete or changing order feed.');
  if(!stamp(p.retrieved_at_utc)||Date.parse(p.retrieved_at_utc)>now+300000||Date.parse(p.retrieved_at_utc)<now-86400000)fail('Order observations are stale or future dated.');times.push(Date.parse(p.retrieved_at_utc));
  for(const r of p.records){
   if(!text(r.orderId,100)||!r.orderId||ids.has(r.orderId)||!stamp(r.creationDate)||!stamp(r.lastModifiedDate)||!Array.isArray(r.line_items)||r.line_items.length>500)fail('Invalid or duplicate order.');
   const day=pacificDate(Date.parse(r.creationDate));if(day<startDate||day>endDate)fail('Order is outside the requested window.');
   const lineIds=new Set();const lines=r.line_items.map(l=>{
    if(!text(l.lineItemId,100)||!l.lineItemId||lineIds.has(l.lineItemId)||!text(l.legacyItemId??'',100)||!text(l.sku??'')||!text(l.title)||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>1000000)fail('Invalid order line.');lineIds.add(l.lineItemId);
    return {id:l.lineItemId,itemId:l.legacyItemId??'',sku:l.sku??'',title:l.title,quantity:l.quantity};
   });
   for(const v of [r.orderPaymentStatus,r.orderFulfillmentStatus,r.cancelStatus?.cancelState??'UNKNOWN'])if(!text(v,100))fail('Invalid order status.');
   ids.add(r.orderId);records.push({id:r.orderId,createdAt:r.creationDate,modifiedAt:r.lastModifiedDate,payment:r.orderPaymentStatus,fulfillment:r.orderFulfillmentStatus,cancellation:r.cancelStatus?.cancelState??'UNKNOWN',lines});
  }offset+=p.returned;
 }
 if(offset!==total||Math.max(...times)-Math.min(...times)>1800000)fail('Incomplete order collection.');
 return {records,startDate,endDate,observedAt:new Date(Math.min(...times)).toISOString()};
}
export async function ebaySnapshot(input,{now=Date.now()}={}){
 const listing=await validateListingPages(input.listingPages,{...SELLER,now});
 const orders=validateOrderPages(input.orderPages,{startDate:input.startDate,endDate:input.endDate,now});
 if(Math.abs(Date.parse(listing.observedAt)-Date.parse(orders.observedAt))>1800000)fail('Collect listings and orders together.');
 return {source:'ebay',observedAt:listing.observedAt,finishedAt:listing.finishedAt,seller:SELLER.seller,atomic:false,pageCount:listing.pageCount,records:listing.records.map(r=>({id:r.itemId,sku:r.sku,title:r.title,priceCents:r.priceCents,quantity:r.quantity,status:'active',variationReview:r.variationReview})),orders};
}
export async function collectEbay(client,now=Date.now()){
 const identity=await client.call('get_connection_status',{});
 if(identity.seller!==SELLER.seller||identity.seller_id!==SELLER.sellerId)fail('This workspace is for ballardtradingco.');
 const listingPages=[];let next=1;
 while(next!==null){if(Date.now()-now>8*60000)fail('Collection exceeded eight minutes; retry.');if(next!==listingPages.length+1||next>100)fail('Invalid listing pagination.');const p=await client.call('get_active_listings',{page:next});listingPages.push(p);if(p.total_matching!==listingPages[0].total_matching)fail('Listings changed during collection; retry.');next=p.next_page;}
 const endDate=pacificDate(now),startDate=pacificDate(now-29*86400000),orderPages=[];next=0;
 while(next!==null){if(Date.now()-now>8*60000)fail('Collection exceeded eight minutes; retry.');if(orderPages.length>=100)fail('Too many order pages.');const p=await client.call('get_orders',{start_date:startDate,end_date:endDate,status:'all',limit:200,offset:next});if(p.offset!==next||(p.next_offset!==null&&p.next_offset<=next))fail('Invalid order pagination.');orderPages.push(p);next=p.next_offset;}
 return ebaySnapshot({listingPages,orderPages,startDate,endDate},{now:Date.now()});
}
export function exportSnapshot(input,{now=Date.now()}={}){
 if(!['cdp','collx'].includes(input.source)||!stamp(input.observedAt)||Date.parse(input.observedAt)>now+300000||!Array.isArray(input.records)||input.records.length>20000)fail('Invalid dated export.');
 const ids=new Set();const records=input.records.map(r=>{
  if(!text(r.id,200)||!r.id.trim()||ids.has(r.id)||!text(r.sku,4000)||!text(r.title,4000)||![null,undefined].includes(r.priceCents)&&(!Number.isSafeInteger(r.priceCents)||r.priceCents<0||r.priceCents>99999999999)||r.quantity!==null&&(!Number.isSafeInteger(r.quantity)||r.quantity<0||r.quantity>1000000)||!text(r.status,100)||!text(r.ebayId??'',100)||!text(r.collxId??'',200))fail('Invalid or duplicate export row.');
  ids.add(r.id);return {id:r.id,sku:r.sku,title:r.title,priceCents:r.priceCents??null,quantity:r.quantity,status:r.status||'unknown',ebayId:r.ebayId??'',collxId:r.collxId??'',...(r.raw?{raw:checkedRaw(r.raw),physicalLocation:normalizeLocation(r.raw,input.source)}:{})};
 });return {source:input.source,observedAt:input.observedAt,records,atomic:false,provenance:'owner-export'};
}
export function applySnapshot(state,snapshot){
 const m=state.marketplaceMirror??{sources:{},history:[],runs:[],droppedChanges:0};const prior=m.sources[snapshot.source];
 const fingerprint=hash(snapshot);if(prior?.fingerprint===fingerprint)return {replayed:true,records:prior.records.length};
 if(prior&&Date.parse(prior.observedAt)>=Date.parse(snapshot.observedAt))fail('This observation is not newer than the saved source.');
 const before=new Map((prior?.records??[]).map(r=>[r.id,r])),seen=new Set(),changes=[];
 const fields=['sku','title','priceCents','quantity','status','variationReview','ebayId','collxId'];
 const records=snapshot.records.map(r=>{seen.add(r.id);const old=before.get(r.id),changed=old?fields.filter(f=>(old[f]??null)!==(r[f]??null)):[];if(old?.notSeenSince)changed.push('reappeared');if(old&&changed.length)changes.push({source:snapshot.source,id:r.id,at:snapshot.observedAt,fields:changed,before:Object.fromEntries(changed.map(f=>[f,old[f]??null])),after:Object.fromEntries(changed.map(f=>[f,r[f]??null]))});if(prior&&!old)changes.push({source:snapshot.source,id:r.id,at:snapshot.observedAt,fields:['new'],before:null,after:null});return {...r,...(locationStatus(r.physicalLocation)==='missing'&&old?.physicalLocation?{physicalLocation:old.physicalLocation,raw:old.raw}:{})};});
 for(const r of before.values())if(!seen.has(r.id)){records.push({...r,notSeenSince:r.notSeenSince??snapshot.observedAt});if(!r.notSeenSince)changes.push({source:snapshot.source,id:r.id,at:snapshot.observedAt,fields:['not_seen'],before:null,after:null});}
 if(records.length>25000)fail('Mirror limit reached; export the history before continuing.');
 // Observations remain separate; confirmed linked orders are allocated by the fulfillment ledger below.
 const next=structuredClone(m);next.sources[snapshot.source]={...snapshot,records,fingerprint};
 if(snapshot.source==='ebay'&&prior?.orders){const orders=new Map(prior.orders.records.map(o=>[o.id,o]));for(const o of snapshot.orders.records){const old=orders.get(o.id);if(!old||Date.parse(o.modifiedAt)>=Date.parse(old.modifiedAt)){if(!old)changes.push({source:'ebay-order',id:o.id,at:snapshot.observedAt,fields:['new_order'],before:null,after:{payment:o.payment,fulfillment:o.fulfillment,cancellation:o.cancellation}});if(old&&hash(old)!==hash(o))changes.push({source:'ebay-order',id:o.id,at:snapshot.observedAt,fields:['order_changed'],before:{payment:old.payment,fulfillment:old.fulfillment,cancellation:old.cancellation},after:{payment:o.payment,fulfillment:o.fulfillment,cancellation:o.cancellation}});orders.set(o.id,o);}}if(orders.size>20000)fail('Order mirror limit reached.');next.sources.ebay.orders={...snapshot.orders,records:[...orders.values()]};}
 next.history.push(...changes);next.droppedChanges+=Math.max(0,next.history.length-5000);next.history=next.history.slice(-5000);
 next.runs=[...next.runs,{source:snapshot.source,at:snapshot.observedAt,records:snapshot.records.length,changes:changes.length,fingerprint}].slice(-2000);state.marketplaceMirror=next;
 reconcileEbayLinks(state);
 reconcileFulfillment(state);
 return {records:snapshot.records.length,changes:changes.length,replayed:false};
}
export function validateMirror(state){
 const m=state.marketplaceMirror;if(m===undefined)return;
 if(!m||!m.sources||!Array.isArray(m.history)||m.history.length>5000||!Array.isArray(m.runs)||m.runs.length>2000||!Number.isSafeInteger(m.droppedChanges)||m.droppedChanges<0)fail('Invalid marketplace mirror.');
 for(const [source,s] of Object.entries(m.sources)){
  if(!['ebay','collx','cdp'].includes(source)||s.source!==source||!stamp(s.observedAt)||!Array.isArray(s.records)||s.records.length>25000||!/^[a-f0-9]{64}$/.test(s.fingerprint))fail('Invalid marketplace source.');
  const ids=new Set();for(const r of s.records){if(!text(r.id,200)||!r.id||ids.has(r.id)||!text(r.sku)||!text(r.title)||!text(r.status,100)||(r.priceCents!==null&&(!Number.isSafeInteger(r.priceCents)||r.priceCents<0))||(r.quantity!==null&&(!Number.isSafeInteger(r.quantity)||r.quantity<0))||(r.notSeenSince&&!stamp(r.notSeenSince)))fail('Invalid mirror record.');ids.add(r.id);}
 }
}
export function mirrorReport(state,now=Date.now()){
 const m=state.marketplaceMirror??{sources:{},history:[],runs:[]};
 const by=(rows,key)=>{const map=new Map();for(const r of rows){const id=key(r);if(id){if(!map.has(id))map.set(id,[]);map.get(id).push(r);}}return map;};
 const items=by(state.inventory.items,i=>i.ebayPublication?.itemId??(i.channel?.toLowerCase()==='ebay'?i.externalId:null));
 const cdp=by(m.sources.cdp?.records??[],r=>r.ebayId),collx=by(m.sources.collx?.records??[],r=>r.id);
 const rows=(m.sources.ebay?.records??[]).map(r=>{
  const matches=items.get(r.id)??[],i=matches.length===1?matches[0]:null,refs=cdp.get(r.id)??[],c=refs.length===1?refs[0]:null,cxs=c?.collxId?collx.get(c.collxId)??[]:[],cx=cxs.length===1?cxs[0]:null;
  const issues=[];if(r.notSeenSince)issues.push('Not seen in latest feed — status unresolved');if(r.variationReview)issues.push('Variation mapping required');if(!i)issues.push(matches.length?'Multiple Core records match':'No verified Core listing link');if(!c)issues.push(refs.length?'Multiple CDP records match':'No CDP listing link');if(c&&(c.priceCents===null||c.quantity===null))issues.push('CDP price or quantity unknown');if(cx&&(cx.priceCents===null||cx.quantity===null))issues.push('CollX price or quantity unknown');if(i&&listingPrice(i,'ebay').priceCents===null)issues.push('Core eBay price unknown');if(c?.notSeenSince)issues.push('CDP record not seen in latest export');if(c&&!['active','listed'].includes(c.status.toLowerCase()))issues.push('CDP status differs or needs review');if(cx&&!['active','listed'].includes(cx.status.toLowerCase()))issues.push('CollX status differs or needs review');if(c&&c.priceCents!==null&&c.priceCents!==r.priceCents)issues.push('CDP / eBay price differs');if(c&&c.quantity!==null&&c.quantity!==r.quantity)issues.push('CDP / eBay quantity differs');if(i&&listingPrice(i,'ebay').priceCents!==null&&listingPrice(i,'ebay').priceCents!==r.priceCents)issues.push('Core / eBay price differs');if(i&&remaining(state.inventory,i)!==r.quantity)issues.push('Core / eBay quantity differs');if(!c?.collxId)issues.push('No verified CollX listing link');if(c?.collxId&&!cx)issues.push('CollX listing link unresolved');if(cx?.notSeenSince)issues.push('CollX record not seen in latest export');
  return {...r,core:i?{id:i.id,sku:i.sku,priceCents:listingPrice(i,'ebay').priceCents,quantity:remaining(state.inventory,i),location:i.location}:null,cdp:c??null,collx:cx??null,issues};
 });
 const orders=fulfillmentReport(state);
 return {sources:Object.fromEntries(Object.entries(m.sources).map(([k,s])=>[k,{observedAt:s.observedAt,records:s.records.filter(r=>!r.notSeenSince).length,stale:now-Date.parse(s.observedAt)>86400000,provenance:s.provenance??'eBay API',orderWindow:s.orders?{startDate:s.orders.startDate,endDate:s.orders.endDate}:null}])),rows,orders,history:m.history.slice(-100).reverse(),runs:m.runs.slice(-50).reverse(),droppedChanges:m.droppedChanges??0,summary:{listings:rows.filter(r=>!r.notSeenSince).length,attention:rows.filter(r=>r.issues.length).length,orders:orders.length,unresolvedOrders:orders.filter(o=>o.fulfillment!=='FULFILLED'||o.payment!=='PAID'||o.cancellation!=='NONE_REQUESTED').length},capabilities:{marketplaceWrites:false,collxApi:false,automaticDelisting:false}};
}
