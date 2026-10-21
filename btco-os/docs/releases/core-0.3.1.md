# BTCore 0.3.1 — bulk card approval

The review screen could submit a batch but required checking every card individually. **Intake → Review & export → Select all ready** now selects all eligible cards, up to 500. Deselect exceptions if needed, choose **Approve selected (N)**, and confirm the whole selection once. Clear selection resets the batch. A sticky toolbar keeps counts and actions visible while scrolling on phones and desktops.

Missing identity, price, condition, location or required photos still block approval. Preparing and already-approved cards are excluded. The confirmation acknowledges review for the whole selected batch; individual checkboxes are selection controls, not separate mandatory attestations. The UI shows how many cards are ready, need attention or are preparing.

The browser sends a SHA-256 fingerprint of each selected card's exact content. This avoids the prior 1 MiB request limit for large selections containing long descriptions. The server validates every fingerprint and existing photo/detail rules before approving anything. A concurrent edit rejects the entire approval. Existing clients sending exact content remain compatible. Original photos, SKUs, prices, physical inventory, CDP column mapping and publishing behavior remain unchanged. There is no database migration.

Validation: 500-card compact approval; stale title, price and photo atomic rejection; incomplete and queued-card rejection; edit revocation; mobile mixed batch upload/preparation, select-all, deselect, clear/cancel, sticky controls, exact selected export, persistence and externally retrievable images. Mobile 390px and desktop 1440px screenshots were inspected. Full repository, PostgreSQL and container acceptance run before automatic release promotion.
