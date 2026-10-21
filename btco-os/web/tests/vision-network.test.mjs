import test from 'node:test';
import assert from 'node:assert/strict';
import {createPSANetworkCheck,PSA_PUBLIC_DOCS} from '../server/vision-network.mjs';
import {psaFailure} from '../server/vision-provider.mjs';

test('hosted PSA diagnosis requests only fixed public docs and exposes no provider content or credentials',async()=>{
  const check=createPSANetworkCheck(async(url,options)=>{
    assert.equal(url,PSA_PUBLIC_DOCS);assert.equal(options.redirect,'manual');assert.deepEqual(options.headers,{Accept:'text/html'});assert.equal(options.body,undefined);
    return new Response('private upstream content',{status:403,headers:{'cf-mitigated':'challenge','cf-ray':'a491ac4daace7678-SJC','set-cookie':'secret-cookie','www-authenticate':'secret-token',location:'https://untrusted.test/?secret=token'}});
  });
  const result=await check();assert.equal(result.category,'security-challenge');assert.equal(result.status,403);assert.equal(result.credentialTested,false);assert.equal(result.cloudflareRay,'a491ac4daace7678-SJC');assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('private upstream'));
});
test('PSA diagnosis distinguishes denied access from an explicit security challenge and rejects unsafe header values',async()=>{
  const denied=await createPSANetworkCheck(async()=>new Response(null,{status:403,headers:{'cf-ray':'secret-content'}}))();assert.equal(denied.category,'access-denied');assert.equal(denied.cloudflareChallenge,false);assert.equal(denied.cloudflareRay,null);
  const reachable=await createPSANetworkCheck(async()=>new Response('public docs'))();assert.equal(reachable.category,'reachable');assert.equal(reachable.credentialTested,false);
  const redirect=await createPSANetworkCheck(async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.test'}}))();assert.equal(redirect.category,'redirect');
  const network=await createPSANetworkCheck(async()=>{throw Error('private connection details');})();assert.equal(network.category,'network-error');assert.ok(!JSON.stringify(network).includes('private connection'));
});
test('PSA diagnosis coalesces concurrent requests and caches results for five minutes',async()=>{
  let now=0,calls=0,release;const gate=new Promise(r=>release=r);
  const check=createPSANetworkCheck(async()=>{calls++;await gate;return new Response('docs');},()=>now);
  const first=check(),second=check();release();assert.deepEqual(await first,await second);await check();assert.equal(calls,1);
  now=300000;await check();assert.equal(calls,2);
});
test('a provider security challenge is never reported as an expired token',async()=>{
  const error=await psaFailure(new Response('secret-token',{status:403,headers:{'cf-mitigated':'challenge'}}));assert.equal(error.status,502);assert.match(error.message,/security service challenged/);assert.ok(!error.message.includes('secret-token'));assert.ok(!error.message.includes('fresh access token'));
});
