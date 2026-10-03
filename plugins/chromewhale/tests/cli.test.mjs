import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import { createBridge } from "../src/bridge.mjs";
import { recordEndpoint, resolveEndpoint } from "../src/pairing.mjs";
import { runCli } from "../src/cli.mjs";
import { extensionIdFromKey } from "../src/install.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

function tempEnv(extra = {}) {
  return { CHROMEWHALE_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "chromewhale-cli-")), ...extra };
}

/**
 * Every run gets a throwaway home directory and a recording registry: `setup`
 * registers the connector with the browsers it finds under `home`, and a test
 * must never touch the real ones.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {{platform?: NodeJS.Platform, home?: string, registry?: (args: string[]) => void}} [seams]
 */
async function run(argv, env, seams = {}) {
  const out = [];
  const err = [];
  const code = await runCli(argv, {
    env,
    root: ROOT,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    platform: seams.platform ?? (process.platform === "win32" ? "linux" : process.platform),
    home: seams.home ?? fs.mkdtempSync(path.join(os.tmpdir(), "chromewhale-home-")),
    registry: seams.registry ?? (() => {}),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** A fake home with a Chrome profile directory for `platform`. */
function homeWithChrome(platform) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "chromewhale-home-"));
  const profile = platform === "darwin" ? "Library/Application Support/Google/Chrome" : ".config/google-chrome";
  fs.mkdirSync(path.join(home, profile), { recursive: true });
  return { home, hosts: path.join(home, profile, "NativeMessagingHosts") };
}

test("status asks the bridge where it actually bound, not port 8899", async () => {
  const env = tempEnv();
  const endpoint = resolveEndpoint(env);
  const bridge = createBridge({
    token: endpoint.token,
    host: "127.0.0.1",
    port: 0,
    version: "0.1.0",
    onOwner: (live) => recordEndpoint({ ...live, token: endpoint.token, version: "0.1.0" }, env),
  });
  await bridge.listen();
  try {
    const port = bridge.status().port;
    assert.notEqual(port, 8899);
    const result = await run(["status"], env);
    assert.equal(result.code, 0, result.out + result.err);
    assert.match(result.out, new RegExp(`up on 127\\.0\\.0\\.1:${port} \\(pid ${process.pid}, plugin 0\\.1\\.0\\)`));
    assert.match(result.out, /Side panel: not attached/);
    const json = JSON.parse((await run(["status", "--json"], env)).out);
    assert.equal(json.up, true);
    assert.equal(json.paired, false);
  } finally {
    await bridge.close();
  }
});

test("status with nothing listening says the server is not running", async () => {
  const env = tempEnv();
  const endpoint = resolveEndpoint(env);
  recordEndpoint({ host: "127.0.0.1", port: 1, token: endpoint.token }, env);
  const result = await run(["status"], env);
  assert.equal(result.code, 1);
  assert.match(result.out, /Nothing is answering on 127\.0\.0\.1:1/);
});

test("status never sends the token to a non-loopback host, whatever the file says", async () => {
  const env = tempEnv();
  const endpoint = resolveEndpoint(env);
  const file = path.join(env.CHROMEWHALE_STATE_DIR, "bridge.json");
  fs.writeFileSync(file, JSON.stringify({ token: endpoint.token, host: "203.0.113.9", port: 8899 }));
  const result = await run(["status"], env);
  assert.equal(result.code, 2);
  assert.match(result.out, /Refusing to query 203\.0\.113\.9:8899/);
});

test("status before the server ever ran says so instead of minting a token", async () => {
  const env = tempEnv();
  const result = await run(["status"], env);
  assert.equal(result.code, 1);
  assert.match(result.out, /No pairing token/);
  assert.equal(fs.existsSync(path.join(env.CHROMEWHALE_STATE_DIR, "bridge.json")), false);
});

test("token prints the same token the server uses", async () => {
  const env = tempEnv();
  const printed = (await run(["token"], env)).out.trim();
  assert.equal(printed, resolveEndpoint(env).token);
});

test("setup copies the extension to a stable path and says it is a developer preview", async () => {
  const env = tempEnv();
  const first = await run(["setup"], env);
  assert.equal(first.code, 0, first.err);
  const dest = path.join(env.CHROMEWHALE_STATE_DIR, "extension");
  assert.match(first.out, /developer preview/);
  assert.match(first.out, /load it unpacked/);
  assert.match(first.out, /your own Chrome profile/);
  assert.ok(first.out.includes(dest), "the printed path is the stable copy");
  assert.ok(!first.out.includes(path.join(ROOT, "extension")), "never the staged root, which moves on update");
  const bundled = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));
  const copied = JSON.parse(fs.readFileSync(path.join(dest, "manifest.json"), "utf8"));
  assert.deepEqual(copied, bundled);

  // A stale file from an older copy does not survive a re-run.
  fs.writeFileSync(path.join(dest, "stale.js"), "old");
  assert.equal((await run(["setup"], env)).code, 0);
  assert.equal(fs.existsSync(path.join(dest, "stale.js")), false);
  assert.ok(fs.existsSync(path.join(dest, "src", "panel.js")));
});

