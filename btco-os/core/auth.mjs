import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('base64url');
export const safeEqual=(a,b)=>{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&timingSafeEqual(aa,bb);};
export async function passwordHash(password){
 if(typeof password!=='string'||password.length<12||password.length>256)throw Object.assign(Error('Use a password with 12–256 characters.'),{status:400});
 const salt=randomBytes(16).toString('hex'),key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return `scrypt-v1:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password,encoded){
 if(typeof password!=='string'||password.length>256)return false;
 const [version,salt,hash]=String(encoded).split(':');if(version!=='scrypt-v1')return false;
 const key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return safeEqual(key.toString('hex'),hash);
}
export function sessionCookie(token,secure,maxAge=43200){return `btcore_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;}
export function sessionToken(req){return (req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('btcore_session='))?.slice(15)??'';}
export async function sessionFor(store,req){
 const token=sessionToken(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 return (await store.query('SELECT s.owner_id,s.csrf,s.expires_at,o.email FROM core_sessions s JOIN core_owner o ON o.id=s.owner_id WHERE s.token_hash=? AND s.expires_at>?',[digest(token),Date.now()]))[0]??null;
}
export async function newSession(q,ownerId){
 const token=randomToken(),csrf=randomToken();await q('DELETE FROM core_sessions WHERE expires_at<=?',[Date.now()]);
 await q('INSERT INTO core_sessions(token_hash,owner_id,csrf,expires_at) VALUES(?,?,?,?)',[digest(token),ownerId,csrf,Date.now()+43200000]);return {token,csrf};
}
// Account-wide buckets work across restarts and replicas; forwarded headers are never trusted.
export async function checkLoginLimit(store,key){
 return store.transaction(async q=>{
  const now=Date.now();await q('INSERT INTO core_login_limits(key,attempts,reset_at) VALUES(?,0,?) ON CONFLICT(key) DO NOTHING',[key,now+900000]);
  const row=(await q('SELECT attempts,reset_at FROM core_login_limits WHERE key=?'+store.lockSuffix,[key]))[0];
  if(Number(row.reset_at)<=now){await q('UPDATE core_login_limits SET attempts=1,reset_at=? WHERE key=?',[now+900000,key]);return;}
  if(row.attempts>=10)throw Object.assign(Error('Too many sign-in attempts. Try again in 15 minutes.'),{status:429});
  await q('UPDATE core_login_limits SET attempts=attempts+1 WHERE key=?',[key]);
 });
}
