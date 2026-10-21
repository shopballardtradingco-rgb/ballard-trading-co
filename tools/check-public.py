#!/usr/bin/env python3
"""Bounded public-release check; emits paths/rules, never suspected secret values."""
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
skip = {'.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache'}
checks = {
    'credential': r'(?:sk-proj-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)',
    'live-deployment-address': r'(?i)(?:https?://)?[a-z0-9-]+\.up\.railway\.app|[a-z0-9-]+\.[a-z0-9-]+\.chatgpt\.site',
}
bad = []
count = 0
for path in root.rglob('*'):
    relative = path.relative_to(root)
    if set(relative.parts) & skip or not path.is_file():
        continue
    if path.is_symlink():
        bad.append(f'{relative}: unexpected symlink')
        continue
    if (path.name.startswith('.env') and path.name != '.env.example') or path.suffix in {'.sqlite', '.sqlite3', '.db', '.ndjson', '.bundle'}:
        bad.append(f'{relative}: private-file-type')
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        bad.append(f'{relative}: unreviewed-binary')
        continue
    count += 1
    for rule, expression in checks.items():
        if re.search(expression, text):
            bad.append(f'{relative}: {rule}')
if bad:
    raise SystemExit('\n'.join(bad))
print(f'Bounded public-content check passed for {count} text files; manual review still required.')
