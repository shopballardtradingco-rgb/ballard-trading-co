import {editListingRows} from './listing-editor.mjs';
import {ebaySnapshot,exportSnapshot,applySnapshot,mirrorReport} from './mirror.mjs';
import {createMirrorWorker} from './mirror-worker.mjs';
import {collxCapability,collxRows,collxCSV,saveCollxPrice,saveCollxObservation} from './collx.mjs';
import {createConnector} from './connector.mjs';
import {createEbayPublication} from './ebay-publication.mjs';
import {listingDefaultCandidates,applyListingDefaults} from './listing-defaults.mjs';
import {publicationCapability,publicationBatches,prepareListingSelection,stagePublicationBatch,cancelPublicationBatch,startListingFlow} from './publication.mjs';
import sharp from 'sharp';
import {apiKeyFromEnv,createCardAssessor} from './ai-provider.mjs';
import {createPreparationWorker,enqueuePreparation,approveListings,updateListingDetails,isListingApproved,needsPreparation} from './preparation.mjs';
import {cdpCSV} from './cdp.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {openStore} from './store.mjs';
import {createOpenAccess,OPEN_OWNER_PASSWORD} from './open-access.mjs';
import {digest,safeEqual,passwordHash,passwordMatches,sessionCookie,sessionToken,sessionFor,newSession,checkLoginLimit} from './auth.mjs';
import {fail,hash,requireRevision,draftInput,reviewReceivedPrice,receiveDraft,editableDraft,archiveDraft,swapDraftPhotos,editInventory,saveSale,reverseSale,validateWorkspace,event,summary,inventoryCSV,salesCSV} from './domain.mjs';
import {inspectPhoto,MAX_PHOTO,MAX_PHOTO_STORAGE,DATABASE_PHOTO_STORAGE} from './photos.mjs';

import {objectStorageFromEnv,photoBytes,storePhoto} from './object-storage.mjs';

