import {env} from 'cloudflare:workers';
import {handleInventorySync} from '@/server/inventory-sync.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handleInventorySync(request,env);}
export async function POST(request:Request){return handleInventorySync(request,env);}
