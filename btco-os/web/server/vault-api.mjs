import {validateState} from '../domain/core.mjs';
import {hashText,validateManifest,manifestHashes,unpackState} from '../domain/sync-pack.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const failure=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
export function authorize(request){
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner||owner.length>200)failure('Sign in with ChatGPT to access your shared inventory.',401);
  if(request.method!=='GET'){
    if(request.headers.get('origin')!==new URL(request.url).origin)failure('This change must come from your BTCo OS page.',403);
    if(!(request.headers.get('content-type')??'').startsWith('application/json'))failure('JSON is required.',415);
  }
  return owner;
}
async function bodyOf(request,max=12000000){
  if(Number(request.headers.get('content-length'))>max)failure('Request exceeds the upload limit.',413);
  const text=await request.text();if(new TextEncoder().encode(text).length>max)failure('Request exceeds the upload limit.',413);
  try{return JSON.parse(text);}catch{failure('Invalid JSON.');}
}
const validOperation=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(id);
function preserveRecords(previous,next,allowPublication=false){
  if(!allowPublication){
    const priorEvents=new Set(previous.events.filter(e=>e.action==='ebay.publication-reconciled').map(e=>e.id));
    if(next.events.some(e=>e.action==='ebay.publication-reconciled'&&!priorEvents.has(e.id)))failure('New publication evidence must use signed receipt reconciliation.');
    const linked=new Set(previous.items.filter(i=>i.ebayPublication).map(i=>i.id));
    if(next.items.some(i=>i.ebayPublication&&!linked.has(i.id)))failure('New publication links must use signed receipt reconciliation.');
  }
  const currentIds=new Set(next.items.map(i=>i.id));
  if(previous.items.some(i=>!currentIds.has(i.id)))failure('This save would remove existing inventory records. No changes were saved.');
  const currentItems=new Map(next.items.map(i=>[i.id,i]));
  for(const old of previous.items){
    const saved=currentItems.get(old.id);
    if(old.ebayPublication&&JSON.stringify(saved.ebayPublication)!==JSON.stringify(old.ebayPublication))failure('Verified publication links must be preserved. Relisting requires separate reconciliation.');
    for(const [group,key] of [['source','cdpSku'],['source','cdpId'],['cdpLink','sku']]){
      const master=old[group]?.[key];
      if(master!==undefined&&master!==null&&master!==''&&saved[group]?.[key]!==master)failure('Existing CDP identifiers must be preserved exactly. No changes were saved.');
    }
  }
  for(const key of ['events','externalSales']){
    const records=new Map((next[key]??[]).map(r=>[r.id,JSON.stringify(r)]));
    if((previous[key]??[]).some(r=>records.get(r.id)!==JSON.stringify(r)))failure('Historical records must be preserved. No changes were saved.');
  }
  const sales=new Map(next.sales.map(s=>[s.id,s]));
  for(const old of previous.sales){
    const saved=sales.get(old.id);if(!saved||JSON.stringify({...saved,voidedAt:old.voidedAt})!==JSON.stringify(old)||(old.voidedAt&&saved.voidedAt!==old.voidedAt))failure('Recorded sales can only be corrected through a preserved reversal.');
  }
}
export async function readState(db,owner,manifest){
  validateManifest(manifest);const hashes=manifestHashes(manifest),bodies=new Map();let bytes=0;
  for(let n=0;n<hashes.length;n+=90){
    const selected=hashes.slice(n,n+90),rows=await db.prepare(`SELECT hash,body FROM vault_chunks WHERE owner_id=? AND hash IN (${selected.map(()=>'?').join(',')})`).bind(owner,...selected).all();
    for(const row of rows.results){bytes+=new TextEncoder().encode(row.body).length;if(bytes>15000000)failure('Inventory exceeds the current 15 MB workspace capacity.');bodies.set(row.hash,row.body);}
  }
  return validateState(unpackState(manifest,bodies));
}
export async function handleVault(request,db){
  try{
    if(!db)return json({error:'Shared storage is not configured.'},503);
    const url=new URL(request.url),action=url.pathname.replace(/^\/api\/vault\/?/,'');
    // Non-sensitive readiness check. The private Site boundary still applies.
    if(action==='health'&&request.method==='GET'){
      await db.prepare('SELECT owner_id FROM vault_workspaces LIMIT 0').all();
      return json({status:'ready',storage:'shared',liveEbayListings:false});
    }
    const owner=authorize(request);
    if(request.method==='GET'&&(action===''||action==='status')){
      const row=await db.prepare('SELECT revision,manifest,updated_at FROM vault_workspaces WHERE owner_id=?').bind(owner).first();
      if(!row?.manifest)return json({ownerId:owner,revision:0,state:null,manifest:null,updatedAt:null});
      const manifest=JSON.parse(row.manifest);
      return json({ownerId:owner,revision:row.revision,updatedAt:row.updated_at,...(action==='status'?{}:{manifest,state:await readState(db,owner,manifest)})});
    }
    if(request.method==='GET'&&action==='history'){
      const revision=url.searchParams.get('revision'),backup=url.searchParams.get('backup');
      if(revision!==null||backup!==null){
        if(revision!==null&&!/^\d+$/.test(revision))failure('Invalid revision.');
        if(backup!==null&&!validOperation(backup))failure('Invalid backup.');
        const row=backup!==null?await db.prepare('SELECT manifest,created_at FROM vault_device_backups WHERE owner_id=? AND id=?').bind(owner,backup).first():await db.prepare('SELECT manifest,created_at FROM vault_snapshots WHERE owner_id=? AND revision=?').bind(owner,Number(revision)).first();
        if(!row)failure('Backup not found.',404);
        return json({createdAt:row.created_at,state:await readState(db,owner,JSON.parse(row.manifest))});
      }
      const history=await db.prepare('SELECT revision,created_at FROM vault_snapshots WHERE owner_id=? ORDER BY revision DESC LIMIT 10').bind(owner).all();
      const devices=await db.prepare('SELECT id,label,created_at FROM vault_device_backups WHERE owner_id=? ORDER BY created_at DESC LIMIT 10').bind(owner).all();
      return json({history:history.results,devices:devices.results});
    }
    if(request.method==='POST'&&action==='chunks'){
      const input=await bodyOf(request);
      if(!Array.isArray(input.chunks)||!input.chunks.length||input.chunks.length>20)failure('Upload 1–20 inventory chunks at a time.');
      const now=new Date().toISOString(),statements=[];
      for(const chunk of input.chunks){
        if(typeof chunk.body!=='string'||new TextEncoder().encode(chunk.body).length>450000||!/^[a-f0-9]{64}$/.test(chunk.hash)||await hashText(chunk.body)!==chunk.hash)failure('Inventory checksum failed.');
        if(!Array.isArray(JSON.parse(chunk.body)))failure('Invalid record data.');
        statements.push(db.prepare('INSERT INTO vault_chunks(owner_id,hash,body,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,hash) DO UPDATE SET created_at=excluded.created_at').bind(owner,chunk.hash,chunk.body,now));
      }
      await db.batch(statements);return json({stored:statements.length});
    }
    if(request.method==='POST'&&action==='backup'){
      const input=await bodyOf(request,700000);if(!validOperation(input.id))failure('Invalid backup identifier.');
      const manifest=validateManifest(input.manifest);await readState(db,owner,manifest);
      const now=new Date().toISOString();
      await db.prepare('INSERT OR IGNORE INTO vault_device_backups(owner_id,id,label,manifest,created_at) VALUES(?,?,?,?,?)').bind(owner,input.id,String(input.label??'Device migration').slice(0,100),JSON.stringify(manifest),now).run();
      return json({saved:true,id:input.id});
    }
    if(request.method==='POST'&&action==='commit'){
      return json(await commitManifest(db,owner,await bodyOf(request,700000)));
    }
    return json({error:'Unsupported inventory operation.'},405);
  }catch(error){return json({error:error.status?error.message:('Inventory operation failed: '+error.message)},error.status??400);}
}

