// Offline bridge from the existing Core backup/compilation code to BTConnect.
import {readFile,writeFile,stat,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,basename,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {parseBackup} from '../btco-os/core/backup.mjs';
import {compileCard} from '../btco-os/core/ebay-publication.mjs';
import {publicationBatches} from '../btco-os/core/publication.mjs';
import {hash} from '../btco-os/core/domain.mjs';
import {priceNeedsReview} from '../btco-os/core/public/price-review.mjs';
import {remaining} from '../btco-os/web/domain/core.mjs';

export function exportInput({state,photos},batchId,seller,settings){
 if(typeof seller!=='string'||!seller.trim()||seller.length>200)throw Error('A stable eBay seller ID is required.');
 const batch=publicationBatches(state).find(b=>b.id===batchId);
 if(!batch||batch.status!=='staged'||batch.publicationApproved||batch.bridge)throw Error('Use a Core-only staged batch. Resume transferred or publishing work from its existing journal.');
 if(!batch.entries.length||batch.entries.length>500||batch.entries.some(e=>e.changed))throw Error('The staged review changed. Review it again in Core.');
 if(!settings||!['261328','183050','183454'].includes(settings.categoryId)||!settings.locationKey||!settings.campaignId||!settings.campaignHash)throw Error('Reviewed seller policies, campaign, location and card conditions are required.');
 const batches=[],originals=new Map(),seen=new Set();
 for(const entry of batch.entries){
  const d=state.drafts.find(d=>d.id===entry.draftId);
  if(!d||d.kind!=='card'||priceNeedsReview(d)||!d.location?.trim()||!d.photos.some(p=>p.role==='front'))throw Error('A staged card is incomplete.');
  if(d.status==='received'){
   const item=state.inventory.items.find(i=>i.id===d.itemId);
   if(!item||item.sku!==d.sku||item.askCents!==d.askCents||remaining(state.inventory,item)<1||['listed','hold'].includes(item.status))throw Error('Vault stock, price or listing status needs review.');
  }
  const refs=[];
  for(const p of [...d.photos].sort((a,b)=>Number(b.role==='front')-Number(a.role==='front'))){
   const original=photos.find(x=>x.id===p.id);
   if(!original||original.retired||original.draftId!==d.id||original.role!==p.role||hash(original.bytes)!==p.sha256||!['image/jpeg','image/png'].includes(p.mediaType)||seen.has(p.sha256))throw Error('Every card must have its own verified original photos.');
   seen.add(p.sha256);
   refs.push({object_key:`photos/${hash(Buffer.from(seller))}/${p.sha256}.${p.mediaType==='image/jpeg'?'jpeg':'png'}`,sha256_hex:p.sha256,role:p.role});
   originals.set(p.sha256,{sha256_hex:p.sha256,original:original.bytes.toString('base64')});
  }
  const draft=compileCard(d,settings,refs);
  if(!draft.policies?.snapshots_sha256)throw Error('A reviewed shipping-policy snapshot is required for each card.');
  let group=batches.find(b=>b.inventory_location===d.location&&b.items.length<10);
  if(!group){group={batch_id:`btco-batch-${batch.id}-${batches.length}`,inventory_location:d.location,items:[],confirmed_rejection_retry_limit:0};batches.push(group);}
  group.items.push({item_key:d.id,label:d.title,draft});
 }
 return {format:'btcore-publisher-input-v1',seller,core_batch_id:batch.id,core_revision:state.revision,core_state_sha256:hash(state),batches,originals:[...originals.values()]};
}

async function main(){
 const {values}=parseArgs({options:Object.fromEntries(['backup','batch','seller','settings','output'].map(k=>[k,{type:'string'}]))});
 if(Object.keys(values).length!==5)throw Error('All five explicit file/batch/seller arguments are required.');
 const repo=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
 const out=resolve(await realpath(dirname(resolve(values.output))),basename(values.output)),rel=relative(repo,out);
 if(rel===''||(!rel.startsWith('..'+sep)&&!isAbsolute(rel)))throw Error('Keep the private output outside the source checkout.');
 if((await stat(values.backup)).size>100*1024*1024)throw Error('This handoff supports verified backups up to 100 MB.');
 const parsed=await parseBackup(await readFile(values.backup,'utf8'));
 const result=exportInput(parsed,values.batch,values.seller,JSON.parse(await readFile(values.settings,'utf8')));
 await writeFile(out,JSON.stringify(result)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({cards:result.batches.reduce((n,b)=>n+b.items.length,0),batches:result.batches.map(b=>b.batch_id),originals:result.originals.length,approval_granted:false,live_publication_attempted:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Export stopped. Verify the complete backup, unchanged staged batch, reviewed settings and private output path. No live service was contacted.');process.exitCode=1;});
