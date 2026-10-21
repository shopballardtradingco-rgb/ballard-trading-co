import {S3Client,PutObjectCommand,GetObjectCommand,HeadBucketCommand} from '@aws-sdk/client-s3';
import {hash,fail} from './domain.mjs';
import {MAX_PHOTO} from './photos.mjs';

export function objectStorageFromEnv(env=process.env){
 const names=['BTCORE_S3_ENDPOINT','BTCORE_S3_BUCKET','BTCORE_S3_REGION','BTCORE_S3_ACCESS_KEY_ID','BTCORE_S3_SECRET_ACCESS_KEY'];
 if(!names.some(name=>env[name]))return null;
 if(names.some(name=>!env[name]))throw Error('Complete BTCore object storage configuration is required.');
 const endpoint=new URL(env.BTCORE_S3_ENDPOINT);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('Object storage needs an HTTPS endpoint.');
 const client=new S3Client({endpoint:endpoint.href,region:env.BTCORE_S3_REGION,credentials:{accessKeyId:env.BTCORE_S3_ACCESS_KEY_ID,secretAccessKey:env.BTCORE_S3_SECRET_ACCESS_KEY},forcePathStyle:env.BTCORE_S3_PATH_STYLE==='1',maxAttempts:2,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 return s3Storage(client,env.BTCORE_S3_BUCKET);
}
export function s3Storage(client,bucket){
 const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(20000)});
 const get=async key=>{
  const response=await send(new GetObjectCommand({Bucket:bucket,Key:key}));
  if(response.ContentLength>MAX_PHOTO){response.Body?.destroy();fail('Stored photo exceeds its limit.',500);}
  let size=0;const chunks=[];
  for await(const chunk of response.Body){size+=chunk.length;if(size>MAX_PHOTO){response.Body.destroy();fail('Stored photo exceeds its limit.',500);}chunks.push(chunk);}
  return Buffer.concat(chunks);
 };
 return {kind:'object',get,check:()=>send(new HeadBucketCommand({Bucket:bucket})),async put(key,bytes,mediaType){
  try{await send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:mediaType,ContentLength:bytes.length,IfNoneMatch:'*',Metadata:{sha256:hash(bytes)}}));}
  catch(e){if(e.$metadata?.httpStatusCode!==412)throw e;}
  if(hash(await get(key))!==hash(bytes))fail('Stored photo integrity check failed.',500);
 }};
}
export async function photoBytes(row,objectStore,preview=false){
 const key=preview?row.preview_key:row.original_key;
 if(key&&!objectStore)fail('Photo storage is not connected. Saved originals have not been changed.',503);
 const bytes=key?await objectStore.get(key):Buffer.from(preview?row.preview:row.original);
 if(!preview&&hash(bytes)!==row.sha256)fail('Original integrity check failed.',500);
 return bytes;
}
export async function storePhoto(q,ownerId,draftId,meta,bytes,objectStore,retired=false){
 let originalKey=null,previewKey=null;
 if(objectStore){
  originalKey=`btcore/${ownerId}/originals/${meta.sha256}`;
  previewKey=`btcore/${ownerId}/previews/${hash(meta.preview)}.jpg`;
  await objectStore.put(originalKey,bytes,meta.mediaType);
  await objectStore.put(previewKey,meta.preview,'image/jpeg');
 }
 await q('INSERT INTO core_photos(id,owner_id,draft_id,role,filename,media_type,sha256,size_bytes,width,height,original,preview,created_at,original_key,preview_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[meta.id,ownerId,draftId,retired?'retired:'+meta.id:meta.role,meta.filename,meta.mediaType,meta.sha256,meta.sizeBytes,meta.width,meta.height,objectStore?Buffer.alloc(0):bytes,objectStore?Buffer.alloc(0):meta.preview,meta.createdAt,originalKey,previewKey]);
 if(!objectStore){const row=(await q('SELECT original FROM core_photos WHERE id=?',[meta.id]))[0];if(hash(Buffer.from(row.original))!==meta.sha256)fail('Original verification failed.',500);}
}