// Internal persistence primitive. Callers must authorize the target workspace first.
export async function commitManifest(db,owner,input,{allowPublication=false}={}){
  const now=new Date().toISOString();
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!validOperation(input.operationId))failure('Invalid save request.');
  const existing=await db.prepare('SELECT revision,manifest,operation_id,updated_at FROM vault_workspaces WHERE owner_id=?').bind(owner).first();
  if(existing?.operation_id===input.operationId)return {saved:true,revision:existing.revision,updatedAt:existing.updated_at,manifest:JSON.parse(existing.manifest)};
  if((existing?.revision??0)!==input.expectedRevision)failure('Another device saved newer changes. Reload shared inventory before saving; your draft is preserved on this device.',409);
  const manifest=validateManifest(structuredClone(input.manifest));manifest.meta.revision=input.expectedRevision+1;
  const next=await readState(db,owner,manifest);
  if(existing?.manifest)preserveRecords(await readState(db,owner,JSON.parse(existing.manifest)),next,allowPublication);
  else if(!allowPublication&&(next.items.some(i=>i.ebayPublication)||next.events.some(e=>e.action==='ebay.publication-reconciled')))failure('Publication evidence must be restored through verified reconciliation.');
  const encoded=JSON.stringify(manifest);
  const result=await db.batch([
    db.prepare('INSERT OR IGNORE INTO vault_workspaces(owner_id,revision,updated_at) VALUES(?,0,?)').bind(owner,now),
    db.prepare('UPDATE vault_workspaces SET revision=?,manifest=?,operation_id=?,updated_at=? WHERE owner_id=? AND revision=?').bind(input.expectedRevision+1,encoded,input.operationId,now,owner,input.expectedRevision),
    db.prepare('INSERT OR IGNORE INTO vault_snapshots(owner_id,revision,manifest,created_at) SELECT owner_id,revision,manifest,updated_at FROM vault_workspaces WHERE owner_id=? AND operation_id=?').bind(owner,input.operationId),
    db.prepare('DELETE FROM vault_snapshots WHERE owner_id=? AND revision < (SELECT MAX(revision)-9 FROM vault_snapshots WHERE owner_id=?)').bind(owner,owner),
    db.prepare(`DELETE FROM vault_chunks WHERE owner_id=? AND created_at<? AND (? % 10)=0 AND hash NOT IN (
      SELECT j.value FROM vault_snapshots s,json_tree(s.manifest,'$.arrays') j WHERE s.owner_id=? AND j.type='text'
      UNION SELECT j.value FROM vault_device_backups b,json_tree(b.manifest,'$.arrays') j WHERE b.owner_id=? AND j.type='text'
      UNION SELECT j.value FROM vault_workspaces w,json_tree(w.manifest,'$.arrays') j WHERE w.owner_id=? AND j.type='text'
    )`).bind(owner,new Date(Date.now()-86400000).toISOString(),input.expectedRevision+1,owner,owner,owner)
  ]);
  if(result[1].meta.changes!==1)failure('Another device saved first. Reload shared inventory; your draft is preserved.',409);
  return {saved:true,revision:input.expectedRevision+1,updatedAt:now,manifest};
}
