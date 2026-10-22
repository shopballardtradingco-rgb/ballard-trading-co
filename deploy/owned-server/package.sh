#!/usr/bin/env bash
set -euo pipefail
out=${1:?Provide an empty output directory}
test ! -e "$out"
mkdir -p "$out"
for file in compose.yaml Caddyfile initialize.py host.sh verify-journal.py README.md; do
  cp "deploy/owned-server/$file" "$out/$file"
done
docker save btcore-app:verified btcore-connector:verified btcore-postgres:verified btcore-proxy:verified | gzip -1 > "$out/images.tar.gz"
python3 - "$out" <<'PY'
import json, os, pathlib, subprocess, sys
out=pathlib.Path(sys.argv[1])
images={tag:subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',tag],text=True).strip()
        for tag in ['btcore-app:verified','btcore-connector:verified','btcore-postgres:verified','btcore-proxy:verified']}
(out/'images.json').write_text(json.dumps(images,indent=2)+'\n')
source=json.loads(pathlib.Path('source-lock.json').read_text())
(out/'source.json').write_text(json.dumps({'public_commit':os.environ.get('GITHUB_SHA'),
    'upstream_source_lock':source,'container_acceptance_passed':True,'live_deployment_verified':False},indent=2)+'\n')
PY
(cd "$out" && sha256sum -- * > SHA256SUMS)
