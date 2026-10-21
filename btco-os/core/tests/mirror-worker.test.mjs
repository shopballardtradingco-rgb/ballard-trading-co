import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../store.mjs';
import {createMirrorWorker} from '../mirror-worker.mjs';
const at=()=>new Date().toISOString();
const client={call:async(name)=>{
 if(name==='get_connection_status')return {seller:'ballardtradingco',seller_id:'3uxyv64dtp6'};
 if(name==='get_active_listings')return {seller:'ballardtradingco',seller_id:'3uxyv64dtp6',source:'ebay_trading_active_listings',retrieved_at_utc:at(),provider_timestamp:at(),page:1,page_size:200,total_matching:0,total_pages:0,records:[],returned:0,next_page:null,has_more:false};
 if(name==='get_orders')return {retrieved_at_utc:at(),date_timezone:'America/Los_Angeles',offset:0,total_matching:0,records:[],returned:0,next_offset:null,has_more:false};throw Error('WRITE TOOL CALLED');
}};
test('persistent read sync survives worker restart, throttles runs, retains snapshots on failure, expires and stops',async()=>{
 const store=await openStore({sqlitePath:':memory:',allowSqlite:true});let commits=0,failed=false,refreshes=0;
 const connector={client:async()=>client,mirrorGrant:async()=> 'synthetic-encrypted-encrypted_grant',mirrorClient:async(raw,save)=>{assert.match(raw,/synthetic-encrypted/);if(failed)throw Error('simulated transient failure');refreshes++;await save('synthetic-encrypted-rotated');return client;}};
 const commit=async fn=>{const state=await store.workspace();const result=fn(state);await store.query('UPDATE core_workspace SET body=? WHERE id=1',[JSON.stringify(state)]);commits++;return result;};
 let worker=createMirrorWorker({store,connector,commit,autoStart:false});try{
  await worker.enable({},{});assert.equal((await worker.status()).enabled,true);assert.equal(commits,1);const until=(await worker.status()).until;await worker.enable({},{});assert.equal((await worker.status()).until,until,'Manual refresh does not extend the trial');commits=1;assert.ok(!JSON.stringify(await store.workspace()).includes('encrypted_grant'));await worker.stop();worker=createMirrorWorker({store,connector,commit,autoStart:false});
  await worker.tick();assert.equal(commits,1);await store.query('UPDATE core_mirror_connection SET last_attempt=0');await worker.tick();assert.equal(commits,2);assert.equal(refreshes,1);
  const before=JSON.stringify(await store.workspace());failed=true;await store.query('UPDATE core_mirror_connection SET last_attempt=0');await worker.tick();assert.equal(JSON.stringify(await store.workspace()),before);assert.match((await worker.status()).error,/previous complete snapshot/);
  failed=false;await store.query('UPDATE core_mirror_connection SET enabled_until=1,last_attempt=0');await worker.tick();assert.equal(commits,2);assert.equal((await worker.status()).enabled,false);
  await worker.disable();assert.equal((await store.query('SELECT encrypted_grant FROM core_mirror_connection'))[0].encrypted_grant,'');
 }finally{await worker.stop();await store.close();}
});
