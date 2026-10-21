#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -ne 1 || "$1" != /* ]]; then
  echo 'Usage: bash tools/archive-source.sh /absolute/private/output-directory' >&2
  exit 2
fi
root=$(git rev-parse --show-toplevel)
out=$1
case "$out/" in "$root/"*) echo 'Choose an output directory outside the repository.' >&2; exit 2;; esac
mkdir -p "$out"
sha=$(git rev-parse HEAD)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
base="$out/ballard-source-$stamp-$sha"
git archive --format=tar.gz --prefix=ballard-trading-co/ --output="$base.tar.gz" HEAD
git bundle create "$base.bundle" --all
git bundle verify "$base.bundle"
(
  cd "$out"
  sha256sum "$(basename "$base.tar.gz")" "$(basename "$base.bundle")" > "$base.sha256"
)
printf 'Source recovery files created for commit %s in %s\n' "$sha" "$out"
echo 'Copy them to another provider or an offline device. This does not back up runtime inventory, photos or credentials.'
