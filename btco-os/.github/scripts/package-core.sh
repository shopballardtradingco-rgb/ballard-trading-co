#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$GITHUB_SHA" = "$(git rev-parse HEAD)"
test ! -e runtime-package
mkdir runtime-package
docker tag btcore-acceptance "btcore:$GITHUB_SHA"
docker save "btcore:$GITHUB_SHA" | gzip -n > runtime-package/btcore-image.tar.gz
gzip -t runtime-package/btcore-image.tar.gz
export BTCORE_PACKAGED_IMAGE_ID
BTCORE_PACKAGED_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "btcore:$GITHUB_SHA")
export BTCORE_PACKAGED_TREE
BTCORE_PACKAGED_TREE=$(git rev-parse 'HEAD^{tree}')
node --input-type=module <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync('runtime-package/manifest.json', JSON.stringify({
  source_commit: process.env.GITHUB_SHA,
  source_tree: process.env.BTCORE_PACKAGED_TREE,
  version: JSON.parse(readFileSync('core/package.json','utf8')).version,
  image_tag: `btcore:${process.env.GITHUB_SHA}`,
  image_id: process.env.BTCORE_PACKAGED_IMAGE_ID,
  platform: 'linux/amd64',
  browser_app_sha256: hash('core/public/app.mjs'),
  acceptance: 'unit, PostgreSQL, nine browser suites and packaged private API smoke passed',
  contains_runtime_data_or_credentials: false,
  live_deployment_verified: false
}, null, 2)+'\n');
JS
cp docs/deployment/INDEPENDENT-RUNTIME.md runtime-package/DEPLOY.md
(cd runtime-package && sha256sum btcore-image.tar.gz manifest.json DEPLOY.md > SHA256SUMS)
