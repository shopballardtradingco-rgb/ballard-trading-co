import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {handleVision,visionConfiguration} from '../server/vision-api.mjs';
import {MODEL,normalizePSA,responseUsage,parseIdentification} from '../server/vision-provider.mjs';
import {dayKey} from '../server/vision-store.mjs';
import {normalizeCard,addVisionItem} from '../domain/vision.mjs';
import {emptyState} from '../domain/core.mjs';
import {packState} from '../domain/sync-pack.mjs';
import {handleVault} from '../server/vault-api.mjs';
const require=createRequire(import.meta.url),{visionAccess,listenHost}=require('../services/vision-node/access.cjs');
function database(){const sqlite=new DatabaseSync(':memory:');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')))sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));return {sqlite,async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}},prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return sqlite.prepare(sql).get(...this.values)??null;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};},async run(){const result=sqlite.prepare(sql).run(...this.values);return {meta:{changes:Number(result.changes)}};}};}};}
const environment=extra=>({DB:database(),OPENAI_API_KEY:'fake-openai',PSA_API_TOKEN:'fake-psa',...extra});
const req=(action,body,headers={})=>new Request('https://os.example.test/api/vision/'+action,{method:body===undefined?'GET':'POST',headers:{'oai-authenticated-user-id':'test-owner',origin:'https://os.example.test','content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const clock=()=> '2026-10-11T22:30:00.000Z';
const noCalls=()=>{throw Error('No provider calls are allowed.');};
const photo={mime:'image/jpeg',data:'/9j/AA=='}; // Header-valid test bytes; never sent to a real provider.
const scan=(id='test-scan-1')=>({requestId:id,front:photo,back:photo});
const card=normalizeCard({player:'Ken Griffey Jr.',year:'1989',set:'Upper Deck',cardNumber:'1',confidence:'HIGH'});
const raw=(extra={})=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(card)}]}],usage:{input_tokens:2000,output_tokens:400},...extra});
const call=async(env,action,body,fetcher=noCalls,headers={})=>{const r=await handleVision(req(action,body,headers),env,fetcher,clock);return {status:r.status,data:await r.json()};};
test('authentication and origin enforcement precede provider access',async()=>{const env=environment();assert.equal((await handleVision(new Request('https://os.example.test/api/vision/status'),env,noCalls)).status,401);assert.equal((await call(env,'scan',scan(),noCalls,{origin:'https://evil.test'})).status,403);assert.equal((await call(env,'scan',scan(),noCalls,{'content-type':'text/plain'})).status,415);});
test('AI, PSA and market readiness are independent and secrets are not exposed',async()=>{const env=environment({OPENAI_API_KEY:''});const r=await call(env,'status');assert.equal(r.data.identification,false);assert.equal(r.data.psa,true);assert.equal(r.data.market,false);assert.equal((await call(env,'scan',scan())).status,503);assert.ok(!JSON.stringify(r).includes('fake-psa'));});
test('hosted scan uses fixed endpoint, model, structured schema, ephemeral image inputs and usage accounting',async()=>{const env=environment();let calls=0;const r=await call(env,'scan',scan(),async(url,o)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(o.headers.Authorization,'Bearer fake-openai');assert.equal(o.redirect,'manual');const body=JSON.parse(o.body);assert.equal(body.model,MODEL);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.input[0].content.filter(c=>c.type==='input_image').length,2);return Response.json(raw());});assert.equal(r.status,200);assert.equal(r.data.card.player,card.player);assert.equal(r.data.usageEstimate.costMicros,3300);assert.equal(r.data.usage.committedMicros,3300);assert.equal(calls,1);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM vault_workspaces').get().n,0);const stored=env.DB.sqlite.prepare('SELECT result FROM vision_operations').get().result;assert.ok(!stored.includes(photo.data));});
test('same request replays saved result without a second charge; changed payload is rejected',async()=>{const env=environment();await call(env,'scan',scan(),async()=>Response.json(raw()));const replay=await call(env,'scan',scan());assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.usage.scanAttempts,1);const changed={...scan(),back:{...photo,data:'/9j/AQ=='}};assert.equal((await call(env,'scan',changed)).status,409);});
test('pending request cannot be called twice, including simultaneous requests',async()=>{const env=environment();let resolve,entered;const started=new Promise(r=>entered=r);const blocked=new Promise(r=>resolve=r);const first=call(env,'scan',scan(),async()=>{entered();await blocked;return Response.json(raw());});await started;assert.equal((await call(env,'scan',scan())).status,409);resolve();assert.equal((await first).status,200);});
test('concurrent requests reserve budget atomically before any paid call',async()=>{const env=environment({VISION_DAILY_BUDGET_USD:'0.32'});let release,entered;const wait=new Promise(r=>release=r),started=new Promise(r=>entered=r);const first=call(env,'scan',scan('first-scan'),async()=>{entered();await wait;return Response.json(raw());});await started;assert.equal((await call(env,'scan',scan('second-scan'))).status,429);release();assert.equal((await first).status,200);assert.equal((await call(env,'status')).data.usage.scanAttempts,1);});
test('scan count, invalid settings and insufficient budget block provider calls',async()=>{assert.equal((await call(environment({VISION_DAILY_SCAN_LIMIT:'0'}),'scan',scan())).status,429);assert.equal((await call(environment({VISION_DAILY_BUDGET_USD:'0.31'}),'scan',scan())).status,429);assert.equal((await call(environment({VISION_DAILY_SCAN_LIMIT:'oops'}),'status')).status,503);});
test('unknown charge after timeout retains reservation; failed request does not automatically retry',async()=>{const env=environment();const failed=await call(env,'scan',scan(),async()=>{throw Error('fake-openai');});assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed).includes('fake-openai'));assert.equal((await call(env,'status')).data.usage.committedMicros,320000);assert.equal((await call(env,'scan',scan())).status,409);});
test('credential failure uses no estimated cost and provider errors stay private',async()=>{const env=environment();const r=await call(env,'scan',scan(),async()=>new Response('fake-openai',{status:401}));assert.equal(r.status,502);assert.match(r.data.error,/credentials/);assert.equal((await call(env,'status')).data.usage.committedMicros,0);});
test('malformed and incomplete results retain known usage and never yield an inventory identity',async()=>{const env=environment();const r=await call(env,'scan',scan(),async()=>Response.json(raw({status:'incomplete'})));assert.equal(r.status,502);assert.equal((await call(env,'status')).data.usage.committedMicros,3300);assert.equal((await call(env,'recent')).data.scans[0].status,'failed');assert.throws(()=>parseIdentification(raw({output:[{content:[{type:'refusal'}]}]})),/could not identify/);assert.equal(responseUsage({input_tokens:-1,output_tokens:1}),null);});
test('image signatures, payload size, request IDs and certificate paths are validated before requests',async()=>{const env=environment();for(const image of [{mime:'image/svg+xml',data:'aGk='},{mime:'image/jpeg',data:'aGk='},{mime:'image/jpeg',data:'a'.repeat(4200004)}])assert.equal((await call(env,'scan',{...scan(),front:image})).status,400);assert.equal((await call(env,'scan',{...scan(),requestId:'../a'})).status,400);assert.equal((await call(env,'psa',{requestId:'test-psa-1',cert:'../scan'})).status,400);});
test('scan history is durable and strictly isolated by signed-in owner',async()=>{const env=environment();await call(env,'scan',scan(),async()=>Response.json(raw()));assert.equal((await call(env,'recent')).data.scans.length,1);assert.equal((await call(env,'recent',undefined,noCalls,{'oai-authenticated-user-id':'other-owner'})).data.scans.length,0);assert.equal((await call(env,'status',undefined,noCalls,{'oai-authenticated-user-id':'other-owner'})).data.usage.scanAttempts,0);});
test('PSA validates returned identity, caches record and permits free cached lookups at the limit',async()=>{const env=environment({VISION_PSA_DAILY_LIMIT:'1'}),input={requestId:'test-psa-1',cert:'12345678'};const r=await call(env,'psa',input,async(url,o)=>{assert.equal(url,'https://api.psacard.com/publicapi/cert/GetByCertNumber/12345678');assert.equal(o.headers.Authorization,'bearer fake-psa');return Response.json({IsValidRequest:true,PSACert:{CertNumber:'12345678',Subject:'Ken Griffey Jr.',Year:'1989',Brand:'Upper Deck',CardGrade:'9'}});});assert.equal(r.data.recordFound,true);assert.equal(r.data.usage.psaAttempts,1);const cached=await call(env,'psa',{...input,requestId:'test-psa-2'});assert.equal(cached.data.cached,true);assert.equal(cached.data.usage.psaAttempts,1);assert.equal((await call(env,'psa',{requestId:'test-psa-3',cert:'87654321'})).status,429);});
test('PSA HTTP 200 is not proof of a matching certificate; mismatches are not cached',async()=>{const env=environment();const r=await call(env,'psa',{requestId:'test-psa-1',cert:'12345678'},async()=>Response.json({IsValidRequest:true,ServerMessage:'No data found'}));assert.equal(r.data.recordFound,false);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM vision_psa_cache').get().n,0);assert.equal(normalizePSA({PSACert:{CertNumber:'99999999',Subject:'Different'}},'12345678').recordFound,false);assert.equal(normalizePSA({IsValidRequest:false,PSACert:{CertNumber:'12345678',Subject:'Test'}},'12345678').recordFound,false);});
test('Pacific usage day resets at midnight, including daylight savings boundary',()=>{assert.equal(dayKey('2026-10-12T06:59:59Z'),'2026-10-11');assert.equal(dayKey('2026-10-12T07:00:00Z'),'2026-10-12');assert.equal(dayKey('2026-12-12T07:59:59Z'),'2026-12-11');});
test('legacy active-listings bridge stays distinct from sold evidence',async()=>{const env=environment({VISION_SERVICE_URL:'https://vision.example.test',VISION_SERVICE_TOKEN:'fake-bridge'});const r=await call(env,'market',{card:{player:'Test'}},async(url,o)=>{assert.equal(url,'https://vision.example.test/find-comps');assert.equal(o.headers.Authorization,'Bearer fake-bridge');return Response.json({success:true,soldData:true,source:'sold'});});assert.equal(r.data.soldData,false);assert.equal(r.data.source,'eBay active listings');for(const u of ['http://x.test','https://u:p@x.test','https://x.test/?token=x'])assert.equal(visionConfiguration({...env,VISION_SERVICE_URL:u}),null);});
test('native Node service retains loopback and bearer protections',()=>{assert.equal(listenHost({}),'127.0.0.1');assert.throws(()=>listenHost({HOST:'0.0.0.0'}),/TOKEN/);let next=0,status=0;const middleware=visionAccess('abc'),res={status(n){status=n;return this;},json(){}};middleware({headers:{authorization:'Bearer abd'}},res,()=>next++);assert.equal(status,401);middleware({headers:{authorization:'Bearer abc'}},res,()=>next++);assert.equal(next,1);});

test('identified card survives reviewed receipt and the actual shared Vault save/read round trip',async()=>{
  const env=environment();const identified=await call(env,'scan',scan(),async()=>Response.json(raw()));
  const {next,item}=addVisionItem(emptyState(),identified.data.card,{title:'Reviewed Griffey',sku:'BT-SCAN-1',reviewed:true,evidence:identified.data,costCents:250,location:'Box B'});
  const packed=await packState(next);const vaultReq=(path,body)=>new Request('https://os.example.test/api/vault'+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'test-owner',origin:'https://os.example.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  for(let n=0;n<packed.chunks.length;n+=20)assert.equal((await handleVault(vaultReq('/chunks',{chunks:packed.chunks.slice(n,n+20)}),env.DB)).status,200);
  assert.equal((await handleVault(vaultReq('/commit',{manifest:packed.manifest,expectedRevision:0,operationId:'vision-receipt'}),env.DB)).status,200);
  const saved=await (await handleVault(vaultReq(''),env.DB)).json();assert.equal(saved.state.items[0].id,item.id);assert.equal(saved.state.items[0].source.visionScan.scanId,'test-scan-1');assert.equal(saved.state.items[0].costCents,250);assert.equal(saved.state.items[0].verification,'unverified');
});

const testToken='psa-test-token-for-activation-123456789';
const secureEnvironment=extra=>environment({PSA_API_TOKEN:'',PSA_CREDENTIAL_KEY:'ab'.repeat(32),...extra});
const connectBody=(id='connect-request-1',token=testToken,cert='12345678')=>({requestId:id,token,cert});
const psaRecord=cert=>({IsValidRequest:true,PSACert:{CertNumber:cert,Subject:'Ken Griffey Jr.',Year:'1989',Brand:'Upper Deck',CardGrade:'9'}});
const goodPSA=async url=>Response.json(psaRecord(url.split('/').pop()));
test('PSA setup verifies a real exact cert, encrypts the token and reuses it only server-side',async()=>{
  const env=secureEnvironment();const r=await call(env,'psa-connect',connectBody(),async(url,o)=>{assert.equal(o.headers.Authorization,'bearer '+testToken);return goodPSA(url);});
  assert.equal(r.status,200);assert.equal(r.data.connected,true);assert.equal(r.data.usage.psaAttempts,1);
  const stored=env.DB.sqlite.prepare('SELECT * FROM vision_credentials').get();assert.match(stored.encrypted_token,/^v1\.[a-f0-9]{24}\./);assert.ok(!JSON.stringify(stored).includes(testToken));
  const status=await call(env,'status');assert.equal(status.data.psa,true);assert.equal(status.data.psaConnection.verifiedAt,clock());assert.ok(!JSON.stringify(status).includes(testToken));
  assert.equal((await call(env,'psa',{requestId:'lookup-after-connect',cert:'87654321'},async(url,o)=>{assert.equal(o.headers.Authorization,'bearer '+testToken);return goodPSA(url);})).status,200);
  for(const table of ['vision_operations','vision_psa_cache','vision_credentials'])assert.ok(!JSON.stringify(env.DB.sqlite.prepare('SELECT * FROM '+table).all()).includes(testToken));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM vault_workspaces').get().n,0);
});
test('PSA setup and removal enforce sign-in, origin and JSON before processing credentials',async()=>{
  const env=secureEnvironment();
  for(const action of ['psa-connect','psa-disconnect']){
    assert.equal((await call(env,action,connectBody(),noCalls,{'oai-authenticated-user-id':''})).status,401);
    assert.equal((await call(env,action,connectBody(),noCalls,{origin:'https://evil.test'})).status,403);
    assert.equal((await call(env,action,connectBody(),noCalls,{'content-type':'text/plain'})).status,415);
    assert.equal((await call(env,action,undefined)).status,405);
  }
});
test('PSA secrets are owner-scoped and authenticated encryption rejects copying another owner ciphertext',async()=>{
  const env=secureEnvironment();await call(env,'psa-connect',connectBody(),goodPSA);
  const headers={'oai-authenticated-user-id':'other-owner'};
  assert.equal((await call(env,'status',undefined,noCalls,headers)).data.psa,false);
  assert.equal((await call(env,'psa',{requestId:'other-lookup-1',cert:'87654321'},noCalls,headers)).status,503);
  const copied=env.DB.sqlite.prepare('SELECT encrypted_token FROM vision_credentials').get().encrypted_token;
  env.DB.sqlite.prepare('INSERT INTO vision_credentials VALUES(?,?,0,?,?)').run('other-owner',copied,clock(),clock());
  const r=await call(env,'psa',{requestId:'other-lookup-2',cert:'87654321'},noCalls,headers);assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes(testToken));
});
test('Rejected tokens, mismatched certs, no-data and network failures preserve the working connection',async()=>{
  const env=secureEnvironment();await call(env,'psa-connect',connectBody(),goodPSA);
  const before=env.DB.sqlite.prepare('SELECT encrypted_token FROM vision_credentials').get().encrypted_token;
  const failures=[async()=>new Response(testToken,{status:401}),async()=>Response.json(psaRecord('99999999')),async()=>Response.json({IsValidRequest:true,ServerMessage:'No data found'}),async()=>{throw Error(testToken);}];
  for(let i=0;i<failures.length;i++){
    const r=await call(env,'psa-connect',connectBody('failed-connect-'+i,'different-valid-looking-token-123456'),failures[i]);
    assert.ok(r.status>=400);assert.ok(!JSON.stringify(r).includes(testToken));assert.equal(env.DB.sqlite.prepare('SELECT encrypted_token FROM vision_credentials').get().encrypted_token,before);
  }
});
test('PSA rejection status survives the API and durable history without leaking provider details or replacing credentials',async()=>{
  const env=secureEnvironment();await call(env,'psa-connect',connectBody(),goodPSA);
  const before=env.DB.sqlite.prepare('SELECT encrypted_token FROM vision_credentials').get().encrypted_token;
  const cases=[[401,/fresh access token/],[403,/permission or service access restriction/],[429,/limit/],[302,/not forwarded/],[404,/does not identify the cause/],[500,/invalid credentials or a server error/],[503,/Try again later/]];
  for(const action of ['psa-connect','psa'])for(const [status,expected] of cases){
    const requestId=`diagnostic-${action}-${status}`;
    const input={requestId,cert:'24311536',...(action==='psa-connect'?{token:testToken}:{})};
    const result=await call(env,action,input,async()=>new Response('provider-private-detail '+testToken,{status,headers:{Location:'https://example.test/?token='+testToken,'www-authenticate':testToken}}));
    assert.equal(result.status,status===429?429:502);assert.match(result.data.error,new RegExp('HTTP '+status));assert.match(result.data.error,expected);
    assert.ok(!JSON.stringify(result).includes(testToken));assert.ok(!JSON.stringify(result).includes('provider-private-detail'));
    const stored=env.DB.sqlite.prepare('SELECT error,status FROM vision_operations WHERE id=?').get(requestId);
    assert.equal(stored.status,'failed');assert.equal(stored.error,result.data.error);
    assert.equal(env.DB.sqlite.prepare('SELECT encrypted_token FROM vision_credentials').get().encrypted_token,before);
  }
});
test('PSA approved-customer restriction becomes actionable without exposing the raw provider body',async()=>{
  const env=secureEnvironment();
  const r=await call(env,'psa-connect',connectBody(),async()=>Response.json({Message:'Access to this API is limited to approved customers.',privateDetail:testToken},{status:403}));
  assert.equal(r.status,502);assert.match(r.data.error,/PSA API approval is required/);assert.match(r.data.error,/collectors-apis@collectors.com/);assert.ok(!JSON.stringify(r).includes(testToken));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM vision_credentials').get().n,0);
  assert.equal(env.DB.sqlite.prepare('SELECT error FROM vision_operations').get().error,r.data.error);
});
test('unexpected or oversized PSA error bodies remain generic and are never echoed',async()=>{
  const env=secureEnvironment();let cancelled=false;
  const huge=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('private-provider-data'.repeat(1000)));},cancel(){cancelled=true;}});
  const oversized=await call(env,'psa-connect',connectBody('oversized-error'),async()=>new Response(huge,{status:403,headers:{'Content-Type':'application/json'}}));
  assert.equal(cancelled,true);assert.match(oversized.data.error,/denied API access/);assert.ok(!oversized.data.error.includes('private-provider-data'));
  const unexpected=await call(env,'psa-connect',connectBody('unexpected-error'),async()=>Response.json({Message:testToken},{status:403}));assert.match(unexpected.data.error,/denied API access/);assert.ok(!JSON.stringify(unexpected).includes(testToken));
});
test('PSA setup replay is idempotent and each new verification obeys the existing daily PSA allowance',async()=>{
  const env=secureEnvironment({VISION_PSA_DAILY_LIMIT:'1'});
  await call(env,'psa-connect',connectBody(),goodPSA);assert.equal((await call(env,'psa-connect',connectBody())).data.replayed,true);
  assert.equal((await call(env,'psa-connect',connectBody('connect-request-2'))).status,429);
  assert.equal((await call(env,'psa',{requestId:'cached-after-setup',cert:'12345678'})).data.cached,true);
  assert.equal((await call(env,'status')).data.usage.psaAttempts,1);
});
test('PSA disconnect clears ciphertext, isolates owners and disables environment-token fallback',async()=>{
  const env=secureEnvironment({PSA_API_TOKEN:'fallback-token'});await call(env,'psa-connect',connectBody(),goodPSA);
  assert.equal((await call(env,'psa-disconnect',{})).status,200);
  const row=env.DB.sqlite.prepare('SELECT * FROM vision_credentials').get();assert.equal(row.encrypted_token,null);assert.equal(row.disabled,1);
  assert.equal((await call(env,'status')).data.psa,false);assert.equal((await call(env,'psa',{requestId:'blocked-after-disconnect',cert:'12345678'})).status,503);
  assert.equal((await call(env,'status',undefined,noCalls,{'oai-authenticated-user-id':'other-owner'})).data.psa,true);
  assert.equal((await call(env,'psa-connect',connectBody('reconnect-request'),goodPSA)).status,200);assert.equal((await call(env,'status')).data.psa,true);
});
test('PSA setup rejects malformed inputs and missing encryption configuration before provider calls',async()=>{
  const env=secureEnvironment();
  for(const body of [connectBody('bad'),connectBody('connect-request-1','password'),connectBody('connect-request-1',testToken,'../x'),connectBody('connect-request-1',testToken+'\nheader:evil'),{...connectBody(),token:'x'.repeat(9000)}])assert.equal((await call(env,'psa-connect',body)).status,400);
  assert.equal((await call(env,'psa-connect',{...connectBody(),extra:'x'.repeat(17000)})).status,413);
  assert.equal((await call(secureEnvironment({PSA_CREDENTIAL_KEY:''}),'psa-connect',connectBody())).status,503);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM vision_operations').get().n,0);
});
test('PSA encryption-key loss leaves AI available and never falls back from a saved owner token',async()=>{
  const env=secureEnvironment({PSA_API_TOKEN:'fallback-token'});await call(env,'psa-connect',connectBody(),goodPSA);env.PSA_CREDENTIAL_KEY='';
  const status=await call(env,'status');assert.equal(status.data.identification,true);assert.equal(status.data.psa,false);assert.equal(status.data.psaConnection.canConnect,false);
  assert.equal((await call(env,'psa',{requestId:'missing-key-lookup',cert:'87654321'})).status,503);
});
