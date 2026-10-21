# Exact-revision approval button

For each future unpublished comic, show the complete saved draft and both original front/back photographs, followed by an **Approve this listing** control. Do not use a generic input-question widget for permission. Do not generate another control for a published item.

Generate the ChatGPT visualization fragment from a fresh `get_listing_draft` response:

```sh
PYTHONPATH=. .venv/bin/python scripts/review_approval.py /absolute/saved-draft.json /absolute/approval.html
```

Read the current visualization skill and render that small fragment inline beside the complete review. The original photo review remains required. The fragment contains no credentials, upload tickets or direct write calls. It refuses changed revisions, existing approvals and any publication job. It uses the supported `window.openai.sendFollowUpMessage` host capability, only from a real user click after checking the review box. Without that capability it stays disabled. A sent message means approval was requested, not that approval or publication succeeded.

On the resulting owner-authored message, retrieve the draft again. Compare its full revision with the clicked revision. If it changed, show the new complete review and a new button. If it matches, record exact-revision approval with `approve_listing_draft` using the user's message as evidence, then publish that same revision. Existing job/listing state must be inspected before retries. Never infer approval from local widget state, a screenshot, generating the button, or a programmatic click.

Approval covers price, offers, photos, description, condition, policies, authorized parcel estimates, promotion and SKU. Exactly $5 means offers off and no floor. An edit to any listing field requires renewed approval.

Synthetic tests verify revision binding, unsafe HTML escaping, disabled host fallback, real-click requirements and double-click suppression. The next new-comic review still needs a real owner click to verify host delivery end to end; this script does not claim that live acceptance has occurred.
