# BTCo Vision recognition service

Recovered V6 Node server for iPhone scanning, PSA cache, CSV inventory matching and eBay active listings. It is kept in this monorepo, but is not deployed inside the OS Worker: its file cache, uploads and provider dependencies require a separate Node runtime.

Use Node 22.13 or later. Run `npm ci` in this directory, copy `.env.example` to `.env` and configure the needed provider credentials. `npm run check` checks syntax; `npm start` starts the service. Provider calls can incur charges when explicitly used. No provider calls are part of automated tests.

Default listening is loopback only. Access from an iPhone requires `HOST=0.0.0.0` (or the intended private interface) and a nonempty `VISION_SERVICE_TOKEN`. Supply that token in the native connection settings. The same bearer token protects every endpoint, including health, PSA and inventory. Public deployment requires an HTTPS endpoint and appropriate private hosting; do not expose a tokenless server. Keep a LAN token distinct from tokens used elsewhere.

For the OS bridge, configure its `VISION_SERVICE_URL` to the service's HTTPS URL and set the matching server-side token. The optional API forwards only scanning, PSA and active market lookup. `/check-inventory` remains for the native client and its configured historical CSV. It is not the OS's current shared inventory.

The recovered service caches PSA responses in a writable file; set `PSA_CACHE_FILE` to a private persistent path. Keep uploaded inventory outside Git and set `VISION_INVENTORY_CSV` explicitly. Preserve source dates when reasoning from exports. Never claim active listing prices are sold transactions.

Original unmodified servers and iPhone clients live under `archive/vision/`; do not run them publicly. This maintained service adds authorization and configuration while preserving their provider logic. Provider compatibility and credentials must be verified on the actual deployment.
