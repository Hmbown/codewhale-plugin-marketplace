---
name: cloudflare-storage
description: Use Cloudflare KV, R2 and D1 from a Worker. Binding config, Worker code, wrangler commands, local vs remote data, D1 migrations. Use when adding or changing storage bindings or schemas.
---

# Cloudflare KV, R2 and D1 basics

Local first: `wrangler dev` and the `--local` flag use simulated storage in
`.wrangler/state`. Remote commands touch the user's real data and need approval
(see `cloudflare-deploy`). Always pass `--local` or `--remote` explicitly; do not
rely on a default, which differs between commands and versions.

Pick the store by access pattern:

| Store | Good for | Not for |
| --- | --- | --- |
| KV | read-heavy config, cache, small values, eventually consistent | counters, anything needing read-your-write across regions |
| R2 | files, blobs, uploads, S3-compatible access | relational queries |
| D1 | relational data in SQLite, migrations, transactions via `batch` | very high write rates to one database, large blobs |
| Durable Objects | per-entity coordination and strongly consistent state | bulk storage (see cloudflare-durable-objects) |

## KV

```jsonc
{ "kv_namespaces": [{ "binding": "CACHE", "id": "<namespace-id>" }] }
```

```ts
await env.CACHE.put("user:1", JSON.stringify(user), { expirationTtl: 3600 });
const user = await env.CACHE.get("user:1", "json"); // null when missing
const page = await env.CACHE.list({ prefix: "user:", limit: 100 });
```

- Writes can take a while (60 seconds or more) to be visible in other
  locations; do not use KV where staleness is a bug.
- `expirationTtl` has a documented minimum of 60 seconds.
- CLI: `npx wrangler kv namespace create CACHE` (remote, approval),
  `npx wrangler kv key put --binding=CACHE "k" "v" --local` (local).

## R2

```jsonc
{ "r2_buckets": [{ "binding": "FILES", "bucket_name": "my-files" }] }
```

```ts
await env.FILES.put(key, request.body, { httpMetadata: { contentType: "image/png" } });
const obj = await env.FILES.get(key); // null when missing
if (!obj) return new Response("Not found", { status: 404 });
return new Response(obj.body, { headers: { etag: obj.httpEtag } });
// elsewhere: await env.FILES.delete(key);
```

- Stream `request.body` into `put`; do not buffer large uploads in memory.
- Validate keys from user input (no path tricks, enforce a prefix per user).
- CLI: `npx wrangler r2 bucket create my-files` (remote, approval).

## D1

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "app-db", "database_id": "<uuid>", "migrations_dir": "migrations" }
  ]
}
```

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
- Schema changes are migration files:
  `npx wrangler d1 migrations create app-db add_users` creates a numbered SQL
  file. Review it, then apply locally with
  `npx wrangler d1 migrations apply app-db --local` and test.
- Applying to production (`--remote`) is a data change: show the SQL, say which
  database and account, wait for approval. Prefer additive migrations (add
  column, add table). A `DROP`, `DELETE` without `WHERE`, or table rebuild needs
  a second explicit confirmation and a restore plan (check the D1 Time Travel
  docs for the current retention and `wrangler d1 time-travel` commands).
- With ORMs that write nested migration folders, set `migrations_pattern`
  (and `migrations_dir`) to match their layout.

## Checklist

- [ ] binding names are valid JS identifiers and match `Env`
- [ ] `npx wrangler types` re-run
- [ ] code handles `null` / missing results
- [ ] local test ran against simulated storage
- [ ] no remote write happened without a yes
