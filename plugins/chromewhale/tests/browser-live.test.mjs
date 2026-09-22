/**
 * Chromewhale end-to-end verification against a real browser.
 *
 * `import test from "node:test"` — run with `npm test` from the plugin root.
 *
 * The other suites in this directory are all pure: they run the guards and the
 * protocol directly, which is where the evidence is cheap to get. This one
 * costs more, because it needs a real Chromium with the real unpacked extension
 * loaded, a real tab, and the MCP server speaking real JSON-RPC over stdio. It
 * exists because those three things can each work while the seam between them
 * is broken, and until this was written nobody had actually run the path.
 *
 * What it proves that nothing else does: a real extension panel attaches to the
 * real loopback bridge, a real page_snapshot issued over the plugin's own
 * transport comes back carrying the text of a real tab, a real page_type
 * refuses a real password field, and the value it typed into an ordinary field
 * really landed in that field. Those are the claims the README makes.
 *
 * It skips cleanly when no Chromium/Chrome is present, so `npm test` stays
 * green on a headless CI box that cannot run a browser. Skipping is not
 * passing: the skip line says the browser was absent, and the assertions only
 * ever ran when it was found.
 *
 * Everything runs in one process because a test runner must not be asked to
 * keep a browser alive between files. The browser, the plugin server, and the
 * harness all start and stop inside this run.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

// A thumbnail page with one of every interesting case: a link to click, an
// ordinary field that must accept text, a password field that must refuse it,
// and a one-time-code field that must refuse it too.
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Chromewhale verification page</title></head>
<body>
  <h1>Verification Target</h1>
  <p>A heading and a link the panel should be able to read.</p>
  <a id="more" href="/next">More information</a>
  <form>
    <label for="name">Name</label>
    <input id="name" type="text" autocomplete="name">
    <label for="pw">Password</label>
    <input id="pw" type="password" autocomplete="current-password">
    <label for="otp">One-time code</label>
    <input id="otp" type="text" autocomplete="one-time-code">
  </form>
</body>
</html>
`;

const NEXT_PAGE = `<html><body><h1>Next page</h1><p>Arrived at the destination.</p></body></html>`;

let browserCommand = "";
const candidates = [
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
];
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) { browserCommand = candidate; break; }
}
if (!browserCommand && process.platform !== "darwin") {
  const which = spawn("which", ["chromium", "google-chrome", "chromium-browser"], { stdio: ["ignore", "pipe", "ignore"] });
  which.stdout.on("data", (d) => { if (!browserCommand) browserCommand = String(d).trim().split("\n")[0]; });
  which.on("close", () => {});
}

// Everything the run needs, torn down in the finally below.
let mcp;
let chromium;
let panelCdp;
let pageCdp;
let targetServer;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "chromewhale-e2e-"));
const BROWSER_PROFILE = path.join(workDir, "profile");
const BRIDGE_PORT = 8899;
const CDP_PORT = 9333;
const TARGET_PORT = 8931;
const TARGET_ORIGIN = `http://127.0.0.1:${TARGET_PORT}`;
const TARGET_URL = `${TARGET_ORIGIN}/`;
const TOKEN = "e2e-token-abcdef0123456789abcdef0123456789";
const TOOL_WAIT_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One bridge request. */
function bridge(method, urlPath, { token, body } = {}) {
  return new Promise((resolve) => {
    const r = http.request(
      {
        host: "127.0.0.1", port: BRIDGE_PORT, path: urlPath, method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
        timeout: 5000,
      },
      (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, body: b })); },
    );
    r.on("error", (e) => resolve({ status: 0, error: String(e.code ?? e.message) }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const cdpList = () =>
  new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: CDP_PORT, path: "/json/list", timeout: 4000 }, (res) => {
      let b = ""; res.on("data", (d) => (b += d));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve([]); } });
    }).on("error", () => resolve([]));
  });

