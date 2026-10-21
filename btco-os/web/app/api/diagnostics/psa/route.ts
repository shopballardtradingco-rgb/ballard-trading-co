import {createPSANetworkCheck} from '@/server/vision-network.mjs';
export const dynamic='force-dynamic';
const check=createPSANetworkCheck();

// The owner-private Sites boundary permits signed-in owner or Sites service
// access. This isolated check exposes no user data and uses no provider secrets.
// Keep the existing identity requirements on all Vision/Vault record routes.
export async function GET(){
  return Response.json(await check(),{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
