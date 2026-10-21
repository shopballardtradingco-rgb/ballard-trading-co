export const INTAKE_ACTIONS=['vision.intake.saved','vision.intake.linked'];
export const cdpSku=item=>{const value=item.cdpLink?.sku??item.source?.cdpSku;return typeof value==='string'?value:'';};
export const skuKey=value=>String(value??'').trim().toLowerCase();
export const skuAliases=item=>[item.sku,cdpSku(item),item.ebayPublication?.listingSku].map(skuKey).filter(Boolean);
export function validateCDPSku(value){
  if(typeof value!=='string'||!value.trim()||value.length>80||/[\x00-\x1f\x7f]/.test(value))throw Error('Enter the exact SKU from CDP (up to 80 characters).');
  if(/^BT-V-[A-F0-9]{8}$/i.test(value.trim()))throw Error('Use the SKU from CDP, not a generated Vision SKU.');
  return value;
}
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const card=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=25&&Object.values(value).every(v=>typeof v==='boolean'||typeof v==='string'&&v.length<=2000);
export function intakeRecords(state){
  const records=new Map();
  for(const event of state.events)if(INTAKE_ACTIONS.includes(event.action))records.set(event.entityId,event.detail.record);
  return [...records.values()];
}
export function validateIntakeState(state){
  const records=new Map(),scanIds=new Map(),items=new Map(state.items.map(i=>[i.id,i]));
  const aliases=new Map();
  for(const item of state.items)for(const alias of skuAliases(item)){if(!aliases.has(alias))aliases.set(alias,new Set());aliases.get(alias).add(item.id);}
  for(const item of state.items)if(item.cdpLink!==undefined){
    const link=item.cdpLink;
    if(!link||validateCDPSku(link.sku)!==link.sku||link.method!=='manual-confirmation'||!date(link.confirmedAt))throw Error('Invalid CDP record link.');
    if(item.source?.cdpSku&&skuKey(item.source.cdpSku)!==skuKey(link.sku))throw Error('The original CDP SKU must be preserved.');
    if(aliases.get(skuKey(link.sku))?.size>1)throw Error('That CDP SKU already belongs to another inventory record.');
  }
  for(const event of state.events){
    if(!INTAKE_ACTIONS.includes(event.action))continue;
    const r=event.detail?.record,previous=records.get(event.entityId);
    if(!r||!validId(r.id)||r.id!==event.entityId||!['draft','linked'].includes(r.status)||!date(r.createdAt)||!date(r.updatedAt)||!card(r.card)||typeof r.title!=='string'||!r.title.trim()||r.title.length>4000||typeof r.location!=='string'||r.location.length>4000||(r.costCents!==null&&(!Number.isSafeInteger(r.costCents)||r.costCents<0||r.costCents>100_000_000_000)))throw Error('Invalid Vision intake draft.');
    if(r.evidence!==null&&(!r.evidence||!validId(r.evidence.scanId)||r.evidence.scanId.length<8||!date(r.evidence.identifiedAt)||!card(r.evidence.card)||typeof r.evidence.provider!=='string'||r.evidence.provider.length>100||typeof r.evidence.model!=='string'||r.evidence.model.length>100))throw Error('Invalid intake scan reference.');
    if(previous&&(previous.status==='linked'||previous.createdAt!==r.createdAt||JSON.stringify(previous.evidence)!==JSON.stringify(r.evidence)))throw Error('Saved scan provenance and completed intake links must be preserved.');
    if(r.evidence){const prior=scanIds.get(r.evidence.scanId);if(prior&&prior!==r.id)throw Error('A scan can belong to only one intake draft.');scanIds.set(r.evidence.scanId,r.id);}
    if(r.status==='linked'){
      const item=items.get(r.linkedItemId);
      if(event.action!=='vision.intake.linked'||!item||validateCDPSku(r.cdpSku)!==r.cdpSku||skuKey(cdpSku(item))!==skuKey(r.cdpSku)||!date(r.linkedAt))throw Error('A linked intake must reference its existing CDP inventory record.');
    }else if(event.action!=='vision.intake.saved'||r.linkedItemId!==null||r.cdpSku!==''||r.linkedAt!==null)throw Error('Drafts cannot claim a CDP inventory link.');
    records.set(r.id,r);
  }
  return state;
}
