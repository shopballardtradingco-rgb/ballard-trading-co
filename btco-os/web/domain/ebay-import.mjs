import {emptyState,makeItem,cents,uid,validateState} from './core.mjs?v=0.4.0';
// RFC-style CSV fields, including quoted commas/newlines and doubled quotes.
export function parseCSV(text){
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let n=0;n<text.length;n++){
    const c=text[n];
    if(quoted){if(c==='"'){if(text[n+1]==='"'){cell+='"';n++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw Error('Malformed CSV quotes.');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false;
      if(c!==','){if(c==='\r'&&text[n+1]==='\n')n++;if(row.some(v=>v!==''))rows.push(row);row=[];}
    }else{if(closed)throw Error('Unexpected text after a quoted CSV field.');cell+=c;}
  }
  if(quoted)throw Error('CSV has an unclosed quoted field.');
  if(cell||closed||row.length){row.push(cell);if(row.some(v=>v!==''))rows.push(row);}
  return rows;
}
export function ebayCSVState(text,{asOf,fileName='eBay active listings.csv',mode='work'}={}){
  if(mode!=='work')throw Error('Import real eBay records into the working workspace.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf??'')||isNaN(Date.parse(asOf))||new Date(asOf).toISOString().slice(0,10)!==asOf)throw Error('Enter the report date as YYYY-MM-DD.');
  const rows=parseCSV(text),header=rows.shift();
  if(!header)throw Error('CSV is empty.');
  for(const f of ['Item number','Title','Available quantity','Currency','Current price'])if(!header.includes(f))throw Error(`Missing eBay active-listings column: ${f}`);
  if(new Set(header).size!==header.length)throw Error('CSV contains duplicate column names.');
  const state=emptyState(),batchId='ebay-csv-'+uid();
  for(let n=0;n<rows.length;n++){
    const row=rows[n];if(row.length!==header.length)throw Error(`CSV row ${n+2} has the wrong number of fields.`);
    const r=Object.fromEntries(header.map((h,i)=>[h,row[i].trim()]));
    if(!/^\d{9,15}$/.test(r['Item number']))throw Error(`Invalid item number at row ${n+2}.`);
    if(r['Currency']!=='USD')throw Error('Only USD listings are supported in this prototype.');
    if(!/^\d+$/.test(r['Available quantity']))throw Error(`Invalid available quantity at row ${n+2}.`);
    if(r['Variation details'])throw Error('Variation listings need a separate SKU mapping and cannot be imported automatically.');
    const qty=Number(r['Available quantity']),id=r['Item number'];
    const item=makeItem({id:'ebay-'+id,sku:r['Custom label (SKU)']||'EBAY-'+id,title:r.Title,
      kind:({'Trading Card Singles':'card','Comics & Graphic Novels':'comic','Trading Card Lots':'bulk'})[r['eBay category 1 name']]??'other',
      quantity:qty,availability:qty?'tracked':'review',sourceSoldQuantity:0,status:'listed',verification:'unverified',
      channel:'eBay',externalId:id,askCents:cents(r['Current price'],true),
      listingPrices:{ebay:{priceCents:cents(r['Current price'],true),asOf,source:'eBay active-listings export'}},
      gradeCompany:r['CD:Professional Grader - (ID: 27501)']??'',grade:r['CD:Grade - (ID: 27502)']??'',cert:r['CDA:Certification Number - (ID: 27503)']??'',
      notes:'Imported eBay report. Physical verification and acquisition cost are unconfirmed.',
      source:{batchId,system:'ebay-export',asOf,row:n+2,reportedAvailable:qty,category:r['eBay category 1 name']??'',condition:r.Condition??'',
        autographClaimed:/\b(?:auto|autograph(?:ed|s)?|signatures?)\b/i.test(r.Title)}});
    state.items.push(item);
  }
  if(!state.items.length)throw Error('No item records were found.');
  state.importBatches=[{id:batchId,listingAsOf:asOf,fileName,importedAt:new Date().toISOString(),stats:{sourceRows:state.items.length}}];
  state.events=[{id:uid(),at:new Date().toISOString(),action:'ebay.csv-staged',entityId:'workspace',detail:{asOf,fileName,sourceRows:state.items.length}}];
  return validateState(state);
}
