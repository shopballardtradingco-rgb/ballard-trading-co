# Same-five research guard retest — October 15, 2026

**Development evidence only. Production accuracy/productivity acceptance still
fails.** This reuses the five explicitly authorized archived front/back pairs from
the [first replay](2026-10-15-archived-research.md). It is not a new representative
sample or blind evaluation. No draft, approval, listing or inventory record was
written to production. The original ten images were preserved.

## Implementation and measured execution

The candidate now requires structured issue-specific year evidence, removes years
with inconsistent evidence, and holds condition when marks may be printed artwork.
These are consistency checks, not independent proof of the model's assertions.
Printing/variant claims remain unset without evidence. All results require owner
fact review and separate final publication approval.

An initial `comic-research-v3` medium-reasoning attempt timed out after **50.062680
seconds**, with no usage receipt. Its full **$1 reservation remains**. It was not
retried automatically. A deliberate new attempt used the earlier low-reasoning
setting with the new evidence guards (`comic-research-v4`). The remaining four
books used that same request configuration, without further paid retries.

| Measurement | First replay, v2 | Guard retest, v4 |
|---|---:|---:|
| Five completed research proposals, summed service seconds | 101.484028 | 92.508577 |
| Mean service seconds per proposal | 20.296806 | 18.501715 |
| First request start to last completion, including review gaps | 128.916933 | 172.792454 |
| Completed five-call estimated API cost | $0.245634 | $0.185180 |
| Transport/schema failures in the five completed calls | 0 | 0 |
| Verified sold comparables | 0 | 0 |
| Owner-reviewed completed listing drafts | 0 | 0 |

The **whole new pass**, including the preceding timeout and intervening inspection,
took **248.699066 seconds elapsed**, with **142.571257 service seconds**. Those
failures/gaps must not be omitted to imply faster listing. No timed manual baseline,
owner active time, new-listing interactions or time per completed listing exists.
The different requests, reused samples and one run per book do not establish a
production speed or cost improvement.

## Accuracy and corrections

| Comic | Result and remaining work |
|---|---|
| Elementals #3 | Model incorrectly proposed #6. Year and condition were held, so it cannot advance. Visible No. 3 and the previously verified matching cover still contradict #6. No live correction or republishing occurred. |
| Journey #2 | Correct underlying 1983 identity, but the live parser rejected source issue `#2` versus proposal `2`. A formatting fix restores the year when replaying the saved response locally. Ambiguous marks still require inspection. |
| Kid Eternity #1 | Core identity matches the visible cover. A guide value was mislabeled as an asking price; a new rejection rule quarantines it during offline replay. The remaining eBay snippet price is stale relative to the opened page. |
| Nestrobber #1 | Core identity remains supported. The blue printed feature is now uncertain instead of a definite defect; condition is held. One asking source is independently confirmed, another supplied URL returned 404. |
| The Final Cycle: Part 1 #3 | Now proposes a complete 1987/Dragon's Teeth identity and correct title. The cited catalog remains access-restricted on independent recheck; this additional candidate is not counted as fully verified. Condition is held. |

The initial live parser retained **2/5 independently supported complete core
identities**, plus the complete but not independently reverified Final Cycle
candidate. After the issue-marker correction, offline replay retains **3/5
supported complete core identities**, plus that candidate. This is not an accuracy
improvement over the first replay's 3/5. Zero exact printing/variant identities
were fully verified.

All **five conditions are held**. Three holds arise from negative wording about
stains/writing, rather than a positive defect assertion. This conservative filter
adds unnecessary review work and needs refinement before rollout. It does not
prove better condition recognition. Owner condition corrections, exact identity
review and pricing decisions remain unresolved.

The final parser normalizes only a leading issue `#`, preserving suffixes, and
rejects explicit guide/value-estimate language as market evidence. It does not
guess series aliases. The same five saved provider responses were reparsed locally
after those corrections: **no additional API requests, no altered saved research
revisions**. Live and final-parser module hashes are recorded separately in the
[sanitized measurements](2026-10-15-research-guard-retest.json).

## Independent source checks

- [Journey retailer page](https://www.mycomicshop.com/search?maxyr=1983&minyr=1983&tid=259971): issue #2 asking prices $9.70 and $9.00 appear; two references to the same retailer are not independent sales.
- [Nestrobber offer](https://www.walmart.com/ip/1341719115): $9.98 plus $6.99 shipping and October 1992 metadata are visible. VF condition is not comparable to an owner-approved Good/Acceptable copy. The separate MyComicShop `/comicbooks/item?TID=142961&mingr=0` source could not be confirmed.
- [Kid Eternity eBay offer](https://www.ebay.com/itm/940002528771): the opened page shows discounted $1.79 and $7.00 shipping, whereas the model reported the $1.99 snippet. This is an asking offer, not a verified sale.
- [Kid Eternity value page](https://www.pricecharting.com/game/comic-books-kid-eternity/kid-eternity-1-1993): the model's own evidence describes an index value, not an observed offer; rejected by the final parser.
- [Final Cycle issue reference](https://www.comics.org/issue/1189914/image/): independent open returned 403. A returned source URL and internally matching fields do not independently validate source contents or cover identity.

These checks were performed by the development reviewer, outside the hosted
research request. They are not an implemented autonomous verification service.

## Budget and readiness

All 13 completed pilot API estimates total **$0.538042**. Two uncertain requests
retain **$2** in reservations. **$2.538042 is committed/reserved; $2.461958 remains**
under the same nonrenewing $5 ledger. Reservations are not provider billing receipts.
No more paid calls were made in this pass.

**459 connector tests pass**, including 52 research tests and regression coverage
for year consistency, issue-marker formatting, marks/negative claims, guide-value
rejection and blocked draft promotion. Two existing framework warnings remain.
The candidate stays disabled by default and undeployed. Outstanding P0 work is
accurate photo-to-issue matching, fewer unnecessary condition holds, current
offer/sold evidence, five new representative comics with a timed manual baseline,
ordinary-Chat attachment/recovery acceptance, independent Sync and an explicitly
approved publishing pilot. Additional five-comic inputs are needed for acceptance,
not permission to continue routine development.