const cdpNewTab = (target) =>
  new Promise((resolve) => {
    const r = http.request(
      { host: "127.0.0.1", port: CDP_PORT, path: `/json/new?${encodeURIComponent(target)}`, method: "PUT", timeout: 10000 },
      (res) => {
        let b = ""; res.on("data", (d) => (b += d));
        res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
      },
    );
    r.on("error", () => resolve(null));
    r.end();
  });

const cdpActivate = (target) =>
  new Promise((resolve) => {
    const r = http.request(
      { host: "127.0.0.1", port: CDP_PORT, path: `/json/activate/${encodeURIComponent(String(target?.id ?? ""))}`, method: "PUT", timeout: 8000 },
      () => resolve(true),
    );
    r.on("error", () => resolve(false));
    r.end();
  });

const cdpCloseTab = (target) =>
  new Promise((resolve) => {
    const r = http.request(
      { host: "127.0.0.1", port: CDP_PORT, path: `/json/close/${encodeURIComponent(String(target?.id ?? ""))}`, timeout: 8000 },
      () => resolve(true),
    );
    r.on("error", () => resolve(false));
    r.end();
  });

/**
 * The smallest CDP session that is still a real one: Node's global WebSocket
 * plus a request-id map. Enough to evaluate an expression in a target.
 */
class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.next = 1; this.pending = new Map(); this.ws = null; }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`websocket failed: ${this.wsUrl}`)), { once: true });
      setTimeout(() => reject(new Error("websocket open timed out")), 10000);
    });
    this.ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === "string" ? event.data : ""); } catch { return; }
      const waiter = msg.id == null ? undefined : this.pending.get(msg.id);
      if (waiter) { this.pending.delete(msg.id); waiter(msg); }
    });
    this.ws.addEventListener("close", () => { for (const w of this.pending.values()) w({ error: "closed" }); this.pending.clear(); });
    return this;
  }

  async send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20000);
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (res.exceptionDetails) {
      return { __error: `${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ""}` };
    }
    return res.result?.result?.value;
  }

  close() { try { this.ws?.close(); } catch { /* already gone */ } }
}

/** JSON-RPC over the plugin's own stdio transport: the path Codewhale uses. */
function callTool(name, args = {}) {
  return new Promise((resolve, reject) => {
    const id = 500 + Math.floor(Math.random() * 100000);
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === id) { mcp.stdout.off("data", onData); resolve(msg); }
      }
    };
    mcp.stdout.on("data", onData);
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
    setTimeout(() => { mcp.stdout.off("data", onData); reject(new Error(`no answer to ${name} within ${TOOL_WAIT_MS}ms`)); }, TOOL_WAIT_MS);
  });
}

const textOf = (answer) => ((answer?.result?.content ?? []).map((c) => c.text ?? "").join("\n"));

