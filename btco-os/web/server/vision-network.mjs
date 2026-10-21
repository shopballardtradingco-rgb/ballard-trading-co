export const PSA_PUBLIC_DOCS='https://api.psacard.com/publicapi/swagger/ui/index';

// This checks public documentation only: no account, token, certificate lookup,
// environment binding or database is used. Never accept a caller-selected URL.
export function createPSANetworkCheck(fetcher=fetch,clock=Date.now){
  let cached=null,expires=0,pending=null;
  return async function check(){
    if(cached&&clock()<expires)return cached;
    if(pending)return pending;
    pending=(async()=>{
      const checkedAt=new Date(clock()).toISOString();
      let result;
      try{
        const response=await fetcher(PSA_PUBLIC_DOCS,{method:'GET',headers:{Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(10000)});
        const challenge=response.headers.get('cf-mitigated')==='challenge';
        const ray=response.headers.get('cf-ray')??'';
        result={checkedAt,endpoint:PSA_PUBLIC_DOCS,status:response.status,category:challenge?'security-challenge':response.status===403?'access-denied':response.ok?'reachable':response.status>=300&&response.status<400?'redirect':'provider-error',cloudflareChallenge:challenge,cloudflareRay:/^[a-f0-9]{16,32}-[A-Z]{3}$/.test(ray)?ray:null,credentialTested:false};
        await response.body?.cancel().catch(()=>{});
      }catch{
        result={checkedAt,endpoint:PSA_PUBLIC_DOCS,status:null,category:'network-error',cloudflareChallenge:false,cloudflareRay:null,credentialTested:false};
      }
      cached=result;expires=clock()+300000;return result;
    })();
    try{return await pending;}finally{pending=null;}
  };
}
