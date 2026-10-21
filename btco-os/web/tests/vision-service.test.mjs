import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';

test('recovered Node service boots with locked dependencies and protects real HTTP endpoints',async()=>{
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  // Fake provider key allows SDK initialization. This test never calls a provider.
  const child=spawn(process.execPath,['server.cjs'],{cwd:new URL('../services/vision-node/',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),VISION_SERVICE_TOKEN:'test-http-access',OPENAI_API_KEY:'test-no-provider-calls',PSA_API_TOKEN:'',VISION_INVENTORY_CSV:'/nonexistent/test-only-inventory.csv',PSA_CACHE_FILE:'/nonexistent/test-only-psa.json'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  try{
    const origin=`http://127.0.0.1:${port}`;let response;
    for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('Service exited before startup: '+output);try{response=await fetch(origin);break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
    assert.ok(response,'Service did not start: '+output);assert.equal(response.status,401);
    assert.equal((await fetch(origin,{headers:{Authorization:'Bearer test-http-access'}})).status,200);
    const result=await fetch(origin+'/check-inventory',{method:'POST',headers:{Authorization:'Bearer test-http-access','Content-Type':'application/json'},body:JSON.stringify({player:'No fixture record'})});assert.equal(result.status,200);assert.equal((await result.json()).matches.length,0);
  }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
});
