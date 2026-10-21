import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const read=p=>readFileSync(p,'utf8'),json=p=>JSON.parse(read(p));
const version=json('package.json').version;
for(const p of ['package-lock.json','public/release.json','services/vision-node/package.json','services/vision-node/package-lock.json'])assert.equal(json(p).version,version,`${p} version differs`);
for(const p of ['public/app.mjs','app/vault-client.tsx','app/layout.tsx'])assert.ok(read(p).includes('v='+version),`${p} cache version differs`);
assert.ok(read('CHANGELOG.md').includes('## '+version));
for(const heading of ['Scope','Data','Verification','Limitations','Rollback'])assert.ok(read(`docs/releases/${version}.md`).includes('## '+heading),`Missing release heading ${heading}`);
const sources=json('docs/vision-sources.json');let count=0;
for(const source of sources.sources)for(const file of source.files){assert.equal(createHash('sha256').update(readFileSync(file.path)).digest('hex'),file.sha256,`Original source changed: ${file.path}`);count++;}
for(const file of ['public/modules-ui.mjs','domain/module-views.mjs','domain/listing-collector.mjs','public/app.mjs','public/vision-ui.mjs','public/vision-photo.mjs','domain/vision.mjs','domain/vision-intake.mjs','domain/intake-contract.mjs','domain/psa-public.mjs','domain/vision-economics.mjs','domain/ebay-api-refresh.mjs','server/inventory-sync.mjs','scripts/inventory-refresh.mjs','server/vision-api.mjs','server/vision-provider.mjs','server/vision-store.mjs','server/vision-credentials.mjs','services/vision-node/server.cjs','services/vision-node/access.cjs'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
console.log(`Release ${version}: version markers, notes, syntax and ${count} archived source files verified.`);
