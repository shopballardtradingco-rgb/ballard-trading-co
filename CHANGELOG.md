# Maintenance checkpoints

## October 21, 2026 Pacific — owner-controlled server

- Package the existing Core 0.7.4, PostgreSQL, BTConnect 0.6.0 and HTTPS proxy for
  an owner-operated Docker host, independent of Railway and ChatGPT at runtime.
- Generate private first-run configuration without printing or overwriting keys;
  use the existing restricted database provisioner and private Core sign-in.
- Run connector as a non-root process and require recovered encrypted state,
  matching keys and an explicit old-writer shutdown before starting recovery.
- Add container acceptance for proxy routing, private access, app-role isolation
  and restart persistence, plus read-only journal/key/original checks.
- Retain all four accepted images with their exact IDs and checksums so the host
  does not need to rebuild or depend on a registry login during installation.

No runtime feature, database schema, inventory record or marketplace listing is
changed. A passing package is not a live deployment. The independent host, real
S3 restore, seller reconnection, recurring off-site backup and approved eBay pilot
remain separately recorded acceptance requirements.
