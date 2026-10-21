# Vision activation and physical-phone acceptance

Status: OpenAI activated on October 11, 2026. Model access returned HTTP 200, and the exact recognition payload/parser completed a live blank-image test (LOW confidence, empty player; estimated $0.000859). The initial malformed tiny-image fixture was rejected with HTTP 400 and corrected; this was not an app failure. These checks do not establish real-card accuracy or physical-iPhone acceptance. PSA activation is blocked by provider approval. An authorized direct test with the user’s newly supplied token and certificate `24311536` returned HTTP 403 with the explicit approved-customer restriction; another token or certificate is not the next step.

## Keep operating with public certificate lookup

Public certificate lookup is available now without API approval. In Vision → Review, enter a certificate and choose Google this cert or Open PSA record. Scanned PSA certificates fill this lookup automatically; the initial test number is `24311536`. Existing PSA inventory records also expose both links. Public research does not automatically populate or verify inventory; compare the record and edit the reviewed fields.

On October 11, public search and the official page `https://www.psacard.com/cert/24311536/psa` returned certificate 24311536 for 2003 Topps Chrome #111 LeBron James, Black Refractor, GEM MT 10. This is the connection-test example, not an assertion that BTCo owns the card. This evidence establishes the public lookup path, not API approval or a physical-slab authentication.

## Activation

1. Install the OpenAI Developers plugin and complete its supported API-key setup. Store the approved key as the Site secret `OPENAI_API_KEY`; keep it out of chat, Git and browser code. Confirm project API billing and access to `gpt-5.4-mini-2026-03-17` through that workflow.
2. In Vision → PSA connection, open https://www.psacard.com/publicapi and sign in directly on PSA. Generate/copy the access token and paste it into the private OS form. The test certificate defaults to `24311536`; leave it as-is or edit it, then choose Test and connect PSA. The server must verify an exact matching record before encrypting and saving the token. Use Disconnect PSA to clear it. The encrypted record is account-scoped and separate from Vault exports; the wrapping key `PSA_CREDENTIAL_KEY` lives only in protected Site runtime configuration. A legacy `PSA_API_TOKEN` environment value is still supported when no owner-specific connection or disconnect record exists.
3. Keep defaults initially: `VISION_DAILY_SCAN_LIMIT=20`, `VISION_DAILY_BUDGET_USD=1.00`, `VISION_PSA_DAILY_LIMIT=90`. These server limits are configurable through Site runtime settings; zero blocks new requests. Secrets and limits are runtime settings, not client inputs.
4. Confirm the Site has applied the additive migration and that signed-in Vision shows AI and PSA status independently. A configured status means a credential is present, not that a real call has passed.

## PSA approval blocker — observed October 11, 2026 (Pacific)

An authorized direct HTTPS request used the supplied token only in the Authorization bearer header against `https://api.psacard.com/publicapi/cert/GetByCertNumber/24311536`. The response was HTTP 403, `application/json; charset=utf-8`, with the exact message: “Access to this API is limited to approved customers.” No explicit `cf-mitigated: challenge` header was present; the Cloudflare request reference was `a491e4dc7f0411a3-ORD`. This establishes an API-access restriction for this request, not an invalid certificate or successful activation. The failed token was not saved as an active connection. Do not keep retrying or generating tokens to resolve this restriction.

The earlier hosted credential-free Swagger documentation check returned HTTP 200. That only established public documentation reachability. The approved-customer response came from the separate authorized certificate API test.

PSA must approve API access before the connection can be completed. PSA's own API response identifies `collectors-apis@collectors.com` as an API contact. The following request is prepared for Tim to send from the email associated with his PSA account; it has not been sent:

> Subject: Previously working PSA API now returns HTTP 403 — Ballard Trading Co.
>
> Hello PSA API team,
>
> I’m Tim Ballard, owner of Ballard Trading Co. My PSA API access previously worked. I use it to verify individual certificate records in our private inventory app, BTCo OS.
>
> A newly generated access token used with GetByCertNumber/24311536 returns HTTP 403: “Access to this API is limited to approved customers.”
>
> Could you check my account’s API access, explain what changed, and restore access or tell me what approval is now required?
>
> Thank you,
> Tim Ballard

After PSA confirms approval, perform one connection test using the default certificate. Only a verified exact certificate response may activate and save the connection.

## First real scan

- On the signed-in iPhone, open Vision, capture one clear front and back, and Identify once. Confirm photo orientation, legible serial/label, a clear progress state and either a result or useful error.
- Compare every critical identity field to the actual card: player, release year, exact set/number, parallel, serial, slab grade/certificate. Record incorrect guesses rather than silently counting the scan as a pass.
- Confirm the same identification appears in Recent scans on the Mac. Retrying the same request must replay it without another provider request.
- Confirm the scan appears in Drafts waiting for CDP on both devices without increasing available inventory. For an existing physical copy, choose Link to this record or enter its CDP SKU; confirm the matching record and verify that no stock, cost, sales, identity or marketplace SKU changes. For a new physical copy, create/find its record in CDP first, then confirm the exact CDP SKU to create one linked Vault counterpart. Check the separate CDP master SKU and original scan evidence on both devices.
- On a PSA slab, compare the official lookup to the physical label. A certificate match is not proof that the physical slab is authentic.

## Small acceptance batch

Use approximately 20 real cards across raw, numbered/refractor, PSA, low-light and unclear-label examples. Include a sold/review-held item, a duplicate physical copy, a repeated request, missing photo and interrupted network request. Count correct critical-field identifications, necessary corrections, latency, usage, save/recovery success and any unintended records. The daily limit may span more than one day; do not lift it merely to finish a test.

After this passes, plan native shared-account authentication and a Mac/Xcode + physical-iPhone build. Reuse the hosted rules and current Vault rather than shipping a second inventory system.

## Provider reference

Model and rate reference, checked 2026-10-11: https://developers.openai.com/api/docs/models/gpt-5.4-mini . Standard input $0.75/M tokens; output $4.50/M. Cached discounts are ignored in the application's conservative estimate. Model is pinned; output capped at 2,048 tokens; no paid tools or automatic retries. The $0.32 reservation covers a 400k-input-token context plus capped output at these standard rates, excluding taxes/account adjustments. Revisit rates before changing models or billing mode.
