#!/usr/bin/env node
// Scan JSON/JSONL/Markdown evidence (parity receipts, results, docs) for leaked
// secrets or machine-identifying paths before they are committed.
// Usage: node scripts/check-receipts.mjs <dir|file> [...]
// Exits 1 when anything matches; prints file:line for each finding.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCANNED_USERNAME = os.userInfo().username;
const SCANNED_HOME = os.homedir();

const RULES = [
  { name: "absolute home path", re: new RegExp(`${escapeRe(SCANNED_HOME)}|/(home|Users)/${escapeRe(SCANNED_USERNAME)}\\b`, "g") },
  // Generic system accounts also occur as ordinary prose (a test runner,
  // a source root). Their absolute home paths remain checked above.
  ...(["runner", "root", "user"].includes(SCANNED_USERNAME) ? [] : [
    { name: "username", re: new RegExp(`\\b${escapeRe(SCANNED_USERNAME)}\\b`, "g") },
  ]),
  { name: "PEM block", re: /-----BEGIN/g },
  { name: "api key (sk-…)", re: /\bsk-[A-Za-z0-9_-]{3,}/g },
  { name: "github token (ghp_…)", re: /\bghp_[A-Za-z0-9]+/g },
  { name: "aws key (AKIA…)", re: /\bAKIA[A-Z0-9]+/g },
  { name: "bearer token", re: /Bearer\s+\S+/g },
  { name: "slack token (xoxb-/xoxp-)", re: /\bxox[bp]-\S+/g },
  { name: "email address", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) yield* walk(path.join(p, e));
  } else if (/\.(json|jsonl|md)$/i.test(p)) {
    yield p;
  }
}

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error("usage: node scripts/check-receipts.mjs <dir|file> [...]");
  process.exit(2);
}

let findings = 0;
for (const root of roots) {
  for (const file of walk(path.resolve(root))) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { name, re } of RULES) {
        re.lastIndex = 0;
        if (re.test(line)) {
          findings++;
          // A hygiene check must not copy the leaked evidence into CI logs.
          console.log(`${file}:${i + 1}: ${name}`);
        }
      }
    });
  }
}

if (findings) {
  console.error(`\ncheck-receipts: ${findings} finding(s) — sanitize or remove before committing`);
  process.exit(1);
}
console.log("check-receipts: clean");
