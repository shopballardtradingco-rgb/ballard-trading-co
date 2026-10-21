# Authorized archived-photo research replay — 2026-10-15

**P0 accuracy and productivity acceptance failed / remains open.** Five actual
archived front/back pairs reached saved research proposals, but only three had
complete, supported core identities. No verified sold comparable was obtained.
This is a development-service/API replay, not five completed listings or proof of
ordinary-Chat independence. Production records and marketplace listings were read
only and remain unchanged.

## Method and timing

The owner explicitly approved sending originals for up to five archived comics to
OpenAI within the previously authorized $5 total development budget. Ten original
JPEGs were checksum-verified and sent without image edits. The API received only
photos and the service prompt, not archived identities, prices or approval records.
The same persistent encrypted development budget was used throughout.

The five final calls used `comic-research-v2` and model
`gpt-5.4-mini-2026-03-17`. All completed as `needs_owner_review`.
No fact-review confirmation was fabricated and no production draft was prepared.
Original-photo retrieval, independent reference checking, debugging, owner review,
photography, shipping measurement and publication are outside the API timers.

- Elapsed first final-request start to fifth completion: **128.916933 s**.
- Sum of five service timers: **101.484028 s**, **20.296806 s/proposal**.
- Sum of five runner timers: **101.592726 s**; four final calls ran consecutively
  in **84.724488 s**. The whole window also includes the gap after the first call.
- Final five transport/validation failures: **0**; automatic retries: **0**.
- Before the final five, two deliberate diagnostic attempts failed validation:
  **24.091521 s** and **22.249121 s**. Those failures are not erased by the fixes.
- Owner interactions during replay: **0**, because archived inputs were reused;
  one photo-egress consent preceded it. New-listing manual steps/owner active time
  were **not measured**. Analyst development/review work is not owner productivity.
- Completed owner-reviewed listing drafts: **0**. Time per completed listing and
  comparison against a timed manual listing baseline: **not available**.

## Accuracy and corrections

References below were checked separately after model output. Saved inventory facts
were treated as a comparison record, not ground truth. Core identity means series,
issue, publication year and publisher; it excludes unverified printing/variant.

| Photographed comic | API seconds | Core identity result | Pricing result | Correction / limit |
| --- | ---: | --- | --- | --- |
| Elementals #3 (1985), archived as #6 (1986) | 19.198576 | Issue #3 correct; year 1984 wrong | No price, no market sources | Use catalog-supported 1985; returned references concerned other issues/series. Archived record also conflicts with its original cover |
| Journey #2 (1983) | 23.958634 | Supported | $10 suggestion from one $20.98 asking listing | The asking amount and $4.99 shipping were independently observed; FN/stock-photo source is not condition comparable and does not validate $10 market value |
| Kid Eternity #1 (1993) | 24.876733 | Supported by readable cover | No price, no market sources | One supplied catalog URL was not independently confirmed; cover establishes core identity |
| Nestrobber #1 (1992) | 21.847233 | Supported | No price, no market sources | Model mistook printed blue cover artwork for marker/paint/stain and proposed Acceptable; remove false defect claim and review condition |
| The Final Cycle: Part 1 #3 (1987) | 11.602852 | Incomplete: year/publisher null | No price, no market sources | Misread Dragon's Teeth as Dragonsteel; normalize title and verify year/publisher. Good disagrees with archived Acceptable; owner inspection required |

Core identities: **3/5 complete and supported**, one incorrect year, one incomplete.
Issue numbers: 5/5 agree with independently checked covers/catalogs, including the
Elementals archive discrepancy. Printing and variant: correctly left unspecified in
all five, but **0/5 fully verified exact editions**. Matching front/back was plausible
on inspection; separate loose images do not prove physical-copy provenance.

Condition accuracy is not a five-item scored percentage: no owner/in-person grading
ground truth exists. There is **one confirmed false defect claim**, and another
condition-label disagreement needs physical review. Detailed notes remain fallible.
No interior completeness or page quality was established.

Pricing: **0 verified sold comps**, four abstentions, one asking-only suggestion.
The observed asking amount is correct, but the proposed listing price is not a
verified valuation. An accessible Nestrobber retailer page had asking prices that
the API did not return; two completed tool calls do not provide comprehensive
market coverage. No pricing-accuracy percentage or speed improvement is justified.

## Failure-driven implementation changes

The two diagnostic responses mixed catalog identity records into market sources,
including a missing sale date and currency-prefixed amount. The old parser rejected
the complete result. Research now has separate identity references and stricter
provider price syntax. Invalid market evidence is excluded, marked visibly, and
removes the automatic price/rationale while preserving valid core observations.
An unsupported identity reference lowers confidence and blocks the reviewed bridge.
The owner must still correct facts and explicitly confirm exact pricing; final
publication approval remains separate.

Responses contained two completed web actions and an additional unfinished
`searching` item. All three are conservatively charged in the estimate, while only
completed actions count against the processing cap. A completed-call/cost overrun
now halts new paid work persistently before parsing, even if output is invalid.
No automatic paid retry or budget reset was added. Regression suite: **447 passed**,
including **40 research tests**, with two existing framework deprecation warnings.
The final post-replay change preserves free saved-ID replay across prompt upgrades;
it was verified offline without additional paid calls. The JSON records the exact
research-module hash used for the live five.

## Cost

Final five estimates total **$0.245634**. Two diagnostic failures add **$0.100801**;
the earlier synthetic abstention adds **$0.006427**. Total estimated completed usage
is **$0.352862**. The earlier interrupted attempt still holds a **$1 uncertain
reservation**, making the ledger **$1.352862 committed/reserved**, **$3.647138
remaining**. A reservation is not a confirmed charge; estimates ignore cache
discounts and count unfinished web items. No further paid retries were made.

## References and remaining acceptance

- Elementals: [GCD issue #3](https://my.comics.org/issue/65248/)
  (indexed title/date available; direct fetch was restricted) and
  [independent seller's matching front/back photos](https://www.ebay.com/itm/326419310810).
  The archive's #6 reference depicts a different cover. The owner was alerted to
  the discrepancy; any live correction requires a separately reviewed revision.
- Journey: [GCD #2](https://www.comics.org/issue/37442/) and
  [actual asking listing](https://www.ebay.com.au/itm/318719623928).
- Kid Eternity: visible May 93 / no. 1 / DC-Vertigo cover text;
  [series timeline](https://www.comics.org/series/4649/details/timeline/).
- Nestrobber: [MSU collection catalog](https://comics.lib.msu.edu/rri/srri/saio.htm),
  [retailer issue/date/prices](https://www.mycomicshop.com/search?TID=142961), and
  [independent cover image](https://www.ebay.com/itm/178384775864) with the same blue artwork.
- Final Cycle: visible title/No. 3 of 4/Dragon's Teeth branding;
  [catalog series](https://www.comics.org/series/79691/details/timeline/)
  and [issue/indicia resource](https://www.comics.org/issue/1189914/image/).
  Direct catalog fetch was restricted, so final year/publisher confirmation still
  needs owner review/indicia rather than an invented certainty.

These archived books cover older material and difficult identification; they do
not establish a verified variant or scarce slot. New representative comics, a
timed manual baseline, actual owner corrections/review, ordinary-Chat attachment
and recovery acceptance, and explicitly approved publication are still required.
Cards and independent external Vault Sync remain outstanding. Raw private photos,
inventory records and provider responses are excluded from Git. Sanitized measured
data: [JSON](2026-10-15-archived-research.json).
