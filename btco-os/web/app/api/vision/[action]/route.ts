import {env} from 'cloudflare:workers';
import {handleVision} from '@/server/vision-api.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handleVision(request,env);}
export async function POST(request:Request){return handleVision(request,env);}
