// Only an authorized operator may apply a receipt. Tokens and private receipts
// arrive through hidden stdin or task-local files, never source or CLI arguments.
import fs from 'node:fs/promises';
process.stdout.write('Ready for publication reconciliation JSON on stdin (input is hidden).\n');
if(process.stdin.isTTY){process.stdin.setRawMode(true);process.stdin.resume();}
let input='';for await(const chunk of process.stdin){input+=chunk.toString();if(input.includes('\n'))break;}
if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
try{
  const options=JSON.parse(input.trim());if(!options.token)throw Error('A fresh Sites service token is required.');
  const url='https://legacy-site.example.invalid/api/publication-sync';
  const call=async(body,itemId)=>{
    if(itemId&&!/^\d{9,15}$/.test(itemId))throw Error('Invalid eBay item ID.');
    const response=await fetch(url+(itemId?'?item_id='+itemId:''),{method:body?'POST':'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+options.token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{throw Error('Site returned non-JSON HTTP '+response.status);}
    if(!response.ok)throw Error('HTTP '+response.status+': '+(data.error??'request failed'));return data;
  };
  if(options.action==='status')console.log(JSON.stringify(await call(null,options.itemId)));
  else{
    if(!['preview','apply'].includes(options.action))throw Error('Choose status, preview, or apply.');
    const envelope=options.envelope??JSON.parse(await fs.readFile(options.envelopePath,'utf8'));
    const context=options.physical_confirmation?{physical_confirmation:options.physical_confirmation}:{};
    const preview=await call({action:'preview',envelope,...context});
    if(options.action==='preview')console.log(JSON.stringify(preview));
    else{
      const saved=await call({action:'apply',envelope,...context,expectedRevision:preview.revision,checksum:preview.checksum});
      const status=await call(null,saved.summary.ebayItemId);
      if(status.reconciliation?.checksum!==(saved.receiptChecksum??saved.checksum)||status.reconciliation.itemId!==saved.summary.itemId||status.revision<saved.revision)throw Error('Saved publication could not be verified.');
      console.log(JSON.stringify({saved,verified:true,status}));
    }
  }
}catch(error){console.error(error.message);process.exitCode=1;}
