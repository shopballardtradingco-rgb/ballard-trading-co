import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {normalizeCard} from '../domain/vision.mjs';

// Exercise real Worker fetch, crypto and D1; provider responses stay local.
const root=fileURLToPath(new URL('../',import.meta.url));
const token='runtime-test-psa-token-123456789';
const owner='runtime-test-owner';
const photo={mime:'image/jpeg',data:'/9j/AA=='};
const record=cert=>({IsValidRequest:true,PSACert:{CertNumber:cert,Subject:'Ken Griffey Jr.',Year:'1989',Brand:'Upper Deck',CardGrade:'9'}});
const card=normalizeCard({player:'Ken Griffey Jr.',year:'1989',set:'Upper Deck',cardNumber:'1',confidence:'HIGH'});

test('hosted provider requests work in workerd and never follow credential-bearing redirects',async t=>{
  const modules=[{type:'ESModule',path:path.join(root,'runtime-test-entry.mjs'),contents:"import {handleVision} from './server/vision-api.mjs'; export default {fetch(request,env){return handleVision(request,env);}}"}];
  for(const dir of ['server','domain'])for(const file of await readdir(path.join(root,dir)))if(file.endsWith('.mjs'))modules.push({type:'ESModule',path:path.join(root,dir,file)});
  const calls=[];let redirect=false;
  const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{OPENAI_API_KEY:'runtime-test-openai',PSA_CREDENTIAL_KEY:'ab'.repeat(32),VISION_SERVICE_URL:'https://vision.example.test',VISION_SERVICE_TOKEN:'runtime-test-market'},outboundService:async request=>{
    const url=new URL(request.url);calls.push({url,authorization:request.headers.get('authorization')});
    if(redirect)return new Response(null,{status:302,headers:{Location:'https://redirect.example.test/credential-trap'}});
    if(url.hostname==='api.psacard.com')return Response.json(record(url.pathname.split('/').pop()));
    if(url.hostname==='api.openai.com')return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(card)}]}],usage:{input_tokens:2000,output_tokens:400}});
    if(url.hostname==='vision.example.test')return Response.json({success:true,items:[]});
    throw Error('Unexpected outbound destination');
  }});
  const call=async(action,body)=>{
    const response=await mf.dispatchFetch('https://os.example.test/api/vision/'+action,{method:body===undefined?'GET':'POST',headers:{'oai-authenticated-user-id':owner,origin:'https://os.example.test','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  try{
    const db=await mf.getD1Database('DB');
    for(const file of (await readdir(path.join(root,'drizzle'))).filter(f=>f.endsWith('.sql')).sort()){
      const sql=await readFile(path.join(root,'drizzle',file),'utf8');
      await db.batch(sql.split('--> statement-breakpoint').flatMap(part=>part.split(';')).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    }
    await t.test('PSA connects, encrypts and reuses the saved credential',async()=>{
      const connected=await call('psa-connect',{requestId:'runtime-connect-1',token,cert:'24311536'});
      assert.equal(connected.status,200,JSON.stringify(connected.data));assert.equal(connected.data.connected,true);
      const stored=await db.prepare('SELECT encrypted_token FROM vision_credentials WHERE owner_id=?').bind(owner).first();
      assert.match(stored.encrypted_token,/^v1\./);assert.ok(!stored.encrypted_token.includes(token));
      assert.equal((await call('status')).data.psa,true);
      const lookup=await call('psa',{requestId:'runtime-lookup-1',cert:'12345678'});
      assert.equal(lookup.status,200);assert.equal(lookup.data.recordFound,true);
      assert.equal(calls.length,2);assert.ok(calls.every(c=>c.authorization==='bearer '+token));
    });
    await t.test('OpenAI identification and the optional market bridge reach their providers',async()=>{
      const scan=await call('scan',{requestId:'runtime-scan-1',front:photo,back:photo});
      assert.equal(scan.status,200,JSON.stringify(scan.data));assert.equal(scan.data.card.player,card.player);
      assert.equal(calls.at(-1).authorization,'Bearer runtime-test-openai');
      const market=await call('market',{card});assert.equal(market.status,200);
      assert.equal(calls.at(-1).authorization,'Bearer runtime-test-market');
    });
    redirect=true;
    const original=await db.prepare('SELECT encrypted_token FROM vision_credentials WHERE owner_id=?').bind(owner).first();
    for(const [action,body] of [
      ['psa-connect',{requestId:'runtime-connect-redirect',token:'replacement-runtime-test-token-123456789',cert:'23456789'}],
      ['psa',{requestId:'runtime-lookup-redirect',cert:'34567890'}],
      ['scan',{requestId:'runtime-scan-redirect',front:photo,back:photo}],
      ['market',{card}]
    ])await t.test(action+' rejects redirects without a second request',async()=>{
      const before=calls.length,result=await call(action,body);
      assert.equal(result.status,502);assert.equal(calls.length,before+1);
      assert.notEqual(calls.at(-1).url.hostname,'redirect.example.test');
      assert.ok(!JSON.stringify(result).includes(token));
      const current=await db.prepare('SELECT encrypted_token FROM vision_credentials WHERE owner_id=?').bind(owner).first();
      assert.equal(current.encrypted_token,original.encrypted_token);
    });
  }finally{await mf.dispose();}
});
