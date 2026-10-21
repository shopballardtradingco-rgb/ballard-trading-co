import {seedFixture,channelFactsFixture} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {handleVault} from '../server/vault-api.mjs';
import {packState,unpackState,manifestHashes} from '../domain/sync-pack.mjs';
import {emptyState,makeItem,saveItem,validateState,applyChannelFacts} from '../domain/core.mjs';
import {deviceMerge} from '../domain/device-merge.mjs';
import {saveIntakeDraft,linkIntake,intakeRecords} from '../domain/vision-intake.mjs';

function database(){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')))sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  return {sqlite,prepare(sql){return {values:[],sql,bind(...values){this.values=values;return this;},async first(){return sqlite.prepare(sql).get(...this.values)??null;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};},async run(){const r=sqlite.prepare(sql).run(...this.values);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
async function call(db,path='',data,owner='owner-a',extra={}){
  const request=new Request('https://vault.test/api/vault'+path,{method:data===undefined?'GET':'POST',headers:{...(owner?{'oai-authenticated-user-id':owner}:{}),...(data===undefined?{}:{origin:'https://vault.test','content-type':'application/json'}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  const response=await handleVault(request,db);return {status:response.status,data:await response.json(),headers:response.headers};
}
async function stage(db,state,owner='owner-a'){
  const p=await packState(state);for(let n=0;n<p.chunks.length;n+=20)assert.equal((await call(db,'/chunks',{chunks:p.chunks.slice(n,n+20)},owner)).status,200);return p;
}
const fixture=()=>saveItem(emptyState(),makeItem({id:'a',sku:'A',title:'A card',channel:'eBay',externalId:'123',costCents:500,askCents:999}));
async function commit(db,state,revision=0,owner='owner-a',operationId=crypto.randomUUID()){
  const p=await stage(db,state,owner);return call(db,'/commit',{manifest:p.manifest,expectedRevision:revision,operationId},owner);
}
test('authentication, same-origin writes and account ownership are enforced',async()=>{
  const db=database(),s=fixture();assert.equal((await call(db,'',undefined,null)).status,401);
  assert.equal((await call(db,'/commit',{},'owner-a',{origin:'https://hostile.test'})).status,403);
  assert.equal((await commit(db,s)).status,200);
  const own=await call(db);assert.equal(own.data.state.items[0].title,'A card');assert.equal(own.headers.get('cache-control'),'private, no-store');
  assert.equal((await call(db,'',undefined,'owner-b')).data.state,null);
  assert.equal((await call(db,'/history?revision=1',undefined,'owner-b')).status,404);
  const p=await packState(s);assert.equal((await call(db,'/commit',{manifest:p.manifest,expectedRevision:0,operationId:'cross-owner'},'owner-b')).status,400);
});
test('partial or corrupt uploads cannot replace the working inventory',async()=>{
  const db=database();assert.equal((await commit(db,fixture())).status,200);
  const s=fixture();s.items[0].title='Changed';const p=await packState(s);
  assert.equal((await call(db,'/commit',{manifest:p.manifest,expectedRevision:1,operationId:'incomplete-upload'})).status,400);
  const bad={...p.chunks[0],body:'[]'};assert.equal((await call(db,'/chunks',{chunks:[bad]})).status,400);
  assert.equal((await call(db)).data.state.items[0].title,'A card');
});
test('a valid but truncated snapshot cannot delete inventory or rewrite its history',async()=>{
  const db=database(),s=fixture();await commit(db,s);
  assert.equal((await commit(db,emptyState(),1)).status,400);
  const changed=structuredClone(s);changed.events[0].detail.after.title='Rewritten history';
  assert.equal((await commit(db,changed,1)).status,400);
  assert.equal((await call(db)).data.state.items[0].title,'A card');
});
test('shared saves cannot replace or remove existing CDP identities',async()=>{
  const db=database(),s=fixture();
  s.items[0].source={cdpSku:'  CDP-Master-A  ',cdpId:'source-a'};
  assert.equal((await commit(db,s)).status,200);
  for(const patch of [{cdpSku:'cdp-master-a'},{cdpSku:''},{cdpId:'ebay-123'}]){
    const changed=structuredClone(s);Object.assign(changed.items[0].source,patch);
    const result=await commit(db,changed,1);assert.equal(result.status,400);assert.match(result.data.error,/CDP/);
  }
  const removed=structuredClone(s);delete removed.items[0].source;
  assert.equal((await commit(db,removed,1)).status,400);
  assert.deepEqual((await call(db)).data.state.items[0].source,s.items[0].source);
});
test('shared saves preserve manually confirmed CDP master links',async()=>{
  const db=database(),s=fixture();
  s.items[0].cdpLink={sku:'CDP-Exact',method:'manual-confirmation',confirmedAt:'2026-10-12T00:00:00Z'};
  await commit(db,s);
  for(const sku of ['CDP-OTHER','cdp-exact',null]){
    const changed=structuredClone(s);
    if(sku===null)delete changed.items[0].cdpLink;else changed.items[0].cdpLink.sku=sku;
    assert.equal((await commit(db,changed,1)).status,400);
  }
});
test('two devices cannot overwrite newer saves, and retrying a successful operation is idempotent',async()=>{
  const db=database(),initial=fixture();await commit(db,initial);
  const a=structuredClone(initial),b=structuredClone(initial);a.items[0].title='Mac edit';b.items[0].title='iPhone edit';
  const pa=await stage(db,a),pb=await stage(db,b);
  const op={manifest:pa.manifest,expectedRevision:1,operationId:'mac-operation'};
  assert.equal((await call(db,'/commit',op)).status,200);
  assert.equal((await call(db,'/commit',op)).data.revision,2);
  assert.equal((await call(db,'/commit',{manifest:pb.manifest,expectedRevision:1,operationId:'iphone-operation'})).status,409);
  const got=await call(db);assert.equal(got.data.state.items[0].title,'Mac edit');assert.equal(got.data.revision,2);
});
test('recovery snapshots retain the latest ten saves; original device backups remain separate',async()=>{
  const db=database(),s=fixture(),original=await stage(db,s);
  assert.equal((await call(db,'/backup',{manifest:original.manifest,id:'original-device',label:'Device original'})).status,200);
  for(let n=0;n<12;n++){s.items[0].title='Revision '+(n+1);assert.equal((await commit(db,s,n)).status,200);}
  const list=await call(db,'/history');assert.equal(list.data.history.length,10);assert.equal(list.data.history[0].revision,12);assert.equal(list.data.history.at(-1).revision,3);
  assert.equal((await call(db,'/history?revision=2')).status,404);
  assert.equal((await call(db,'/history?backup=original-device')).data.state.items[0].title,'A card');
  assert.equal((await call(db,'/history?revision=4')).data.state.items[0].title,'Revision 4');
});
test('the entire synthetic scale inventory survives hosted-format storage and unchanged chunks are reused',async()=>{
  const db=database(),seed=seedFixture(),facts=channelFactsFixture(),s=applyChannelFacts(seed,facts);
  const p=await packState(s);assert.ok(p.chunks.every(c=>Buffer.byteLength(c.body)<450000));
  assert.deepEqual(unpackState(p.manifest,new Map(p.chunks.map(c=>[c.hash,c.body]))),s);
  assert.equal((await commit(db,s)).status,200);const got=(await call(db)).data.state;validateState(got);assert.equal(got.items.length,3817);assert.deepEqual(got.items,s.items);assert.deepEqual(got.externalSales,s.externalSales);
  const updated=structuredClone(s);updated.items[0].location='New shelf';const p2=await packState(updated),prior=new Set(manifestHashes(p.manifest));
  assert.equal(p2.chunks.filter(c=>!prior.has(c.hash)).length,1);
});
test('migration merges only new identities; conflicting edits and local sales stay reviewable',()=>{
  const baseline=fixture(),local=structuredClone(baseline),shared=structuredClone(baseline);
  local.items[0].location='Mac shelf';shared.items[0].location='iPhone shelf';
  const withNew=saveItem(local,makeItem({id:'b',sku:'B',title:'New item'}));
  const p=deviceMerge(shared,withNew,baseline);assert.equal(p.added,1);assert.equal(p.conflicts.length,1);assert.equal(p.next.items[0].location,'iPhone shelf');assert.equal(local.items[0].location,'Mac shelf');
  assert.equal(deviceMerge(shared,baseline,baseline).conflicts.length,0);
});
test('intake drafts are owner-scoped and linking commits inventory and draft status atomically',async()=>{
  const db=database(),draft=saveIntakeDraft(emptyState(),{player:'A card'},{title:'A card'});
  assert.equal((await commit(db,draft.next)).status,200);
  assert.equal((await call(db,'',undefined,'owner-b')).data.state,null);
  const phone=(await call(db)).data.state,mac=structuredClone(phone);
  const linked=linkIntake(phone,draft.record.id,{sku:'CDP-ONE',reviewed:true,cdpConfirmed:true});
  assert.equal((await commit(db,linked.next,1)).status,200);
  const stale=linkIntake(mac,draft.record.id,{sku:'CDP-OTHER',reviewed:true,cdpConfirmed:true});
  assert.equal((await commit(db,stale.next,1)).status,409);
  const saved=(await call(db)).data.state;
  assert.equal(saved.items.length,1);assert.equal(saved.items[0].sku,'CDP-ONE');assert.equal(intakeRecords(saved)[0].linkedItemId,saved.items[0].id);
  const history=(await call(db,'/history?revision=1')).data.state;assert.equal(history.items.length,0);assert.equal(intakeRecords(history)[0].status,'draft');
});
test('older or truncated saves cannot discard intake drafts or rewrite their scan evidence',async()=>{
  const db=database(),draft=saveIntakeDraft(emptyState(),{player:'Original'},{title:'Original'});await commit(db,draft.next);
  assert.equal((await commit(db,emptyState(),1)).status,400);
  const rewritten=structuredClone(draft.next);rewritten.events[0].detail.record.card.player='Rewritten';
  assert.equal((await commit(db,rewritten,1)).status,400);
  assert.equal(intakeRecords((await call(db)).data.state)[0].card.player,'Original');
});
