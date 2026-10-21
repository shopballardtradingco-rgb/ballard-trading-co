# New-comic publication acceptance — October 13, 2026

## Outcome

Shadowalker #1 (1988, Aircel), a newly supplied physical copy, was published after explicit owner approval of revision 226fb18ac5edd083acd47560b2656f7b1c3a6b0225a400f5f05649411a659fb0.

Public listing: https://www.ebay.com/itm/820235081568

Independent connector readback confirmed ACTIVE/PUBLISHED, quantity one, $5 USD, offers disabled with no residual floor, Acceptable, approved description and specifics, the reviewed calculated Ground Advantage policy with combined shipping, the authorized parcel estimate, and the existing fixed 5% campaign. Both actual eBay-hosted photographs were downloaded and visually compared with the original front/back images.

The first inventory API attempt returned error 25001. The existing durable job was inspected; the saved eBay inventory matched the approved revision in full and no offer had been attempted. Recovery continued the same job to one offer and one live item. No second draft or listing was created. Historical example copies were not published.

## Vault verification

The signed Ed25519 receipt was previewed and applied through the owner-private publication-sync endpoint. A separate owner statement established the physical copy and its storage section; these facts were not inferred from marketplace availability. Independent GET readback verified revision 46, one reconciliation event, quantity one, the permanent physical identity, eBay item/SKU link and the owner-specified location. Existing stock, costs and master SKUs were preserved. Private receipt and location details are retained in Vault rather than this repository.

## Source and deployment

- Connector runtime 0.3.10, publication-approved price rule at a826be8422fa7aface3d766de068099c995b8045; Railway deployment b08079be-e59a-47ed-b11f-9869446fecb7 was SUCCESS at publication.
- Approval-button generator and workflow at connector commit 162b5319877cc5b677d1e97bc96e5c2cd7abaff4. Connector runtime version remains 0.3.10.
- Canonical browser 0.11.4: 8abfc4c0e583ef7ea69de14ebcb1a278fc311d65.
- Sites deployment mirror: 8f1a294e3c9addba57eee540d6e33645a0dd645f.
- Sites deployment appgdep_6ace5224678081919895c2086005312d: SUCCESS, existing owner-private https://legacy-site.example.invalid and existing D1 retained.
- Canonical changed blob hashes were independently verified before deployment.

## Tests and limits

Connector: 282 tests passed; both GitHub Verify connector runs for the approval-button commit succeeded. Browser: 145 tests passed, release checks, typecheck and production build passed; GitHub Verify runs for 0.11.4 succeeded. Worker/D1 tests cover confirmation tampering, revision races, replay, current-record readback and preservation of existing identities/stock/costs.

The future review button sends owner intent for one exact revision. It never directly publishes or marks approval complete. Synthetic host interaction tests passed; real owner-click delivery remains to be accepted on the next new-comic review. Seller Hub drafts were unavailable from the cloud browser, a limitation disclosed before owner approval; active seller listings, connector draft claims and SKU offers were checked. No claim of a complete Seller Hub draft census is made.

Do not reuse this copy for another live test. Next test requires a different unlisted comic.
