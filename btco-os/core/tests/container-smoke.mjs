const origin='http://127.0.0.1:3000';let ready=false;
for(let n=0;n<20;n++){
 try{const response=await fetch(origin+'/healthz');if(response.ok&&(await response.json()).product==='BTCore'){ready=true;break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,250));
}
if(!ready)throw Error('Packaged runtime failed readiness.');
if((await fetch(origin+'/api/workspace')).status!==401)throw Error('Packaged runtime exposed inventory without authentication.');
if(!(await (await fetch(origin)).text()).includes('BTCore'))throw Error('Packaged runtime did not serve the app.');
console.log('Non-root Docker runtime, readiness, app shell and private API verified.');
