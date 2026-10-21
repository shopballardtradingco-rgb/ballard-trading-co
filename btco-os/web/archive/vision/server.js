require("dotenv").config();

const express = require("express");
const multer = require("multer");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const upload = multer({
    limits: {
        fileSize: 20 * 1024 * 1024
    }
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// --------------------------------------------------
// INVENTORY
// --------------------------------------------------

const inventoryFile = path.join(
    __dirname,
    "inventory-export-57633-2026-09-26-030402(1).csv"
);

let inventory = [];

function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '"') {
            if (quoted && text[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (char === "," && !quoted) {
            row.push(field);
            field = "";
        } else if (
            (char === "\n" || char === "\r") &&
            !quoted
        ) {
            if (
                char === "\r" &&
                text[i + 1] === "\n"
            ) {
                i++;
            }

            row.push(field);
            field = "";

            if (
                row.some(
                    value => value.trim() !== ""
                )
            ) {
                rows.push(row);
            }

            row = [];
        } else {
            field += char;
        }
    }

    if (field.length || row.length) {
        row.push(field);
        rows.push(row);
    }

    if (rows.length < 2) {
        return [];
    }

    const headers =
        rows[0].map(
            header => header.trim()
        );

    return rows
        .slice(1)
        .map(values => {
            const record = {};

            headers.forEach(
                (header, index) => {
                    record[header] =
                        values[index] ?? "";
                }
            );

            return record;
        });
}

function loadInventory() {
    try {
        const csv = fs.readFileSync(
            inventoryFile,
            "utf8"
        );

        inventory = parseCSV(csv);

        console.log(
            `📦 Loaded ${inventory.length} BTCo inventory records`
        );

    } catch (error) {

        console.error(
            "❌ Inventory load failed:",
            error.message
        );

        inventory = [];
    }
}

loadInventory();

// --------------------------------------------------
// NORMALIZATION
// --------------------------------------------------

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

// --------------------------------------------------
// INVENTORY OUTPUT
// --------------------------------------------------

function summarizeInventoryItem(
    item,
    match
) {
    return {
        id:
            item.ID || "",

        sku:
            item.SKU || "",

        title:
            item.Title || "",

        player:
            item.Player || "",

        year:
            item.Year || "",

        set:
            item.Set || "",

        number:
            item.Number || "",

        team:
            item.Team || "",

        sport:
            item.Sport || "",

        quantity:
            Number(
                item.Quantity
            ) || 0,

        askingPrice:
            Number(
                item["Start Price"]
            ) || 0,

        purchasePrice:
            Number(
                item["Purchase Price"]
            ) || 0,

        status:
            item.Status || "",

        cabinet:
            item.Cabinet || "",

        shelf:
            item.Shelf || "",

        box:
            item.Box || "",

        row:
            item.Row || "",

        section:
            item.Section || "",

        ebayStatus:
            item["eBay Status"] || "",

        ebayQuantity:
            Number(
                item[
                    "eBay Quantity Available"
                ]
            ) || 0,

        collxStatus:
            item["CollX Status"] || "",

        collxQuantity:
            Number(
                item[
                    "CollX Quantity Available"
                ]
            ) || 0,

        whatnotStatus:
            item["Whatnot Status"] || "",

        whatnotQuantity:
            Number(
                item[
                    "Whatnot Quantity Available"
                ]
            ) || 0,

        matchScore:
            match.score,

        matchLevel:
            match.matchLevel,

        matchReasons:
            match.reasons,

        conflicts:
            match.conflicts
    };
}

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get(
    "/",
    (req, res) => {

        res.json({
            status:
                "BTCo Vision server is running",

            version:
                "0.5",

            inventoryRecords:
                inventory.length
        });
    }
);

// --------------------------------------------------
// CARD IDENTIFICATION
// --------------------------------------------------

app.post(
    "/scan-card",

    upload.fields([
        {
            name: "front",
            maxCount: 1
        },
        {
            name: "back",
            maxCount: 1
        }
    ]),

    async (req, res) => {

        try {

            const front =
                req.files?.front?.[0];

            const back =
                req.files?.back?.[0];

            if (!front || !back) {

                return res
                    .status(400)
                    .json({
                        success: false,

                        error:
                            "Both front and back images are required."
                    });
            }

            const frontBase64 =
                front.buffer.toString(
                    "base64"
                );

            const backBase64 =
                back.buffer.toString(
                    "base64"
                );

            const response =
                await openai.responses.create({

                    model:
                        "gpt-5.4-mini",

                    input: [{
                        role: "user",

                        content: [
                            {
                                type:
                                    "input_text",

                                text: `
You are BTCo Vision.

IMAGE 1 is the FRONT of a trading card.
IMAGE 2 is the BACK of the same card.

Identify the exact card as precisely as possible.

Prioritize printed evidence from the card itself.

Pay special attention to:
- player
- copyright year
- manufacturer
- exact set
- exact card number
- parallel or variation
- refractor or foil treatment
- serial numbering
- rookie designation
- autograph
- relic
- grading label

Do not invent information.

Use an empty string for unknown text fields.

Confidence must be:
HIGH
MEDIUM
LOW

Notes should briefly explain the strongest evidence
used for identification and any uncertainty.
`
                            },

                            {
                                type:
                                    "input_image",

                                image_url:
                                    `data:${front.mimetype};base64,${frontBase64}`,

                                detail:
                                    "high"
                            },

                            {
                                type:
                                    "input_image",

                                image_url:
                                    `data:${back.mimetype};base64,${backBase64}`,

                                detail:
                                    "high"
                            }
                        ]
                    }],

                    text: {
                        format: {

                            type:
                                "json_schema",

                            name:
                                "btco_card_identification",

                            strict:
                                true,

                            schema: {
                                type:
                                    "object",

                                properties: {

                                    player: {
                                        type: "string"
                                    },

                                    year: {
                                        type: "string"
                                    },

                                    manufacturer: {
                                        type: "string"
                                    },

                                    set: {
                                        type: "string"
                                    },

                                    cardNumber: {
                                        type: "string"
                                    },

                                    team: {
                                        type: "string"
                                    },

                                    sport: {
                                        type: "string"
                                    },

                                    parallel: {
                                        type: "string"
                                    },

                                    serialNumber: {
                                        type: "string"
                                    },

                                    rookie: {
                                        type: "boolean"
                                    },

                                    autograph: {
                                        type: "boolean"
                                    },

                                    relic: {
                                        type: "boolean"
                                    },

                                    graded: {
                                        type: "boolean"
                                    },

                                    gradingCompany: {
                                        type: "string"
                                    },

                                    grade: {
                                        type: "string"
                                    },

                                    confidence: {
                                        type: "string",

                                        enum: [
                                            "HIGH",
                                            "MEDIUM",
                                            "LOW"
                                        ]
                                    },

                                    notes: {
                                        type: "string"
                                    }
                                },

                                required: [
                                    "player",
                                    "year",
                                    "manufacturer",
                                    "set",
                                    "cardNumber",
                                    "team",
                                    "sport",
                                    "parallel",
                                    "serialNumber",
                                    "rookie",
                                    "autograph",
                                    "relic",
                                    "graded",
                                    "gradingCompany",
                                    "grade",
                                    "confidence",
                                    "notes"
                                ],

                                additionalProperties:
                                    false
                            }
                        }
                    }
                });

            const card =
                JSON.parse(
                    response.output_text
                );

            res.json({
                success: true,
                card
            });

        } catch (error) {

            console.error(
                "BTCo Vision error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// --------------------------------------------------
// INVENTORY LOOKUP
// --------------------------------------------------

app.post(
    "/check-inventory",

    (req, res) => {

        try {

            const card =
                req.body;

            if (
                !card ||
                !card.player
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Card identification is required."
                    });
            }

            const scored =
                inventory
                    .map(item => {

                        const match =
                            scoreInventoryRecord(
                                item,
                                card
                            );

                        return {
                            item,
                            match
                        };
                    })

                    // Don't even show weak
                    // same-player noise.
                    .filter(
                        result =>
                            result.match.score >= 45
                    )

                    .sort(
                        (a, b) =>
                            b.match.score -
                            a.match.score
                    );

            const matches =
                scored
                    .slice(0, 8)
                    .map(result =>
                        summarizeInventoryItem(
                            result.item,
                            result.match
                        )
                    );

            const exactMatches =
                matches.filter(
                    item =>
                        item.matchLevel ===
                        "EXACT"
                );

            const strongMatches =
                matches.filter(
                    item =>
                        item.matchLevel ===
                        "STRONG"
                );

            res.json({
                success: true,

                found:
                    exactMatches.length > 0,

                exactMatchCount:
                    exactMatches.length,

                strongMatchCount:
                    strongMatches.length,

                candidateCount:
                    matches.length,

                bestScore:
                    matches[0]
                        ?.matchScore || 0,

                matches
            });

        } catch (error) {

            console.error(
                "Inventory lookup error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// --------------------------------------------------
// START
// --------------------------------------------------

const PORT = 3000;

app.listen(
    PORT,
    "0.0.0.0",

    () => {

        console.log("");

        console.log(
            "🔥 BTCo Vision V0.5 running"
        );

        console.log(
            `📡 Port: ${PORT}`
        );

        console.log(
            `📦 Inventory: ${inventory.length} records`
        );

        console.log(
            "🎯 Smart inventory matching enabled"
        );

        console.log("");
    }
);
// ==================================================
// V0.6 — EBAY ACTIVE MARKET COMPS
// ==================================================

let ebayTokenCache = {
    token: null,
    expiresAt: 0
};

async function getEbayToken() {
    const now = Date.now();

    if (
        ebayTokenCache.token &&
        now < ebayTokenCache.expiresAt
    ) {
        return ebayTokenCache.token;
    }

    const clientId =
        process.env.EBAY_CLIENT_ID;

    const clientSecret =
        process.env.EBAY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error(
            "eBay credentials are missing from .env"
        );
    }

    const credentials =
        Buffer.from(
            `${clientId}:${clientSecret}`
        ).toString("base64");

    const response = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
            method: "POST",

            headers: {
                "Authorization":
                    `Basic ${credentials}`,

                "Content-Type":
                    "application/x-www-form-urlencoded"
            },

            body:
                "grant_type=client_credentials&scope=" +
                encodeURIComponent(
                    "https://api.ebay.com/oauth/api_scope"
                )
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            `eBay OAuth failed: ${JSON.stringify(data)}`
        );
    }

    ebayTokenCache.token =
        data.access_token;

    // Refresh five minutes early.
    ebayTokenCache.expiresAt =
        now +
        Math.max(
            60,
            (data.expires_in || 7200) - 300
        ) * 1000;

    return data.access_token;
}

// --------------------------------------------------
// CARD IDENTITY VALIDATION
// --------------------------------------------------

function validateCardIdentity(card) {
    const warnings = [];

    let safeCardNumber =
        String(card.cardNumber || "").trim();

    // Catch impossible readings such as
    // "Card #114 of 19".
    const notes =
        String(card.notes || "");

    const ofMatch =
        notes.match(
            /(?:card\s*)?#?\s*(\d+)\s+of\s+(\d+)/i
        );

    if (ofMatch) {
        const printedNumber =
            Number(ofMatch[1]);

        const setTotal =
            Number(ofMatch[2]);

        if (
            Number.isFinite(printedNumber) &&
            Number.isFinite(setTotal) &&
            printedNumber > setTotal
        ) {
            warnings.push(
                `Possible card-number misread: ${printedNumber} cannot be card ${printedNumber} of a ${setTotal}-card set.`
            );

            // Don't poison the eBay search
            // with an impossible number.
            safeCardNumber = "";
        }
    }

    return {
        safeCardNumber,
        warnings
    };
}

// --------------------------------------------------
// EBAY QUERY
// --------------------------------------------------

function buildEbayQuery(
    card,
    safeCardNumber
) {
    const parts = [];

    if (card.year) {
        parts.push(card.year);
    }

    if (card.manufacturer) {
        parts.push(card.manufacturer);
    }

    if (card.player) {
        parts.push(card.player);
    }

    if (card.set) {
        parts.push(card.set);
    }

    if (safeCardNumber) {
        parts.push(`#${safeCardNumber}`);
    }

    if (card.parallel) {
        parts.push(card.parallel);
    }

    if (card.autograph) {
        parts.push("auto");
    }

    if (card.graded) {
        if (card.gradingCompany) {
            parts.push(card.gradingCompany);
        }

        if (card.grade) {
            parts.push(card.grade);
        }
    }

    return parts
        .filter(Boolean)
        .join(" ");
}

// --------------------------------------------------
// EBAY RESULT MATCHING
// --------------------------------------------------

function ebayListingScore(
    listing,
    card,
    safeCardNumber
) {
    const title =
        String(listing.title || "");

    let score = 0;
    const reasons = [];
    const conflicts = [];

    if (
        card.player &&
        loose(title, card.player)
    ) {
        score += 35;
        reasons.push("player");
    } else if (card.player) {
        score -= 50;
        conflicts.push("player");
    }

    if (card.year) {
        if (loose(title, card.year)) {
            score += 20;
            reasons.push("year");
        }
    }

    if (card.manufacturer) {
        if (
            loose(
                title,
                card.manufacturer
            )
        ) {
            score += 8;
            reasons.push("manufacturer");
        }
    }

    if (card.set) {
        const setWords =
            String(card.set)
                .split(/\s+/)
                .filter(
                    word =>
                        clean(word).length >= 4
                );

        const hits =
            setWords.filter(
                word =>
                    loose(title, word)
            ).length;

        if (
            setWords.length &&
            hits >= Math.ceil(
                setWords.length / 2
            )
        ) {
            score += 18;
            reasons.push("set");
        }
    }

    if (safeCardNumber) {
        const number =
            clean(safeCardNumber);

        const normalizedTitle =
            clean(title);

        if (
            normalizedTitle.includes(
                number
            )
        ) {
            score += 25;
            reasons.push("card number");
        }
    }

    if (card.parallel) {
        if (
            loose(
                title,
                card.parallel
            )
        ) {
            score += 15;
            reasons.push("parallel");
        }
    }

    if (card.autograph) {
        if (
            /\bauto(graph(ed)?)?\b/i
                .test(title)
        ) {
            score += 15;
            reasons.push("autograph");
        } else {
            score -= 20;
            conflicts.push("autograph");
        }
    }

    if (card.graded) {
        if (
            card.gradingCompany &&
            loose(
                title,
                card.gradingCompany
            )
        ) {
            score += 12;
            reasons.push("grader");
        }

        if (
            card.grade &&
            loose(
                title,
                card.grade
            )
        ) {
            score += 8;
            reasons.push("grade");
        }
    }

    // Raw card: avoid obvious graded listings.
    if (
        !card.graded &&
        /\b(PSA|BGS|SGC|CGC|CSG)\s*[0-9]/i
            .test(title)
    ) {
        score -= 30;
        conflicts.push("graded");
    }

    score =
        Math.max(
            0,
            Math.min(150, score)
        );

    return {
        score,
        reasons,
        conflicts
    };
}

// --------------------------------------------------
// PRICE STATS
// --------------------------------------------------

function median(values) {
    if (!values.length) {
        return 0;
    }

    const sorted =
        [...values].sort(
            (a, b) => a - b
        );

    const middle =
        Math.floor(
            sorted.length / 2
        );

    if (
        sorted.length % 2 === 0
    ) {
        return (
            sorted[middle - 1] +
            sorted[middle]
        ) / 2;
    }

    return sorted[middle];
}

function roundMoney(value) {
    return Math.round(
        value * 100
    ) / 100;
}

// --------------------------------------------------
// FIND COMPS ENDPOINT
// --------------------------------------------------

app.post(
    "/find-comps",
    async (req, res) => {

        try {
            const card = req.body;

            if (
                !card ||
                !card.player
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Card identification is required."
                    });
            }

            const validation =
                validateCardIdentity(card);

            const query =
                buildEbayQuery(
                    card,
                    validation.safeCardNumber
                );

            const token =
                await getEbayToken();

            const params =
                new URLSearchParams({
                    q: query,
                    limit: "50"
                });

            const ebayURL =
                "https://api.ebay.com/buy/browse/v1/item_summary/search?" +
                params.toString();

            const ebayResponse =
                await fetch(
                    ebayURL,
                    {
                        headers: {
                            "Authorization":
                                `Bearer ${token}`,

                            "X-EBAY-C-MARKETPLACE-ID":
                                "EBAY_US",

                            "Accept":
                                "application/json"
                        }
                    }
                );

            const ebayData =
                await ebayResponse.json();

            if (!ebayResponse.ok) {
                return res
                    .status(
                        ebayResponse.status
                    )
                    .json({
                        success: false,
                        error:
                            "eBay Browse API request failed.",
                        ebayStatus:
                            ebayResponse.status,
                        details:
                            ebayData
                    });
            }

            const rawItems =
                ebayData.itemSummaries || [];

            const candidates =
                rawItems
                    .map(item => {

                        const match =
                            ebayListingScore(
                                item,
                                card,
                                validation.safeCardNumber
                            );

                        const price =
                            Number(
                                item.price?.value
                            ) || 0;

                        const shipping =
                            Number(
                                item.shippingOptions?.[0]
                                    ?.shippingCost
                                    ?.value
                            ) || 0;

                        return {
                            itemId:
                                item.itemId || "",

                            title:
                                item.title || "",

                            price,

                            shipping,

                            deliveredPrice:
                                roundMoney(
                                    price + shipping
                                ),

                            condition:
                                item.condition || "",

                            buyingOptions:
                                item.buyingOptions || [],

                            itemWebUrl:
                                item.itemWebUrl || "",

                            image:
                                item.image?.imageUrl || "",

                            seller:
                                item.seller
                                    ?.username || "",

                            score:
                                match.score,

                            reasons:
                                match.reasons,

                            conflicts:
                                match.conflicts
                        };
                    })

                    .filter(
                        item =>
                            item.price > 0 &&
                            item.score >= 55
                    )

                    .sort(
                        (a, b) =>
                            b.score - a.score
                    );

            // Use the strongest relevant
            // listings for price stats.
            const strongest =
                candidates.filter(
                    item =>
                        item.score >= 70
                );

            const pricingPool =
                strongest.length >= 3
                    ? strongest
                    : candidates;

            const prices =
                pricingPool
                    .map(
                        item =>
                            item.deliveredPrice
                    )
                    .filter(
                        price =>
                            price > 0
                    );

            const sortedPrices =
                [...prices].sort(
                    (a, b) => a - b
                );

            const low =
                sortedPrices[0] || 0;

            const high =
                sortedPrices[
                    sortedPrices.length - 1
                ] || 0;

            const marketMedian =
                roundMoney(
                    median(sortedPrices)
                );

            // Active-market starting point,
            // NOT a sold-comp valuation.
            const suggestedList =
                marketMedian > 0
                    ? roundMoney(
                        marketMedian * 1.05
                    )
                    : 0;

            const quickSale =
                marketMedian > 0
                    ? roundMoney(
                        marketMedian * 0.90
                    )
                    : 0;

            let confidence = "LOW";

            if (
                pricingPool.length >= 8
            ) {
                confidence = "HIGH";

            } else if (
                pricingPool.length >= 3
            ) {
                confidence = "MEDIUM";
            }

            res.json({
                success: true,

                source:
                    "eBay active listings",

                soldData:
                    false,

                query,

                warnings:
                    validation.warnings,

                resultCount:
                    rawItems.length,

                relevantCount:
                    candidates.length,

                pricingCount:
                    pricingPool.length,

                market: {
                    low:
                        roundMoney(low),

                    median:
                        marketMedian,

                    high:
                        roundMoney(high),

                    suggestedList,

                    quickSale,

                    confidence
                },

                listings:
                    candidates.slice(
                        0,
                        12
                    )
            });

        } catch (error) {

            console.error(
                "Find comps error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);
