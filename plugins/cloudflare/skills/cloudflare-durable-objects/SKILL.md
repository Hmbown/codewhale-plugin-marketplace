---
name: cloudflare-durable-objects
description: Design and write Cloudflare Durable Objects. SQLite storage, RPC methods, WebSocket hibernation, alarms, class lifecycle (exports or migrations), and testing. Use for stateful coordination, rooms, per-user state, counters, rate limiters.
---

# Cloudflare Durable Objects

A Durable Object is a class whose named instances each run in one place with
their own storage. Use one object per coordination unit (a chat room, a
document, a user, a game): that unit is the "atom". A single global object is a
bottleneck and almost always the wrong design.

Check current syntax with the `cloudflare-docs` plugin or
https://developers.cloudflare.com/durable-objects/ before relying on memory;
class lifecycle configuration changed recently (see below).

## Minimal SQLite-backed object with RPC

```ts
import { DurableObject } from "cloudflare:workers";

export class Counter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Runs on every wake-up: keep it cheap and idempotent.
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS hits (n INTEGER NOT NULL)");
      ctx.storage.sql.exec("INSERT INTO hits (n) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM hits)");
    });
  }

  increment(): number {
    this.ctx.storage.sql.exec("UPDATE hits SET n = n + 1");
    return this.ctx.storage.sql.exec("SELECT n FROM hits").one().n as number;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stub = env.COUNTER.getByName(new URL(request.url).searchParams.get("id") ?? "default");
    return Response.json({ n: await stub.increment() }); // RPC call
  },
} satisfies ExportedHandler<Env>;
```

Binding:

```jsonc
{ "durable_objects": { "bindings": [{ "name": "COUNTER", "class_name": "Counter" }] } }
```

The class must also be declared with a lifecycle entry, or the deploy fails or
the class has no storage. Two styles exist and they are mutually exclusive in
one config:

```jsonc
// Newer, declarative (preferred for new Workers when your Wrangler supports it)
{ "exports": { "Counter": { "type": "durable-object", "storage": "sqlite" } } }

// Older, imperative; still supported and required if the project already uses it
{ "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Counter"] }] }
```

- Keep whichever style the project already uses. Do not mix them.
- Use SQLite storage (`storage: "sqlite"` / `new_sqlite_classes`). New
  key-value-backed namespaces (`new_classes`) are no longer available to many
  accounts, and a deployed class cannot be switched to SQLite later.
- An older Wrangler does not know `exports`: Wrangler 4.94.0 prints
  `Unexpected fields found in top-level field: "exports"`, ignores it, and still
  passes `--dry-run`, so the class would be deployed with no lifecycle entry.
  Check `npx wrangler --version`; if it is too old, upgrade it (show the
  dependency edit) or use `migrations`. Never rely on a dry run to validate the
  lifecycle block.

## Lifecycle changes are dangerous

Creating a class is safe. Renaming, deleting or transferring a class is a
data-affecting operation:

- It is atomic: it cannot be uploaded as a version or deployed gradually, and
  you cannot roll back past it. After approval, deploy it alone with
  `wrangler deploy`.
- Deleting a class deletes its stored data. Renaming without a rename entry
  orphans data.
- Always show the diff of the `exports` / `migrations` block to the user, name
  the class and say whether data is lost, and wait for approval, as described
  in `cloudflare-deploy`.

## WebSockets: use hibernation

```ts
async fetch(request: Request) {
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
  const [client, server] = Object.values(new WebSocketPair());
  this.ctx.acceptWebSocket(server); // not server.accept(): this allows hibernation
  server.serializeAttachment({ joinedAt: Date.now() }); // survives hibernation
  return new Response(null, { status: 101, webSocket: client });
}
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
  for (const peer of this.ctx.getWebSockets()) peer.send(message);
}
async webSocketClose(ws: WebSocket, code: number, reason: string) { ws.close(code, reason); }
```

- Do not use `addEventListener` for server-side sockets in a Durable Object.
- Memory is lost on hibernation. Anything needed after wake-up goes in storage or
  `serializeAttachment`.
- A pending `setTimeout`/`setInterval` or an outbound WebSocket keeps the object
  awake and billing; use alarms instead.

## Alarms

```ts
await this.ctx.storage.setAlarm(Date.now() + 60_000);
async alarm() { /* do work; call setAlarm again to repeat */ }
```

Alarms do not repeat on their own, and each object has one pending alarm. Only
schedule one when there is work to do; waking many objects every few seconds is
expensive.

## Rules of thumb

- Methods on the object are RPC: arguments and results must be structured-
  cloneable; throw errors you want the caller to see.
- Reads and writes inside one request are protected by input/output gates; use
  `blockConcurrencyWhile` only for initialization.
- Derive the object name from something stable (`getByName(userId)`), and
  validate it; a user-supplied name creates an object.
- Test with `@cloudflare/vitest-pool-workers`: call RPC methods on a stub and
  trigger alarms with `runDurableObjectAlarm(stub)`. Run `wrangler dev` to try
  it locally; state is simulated.

## Checklist

- [ ] one object per logical unit, named deterministically
- [ ] SQLite storage; lifecycle entry present; one lifecycle style
- [ ] WebSockets use `acceptWebSocket` and handler methods
- [ ] no lifecycle change shipped without explicit approval
- [ ] local tests exercise the RPC methods and any alarm
