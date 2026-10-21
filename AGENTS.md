# Ballard engineering handoff

Read README.md, docs/SYSTEM.md, docs/INDEPENDENCE.md and docs/RECOVERY.md first. GitHub Issues and committed documentation are the durable work record; ChatGPT memory is optional context, never the only specification.

The private runtime repositories currently remain deployment sources. Before runtime edits, inspect their current remote heads and this repository's source-lock.json. Work on an isolated branch, preserve concurrent work and never force-push. Refresh the public source checkpoint after each verified milestone; record exact upstream and public commits. Do not promote this snapshot to production without its deployment and restore gates.

Keep runtime code, schemas, migrations, prompts, model interfaces, synthetic tests, operational rules and runbooks portable. Do not add a ChatGPT session, Pro subscription, CDP account or vendor-specific agent memory as a required app dependency. CDP replacement takes priority over changing AI vendors.

Never publish credentials, customer data, private inventory exports, runtime databases, raw operational backups, internal deployment URLs or unsanitized incident logs. Never publish old private Git history without reviewing it separately. Read nested AGENTS.md files when modifying their subtrees; their old canonical repository references describe the current deployment transition, not permission to discard this public handoff.

Preserve exact master SKUs, originals, storage locations, independent CollX prices and confirmed sales. A missing listing is not proof of a sale. Keep marketplace approval bound to the exact reviewed revision. Development authorization is not listing approval. Do not send the prepared CollX access request or other messages without explicit authorization.

Run meaningful affected tests and record limitations. A backup is complete only after a durable destination confirms it, checksum verification passes, and its restore result is documented. Test recovery in an isolated empty destination with marketplace and paid AI writes disabled. Do not restore over live data. Every unresolved capability or access limit belongs in an issue with acceptance criteria.
