// Synthetic archive only. No server, marketplace client or production data.
import {open,readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../../btco-os/core/package.json',import.meta.url))('sharp');
import {openStore} from '../../btco-os/core/store.mjs';
import {draftInput,hash} from '../../btco-os/core/domain.mjs';
import {inspectPhoto} from '../../btco-os/core/photos.mjs';
const store=await openStore({sqlitePath:':memory:',allowSqlite:true});
const representative=process.argv.includes('--representative');
let staging;
try{
 if(representative){
  // Unique noisy PNG originals are nearly incompressible; workspace strings
  // also vary. Only one original is buffered at a time during fixture export.
  staging=await mkdtemp(join(tmpdir(),'synthetic-photos-'));
  const state=await store.workspace(),refs=[];
  for(let i=0;i<300;i++){
   const draft=draftInput({kind:'card',title:'Synthetic representative '+i,askCents:800,notes:randomBytes(2304).toString('base64')});
   if(i<6)for(let side=0;side<2;side++){
    const bytes=await sharp(randomBytes(768*1024*3),{raw:{width:768,height:1024,channels:3}}).png({compressionLevel:0}).toBuffer();
    const {preview,...photo}=await inspectPhoto(bytes,{role:side?'back':'front',filename:'synthetic-'+i+'-'+side+'.png'});
    draft.photos.push(photo);
    const path=join(staging,photo.id);await writeFile(path,bytes);
    refs.push({path,photo,draftId:draft.id});
   }
   state.drafts.push(draft);
  }
  const output=await open(process.argv[2],'wx',0o600);
  try{
   const write=record=>output.writeFile(JSON.stringify(record)+'\n');
   await write({type:'manifest',format:'btcore-backup-v2',createdAt:new Date().toISOString(),state,photoCount:refs.length});
   for(const {path,photo,draftId} of refs)await write({type:'photo',...photo,draftId,retired:false,original:(await readFile(path)).toString('base64')});
   await write({type:'complete',revision:state.revision,photoCount:refs.length,stateSha256:hash(state)});
  }finally{await output.close();}
 }else{
 const state=await store.workspace(),draft=draftInput({kind:'card',title:'Synthetic backup fixture',askCents:800}),records=[];
 for(const [i,color] of ['#123456','#654321'].entries()){
  const bytes=await sharp({create:{width:600,height:800,channels:3,background:color}}).jpeg().toBuffer();
  const {preview,...photo}=await inspectPhoto(bytes,{role:'front',filename:'synthetic-'+i+'.jpg'});
  if(i){photo.supersededAt=new Date().toISOString();photo.replacedBy=draft.photos[0].id;draft.photoHistory=[photo];}else draft.photos=[photo];
  records.push({type:'photo',...photo,draftId:draft.id,retired:Boolean(i),original:bytes.toString('base64')});
 }
 state.drafts.push(draft);
 const rows=[{type:'manifest',format:'btcore-backup-v2',createdAt:new Date().toISOString(),state,photoCount:records.length},...records,{type:'complete',revision:state.revision,photoCount:records.length,stateSha256:hash(state)}];
 await writeFile(process.argv[2],rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
 }
}finally{await store.close();if(staging)await rm(staging,{recursive:true,force:true});}
