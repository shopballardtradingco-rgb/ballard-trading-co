// Obtain a fresh Sites service token at run time. Pass it only via hidden stdin.
// Run from any checkout of this Site; raw pages stay in task scratch, never Git.
import fs from 'node:fs/promises';
process.stdout.write('Ready for inventory workflow JSON on stdin (input is hidden).\n');
if(process.stdin.isTTY){process.stdin.setRawMode(true);process.stdin.resume();}
let input='';
for await(const chunk of process.stdin){input+=chunk.toString();if(input.includes('\n'))break;}
if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
try{
  const options=JSON.parse(input.trim()),url='https://legacy-site.example.invalid/api/inventory-sync';
  if(!options.token)throw Error('A fresh Sites service token is required.');
  const call=async body=>{
    const response=await fetch(url,{method:body?'POST':'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+options.token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{throw Error('Site returned non-JSON HTTP '+response.status);}
    if(!response.ok)throw Error('HTTP '+response.status+': '+(data.error??'request failed'));return data;
  };
  if(options.action==='status')console.log(JSON.stringify(await call()));
  else{
    const pages=JSON.parse(await fs.readFile(options.pagesPath,'utf8'));
    const preview=await call({action:'preview',pages});
    if(options.action==='preview')console.log(JSON.stringify(preview));
    else if(options.action==='apply'){
      const saved=await call({action:'apply',pages,expectedRevision:preview.revision,checksum:preview.checksum});
      const status=await call();if(status.refresh?.checksum!==saved.checksum||status.revision<saved.revision)throw Error('Saved refresh could not be verified.');
      console.log(JSON.stringify({saved,verified:true,status}));
    }else throw Error('Choose status, preview, or apply.');
  }
}catch(error){console.error(error.message);process.exitCode=1;}