/** Start the plugin server, the target page, and the browser with the extension. */
async function startEverything() {
  targetServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url?.startsWith("/next") ? NEXT_PAGE : PAGE);
  });
  await new Promise((r) => targetServer.listen(TARGET_PORT, "127.0.0.1", r));

  mcp = spawn("node", ["mcp/server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      CHROMEWHALE_STATE_DIR: path.join(workDir, "state"),
      CHROMEWHALE_BRIDGE_PORT: String(BRIDGE_PORT),
      CHROMEWHALE_BRIDGE_TOKEN: TOKEN,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  for (let i = 0; i < 60; i++) {
    if ((await bridge("GET", "/health", { token: TOKEN })).status === 200) break;
    await sleep(150);
  }

  fs.mkdirSync(BROWSER_PROFILE, { recursive: true });
  chromium = spawn(browserCommand, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${BROWSER_PROFILE}`,
    `--load-extension=${path.join(ROOT, "extension")}`,
    `--disable-extensions-except=${path.join(ROOT, "extension")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
    TARGET_URL,
  ], { stdio: "ignore" });

  let targets = [];
  for (let i = 0; i < 100 && targets.length === 0; i++) {
    targets = (await cdpList()).filter((t) => t.type === "page");
    if (!targets.length) await sleep(200);
  }
  if (!targets.length) throw new Error("browser never exposed a CDP page target");
  return targets;
}

async function stopEverything() {
  try { panelCdp?.close(); } catch { /* ignore */ }
  try { pageCdp?.close(); } catch { /* ignore */ }
  try { mcp?.kill("SIGTERM"); } catch { /* ignore */ }
  try { chromium?.kill("SIGTERM"); } catch { /* ignore */ }
  try { targetServer?.close(); } catch { /* ignore */ }
  await sleep(300);
  try { chromium?.kill("SIGKILL"); } catch { /* ignore */ }
  fs.rmSync(workDir, { recursive: true, force: true });
}

test("chromewhale drives a real browser end to end", { timeout: 300000 }, async (t) => {
  if (!browserCommand) {
    t.skip("no Chromium, Chrome, or Edge binary found on this machine");
    return;
  }

  let extensionId = "";
  let targetTab = null;
  let panelTab = null;
  try {
    await startEverything();

    for (let i = 0; i < 60 && !extensionId; i++) {
      const ext = (await cdpList()).find((x) => x.url?.startsWith("chrome-extension://"));
      extensionId = /chrome-extension:\/\/([a-p]{32})/.exec(ext?.url ?? "")?.[1] ?? "";
      if (!extensionId) await sleep(200);
    }
    await t.test("Chromium loads the unpacked extension", () => {
      assert.ok(extensionId, "Chromium did not load the extension; a 32-char id is required");
    });

    targetTab = (await cdpList()).find((x) => x.url === TARGET_URL);
    await t.test("the target page is open", () => {
      assert.ok(targetTab, "the local verification page never opened");
    });
    if (!targetTab) return;

    // Seed the panel's settings and its per-origin grant. Seeding the grant is
    // exactly what clicking Allow in the panel writes.
    panelTab = await cdpNewTab(`chrome-extension://${extensionId}/panel.html`);
    for (let i = 0; i < 60 && !panelTab; i++) {
      panelTab = (await cdpList()).find((x) => x.url?.includes("/panel.html")) ?? null;
      if (!panelTab) await sleep(200);
    }
    await t.test("the side panel document opens", () => {
      assert.ok(panelTab, "panel.html did not open");
    });
    if (!panelTab) return;

    panelCdp = await new Cdp(panelTab.webSocketDebuggerUrl).connect();
    const seeded = await panelCdp.eval(`
      (async () => {
        await chrome.storage.local.set({ settings: {
          host: "127.0.0.1", port: 7878, token: "",
          bridgePort: ${BRIDGE_PORT}, bridgeToken: ${JSON.stringify(TOKEN)},
        }});
        const { withDecision } = await import("./src/policy.js");
        await chrome.storage.local.set({ origins: withDecision({}, ${JSON.stringify(TARGET_ORIGIN)}, "allow") });
        return await chrome.storage.local.get(["settings", "origins"]);
      })()
    `);
    const seededSettings = seeded?.settings ?? {};
    await t.test("the panel reads its bridge settings and site grant", () => {
      assert.equal(seeded.__error, undefined, seeded.__error);
      assert.equal(seededSettings.bridgeToken, TOKEN);
      assert.equal(seeded.origins?.[TARGET_ORIGIN], "allow");
    });

    // Reload so the panel mounts against what was just seeded, then make the
    // real page the active tab: opening the panel document makes it active, and
    // the panel reads the active tab of its own window.
    await panelCdp.eval("location.reload()");
    await sleep(2500);
    for (let i = 0; i < 6; i++) { await cdpActivate(targetTab); await sleep(500); }

    let health = { body: "{}" };
    for (let i = 0; i < 80; i++) {
      health = await bridge("GET", "/health", { token: TOKEN });
      if (JSON.parse(health.body || "{}").paired) break;
      await sleep(250);
    }
    await t.test("the real extension panel attaches to the bridge", () => {
      assert.equal(JSON.parse(health.body || "{}").paired, true, `bridge said: ${health.body}`);
    });

    const view = await panelCdp.eval(`
      (async () => { const w = await chrome.windows.getCurrent();
        const tabs = await chrome.tabs.query({ windowId: w.id });
        return tabs.find(x => x.active)?.url ?? ""; })()
    `);
    await t.test("the panel's active tab is the real page", () => {
      assert.equal(view, TARGET_URL, `active tab was ${view}`);
    });

    // --- the claim the README makes: it can read the page you are looking at ---
    const snapshot = await callTool("page_snapshot");
    const snapText = textOf(snapshot);
    await t.test("page_snapshot returns the real page", (t2) => {
      assert.notEqual(snapshot.result?.isError, true, snapText);
      assert.match(snapText, /Chromewhale verification page/, "the page title came back");
      assert.match(snapText, /Verification Target/, "the page heading came back");
      assert.match(snapText, /\[e\d+\]/, "element refs were extracted");

      // Page text must arrive as data, not as instructions for the agent.
      t2.diagnostic("untrusted envelope: " + (snapText.match(/--- begin untrusted page content ---/) ? "present" : "MISSING"));
      assert.match(snapText, /untrusted page content/, "page text is framed as untrusted");
    });

    // --- the other claim: it never types into a secret field ---
    const refs = [...snapText.matchAll(/\[e(\d+)\][^\n]*/g)].map((m) => ({ n: m[1], line: m[0] }));
    const passwordRef = refs.find((r) => /password/i.test(r.line));
    const otpRef = refs.find((r) => /one-time-code|one time code/i.test(r.line));
    const plainRef = refs.find((r) => /\bname\b/i.test(r.line) && !/password|code/i.test(r.line));

    await t.test("a password field is marked protected in the snapshot", () => {
      assert.ok(passwordRef, "no password field appeared in the snapshot");
      assert.match(passwordRef.line, /protected/, `password ref line: ${passwordRef.line}`);
    });

    if (passwordRef) {
      const refused = await callTool("page_type", { ref: `e${passwordRef.n}`, text: "hunter2" });
      const refusedText = textOf(refused);
      await t.test("page_type refuses the real password field", () => {
        assert.match(refusedText, /password|refus|cannot|will not|never/i, refusedText);
      });
    }
    if (otpRef) {
      const refusedOtp = await callTool("page_type", { ref: `e${otpRef.n}`, text: "123456" });
      const otpText = textOf(refusedOtp);
      await t.test("page_type refuses the real one-time-code field", () => {
        assert.match(otpText, /one-time-code|password|refus|cannot|will not|never/i, otpText);
      });
    }

    // --- and the refusal must be specific, not blanket: a normal field works ---
    if (plainRef) {
      const typed = await callTool("page_type", { ref: `e${plainRef.n}`, text: "Codewhale" });
      const typedText = textOf(typed);
      pageCdp = await new Cdp(targetTab.webSocketDebuggerUrl).connect();
      const landed = await pageCdp.eval(`document.getElementById("name")?.value ?? ""`);
      await t.test("page_type fills an ordinary field in the live page", (t2) => {
        assert.doesNotMatch(typedText, /refus|cannot|will not|never/i, `typed: ${typedText}`);
        assert.equal(landed, "Codewhale", `the live input held ${JSON.stringify(landed)}`);
        t2.diagnostic(`typed into ${plainRef.line.trim()}; live value ${JSON.stringify(landed)}`);
      });
    }

    // --- a blocked scheme never reaches a tool ---
    const blocked = await callTool("page_navigate", { url: "chrome://extensions" });
    const blockedText = textOf(blocked);
    await t.test("page_navigate refuses a chrome:// target", () => {
      assert.match(blockedText, /never acts on|only acts on http|blocked|refus|cannot/i, blockedText);
    });

    // --- closing the panel detaches it ---
    if (panelTab) await cdpCloseTab(panelTab);
    let after = { body: "{}" };
    for (let i = 0; i < 20; i++) {
      after = await bridge("GET", "/health", { token: TOKEN });
      if (JSON.parse(after.body || "{}").paired === false) break;
      await sleep(250);
    }
    await t.test("the bridge reports unpaired once the panel closes", () => {
      assert.equal(JSON.parse(after.body || "{}").paired, false, after.body);
    });
  } finally {
    await stopEverything();
  }
});
