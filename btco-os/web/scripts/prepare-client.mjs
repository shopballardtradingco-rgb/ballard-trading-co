import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
const {version}=JSON.parse(await readFile('package.json','utf8'));
await mkdir('public',{recursive:true});
for(const name of await readdir('domain'))if(name.endsWith('.mjs')){
  const source=await readFile('domain/'+name,'utf8');
  await writeFile('public/'+name,source.replace(/(\bfrom\s+['"])(\.\/[^'"]+\.mjs)(['"])/g,`$1$2?v=${version}$3`));
}
