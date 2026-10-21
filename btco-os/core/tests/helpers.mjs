import {createApp} from '../server.mjs';
import {openStore} from '../store.mjs';
import {digest} from '../auth.mjs';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
export async function harness({sqlitePath=':memory:',databaseUrl,migrate=true,accessMode='private',objectStore=null,assessor=null,workerAutoStart=false}={}){
 const store=await openStore({sqlitePath,allowSqlite:true,databaseUrl,migrate});
 const app=await createApp({store,origin:'http://127.0.0.1',allowLocal:true,setupTokenHash:digest('synthetic-setup-code'),accessMode,objectStore,assessor,workerAutoStart});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url='http://127.0.0.1:'+app.server.address().port;
 let cookie='',csrf='';
 const request=async(path,{method='GET',data,headers={},raw,auth=true}={})=>{
  const r=await fetch(url+path,{method,headers:{Origin:'http://127.0.0.1',...(auth?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:raw??(data?JSON.stringify(data):undefined)});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}if(body.csrf)csrf=body.csrf;return {status:r.status,body,headers:r.headers,text};
 };
 return {store,app,url,request,getCookie:()=>cookie,setup:()=>request('/api/setup',{method:'POST',data:{email:'owner@example.test',password:'synthetic-password-123',setupCode:'synthetic-setup-code'}}),
  save:async(path,data,extra={})=>{const ws=(await request('/api/workspace')).body.state;return request(path,{method:'POST',data:{expectedRevision:ws.revision,operationId:randomUUID(),data,...extra}});},
  close:async()=>{await app.preparation.stop();await app.mirror.stop();await new Promise(resolve=>app.server.close(resolve));await store.close();}};
}

