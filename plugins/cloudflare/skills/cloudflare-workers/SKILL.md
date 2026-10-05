---
name: cloudflare-workers
description: Build, configure and test a Cloudflare Worker locally (wrangler.jsonc, bindings, env types, static assets, wrangler dev, vitest). Use when creating or changing Worker code or its Wrangler config. Does not deploy; use cloudflare-deploy for that.
---

# Cloudflare Workers: build and test locally

This skill covers everything up to, but not including, a deploy. Anything that
changes the user's Cloudflare account goes through `cloudflare-deploy`.

Cloudflare's platform moves quickly. Before relying on a limit, a flag name or a
config key from memory, check it with the `cloudflare-docs` plugin (its
`search_cloudflare_documentation` tool) if it is enabled, or the docs at
https://developers.cloudflare.com/workers/. The examples here were checked
against those docs when this plugin was written.

## Start or inspect a project

- Existing project: read `wrangler.jsonc` / `wrangler.json` / `wrangler.toml`,
  `package.json` scripts, and the `main` entry before editing. Keep the config
  format the project already uses.
- New project: `npm create cloudflare@latest -- <name>` runs on the user's
  machine and installs packages. It may offer to deploy at the end; answer no.
- Run the offline check first: `/cloudflare-preflight` (see that command).

## Baseline `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-worker",
  "main": "src/index.ts",
  // Use today's date for a new project; do not copy this value.
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true }
}
```

- `compatibility_date` pins runtime behavior. Move it forward deliberately and
  run tests after the change; never set a future date (the deploy is rejected).
- `nodejs_compat` is needed for most npm packages that import `node:` modules.
- Prefer `wrangler.jsonc` for new projects. TOML and JSON are equivalent.

## Module Worker shape

```ts
export interface Env {
  // Filled in by `npx wrangler types`; do not hand-maintain long term.
  MY_KV: KVNamespace;
  API_TOKEN: string; // a secret: never in `vars`
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    ctx.waitUntil(logHit(env, url.pathname)); // work after the response
    return Response.json({ path: url.pathname });
  },
} satisfies ExportedHandler<Env>;

async function logHit(env: Env, path: string): Promise<void> {
  await env.MY_KV.put(`hit:${path}`, String(Date.now()), { expirationTtl: 3600 });
}
```

Rules that prevent most Worker bugs:

- No mutable per-request state in module scope; isolates serve many requests.
- Do not `await` slow work you can push to `ctx.waitUntil`; stream large bodies
  instead of buffering them.
- Secrets are `wrangler secret put` values locally mirrored in `.dev.vars`
  (gitignored), never `vars` in the config.
- Run `npx wrangler types` after adding or changing a binding so `Env` stays
  correct.
- Handlers beyond `fetch` (`scheduled`, `queue`, `email`) need a matching
  trigger or binding in the config.

## Bindings at a glance

| Need | Config key | Skill |
| --- | --- | --- |
| Key-value cache/config | `kv_namespaces` | cloudflare-storage |
| Object storage | `r2_buckets` | cloudflare-storage |
| SQL database | `d1_databases` | cloudflare-storage |
| Coordination, WebSockets, per-entity state | `durable_objects` | cloudflare-durable-objects |
| Static files | `assets` | below |
| Other Workers | `services` | docs |

## Static assets

```jsonc
{
  "assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "single-page-application" }
}
```

- Requests matching a file are served without invoking the Worker unless
  `run_worker_first` is `true` or a list of route patterns (for example
  `["/api/*"]`).
- A `.assetsignore` file in the assets directory (gitignore syntax) keeps files
  such as `_worker.js` from being uploaded as public assets.

## Run and test locally

- `npx wrangler dev` runs the Worker and simulates bindings on the machine;
  state lives in `.wrangler/state`. This touches nothing remote.
- A binding with `"remote": true` (and `wrangler dev --remote`) talks to real
  resources, and Workers AI bills even in local mode. Treat those as
  account-affecting: ask first.
- Unit and integration tests: `@cloudflare/vitest-pool-workers` runs Vitest
  inside the Workers runtime with real bindings simulated. Add a test for each
  route you change, then run only that test file.
- `npx wrangler deploy --dry-run` bundles and validates without uploading. It is
  safe to run without approval; report the bundle size and any warnings.

## Done means

You ran `wrangler dev` or the tests and report what you observed (status codes,
test counts). Say plainly if you could not run them. Do not claim the Worker
works in production; that needs a deploy the user approved.
