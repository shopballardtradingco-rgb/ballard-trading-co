import {providerError} from './vision-provider.mjs';

const encoder=new TextEncoder();
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const bytes=value=>Uint8Array.from(value.match(/.{2}/g)??[],v=>parseInt(v,16));
export const credentialStorageReady=env=>/^[a-f0-9]{64}$/i.test(env.PSA_CREDENTIAL_KEY??'');
async function keyFor(env){
  if(!credentialStorageReady(env))throw providerError('Secure PSA connection setup is unavailable. Contact the site owner.',503);
  return crypto.subtle.importKey('raw',bytes(env.PSA_CREDENTIAL_KEY),'AES-GCM',false,['encrypt','decrypt']);
}
export function validatePSAToken(value){
  const token=typeof value==='string'?value.trim().replace(/^bearer\s+/i,''):'';
  if(token.length<20||token.length>8192||!/^[A-Za-z0-9._~+\/-]+=*$/.test(token))throw providerError('Paste the access token from the PSA API page, without your password.');
  return token;
}
export async function sealPSAToken(env,owner,token){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('btco-psa:v1:'+owner)},await keyFor(env),encoder.encode(token));
  return 'v1.'+hex(iv)+'.'+hex(new Uint8Array(encrypted));
}
export async function psaConnection(db,owner,env){
  if(!db)return {configured:false,canConnect:false,saved:false,verifiedAt:null};
  const row=await db.prepare('SELECT encrypted_token,disabled,verified_at FROM vision_credentials WHERE owner_id=?').bind(owner).first();
  const saved=!!row?.encrypted_token&&!row.disabled;
  return {configured:row?.disabled?false:saved?credentialStorageReady(env):!!env.PSA_API_TOKEN,canConnect:credentialStorageReady(env),saved,verifiedAt:saved?row.verified_at:null};
}
export async function readPSAToken(db,owner,env){
  const row=await db.prepare('SELECT encrypted_token,disabled FROM vision_credentials WHERE owner_id=?').bind(owner).first();
  if(row?.disabled)return null;
  if(!row?.encrypted_token)return env.PSA_API_TOKEN||null;
  try{
    const [version,iv,encrypted,...extra]=row.encrypted_token.split('.');
    if(extra.length||version!=='v1'||!/^[a-f0-9]{24}$/.test(iv)||!/^(?:[a-f0-9]{2}){16,}$/.test(encrypted))throw Error('Invalid sealed credential');
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:encoder.encode('btco-psa:v1:'+owner)},await keyFor(env),bytes(encrypted));
    return validatePSAToken(new TextDecoder().decode(clear));
  }catch{throw providerError('Your saved PSA connection could not be opened. Reconnect it in PSA connection settings.',503);}
}
export async function disconnectPSA(db,owner,now){
  await db.prepare('INSERT INTO vision_credentials(owner_id,encrypted_token,disabled,verified_at,updated_at) VALUES(?,NULL,1,NULL,?) ON CONFLICT(owner_id) DO UPDATE SET encrypted_token=NULL,disabled=1,verified_at=NULL,updated_at=excluded.updated_at').bind(owner,now).run();
}
