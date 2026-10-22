#!/usr/bin/env python3
"""Create private host configuration without printing or replacing credentials."""
import hashlib
import os
from pathlib import Path
import re
import secrets
import sys

root = Path(__file__).resolve().parent
if len(sys.argv) != 3:
    raise SystemExit('Usage: python3 initialize.py CORE_HOST CONNECT_HOST')
hosts = sys.argv[1:]
hostname = re.compile(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}')
if hosts[0] == hosts[1] or not all(hostname.fullmatch(x) for x in hosts):
    raise SystemExit('Use two distinct DNS hostnames without a scheme, port or path.')
os.umask(0o077)
private = root / 'private'
if (root / '.env').exists() or private.exists():
    raise SystemExit('Existing configuration is preserved. Use a new empty installation directory.')
private.mkdir(mode=0o700)
setup_code = secrets.token_urlsafe(24)
(root / '.env').write_text(
    f'CORE_HOST={hosts[0]}\nCONNECT_HOST={hosts[1]}\n'
    f'DATABASE_ADMIN_PASSWORD={secrets.token_hex(32)}\n'
    f'DATABASE_APP_PASSWORD={secrets.token_hex(32)}\n')
(private / 'owner-setup-code.txt').write_text(setup_code + '\n')
(private / 'core.env').write_text(
    f'BTCORE_SETUP_TOKEN_HASH={hashlib.sha256(setup_code.encode()).hexdigest()}\n'
    f'BTCORE_CONNECTOR_KEY={secrets.token_hex(32)}\n'
    '# Keep the connector origin blank during isolated restore.\nBTCONNECT_ORIGIN=\n'
    '# Use a new independent bucket for the complete original-photo restore.\n'
    'BTCORE_S3_ENDPOINT=\nBTCORE_S3_BUCKET=\nBTCORE_S3_REGION=\n'
    'BTCORE_S3_ACCESS_KEY_ID=\nBTCORE_S3_SECRET_ACCESS_KEY=\nBTCORE_S3_PATH_STYLE=1\n')
(private / 'connector.env').write_text(
    '# Recover the matching encryption key; never generate one over the old journal.\n'
    'TOKEN_ENCRYPTION_KEY=\nEBAY_CLIENT_ID=\nEBAY_CLIENT_SECRET=\nEBAY_RUNAME=\n'
    'EBAY_ALLOWED_SELLER=ballardtradingco\nBTCO_PUBLICATION_ENABLED=false\n'
    'BTCO_AI_BUDGET_USD=0\n')
print('Private configuration created. The owner setup code is in private/owner-setup-code.txt.')
print('Configure the independent original-photo bucket before restoring the real workspace.')
