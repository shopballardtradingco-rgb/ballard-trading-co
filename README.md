# Ballard Trading Co.

Built by collectors, to fund the collection.

This is the public source and project handoff hub for **BTCore**, the standalone operating app, and **BTConnect**, its eBay integration. The code, decisions, recovery instructions and work queue must remain usable without ChatGPT conversation history.

**Priority: replace CDP first. Reduce ChatGPT dependence over the long term. Retire other paid tools only after their required workflows have working replacements.**

## Start here

- [Independence roadmap and acceptance gates](docs/INDEPENDENCE.md)
- [System map and current state](docs/SYSTEM.md)
- [Backup and recovery runbook](docs/RECOVERY.md)
- [Business and product rules](docs/OPERATING-RULES.md)
- [Open work](https://github.com/shopballardtradingco-rgb/ballard-trading-co/issues)
- [Exact source inventory](source-lock.json)

## Included source

| Directory | Contents | Snapshot |
| --- | --- | --- |
| `btco-os/core/` | Standalone Node application, photo intake, review, inventory, eBay publication, export/restore and tests | BTCore 0.7.2 |
| `btco-os/web/` | Earlier web app, domain modules used by Core, migrations, native Vision source and archives | Full upstream snapshot |
| `btco-os/btco_os/` | Python inventory import utility | Full upstream snapshot |
| `btconnect/` | Python eBay integration, OAuth, original storage, listing approval/recovery, tests and Docker deployment | BTConnect 0.6.0 |
| `tools/` | Portable source archive, integrity check and offline restore drill | Recovery foundation |

The original 530 upstream files were recovered and checked against their Git blob hashes before export. The 0.7.2 maintenance checkpoint includes 534 source files. Deployment hostnames and transient local build paths are replaced with placeholders; `source-lock.json` lists each transformation and current upstream commit. No runtime database, customer export, original inventory photo, credential or old Git history is included.

## Run locally

Use Node 22.13+ (the existing CI uses Node 22) and Python 3.12 for the connector.

```sh
npm ci --prefix btco-os/core --ignore-scripts
npm test --prefix btco-os/core
python3 -m venv /tmp/btconnect-venv
/tmp/btconnect-venv/bin/pip install -r btconnect/requirements.lock.txt
/tmp/btconnect-venv/bin/pip install -e 'btconnect[test]'
/tmp/btconnect-venv/bin/pytest btconnect/tests -q
python3 tools/verify-source.py
```

Follow [Core's setup](btco-os/core/README.md) and [BTConnect's setup](btconnect/README.md) for environment variables and hosting. Examples contain placeholders. Keep deployment secrets in an owner-controlled secret store. Core needs the sibling `web/domain/` source; copying `core/` alone is insufficient.

## Deployment status

This public repository is an exact, documented recovery snapshot plus a new planning home. **It is not yet the live deployment remote.** Railway still builds Core from the private `btco-os` repository's `release/btcore-development` branch and BTConnect from private `btco-ebay-connector/main`. Those repositories retain their history. This checkpoint does not deploy, migrate databases, change marketplace listings or cancel subscriptions.

Until deployment migration is accepted, every runtime change must record the upstream commit and refresh this public snapshot after privacy review. Do not develop conflicting runtime versions in both locations. The outstanding automated mirror and deployment-migration work is tracked in Issues. Older nested READMEs and release notes are historical; this root README and `docs/` describe the new independence direction.

## Backup truth

The recovery runbook distinguishes a completed backup, a tested restore and a configured schedule. Source archives are not inventory backups. A duplicate on GitHub is not an independent provider. Scheduled GitHub source archives do not imply scheduled off-site data recovery. See the explicit remaining gaps before calling this system fully redundant.

Public visibility does not make the operational workspace public. No open-source license has been selected; no additional license grant is asserted here.
