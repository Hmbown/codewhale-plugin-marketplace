// Engine tests — spawn the real CLI against a temp repo so repo-root
// resolution, manifest sealing, and staleness are exercised end to end.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const ENGINE = fileURLToPath(new URL("../scripts/whalewiki.mjs", import.meta.url));

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whalewiki-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "index.ts"), "export function greet() {}\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "engine.ts"),
    "import { greet } from '../index';\nexport class Engine { run() {} }\n");
  return dir;
}

function run(repo, args, opts = {}) {
  return execFileSync("node", [ENGINE, ...args], {
    cwd: repo, encoding: "utf8", ...opts,
  });
}

function scaffoldedRepo() {
  const repo = makeRepo();
  run(repo, ["scaffold"]);
  return repo;
}

function seal(repo, page = "pages/architecture.md", sources = "src/engine.ts") {
  fs.writeFileSync(path.join(repo, "whalewiki", page), "# Architecture\n\nEngine runs turns.\n");
  run(repo, ["manifest", "set", page, "--sources", sources]);
}

test("scaffold creates the wiki layout and self-verifier", () => {
  const repo = scaffoldedRepo();
  for (const rel of [
    "whalewiki/manifest.json", "whalewiki/INSTRUCTIONS.md", "whalewiki/INDEX.md",
    "whalewiki/whalewiki.toml", "whalewiki/.tool/status.mjs",
  ]) {
    assert.ok(fs.existsSync(path.join(repo, rel)), rel);
  }
  // The copied tool works standalone — this is the CI drift gate.
  const out = execFileSync("node", [path.join(repo, "whalewiki/.tool/status.mjs"), "--short"],
    { cwd: repo, encoding: "utf8" });
  assert.match(out, /no pages sealed/);
});

test("sealed page reports fresh, then stale after a source change", () => {
  const repo = scaffoldedRepo();
  seal(repo);
  let report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.fresh, 1);

  fs.appendFileSync(path.join(repo, "src", "engine.ts"), "export const x = 1;\n");
  report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.stale, 1);
  assert.deepEqual(report.pages[0].changed, ["src/engine.ts"]);
});

test("comment and formatting changes require review without a language parser", () => {
  const repo = scaffoldedRepo();
  seal(repo);
  // Full-line comment added + whitespace churn: the claims still hold.
  fs.writeFileSync(path.join(repo, "src", "engine.ts"),
    "// the engine entry point\nimport   {   greet   } from '../index';\n\nexport class Engine { run() {} }\n");
  const report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.touched, 0);
  assert.equal(report.counts.stale, 1);
  assert.deepEqual(report.pages[0].changed, ["src/engine.ts"]);
  // Conservative evidence: any changed source invalidates the seal.
  assert.throws(() => run(repo, ["status", "--exit-stale"]), e => e.status === 2);
});

test("a real code change still reads stale after the signature upgrade", () => {
  const repo = scaffoldedRepo();
  seal(repo);
  fs.writeFileSync(path.join(repo, "src", "engine.ts"),
    "export class Engine { run(fast) { return fast; } }\n");
  const report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.stale, 1);
  assert.equal(report.counts.touched, 0);
});

test("--exit-stale exits 2 when any page is stale or orphaned", () => {
  const repo = scaffoldedRepo();
  seal(repo);
  fs.appendFileSync(path.join(repo, "src", "engine.ts"), "export const moved = true;\n");
  assert.throws(
    () => run(repo, ["status", "--exit-stale"]),
    (err) => err.status === 2,
  );
});

test("deleted basis file makes the page orphaned", () => {
  const repo = scaffoldedRepo();
  seal(repo);
  fs.rmSync(path.join(repo, "src", "engine.ts"));
  const report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.orphaned, 1);
  assert.deepEqual(report.pages[0].missing, ["src/engine.ts"]);
});

test("pages on disk without a manifest entry are unsealed", () => {
  const repo = scaffoldedRepo();
  fs.writeFileSync(path.join(repo, "whalewiki", "pages", "loose.md"), "# Loose\n");
  const report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.unsealed, 1);
});

test("manifest set refuses path escapes and missing sources", () => {
  const repo = scaffoldedRepo();
  assert.throws(() => run(repo, ["manifest", "set", "pages/x.md", "--sources", "../outside.ts"]));
  assert.throws(() => run(repo, ["manifest", "set", "pages/x.md", "--sources", "nope.ts"]));
});

test("search ranks pages by term hits", () => {
  const repo = scaffoldedRepo();
  seal(repo);
  const out = run(repo, ["search", "engine turns"]);
  assert.match(out, /pages\/architecture\.md \(score [1-9]/);
});

test("export renders a self-contained viewer with freshness badges", () => {
  const repo = scaffoldedRepo();
  seal(repo);
  fs.appendFileSync(path.join(repo, "src", "engine.ts"), "export const drift = 1;\n");
  const out = path.join(repo, "whalewiki", "view.html");
  run(repo, ["export", "--out", out]);
  const html = fs.readFileSync(out, "utf8");
  assert.match(html, /pages\/architecture\.md/);
  assert.match(html, /stale/);
  assert.match(html, /<h1[^>]*>Architecture<\/h1>/);
});

test("pod mode: name:path sources seal across roots and drift is detected", () => {
  const repo = scaffoldedRepo();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "whalewiki-pod-"));
  fs.writeFileSync(path.join(other, "catalog.json"), '{"plugins":[]}\n');
  fs.writeFileSync(path.join(repo, "whalewiki", "whalewiki.toml"),
    '[[sources]]\nname = "other"\nroot = "' + other + '"\n');
  seal(repo, "pages/cross.md", `src/engine.ts,other:catalog.json`);
  let report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.fresh, 1);
  fs.writeFileSync(path.join(other, "catalog.json"), '{"plugins":["x"]}\n');
  report = JSON.parse(run(repo, ["status", "--json"]));
  assert.equal(report.counts.stale, 1);
  assert.deepEqual(report.pages[0].changed, ["catalog.json"]);
});

test("map writes a deterministic codemap", () => {
  const repo = scaffoldedRepo();
  run(repo, ["map"]);
  const map = fs.readFileSync(path.join(repo, "whalewiki", "codemap.md"), "utf8");
  assert.match(map, /# Codemap/);
  assert.match(map, /`Engine`/);
  assert.match(map, /\.ts/);
});
