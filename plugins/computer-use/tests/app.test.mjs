// Desktop app: the daemon's socket protocol, the server's routing through it,
// the icon artifacts, and the per-OS bundle layouts. Every test runs against
// an isolated state dir so the real installed app (if any) is never touched.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-app-"));
process.env.CODEWHALE_CU_STATE_DIR = stateDir;
delete process.env.CODEWHALE_CU_APP;

const { appRequest, hello, ensureApp, socketPath, readRegistration, defaultLaunch, APP_ID } = await import("../src/app-socket.mjs");
const { executorFor } = await import("../src/transport.mjs");
const { ALLOWED } = await import("../src/app-handler.mjs");
const { REMOTE_TOOLS } = await import("../src/tools.mjs");

let daemon;
before(async () => {
  daemon = spawn(process.execPath, [path.join(ROOT, "app", "daemon.mjs")], {
    env: { ...process.env, CODEWHALE_CU_STATE_DIR: stateDir, CODEWHALE_CU_APP_BUNDLE: "/tmp/fake-bundle.app", CODEWHALE_CU_APP_WARM: "off" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  daemon.stderr.on("data", () => {});
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && !(await hello({ timeoutMs: 500 }))) await new Promise((r) => setTimeout(r, 100));
  assert.ok(await hello(), "daemon came up");
});
after(() => { daemon?.kill("SIGTERM"); fs.rmSync(stateDir, { recursive: true, force: true }); });

test("hello identifies the app and the bundle it runs from", async () => {
  const app = await hello();
  assert.equal(app.id, APP_ID);
  assert.equal(app.bundle, "/tmp/fake-bundle.app");
  assert.equal(app.platform, process.platform);
  assert.equal(app.socket, socketPath());
});

test("launching from a bundle registers a relaunch command", () => {
  const reg = readRegistration();
  assert.equal(reg.path, "/tmp/fake-bundle.app");
  assert.deepEqual(reg.launch, defaultLaunch("/tmp/fake-bundle.app"));
});

test("only allow-listed tools execute over the socket", async () => {
  assert.deepEqual([...ALLOWED].filter((t) => t !== "platform").sort(), [...REMOTE_TOOLS].sort(), "app allow-list is exactly the wire tool set");
  const ok = await appRequest({ tool: "platform" });
  assert.equal(ok.ok, true);
  assert.equal(ok.platform, process.platform);
  const bad = await appRequest({ tool: "hello; rm -rf /" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "tool_not_allowed");
});

test("the local computer routes through the app when it is up", async () => {
  const status = await ensureApp();
  assert.equal(status.via, "app");
  const ex = await executorFor({ id: "local", transport: "local", platform: process.platform });
  assert.equal(ex.kind, "app");
  assert.equal(typeof ex.remote, "function");
  assert.equal(ex.filesLocal, true);
});

test("CODEWHALE_CU_APP=off forces direct mode", async () => {
  process.env.CODEWHALE_CU_APP = "off";
  try {
    const ex = await executorFor({ id: "local", transport: "local", platform: process.platform });
    assert.equal(ex.kind, "local");
    assert.match(ex.appReason, /CODEWHALE_CU_APP=off/);
  } finally { delete process.env.CODEWHALE_CU_APP; }
});

test("a second daemon on the same state dir exits instead of fighting for the socket", async () => {
  const dup = spawn(process.execPath, [path.join(ROOT, "app", "daemon.mjs")], { env: { ...process.env, CODEWHALE_CU_STATE_DIR: stateDir }, stdio: "ignore" });
  const code = await new Promise((r) => dup.on("exit", r));
  assert.equal(code, 0);
  assert.ok(await hello(), "original daemon still answers");
});

test("icon artifacts build from the tracked source in every required format", async (t) => {
  const { buildIcons } = await import("../scripts/build-icons.mjs");
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), "cu-icons-"));
  t.after(() => fs.rmSync(assets, { recursive: true, force: true }));
  buildIcons({ assets });
  const png = fs.readFileSync(path.join(assets, "icon.png"));
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  const icns = fs.readFileSync(path.join(assets, "icon.icns"));
  assert.equal(icns.subarray(0, 4).toString("latin1"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length, "icns length header matches file");
  const ico = fs.readFileSync(path.join(assets, "icon.ico"));
  assert.equal(ico.readUInt16LE(2), 1, "ico type");
  assert.ok(ico.readUInt16LE(4) >= 6, "ico has the standard sizes");
  for (const n of [16, 32, 48, 128, 256, 512]) {
    assert.ok(fs.existsSync(path.join(assets, "icons", "hicolor", `${n}x${n}`, "apps", "net.codewhale.computer-use.png")), `hicolor ${n}`);
  }
});

test("build-app produces every platform layout with a complete runtime copy", async () => {
  const { buildApp, RUNTIME_ENTRIES, signMacCode, macSigningIdentity } = await import("../scripts/build-app.mjs");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cu-dist-"));
  try {
    const built = buildApp({ out });
    const mac = path.join(built.macos, "Contents");
    if (process.platform === "darwin") {
      const checkSignatures = () => {
        const verified = spawnSync("codesign", ["--verify", "--deep", "--strict", built.macos], { encoding: "utf8" });
        assert.equal(verified.status, 0, verified.stderr);
        for (const executable of ["codewhale-cu", "accessibility"]) {
          for (const arch of ["arm64", "x86_64"]) {
            const info = spawnSync("codesign", ["--display", "--verbose=4", "--arch", arch, path.join(mac, "MacOS", executable)], { encoding: "utf8" });
            assert.equal(info.status, 0, info.stderr);
            assert.match(info.stderr, /flags=0x[0-9a-f]+\([^\n]*runtime\)/, `${executable}/${arch} must enable hardened runtime`);
          }
        }
      };
      checkSignatures();
      const info = spawnSync("codesign", ["-dvv", built.macos], { encoding: "utf8" });
      assert.doesNotMatch(info.stderr, /Info.plist=not bound|Sealed Resources=none/);
      const capability = spawnSync(path.join(mac, "MacOS", "accessibility"), [JSON.stringify({ tool: "input_capabilities" })], { encoding: "utf8" });
      assert.equal(capability.status, 0, capability.stderr);
      assert.equal(JSON.parse(capability.stdout).input_lease, 1, "the hardened helper runs without requesting input or capture");
      // Installation pins Node in a sealed resource, then uses this same
      // signing helper. Exercise that actual mutation without installing or
      // launching anything in the user's Applications directory.
      fs.writeFileSync(path.join(mac, "Resources", "node-path"), process.execPath + "\n");
      signMacCode(built.macos, macSigningIdentity(built.macos));
      checkSignatures();
    }
    assert.match(fs.readFileSync(path.join(mac, "Info.plist"), "utf8"), /<string>net\.codewhale\.computer-use<\/string>/);
    assert.ok(fs.statSync(path.join(mac, "MacOS", "codewhale-cu")).mode & 0o111, "mac launcher is executable");
    assert.ok(fs.existsSync(path.join(mac, "Resources", "AppIcon.icns")));
    assert.ok(fs.statSync(path.join(built.linux, "bin", "codewhale-computer-use")).mode & 0o111, "linux launcher is executable");
    const desktop = fs.readFileSync(path.join(built.linux, "share", "applications", "net.codewhale.computer-use.desktop"), "utf8");
    assert.match(desktop, /^Icon=net\.codewhale\.computer-use$/m);
    assert.ok(fs.existsSync(path.join(built.linux, "share", "icons", "hicolor", "256x256", "apps", "net.codewhale.computer-use.png")));
    assert.ok(fs.existsSync(path.join(built.windows, "launch.ps1")));
    assert.ok(fs.existsSync(path.join(built.windows, "icon.ico")));
    for (const root of [path.join(mac, "Resources", "plugin"), path.join(built.linux, "plugin"), path.join(built.windows, "plugin")]) {
      for (const entry of RUNTIME_ENTRIES) assert.ok(fs.existsSync(path.join(root, entry)), `${root} has ${entry}`);
      // computer.spawn builds from the installed plugin root on first use.
      // Check its build context independently of the packager's own list.
      for (const entry of ['docker/Dockerfile', 'docker/entrypoint.sh', 'docker/agent-exec.sh', 'package-lock.json', '.dockerignore']) {
        assert.deepEqual(fs.readFileSync(path.join(root, entry)), fs.readFileSync(path.join(ROOT, entry)), `spawn runtime asset ${entry}`);
      }
      assert.ok(!fs.existsSync(path.join(root, "tests")), "no dev files in the runtime copy");
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
