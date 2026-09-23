import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * A throwaway catalog with one bundle, checked by the real script.
 *
 * @param {string[]} keywords
 * @param {{vendored?: boolean}} [options]
 */
function checkCatalog(keywords, { vendored = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-stoplist-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.copyFileSync(path.join(ROOT, "scripts", "check-marketplace.mjs"), path.join(dir, "scripts", "check-marketplace.mjs"));
  const bundle = path.join(dir, "plugins", "demo");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, "plugin.json"), JSON.stringify({ name: "demo", version: "1.0.0", keywords }));
  fs.writeFileSync(path.join(bundle, "README.md"), "# demo\n");
  fs.writeFileSync(path.join(bundle, "LICENSE"), "MIT\n");
  if (vendored) fs.writeFileSync(path.join(bundle, ".upstream-sha"), "0".repeat(40));
  fs.writeFileSync(
    path.join(dir, "marketplace.json"),
    JSON.stringify({ name: "test", plugins: [{ name: "demo", source: "path:plugins/demo", description: "A demo bundle." }] }),
  );
  const run = spawnSync(process.execPath, [path.join(dir, "scripts", "check-marketplace.mjs")], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return run;
}

test("the stoplist covers every generic word the offer policy names", () => {
  const policy = ["accessibility", "screenshot", "automation", "browser", "web", "wiki", "documentation"];
  const run = checkCatalog(policy);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  for (const term of policy) assert.match(run.stderr, new RegExp(`'${term}'`), term);
});

test("check-marketplace rejects a stoplisted keyword", () => {
  const run = checkCatalog(["web", "demo-specific"]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /demo: generic keyword\(s\) 'web'/);
});

test("check-marketplace matches stoplisted keywords case-insensitively", () => {
  const run = checkCatalog(["Browser"]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /'Browser'/);
});

test("specific keywords pass", () => {
  const run = checkCatalog(["demo-specific", "side-panel"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("a vendored mirror is reported, not failed, because the fix belongs upstream", () => {
  const run = checkCatalog(["screenshot"], { vendored: true });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /note: demo: generic keyword\(s\) 'screenshot'.*fix it upstream/);
});
