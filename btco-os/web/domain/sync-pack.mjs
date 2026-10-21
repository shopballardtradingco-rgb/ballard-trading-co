// Content-addressed record chunks: only changed chunks cross the network on save.
const encoder=new TextEncoder();
export const ARRAY_KEYS=['items','sales','events','externalSales','importBatches'];
export const hashText=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export async function packState(state){
  const meta=structuredClone(state),arrays={},chunks=[];
  for(const key of ARRAY_KEYS){
    if(state[key]===undefined)continue;
    delete meta[key];arrays[key]=[];
    let part=[],partBytes=2;
    const flush=async()=>{if(!part.length)return;const body=JSON.stringify(part),hash=await hashText(body);chunks.push({hash,body});arrays[key].push(hash);part=[];partBytes=2;};
    for(const record of state[key]){
      const bytes=encoder.encode(JSON.stringify(record)).length+1;
      if(bytes>350000)throw Error('An individual history record is too large to sync. Export a backup.');
      if(part.length>=128||partBytes+bytes>400000)await flush();
      part.push(record);partBytes+=bytes;
    }
    await flush();
  }
  return {manifest:{version:1,meta,arrays},chunks};
}
export function manifestHashes(manifest){return [...new Set(Object.values(manifest?.arrays??{}).flat())];}
export function validateManifest(m){
  if(!m||m.version!==1||!m.meta||m.meta.mode!=='work'||m.meta.workspace!=='btco-local'||!m.arrays||Object.keys(m.arrays).some(k=>!ARRAY_KEYS.includes(k)))throw Error('Invalid inventory manifest.');
  for(const key of ['items','sales','events'])if(!Array.isArray(m.arrays[key]))throw Error('Missing inventory records.');
  for(const hashes of Object.values(m.arrays))if(!Array.isArray(hashes)||hashes.length>3000||hashes.some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)))throw Error('Invalid inventory chunks.');
  if(manifestHashes(m).length>3000||encoder.encode(JSON.stringify(m)).length>500000)throw Error('Inventory manifest exceeds capacity.');
  return m;
}
export function unpackState(manifest,bodies){
  validateManifest(manifest);const state=structuredClone(manifest.meta);
  for(const [key,hashes] of Object.entries(manifest.arrays))state[key]=hashes.flatMap(hash=>{
    const body=bodies.get(hash);if(body===undefined)throw Error('Inventory upload is incomplete. Retry without clearing your local records.');
    const records=JSON.parse(body);if(!Array.isArray(records))throw Error('Invalid record chunk.');return records;
  });
  return state;
}
