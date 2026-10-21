import {createHash} from 'node:crypto';
import {remaining} from '../web/domain/core.mjs';
import {resolveInventory} from './inventory-locations.mjs';
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status});};
const key=(channel,order,line)=>createHash('sha256').update(JSON.stringify([channel,order,line])).digest('hex');
function checkedOrder(order){
 if(!order||!['ebay','collx','hipcomic','mercari'].includes(order.channel)||typeof order.id!=='string'||!order.id||order.id.length>200||!Number.isFinite(Date.parse(order.createdAt))||!Array.isArray(order.lines)||!order.lines.length||order.lines.length>500)fail('A marketplace order ID, date and line items are required.');
 for(const k of ['reportedSaleCents','reportedProceedsCents'])if(order[k]!==undefined&&order[k]!==null&&(!Number.isSafeInteger(order[k])||order[k]<0))fail('Invalid reported sale amount.');
 for(const k of ['payment','cancellation','fulfillment'])if(typeof order[k]!=='string'||order[k].length>100)fail('Order status is required.');
 const ids=new Set();for(const l of order.lines){if(typeof l.id!=='string'||!l.id||l.id.length>200||ids.has(l.id)||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>1000000||typeof l.itemId!=='string'||l.itemId.length>200||typeof l.sku!=='string'||l.sku.length>4000||typeof l.title!=='string'||l.title.length>4000)fail('Invalid or duplicate order line.');ids.add(l.id);}
 return order;
}
function lineMatch(state,order,line){
 const results=[];
 if(line.itemId)results.push(resolveInventory(state,{channel:order.channel,kind:'id',value:line.itemId}));
 if(line.sku)results.push(resolveInventory(state,{channel:order.channel,kind:'sku',value:line.sku}));
 if(results.some(r=>r.status==='ambiguous'))return {status:'ambiguous',matches:results.flatMap(r=>r.matches)};
 const matches=[...new Map(results.flatMap(r=>r.matches).map(r=>[r.itemId,r])).values()];
 return {status:matches.length===1?'matched':matches.length?'conflicting_identifiers':'unmatched',matches};
}
function allOrders(state){return [...(state.marketplaceMirror?.sources.ebay?.orders?.records??[]).map(o=>({...o,channel:'ebay'})),...(state.confirmedMarketplaceOrders??[])];}
export function fulfillmentReport(state){
 return allOrders(state).map(order=>({...order,lines:order.lines.map(line=>{
  const id=key(order.channel,order.id,line.id),allocation=(state.inventory.marketplaceAllocations??[]).find(a=>a.id===id),match=lineMatch(state,order,line),item=match.status==='matched'?match.matches[0]:null;
  const stored=state.inventory.items.find(i=>i.id===item?.itemId);let blocker=null;
  if(!item)blocker=match.status;
  else if(order.payment!=='PAID'||order.cancellation!=='NONE_REQUESTED')blocker='payment_or_cancellation_review';
  else if(allocation&&(allocation.itemId!==item.itemId||allocation.quantity!==line.quantity))blocker='changed_order_line_review';
  else if(state.inventory.sales.some(s=>!s.voidedAt&&s.itemId===item.itemId&&s.channel.toLowerCase()===order.channel&&s.reference===order.id))blocker='existing_financial_sale_review';
  else if(!allocation){
   const after=stored.orderSyncAfter??state.drafts.find(d=>d.itemId===stored.id)?.receivedAt;
   if(!order.ownerConfirmed&&(!after||Date.parse(order.createdAt)<=Date.parse(after)))blocker='historical_order_requires_reconciliation';
   else if(remaining(state.inventory,stored)<line.quantity)blocker='insufficient_or_unverified_stock';
  }
  const otherChannels=item?[...new Set(item.identifiers.filter(r=>r.channel!==order.channel&&r.channel!=='cdp').map(r=>r.channel))]:[];
  return {...line,core:item,stockApplied:Boolean(allocation),blocker,closureRequired:otherChannels,closureMessage:otherChannels.length?'End or adjust other marketplace listings manually; automatic delisting is not connected.':null};
 })}));
}
export function reconcileFulfillment(state){
 let changed=0;
 for(const order of fulfillmentReport(state))for(const line of order.lines){
  if(line.stockApplied||!line.core||line.blocker)continue;
  const item=state.inventory.items.find(i=>i.id===line.core.itemId);
  if(remaining(state.inventory,item)<line.quantity)continue;
  const id=key(order.channel,order.id,line.id);
  (state.inventory.marketplaceAllocations??=[]).push({id,itemId:item.id,channel:order.channel,orderId:order.id,lineId:line.id,quantity:line.quantity,createdAt:order.createdAt,allocatedAt:new Date().toISOString()});changed++;
 }
 return {allocated:changed};
}
export function recordMarketplaceOrder(state,input){
 if(input?.checked!==true)fail('Confirm the sale in the marketplace before recording it.');
 const order=checkedOrder(input.order);const clean={channel:order.channel,id:order.id,referenceSource:order.referenceSource==='owner-sale-reference'?'owner-sale-reference':'marketplace-order-id',datePrecision:order.datePrecision==='date'?'date':'timestamp',reportedSaleCents:order.reportedSaleCents??null,reportedProceedsCents:order.reportedProceedsCents??null,createdAt:order.createdAt,payment:order.payment,cancellation:order.cancellation,fulfillment:order.fulfillment,lines:order.lines.map(l=>({id:l.id,itemId:l.itemId,sku:l.sku,title:l.title,quantity:l.quantity})),ownerConfirmed:true};
 const prior=(state.confirmedMarketplaceOrders??[]).find(o=>o.channel===clean.channel&&o.id===clean.id);
 if(prior){if(JSON.stringify(prior)!==JSON.stringify(clean))fail('This order is already recorded with different details; reconcile before changing it.',409);return {replayed:true};}
 if(clean.channel==='ebay')fail('Use the connected eBay order feed; manual imports are for unconnected marketplaces.');
 (state.confirmedMarketplaceOrders??=[]).push(clean);return reconcileFulfillment(state);
}
export function validateFulfillment(state){
 if(state.confirmedMarketplaceOrders!==undefined){if(!Array.isArray(state.confirmedMarketplaceOrders)||state.confirmedMarketplaceOrders.length>20000)fail('Invalid saved marketplace orders.');for(const o of state.confirmedMarketplaceOrders)checkedOrder(o);}
}
