import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {fail} from './domain.mjs';
const scope='btco:read btco:listings';
const cookieName='btcore_ebay';
export function createConnector({origin,connectorOrigin,key,fetcher=fetch,secure=true}){
 if(!connectorOrigin||!key)return null;
 const url=new URL(connectorOrigin);
 if(url.protocol!=='https:'||url.origin!==connectorOrigin)throw Error('BTCONNECT_ORIGIN must be an HTTPS origin.');
 if(!/^[a-f0-9]{64}$/.test(key))throw Error('BTCORE_CONNECTOR_KEY must be a random 32-byte hex key.');
 const secret=Buffer.from(key,'hex'),redirect=origin+'/api/ebay/callback',pending=new Map(),refreshes=new Map();
 let registration,mirrorStorage;
 const seal=data=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',secret,iv);return Buffer.concat([iv,c.update(JSON.stringify(data)),c.final(),c.getAuthTag()]).toString('base64url');};
 const open=raw=>{try{const b=Buffer.from(raw,'base64url'),d=createDecipheriv('aes-256-gcm',secret,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString());}catch{return null;}};
 const read=req=>{const raw=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!raw||raw.length>3800)return null;const value=open(raw);return value?.expires>Date.now()?value:null;};
 const set=(res,data)=>res.setHeader('Set-Cookie',`${cookieName}=${seal(data)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?'; Secure':''}`);
 async function json(path,body,form=false){const r=await fetcher(connectorOrigin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'},body:form?new URLSearchParams(body):JSON.stringify(body)});if(!r.ok)fail('eBay connection could not be completed. Connect again.',502);return r.json();}
 async function begin(req,res){
  for(const [id,p] of pending)if(p.expires<Date.now())pending.delete(id);
  if(pending.size>=100)fail('Too many connection attempts. Try again shortly.',429);
  registration??=json('/register',{redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',client_name:'BTCore',scope}).catch(e=>{registration=null;throw e;});
  const client=await registration,state=randomBytes(24).toString('base64url'),verifier=randomBytes(48).toString('base64url'),nonce=randomBytes(24).toString('base64url');
  pending.set(state,{verifier,clientId:client.client_id,nonce,expires:Date.now()+600000});
  res.setHeader('Set-Cookie',`btcore_ebay_flow=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure?'; Secure':''}`);
  return connectorOrigin+'/authorize?'+new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:redirect,scope,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:connectorOrigin+'/mcp'});
 }
 async function callback(req,res,url){
  const state=url.searchParams.get('state'),p=pending.get(state),nonce=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('btcore_ebay_flow='))?.slice(17);
  if(!p||p.expires<Date.now()||nonce!==p.nonce)fail('This eBay connection expired. Start again.',400);
  pending.delete(state);
  if(url.searchParams.get('error')||!url.searchParams.get('code'))fail('eBay connection was not completed.',400);
  const token=await json('/token',{grant_type:'authorization_code',client_id:p.clientId,code:url.searchParams.get('code'),redirect_uri:redirect,code_verifier:p.verifier,resource:connectorOrigin+'/mcp'},true);
  const data={...token,clientId:p.clientId,accessExpires:Date.now()+token.expires_in*1000,expires:Date.now()+29*86400000};
  const readiness=await rpc(data.access_token,'get_listing_readiness',{});
  if(!readiness.connector_listing_scope||readiness.missing_ebay_scopes?.length)fail('Reconnect eBay with listing permissions.',403);
  data.seller=readiness.seller;set(res,data);return data;
 }
 async function access(req,res){let data=read(req);if(!data)fail('Connect eBay on this device to continue.',401);
  let mirrorRaw=null;
  if(data.grantId&&mirrorStorage){const raw=await mirrorStorage.read(),saved=raw?open(raw):null;if(saved?.grantId===data.grantId&&saved.clientId===data.clientId&&saved.seller===data.seller&&saved.expires>Date.now()){mirrorRaw=raw;if(saved.accessExpires>=data.accessExpires){data=saved;set(res,data);}}}

  if(data.accessExpires<Date.now()+60000){
   const id=createHash('sha256').update(data.refresh_token??'').digest('hex');
   if(!data.refresh_token)fail('Reconnect eBay.',401);
   if(!refreshes.has(id)){const prior=data;const refresh=json('/token',{grant_type:'refresh_token',client_id:data.clientId,refresh_token:data.refresh_token,scope,resource:connectorOrigin+'/mcp'},true).then(t=>({...prior,...t,accessExpires:Date.now()+t.expires_in*1000}));refreshes.set(id,refresh);setTimeout(()=>refreshes.delete(id),120000).unref?.();}
   data=await refreshes.get(id);if(mirrorRaw)await mirrorStorage.write(mirrorRaw,seal(data));set(res,data);
  }return data;
 }
 async function rpc(token,name,args){
  const r=await fetcher(connectorOrigin+'/mcp',{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:randomBytes(8).toString('hex'),method:'tools/call',params:{name,arguments:args}})});
  if(!r.ok)fail(r.status===401?'Reconnect eBay.':'BTConnect request failed. Saved progress is safe.',r.status===401?401:502);
  const message=await r.json(),result=message.result;if(message.error||!result)fail('BTConnect could not complete the request.',502);
  if(result.isError)fail(result.content?.filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(0,1000)||'BTConnect rejected the request.',409);
  if(result.structuredContent)return result.structuredContent;
  const text=result.content?.find(c=>c.type==='text')?.text;try{return JSON.parse(text);}catch{fail('BTConnect returned an unreadable response.',502);}
 }
 return {begin,callback,
  bindMirrorStorage(storage){mirrorStorage=storage;},
  async mirrorGrant(req,res){const data=await access(req,res);data.grantId??=randomBytes(24).toString('hex');set(res,data);return seal(data);},
  async mirrorClient(raw,save){
   let data=open(raw);if(!data||data.expires<=Date.now())fail('Reconnect eBay to resume scheduled sync.',401);
   if(data.accessExpires<Date.now()+60000){
    const id=createHash('sha256').update(data.refresh_token??'').digest('hex');if(!data.refresh_token)fail('Reconnect eBay.',401);
    if(!refreshes.has(id)){const prior=data;refreshes.set(id,json('/token',{grant_type:'refresh_token',client_id:data.clientId,refresh_token:data.refresh_token,scope,resource:connectorOrigin+'/mcp'},true).then(t=>({...prior,...t,accessExpires:Date.now()+t.expires_in*1000})));setTimeout(()=>refreshes.delete(id),120000).unref?.();}
    data=await refreshes.get(id);await save(seal(data));
   }
   return {seller:data.seller,call:(name,args={})=>{if(!['get_connection_status','get_active_listings','get_orders'].includes(name))fail('Scheduled sync supports reading only.',403);return rpc(data.access_token,name,args);}};
  },status:req=>{const d=read(req);return {configured:true,connected:Boolean(d),seller:d?.seller??null};},
  async client(req,res){const data=await access(req,res);return {seller:data.seller,call:(name,args={})=>rpc(data.access_token,name,args),
   async upload(bytes,photo){const ticket=await rpc(data.access_token,'begin_photo_upload',{role:photo.role,sha256_hex:photo.sha256,size_bytes:bytes.length});const target=new URL(ticket.upload_url);if(target.origin!==connectorOrigin||target.pathname!=='/photos/upload')fail('Unexpected photo destination.',502);
    const r=await fetcher(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+ticket.upload_token,'Content-Type':'application/octet-stream'},body:bytes});if(!r.ok)fail('Photo transfer failed. The original remains saved in Core.',502);const result=await r.json();if(!result.storage_sha256_verified||result.photo?.sha256_hex!==photo.sha256)fail('Photo checksum did not match.',502);return result.photo;
   }};},
  disconnect(res){res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`);},
 };
}
