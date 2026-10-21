import {env} from 'cloudflare:workers';
import {handlePublicationSync} from '@/server/publication-sync.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handlePublicationSync(request,env);}
export async function POST(request:Request){return handlePublicationSync(request,env);}
