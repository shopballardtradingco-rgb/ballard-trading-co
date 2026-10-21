import {readState,commitManifest} from './vault-api.mjs';
import {packState} from '../domain/sync-pack.mjs';
import {validateListingPages,refreshFromListings} from '../domain/ebay-api-refresh.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
// Dedicated service operation behind the confirmed owner-private Sites boundary.
// Dispatch authenticates Site service access; this does not impersonate a visitor.
// The fixed server configuration selects the only authorized workspace and seller.
export async function handleInventorySync(request,env){
  try{
    const owner=env.BTCO_INVENTORY_OWNER_ID,seller=env.BTCO_EBAY_SELLER,sellerId=env.BTCO_EBAY_SELLER_ID;
    if(!env.DB||!owner||!seller||!sellerId)fail('Daily inventory updates are not configured.',503);
    const visitor=request.headers.get('oai-authenticated-user-id');
    if(visitor&&visitor!==owner)fail('This workspace is not authorized for your identity.',403);
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)fail('Cross-origin inventory updates are not allowed.',403);
    const workspace=await env.DB.prepare('SELECT revision,manifest,updated_at FROM vault_workspaces WHERE owner_id=?').bind(owner).first();
    if(!workspace?.manifest)fail('The configured workspace must already exist.',409);
    const state=await readState(env.DB,owner,JSON.parse(workspace.manifest));
    if(request.method==='GET')return json({configured:true,seller,revision:workspace.revision,updatedAt:workspace.updated_at,itemCount:state.items.length,refresh:state.ebayRefresh??null});
    if(request.method!=='POST')fail('Use GET or POST.',405);
    if(!(request.headers.get('content-type')??'').startsWith('application/json'))fail('JSON is required.',415);
    if(Number(request.headers.get('content-length'))>12000000)fail('Snapshot is too large.',413);
    const body=await request.text();if(new TextEncoder().encode(body).length>12000000)fail('Snapshot is too large.',413);
    const input=JSON.parse(body);
    if(!['preview','apply'].includes(input.action))fail('Choose preview or apply.');
    if(Object.keys(input).some(k=>!['action','pages','expectedRevision','checksum'].includes(k)))fail('Unsupported update fields. Workspace identity cannot be supplied.');
    const snapshot=await validateListingPages(input.pages,{seller,sellerId});
    const plan=refreshFromListings(state,snapshot),receipt={revision:workspace.revision,checksum:snapshot.checksum,observedAt:snapshot.observedAt,summary:plan.summary,replayed:plan.replayed};
    if(input.action==='preview')return json({...receipt,blocked:plan.next.ebayRefresh?.blocked??[]});
    if(input.checksum!==snapshot.checksum)fail('Snapshot changed after preview.',409);
    if(plan.replayed)return json({...receipt,saved:true});
    if(input.expectedRevision!==workspace.revision)fail('Inventory changed after preview. Preview again before applying.',409);
    const packed=await packState(plan.next),now=new Date().toISOString();
    // Chunk staging is harmless until the revision-checked manifest transaction succeeds.
    for(let index=0;index<packed.chunks.length;index+=20)await env.DB.batch(packed.chunks.slice(index,index+20).map(c=>env.DB.prepare('INSERT INTO vault_chunks(owner_id,hash,body,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,hash) DO UPDATE SET created_at=excluded.created_at').bind(owner,c.hash,c.body,now)));
    const saved=await commitManifest(env.DB,owner,{expectedRevision:workspace.revision,manifest:packed.manifest,operationId:'ebay-api-'+snapshot.checksum});
    return json({...receipt,saved:true,revision:saved.revision,updatedAt:saved.updatedAt});
  }catch(error){return json({error:error.status?error.message:'Inventory refresh rejected: '+error.message},error.status??400);}
}
