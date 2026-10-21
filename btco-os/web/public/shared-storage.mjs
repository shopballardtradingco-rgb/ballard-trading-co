import {validateState} from './core.mjs?v=0.11.1';
import {packState,manifestHashes,hashText} from './sync-pack.mjs?v=0.11.1';
import {deviceMerge} from './device-merge.mjs?v=0.11.1';
import {openDatabase,readWorkspace as readLocal,writeWorkspace as writeLocal} from './storage.mjs?v=0.11.1';
export const syncStatus={phase:'connecting',revision:0,updatedAt:null,conflicts:[],added:0,ownerId:null,message:''};
let active,manifest,saving=false;
export async function sharedRequest(path='',data){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try{
    const response=await fetch('/api/vault'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal});
    let result;try{result=await response.json();}catch{throw Error('Shared inventory could not be reached. Sign in again or check your connection.');}
    if(!response.ok){const error=Error(result.error||'Shared inventory request failed.');error.status=response.status;throw error;}return result;
  }finally{clearTimeout(timer);}
}
async function cachePut(key,value){
  const db=await openDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});
}
async function cacheGet(key){
  const db=await openDatabase();return new Promise((resolve,reject)=>{const r=db.transaction('workspaces').objectStore('workspaces').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
async function upload(packed,known=manifest){
  const have=new Set(manifestHashes(known)),needed=packed.chunks.filter(c=>!have.has(c.hash));
  for(let n=0;n<needed.length;n+=20)await sharedRequest('/chunks',{chunks:needed.slice(n,n+20)});
}
function accept(result){
  active=validateState(result.state);manifest=result.manifest;Object.assign(syncStatus,{phase:'connected',revision:result.revision,updatedAt:result.updatedAt,ownerId:result.ownerId??syncStatus.ownerId,message:''});
  cachePut('cloud-work:'+syncStatus.ownerId,active).catch(()=>{syncStatus.message='Shared save is safe; this browser could not keep an offline copy.';});
  return active;
}
export async function connectShared(local){
  syncStatus.phase='connecting';
  const expectedOwner=document.querySelector('#app').dataset.owner;
  syncStatus.ownerId=expectedOwner;
  try{
    const remote=await sharedRequest();syncStatus.ownerId=remote.ownerId;manifest=remote.manifest;
    if(remote.ownerId!==expectedOwner)throw Error('Your signed-in account changed. Reload this page before syncing.');
    const marker='btco-os:shared-migrated:'+remote.ownerId;
    const localVersion='revision:'+local.revision;
    if(localStorage.getItem(marker)!==localVersion){
      // Original browser workspace remains untouched in IndexedDB/localStorage.
      let next=remote.state??local,conflicts=[],added=0;
      if(remote.state){
        // Production inventory is runtime data, never a static deployment asset.
        // Without a historical baseline, preserve differing device records for
        // review and keep the saved shared version authoritative.
        const plan=deviceMerge(remote.state,local,{items:[]});
        next=plan.next;conflicts=plan.conflicts;added=plan.added;
      }
      let backupId=null;
      if(!remote.state||conflicts.length||added){
        const packed=await packState(local);backupId='device-'+await hashText(JSON.stringify(packed.manifest));
        await upload(packed);await sharedRequest('/backup',{id:backupId,label:'Inventory before device migration',manifest:packed.manifest});
      }
      if(!remote.state||added){
        const packed=await packState(next);await upload(packed);
        const saved=await sharedRequest('/commit',{manifest:packed.manifest,expectedRevision:remote.revision,operationId:crypto.randomUUID()});
        next={...next,revision:saved.revision};accept({...saved,ownerId:remote.ownerId,state:next});
      }else accept(remote);
      await cachePut('migration-review:'+remote.ownerId,{conflicts,backupId,added});
      localStorage.setItem(marker,localVersion);Object.assign(syncStatus,{conflicts,added,backupId});
    }else{
      if(!remote.state)throw Error('Shared inventory is unexpectedly empty. Your original device records are preserved.');
      accept(remote);const review=await cacheGet('migration-review:'+remote.ownerId);if(review)Object.assign(syncStatus,review);
    }
    return active;
  }catch(error){syncStatus.phase='offline';syncStatus.message=error.message;throw error;}
}
export async function readWorkspace(mode){
  if(mode==='demo')return readLocal(mode);
  const result=await sharedRequest();if(!result.state)throw Error('Shared inventory has not been initialized. Reload this page.');return accept(result);
}
export async function writeWorkspace(mode,previous,next){
  if(mode==='demo')return writeLocal(mode,previous,next);
  if(syncStatus.phase!=='connected')throw Error('Reconnect to shared inventory before saving. Your original device records are preserved.');
  if(saving)throw Error('The previous save is still running.');
  saving=true;
  try{
    validateState(next);
    await cachePut('pending-draft:'+syncStatus.ownerId,next);
    const packed=await packState(next);await upload(packed);
    const saved=await sharedRequest('/commit',{manifest:packed.manifest,expectedRevision:previous.revision,operationId:crypto.randomUUID()});
    return accept({...saved,state:{...next,revision:saved.revision}});
  }finally{saving=false;}
}
export async function sharedHasChanges(){if(saving||syncStatus.phase!=='connected')return false;const s=await sharedRequest('/status');return s.revision!==syncStatus.revision;}
export async function localDraft(){return cacheGet('pending-draft:'+syncStatus.ownerId);}
export async function offlineWorkspace(fallback){return (await cacheGet('cloud-work:'+syncStatus.ownerId))??fallback;}
export async function dismissMigration(){syncStatus.conflicts=[];await cachePut('migration-review:'+syncStatus.ownerId,{conflicts:[],backupId:syncStatus.backupId,added:0});}
