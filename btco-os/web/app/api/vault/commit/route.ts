import {env} from 'cloudflare:workers';
import {handleVault} from '@/server/vault-api.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handleVault(request,env.DB);}
export async function POST(request:Request){return handleVault(request,env.DB);}
