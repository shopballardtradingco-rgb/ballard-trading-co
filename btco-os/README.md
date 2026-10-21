# BTCo OS · BTCore standalone 0.2.0 / browser 0.11.4

**Standalone BTCore:** the independent development application is in [core/](core/README.md), with its own login, PostgreSQL inventory, original-photo intake, sales records and backups. See [architecture](docs/BTCORE-STANDALONE.md) and [release notes](docs/releases/core-0.2.0.md). It is separate from the existing Site and BTConnect.

Ballard Trading Co.'s browser-based operating system. This repository is the canonical source for the browser app, Vault utility, Vision iPhone source, tests and engineering documentation.

[Open private BTCo OS](https://legacy-site.example.invalid) · [Technical overview](docs/ARCHITECTURE.md) · [Engineering backlog](docs/BACKLOG.md) · [Changelog](CHANGELOG.md) · [Audit](docs/AUDIT.md)

The browser app lives in **web/**. Vault tracks inventory and preserved CDP master identities; Vision identifies and stages reviewed intake; Scout evaluates purchases; Market shows channel prices and duplicate identities; Flow shows reconciliation; Pulse summarizes recorded financial activity.

Live eBay active-listing synchronization uses the existing [eBay connector](https://github.com/shopballardtradingco-rgb/btco-ebay-connector). Complete paginated collections are validated before atomic reconciliation. CDP remains the listing hub. Physical stock, confirmed SKUs, existing sales and independent CollX prices stay protected.

```sh
# Python operator utility (separate local database)
python -m pip install .
python -m unittest discover -s tests -v
btco-os --db /tmp/btco-vault.sqlite3 status

# Browser source; Node 22.13+ required
cd web
npm run install:ci
npm --prefix services/vision-node ci --ignore-scripts
npm test
npm run check:release
npm run typecheck
npm run build
```

Use `btco-os register-cdp --sku 'exact-confirmed-sku' --title 'Reviewed item'` only with confirmed CDP evidence. `btco-os import-ebay-csv report.csv --full-snapshot` writes listing observations to its selected local SQLite database, never to hosted D1. Create your chosen database parent directory first. See [browser setup](web/README.md) and [release process](docs/DEVELOPMENT.md).

The source ships without production inventory, customer data or credentials. Tests use synthetic data. The application is a private operational release; multi-tenant SaaS authorization, normalized storage and native-device acceptance remain tracked engineering work.
