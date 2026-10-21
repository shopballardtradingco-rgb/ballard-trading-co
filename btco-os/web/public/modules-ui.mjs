import {marketRows,duplicateGroups,reconciliationRows} from './module-views.mjs?v=0.11.1';
import {defaultEconomics,evaluatePurchase} from './vision-economics.mjs?v=0.11.1';
import {cents,money} from './core.mjs?v=0.11.1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const openRow=(id,title)=>`<button class="text-btn" data-action="detail" data-id="${esc(id)}">${esc(title)}</button>`;
export function moduleMarkup(name,state){
  if(name==='market'){
    const rows=marketRows(state),duplicates=duplicateGroups(state);
    return `<section class="panel architecture"><h2>Marketplace observations</h2><p>eBay and CollX prices remain separate. Asking prices are not sold evidence. Search up to ${rows.length.toLocaleString()} records below.</p><label>Find a listing <input id="market-search" type="search" placeholder="Title, SKU or listing ID"></label><div id="market-rows"></div><h3>Duplicate identities · ${duplicates.length}</h3><p>Review possible duplicates before linking records or changing stock.</p>${duplicates.slice(0,100).map(g=>`<p>${esc(g.key)}: ${g.ids.map(id=>openRow(id,state.items.find(i=>i.id===id)?.title??id)).join(' / ')}</p>`).join('')||'<p>No shared listing IDs, exact CDP master SKUs or grading certificates found.</p>'}</section>`;
  }
  if(name==='flow'){
    const rows=reconciliationRows(state),r=state.ebayRefresh;
    return `<section class="panel architecture"><h2>Inventory reconciliation</h2><p>${r?'Last applied eBay observation: '+esc(r.observedAt??r.asOf):'No live eBay observation has been applied.'}</p><p>${rows.length} records need review. Missing listings do not establish a sale. Physical stock and CDP master SKUs require explicit reconciliation.</p><label>Find a review record <input id="flow-search" type="search" placeholder="Title, SKU or reason"></label><div id="flow-rows"></div><h3>Collection history</h3>${(state.importBatches??[]).filter(b=>b.source==='ebay-active-api').slice(-10).reverse().map(b=>`<p>${esc(b.observedAt)} · ${b.stats.sourceRows} listings · ${b.stats.pages} pages · ${b.stats.quantityConflicts} quantity differences</p>`).join('')||'<p>No API collection history.</p>'}</section>`;
  }
  return `<section class="panel architecture"><h2>Scout acquisition worksheet</h2><p>Evaluate a sourced card using your delivered cost and expected resale. Enter exact-card sold evidence before relying on a green signal.</p><form id="scout-form"><div class="form-grid">${[['price','Purchase price','12.00'],['incoming','Inbound shipping','0.00'],['extra','Tax and other buying costs','0.00'],['value','Expected resale','25.00'],['budget','Remaining buying budget','50.00'],['fee','Selling fee %','15'],['promo','Promotion % (at least 5)','5'],['fixed','Fixed selling fee','0.40'],['postage','Outbound postage','1.00'],['supplies','Shipping supplies','0.25']].map(([id,label,value])=>`<label>${label}<input name="${id}" type="number" min="${id==='promo'?5:0}" ${['fee','promo'].includes(id)?'max="100"':''} step="0.01" value="${value}" required></label>`).join('')}</div><p><label><input name="identity" type="checkbox"> Exact identity and condition checked</label></p><p><label><input name="sold" type="checkbox"> Matching sold evidence checked</label></p><button class="btn primary" type="submit">Evaluate purchase</button></form><div id="scout-result" role="status" aria-live="polite"></div><p>Fees are editable assumptions. This worksheet does not search listings, verify comps, reserve budget or purchase anything.</p></section>`;
}
export function mountModule(name,state,root){
  if(name==='market'||name==='flow'){
    const rows=name==='market'?marketRows(state):reconciliationRows(state),input=root.querySelector('#'+name+'-search'),target=root.querySelector('#'+name+'-rows');
    const render=()=>{const query=input.value.toLowerCase(),matches=rows.filter(r=>[r.title,r.sku,r.cdpSku,r.externalId,...(r.reasons??[])].some(s=>String(s??'').toLowerCase().includes(query)));target.innerHTML=`<p>${matches.length} matches${matches.length>100?' · showing first 100; narrow your search':''}</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>SKU</th>${name==='market'?'<th>eBay</th><th>CollX</th><th>Feed status</th>':'<th>Review reasons</th>'}</tr></thead><tbody>${matches.slice(0,100).map(r=>`<tr><td>${openRow(r.id,r.title)}</td><td>${esc(r.sku)}</td>${name==='market'?`<td>${money(r.ebay.priceCents)}<br>${esc(r.ebay.asOf)}</td><td>${money(r.collx.priceCents)}<br>${esc(r.collx.asOf)}</td><td>${esc(r.observedStatus)}</td>`:`<td>${r.reasons.map(esc).join('; ')}</td>`}</tr>`).join('')}</tbody></table></div>`;};input.addEventListener('input',render);render();return;
  }
  const form=root.querySelector('#scout-form');
  form.addEventListener('submit',event=>{event.preventDefault();const result=root.querySelector('#scout-result');try{
    const data=new FormData(form),settings=defaultEconomics();settings.budget=cents(data.get('budget'));settings.itemLimit=settings.budget;
    Object.assign(settings.channels[0],{feePercent:Number(data.get('fee')),promotionPercent:Number(data.get('promo')),fixedFee:cents(data.get('fixed')),postage:cents(data.get('postage')),supplies:cents(data.get('supplies'))});
    const evaluation=evaluatePurchase(settings,{price:cents(data.get('price')),incoming:cents(data.get('incoming')),extra:cents(data.get('extra')),value:cents(data.get('value')),identityChecked:data.has('identity'),soldEvidence:data.has('sold')});
    result.innerHTML=`<h3>${esc(evaluation.signal.toUpperCase())}</h3><p>${esc(evaluation.reason)}</p>${evaluation.channels.map(c=>`<p>${esc(c.id)} estimated net: <strong>${money(c.net)}</strong></p>`).join('')}`;
  }catch(e){result.textContent=e.message;}});
}
