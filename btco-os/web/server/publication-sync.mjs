import {readState,commitManifest} from './vault-api.mjs';
import {packState,hashText} from '../domain/sync-pack.mjs';
import {verifyPublicationReceipt,reconcilePublication,publicationEvents,validatePhysicalConfirmation} from '../domain/publication-receipt.mjs';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
// Same owner-private Sites service boundary as inventory-sync. Caller cannot
// select a workspace, seller, signing key, inventory item or reconciliation plan.
export async function handlePublicationSync(request,env){
  try{
    const owner=env.BTCO_INVENTORY_OWNER_ID,sellerId=env.BTCO_EBAY_SELLER_ID,publicKeyB64=env.BTCO_RECEIPT_PUBLIC_KEY;
    if(!env.DB||!owner||!sellerId||!publicKeyB64)fail('Publication reconciliation is not configured.',503);
    const visitor=request.headers.get('oai-authenticated-user-id'),origin=request.headers.get('origin');
    if(visitor&&visitor!==owner)fail('This workspace is not authorized for your identity.',403);
    if(origin&&origin!==new URL(request.url).origin)fail('Cross-origin reconciliation is not allowed.',403);
    const workspace=await env.DB.prepare('SELECT revision,manifest,updated_at FROM vault_workspaces WHERE owner_id=?').bind(owner).first();
    if(!workspace?.manifest)fail('The configured workspace must already exist.',409);
    const state=await readState(env.DB,owner,JSON.parse(workspace.manifest));
    if(request.method==='GET'){
      const itemId=new URL(request.url).searchParams.get('item_id');
      if(itemId!==null&&!/^\d{9,15}$/.test(itemId))fail('Invalid eBay item ID.');
      const events=publicationEvents(state),event=itemId?events.find(e=>e.detail.receipt.item_id===itemId&&e.detail.receipt.seller_id===sellerId):null;
      return json({configured:true,revision:workspace.revision,updatedAt:workspace.updated_at,reconciledCount:events.length,...(itemId?{reconciliation:event?{checksum:event.detail.checksum,at:event.at,...event.detail.summary,current:state.items.filter(i=>i.id===event.entityId).map(i=>({itemId:i.id,physicalItemId:i.ebayPublication?.physicalItemId,ebayItemId:i.ebayPublication?.itemId,listingSku:i.ebayPublication?.listingSku,quantity:i.quantity,location:i.location}))[0]??null}:null}:{})});
    }
    if(request.method!=='POST')fail('Use GET or POST.',405);
    if(!(request.headers.get('content-type')??'').startsWith('application/json'))fail('JSON is required.',415);
    if(Number(request.headers.get('content-length'))>24000)fail('Receipt is too large.',413);
    let body='';const reader=request.body?.getReader();if(!reader)fail('Receipt body is required.');
    const parts=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>24000){await reader.cancel();fail('Receipt is too large.',413);}parts.push(part.value);}
    const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}body=new TextDecoder().decode(bytes);
    const input=JSON.parse(body);
    if(!input||!['preview','apply'].includes(input.action)||Object.keys(input).some(k=>!['action','envelope','expectedRevision','checksum','physical_confirmation'].includes(k)))fail('Choose preview or apply with a signed receipt only.');
    const confirmation=validatePhysicalConfirmation(input.physical_confirmation);
    const verified=await verifyPublicationReceipt(input.envelope,{publicKeyB64,sellerId}),plan=reconcilePublication(state,verified,{physicalConfirmation:confirmation??undefined});
    const checksum=confirmation?await hashText(JSON.stringify({receiptChecksum:verified.checksum,physicalConfirmation:confirmation})):verified.checksum;
    const result={revision:workspace.revision,checksum,receiptChecksum:verified.checksum,replayed:plan.replayed,summary:plan.summary};
    if(input.action==='preview')return json(result);
    if(input.checksum!==checksum)fail('Receipt or physical confirmation changed after preview.',409);
    if(plan.replayed)return json({...result,saved:true});
    if(input.expectedRevision!==workspace.revision)fail('Inventory changed after preview. Preview again.',409);
    const packed=await packState(plan.next),now=new Date().toISOString();
    for(let n=0;n<packed.chunks.length;n+=20)await env.DB.batch(packed.chunks.slice(n,n+20).map(c=>env.DB.prepare('INSERT INTO vault_chunks(owner_id,hash,body,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,hash) DO UPDATE SET created_at=excluded.created_at').bind(owner,c.hash,c.body,now)));
    const saved=await commitManifest(env.DB,owner,{expectedRevision:workspace.revision,manifest:packed.manifest,operationId:'ebay-pub-'+verified.checksum},{allowPublication:true});
    return json({...result,saved:true,revision:saved.revision,updatedAt:saved.updatedAt});
  }catch(error){return json({error:error.status?error.message:'Publication reconciliation rejected: '+error.message},error.status??400);}
}
