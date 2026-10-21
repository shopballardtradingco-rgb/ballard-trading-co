#!/usr/bin/env python3
"""Verify the reviewed exported source without calling any external service."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'source-lock.json').read_text())
failures = []
for entry in manifest['files']:
    path = root / entry['path']
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry['published_sha256']:
        failures.append(entry['path'])
if failures:
    raise SystemExit('Source differs from checkpoint: ' + ', '.join(failures))
print(f"Verified {len(manifest['files'])} exported source files.")
