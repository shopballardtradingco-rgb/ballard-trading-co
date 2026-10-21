import {makeItem,remaining,saveItem} from './core.mjs';
import {clean,scoreInventoryRecord} from './vision-legacy-matcher.mjs';

export const CARD_FIELDS=['player','year','manufacturer','set','cardNumber','team','sport','parallel','serialNumber','gradingCompany','grade','certificationNumber','confidence','notes'];
export function normalizeCard(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('A card identification object is required.');
  const card={};
  for(const field of CARD_FIELDS){const value=input[field]??'';if(typeof value!=='string'&&typeof value!=='number')throw Error(`Invalid ${field}.`);card[field]=String(value).trim();if(card[field].length>2000)throw Error(`${field} is too long.`);}
  for(const field of ['rookie','autograph','relic','graded'])card[field]=input[field]===true;
  return card;
}
export function readScanResult(text){
  if(text.length>200000)throw Error('Scan result is too large.');
  let result;try{result=JSON.parse(text);}catch{throw Error('Paste a valid Vision JSON result.');}
  if(result?.success===false)throw Error('This Vision result reports a failed scan.');
  return normalizeCard(result.card??result);
}
export function visionMatches(state,input){
  const card=normalizeCard(input);
  if(!card.player&&!card.certificationNumber)return [];
  return state.items.filter(i=>i.kind==='card').map(item=>{
    const mapped={Title:item.title,Player:item.subject,Year:item.year,Set:item.setName,Number:item.number,'Serial Number':item.serial,Team:'',Sport:''};
    const match=scoreInventoryRecord(mapped,card);
    const certMatch=!!card.certificationNumber&&!!item.cert&&clean(card.certificationNumber)===clean(item.cert)&&!!card.gradingCompany&&clean(card.gradingCompany)===clean(item.gradeCompany);
    if(card.gradingCompany&&item.gradeCompany&&clean(card.gradingCompany)!==clean(item.gradeCompany))match.conflicts.push('grader');
    if(card.grade&&item.grade&&clean(card.grade)!==clean(item.grade))match.conflicts.push('grade');
    if(card.parallel&&item.parallel&&clean(card.parallel)!==clean(item.parallel))match.conflicts.push('parallel');
    // Original weighted matching ranks candidates. It never establishes physical identity.
    return {item,score:certMatch?200:match.score,certMatch,reasons:certMatch?['same grader and certificate',...match.reasons]:match.reasons,conflicts:match.conflicts,available:remaining(state,item),label:certMatch?'Certificate match':match.conflicts.length?'Conflicting details':'Identity candidate'};
  }).filter(m=>m.certMatch||(!m.conflicts.includes('player')&&m.score>=28)).sort((a,b)=>b.score-a.score).slice(0,8);
}
export function addVisionItem(state,input,{title,sku,reviewed,separateCopy=false,costCents=null,location='',evidence=null}={}){
  const card=normalizeCard(input);
  if(!reviewed)throw Error('Confirm the identity and physical copy before adding inventory.');
  if(!title?.trim()||!sku?.trim())throw Error('Enter a title and a unique SKU.');
  if(evidence?.scanId&&state.items.some(i=>i.source?.visionScan?.scanId===evidence.scanId))throw Error('This scan is already attached to inventory. Open the existing item or scan another physical copy.');
  if(evidence&&(!/^[A-Za-z0-9_-]{8,100}$/.test(evidence.scanId??'')||typeof evidence.identifiedAt!=='string'||!Number.isFinite(Date.parse(evidence.identifiedAt))))throw Error('The saved scan reference is invalid.');
  const matches=visionMatches(state,card);
  if(matches.some(m=>m.certMatch))throw Error('That grading certificate is already recorded. Open the existing item.');
  if(matches.length&&!separateCopy)throw Error('Review the existing candidates and confirm this is another physical copy.');
  const item=makeItem({title:title.trim(),sku:sku.trim(),subject:card.player,year:card.year,setName:card.set,number:card.cardNumber,parallel:card.parallel,serial:card.serialNumber,gradeCompany:card.gradingCompany,grade:card.grade,cert:card.certificationNumber,quantity:1,status:'intake',verification:'unverified',autograph:false,source:{system:'vision-review',asOf:new Date().toISOString().slice(0,10),autographClaimed:card.autograph,identityReviewed:true,card},notes:'Created from a reviewed Vision identification. Cost, physical verification and autograph authenticity require their own confirmation.'});
  item.costCents=costCents;item.location=String(location).trim();
  if(evidence)item.source.visionScan={scanId:evidence.scanId,identifiedAt:evidence.identifiedAt,provider:String(evidence.provider??'').slice(0,100),model:String(evidence.model??'').slice(0,100),originalCard:normalizeCard(evidence.card),...(evidence.psa?{psa:{certNumber:String(evidence.psa.certNumber??''),recordFound:evidence.psa.recordFound===true,fetchedAt:String(evidence.psa.fetchedAt??'')}}:{})};
  return {next:saveItem(state,item),item};
}

export function suggestedTitle(input){const card=normalizeCard(input);return [card.year,card.set,card.player,card.cardNumber?'#'+card.cardNumber:'',card.parallel,card.serialNumber,card.gradingCompany,card.grade].filter(Boolean).join(' ').slice(0,4000);}
export function photoSize(width,height,max=2048){if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width*height>60000000)throw Error('Use a photo no larger than 60 megapixels.');const scale=Math.min(1,max/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
