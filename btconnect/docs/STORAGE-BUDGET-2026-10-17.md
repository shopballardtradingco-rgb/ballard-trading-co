# Cloud budget and photo capacity — 2026-10-17

## Owner direction
Tim authorized "$20 to start" after reviewing monthly cloud budgets. Treat $20/month as the total initial cloud operating budget across BTConnect and BTCore, including existing hosting. This is an operating budget, not evidence of a provider-enforced billing limit. No billing limit was changed by this patch.

## Immediate scope
BTConnect's existing 500 MB Railway volume is approximately 203 MB used. Its 166 indexed originals occupy 112,279,145 source bytes and approximately 149,720,100 encrypted bytes. Fernet encoding explains why the 150 MB encrypted-photo quota stopped intake.

Raise the encrypted-photo quota to 300,000,000 bytes on the existing volume. Keep the 12 MB original-file limit, checksum checks, encryption, deduplication and the independent 50 MB free-disk reserve unchanged. No infrastructure resize, new service, subscription, migration, paid AI activation or listing publication is part of this change.

The 27 pending Area 88 originals total 15,733,084 bytes and approximately 20,979,840 encrypted bytes. Once saved, indexed encrypted originals should total 170,699,940 bytes. Verify each successful upload before reporting completion.

## Spending guidance
- Use existing compute capacity first; recent BTConnect usage was approximately 117 MB RAM with low CPU.
- Keep BTConnect and BTCore environments and data separate.
- Budget includes current hosting; paid AI remains off.
- Review actual provider charges and credits before adding services. The available Railway tools do not expose account billing controls.
- Railway container rates checked October 17: RAM $10/GB-month, CPU $20/vCPU-month, volume storage $0.15/GB-month. Plan credits apply; do not add the plan minimum twice.
- Filling the additional 150 MB photo allowance represents approximately $0.0225/month in volume storage at that rate, before included credits. Database, compute, network and other workspace usage remain separate components of the $20 total.

Source: https://docs.railway.com/pricing/plans

## Build impact and rollback
BTConnect only. BTCore services, data and staged changes are untouched. Roll back this code to the previous quota if necessary; keep all original files and records. Rolling back below used capacity prevents new uploads but does not remove saved photos.
