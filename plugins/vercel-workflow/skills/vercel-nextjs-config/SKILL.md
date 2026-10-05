---
name: vercel-nextjs-config
description: Configure a Next.js app for Vercel. next.config versus vercel.json, proxy (renamed from middleware in Next.js 16), images, redirects and headers, function duration and region, caching and static export pitfalls, and local verification. Use when editing next.config, vercel.json or routing for a Next.js project on Vercel.
---

# Next.js configuration on Vercel

Vercel detects Next.js and builds it with no configuration. Add configuration only
for a reason you can name. First read: `package.json` (`next` version), the
existing `next.config.*`, and `vercel.json` if present. Version matters: check
https://nextjs.org/docs and https://vercel.com/docs (append `.md` to a Vercel docs
URL for plain text) before relying on memory for anything below.

## Where each setting lives

| Setting | Put it in | Why |
| --- | --- | --- |
| Redirects, rewrites, headers for the app's routes | `next.config.ts` (`redirects()`, `rewrites()`, `headers()`) | version-controlled with the app, works in `next dev` |
| Platform behavior: `crons`, `regions`, per-function `memory`/`maxDuration`, `ignoreCommand`, `buildCommand`/`installCommand`, `outputDirectory` | `vercel.json` (or `vercel.ts`) | Vercel-only features |
| Secrets and per-environment values | Vercel environment variables (`vercel-env-vars`) | never in either file |
| Project name, Node version, root directory, Git settings | Project Settings | dashboard-only |

Do not define the same redirect in both files. Only one of `vercel.json`,
`vercel.toml` and `vercel.ts` may exist. A `vercel.json` that mixes legacy
`routes` with `rewrites`/`redirects`/`headers` is rejected.

## A sensible `next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow only the hosts you serve images from.
    remotePatterns: [{ protocol: "https", hostname: "images.example.com", pathname: "/**" }],
  },
  async redirects() {
    return [{ source: "/old", destination: "/new", permanent: true }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};

export default nextConfig;
```

- `output: "standalone"` is for self-hosting in a container. It is not needed on
  Vercel.
- `output: "export"` produces a static site. Redirects, rewrites, headers and
  server features (proxy, route handlers that read the request, ISR) do not run in
  a static export; define redirects and headers in `vercel.json` instead, or do
  not export.
- Do not set `typescript.ignoreBuildErrors` or `eslint.ignoreDuringBuilds` to make a
  deploy pass; fix the errors or tell the user they are being skipped.
- `images.remotePatterns` is an allow list: a wildcard host lets anyone use your
  image optimizer as a proxy and increases cost.

## Proxy (formerly middleware)

Next.js 16 renamed the `middleware` file convention to `proxy` (`proxy.ts` at the
project root or in `src/`, exporting `proxy`); the Node.js runtime is the default
and a `runtime` export is not allowed there. Migrate with
`npx @next/codemod@canary middleware-to-proxy .` (show the diff first).

- Without a `matcher`, it runs on every request including `_next/static`, images
  and `public/` files. Exclude them or auth logic will break CSS and JS:
  `matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]`.
- Server Functions are POSTs to the page route; a matcher that skips the page also
  skips them. Check authorization inside each Server Function, not only in proxy.
- It does not work with `output: "export"`.

## Environment variables in Next.js

- `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time. Never
  use that prefix for a secret. Changing one needs a rebuild.
- Server-only variables are read from `process.env` in Server Components, Route
  Handlers and Server Functions only.
- `.env.local` is for local development and must be gitignored. Use
  `vercel env pull` / `vercel env run` for team values.

## Functions, caching and rendering

- Per-route duration: `export const maxDuration = 30;` in the route segment, or
  `functions` in `vercel.json`. Limits depend on plan; check the docs.
- Regions: `regions` in `vercel.json`; put functions near the database.
- Next.js 16 Cache Components (`cacheComponents: true`) makes data dynamic by
  default and caches with the `use cache` directive; do not enable it in an
  existing app without reading the migration guide and running the build.
- ISR: `fetch(url, { next: { revalidate: 60 } })` or `export const revalidate`.
- `export const dynamic = "force-dynamic"` on a page that could be static costs
  money and speed; use it only when needed.

## Verify locally before any deploy

1. `npm run build` (or the project's build) must pass with no skipped checks.
2. `npx vercel build` after `vercel pull` reproduces Vercel's build; it needs the
   user's login for `pull`.
3. Run the production build locally (`next start`) and request the routes you
   changed, including a redirect, a header, and a proxy-protected path.
4. Run `/vercel-preflight`.
5. Deploying is a separate step: follow `vercel-deploy`, preview first, with the
   user's approval.

## Done means

You report the commands you ran and what they printed (build success, status
codes of the routes you requested), what you changed in which file and why, and
anything you could not verify without a deployment.
