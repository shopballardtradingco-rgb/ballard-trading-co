// IndexedDB accommodates thousands of source records without localStorage's small
// synchronous quota. Existing v0.1 localStorage data is read, never overwritten.
import {loadState,validateState} from './core.mjs?v=0.11.1';
let database;
export function openDatabase(){
  if(database)return Promise.resolve(database);
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open('btco-os',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('workspaces');
    r.onerror=()=>reject(r.error);
    r.onblocked=()=>reject(Error('Close another BTCo OS tab to finish opening inventory.'));
    r.onsuccess=()=>{database=r.result;database.onversionchange=()=>{database.close();database=null;};resolve(database);};
  });
}
export async function readWorkspace(mode){
  const db=await openDatabase();
  const stored=await new Promise((resolve,reject)=>{
    const r=db.transaction('workspaces','readonly').objectStore('workspaces').get(mode);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  if(stored!==undefined){validateState(stored);if(stored.mode!==mode)throw Error('Workspace mismatch. Data is preserved.');return stored;}
  return loadState(localStorage,`btco-os:v1:${mode}`,mode);
}
export async function rawWorkspaceBackup(mode){
  const db=await openDatabase();
  const raw=await new Promise((resolve,reject)=>{const r=db.transaction('workspaces').objectStore('workspaces').get(mode);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return raw===undefined?(localStorage.getItem(`btco-os:v1:${mode}`)??'{}'):JSON.stringify(raw,null,2);
}
export async function writeWorkspace(mode,previous,next){
  const db=await openDatabase(),stored=validateState({...next,revision:previous.revision+1});
  return new Promise((resolve,reject)=>{
    let failure;
    const tx=db.transaction('workspaces','readwrite'),objects=tx.objectStore('workspaces'),r=objects.get(mode);
    r.onsuccess=()=>{
      if(r.result&&r.result.revision!==previous.revision){failure=Error('Another tab changed this inventory. Reload before saving.');tx.abort();return;}
      objects.put(stored,mode);
    };
    tx.oncomplete=()=>resolve(stored);
    tx.onerror=()=>reject(failure??tx.error??Error('Inventory could not be saved. Export a backup.'));
    tx.onabort=()=>reject(failure??tx.error??Error('Inventory was not saved. Existing records are preserved.'));
  });
}
