# BTCo daily inventory refresh

## Scope and authorization

Tim authorized daily eBay inventory updates while retaining CDP as master SKU and listing hub. Use the read-only BTCo eBay Connector for seller `ballardtradingco`, seller ID `3uxyv64dtp6`. No listing writes, CSV upload workaround, order/sale inference, physical quantity mutation, CDP SKU renaming, or CollX price overwrites. CDP export/sign-in remains a separate incomplete connection; current CDP data is historical. Do not claim CDP was refreshed by this run.

Site: `appgprj_6acbe31183bc8191b3a6888dac3da21a`, https://legacy-site.example.invalid. Canonical instructions and `scripts/inventory-refresh.mjs` travel in the pushed Site source. Open its current source through the Sites skill; routine updates do not build, commit or redeploy code.

## Each run

1. Call `get_connection_status` and `get_active_listings` through the connected BTCo eBay Connector. Follow `next_page` from 1 through null, storing unmodified parsed JSON page objects in a JSON array in task scratch. Verify unchanged seller, totals and page size; returned counts must sum to total with unique item IDs. A failed page, duplicate, drift, provider failure or inconsistent page sequence aborts the write. Retry a fresh collection once for pagination drift; never label a partial collection complete. Live pagination is not an atomic stock census.
2. Call Sites `get_site` for the exact project. Verify owner-private access (only owner, no external visitors/groups/public audience). Stop the unattended writer if audience has broadened. Obtain the supported short-lived `siwc_bypass_bearer_token` in memory. No token in source, files, command arguments, task prompts or output. Service access authorizes this dedicated operation, not visitor impersonation or connected-app consent.
3. Use the current source checkout's `node scripts/inventory-refresh.mjs` with PTY and wait for its hidden-stdin readiness message. Send one newline-terminated JSON object via stdin: `{"token":"<in-memory token>","action":"apply","pagesPath":"<absolute scratch JSON path>"}`. The script uses the fixed Site origin, rejects redirects, previews, applies against that exact workspace revision/checksum and reads back the persisted result. `action: "preview"` performs no write; `action: "status"` reads only. Never set or spoof visitor identity headers.
4. On 409, preview again against current records, then retry the same validated collection once. A replayed checksum is successful and adds no records/history. If the response is ambiguous, GET status first; matching checksum verifies prior success. Do not blindly repeat or restore an old workspace. On any other failure, retain scratch evidence and report the exact blocker; leave the last good snapshot in place.
5. Report successful observed count, new review records, price changes, missing observations, quantity/SKU conflicts, blocked variations, snapshot time and saved revision. Mention CDP remains historical until a real export is obtained. If failed, never claim today's inventory was updated.

## Writer and data contract

`GET/POST /api/inventory-sync` is a narrow service operation inside the existing owner-private Sites boundary. Server-only runtime keys `BTCO_INVENTORY_OWNER_ID`, `BTCO_EBAY_SELLER`, `BTCO_EBAY_SELLER_ID` explicitly scope the target to the existing workspace and seller. It never accepts owner IDs or arbitrary inventory edits in a request. Visitors, if present, must match the configured owner. Existing Vault endpoints retain visitor and origin authorization. Disable these runtime keys before any audience expansion; this operation is not suitable for a public Site without an additional service authorization layer.

Pages must be complete, USD, unique by eBay ID and within 24 hours, with collection duration at most 30 minutes. Existing IDs get observation fields and current non-manual eBay prices. CDP master SKU, source mapping, marketplace alias, identity, counts, costs, sales and CollX price remain unchanged. Manual prices stay protected regardless of date. Alias collisions block new records for review. New eBay-only listings enter review with zero physical units; the eBay quantity is separate. Blank listing SKUs retain no claimed CDP identity. Variations are skipped and reported. Missing IDs get an observation only, never a sale, stock decrease or deletion. Existing review holds cannot be automatically released.

The existing content-addressed chunks, optimistic revision transaction and ten recovery snapshots remain in use. No schema migration. New import metadata and append-only events record each successful API collection. A data refresh does not require publication or a new build.

## Scheduling

Create/reuse one linked Site automation after the live source and writer/readback succeed. Intended cadence: daily at 7:00 AM America/Los_Angeles, including weekends, before the weekday 8:00 AM purchasing cycle. Inspect existing Site automations before creation. Runtime tool availability, app consent and private Site access remain required. Saved schedule timing and the first verified live result are reported at handoff; never infer run success from creation alone.
