# Contributing extensions

Choose the smallest surface that completes the user's job:

- `plugins/<name>/`: installable tools, commands or skills. Include `plugin.json`,
  a concise README, license, exact prerequisites and the matching catalog row.
- `connections/`: service endpoints, host-owned auth and setup guidance. No
  credential values and no installable wrapper that only promises a login.
- `integrations/<name>/`: inbound messages/webhooks connected to the existing
  runtime. Include configuration, admission rules, lifecycle/recovery behavior,
  tests and an explicit statement of what has been exercised live.
- `skills/`: reusable workflows. The bundled mirror has a separate Core owner;
  preserve unrelated edits and synchronize changes through that owner.
  Commit the reviewed Core assets first, then run `npm run sync:skills`.
  The active catalog matrix determines membership; retained migration assets
  do not become installable skills.

An integration must not add a model loop, provider key store, approval authority
or scheduler parallel to Codewhale. Reuse shared clients before implementing a
new one. Authenticate inbound requests, bound payloads, prevent replay and
self-triggering loops, scope which people/workspaces can request work, retain
uncertain delivery for review, and expose failure without leaking credentials.

`integrations/upstream.json` records the exact Core snapshot and file hashes for
vendored bridges. Edit their canonical Core sources first, then refresh the
whole changed source/test set and the hashes here. Do not silently fork an
existing bridge. Marketplace-owned adapters such as `webhook-bridge` sit beside
that snapshot and use its shared helpers.

Every bundle must show a copyable first task, prerequisites, data destinations
and how to recognize success or a setup failure. Include README.md and LICENSE
in the package itself, not only at the repository root. Stable catalog IDs are
installation identities; improve `display_name` instead of renaming IDs.

Run `npm run check` and `npm test && npm run check:web`. Tests must exercise the
installed package or real protocol boundary where it matters. CI, real service
authentication, supported-platform behavior and customer acceptance are separate
from unit tests. Document any unavailable qualification explicitly.

Keep screenshots, recordings, build caches, real credentials and operational
receipts out of installable bundles. `npm run package:plugin -- <name>` creates
a clean, size-checked package for review; it never publishes or overwrites one.
