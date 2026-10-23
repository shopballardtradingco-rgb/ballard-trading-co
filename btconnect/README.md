> Latest: 0.6.2 — Use the existing volume with a 400 MB photo quota and unchanged 50 MB free-disk reserve. Read actual headroom before each batch. See docs/releases/0.6.2.md; 0.6.1 added the measured readiness response.

# BTConnect · 0.5.2 performance candidate

Version 0.5.1 was deployed October 16 through [PR #8](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/8). Health, authenticated tools, saved-work catalogs and a live eBay read passed verification. Hosted AI remains off. The undeployed 0.5.2 candidate extends the existing bounded photo worker to draft preparation, ordinary saves, validation and private original retrieval. It also overlaps independent policy-readiness GETs in bounded groups, preserving fresh authorization and existing error handling. Every fresh integrity check remains; no new service or record migration is needed. See [preparation measurements](docs/benchmarks/2026-10-17-connect-preparation.md), [policy-readiness measurements](docs/benchmarks/2026-10-17-connect-policy-readiness.md) and [0.5.2 release notes](docs/releases/0.5.2.md). New-photo acceptance and owner-time benchmarking remain deferred.

The deployed 0.5.1 work includes read-only snapshots, bounded policy reads, one eBay HTTP pool, indexed storage, responsive ingestion and 20-item preparation chunks. See [initial measurements](docs/benchmarks/2026-10-16-connect-performance.md), [connection/storage measurements](docs/benchmarks/2026-10-16-connect-resources.md), [large-photo and 100-item results](docs/benchmarks/2026-10-16-connect-workloads.md), and [photo-memory tradeoffs](docs/benchmarks/2026-10-16-connect-photo-memory.md).

Ordinary ChatGPT supplies observations and owner decisions; BTConnect hosts draft assembly, correction, approval-controlled publishing and recovery. See the [Work-independent workflow](docs/WORK-INDEPENDENT-LISTING.md), [Connect-first audit](docs/CONNECT-FIRST-2026-10-15.md), and [batch workflow](docs/CONNECT-CHAT-BATCHES.md). Identification quality and the five-comic productivity comparison remain separate follow-up work.


Pull Ballard Trading Co.'s active eBay listings, orders, transaction fees and payouts directly into ChatGPT. The service runs on a host such as Railway; routine listing execution does not require Work, local scripts or the BTCo Mac application.

Version 0.3.13 adds explicitly approved recovery of the same rejected, unpublished offer, with fresh content and duplicate checks and one-use authorization. New uncertain requests remain blocked; structured error diagnostics survive later read-back attempts. See [0.3.13 recovery notes](docs/releases/0.3.13.md).

Version 0.3.12 fixes native batch file matching: set each `photo_inputs[].file_index` to its zero-based position in `files`, with its front/back/detail role. ChatGPT resolves file references before delivery, so callers should not duplicate IDs in a separate field. Batch up to ten originals in one call; keep successful results and retry only failures with indexes relative to the new request. Existing encrypted storage and approval gates are unchanged. Refresh the existing connector tools after deployment. See [photo workflow and acceptance status](docs/releases/0.3.12.md).

Version 0.3.10 requires offers OFF for comics priced at exactly $5, while other prices retain reviewed Best Offer settings. See [0.3.10 notes](docs/releases/0.3.10.md). Version 0.3.9 adds native original-file transfer, a tested raw-upload helper, complete draft schemas, and explicit publication outcomes. See [0.3.9 notes](docs/releases/0.3.9.md). Version 0.3.8 accepts eBay’s explicit inactive offer defaults while preserving all approved economic terms. Version 0.3.7 caps comic condition labels at Good or Acceptable, retaining the uninspected-interior disclosure. An owner-directed condition-only change can safely revise the same saved inventory item before any offer attempt, with renewed approval and full history. See [0.3.7 notes](docs/releases/0.3.7.md). Version 0.3.6 added conditionless read-back and diagnostics; 0.3.5 added exterior-only identity and automatic 5% campaign verification; 0.3.4 added authorized shipping estimates; 0.3.2 added Best Offer; 0.3.1 added signed Vault receipts.

**Review approval:** Future ChatGPT reviews include an exact-revision **Approve this listing** button. See [the button workflow](docs/APPROVAL-BUTTON.md). The generator and synthetic interaction checks are implemented; real host-click acceptance is pending the next new comic.

**Status:** Read-only eBay operations remain compatible. Version 0.3.0 adds private original-photo storage and approval-bound listing publication, deployed with publication **disabled by default**. New account scopes require explicit owner consent; a new-comic pilot was published and independently verified on October 13, 2026. See [0.3.0 release notes](docs/releases/0.3.0.md) for test evidence, exact-content approval requirements, recovery and remaining integration work.

The listing tools provide readiness, single-use original photo uploads, existing policy/campaign snapshots, draft save/read, explicit approval and publication of that exact revision. Every write tool requires the separate `btco:listings` scope. Normal reads require only `btco:read`. Promotion is fixed at 5% in an existing reviewed CPS campaign, or explicitly documented as unsupported. Vault reconciliation is tracked as pending until independently verified.


## What it provides

| Tool | Data |
| --- | --- |
| `get_connection_status` | Authorized seller identity and capabilities |
| `get_active_listings` | One page of up to 200 active listings, exact listing SKUs, prices, available quantities and variations |
| `get_orders` | Orders in a date range, optionally limited to unshipped orders |
| `get_order` | One order by its eBay order ID |
| `get_transactions` | Sales, refunds and other monetary transactions with returned fee breakdowns |
| `get_payouts` | Payout amounts, dates and statuses |

REST business-data reads use GET. Active listings use the Trading API's fixed `GetMyeBaySelling` read call, which requires XML over POST; neither the call name nor its target is caller-controlled. The service exposes no tools to edit listings, change discounts, issue refunds, buy items or send messages. It does not connect to CollX or CDP.

Order data includes usernames, titles and SKUs. Structured buyer contact details, delivery addresses and bank account details are excluded. Titles and other free text remain untrusted business data. The connector does not store order, transaction or payout responses after a request.

Dates are inclusive Pacific calendar dates, with a maximum of 90 days per query. The connector returns one page at a time, with `has_more` and `next_offset`; collect every page before totaling a period. eBay's retention limits still apply. Requested data is whatever eBay returns for this application's approved access.

Fee fields are returned with eBay's original currency strings and booking direction. A nested fee is a breakdown, not necessarily an additional debit. Payouts are cash transfers and should not be added to sales revenue. This connector does not know card acquisition costs, supplies, outside postage or overhead, so it cannot determine profit on its own.

## Hosting and connection

### 1. Prepare Railway

Create one private BTCo project with one service using this source directory and its Dockerfile. Review the chosen Railway plan and usage charges before activating any paid service. Nothing in this package subscribes to a plan or creates resources automatically.

- Generate an HTTPS public domain for the service; this will become `PUBLIC_URL`.
- Attach one persistent volume at `/data`. `railway.json` does not create the volume.
- Use a single replica, in one region, and the included single-worker start command.
- Keep the default container UID, which can write to Railway's mounted volume.
- Health-check path: `/health`. Port: Railway's injected `PORT` variable.
- The application permits Railway's documented `healthcheck.railway.app` Host only on `/health`.

If using the Railway ChatGPT plugin, select `@Railway` in a new Work chat after connecting it. Attach this package and request deployment of this private connector. Do not put developer credentials in the chat.

### 2. Configure the existing eBay developer application

Use your existing **production** eBay application keyset. Add a separate OAuth redirect entry (RuName) for this hosted connector:

- Accepted URL: `https://YOUR-HOST/ebay/callback`
- Declined URL: `https://YOUR-HOST/ebay/callback`
- Privacy URL: `https://YOUR-HOST/privacy`
- OAuth enabled for the redirect entry.

`EBAY_RUNAME` is the eBay-generated RuName string, not the callback URL. Keep existing redirect entries used by other software.

Confirm these scopes are available to the application's production keyset:

```
https://api.ebay.com/oauth/api_scope
https://api.ebay.com/oauth/api_scope/commerce.identity.readonly
https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly
https://api.ebay.com/oauth/api_scope/sell.finances
```

The standard Trading and Finances scopes have broader permission labels than read-only scopes. The connector's fixed endpoint and method checks implement data reads only. Developer registration alone does not prove that every required API permission is enabled; verify the application's approved scopes when connecting.

### 3. Set private service variables

Enter values directly in Railway's service Variables interface:

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | The service's exact HTTPS origin, with no `/mcp` suffix |
| `EBAY_CLIENT_ID` | Production App ID / Client ID |
| `EBAY_CLIENT_SECRET` | Production Cert ID / Client Secret |
| `EBAY_RUNAME` | The new redirect entry's eBay-generated RuName |
| `TOKEN_ENCRYPTION_KEY` | A fresh Fernet key, kept across redeployments |
| `EBAY_ALLOWED_SELLER` | `ballardtradingco` |
| `BTCO_DB_PATH` | `/data/btco.sqlite3` |

Generate the encryption key in a trusted local terminal with Python and `cryptography` installed:

```sh
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

Copy the output directly into the private variable. Do not paste secrets into chat, source files, screenshots or logs. The service fails at startup if required configuration is absent or invalid. An existing eBay app-only Browse token cannot substitute for seller authorization.

### 4. Deploy and add the personal plugin

Deploy after configuring variables and the volume. Verify that `/health` returns HTTP 200 and that unauthenticated `/mcp` returns HTTP 401 with OAuth discovery information. A healthy service does not yet mean eBay is connected.

In ChatGPT developer mode, add a personal plugin using:

```
https://YOUR-HOST/mcp
```

Use OAuth with dynamic client registration. ChatGPT's connector credentials are generated by this service; do not enter eBay's client secret into ChatGPT's plugin form. The server supports PKCE S256 and advertises the canonical `/mcp` resource. It accepts ChatGPT callback URLs at `https://chatgpt.com/connector/oauth/{id}` and the stable `https://chatgpt.com/connector_platform_oauth_redirect` path.

Complete the connector's consent page, then sign in on eBay as `ballardtradingco`. Account identity is checked before issuing ChatGPT any access token. Select BTConnect in ChatGPT. For the existing installation, retain its app and connection IDs and refresh its tools after deployment; do not create a replacement connection. Verify actual tool calls and original attachment transfer in a regular Chat before claiming client acceptance.

### 5. Verify live data

First request the connection status. Then fetch one recent day of orders and compare one exact order ID and amount with Seller Hub. Fetch transactions and payouts for that period separately, following pagination, and compare them against eBay's respective reports. Test an empty period and an expired or disconnected session. Record actual results before calling the deployment production-ready.

Example prompts:

- “Show my unshipped eBay orders created in the last seven days.”
- “Get every page of eBay transactions for yesterday and summarize sales, refunds and fees without double-counting fee breakdowns.”
- “Show this week's eBay payouts and their status.”

## Data handling and maintenance

eBay tokens stay on the server. ChatGPT receives separate random, resource-bound access tokens. The SQLite database encrypts record values with Fernet; bearer tokens and authorization codes are indexed by SHA-256 digest. It contains encrypted OAuth clients, pending flows and seller grants, plus limited lifecycle metadata. Protect both the persistent volume and its encryption key.

Authorization codes are single use and expire after two minutes. Connector access tokens last one hour; refresh tokens rotate and expire after at most 30 days without renewal, bounded by eBay's authorization lifetime. Upstream eBay access tokens refresh automatically. Explicit OAuth revocation deletes the associated connector grant and tokens; requests already in flight may finish. Revoking application access through eBay can also affect other software using the same developer application.

Expired records are removed during later database activity. Backups can retain older encrypted records according to the hosting provider's retention policy. The service disables application HTTP access logging; review hosting-level request logs separately because OAuth callbacks contain short-lived authorization codes. Never enable request-body or Authorization-header logging.

Keep the deployment private and the seller allowlist intact. This small-service design uses one SQLite database and one process. Do not add workers or replicas without redesigning upstream refresh coordination and storage. An encryption-key change requires a deliberate credential migration or a fresh database and reconnection; replacing the key alone cannot decrypt existing records.

The `/privacy` page describes this private service's data handling. It is not a public marketplace submission package or a general legal policy.

## Development and validation

Use Python 3.12 for the same major/minor runtime as the container:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest -q
```

Set variables in the process environment before running `.venv/bin/btco-ebay`. The program does not automatically load `.env` files. Interactive OAuth requires a real HTTPS origin configured in eBay and ChatGPT; the test suite uses synthetic credentials and an in-process transport.

The original integration cases cover HTTP OAuth discovery, callback restrictions, PKCE failure, code reuse, resource substitution, three client authentication methods, seller mismatch, browser binding, CSRF, refresh rotation, cross-client revocation, durable encrypted authorization, read-tool output filtering, pagination, Pacific DST, upstream refresh/revocation races and error handling. The complete 48-case suite, including listing pagination, XML/error guards, privacy, variation handling and old-grant refresh compatibility, passed on 2026-10-12 UTC. Two upstream test-framework deprecation warnings remain. Docker is unavailable in the build workspace, so the image has not been built here.

`requirements.lock.txt` pins the runtime dependency versions used during verification. The Dockerfile's OS and Python base remain updateable. Re-run the integration suite when changing the MCP SDK or auth dependencies. The service includes a small revocation route to handle a missing optional form-field default in MCP SDK 1.30.0 while preserving the SDK's client authentication.

## Primary references

- [OpenAI plugin quickstart](https://developers.openai.com/plugins/quickstart)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- [Official MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [eBay user access tokens](https://developer.ebay.com/api-docs/static/oauth-token-types.html)
- [eBay Identity API](https://developer.ebay.com/api-docs/commerce/identity/overview.html)
- [eBay Fulfillment API](https://developer.ebay.com/api-docs/sell/fulfillment/overview.html)
- [eBay monetary transactions](https://developer.ebay.com/api-docs/sell/static/finances/transaction-info.html)
- [eBay payout information](https://developer.ebay.com/api-docs/sell/static/finances/payout-info.html)
- [Railway ChatGPT plugin](https://docs.railway.com/ai/chatgpt-plugin)
- [Railway configuration](https://docs.railway.com/config-as-code/reference)
- [Railway health checks](https://docs.railway.com/deployments/healthchecks)
- [Railway volumes](https://docs.railway.com/volumes)

## Active-listing refresh contract

`get_active_listings(page=1)` returns seller `ballardtradingco`, listing-level records and `next_page`. Continue sequentially with the returned page. Check unchanged `total_matching` and `total_pages`, unique item IDs across pages, and exactly the expected number of listings. Restart after an upstream error or changing totals; never use partial results as a complete census. The 25,000-listing cap is rejected. Responses and XML bodies are bounded, redirects are disabled and upstream text is excluded from errors.

Pagination is not an atomic snapshot, even when all counts agree. Results therefore always carry `complete_snapshot: false`. Absence must never create a sale, remove inventory, or clear a review exclusion. Reconcile by eBay item ID, retain CDP master SKUs separately from eBay listing SKUs, preserve costs and recorded sales, and flag physical-quantity differences. Keep variation listings identifiable for separate review. Null quantity/price fields mean unknown, not zero. Prices are active asks in the returned currency, not sold comparables.

For the historical 0.2.0 upgrade, no database migration, new environment variable, replacement volume or encryption-key change was required. Version 0.3.0 adds listing tables/object storage in place and an optional publication gate, without replacing credentials or the volume. Each newly authorized grant stores its consented scopes. Legacy grants refresh with the original scopes until reconnection, and are not silently upgraded.

See [0.2.0 release notes](docs/releases/0.2.0.md).





