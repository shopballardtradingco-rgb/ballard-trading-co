import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {emptyState} from '../domain/core.mjs';
import {packState} from '../domain/sync-pack.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=JSON.parse(await readFile(new URL('./publication-receipt.fixture.json',import.meta.url),'utf8'));

test('signed publication persists through Worker/D1 with tenant, race, replay and generic-save guards',async()=>{
  const modules=[{type:'ESModule',path:path.join(root,'publication-runtime-test.mjs'),contents:"import {handlePublicationSync} from './server/publication-sync.mjs';import {handleVault} from './server/vault-api.mjs';export default {fetch(request,env){return new URL(request.url).pathname.startsWith('/api/vault')?handleVault(request,env.DB):handlePublicationSync(request,env)}};"}];
  for(const dir of ['domain','server'])for(const name of await readdir(path.join(root,dir)))if(name.endsWith('.mjs'))modules.push({type:'ESModule',path:path.join(root,dir,name)});
  const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{BTCO_INVENTORY_OWNER_ID:'runtime-owner',BTCO_EBAY_SELLER_ID:'test-seller',BTCO_RECEIPT_PUBLIC_KEY:fixture.publicKeyB64}});
  try{
    const db=await mf.getD1Database('DB');
    for(const name of (await readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(path.join(root,'drizzle',name),'utf8');await db.batch(sql.split('--> statement-breakpoint').flatMap(p=>p.split(';')).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));}
    const packed=await packState(emptyState()),now=new Date().toISOString();
    await db.prepare('INSERT INTO vault_workspaces(owner_id,revision,manifest,operation_id,updated_at) VALUES(?,?,?,?,?)').bind('runtime-owner',1,JSON.stringify(packed.manifest),'initial-test',now).run();
    const call=async(body,headers={},url='https://os.test/api/publication-sync')=>{const res=await mf.dispatchFetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};};
    const body={action:'preview',envelope:fixture.envelope,physical_confirmation:{quantity:1,location:'TEST-BOX / Section 4',owner_evidence:'Owner confirmed this physical copy and its section.'}};
    assert.equal((await call(body,{'oai-authenticated-user-id':'other'})).status,403);
    assert.equal((await call(body,{origin:'https://evil.test'})).status,403);
    assert.equal((await call({...body,ownerId:'other'})).status,400);
    assert.equal((await call({...body,envelope:{...fixture.envelope,key_id:'0'.repeat(64)}})).status,400);
    const preview=await call(body);assert.equal(preview.status,200,JSON.stringify(preview));assert.equal((await call()).data.revision,1);
    assert.equal((await call({...body,action:'apply',expectedRevision:0,checksum:preview.data.checksum})).status,409);
    const apply={...body,action:'apply',expectedRevision:1,checksum:preview.data.checksum};
    assert.equal((await call({...apply,physical_confirmation:{...body.physical_confirmation,location:'TAMPERED'}})).status,409);
    assert.equal((await call({...apply,physical_confirmation:undefined})).status,409);
    const concurrent=await Promise.all([call(apply),call(apply)]);assert.ok(concurrent.some(r=>r.status===200));assert.ok(concurrent.every(r=>[200,409].includes(r.status)),JSON.stringify(concurrent));
    const replay=await call(apply);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
    const read=await call(null,{},'https://os.test/api/publication-sync?item_id=999000000001');assert.equal(read.data.revision,2);assert.equal(read.data.reconciledCount,1);assert.equal(read.data.reconciliation.checksum,preview.data.receiptChecksum);
    const vault=await call(null,{'oai-authenticated-user-id':'runtime-owner'},'https://os.test/api/vault');assert.equal(vault.data.state.items.length,1);assert.equal(vault.data.state.items[0].quantity,1);assert.equal(vault.data.state.items[0].location,'TEST-BOX / Section 4');assert.equal(vault.data.state.items[0].id,'test-comic-1');
    assert.equal(read.data.reconciliation.current.quantity,1);assert.equal(read.data.reconciliation.current.location,'TEST-BOX / Section 4');
    assert.equal((await call({...apply,physical_confirmation:{...body.physical_confirmation,location:'AFTER-REPLAY'}})).status,400);
    const changed=structuredClone(vault.data.state);delete changed.items[0].ebayPublication;
    const changedPack=await packState(changed);for(const c of changedPack.chunks)await db.prepare('INSERT OR IGNORE INTO vault_chunks(owner_id,hash,body,created_at) VALUES(?,?,?,?)').bind('runtime-owner',c.hash,c.body,now).run();
    const rejected=await call({expectedRevision:2,operationId:'remove-link-test',manifest:changedPack.manifest},{'oai-authenticated-user-id':'runtime-owner',origin:'https://os.test'},'https://os.test/api/vault/commit');assert.equal(rejected.status,400);assert.match(rejected.data.error,/publication links/);
    const forged=structuredClone(vault.data.state);forged.events.push({...forged.events[0],id:'forged-new-event'});
    const forgedPack=await packState(forged);for(const c of forgedPack.chunks)await db.prepare('INSERT OR IGNORE INTO vault_chunks(owner_id,hash,body,created_at) VALUES(?,?,?,?)').bind('runtime-owner',c.hash,c.body,now).run();
    const blocked=await call({expectedRevision:2,operationId:'forge-receipt-test',manifest:forgedPack.manifest},{'oai-authenticated-user-id':'runtime-owner',origin:'https://os.test'},'https://os.test/api/vault/commit');assert.equal(blocked.status,400);assert.match(blocked.data.error,/signed receipt/);
    assert.equal((await call()).data.revision,2);
  }finally{await mf.dispose();}
});
