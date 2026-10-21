import {createHmac,randomUUID} from 'node:crypto';
import {randomToken,safeEqual} from './auth.mjs';

// This marker cannot authenticate as a password. Private mode can claim the
// same owner row through setup, preserving photo ownership and operation IDs.
export const OPEN_OWNER_PASSWORD='open-workspace:no-password';
const cookieName='btcore_open_session';

export async function createOpenAccess(store,secure){
 const owner=await store.transaction(async q=>{
  await q('SELECT revision FROM core_workspace WHERE id=1'+store.lockSuffix);
  const existing=(await q('SELECT id FROM core_owner'))[0];
  if(existing)return existing;
  const id=randomUUID();
  await q('INSERT INTO core_owner(id,email,password_hash,created_at) VALUES(?,?,?,?)',[id,'workspace@btcore.invalid',OPEN_OWNER_PASSWORD,new Date().toISOString()]);
  return {id};
 });
 // Ephemeral signed cookies never enter core_sessions. They cannot grant access
 // after private mode is restored, including during overlapping deployments.
 const key=randomToken();
 const sign=value=>createHmac('sha256',key).update(value).digest('base64url');
 const sessionFor=req=>{
  const token=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
  if(token.length>1024)return null;
  const [payload,signature,...extra]=token.split('.');
  if(!payload||!signature||extra.length||!safeEqual(sign(payload),signature))return null;
  try{
   const session=JSON.parse(Buffer.from(payload,'base64url').toString());
   return session.owner_id===owner.id&&Number.isFinite(session.expires_at)&&session.expires_at>Date.now()&&typeof session.csrf==='string'?session:null;
  }catch{return null;}
 };
 return {sessionFor,issue(){
  const session={owner_id:owner.id,csrf:randomToken(),expires_at:Date.now()+43200000};
  const payload=Buffer.from(JSON.stringify(session)).toString('base64url');
  return {session,cookie:`${cookieName}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`};
 }};
}
