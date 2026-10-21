"""Build a credential-free, revision-bound ChatGPT review button.

Display beside the complete saved listing review and both original photographs.
This sends owner intent to chat; only the authenticated connector records approval.
"""
import argparse
import html
import json
from pathlib import Path

from btco_ebay.listing_drafts import ListingDraft


def build(row: dict) -> str:
    draft = ListingDraft.model_validate(row["draft"])
    revision = draft.revision()
    if row.get("revision") != revision:
        raise ValueError("Saved review revision does not match its content")
    if row.get("state") != "draft" or row.get("job") or row.get("approval"):
        raise ValueError("Only an unpublished, unapproved draft may request approval")
    offer = ("On; minimum $" + str(draft.best_offer.minimum_offer_usd)
             if draft.best_offer.enabled else "Off")
    prompt = (f"I reviewed and approve the complete listing and original front/back photographs "
              f"for draft {draft.draft_id}, exact revision {revision}. "
              f"Title: {draft.title}. Price: ${draft.price_usd}. Offers: {offer}. "
              "Publish this exact revision after checking the current saved draft and duplicate status. "
              "If it has changed, show me the revised listing for a new approval.")
    payload = json.dumps({"prompt": prompt, "title": "Approve this listing",
                          "context": {"draft_id": draft.draft_id, "revision": revision}},
                         ensure_ascii=True).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return f'''<section class="btco-approval" aria-label="Listing approval">
<style>.btco-approval{{font:16px system-ui,sans-serif;color:var(--color-text-primary,#202523);padding:20px;border:1px solid var(--color-border-secondary,#ccd3cd);border-radius:12px}}.btco-approval h3{{margin:0 0 10px}}.btco-approval label{{display:block;margin:16px 0;line-height:1.5}}.btco-approval button{{background:#245b41;color:white;padding:12px 18px;border:0;border-radius:8px;font:inherit;cursor:pointer}}.btco-approval button:disabled{{opacity:.5;cursor:default}}.btco-approval [role=status]{{font-size:14px;line-height:1.5}}</style>
<h3>{html.escape(draft.title)}</h3>
<p>${html.escape(str(draft.price_usd))} · Offers {html.escape(offer.lower())} · {html.escape(draft.condition.replace('USED_', '').title())}</p>
<label><input id="btco-reviewed" type="checkbox"> I reviewed the complete listing and both original photos shown with this review.</label>
<button id="btco-approve" type="button" disabled>Approve this listing</button>
<p id="btco-approval-status" role="status" aria-live="polite">Review the listing above, then check the box to approve.</p>
<script type="application/json" id="btco-approval-payload">{payload}</script>
<script>(() => {{
const checkbox=document.getElementById('btco-reviewed'),button=document.getElementById('btco-approve'),status=document.getElementById('btco-approval-status');
const available=()=>typeof window.openai?.sendFollowUpMessage==='function';
const refresh=()=>{{button.disabled=!checkbox.checked||!available();if(!available())status.textContent='Open this review in ChatGPT to use the approval button.';}};
checkbox.addEventListener('change',refresh);window.addEventListener('openai:set_globals',refresh);refresh();
button.addEventListener('click',async event=>{{
 if(!event.isTrusted||!navigator.userActivation?.isActive||!checkbox.checked||button.disabled||!available())return;
 button.disabled=true;checkbox.disabled=true;
 try{{await window.openai.sendFollowUpMessage(JSON.parse(document.getElementById('btco-approval-payload').textContent));status.textContent='Approval request sent to chat. Publication will be confirmed there after verification.';}}
 catch{{checkbox.disabled=false;status.textContent='Approval could not be sent. Please try again.';refresh();}}
}});
}})();</script>
</section>'''


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("saved_draft", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(build(json.loads(args.saved_draft.read_text())))
