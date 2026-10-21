# BTConnect — regular-Chat acceptance
Date: 2026-10-14 Pacific. Build impact: BTConnect only.

## Result
**NOT ACCEPTED end to end.** Backend and Work checks are separate from regular-Chat evidence. No comics were published by this task and no publication approval was requested.

## Observed evidence
- Existing app: BTCo eBay Connector, app ID `asdk_app_6ab35402624c8191bf4809580fdcbec4`; existing endpoint `https://deployment.example.invalid/mcp`.
- Both existing connections (BTCo Connect A and B) identify seller `ballardtradingco` / `3uxyv64dtp6`, have `btco:listings` consent, report no missing eBay listing scopes and use the same receipt verification key. Neither was recreated, disconnected or reauthorized.
- Work exposes all 31 connector tools, including original ingestion, preparation, review, approval and publication. Readiness/status and saved-record discovery calls succeeded in Work. Availability is not a write-operation test.
- The app description still said “Private read-only eBay orders, transactions, fees and payouts.” It has been corrected in place to describe BTConnect's real workflow. The existing app's Refresh tools action was invoked. The app ID, version ID, endpoint and both connections remained in place.
- Existing plugin permission inspection reports “Allow all actions.” No permission settings or OAuth scopes were changed. Service-level exact-content owner approval still applies.
- A fresh conversation was visibly in **Chat**, not Work. Selecting the existing app and submitting a read-only diagnostic failed with **Model not found** before any tool call. One retry after changing Pro power to Extra High and a further retry selecting the available GPT-5.6 Sol model at Medium both had the same result. These were host errors, not BTConnect responses; there is no completed regular-Chat tool trace.
- Saved discovery returned **0 batches** and **57 legacy drafts**. Of those, 53 have historical publication item IDs and 4 are older approved pilot drafts without a saved item ID. Those four are not evidence of unsold inventory. Historical records were not reused as five new listings.
- No new five-comic selection, matched original front/back files or exact physical location was supplied with this acceptance request. Recent unrelated uploads were not assumed to be the intended inventory.

## Findings and changes in 0.4.1
1. Correct stale app-facing read-only metadata and make the server's first instructions describe the complete batch workflow.
2. Add a server tool manifest (names, count and schema/metadata SHA-256) to the existing status tool. It explicitly says `host_callability_verified: false`. A caller must compare it with actual host-callable tools; a list of advertised names cannot pass acceptance.
3. Fix native photo batch isolation: an invalid download URL now fails only that file. Other correctly mapped originals continue and remain recoverable. Invalid URLs are rejected before network access; URLs are not echoed in errors. Ambiguous file-to-role mapping still blocks the request rather than guessing.
4. Update the README's outdated production/candidate language.

The exact cause of the **earlier** regular-Chat missing-tool incident remains unproven. Current scopes are sufficient and the Work schema is complete. Stale host discovery is a plausible explanation, but could not be confirmed through a running regular-Chat response. The current “Model not found” blocker must be resolved before calling this repaired in regular Chat.

## Verification
- 377 local tests passed, including OAuth/MCP boundaries, preserved legacy records, per-file URL failure isolation, batch exception handling, revision-bound approval, duplicate protections and reconciliation. Two existing framework deprecation warnings remain.
- Python compilation and wheel packaging were checked.
- Local tests use synthetic photos and simulated eBay. They do not prove native ingestion from regular Chat, fresh-Chat recovery or live publication.
- Both GitHub CI checks passed for code commit `44b397c152d0fba933fa919d3649bf0fe1e84166` in PR #6.
- **Code is not deployed.** Automatic approval review rejected merging PR #6 because merging into main would affect production and could trigger deployment without explicit merge/deploy authorization. The running service remains 0.4.0. The app description correction and refresh were completed independently.
- Next release approval: “Approve merging and deploying BTConnect PR #6 to the existing Connect production service. Preserve connections and saved data. This does not approve any eBay listings.”

| Acceptance gate | Status |
| --- | --- |
| Existing seller connections and listing scopes | PASS in Work |
| Existing records discoverable | PASS in Work |
| Correct app description / refresh existing app | DONE |
| Per-file ingestion exception isolation | PASS in local tests |
| Five new comics ingested from regular Chat | BLOCKED: host model error; no selected new originals |
| Five complete drafts saved from regular Chat | NOT RUN |
| Saved batch recovered in a separate fresh Chat | NOT RUN |
| One complete owner review | NOT RUN |
| Explicit owner approval of that review | NOT REQUESTED |
| Publish and fresh verification of live eBay IDs | NOT RUN |

## Exact regular-Chat start
1. Open a **new Chat** conversation. Type `@` and select the existing **BTCo eBay Connector** app. Do not create a replacement connector.
2. Attach the original JPEG/PNG front and back of each of five new comics (ten originals total). Use clear labels such as `01-front`, `01-back` through `05-back`; labels guide inspection but never replace visual matching. Provide the actual physical storage location.
3. Paste:

> Use BTConnect through the existing BTCo eBay Connector, connection BTCo Connect A. Start a five-comic batch from these ten original photos. Physical location: [ACTUAL LOCATION]. First check connection status and listing readiness, and verify the required tools are actually callable here. Check saved batches/drafts for prior work before ingesting. Ingest originals, identify each comic from evidence, prepare and save complete individualized drafts at whole-dollar prices, and use current saved shipping and policy settings only within their recorded authorization. Do not invent condition, printing, variant, packing measurements or estimate authorization. Isolate individual exceptions and continue the other comics. Give me one complete review with the original photo matches, full title and descriptions, condition, price, Best Offer, shipping, policies, promotion, physical location, batch ID, review revision and retry policy. Do not approve or publish anything. Stop once only for a consolidated set of genuinely missing inputs.

Connection A is a specified operational choice in that prompt; A and B were verified as the same seller. Keep both connections.

## Fresh-Chat recovery
After the saved batch ID is returned, start a separate **Chat**, select the same app and paste:

> Use BTConnect, connection BTCo Connect A. Recover batch [BATCH ID] from saved server records. If necessary use list_listing_batches. Do not rely on another conversation, re-upload originals or create a new batch. Read get_listing_batch and every get_listing_batch_review page at the same expected review revision. Present the complete review and isolated exceptions. Do not approve or publish.

Passing recovery requires successful tool results from that second Chat, not merely getting the same batch through Work.

## Approval and publication
Only after the owner has seen the full recovered package and chooses to approve it:

> I approve publishing the eligible comics in batch [BATCH ID], review revision [FULL REVISION], exactly as shown in the complete review, including original photos, prices, descriptions, shipping, Best Offer, promotion and stated retry policy. Leave all exceptions unpublished. Record this approval, publish/resume the approved batch, and verify each live eBay item ID. Continue eligible items after individual failures and report promotion and reconciliation separately.

If details change, produce a new full review and obtain new exact-revision approval. Do not infer owner approval from development authorization or app permissions.

## Missing tools or host error
If the Chat cannot find a tool, compare the actual callable tools with `get_connection_status.server_tool_manifest`. In the existing app's settings choose **Refresh tools**, then open a new Chat. Do not remove the existing app or replace credentials. Official OpenAI guidance documents refresh followed by a new conversation:
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/api/docs/guides/custom-mcp-server

If **Model not found** appears before a response, BTConnect has not run. Preserve this as a host blocker; backend tests cannot turn it into a pass.

## Preservation
No BTCore source, project, deployment, R2 configuration or data was modified. The Connect update requires no schema migration, volume replacement, encryption-key rotation, OAuth replacement, permission weakening or inventory writes.