test("setup refuses to replace a directory that is not its own copy", async () => {
  const env = tempEnv();
  const dest = path.join(env.CHROMEWHALE_STATE_DIR, "extension");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "keep.txt"), "user data");
  const result = await run(["setup"], env);
  assert.equal(result.code, 1);
  assert.match(result.err, /not a Codewhale for Chrome extension copy/);
  assert.equal(fs.readFileSync(path.join(dest, "keep.txt"), "utf8"), "user data");
});

test("the plugin, package, Kimi manifest, and extension carry one version", () => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")).version;
  const version = read("plugin.json");
  for (const rel of ["package.json", "kimi.plugin.json", "extension/manifest.json"]) {
    assert.equal(read(rel), version, `${rel} must match plugin.json`);
  }
});

test("the extension ID is the one Chrome derives from the manifest key", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));
  assert.equal(extensionIdFromKey(manifest.key), "lkblaeekmgngipleaomfkacpacebnajj");
});

test("setup registers the connector for installed browsers, allowing only this extension", async () => {
  for (const platform of ["darwin", "linux"]) {
    const env = tempEnv();
    const { home, hosts } = homeWithChrome(platform);
    const result = await run(["setup"], env, { platform, home });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /Connector installed for: Google Chrome/);
    const manifest = JSON.parse(fs.readFileSync(path.join(hosts, "net.codewhale.chrome.json"), "utf8"));
    assert.equal(manifest.name, "net.codewhale.chrome");
    assert.equal(manifest.type, "stdio");
    assert.deepEqual(manifest.allowed_origins, ["chrome-extension://lkblaeekmgngipleaomfkacpacebnajj/"]);
    const launcher = fs.readFileSync(manifest.path, "utf8");
    assert.ok(manifest.path.startsWith(env.CHROMEWHALE_STATE_DIR), "the launcher lives at a path plugin updates do not move");
    assert.match(launcher, /CHROMEWHALE_STATE_DIR=/, "the host reads the same pairing file as the server");
    assert.ok(path.isAbsolute(/exec '([^']+)'/.exec(launcher)[1]), "Chrome's minimal PATH is never relied on");
    if (process.platform !== "win32") {
      // Windows filesystems have no execute bit; the layout itself is still checked there.
      assert.ok(fs.statSync(manifest.path).mode & 0o100, "the launcher is executable");
    }
    assert.ok(fs.existsSync(path.join(env.CHROMEWHALE_STATE_DIR, "host", "src", "native.mjs")));
    // Browsers that are not installed get nothing written for them.
    assert.equal(fs.existsSync(path.join(home, platform === "darwin" ? "Library/Application Support/Chromium" : ".config/chromium")), false);

    const removed = await run(["setup", "--remove"], env, { platform, home });
    assert.equal(removed.code, 0);
    assert.equal(fs.existsSync(path.join(hosts, "net.codewhale.chrome.json")), false);
    assert.equal(fs.existsSync(path.join(env.CHROMEWHALE_STATE_DIR, "host")), false);
  }
});

test("on Windows setup registers the connector in the per-user registry", async () => {
  const env = tempEnv();
  const calls = [];
  const result = await run(["setup"], env, { platform: "win32", registry: (args) => calls.push(args) });
  assert.equal(result.code, 0, result.err);
  const adds = calls.filter((args) => args[0] === "add");
  assert.deepEqual(
    adds.map((args) => args[1].split("\\").slice(2, -2).join("/")).sort(),
    ["BraveSoftware/Brave-Browser", "Chromium", "Google/Chrome", "Microsoft/Edge"],
  );
  for (const args of adds) {
    assert.ok(args[1].startsWith("HKCU\\"), "per user, never machine-wide");
    assert.ok(args[1].endsWith("\\net.codewhale.chrome"));
  }
  const manifest = JSON.parse(fs.readFileSync(adds[0][adds[0].indexOf("/d") + 1], "utf8"));
  assert.ok(manifest.path.endsWith(".cmd"));
  assert.match(fs.readFileSync(manifest.path, "utf8"), /set "CHROMEWHALE_STATE_DIR=/);
});

test("setup refreshes a copy left by the extension's earlier name", async () => {
  const env = tempEnv();
  const dest = path.join(env.CHROMEWHALE_STATE_DIR, "extension");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify({ name: "Chromewhale", version: "0.1.0" }));
  const result = await run(["setup"], env);
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, "manifest.json"), "utf8")).name, "Codewhale for Chrome");
});
