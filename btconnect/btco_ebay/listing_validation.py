"""Current entry requirements; historical serialized drafts remain unchanged."""
from copy import deepcopy
from pydantic import ValidationError
from .listing_drafts import ListingDraft, UNINSPECTED_INTERIOR_DISCLOSURE

NEW_INTERIOR_DISCLOSURE = (
    "Page quality, hidden defects, and the presence of inserts, cards, posters or other extras are unverified."
)
REQUIRED_DISCLOSURES = {
    "description": [UNINSPECTED_INTERIOR_DISCLOSURE, NEW_INTERIOR_DISCLOSURE],
    "condition_description": [UNINSPECTED_INTERIOR_DISCLOSURE],
}

def validate_new_standards(draft):
    if getattr(draft, "product_type", None) == "card":
        return
    # Keep the historical model/revision stable. Apply today's stricter entry
    # rules to new review drafts, without rewriting old approvals or journals.
    if draft.condition not in ("USED_GOOD", "USED_ACCEPTABLE"):
        raise ValueError("New comic drafts require Good or Acceptable condition")
    if draft.price_usd == "5":
        if draft.best_offer.enabled:
            raise ValueError("Five-dollar comic drafts require Best Offer OFF")
    elif not draft.best_offer.enabled:
        raise ValueError("Other new comic drafts require Best Offer with an explicit minimum")
    if draft.packed_parcel is None:
        raise ValueError("New comic drafts require a measured or authorized estimated packed parcel")
    if draft.inspection.scope == "exterior_only" and NEW_INTERIOR_DISCLOSURE not in draft.description:
        raise ValueError("Disclose unverified page quality, hidden defects and extras")


def prepare_text(data):
    """Only add required disclosures before review; never invent inspection evidence."""
    result = deepcopy(data)
    changes = []
    if isinstance(result.get("inspection"), dict) and result["inspection"].get("scope") == "exterior_only":
        for field, sentences in REQUIRED_DISCLOSURES.items():
            text = result.get(field)
            if isinstance(text, str) and text.strip():
                for sentence in sentences:
                    if sentence not in text:
                        text = text.rstrip() + " " + sentence
                        changes.append({"field": field, "added": sentence})
                result[field] = text
    return result, changes


def validation_errors(error):
    if isinstance(error, ValidationError):
        return [{"path": list(e["loc"]), "type": e["type"], "message": e["msg"]}
                for e in error.errors(include_input=False, include_context=False, include_url=False)]
    return [{"path": [], "message": str(error) if isinstance(error, ValueError)
             else "Operation interrupted; resume from saved state"}]

