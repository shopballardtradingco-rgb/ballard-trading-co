import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {harness} from './helpers.mjs';
import {createPreparationWorker} from '../preparation.mjs';

function raw(url,headers={},method='GET'){
 return new Promise((resolve,reject)=>{const req=http.request(url,{headers,method},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});
}
test('static responses compress once, revalidate, negotiate encoding and preserve security headers',async()=>{
 const h=await harness();try{
  const plain=await raw(h.url+'/app.mjs'),zipped=await raw(h.url+'/app.mjs',{'Accept-Encoding':'gzip'});
  assert.equal(zipped.status,200);assert.equal(zipped.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(zipped.bytes),plain.bytes);
  assert.ok(zipped.bytes.length<plain.bytes.length*.3,'Main script should transfer at least 70% fewer bytes');
  assert.equal(zipped.headers.etag,plain.headers.etag);assert.equal(zipped.headers.vary,'Accept-Encoding');assert.match(zipped.headers['content-security-policy'],/default-src 'self'/);
  for(const encoding of ['gzip;q=0, *;q=1','br','gzip;q=invalid'])assert.equal((await raw(h.url+'/app.mjs',{'Accept-Encoding':encoding})).headers['content-encoding'],undefined);
  assert.equal((await raw(h.url+'/app.mjs',{'Accept-Encoding':'*;q=0.5'})).headers['content-encoding'],'gzip');
  const same=await raw(h.url+'/app.mjs',{'If-None-Match':'"other", '+plain.headers.etag});assert.equal(same.status,304);assert.equal(same.bytes.length,0);
  assert.equal((await raw(h.url+'/app.mjs',{'If-None-Match':'"old-release"'})).status,200);
  const head=await raw(h.url+'/app.mjs',{},'HEAD');assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(Number(head.headers['content-length']),plain.bytes.length);
  assert.equal((await h.request('/api/workspace',{headers:{'If-None-Match':'*'}})).status,401);
 }finally{await h.close();}
});

for(const external of [false,true])test(`preview revalidation avoids original reads and preserves owner checks (${external?'object':'SQLite'})`,async()=>{
 const files=new Map(),reads=[],objectStore=external?{async put(key,bytes){files.set(key,bytes);},async get(key){reads.push(key);return files.get(key);}}:null;
 const h=await harness({objectStore});try{
  await h.setup();const draft=await h.save('/api/drafts',{kind:'card',title:'Synthetic performance card'});
  const original=await sharp({create:{width:180,height:240,channels:3,background:'blue'}}).png().toBuffer();
  const uploaded=await h.request(`/api/drafts/${draft.body.draftId}/photos?role=front&filename=synthetic.png`,{method:'POST',raw:original,headers:{'Content-Type':'application/octet-stream','X-Workspace-Revision':String((await h.store.workspace()).revision),'Idempotency-Key':randomUUID()}});
  assert.equal(uploaded.status,201);const path='/api/photos/'+uploaded.body.photo.id,queries=[],query=h.store.query;
  h.store.query=async(sql,...args)=>{queries.push(sql);return query(sql,...args);};reads.length=0;
  const first=await raw(h.url+path+'/preview',{Cookie:h.getCookie()});assert.equal(first.status,200);assert.match(first.headers['cache-control'],/private, no-cache/);
  assert.ok(!queries.some(sql=>/SELECT \*|SELECT original FROM/.test(sql)),'Preview must never select the original blob');
  const count=reads.length;queries.length=0;
  const again=await raw(h.url+path+'/preview',{Cookie:h.getCookie(),'If-None-Match':first.headers.etag});assert.equal(again.status,304);assert.equal(again.bytes.length,0);assert.equal(reads.length,count);
  assert.ok(!queries.some(sql=>/SELECT preview FROM/.test(sql)),'A 304 must not read a database blob');
  assert.equal((await raw(h.url+path+'/preview',{'If-None-Match':first.headers.etag})).status,401);
  const download=await raw(h.url+path+'/original',{Cookie:h.getCookie(),'If-None-Match':first.headers.etag});assert.equal(download.status,200);assert.equal(download.headers['cache-control'],'no-store');assert.deepEqual(download.bytes,original);
  if(external)files.set((await query('SELECT original_key FROM core_photos'))[0].original_key,Buffer.from('corrupt'));
  else await query('UPDATE core_photos SET original=?',[Buffer.from('corrupt')]);
  assert.equal((await raw(h.url+path+'/original',{Cookie:h.getCookie()})).status,500,'Original hash verification must remain enforced');
  await h.request('/api/logout',{method:'POST',data:{}});
  assert.equal((await raw(h.url+path+'/preview',{Cookie:h.getCookie(),'If-None-Match':first.headers.etag})).status,401);
 }finally{await h.close();}
});

test('idle preparation avoids workspace locks and wakes on external revision or expired lease',async()=>{
 let clock=100,locks=0,reads=0;const state={revision:1,drafts:[]};
 const worker=createPreparationWorker({assessor:async()=>{throw Error('No paid calls expected');},clock:()=>clock,store:{query:async sql=>{assert.match(sql,/^SELECT revision FROM/);reads++;return [{revision:state.revision}];}},commit:async fn=>{locks++;const result=await fn(state);if(result.changed)state.revision++;return result;}});
 try{
  await worker.tick();for(let n=0;n<40;n++)await worker.tick();assert.equal(locks,1);assert.equal(reads,40);
  state.revision++;state.drafts.push({preparation:{status:'running',leaseUntil:200}});
  await worker.tick();assert.equal(locks,2);await worker.tick();assert.equal(locks,2);
  clock=201;await worker.tick();assert.equal(locks,3);assert.equal(state.drafts[0].preparation.status,'error');assert.match(state.drafts[0].preparation.error,/interrupted/);
 }finally{await worker.stop();}
});
