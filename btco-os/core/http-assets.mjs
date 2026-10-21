import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';

const compress=promisify(gzip),files=new Map();
// Weak validators describe the same content with either transfer encoding.
export const matchesETag=(header,etag)=>typeof header==='string'&&header.split(',').some(v=>v.trim()==='*'||v.trim().replace(/^W\//,'')===etag.replace(/^W\//,''));
function acceptsGzip(header=''){
 const encodings=new Map(header.toLowerCase().split(',').map(part=>{
  const [name,...params]=part.trim().split(';');const q=params.find(p=>p.trim().startsWith('q='));
  return [name,q===undefined?1:Number(q.trim().slice(2))];
 }));
 const q=encodings.get('gzip')??encodings.get('*')??0;return Number.isFinite(q)&&q>0&&q<=1;
}
async function asset(name){
 if(!files.has(name))files.set(name,(async()=>{
  const bytes=await readFile(new URL('./public/'+name,import.meta.url));
  return {bytes,compressed:await compress(bytes),etag:'W/"'+createHash('sha256').update(bytes).digest('hex')+'"'};
 })().catch(e=>{files.delete(name);throw e;}));
 return files.get(name);
}
export async function serveAsset(req,res,name,type,safeHeaders){
 const file=await asset(name),headers={...safeHeaders,'Content-Type':type,'Cache-Control':'public, no-cache',ETag:file.etag,Vary:'Accept-Encoding'};
 if(matchesETag(req.headers['if-none-match'],file.etag)){res.writeHead(304,headers);return res.end();}
 const zipped=acceptsGzip(req.headers['accept-encoding'])&&file.compressed.length<file.bytes.length;
 const content=zipped?file.compressed:file.bytes;
 res.writeHead(200,{...headers,...(zipped?{'Content-Encoding':'gzip'}:{}),'Content-Length':content.length});
 return res.end(req.method==='HEAD'?undefined:content);
}
