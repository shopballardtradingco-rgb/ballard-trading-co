import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {openStore} from './store.mjs';
import {hash,fail,validateWorkspace,event} from './domain.mjs';
import {inspectPhoto,MAX_PHOTO,MAX_PHOTO_STORAGE,DATABASE_PHOTO_STORAGE} from './photos.mjs';
import {objectStorageFromEnv,storePhoto} from './object-storage.mjs';

function manifest(first){
 if(first?.type!=='manifest'||!['btcore-backup-v1','btcore-backup-v2'].includes(first.format))fail('Backup is incomplete or unsupported.');
 const state=validateWorkspace(first.state),refs=new Map();
 for(const d of state.drafts){
  if(!Array.isArray(d.photos)||!['draft','received','archived'].includes(d.status))fail('Invalid intake in backup.');
  if(first.format==='btcore-backup-v1'&&(d.status==='archived'||d.photoHistory?.length))fail('Photo history and archived intake require a v2 backup.');
  const roles=new Set();
  for(const p of d.photos){if(refs.has(p.id)||roles.has(p.role)||!['front','back'].includes(p.role))fail('Duplicate photo reference in backup.');roles.add(p.role);refs.set(p.id,{...p,draftId:d.id,retired:false});}
  for(const p of d.photoHistory??[]){if(refs.has(p.id))fail('Duplicate historical photo reference.');refs.set(p.id,{...p,draftId:d.id,retired:true});}
  if(d.status==='received'&&!state.inventory.items.some(i=>i.id===d.itemId))fail('Confirmed intake is missing its inventory record.');
 }
 if(refs.size!==first.photoCount)fail('Backup photo references do not match.');
 return {state,refs};
}
async function consumeBackup(lines,{onManifest=()=>{},onPhoto=()=>{},limitBytes=MAX_PHOTO_STORAGE}={}){
 let first,state,refs,last,total=0,count=0;const seen=new Set();
 for await(const line of lines){
  if(!line.trim())continue;
  if(last)fail('Backup contains data after its complete footer.');
  if(Buffer.byteLength(line)>Math.ceil(MAX_PHOTO*4/3)+16*1024*1024)fail('Backup record is too large.');
  let p;try{p=JSON.parse(line);}catch{fail('Backup is not valid NDJSON.');}
  if(!first){first=p;({state,refs}=manifest(first));await onManifest(state);continue;}
  if(p.type==='complete'){last=p;continue;}
  const ref=refs.get(p.id);if(p.type!=='photo'||!ref||seen.has(p.id))fail('Unexpected or duplicate photo.');seen.add(p.id);
  if(typeof p.original!=='string'||p.original.length>Math.ceil(MAX_PHOTO*4/3))fail('Invalid original encoding.');
  const bytes=Buffer.from(p.original,'base64');if(bytes.toString('base64')!==p.original)fail('Invalid original encoding.');
  total+=bytes.length;if(total>limitBytes)fail('Backup exceeds the destination photo storage.');
  const meta=await inspectPhoto(bytes,p);
  for(const key of ['sha256','sizeBytes','width','height','mediaType'])if(p[key]!==meta[key]||ref[key]!==p[key])fail('Original integrity verification failed.');
  if(ref.draftId!==p.draftId||ref.role!==p.role||ref.filename!==p.filename||ref.retired!==(p.retired??false))fail('Photo assignment verification failed.');
  await onPhoto({...p,bytes,preview:meta.preview});count++;
 }
 if(!first||!last)fail('Backup is incomplete or unsupported.');
 if(hash(state)!==last.stateSha256||state.revision!==last.revision||count!==first.photoCount||count!==last.photoCount)fail('Backup manifest verification failed.');
 return {state,count};
}
export async function parseBackup(text){
 if(Buffer.byteLength(text)>100*1024*1024)fail('Use the streaming file restore for backups over 100 MB.');
 const photos=[];const {state}=await consumeBackup(text.trim().split('\n'),{onPhoto:p=>photos.push(p)});
 return {state,photos};
}
async function restoreLines(store,lines,objectStore){
 return store.transaction(async q=>{
  const current=JSON.parse((await q('SELECT body FROM core_workspace WHERE id=1'+store.lockSuffix))[0].body),owner=(await q('SELECT id FROM core_owner'))[0];
  if(!owner)fail('Set up the destination owner account first.');
  if(current.revision!==0||current.inventory.items.length||current.inventory.sales.length||current.drafts.length||(await q('SELECT id FROM core_photos LIMIT 1')).length)fail('Restore requires an empty workspace. Existing records are never replaced.');
  const {state,count}=await consumeBackup(lines,{limitBytes:objectStore?MAX_PHOTO_STORAGE:DATABASE_PHOTO_STORAGE,onPhoto:p=>storePhoto(q,owner.id,p.draftId,p,p.bytes,objectStore,p.retired)});
  state.revision++;state.inventory.revision=state.revision;event(state,'core.workspace-restored','workspace',{sourceRevision:state.revision-1,photos:count});validateWorkspace(state);
  const encoded=JSON.stringify(state);await q('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[state.revision,encoded]);await q('INSERT INTO core_snapshots(revision,body,created_at) VALUES(?,?,?)',[state.revision,encoded,new Date().toISOString()]);
  return {restored:true,revision:state.revision,items:state.inventory.items.length,photos:count};
 });
}
export async function restoreBackup(store,text,{objectStore=null}={}){
 if(Buffer.byteLength(text)>100*1024*1024)fail('Use the streaming file restore for backups over 100 MB.');
 return restoreLines(store,text.trim().split('\n'),objectStore);
}
// Bounded records for plain or compressed operator files. No whole-export buffer.
export async function* backupFileLines(file,{compressed=false,maxBytes=Number.MAX_SAFE_INTEGER}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)fail('Invalid backup byte limit.');
 const source=createReadStream(file),input=compressed?createGunzip():source;
 if(compressed){source.on('error',error=>input.destroy(error));source.pipe(input);}
 const maxLine=Math.ceil(MAX_PHOTO*4/3)+16*1024*1024;
 let total=0,parts=[],length=0;
 const decoder=new TextDecoder('utf-8',{fatal:true});
 try{
  for await(const chunk of input){
   total+=chunk.length;if(total>maxBytes)fail('Backup exceeds the configured byte limit.');
   let start=0;
   while(start<chunk.length){
    const newline=chunk.indexOf(10,start),end=newline<0?chunk.length:newline;
    length+=end-start;if(length>maxLine)fail('Backup record is too large.');
    if(end>start)parts.push(chunk.subarray(start,end));
    if(newline<0)break;
    yield decoder.decode(Buffer.concat(parts,length));parts=[];length=0;start=end+1;
   }
  }
  if(length)yield decoder.decode(Buffer.concat(parts,length));
 }finally{input.destroy();source.destroy();}
}
export async function restoreBackupFile(store,file,{objectStore=null,compressed=false,maxBytes=Number.MAX_SAFE_INTEGER}={}){
 const lines=backupFileLines(file,{compressed,maxBytes});
 try{return await restoreLines(store,lines,objectStore);}finally{await lines.return();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const args=process.argv.slice(2),file=args[args.indexOf('--file')+1];
 if(!args.includes('--into-empty-workspace')||!args.includes('--file')||!file)throw Error('Usage: node backup.mjs --file /private/backup.ndjson --into-empty-workspace');
 const store=await openStore({databaseUrl:process.env.DATABASE_URL,sqlitePath:process.env.BTCORE_SQLITE_PATH,allowSqlite:process.env.BTCORE_LOCAL==='1'});
 try{const objectStore=objectStorageFromEnv();if(objectStore)await objectStore.check();console.log(JSON.stringify(await restoreBackupFile(store,file,{objectStore})));}finally{await store.close();}
}
