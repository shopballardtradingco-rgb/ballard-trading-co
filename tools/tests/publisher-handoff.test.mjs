import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {initialWorkspace} from '../../btco-os/core/store.mjs';
import {draftInput,hash} from '../../btco-os/core/domain.mjs';
import {inspectPhoto} from '../../btco-os/core/photos.mjs';
import {parseBackup} from '../../btco-os/core/backup.mjs';
import {listingContent} from '../../btco-os/core/public/preparation-policy.mjs';
import {approveListings} from '../../btco-os/core/preparation.mjs';
import {stagePublicationBatch} from '../../btco-os/core/publication.mjs';
import {exportInput} from '../export-publisher-input.mjs';
const sharp=createRequire(new URL('../../btco-os/core/package.json',import.meta.url))('sharp');
const exporter=fileURLToPath(new URL('../export-publisher-input.mjs',import.meta.url));

async function fixture(){
 const bytes=await sharp({create:{width:600,height:800,channels:3,background:'#003366'}}).jpeg().toBuffer();
 const {preview,...photo}=await inspectPhoto(bytes,{filename:'synthetic.jpg',role:'front'});
 const state=initialWorkspace();
 const d=draftInput({kind:'card',title:'Synthetic Test Player 2024 Test Set 1',subject:'Test Player',setName:'Test Set',year:'2024',sport:'Baseball',number:'1',location:'TEST',description:'Synthetic front-only card. Reverse unassessed.',conditionNotes:'Reverse unassessed.',condition:'Excellent',askCents:800});
 d.sku='EXACT-SYNTHETIC-SKU';d.photos=[photo];state.drafts.push(d);
 const entries=[{id:d.id,fingerprint:hash(listingContent(d))}];approveListings(state,entries);
 const batchId=stagePublicationBatch(state,entries).batchId;
 const settings={categoryId:'261328',locationKey:'test-location',campaignId:'44',campaignHash:'b'.repeat(64),campaignMode:'manual',
  policies:{fulfillment_policy_id:'11',payment_policy_id:'22',return_policy_id:'33',snapshots_sha256:'a'.repeat(64),buyer_paid_shipping:true,combined_shipping_confirmed:true,combined_shipping_evidence:'Synthetic owner-reviewed combined shipping rules.'},
  cards:{[d.id]:{conditionId:'4000',descriptors:[{name:'40001',values:['400011']}]}}};
 const text=[{type:'manifest',format:'btcore-backup-v2',state,photoCount:1},
  {type:'photo',...photo,draftId:d.id,retired:false,original:bytes.toString('base64')},
  {type:'complete',stateSha256:hash(state),revision:state.revision,photoCount:1}].map(JSON.stringify).join('\n');
 return {parsed:await parseBackup(text),text,batchId,settings,bytes};
}

test('verified Core backup exports the exact front-only card without approval or stock changes',async()=>{
 const f=await fixture(),before=JSON.stringify(f.parsed.state);
 const result=exportInput(f.parsed,f.batchId,'seller',f.settings),draft=result.batches[0].items[0].draft;
 assert.equal(draft.master_sku,'EXACT-SYNTHETIC-SKU');assert.equal(draft.photos.length,1);
 assert.equal(draft.photos[0].role,'front');assert.deepEqual(Buffer.from(result.originals[0].original,'base64'),f.bytes);
 assert.equal(result.batches[0].batch_id,`btco-batch-${f.batchId}-0`);
 assert.equal(draft.physical_item_id,'core:'+f.parsed.state.drafts[0].id);
 assert.equal(JSON.stringify(f.parsed.state),before);assert.equal('approval' in result,false);
});

test('changed, already transferred or publishing Core batches cannot be exported as new',async()=>{
 for(const change of [f=>{f.parsed.state.drafts[0].title='Changed';},f=>{f.parsed.state.publicationBatches[0].bridge={};},f=>{f.parsed.state.publicationBatches[0].publicationApproved=true;},f=>{f.parsed.state.publicationBatches[0].status='cancelled';},f=>{f.parsed.photos[0].bytes=Buffer.from('changed');}]){
  const f=await fixture();change(f);assert.throws(()=>exportInput(f.parsed,f.batchId,'seller',f.settings));
 }
 const f=await fixture();assert.throws(()=>exportInput(f.parsed,f.batchId,'seller',{}),/Reviewed seller/);
 await assert.rejects(parseBackup(f.text.split('\n').slice(0,-1).join('\n')),/incomplete/);
});

test('CLI verifies backup before writing private output and feeds the actual connector integration test',async()=>{
 const f=await fixture(),root=await mkdtemp(join(tmpdir(),'synthetic-handoff-'));
 try{
  const backup=join(root,'backup.ndjson'),settings=join(root,'settings.json'),out=join(root,'input.json');
  await writeFile(backup,f.text,{mode:0o600});await writeFile(settings,JSON.stringify(f.settings),{mode:0o600});
  const args=[exporter,'--backup',backup,'--batch',f.batchId,'--seller','seller','--settings',settings,'--output',out];
  const run=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  assert.equal((await stat(out)).mode&0o777,0o600);assert.equal(spawnSync(process.execPath,args).status,1);
  const inside=[...args];inside[inside.length-1]=resolve('must-not-write-private-input.json');
  assert.equal(spawnSync(process.execPath,inside).status,1);
  const data=await readFile(out,'utf8');assert.equal(JSON.parse(data).originals.length,1);
  if(process.env.BTCO_CORE_HANDOFF_FILE)await writeFile(process.env.BTCO_CORE_HANDOFF_FILE,data,{mode:0o600,flag:'wx'});
 }finally{await rm(root,{recursive:true,force:true});}
});
