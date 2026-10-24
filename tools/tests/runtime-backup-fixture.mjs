// Synthetic archive only. No server, marketplace client or production data.
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../../btco-os/core/package.json',import.meta.url))('sharp');
import {openStore} from '../../btco-os/core/store.mjs';
import {draftInput,hash} from '../../btco-os/core/domain.mjs';
import {inspectPhoto} from '../../btco-os/core/photos.mjs';
const store=await openStore({sqlitePath:':memory:',allowSqlite:true});
try{
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
}finally{await store.close();}
