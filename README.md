# Codewhale plugin marketplace

The first-party catalog: the plugins and skills Codewhale itself ships and
supports. `marketplace.json` is Codewhale's native catalog format — an entry is
a `name` plus a `source` that is exactly the install spec `/plugin install`
accepts.

Add it:

```
/plugin marketplace add codewhale <path-to>/marketplace.json
```

Adding a catalog installs nothing. It lists what is available; trust and
enablement stay separate, explicit steps.

## Layout

- `marketplace.json` — the catalog.
- `plugins/<name>/` — first-party plugins carried in this repository, referenced
  as `path:plugins/<name>`.

An entry may also point outward (`github:owner/repo`, an `https` tarball) when a
plugin has its own home. Carrying one here is a convenience for plugins that do
not, not a rule.

## Skills

Codewhale's bundled skills ship inside the binary and are unpacked to
`$CODEWHALE_HOME` on first run. They are already present on every install and
are deliberately **not** listed here: a catalog entry for something that cannot
be installed, because it is already there, is an affordance that does nothing.
This catalog is for extensions a person chooses to add.
