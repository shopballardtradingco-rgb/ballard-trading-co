"""Published package data and transparent assumptions; no automatic draft approval."""

from decimal import Decimal

from .listing_drafts import PackedParcel


def gemini_single_comic_profile():
    """An estimate for one ordinary raw single issue, not a slab, TPB or bundle."""
    board = Decimal("4.30") * 16 / 100
    bag = Decimal("1.13") * 16 / 100
    components = {
        "mailer_published_oz": "4.8",
        "comic_allowance_oz": "3",
        "board_estimate_oz": str(board),
        "bag_estimate_oz": str(bag),
        "tape_and_label_allowance_oz": "0.5",
    }
    subtotal = sum(Decimal(value) for value in components.values())
    return {
        "profile_id": "gemini-flash-single-comic-estimate-v1",
        "basis": "owner_authorized_estimate",
        "verified": False,
        "scope": "One standard ungraded comic, one bag and backing board, standard Gemini Comic Flash Mailer, tape and label",
        "exclusions": "Not a graded slab, trade paperback, multiple-comic order, or a larger Gemini mailer; additional packing can change weight",
        "weight_oz": "12",
        "length_in": "13",
        "width_in": "8",
        "height_in": "2",
        "components": components,
        "subtotal_oz": str(subtotal),
        "buffer_oz": str(Decimal("12") - subtotal),
        "evidence": (
            "Estimate, not a scale measurement. Standard Gemini Flash Mailer: manufacturer weight 4.8 oz, "
            "outside size 12.75 x 7.75 x up to 1.25 in. Allow 3 oz for an ordinary single comic; "
            "published 32-page examples weigh 2-4 oz, not evidence of this copy's exact weight. "
            "BCW pack weights imply about 0.688 oz per board (4.30 lb/100) and 0.1808 oz per bag "
            "(1.13 lb/100); pack packaging may be included. Tape/label allowance 0.5 oz. "
            "Estimated sum 9.1688 oz; use 12 oz with buffer. Round manufacturer outside maxima up "
            "to 13 x 8 x 2 in. Final postage uses actual packed weight."
        ),
        "source_urls": [
            "https://geminicomicsupply.com/collections/featured-products/products/comic-flash-mailers-1",
            "https://www.bcwsupplies.com/current-comic-book-backing-boards",
            "https://www.bcwsupplies.com/modern-current-comic-book-bags",
            "https://prhcomics.com/book/?isbn=75960620920003216",
            "https://prhcomics.com/book/?isbn=75960621774803211",
        ],
        "sources_checked_on": "2026-10-12",
        "requires_owner_estimate_authorization": True,
    }


def authorized_gemini_parcel(owner_authorization):
    """Caller must supply actual owner permission; this never approves a listing."""
    profile = gemini_single_comic_profile()
    fields = ("weight_oz", "length_in", "width_in", "height_in", "basis", "verified", "evidence")
    return PackedParcel.model_validate({
        **{key: profile[key] for key in fields},
        "estimate": {
            "owner_authorization": owner_authorization,
            "source_urls": profile["source_urls"],
        },
    })
