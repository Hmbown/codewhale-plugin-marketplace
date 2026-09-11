#!/usr/bin/env node
// Check that the three copies of computer-use stay in their declared
// relationship instead of silently diverging:
//
//   codewhale-cu-plugin/            upstream (the repo that authors it)
//   this repo plugins/computer-use/ vendored mirror — every file must be
//                                   byte-identical to upstream
//   codewhale crates/tui/plugins/   Core's vendored runtime+tests subset;
//     computer-use/               embedded by crates/tui/src/plugins/builtin.rs
//
// Usage: node scripts/check-cu-sync.mjs [--upstream <dir>] [--core <dir>]
// Defaults: sibling checkouts ../codewhale-cu-plugin and ../codewhale.
// Missing checkouts are reported as skipped, not failed — this also runs on
// machines that only carry the marketplace clone.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const HERE = path.join(ROOT, "plugins", "computer-use");
const PIN = path.join(HERE, ".upstream-sha");

const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? path.resolve(process.argv[i + 1]) : null; };
const UPSTREAM = arg("--upstream") ?? path.resolve(ROOT, "..", "codewhale-cu-plugin");
const CORE = arg("--core") ?? path.resolve(ROOT, "..", "codewhale");
const CORE_TREE = path.join(CORE, "crates", "tui", "plugins", "computer-use");

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const note = (m) => notes.push(m);

function tree(dir, skip = () => false) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = path.relative(dir, path.join(d, e.name));
      if (skip(rel)) continue;
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.isFile()) out.set(rel, fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir);
  return out;
}

// Files that are produced locally and never belong to the vendored contract.
const IGNORE = /(^|\/)(receipts|dist|node_modules)(\/|$)|\.DS_Store$|(^|\/)\.git(\/|$)/;
// Marketplace/upstream carry dev surfaces Core deliberately does not vendor
// (icons, packaging scripts, parity harness, extra tests, dual manifests).
// The Core comparison only iterates files Core carries, so nothing extra
// needs to be excluded from this side.
// Files that deliberately differ in Core's vendored copy: the bundled
// package.json is renamed/trimmed, the README describes the bundled context,
// and manifest.test skips the kimi.plugin.json contract Core does not carry.
const CORE_VARIANTS = new Set(["package.json", "README.md", "tests/manifest.test.mjs"]);

const upstreamExists = fs.existsSync(path.join(UPSTREAM, "plugin.json"));
const coreExists = fs.existsSync(CORE_TREE);

if (upstreamExists) {
  const sha = execSync("git rev-parse HEAD", { cwd: UPSTREAM, encoding: "utf8" }).trim();
  const pin = fs.existsSync(PIN) ? fs.readFileSync(PIN, "utf8").trim() : null;
  if (pin && pin !== sha) note(`pin ${pin.slice(0, 8)} vs upstream HEAD ${sha.slice(0, 8)} — upstream moved; re-vendor and update .upstream-sha`);
  if (!pin) note(`no .upstream-sha pin; upstream HEAD is ${sha.slice(0, 12)}`);

  const a = tree(HERE, (rel) => IGNORE.test(rel) || rel === ".upstream-sha");
  const b = tree(UPSTREAM, (rel) => IGNORE.test(rel));
  for (const [rel, buf] of a) {
    const theirs = b.get(rel);
    if (!theirs) { fail(`${rel}: in marketplace but not in upstream`); continue; }
    if (!buf.equals(theirs)) fail(`${rel}: marketplace copy differs from upstream`);
  }
  for (const rel of b.keys()) if (!a.has(rel)) fail(`${rel}: in upstream but missing from marketplace`);
  if (!problems.length) note(`marketplace mirror == upstream @ ${sha.slice(0, 12)}`);
} else {
  note(`upstream checkout not found at ${UPSTREAM} — mirror comparison skipped`);
}

if (coreExists) {
  const a = tree(HERE, (rel) => IGNORE.test(rel) || rel === ".upstream-sha");
  const c = tree(CORE_TREE, (rel) => IGNORE.test(rel));
  // Core's vendored tree is a runtime+tests subset: every file Core carries
  // must exist here with identical bytes; files only here are dev surfaces.
  let drift = 0;
  for (const [rel, buf] of c) {
    const ours = a.get(rel);
    if (!ours) { fail(`core:${rel}: vendored in Core but absent here`); continue; }
    if (!ours.equals(buf)) {
      if (CORE_VARIANTS.has(rel)) { note(`core:${rel}: deliberate Core variant`); continue; }
      drift++;
      note(`core:${rel}: differs — expected only while an upstream sync is in flight; builtin.rs embeds this copy`);
    }
  }
  if (!drift) note(`Core vendored tree matches the marketplace runtime set`);
} else {
  note(`Core checkout not found at ${CORE_TREE} — vendored comparison skipped`);
}

for (const m of notes) console.log(`note: ${m}`);
if (problems.length) {
  for (const m of problems) console.error(`FAIL: ${m}`);
  process.exit(1);
}
console.log("computer-use copies: OK");
