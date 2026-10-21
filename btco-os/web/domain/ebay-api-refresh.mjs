import {validateState,makeItem,listingPrice,cents} from './core.mjs';
import {skuAliases,skuKey} from './intake-contract.mjs';
import {hashText} from './sync-pack.mjs';
const fail=message=>{throw Error(message);};
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const text=(value,max)=>typeof value==='string'&&value.length<=max;
export async function validateListingPages(pages,{seller,sellerId,now=Date.now()}={}){
  if(!Array.isArray(pages)||!pages.length||pages.length>250)fail('A complete set of eBay listing pages is required.');
  const first=pages[0],total=first.total_matching,count=Math.max(1,Math.ceil(total/200));
  if(!Number.isSafeInteger(total)||total<0||total>50000||pages.length!==count)fail('Incomplete eBay pagination.');
  const ids=new Set(),records=[],times=[];
  for(let index=0;index<pages.length;index++){
    const p=pages[index],last=index===pages.length-1;
    if(p.seller!==seller||p.seller_id!==sellerId||p.source!=='ebay_trading_active_listings')fail('Unexpected eBay seller or source.');
    if(p.page!==index+1||p.page_size!==200||p.total_matching!==total||p.total_pages!==first.total_pages||![count,...(total===0?[0]:[])].includes(p.total_pages)||p.next_page!==(last?null:index+2)||p.has_more!==!last)fail('eBay pagination totals or page sequence changed; collect again.');
    if(!Array.isArray(p.records)||p.returned!==p.records.length||p.returned!==(last?total-index*200:200))fail('Incomplete eBay page.');
    for(const field of ['retrieved_at_utc','provider_timestamp']){
      if(!stamp(p[field]))fail('Missing eBay observation time.');
      const time=Date.parse(p[field]);if(time>now+300000||time<now-86400000)fail('eBay observations are stale or future dated.');times.push(time);
    }
    for(const r of p.records){
      if(!/^\d{9,15}$/.test(r.item_id)||ids.has(r.item_id))fail('Invalid or duplicate eBay item ID.');
      if(!(r.sku===null||text(r.sku,4000))||!text(r.title,4000)||!r.title.trim()||!text(r.listing_type,100)||!Number.isSafeInteger(r.quantity_available)||r.quantity_available<0||r.quantity_available>1000000||r.price?.currency!=='USD'||!Array.isArray(r.variations)||typeof r.requires_variation_review!=='boolean')fail('Unsupported eBay listing data.');
      const priceCents=cents(r.price.value);ids.add(r.item_id);
      records.push({itemId:r.item_id,sku:r.sku??'',title:r.title,listingType:r.listing_type,quantity:r.quantity_available,priceCents,variationReview:r.requires_variation_review||r.variations.length>0});
    }
  }
  if(ids.size!==total||Math.max(...times)-Math.min(...times)>1800000)fail('Incomplete or excessively long eBay collection; collect again.');
  const observedAt=new Date(Math.min(...times)).toISOString(),finishedAt=new Date(Math.max(...times)).toISOString();
  const checksum=await hashText(JSON.stringify({seller,sellerId,observedAt,finishedAt,records}));
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(observedAt));
  return {seller,sellerId,observedAt,finishedAt,asOf,checksum,total,pageCount:pages.length,records};
}
export function refreshFromListings(state,snapshot){
  validateState(state);if(state.mode!=='work')fail('Only the working inventory can be refreshed.');
  const batchId='ebay-api-'+snapshot.checksum;
  if((state.importBatches??[]).some(b=>b.id===batchId))return {next:state,replayed:true,summary:state.importBatches.find(b=>b.id===batchId).stats};
  if((state.ebayRefresh?.observedAt??'')>snapshot.observedAt||(state.ebayRefresh?.asOf??'')>snapshot.asOf)fail('This collection is older than the saved eBay observation.');
  const next=structuredClone(state),byId=new Map(),aliases=new Map();
  for(const i of next.items){
    const ebayId=i.ebayPublication?.itemId??(i.channel.toLowerCase()==='ebay'?i.externalId:'');
    if(ebayId){if(byId.has(ebayId))fail('Duplicate existing eBay listing IDs require review.');byId.set(ebayId,i);}
    for(const key of skuAliases(i)){if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(i.id);}
  }
  const ids=new Set(next.items.map(i=>i.id)),seen=new Set(),blocked=[];
  const stats={sourceRows:snapshot.total,pages:snapshot.pageCount,matched:0,added:0,priceUpdates:0,priceConflicts:0,quantityConflicts:0,skuConflicts:0,blankSku:0,missing:0,blocked:0,variations:0};
  const now=new Date().toISOString();
  for(const row of snapshot.records){
    seen.add(row.itemId);if(!row.sku.trim())stats.blankSku++;
    if(row.variationReview){stats.variations++;blocked.push({id:row.itemId,sku:row.sku,title:row.title,reason:'Variation listing requires separate mapping.'});continue;}
    let item=byId.get(row.itemId);
    if(item&&((item.ebaySnapshot?.observedAt??'')>snapshot.observedAt||(item.ebaySnapshot?.asOf??item.source?.asOf??'')>snapshot.asOf)){blocked.push({id:row.itemId,sku:row.sku,title:row.title,reason:'Existing source is newer.'});continue;}
    if(!item){
      const sku=row.sku.trim()||'EBAY-'+row.itemId,id='ebay-'+row.itemId;
      if(ids.has(id)||aliases.has(skuKey(sku))){blocked.push({id:row.itemId,sku:row.sku,title:row.title,reason:'SKU already maps to another record; review relisting without duplicating stock.'});continue;}
      item=makeItem({id,sku,title:row.title,kind:'other',channel:'eBay',externalId:row.itemId,quantity:0,availability:'review',status:'listed',verification:'unverified',askCents:row.priceCents,
        source:{system:'ebay-active-api',batchId,asOf:snapshot.asOf,observedAt:snapshot.observedAt,reportedAvailable:row.quantity,listingSku:row.sku},
        notes:'New eBay listing observed. SKU is a marketplace alias, not a confirmed CDP master SKU. Review identity and physical stock before releasing.'});
      next.items.push(item);ids.add(id);aliases.set(skuKey(sku),new Set([id]));stats.added++;
    }else stats.matched++;
    const recorded=item.quantity-(item.sourceSoldQuantity??0)-state.sales.filter(s=>s.itemId===item.id&&!s.voidedAt).reduce((n,s)=>n+s.quantity,0);
    const price=listingPrice(item,'ebay'),protectPrice=price.source==='Manually recorded in Vault'||price.asOf>snapshot.asOf;
    const qtyConflict=recorded!==row.quantity,priceConflict=protectPrice&&price.priceCents!==row.priceCents;
    const skuConflict=!!row.sku.trim()&&(!skuAliases(item).includes(skuKey(row.sku))||[...(aliases.get(skuKey(row.sku))??[])].some(id=>id!==item.id));
    stats.quantityConflicts+=Number(qtyConflict);stats.priceConflicts+=Number(priceConflict);stats.skuConflicts+=Number(skuConflict);
    if(!protectPrice){stats.priceUpdates+=Number(price.priceCents!==row.priceCents);item.listingPrices={...item.listingPrices,ebay:{priceCents:row.priceCents,asOf:snapshot.asOf,source:'eBay active-listings API'}};}
    const reasons=[];if(qtyConflict)reasons.push('Reported quantity differs from recorded stock; reconcile before changing physical quantities.');if(skuConflict)reasons.push('Listing SKU differs from saved aliases; CDP master SKU preserved.');if(item.availability==='review')reasons.push('Existing review hold preserved.');
    item.ebaySnapshot={asOf:snapshot.asOf,observedAt:snapshot.observedAt,checkedAt:now,status:'active',reportedAvailable:row.quantity,reportedPriceCents:row.priceCents,titleReported:row.title,listingSku:row.sku,quantityConflict:qtyConflict,priceConflict,skuConflict,recordedAvailable:recorded,reviewReason:reasons.join(' ')};
  }
  for(const [id,item] of byId){
    if(seen.has(id))continue;
    if((item.ebaySnapshot?.observedAt??'')>snapshot.observedAt||(item.ebaySnapshot?.asOf??item.source?.asOf??'')>snapshot.asOf)continue;
    stats.missing++;item.ebaySnapshot={...item.ebaySnapshot,asOf:snapshot.asOf,observedAt:snapshot.observedAt,checkedAt:now,status:'missing',reviewReason:'Not observed in this paginated active feed. Could be ended, sold, relisted, or changed during collection. Stock and sales are unchanged.'};
  }
  stats.blocked=blocked.length;
  const meta={asOf:snapshot.asOf,observedAt:snapshot.observedAt,finishedAt:snapshot.finishedAt,importedAt:now,source:'ebay-active-api',seller:snapshot.seller,fileName:'eBay connector active listings',complete:true,atomicSnapshot:false,checksum:snapshot.checksum,stats};
  next.ebayRefresh={...meta,blocked};
  next.importBatches=[...(next.importBatches??[]),{id:batchId,listingAsOf:snapshot.asOf,...meta}];
  next.events.push({id:batchId,at:now,action:'ebay.api-refreshed',entityId:'workspace',detail:{observedAt:snapshot.observedAt,checksum:snapshot.checksum,...stats}});
  return {next:validateState(next),summary:stats,replayed:false};
}
