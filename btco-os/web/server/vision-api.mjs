import {authorize} from './vault-api.mjs';
import {normalizeCard} from '../domain/vision.mjs';
import {MODEL,validateImage,scanBody,parseIdentification,responseUsage,normalizePSA,providerJSON,providerError,psaFailure} from './vision-provider.mjs';
import {operationIdValid,visionLimits,usage,reserve,finish,fail} from './vision-store.mjs';
import {hashText} from '../domain/sync-pack.mjs';
import {psaConnection,readPSAToken,sealPSAToken,validatePSAToken,disconnectPSA} from './vision-credentials.mjs';
// workerd supports manual/follow only. Keep bearer tokens on the fixed provider URL;
// each response must pass the existing response.ok check, which rejects all redirects.
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function visionConfiguration(env){
  try{const url=new URL(env.VISION_SERVICE_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!env.VISION_SERVICE_TOKEN)return null;return {url:url.href.replace(/\/$/,''),token:env.VISION_SERVICE_TOKEN};}catch{return null;}
}
function providerFailure(response,name){
  if([401,403].includes(response.status))return providerError(`${name} credentials were rejected. Check the protected server configuration.`,502);
  if(response.status===429)return providerError(`${name} usage limit reached. Try again after the provider limit resets.`,429);
  return providerError(`${name} could not complete this request. No inventory was changed.`,502);
}
async function inputOf(request,max=9000000){
  if(Number(request.headers.get('content-length'))>max)throw providerError('Vision request is too large.',413);
  const text=await request.text();if(new TextEncoder().encode(text).length>max)throw providerError('Vision request is too large.',413);
  let input;try{input=JSON.parse(text);}catch{throw providerError('Invalid JSON.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw providerError('A Vision request object is required.');
  return input;
}
export async function handleVision(request,env,fetcher=fetch,clock=()=>new Date().toISOString()){
  try{
    const owner=authorize(request),url=new URL(request.url),action=url.pathname.split('/').pop(),db=env.DB,now=clock(),limits=visionLimits(env),bridge=visionConfiguration(env);
    const connection=await psaConnection(db,owner,env),identification=!!env.OPENAI_API_KEY&&!!db,psa=connection.configured;
    if(action==='status'&&request.method==='GET')return json({configured:identification,identification,psa,psaConnection:connection,market:!!bridge,mode:'hosted',model:MODEL,missing:[...(!env.OPENAI_API_KEY?['OPENAI_API_KEY']:[]),...(!psa?['PSA_API_TOKEN']:[])],usage:db?await usage(db,owner,now,limits):null,message:identification?'Hosted recognition configured. Check the card after every scan.':'AI scanning is waiting for the OpenAI connection. Manual review and inventory matching are available.',psaMessage:psa?(connection.verifiedAt?'PSA connected. Certificate check passed when saved.':'PSA lookup configured.'):'Public PSA certificate lookup is available in Review. No API connection is needed.'});
    if(action==='recent'&&request.method==='GET'){
      if(!db)throw providerError('Scan history storage is unavailable.',503);
      const rows=await db.prepare("SELECT id,status,result,error,created_at FROM vision_operations WHERE owner_id=? AND kind='scan' ORDER BY created_at DESC LIMIT 20").bind(owner).all();
      return json({scans:rows.results.map(r=>({id:r.id,status:r.status,createdAt:r.created_at,error:r.error,...(r.result?{result:JSON.parse(r.result)}:{})}))});
    }
    if(request.method!=='POST'||!['scan','market','psa','psa-connect','psa-disconnect'].includes(action))throw providerError('Unsupported Vision operation.',405);
    const input=await inputOf(request,action.startsWith('psa-')?16384:9000000);
    if(action==='psa-disconnect'){
      if(!db)throw providerError('Hosted credential storage is unavailable.',503);
      await disconnectPSA(db,owner,now);return json({connected:false,message:'PSA disconnected. Your saved token was removed.'});
    }
    if(action==='psa-connect'){
      if(!db||!connection.canConnect)throw providerError('Secure PSA connection setup is unavailable. Contact the site owner.',503);
      if(!operationIdValid(input.requestId))throw providerError('A valid connection request ID is required.');
      const token=validatePSAToken(input.token);
      if(typeof input.cert!=='string'||!/^\d{5,12}$/.test(input.cert))throw providerError('Enter one real PSA certificate number to test your connection.');
      const hash=await hashText(JSON.stringify(['psa-connect',token,input.cert]));
      const existing=await reserve(db,owner,input.requestId,'psa',hash,now,limits);
      if(existing.cached)return json({...existing.result,replayed:true,usage:await usage(db,owner,now,limits)});
      try{
        const response=await fetcher('https://api.psacard.com/publicapi/cert/GetByCertNumber/'+input.cert,{method:'GET',headers:{Authorization:`bearer ${token}`,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw await psaFailure(response);
        const record=normalizePSA(await providerJSON(response),input.cert);
        if(!record.recordFound)throw providerError('PSA did not return that exact certificate. Check the number and token. Your existing connection is unchanged.',422);
        const encrypted=await sealPSAToken(env,owner,token),result={...record,fetchedAt:now,cached:false,connected:true,verifiedAt:now};
        await db.batch([
          db.prepare('INSERT INTO vision_credentials(owner_id,encrypted_token,disabled,verified_at,updated_at) VALUES(?,?,0,?,?) ON CONFLICT(owner_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,disabled=0,verified_at=excluded.verified_at,updated_at=excluded.updated_at').bind(owner,encrypted,now,now),
          db.prepare('INSERT INTO vision_psa_cache(owner_id,cert,result,fetched_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,cert) DO UPDATE SET result=excluded.result,fetched_at=excluded.fetched_at').bind(owner,input.cert,JSON.stringify({...record,fetchedAt:now,cached:false}),now),
          db.prepare("UPDATE vision_operations SET status='complete',result=?,cost_micros=0,updated_at=? WHERE owner_id=? AND id=? AND status='pending'").bind(JSON.stringify(result),now,owner,input.requestId)
        ]);
        return json({...result,usage:await usage(db,owner,now,limits)});
      }catch(cause){
        const error=cause.status?cause:providerError('PSA connection could not be checked. Refresh connection status before retrying.',502);
        await fail(db,owner,input.requestId,error,{costMicros:0},clock());throw error;
      }
    }
    if(action==='market'){
      if(!bridge)throw providerError('Live market lookup is not connected. It is separate from hosted identification.',503);
      const response=await fetcher(bridge.url+'/find-comps',{method:'POST',headers:{Authorization:`Bearer ${bridge.token}`,'Content-Type':'application/json'},body:JSON.stringify(normalizeCard(input.card)),redirect:'manual',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw providerFailure(response,'Market provider');const result=await providerJSON(response);if(result.success===false)throw providerError('Market lookup did not return results.',502);
      return json({...result,soldData:false,source:'eBay active listings'});
    }
    if(!db)throw providerError('Hosted scan storage is unavailable.',503);
    if(!operationIdValid(input.requestId))throw providerError('A valid scan or lookup request ID is required.');
    if(action==='scan'&&!identification)throw providerError('Connect OpenAI before identifying photos.',503);
    if(action==='psa'&&!psa)throw providerError('Connect the PSA API token before certificate lookup.',503);
    let hash;
    if(action==='scan'){validateImage(input.front);validateImage(input.back);hash=await hashText(JSON.stringify([input.front.mime,input.front.data,input.back.mime,input.back.data]));}
    else {
      if(typeof input.cert!=='string'||!/^\d{5,12}$/.test(input.cert))throw providerError('Enter the numeric PSA certificate from the slab.');hash=await hashText(input.cert);
      const cache=await db.prepare('SELECT result,fetched_at FROM vision_psa_cache WHERE owner_id=? AND cert=?').bind(owner,input.cert).first();
      if(cache&&Date.parse(now)-Date.parse(cache.fetched_at)<7*86400000)return json({...JSON.parse(cache.result),cached:true,usage:await usage(db,owner,now,limits)});
    }
    const existing=await reserve(db,owner,input.requestId,action,hash,now,limits);
    if(existing.cached)return json({...existing.result,replayed:true,usage:await usage(db,owner,now,limits)});
    let metrics=null;
    try{
      let result;
      if(action==='scan'){
        const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(scanBody(input.front,input.back)),redirect:'manual',signal:AbortSignal.timeout(60000)});
        if(!response.ok){if([400,401,403,404,413,422,429].includes(response.status))metrics={costMicros:0};throw providerFailure(response,'OpenAI');}
        const raw=await providerJSON(response);metrics=responseUsage(raw.usage);const card=parseIdentification(raw);
        result={success:true,scanId:input.requestId,identifiedAt:now,provider:'OpenAI',model:MODEL,card,usageEstimate:metrics,photoHash:hash};
      }else{
        metrics={costMicros:0};
        const token=await readPSAToken(db,owner,env);
        if(!token)throw providerError('Reconnect PSA before certificate lookup.',503);
        const response=await fetcher('https://api.psacard.com/publicapi/cert/GetByCertNumber/'+input.cert,{method:'GET',headers:{Authorization:`bearer ${token}`,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw await psaFailure(response);
        result={...normalizePSA(await providerJSON(response),input.cert),fetchedAt:now,cached:false};
        if(result.recordFound)await db.prepare('INSERT INTO vision_psa_cache(owner_id,cert,result,fetched_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,cert) DO UPDATE SET result=excluded.result,fetched_at=excluded.fetched_at').bind(owner,input.cert,JSON.stringify(result),now).run();
      }
      await finish(db,owner,input.requestId,result,metrics,clock());
      return json({...result,usage:await usage(db,owner,now,limits)});
    }catch(cause){
      const error=cause.status?cause:providerError('Provider request failed or timed out. Check recent scans before retrying; a charge may still have occurred.',502);
      await fail(db,owner,input.requestId,error,metrics,clock());throw error;
    }
  }catch(error){return json({error:error.status?error.message:'Vision is temporarily unavailable. No inventory was changed.'},error.status??503);}
}