const assets=new Map([['/listing-desk-policy.mjs',['listing-desk-policy.mjs','text/javascript']],['/listing-controls.mjs',['listing-controls.mjs','text/javascript']],['/ebay-settings.mjs',['ebay-settings.mjs','text/javascript']],['/',['index.html','text/html; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript']],['/collx-ui.mjs',['collx-ui.mjs','text/javascript']],['/mirror-ui.mjs',['mirror-ui.mjs','text/javascript']],['/batch.mjs',['batch.mjs','text/javascript']],['/preparation-policy.mjs',['preparation-policy.mjs','text/javascript']],['/photo-policy.mjs',['photo-policy.mjs','text/javascript']],['/pricing.mjs',['pricing.mjs','text/javascript']],['/price-review.mjs',['price-review.mjs','text/javascript']],['/styles.css',['styles.css','text/css']],['/manifest.webmanifest',['manifest.webmanifest','application/manifest+json']],['/icon.svg',['icon.svg','image/svg+xml']]]);
const safeHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Permissions-Policy':'camera=(self), microphone=(), geolocation=()'};
const reply=(res,status,body,extra={})=>{res.writeHead(status,{'Content-Type':'application/json',...safeHeaders,...extra});res.end(JSON.stringify(body));};
async function bytes(req,max){
 if(Number(req.headers['content-length'])>max)fail('Upload is too large.',413);
 let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>max)fail('Upload is too large.',413);chunks.push(b);}return Buffer.concat(chunks);
}
async function body(req,max=1024*1024){
 if(!(req.headers['content-type']??'').startsWith('application/json'))fail('JSON is required.',415);
 try{return JSON.parse((await bytes(req,max)).toString('utf8'));}catch(e){if(e.status)throw e;fail('Invalid JSON.');}
}
const publicPhoto=p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='preview'));
const safeFilename=s=>String(s).replace(/[^A-Za-z0-9._-]/g,'_');
export async function createApp({store,origin,setupTokenHash,allowLocal=false,accessMode='private',objectStore=null,assessor=null,monthlyBudgetMicros=10000000,workerAutoStart=true,connector=null}={}){
 if(!['private','open'].includes(accessMode))throw Error('BTCORE_ACCESS_MODE must be private or open.');
 const photoLimit=objectStore?MAX_PHOTO_STORAGE:DATABASE_PHOTO_STORAGE;
 const configured=new URL(origin);
 if(configured.origin!==origin)throw Error('BTCORE_ORIGIN must be an exact origin without a trailing slash or path.');
 if(configured.protocol!=='https:'&&!(allowLocal&&['127.0.0.1','localhost'].includes(configured.hostname)))throw Error('HTTPS is required outside explicit loopback development.');
 if(setupTokenHash&&!/^[a-f0-9]{64}$/.test(setupTokenHash))throw Error('Setup token must be stored as a SHA-256 digest.');
 const secure=configured.protocol==='https:';
 const openAccess=accessMode==='open'?await createOpenAccess(store,secure):null;
 const readSession=req=>openAccess?openAccess.sessionFor(req):sessionFor(store,req);
 const mutate=async(session,expected,operationId,request,fn,{cardFingerprints=false}={})=>{
  requireRevision(expected);if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId))fail('A unique operation ID is required.');
  return store.transaction(async q=>{
   const row=(await q('SELECT revision,body FROM core_workspace WHERE id=1'+store.lockSuffix))[0];
   const prev=(await q('SELECT request_hash,response FROM core_operations WHERE owner_id=? AND id=?',[session.owner_id,operationId]))[0],fingerprint=hash(request);
   if(prev){if(prev.request_hash!==fingerprint)fail('This operation ID was already used for a different change.',409);return {...JSON.parse(prev.response),replayed:true};}
   // Card mutations validate selected fingerprints and current stock/batch locks inside this transaction.
   // Unrelated background changes must not block them. Future revisions and all other writes remain strict.
   if(expected>row.revision||row.revision!==expected&&!cardFingerprints)fail('The workspace changed since this page loaded. Your edits are still open; use Refresh in Core before retrying.',409);
   const state=JSON.parse(row.body),result=await fn(state,q);state.revision=row.revision+1;state.inventory.revision=state.revision;validateWorkspace(state);
   const encoded=JSON.stringify(state);if(Buffer.byteLength(encoded)>12*1024*1024)fail('Workspace capacity reached. Export a backup before adding more records.',413);
   await q('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[state.revision,encoded]);
   await q('INSERT INTO core_snapshots(revision,body,created_at) VALUES(?,?,?)',[state.revision,encoded,new Date().toISOString()]);
   await q('DELETE FROM core_snapshots WHERE revision<?',[Math.max(0,state.revision-19)]);
   const response={saved:true,revision:state.revision,...result};
   await q('INSERT INTO core_operations(owner_id,id,request_hash,response,created_at) VALUES(?,?,?,?,?)',[session.owner_id,operationId,fingerprint,JSON.stringify(response),new Date().toISOString()]);return response;
  });
 };
 const commit=async fn=>store.transaction(async q=>{
  const row=(await q('SELECT revision,body FROM core_workspace WHERE id=1'+store.lockSuffix))[0],state=JSON.parse(row.body),result=await fn(state,q);
  if(!result?.changed)return result;
  state.revision=row.revision+1;state.inventory.revision=state.revision;validateWorkspace(state);
  const encoded=JSON.stringify(state);if(Buffer.byteLength(encoded)>12*1024*1024)fail('Workspace capacity reached.',413);
  await q('UPDATE core_workspace SET revision=?,body=? WHERE id=1',[state.revision,encoded]);
  await q('INSERT INTO core_snapshots(revision,body,created_at) VALUES(?,?,?)',[state.revision,encoded,new Date().toISOString()]);
  await q('DELETE FROM core_snapshots WHERE revision<?',[Math.max(0,state.revision-19)]);return result;
 });
 let mediaTail=Promise.resolve();const mediaCache=new Map();
 connector?.bindMirrorStorage?.({read:async()=>(await store.query('SELECT encrypted_grant FROM core_mirror_connection WHERE id=1 AND enabled_until>?',[Date.now()]))[0]?.encrypted_grant,write:async(old,encrypted_grant)=>{await store.query('UPDATE core_mirror_connection SET encrypted_grant=? WHERE id=1 AND encrypted_grant=? AND enabled_until>?',[encrypted_grant,old,Date.now()]);}});
 const mirror=createMirrorWorker({store,connector,commit,autoStart:workerAutoStart});
 const ebayPublication=createEbayPublication({store,objectStore,commit});
 const preparation=createPreparationWorker({store,objectStore,assessor,monthlyBudgetMicros,commit});
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin),path=url.pathname;
   // Ignore incoming identity/proxy headers. Access follows the configured mode.
   if(req.method!=='GET'&&req.method!=='HEAD'){
    if(req.headers.origin!==origin)fail('Open BTCore directly to make this change.',403);
    if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'&&req.headers['sec-fetch-site']!=='none')fail('Cross-site changes are not allowed.',403);
   }
   if(path==='/healthz'&&req.method==='GET'){await store.query('SELECT revision FROM core_workspace WHERE id=1');return reply(res,200,{status:'ready',product:'BTCore',version:'0.7.1'});}
   if(req.method==='GET'&&assets.has(path)){
    const [name,type]=assets.get(path);const data=await readFile(new URL('./public/'+name,import.meta.url));res.writeHead(200,{'Content-Type':type,...safeHeaders});return res.end(data);
   }
   if(path==='/api/session'&&req.method==='GET'){
    if(openAccess){
     const current=openAccess.sessionFor(req),issued=current?null:openAccess.issue(),session=current??issued.session;
     return reply(res,200,{authenticated:true,loginRequired:false,csrf:session.csrf,storage:store.kind,environment:'development',version:'0.7.1'},issued?{'Set-Cookie':issued.cookie}:{});
    }
    const session=await sessionFor(store,req);if(session)return reply(res,200,{authenticated:true,email:session.email,csrf:session.csrf,storage:store.kind,environment:'development',version:'0.7.1'});
    const owners=await store.query('SELECT id,password_hash FROM core_owner');return reply(res,200,{authenticated:false,setupRequired:!owners.length||owners[0].password_hash===OPEN_OWNER_PASSWORD,setupEnabled:Boolean(setupTokenHash)});
   }
   if(openAccess&&['/api/setup','/api/login','/api/logout','/api/password'].includes(path))fail('Sign-in is turned off for this workspace.',409);
   if(path==='/api/setup'&&req.method==='POST'){
    const input=await body(req,10000);await checkLoginLimit(store,'setup');
    if(!setupTokenHash||!safeEqual(digest(String(input.setupCode??'')),setupTokenHash))fail('Setup code is incorrect.',401);
    if(typeof input.email!=='string'||input.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))fail('Enter a valid email address.');
    const encoded=await passwordHash(input.password);
    const auth=await store.transaction(async q=>{
     await q('SELECT revision FROM core_workspace WHERE id=1'+store.lockSuffix);
     const existing=(await q('SELECT id,password_hash FROM core_owner'))[0];
     if(existing&&existing.password_hash!==OPEN_OWNER_PASSWORD)fail('Owner account is already set up.',409);
     const id=existing?.id??randomUUID();
     if(existing)await q('UPDATE core_owner SET email=?,password_hash=? WHERE id=?',[input.email.trim().toLowerCase(),encoded,id]);
     else await q('INSERT INTO core_owner(id,email,password_hash,created_at) VALUES(?,?,?,?)',[id,input.email.trim().toLowerCase(),encoded,new Date().toISOString()]);
     return newSession(q,id);
    });
    return reply(res,201,{authenticated:true,csrf:auth.csrf},{'Set-Cookie':sessionCookie(auth.token,secure)});
   }
   if(path==='/api/login'&&req.method==='POST'){
    const input=await body(req,10000);await checkLoginLimit(store,'owner-login');
    const owner=(await store.query('SELECT id,email,password_hash FROM core_owner'))[0];
    // Use a real scrypt workload even for an unknown email.
    const matches=owner?await passwordMatches(input.password,owner.password_hash):false;
    if(!owner||!matches||String(input.email??'').trim().toLowerCase()!==owner.email)fail('Email or password is incorrect.',401);
    const auth=await store.transaction(async q=>{await q('DELETE FROM core_login_limits WHERE key=?',['owner-login']);return newSession(q,owner.id);});
    return reply(res,200,{authenticated:true,csrf:auth.csrf},{'Set-Cookie':sessionCookie(auth.token,secure)});
   }
   const sharedPhoto=path.match(/^\/media\/cdp\/([a-f0-9-]{36})\/([a-f0-9]{48})\.jpg$/);
   if(sharedPhoto&&req.method==='GET'){
    const state=await store.workspace(),d=state.drafts.find(d=>d.listingReview?.photoToken===sharedPhoto[2]&&d.photos.some(p=>p.id===sharedPhoto[1]));
    if(!d||!isListingApproved(d))fail('Export image is not available. Review and export the card again.',404);
    const makeImage=async()=>{
     if(mediaCache.has(sharedPhoto[1]))return mediaCache.get(sharedPhoto[1]);
     const p=(await store.query('SELECT * FROM core_photos WHERE id=?',[sharedPhoto[1]]))[0];if(!p)fail('Photo not found.',404);
     const bytes=await sharp(await photoBytes(p,objectStore),{limitInputPixels:40000000}).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:94}).toBuffer();
     mediaCache.set(p.id,bytes);while(mediaCache.size>8)mediaCache.delete(mediaCache.keys().next().value);return bytes;
    };
    const work=mediaTail.then(makeImage);mediaTail=work.catch(()=>{});const image=await work;
    res.writeHead(200,{...safeHeaders,'Content-Type':'image/jpeg'});return res.end(image);
   }
   if(path==='/api/ebay/callback'&&req.method==='GET'){
    if(!connector)fail('eBay connection is not configured.',503);
    await connector.callback(req,res,url);res.writeHead(303,{...safeHeaders,Location:'/#publication'});return res.end();
   }
   if(!path.startsWith('/api/'))return reply(res,404,{error:'Page not found.'});
   const session=await readSession(req);if(!session)fail(openAccess?'Reload to open your workspace.':'Sign in to open your workspace.',401);
   if(req.method!=='GET'&&!safeEqual(req.headers['x-csrf-token']??'',session.csrf))fail('Your session changed. Reload and try again.',403);
   if(path==='/api/ebay/connect'&&req.method==='POST'){
    if(!connector)fail('eBay connection is not configured.',503);
    return reply(res,200,{url:await connector.begin(req,res)});
   }
   if(path==='/api/ebay/disconnect'&&req.method==='POST'){
    await mirror.disable();connector?.disconnect(res);return reply(res,200,{disconnected:true});
   }
   if(path==='/api/mirror'&&req.method==='GET')return reply(res,200,{...mirrorReport(await store.workspace()),sync:await mirror.status()});
   if(path==='/api/mirror/sync'&&req.method==='POST')return reply(res,200,await mirror.enable(req,res));
   if(path==='/api/mirror/stop'&&req.method==='POST'){await mirror.disable();return reply(res,200,{stopped:true});}
   if(path==='/api/mirror/import'&&req.method==='POST'){
    const input=await body(req,10*1024*1024),data=input.data;
    const snapshot=data?.source==='btconnect-ebay-baseline'?{...await ebaySnapshot(data),provenance:'owner-imported eBay capture'}:exportSnapshot(data);
    return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data},state=>applySnapshot(state,snapshot)));
   }
   if(path==='/api/mirror/export'&&req.method==='GET'){
    const state=await store.workspace();return reply(res,200,{schemaVersion:1,exportedAt:new Date().toISOString(),mirror:state.marketplaceMirror??null},{'Content-Disposition':'attachment; filename="BTCore-marketplace-mirror.json"'});
   }
   if(path==='/api/listing-defaults'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>applyListingDefaults(state,input.data?.entries),{cardFingerprints:true}));
   }
   if(path==='/api/listing-rows'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>editListingRows(state,input.data?.entries),{cardFingerprints:true}));
   }
   if(path==='/api/ebay/options'&&req.method==='GET'){
    if(!connector)fail('eBay connection is not configured.',503);
    const client=await connector.client(req,res),result=await client.call('get_card_listing_options',{category_id:url.searchParams.get('category')??'261328'}),saved=(await store.workspace()).ebayListingDefaults;return reply(res,200,{...result,defaults:saved?.seller===client.seller?saved:null});
   }
   const ebayAction=path.match(/^\/api\/ebay\/(configure|prepare|refresh|approve|publish)$/);
   if(ebayAction&&req.method==='POST'){
    if(!connector)fail('eBay connection is not configured.',503);
    const client=await connector.client(req,res),input=await body(req),data=input.data??input;
    const action=ebayAction[1];let result;
    if(action==='configure')result=await ebayPublication.configure(client,data.id,data.settings);
    if(action==='prepare')result=await ebayPublication.prepare(client,data.id,session.owner_id);
    if(action==='refresh')result=await ebayPublication.refresh(client,data.id);
    if(action==='approve'||action==='publish')result=await ebayPublication.publish(client,data.id,data.reviewFingerprint,action==='approve');
    return reply(res,200,result);
   }
   if(path==='/api/logout'&&req.method==='POST'){
    await store.query('DELETE FROM core_sessions WHERE token_hash=?',[digest(sessionToken(req))]);return reply(res,200,{signedOut:true},{'Set-Cookie':sessionCookie('',secure,0)});
   }
   if(path==='/api/password'&&req.method==='POST'){
    const input=await body(req,10000);await checkLoginLimit(store,'password-change');
    const owner=(await store.query('SELECT password_hash FROM core_owner WHERE id=?',[session.owner_id]))[0];
    if(!await passwordMatches(input.currentPassword,owner.password_hash))fail('Current password is incorrect.',401);
    const encoded=await passwordHash(input.newPassword);
    const auth=await store.transaction(async q=>{await q('UPDATE core_owner SET password_hash=? WHERE id=?',[encoded,session.owner_id]);await q('DELETE FROM core_sessions WHERE owner_id=?',[session.owner_id]);await q('DELETE FROM core_login_limits WHERE key=?',['password-change']);return newSession(q,session.owner_id);});
    return reply(res,200,{changed:true,csrf:auth.csrf},{'Set-Cookie':sessionCookie(auth.token,secure)});
   }
   if(path==='/api/workspace'&&req.method==='GET'){
    const state=await store.workspace();return reply(res,200,{state,listingDefaults:listingDefaultCandidates(state),collx:{capabilities:collxCapability,rows:collxRows(state)},publication:{...publicationCapability,enabled:Boolean(connector),connection:connector?.status(req)??{configured:false,connected:false},batches:publicationBatches(state)},preparationNeeded:state.drafts.filter(needsPreparation).map(d=>d.id),approvedListings:state.drafts.filter(isListingApproved).map(d=>d.id),summary:summary(state.inventory),capabilities:{manualIntake:true,marketplacePublishing:Boolean(connector),aiRecognition:Boolean(assessor),cdpExport:true},ai:{configured:Boolean(assessor),monthlyBudgetMicros,usage:state.aiUsage?.[new Date().toISOString().slice(0,7)]??{chargedMicros:0,attempts:0}},photoStorage:{usedBytes:Number((await store.query('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM core_photos WHERE owner_id=?',[session.owner_id]))[0].bytes),limitBytes:photoLimit,backend:objectStore?'object':'database'}});
   }
   if(['/api/collx/price','/api/collx/observation'].includes(path)&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>(path.endsWith('/price')?saveCollxPrice:saveCollxObservation)(state,input.data)));
   }
   if(path==='/api/export/collx.csv'&&req.method==='GET'){
    const state=await store.workspace();res.writeHead(200,{...safeHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="BTCore-CollX-records.csv"'});return res.end(collxCSV(state));
   }
   if(path==='/api/publication/selection'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>prepareListingSelection(state,input.data),{cardFingerprints:true}));
   }
   if(path==='/api/publication/start'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>startListingFlow(state,input.data)));
   }
   if(path==='/api/publication/batches'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>stagePublicationBatch(state,input.data?.entries)));
   }
   if(path==='/api/publication/cancel'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>cancelPublicationBatch(state,input.data?.id)));
   }
   if(path==='/api/preparation/start'&&req.method==='POST'){
    if(!assessor)fail('AI preparation is not configured yet.',503);
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>enqueuePreparation(state,input.data?.ids,{retry:input.data?.retry===true})));
   }
   if(path==='/api/preparation/approve'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>approveListings(state,input.data?.entries)));
   }
   if(path==='/api/preparation/details'&&req.method==='POST'){
    const input=await body(req);return reply(res,200,await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data},state=>updateListingDetails(state,input.data?.entries)));
   }
   if(path==='/api/export/cdp.csv'&&req.method==='GET'){
    const state=await store.workspace(),ids=url.searchParams.getAll('id');
    const drafts=ids.length?ids.map(id=>state.drafts.find(d=>d.id===id)):state.drafts.filter(isListingApproved);
    if(drafts.some(d=>!d)||new Set(drafts.map(d=>d.id)).size!==drafts.length)fail('Invalid export selection.');
    const csv=cdpCSV(drafts,origin);res.writeHead(200,{...safeHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="BTCore-CDP-import.csv"'});return res.end(csv);
   }
   const image=path.match(/^\/api\/photos\/([a-f0-9-]+)\/(original|preview)$/);
   if(image&&req.method==='GET'){
    const p=(await store.query('SELECT * FROM core_photos WHERE id=? AND owner_id=?',[image[1],session.owner_id]))[0];if(!p)fail('Photo not found.',404);
    const preview=image[2]==='preview',content=await photoBytes(p,objectStore,preview);res.writeHead(200,{...safeHeaders,'Content-Type':preview?'image/jpeg':p.media_type,'Content-Disposition':`${preview?'inline':'attachment'}; filename="${safeFilename(p.filename)}"`});return res.end(content);
   }
   if(path==='/api/export/inventory.csv'&&req.method==='GET'){const state=await store.workspace();res.writeHead(200,{...safeHeaders,'Content-Type':'text/csv','Content-Disposition':'attachment; filename="BTCore-inventory.csv"'});return res.end(inventoryCSV(state.inventory));}
   if(path==='/api/export/sales.csv'&&req.method==='GET'){const state=await store.workspace();res.writeHead(200,{...safeHeaders,'Content-Type':'text/csv','Content-Disposition':'attachment; filename="BTCore-sales.csv"'});return res.end(salesCSV(state.inventory));}
   if(path==='/api/backup'&&req.method==='GET'){
    // Capture the manifest under the same lock as mutations. Originals are immutable, so stream afterward.
    const capture=await store.transaction(async q=>{const row=(await q('SELECT body FROM core_workspace WHERE id=1'+store.lockSuffix))[0];const state=JSON.parse(row.body);return {state,photos:state.drafts.flatMap(d=>[...d.photos.map(p=>({...p,draftId:d.id,retired:false})),...(d.photoHistory??[]).map(p=>({...p,draftId:d.id,retired:true}))])};});
    res.writeHead(200,{...safeHeaders,'Content-Type':'application/x-ndjson','Content-Disposition':'attachment; filename="BTCore-backup.ndjson"'});
    const write=async data=>{if(!res.write(JSON.stringify(data)+'\n'))await once(res,'drain');};
    await write({type:'manifest',format:'btcore-backup-v2',createdAt:new Date().toISOString(),state:capture.state,photoCount:capture.photos.length});
    for(const ref of capture.photos){const p=(await store.query('SELECT * FROM core_photos WHERE id=? AND owner_id=?',[ref.id,session.owner_id]))[0];if(!p)throw Error('Backup photo missing');const original=await photoBytes(p,objectStore);if(hash(original)!==ref.sha256)throw Error('Backup photo integrity failed');await write({type:'photo',...ref,original:original.toString('base64')});}
    await write({type:'complete',revision:capture.state.revision,photoCount:capture.photos.length,stateSha256:hash(capture.state)});return res.end();
   }
   const draftMatch=path.match(/^\/api\/drafts(?:\/([a-f0-9-]+))?(?:\/(receive|photos|packet|swap-photos|archive|restore))?$/);
   if(draftMatch?.[2]==='packet'&&req.method==='GET'){
    const state=await store.workspace(),d=state.drafts.find(x=>x.id===draftMatch[1]);if(!d)fail('Intake not found.',404);
    return reply(res,200,{format:'btcore-listing-preparation-v1',publicationApproved:false,notice:'Preparation only. Marketplace-specific shipping, fees, condition, price and owner publication approval are still required.',draft:d},{'Content-Disposition':`attachment; filename="${safeFilename(d.sku)}-preparation.json"`});
   }
   if(draftMatch&&req.method==='POST'&&draftMatch[2]==='photos'){
    if(req.headers['content-type']!=='application/octet-stream')fail('Original binary image bytes are required.',415);
    const content=await bytes(req,MAX_PHOTO),meta=await inspectPhoto(content,{role:url.searchParams.get('role'),filename:url.searchParams.get('filename')}),pub=publicPhoto(meta);
    const revision=Number(req.headers['x-workspace-revision']);
    const replacement=url.searchParams.get('replace');
    const response=await mutate(session,revision,req.headers['idempotency-key'],{path,role:meta.role,filename:meta.filename,sha256:meta.sha256,replacement},async(state,q)=>{
     const d=editableDraft(state,draftMatch[1]);
     const previous=d.photos.find(p=>p.role===meta.role);
     if(replacement&&previous?.id!==replacement)fail('This original changed. Refresh the intake before replacing it.',409);
     if(previous){if(previous.sha256===meta.sha256)return {photo:previous};if(!replacement)fail('This side already has an original. Choose Replace photo to keep the previous one in history.',409);}
     if(previous&&(d.photoHistory?.length??0)>=50)fail('Photo correction history is full for this intake.');
     const used=Number((await q('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM core_photos WHERE owner_id=?',[session.owner_id]))[0].bytes);if(used+content.length>photoLimit)fail('Photo storage is full. Your saved photos are safe; increase storage before continuing.',413);
     if(previous)await q('UPDATE core_photos SET role=? WHERE id=?',['retired:'+previous.id,previous.id]);
     await storePhoto(q,session.owner_id,d.id,meta,content,objectStore);
     if(previous){(d.photoHistory??=[]).push({...previous,supersededAt:meta.createdAt,replacedBy:meta.id});d.photos=d.photos.filter(p=>p.id!==previous.id);}
     d.photos.push(pub);d.identityReviewed=false;d.conditionReviewed=false;d.updatedAt=meta.createdAt;event(state,previous?'core.photo-replaced':'core.photo-saved',d.id,{photoId:meta.id,role:meta.role,sha256:meta.sha256,...(previous?{previousPhotoId:previous.id}:{})});return {photo:pub};
    });return reply(res,201,response);
   }
   if(req.method==='POST'&&(draftMatch||/^\/api\/items(?:\/[a-f0-9-]+)?$/.test(path)||path==='/api/sales'||/^\/api\/sales\/[a-f0-9-]+\/reverse$/.test(path))){
    const input=await body(req),response=await mutate(session,input.expectedRevision,input.operationId,{path,data:input.data??{}},async(state,q)=>{
     if(draftMatch){
      const [,id,action]=draftMatch;if(action==='receive')return receiveDraft(state,id);if(action==='swap-photos')return swapDraftPhotos(state,id,q);if(action==='archive'||action==='restore')return archiveDraft(state,id,action==='restore');if(action)fail('Unknown intake operation.',404);
      const index=id?state.drafts.findIndex(d=>d.id===id):-1;if(id&&index<0)fail('Intake not found.',404);
      if(index>=0&&state.drafts[index].status==='received')return reviewReceivedPrice(state,id,input.data);
      const d=draftInput(input.data,index>=0?state.drafts[index]:undefined);if(index>=0)state.drafts[index]=d;else state.drafts.push(d);event(state,'core.draft-saved',d.id);return {draftId:d.id};
     }
     if(path.startsWith('/api/items'))return editInventory(state,input.data,path.split('/')[3]);
     if(path==='/api/sales')return saveSale(state,input.data);
     return reverseSale(state,path.split('/')[3]);
    });return reply(res,200,response);
   }
   return reply(res,404,{error:'Operation not found.'});
  }catch(e){
   if(res.headersSent){res.destroy();return;}
   // Never include database exceptions, query text, credentials or uploaded content in responses/logs.
   const status=e.status??500;reply(res,status,{error:e.status?e.message:'The request could not be completed. Try again.'});
  }
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;
 if(workerAutoStart)preparation.start();
 server.on('close',()=>{preparation.stop();mirror.stop();});
 return {server,mutate,preparation,mirror};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const allowLocal=process.env.BTCORE_LOCAL==='1';
 const origin=process.env.BTCORE_ORIGIN;
 if(!origin)throw Error('BTCORE_ORIGIN is required.');
 const store=await openStore({databaseUrl:allowLocal?process.env.DATABASE_URL:process.env.BTCORE_APP_DATABASE_URL,sqlitePath:process.env.BTCORE_SQLITE_PATH,allowSqlite:allowLocal,migrate:allowLocal});
 const objectStore=objectStorageFromEnv();if(objectStore)await objectStore.check();
 const connector=createConnector({origin,connectorOrigin:process.env.BTCONNECT_ORIGIN,key:process.env.BTCORE_CONNECTOR_KEY});
 const assessor=createCardAssessor({apiKey:apiKeyFromEnv()});
 const {server,preparation,mirror}=await createApp({store,origin,objectStore,assessor,connector,setupTokenHash:process.env.BTCORE_SETUP_TOKEN_HASH,allowLocal,accessMode:process.env.BTCORE_ACCESS_MODE??'private'});
 const port=Number(process.env.PORT??3000);server.listen(port,allowLocal?'127.0.0.1':'0.0.0.0',()=>console.log(`BTCore 0.7.1 listening on port ${port}; storage=${store.kind}`));
 const close=()=>server.close(async()=>{await preparation.stop();await mirror.stop();await store.close();process.exit(0);});process.on('SIGTERM',close);process.on('SIGINT',close);
}


