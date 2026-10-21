# Public source, private operations

Do not commit credentials, private keys, session cookies, private inventory/customer exports, database files, original inventory photos or operational backups. Use synthetic test data. Public source uses example deployment addresses.

Keep account recovery codes and encryption keys in an owner-controlled secret store with independent recovery. The connector's encryption key must be recoverable with its encrypted database; one without the other is insufficient. Core's logical backup excludes passwords, sessions and saved connector grants, so those require setup/reconnection after restore.

Do not report credentials or customer records in public GitHub issues. If a secret is exposed, revoke/rotate it through its provider; removing a file from the current branch does not remove public history or clones.

Before publishing a new source snapshot, run `python3 tools/check-public.py`, inspect its changes and update source-lock.json. This bounded check is not a guarantee that arbitrary content contains no sensitive information. Old private repository histories need a separate audit before public exposure.
