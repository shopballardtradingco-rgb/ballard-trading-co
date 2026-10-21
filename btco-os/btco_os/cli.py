"""Local operator commands; database files are private runtime state."""
import argparse
import json
import sqlite3
from pathlib import Path
from .core import connect, import_ebay_csv, overview, register_cdp_item


def main(argv=None):
    parser = argparse.ArgumentParser(prog='btco-os')
    parser.add_argument('--db', default='btco-vault.sqlite3')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status')
    add = commands.add_parser('register-cdp')
    add.add_argument('--sku', required=True)
    add.add_argument('--title', required=True)
    imp = commands.add_parser('import-ebay-csv')
    imp.add_argument('path', type=Path)
    imp.add_argument('--full-snapshot', action='store_true')
    args = parser.parse_args(argv)
    try:
        db = connect(args.db)
        try:
            if args.command == 'status':
                result = overview(db)
            elif args.command == 'register-cdp':
                result = {'item_id': register_cdp_item(db, args.sku, args.title)}
            else:
                result = import_ebay_csv(db, args.path.read_text(encoding='utf-8-sig'), args.full_snapshot)
            print(json.dumps(result, sort_keys=True))
        finally:
            db.close()
    except (ValueError, OSError, sqlite3.Error) as exc:
        parser.exit(2, f'Vault operation failed: {exc}\n')


if __name__ == '__main__':
    main()
