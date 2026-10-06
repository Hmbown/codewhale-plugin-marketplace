---
name: cloudflare-storage
description: Use Cloudflare KV, R2 and D1 from a Worker. Binding config, Worker code, cf commands, local vs remote data, D1 migrations. Use when adding or changing storage bindings or schemas.
---

# Cloudflare KV, R2 and D1 basics

Local first: `cf dev` simulates the project's bindings through its adapter.
Resource commands are remote unless a supported `--local` mode is explicitly
selected. Consult `cf cli search` with an anonymous action/resource query and
inspect the discovered command's help/schema; beta command names and flags
are not interchangeable with Wrangler's. Remote writes require approval
(`cloudflare-deploy`). Vite development data and cf local API data are separate
stores; check the actual persistence directory before comparing results.

Pick the store by access pattern:

| Store | Good for | Not for |
| --- | --- | --- |
| KV | read-heavy config, cache, small values, eventually consistent | counters, anything needing read-your-write across regions |
| R2 | files, blobs, uploads, S3-compatible access | relational queries |
| D1 | relational data in SQLite, migrations, transactions via `batch` | very high write rates to one database, large blobs |
| Durable Objects | per-entity coordination and strongly consistent state | bulk storage (see cloudflare-durable-objects) |

## KV

Declare `CACHE` in `worker.env` with the current `bindings.kv` helper from
`cf/config`, preserving the existing namespace ID. Validate typed options
against the cf configuration reference and inspect dry-run bindings.

```ts
await env.CACHE.put("user:1", JSON.stringify(user), { expirationTtl: 3600 });
const user = await env.CACHE.get("user:1", "json"); // null when missing
const page = await env.CACHE.list({ prefix: "user:", limit: 100 });
```

- Writes can take a while (60 seconds or more) to be visible in other
  locations; do not use KV where staleness is a bug.
- `expirationTtl` has a documented minimum of 60 seconds.
- Use `cf cli search "create a key value namespace"` or an equivalent
  anonymous query, then inspect the returned help/schema. Namespace creation
  is remote and needs approval; local KV writes require explicit `--local`.

## R2

Declare `FILES` with the current `bindings.r2` helper in `worker.env`;
retain the existing bucket identity and check generated bindings.

```ts
await env.FILES.put(key, request.body, { httpMetadata: { contentType: "image/png" } });
const obj = await env.FILES.get(key); // null when missing
if (!obj) return new Response("Not found", { status: 404 });
return new Response(obj.body, { headers: { etag: obj.httpEtag } });
// elsewhere: await env.FILES.delete(key);
```

- Stream `request.body` into `put`; do not buffer large uploads in memory.
- Validate keys from user input (no path tricks, enforce a prefix per user).
- Discover cf R2 bucket/object commands through anonymous command search;
  creating a bucket or writing/deleting an object remotely requires approval.

## D1

Declare `DB` using the current `bindings.d1` helper in `worker.env`, keeping
the existing database ID and generated environment types. Verify the helper's
schema before adding migration options; do not copy legacy snake_case keys.

```ts
const { results } = await env.DB.prepare("SELECT id, email FROM users WHERE org = ?1 LIMIT ?2")
  .bind(orgId, 50)
  .all();
const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first();
await env.DB.batch([
  env.DB.prepare("INSERT INTO audit(event) VALUES (?1)").bind("signup"),
  env.DB.prepare("UPDATE users SET active = 1 WHERE id = ?1").bind(id),
]);
```

- Always `bind()` user input; never concatenate it into SQL.
- Schema changes stay in reviewed, numbered SQL migration files. Keep the
  framework's migration tool if it already owns ordering and receipts; inspect
  its generated SQL, apply it only to the local test store and run the tests.
- Discover cf D1 query/migration commands and exact input shape with anonymous
  command search and help/schema. Never assume a Wrangler migration command
  exists in cf under the same name.
- Production application is a data change: show SQL, database and account,
  get approval, and keep a restore plan. Prefer additive migrations. A DROP,
  table rebuild or unrestricted DELETE requires explicit data-loss approval.
  Check current D1 recovery/Time Travel availability rather than promising a
  retention window from memory. Always bind user values, even in CLI queries.

## Checklist

- [ ] binding names are valid JS identifiers and match `Env`
- [ ] generated binding types and project type check current
- [ ] code handles `null` / missing results
- [ ] local test ran against simulated storage
- [ ] no remote write happened without a yes

References: [cf local resources](https://developers.cloudflare.com/cf/projects/), [typed bindings](https://developers.cloudflare.com/cf/projects/cloudflare-config/).
