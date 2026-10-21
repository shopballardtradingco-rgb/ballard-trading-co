// Shared by the server and browser. Never infer a storage segment from an unlabeled string.
export const locationFields = ['office','shelf','box','row','section'];
const text=v=>typeof v==='string'?v:'';
export function normalizeLocation(raw={}, source='cdp') {
 const original=Object.fromEntries(Object.entries(raw).filter(([k])=>/^(cabinet|office|shelf|box|row|section|location|location detail|storage location|bin|drawer)$/i.test(k)));
 const get=(...names)=>{for(const name of names){const k=Object.keys(original).find(k=>k.toLowerCase()===name);if(k!==undefined)return text(original[k]);}return '';};
 const result={office:get('office','cabinet'),shelf:get('shelf'),box:get('box'),row:get('row'),section:get('section'),detail:get('location detail','bin','drawer'),raw:original,source};
 const path=get('location','storage location');
 if(!locationFields.some(k=>result[k])&&path){
  const parts=path.split('/');
  if(source==='collx'&&parts.length===5)locationFields.forEach((k,n)=>result[k]=parts[n]);
  else result.detail=[result.detail,path].filter(Boolean).join(' · ');
 }
 return result;
}
export function locationLabel(location){
 if(!location)return '';
 return [location.office,location.box&&'Box '+location.box,location.row&&'Row '+location.row,location.section&&'Section '+location.section].filter(Boolean).join(' → ')+([location.shelf&&'Shelf '+location.shelf,location.detail].filter(Boolean).length?' ('+[location.shelf&&'Shelf '+location.shelf,location.detail].filter(Boolean).join(' · ')+')':'');
}
export function locationStatus(location,legacy=''){
 if(!locationFields.some(k=>location?.[k]?.trim())&&!location?.detail?.trim())return legacy.trim()?'unstructured':'missing';
 return ['office','box','row','section'].every(k=>location?.[k]?.trim())?'recorded':'partial';
}
export const sameLocation=(a,b)=>[...locationFields,'detail'].every(k=>(a?.[k]??'').trim()===(b?.[k]??'').trim());
export function inventorySearchText(item){return [item.title,item.subject,item.sku,item.location,item.serial,item.cert,item.source?.cdpId,...(item.identifiers??[]).map(r=>r.value),item.ebayPublication?.itemId,item.externalId].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
