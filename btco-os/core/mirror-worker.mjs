import {collectEbay,applySnapshot} from './mirror.mjs';
export function createMirrorWorker({store,connector,commit,autoStart=true}){
 let pending=null,stopped=false;
 const status=async()=>{const r=(await store.query('SELECT enabled_until,last_attempt,last_success,error FROM core_mirror_connection WHERE id=1'))[0];return r?{enabled:Number(r.enabled_until)>Date.now(),until:new Date(Number(r.enabled_until)).toISOString(),lastAttempt:Number(r.last_attempt)?new Date(Number(r.last_attempt)).toISOString():null,lastSuccess:Number(r.last_success)?new Date(Number(r.last_success)).toISOString():null,error:r.error}:{enabled:false,error:''};};
 async function perform(client){const snapshot=await collectEbay(client);return commit(state=>{const result=applySnapshot(state,snapshot);return {...result,changed:!result.replayed};});}
 async function enable(req,res){
  if(!connector){const e=Error('eBay connection is not configured.');e.status=503;throw e;}
  if(pending){const e=Error('A sync is already running. Wait for it to finish.');e.status=409;throw e;}
  pending=(async()=>{const client=await connector.client(req,res),result=await perform(client),encrypted_grant=await connector.mirrorGrant(req,res),now=Date.now();await store.query('INSERT INTO core_mirror_connection(id,encrypted_grant,enabled_until,last_attempt,last_success,error) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_grant=excluded.encrypted_grant,enabled_until=CASE WHEN core_mirror_connection.enabled_until>? THEN core_mirror_connection.enabled_until ELSE excluded.enabled_until END,last_attempt=excluded.last_attempt,last_success=excluded.last_success,error=excluded.error',[encrypted_grant,now+21*86400000,now,now,'',now]);return result;})();
  try{return await pending;}finally{pending=null;}
 }
 async function tick(){
  if(stopped||pending||!connector?.mirrorClient)return;
  pending=(async()=>{
   const now=Date.now();const rows=await store.query('UPDATE core_mirror_connection SET last_attempt=? WHERE id=1 AND enabled_until>? AND last_attempt<? RETURNING encrypted_grant',[now,now,now-15*60000]);if(!rows.length)return;
   try{const client=await connector.mirrorClient(rows[0].encrypted_grant,async encrypted_grant=>{await store.query('UPDATE core_mirror_connection SET encrypted_grant=? WHERE id=1 AND enabled_until>?',[encrypted_grant,Date.now()]);});await perform(client);await store.query("UPDATE core_mirror_connection SET last_success=?,error='' WHERE id=1",[Date.now()]);}
   catch(e){await store.query('UPDATE core_mirror_connection SET error=? WHERE id=1',[e.status===401?'Reconnect eBay to resume sync.':'Sync failed; previous complete snapshot retained. Retry from comparison.']);}
  })();try{await pending;}finally{pending=null;}
 }
 const timer=autoStart?setInterval(()=>tick().catch(()=>{}),60000):null;timer?.unref?.();
 return {status,enable,tick,async disable(){await pending?.catch(()=>{});await store.query("UPDATE core_mirror_connection SET enabled_until=0,encrypted_grant='' WHERE id=1");},async stop(){stopped=true;clearInterval(timer);await pending;}};
}
