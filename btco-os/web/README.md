# BTCo OS browser application · 0.11.2

Canonical source lives in [shopballardtradingco-rgb/btco-os](https://github.com/shopballardtradingco-rgb/btco-os), under web/. The existing private [BTCo OS application](https://legacy-site.example.invalid) uses a separate deployment mirror.

Vault provides shared inventory, independent marketplace asking prices, eBay-only records, review holds, cost allocation and sales. Vision provides hosted recognition, PSA research and reviewed CDP linking. Market exposes listing prices and possible duplicate identities. Flow shows reconciliation issues and collection history. Scout calculates acquisition economics with at least 5% eBay promotion. Pulse shows recorded sales and known-cost profitability.

Live eBay active listings use the independently deployed connector through its read-only grant. Full page collections validate seller, sequence, timestamps, currency, unique listing IDs and totals before the scoped writer applies them. CDP master SKUs, physical stock, manual prices, sales and CollX observations are protected. See [daily runbook](docs/DAILY-INVENTORY.md). CDP export and live CollX retrieval remain incomplete.

```sh
npm run install:ci
npm --prefix services/vision-node ci --ignore-scripts
npm test
npm run check:release
npm run typecheck
npm run build
```

Node 22.13+ is required. Tests use synthetic records, in-memory SQLite and local Worker providers. Dependencies are lockfile-pinned. The optional Node Vision service is tested separately; no provider credentials are needed for tests. Use the Sites skill to deploy the exact verified source while preserving private access and D1.

The application stores an authenticated owner's inventory as revisioned, content-addressed D1 chunks with ten recovery snapshots. Source ships without private inventory data. New workspaces start empty; existing server records and device backups persist. The 15 MB workspace limit and online shared saves remain. Team memberships, durable job execution, normalized tenant storage, retained images and native shared-account authentication remain engineering work; see the repository's prioritized backlog.

Recovered iPhone source is in native/vision-ios, with immutable originals in archive/vision and fingerprints in docs/vision-sources.json. Native compilation and physical iPhone camera acceptance have not been verified here.

Publication reconciliation: see [0.11.3](docs/releases/0.11.3.md). The server requires `BTCO_RECEIPT_PUBLIC_KEY` pinned from the authenticated connector public-key descriptor. Use `scripts/publication-reconcile.mjs` with hidden stdin containing a fresh Sites token, action, and a private receipt envelope; preview before authorized apply, then verify status. Never put tokens or receipts in Git.
