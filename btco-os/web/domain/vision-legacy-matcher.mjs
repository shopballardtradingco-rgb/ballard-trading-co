// Ported without semantic changes from BTCo_server_V6_PSA_Cache.js. See docs/vision-sources.json.
function clean(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function same(a, b) {
    const x = clean(a);
    const y = clean(b);

    return !!x && !!y && x === y;
}

function loose(a, b) {
    const x = clean(a);
    const y = clean(b);

    if (!x || !y) {
        return false;
    }

    return (
        x.includes(y) ||
        y.includes(x)
    );
}

function titleContains(
    item,
    value
) {
    return loose(
        item.Title,
        value
    );
}

// --------------------------------------------------
// SMART INVENTORY MATCHER
// --------------------------------------------------

function scoreInventoryRecord(
    item,
    card
) {
    let score = 0;

    const reasons = [];
    const conflicts = [];

    // -------------------------
    // PLAYER
    // -------------------------

    if (
        card.player &&
        same(
            item.Player,
            card.player
        )
    ) {
        score += 35;
        reasons.push("exact player");

    } else if (
        card.player &&
        titleContains(
            item,
            card.player
        )
    ) {
        score += 28;
        reasons.push("player in title");

    } else if (card.player) {

        // Wrong player means this should
        // almost never survive.
        score -= 60;
        conflicts.push("player");
    }

    // -------------------------
    // YEAR
    // -------------------------

    if (card.year) {

        if (
            item.Year &&
            same(
                item.Year,
                card.year
            )
        ) {
            score += 25;
            reasons.push("exact year");

        } else if (
            titleContains(
                item,
                card.year
            )
        ) {
            score += 18;
            reasons.push("year in title");

        } else if (
            item.Year
        ) {
            score -= 35;
            conflicts.push("year");
        }
    }

    // -------------------------
    // CARD NUMBER
    // -------------------------

    if (card.cardNumber) {

        if (
            item.Number &&
            same(
                item.Number,
                card.cardNumber
            )
        ) {
            score += 35;
            reasons.push(
                "exact card number"
            );

        } else if (
            titleContains(
                item,
                `#${card.cardNumber}`
            )
        ) {
            score += 28;
            reasons.push(
                "card number in title"
            );

        } else if (
            item.Number
        ) {
            score -= 40;
            conflicts.push(
                "card number"
            );
        }
    }

    // -------------------------
    // SET
    // -------------------------

    if (card.set) {

        if (
            item.Set &&
            same(
                item.Set,
                card.set
            )
        ) {
            score += 25;
            reasons.push("exact set");

        } else if (
            item.Set &&
            loose(
                item.Set,
                card.set
            )
        ) {
            score += 18;
            reasons.push("set");

        } else if (
            titleContains(
                item,
                card.set
            )
        ) {
            score += 12;
            reasons.push(
                "set in title"
            );

        } else if (
            item.Set
        ) {
            score -= 15;
            conflicts.push("set");
        }
    }

    // -------------------------
    // MANUFACTURER
    // -------------------------

    if (
        card.manufacturer &&
        (
            loose(
                item.Set,
                card.manufacturer
            ) ||
            titleContains(
                item,
                card.manufacturer
            )
        )
    ) {
        score += 7;
        reasons.push("manufacturer");
    }

    // -------------------------
    // TEAM
    // -------------------------

    if (
        card.team &&
        same(
            item.Team,
            card.team
        )
    ) {
        score += 5;
        reasons.push("team");
    }

    // -------------------------
    // SPORT
    // -------------------------

    if (
        card.sport &&
        same(
            item.Sport,
            card.sport
        )
    ) {
        score += 5;
        reasons.push("sport");
    }

    // -------------------------
    // PARALLEL
    // -------------------------

    if (card.parallel) {

        if (
            titleContains(
                item,
                card.parallel
            ) ||
            loose(
                item.Set,
                card.parallel
            )
        ) {
            score += 15;
            reasons.push("parallel");
        }
    }

    // -------------------------
    // SERIAL NUMBER
    // -------------------------

    if (card.serialNumber) {

        if (
            same(
                item["Serial Number"],
                card.serialNumber
            )
        ) {
            score += 50;
            reasons.push(
                "exact serial number"
            );

        } else if (
            item["Serial Number"]
        ) {
            score -= 60;
            conflicts.push(
                "serial number"
            );
        }
    }

    // Keep score readable.
    score = Math.max(
        0,
        Math.min(
            150,
            score
        )
    );

    // -------------------------
    // MATCH CLASS
    // -------------------------

    let matchLevel = "POSSIBLE";

    const identityConflict =
        conflicts.includes("player") ||
        conflicts.includes("year") ||
        conflicts.includes("card number") ||
        conflicts.includes("serial number");

    if (
        score >= 100 &&
        !identityConflict
    ) {
        matchLevel = "EXACT";

    } else if (
        score >= 75 &&
        !identityConflict
    ) {
        matchLevel = "STRONG";
    }

    return {
        score,
        matchLevel,
        reasons,
        conflicts
    };
}


export {clean, same, loose, scoreInventoryRecord};
