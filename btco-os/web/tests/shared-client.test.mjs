import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,makeItem} from '../domain/core.mjs';
import {packState} from '../domain/sync-pack.mjs';

// Exercise the real browser connection module against simulated network/IndexedDB.
// No user identity or production data is used.
const records=new Map(),settings=new Map();
globalThis.document={querySelector:()=>({dataset:{owner:'test-owner'}})};
globalThis.localStorage={getItem:k=>settings.get(k)??null,setItem:(k,v)=>settings.set(k,v)};
const db={objectStoreNames:{contains:()=>true},close(){},transaction(){
  const tx={objectStore:()=>({put:(v,k)=>{records.set(k,structuredClone(v));queueMicrotask(()=>tx.oncomplete?.());},get:k=>{const r={};queueMicrotask(()=>{r.result=records.get(k);r.onsuccess?.();});return r;}})};return tx;
}};
globalThis.indexedDB={open:()=>{const r={};queueMicrotask(()=>{r.result=db;r.onsuccess?.();});return r;}};
const fixture=()=>({...emptyState(),revision:3,items:[makeItem({id:'test-card',sku:'MARKET-001',title:'Saved card',source:{cdpSku:'CDP-001'},quantity:2})]});
let caseId=0;
async function harness(state=fixture()){
  records.clear();settings.clear();
  const packed=await packState(state),calls=[];
  globalThis.fetch=async(path,options={})=>{
    calls.push({path,method:options.method??'GET',body:options.body?JSON.parse(options.body):undefined});
    if(path==='/api/vault')return Response.json({state,ownerId:'test-owner',revision:3,manifest:packed.manifest,updatedAt:'2026-10-12T04:00:00Z'});
    if(path==='/api/vault/chunks'||path==='/api/vault/backup')return Response.json({saved:true});
    // Historical inventory files deliberately do not exist in production source.
    return Response.json({error:'Not found'},{status:404});
  };
  const client=await import('../public/shared-storage.mjs?regression='+caseId++);
  return {client,calls,state};
}
test('fresh device loads existing shared inventory with no bundled seed files and no inventory writes',async()=>{
  const {client,calls,state}=await harness();
  assert.deepEqual(await client.connectShared(emptyState()),state);
  assert.equal(client.syncStatus.phase,'connected');
  assert.deepEqual(calls.map(c=>[c.path,c.method]),[['/api/vault','GET']]);
  assert.equal(settings.get('btco-os:shared-migrated:test-owner'),'revision:0');
});
test('device differences preserve cloud records and back up local evidence without requiring the old baseline',async()=>{
  const {client,calls,state}=await harness(),local=structuredClone(state);local.revision=1;local.items[0].title='Unreviewed local change';
  const result=await client.connectShared(local);
  assert.deepEqual(result,state);assert.equal(result.items[0].source.cdpSku,'CDP-001');
  assert.equal(client.syncStatus.conflicts.length,1);
  assert.ok(calls.some(c=>c.path==='/api/vault/backup'));
  assert.ok(calls.every(c=>c.path.startsWith('/api/vault')));
  assert.ok(!calls.some(c=>c.path==='/api/vault/commit'));
  assert.equal(local.items[0].title,'Unreviewed local change');
});
test('previously migrated device loads existing records without extra source requests',async()=>{
  const {client,calls,state}=await harness();settings.set('btco-os:shared-migrated:test-owner','revision:0');
  assert.deepEqual(await client.connectShared(emptyState()),state);
  assert.equal(client.syncStatus.phase,'connected');assert.equal(calls.length,1);
});
