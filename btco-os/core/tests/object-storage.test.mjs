import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';
import {harness} from './helpers.mjs';
import {s3Storage,objectStorageFromEnv} from '../object-storage.mjs';
import {hash} from '../domain.mjs';
import {restoreBackupFile} from '../backup.mjs';
import {MAX_PHOTO_STORAGE} from '../photos.mjs';

test('S3 writes are conditional, read-back verified, and cannot overwrite mismatched originals',async()=>{
 const map=new Map(),calls=[];
 const storage=s3Storage({async send(cmd){calls.push(cmd);const {Key,Body}=cmd.input;
  if(cmd.constructor.name==='PutObjectCommand'){assert.equal(cmd.input.IfNoneMatch,'*');if(map.has(Key))throw {$metadata:{httpStatusCode:412}};map.set(Key,Buffer.from(Body));return {};}
  return {ContentLength:map.get(Key).length,Body:Readable.from([map.get(Key)])};
 }},'synthetic-bucket');
 await storage.put('original','same','image/jpeg');await storage.put('original','same','image/jpeg');
 await assert.rejects(()=>storage.put('original','different','image/jpeg'),/integrity/);
 assert.equal(map.get('original').toString(),'same');assert.ok(calls.length>=6);
 assert.equal(objectStorageFromEnv({}),null);
 assert.throws(()=>objectStorageFromEnv({BTCORE_S3_ENDPOINT:'https://example.test'}),/Complete/);
});

test('80 MB batch saves outside DB, exports over 100 MB, and restores streaming with original bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'btcore-bulk-'));
 const objects={kind:'object',async get(key){return readFile(join(dir,'objects',key));},async put(key,bytes){const file=join(dir,'objects',key);await mkdir(dirname(file),{recursive:true});try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}assert.equal(hash(await readFile(file)),hash(bytes));}};
 const h=await harness({accessMode:'open',objectStore:objects}),target=await harness({accessMode:'open',objectStore:objects});
 try{
  await h.request('/api/session');await target.request('/api/session');
  assert.equal((await h.request('/api/workspace')).body.photoStorage.limitBytes,MAX_PHOTO_STORAGE);
  const jpeg=await sharp({create:{width:180,height:240,channels:3,background:'#26745a'}}).jpeg().toBuffer();
  let firstId,firstHash;
  for(let i=0;i<10;i++){
   // Valid JPEG plus unique trailing fixture bytes models large original files.
   const bytes=Buffer.concat([jpeg,Buffer.alloc(8*1024*1024-jpeg.length,i)]);
   const d=await h.save('/api/drafts',{kind:'card',location:'SYNTHETIC-BULK'});
   const revision=(await h.store.workspace()).revision;
   const r=await h.request(`/api/drafts/${d.body.draftId}/photos?role=front&filename=synthetic-${i}.jpg`,{method:'POST',raw:bytes,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':String(revision),'Idempotency-Key':randomUUID()}});
   assert.equal(r.status,201,r.text);if(i===0){firstId=r.body.photo.id;firstHash=hash(bytes);}
  }
  const ws=(await h.request('/api/workspace')).body;
  assert.equal(ws.photoStorage.usedBytes,80*1024*1024);assert.equal(ws.state.inventory.items.length,0);
  const rows=await h.store.query('SELECT original,preview,original_key,preview_key FROM core_photos');
  assert.equal(rows.length,10);for(const row of rows){assert.equal(row.original.length,0);assert.equal(row.preview.length,0);assert.ok(row.original_key&&row.preview_key);}
  const file=join(dir,'backup.ndjson');const response=await fetch(h.url+'/api/backup',{headers:{Cookie:h.getCookie()}});
  assert.equal(response.status,200);await pipeline(Readable.fromWeb(response.body),createWriteStream(file));assert.ok((await stat(file)).size>100*1024*1024);
  const restored=await restoreBackupFile(target.store,file,{objectStore:objects});assert.equal(restored.photos,10);
  const download=await fetch(target.url+'/api/photos/'+firstId+'/original',{headers:{Cookie:target.getCookie()}});assert.equal(download.status,200);assert.equal(hash(Buffer.from(await download.arrayBuffer())),firstHash);
  await assert.rejects(()=>restoreBackupFile(target.store,file,{objectStore:objects}),/empty workspace/);
 }finally{await h.close();await target.close();await rm(dir,{recursive:true,force:true});}
});

test('failed object upload cannot commit a photo or revision',async()=>{
 const h=await harness({accessMode:'open',objectStore:{put:async()=>{throw Error('unavailable');}}});try{
  await h.request('/api/session');const d=await h.save('/api/drafts',{kind:'card'}),revision=(await h.store.workspace()).revision;
  const bytes=await sharp({create:{width:150,height:200,channels:3,background:'green'}}).jpeg().toBuffer();
  const r=await h.request(`/api/drafts/${d.body.draftId}/photos?role=front&filename=synthetic.jpg`,{method:'POST',raw:bytes,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':String(revision),'Idempotency-Key':randomUUID()}});
  assert.equal(r.status,500);assert.equal((await h.store.workspace()).revision,revision);assert.equal((await h.store.query('SELECT id FROM core_photos')).length,0);
 }finally{await h.close();}
});
