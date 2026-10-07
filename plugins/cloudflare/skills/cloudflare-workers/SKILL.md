---
name: cloudflare-workers
description: Build, configure and test a Cloudflare Worker locally with cf (cloudflare.config.ts, typed bindings, static assets, cf dev, vitest). Use when creating or changing Worker code or configuration. Does not deploy; use cloudflare-deploy for that.
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

Use Cloudflare's `cf` CLI (or its `cloudflare` alias if `cf` names another tool).
Pin it in the project; typed config needs Node22.18+ and is not supported on Bun.
Read `cloudflare.config.ts`, the Worker entry, framework adapter and package
scripts before running commands: the config is executable TypeScript.

- Existing legacy config: `cf migrate --dry-run` previews the conversion;
  `cf migrate` writes local files. Review its diff and unresolved items before
  running a project command. Preserve account, binding IDs, domains, schedules
  and existing Durable Object storage. Do not run `cf init .` over it.
- New project: `cf init <directory>` creates local files and installs packages.
  Do not accept an offer to deploy.
- `/cloudflare-preflight` inspects legacy JSON/TOML only. With typed config it
  reports that validation is unavailable; continue with reviewed config,
  project tests, `cf build` and `cf deploy --dry-run`, rather than treating a
  stale legacy file as the active configuration.

## Typed configuration

```ts
import { defineConfig } from "cf/config";
export default defineConfig({
  worker: {
    name: "my-worker",
    entrypoint: "src/index.ts",
    compatibilityDate: "2026-10-01", // choose deliberately, never a future date
    compatibilityFlags: ["nodejs_compat"],
    observability: { enabled: true },
  },
});
```

Use `worker.env` with the `bindings` helpers from `cf/config` for KV, R2, D1,
assets and other Workers. Confirm each helper and option against the current
configuration reference. Keep the project's generated binding types current;
`cf init` produces `.cloudflare/types/index.d.ts`. Compatibility dates pin
runtime behavior; move an existing date forward only with tests. The CLI may
use a framework adapter or its official Wrangler compatibility delegate
internally; authored development and deployment commands remain `cf`.

## Module Worker shape

```ts
export interface Env {
  // Use the project's generated binding types; keep them current.
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
- Secrets stay out of literal config values and chat. Keep local secret files
  gitignored; approved remote secret updates follow `cloudflare-deploy`.
- Regenerate the project's binding types after binding changes and run its
  type check so `Env` stays correct.
- Handlers beyond `fetch` (`scheduled`, `queue`, `email`) need a matching
  trigger or binding in the config.

## Bindings and assets

Use KV for read-heavy cache/config, R2 for blobs, D1 for relational records and
Durable Objects for coordinated state. Their binding declarations belong in
`worker.env`; the storage and Durable Object skills cover runtime use.

Use the adapter's documented static-asset setup and `bindings.assets()` when
Worker code needs an ASSETS binding. Check the generated build output: files
such as `_worker.js`, `.git`, local credentials and `node_modules` must never
be public assets. A `.assetsignore` file excludes unwanted assets. Check SPA
fallback, missing-file behavior, and routes that invoke Worker code first.

## Run and test locally

- `cf dev` uses the project adapter. Check its local storage location; Vite
  development and `cf` API commands with `--local` use different stores. Do
  not assume a value written by one is visible in the other.
- A binding configured for remote development talks to real
  resources, and Workers AI bills even in local mode. Treat those as
  account-affecting: ask first.
- Unit and integration tests: `@cloudflare/vitest-pool-workers` runs Vitest
  inside the Workers runtime with real bindings simulated. Add a test for each
  route you change, then run only that test file.
- `cf deploy --dry-run` bundles and validates without uploading. It is
  safe to run without approval; report the bundle size and any warnings.

## Done means

You ran `cf dev` or the tests and report what you observed (status codes,
test counts). Say plainly if you could not run them. Do not claim the Worker
works in production; that needs a deploy the user approved.

References: [cf project commands](https://developers.cloudflare.com/cf/projects/), [typed config](https://developers.cloudflare.com/cf/projects/cloudflare-config/), [migration](https://developers.cloudflare.com/cf/wrangler/migrate/).
