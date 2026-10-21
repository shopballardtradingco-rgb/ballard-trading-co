# BTCore 0.2.1 — optional open workspace

Owner request: keep the current design and skip logins for now. Scope: the standalone Railway development service only.

- `BTCORE_ACCESS_MODE=open` opens directly into the shared workspace with no setup or login form. Password and sign-out controls are hidden in this mode.
- Existing bulk intake, one-photo card rules, inventory, original photos and owner IDs remain intact. There are no marketplace operations or schema changes.
- Open mode lets anyone with the URL view and edit the workspace. Settings states this clearly. Same-origin and CSRF checks remain active.
- Default access remains private. Changing the variable back to `private` invalidates open access immediately on the new runtime. Open cookies are separate from authenticated sessions and are not stored in the password-session table.
- If open mode was used before account setup, private setup claims the same owner row, retaining photo ownership and records. Existing account credentials are never overwritten.

Validation: API tests cover automatic entry, session tampering, cross-site/CSRF rejection, restart persistence, existing account preservation, disabling open access, and private setup retaining original photos. Browser acceptance covers desktop/mobile entry, no password UI, saved inventory after refresh, fresh-browser access, and the existing card bulk-upload screen.
