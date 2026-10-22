#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
umask 077
case "${1:-}" in
  load)
    sha256sum -c SHA256SUMS
    gzip -dc images.tar.gz | docker load >/dev/null
    python3 - <<'PY'
import json, subprocess
for tag, expected in json.load(open('images.json')).items():
    actual = subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',tag],text=True).strip()
    if actual != expected: raise SystemExit('Image identity mismatch: '+tag)
print('Verified all four image identities.')
PY
    ;;
  up)
    # Idempotent schema/least-privilege grants; no restore or live marketplace write.
    docker compose up -d --wait database
    docker compose run --rm provision
    docker compose up -d --wait core edge
    ;;
  restore)
    test -f "${2:?Provide a private Core NDJSON backup}"
    file=$(realpath -- "$2")
    docker compose stop core
    trap 'docker compose up -d core >/dev/null' EXIT
    docker compose run --rm --no-deps -v "$file:/restore/input.ndjson:ro" core \
      node --input-type=module -e '
        import {openStore} from "./core/store.mjs";
        import {objectStorageFromEnv} from "./core/object-storage.mjs";
        import {restoreBackupFile} from "./core/backup.mjs";
        const store=await openStore({databaseUrl:process.env.BTCORE_APP_DATABASE_URL,migrate:false});
        try { const objectStore=objectStorageFromEnv(); if(objectStore)await objectStore.check();
          console.log(JSON.stringify(await restoreBackupFile(store,"/restore/input.ndjson",{objectStore})));
        } finally {await store.close();}'
    ;;
  connector)
    if [[ "${2:-}" != '--old-writer-stopped' ]]; then
      echo 'First stop the previous publisher and recover its consistent database, originals and matching key.' >&2
      exit 1
    fi
    # Verification is read-only and refuses missing/empty replacement journals.
    test -f private/connector-data/btco.sqlite3
    test -d private/connector-data/listing-objects
    docker compose run --rm --no-deps --entrypoint python connector /dev/stdin < verify-journal.py
    docker compose --profile publisher up -d connector
    ;;
  status) docker compose --profile publisher ps ;;
  *) echo 'Usage: bash host.sh load|up|restore BACKUP|connector --old-writer-stopped|status' >&2; exit 1 ;;
esac
