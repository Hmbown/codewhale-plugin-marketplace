#!/usr/bin/env node
// Verify a built app bundle's signature/notarization readiness.
// Usage: node scripts/verify-bundle.mjs <path-to-.app>
// macOS: codesign --verify --deep --strict, codesign -dv (identifier + team),
// spctl --assess --type execute; prints a JSON verdict.
// Non-macOS: prints {"status":"unavailable", ...} and exits 2.
import { spawnSync } from "node:child_process";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("usage: node scripts/verify-bundle.mjs <path-to-.app>");
  process.exit(2);
}

if (process.platform !== "darwin") {
  console.log(JSON.stringify({ status: "unavailable", reason: "codesign requires macOS" }));
  process.exit(2);
}

const { APP_ID } = await import("../src/app-socket.mjs");

function sh(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // codesign writes identity details to stderr even when it succeeds.
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr || result.error?.message || "" };
}

const verify = sh("codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundlePath]);
const info = sh("codesign", ["-dv", "--verbose=2", bundlePath]);
const infoText = info.stdout + info.stderr;
const identifier = /Identifier=([^\s]+)/.exec(infoText)?.[1] ?? null;
const team = /TeamIdentifier=([^\s]+)/.exec(infoText)?.[1] ?? null;
const spctl = sh("spctl", ["--assess", "--type", "execute", bundlePath]);

const verdict = {
  bundle: bundlePath,
  expected_identifier: APP_ID,
  codesign_verify: verify.code === 0 ? "ok" : `failed (exit ${verify.code}): ${(verify.stderr || verify.stdout).trim().slice(0, 300)}`,
  identifier,
  identifier_matches: identifier === APP_ID,
  team_identifier: team,
  hardened_runtime: /flags=0x[0-9a-f]+\(runtime\)/i.test(infoText),
  spctl_assess: spctl.code === 0 ? "accepted" : `rejected (exit ${spctl.code}): ${(spctl.stderr || spctl.stdout).trim().slice(0, 300)}`,
};
verdict.signature_status = verdict.codesign_verify === "ok" && verdict.identifier_matches && verdict.hardened_runtime ? "ok" : "failed";
verdict.distribution_ready = verdict.signature_status === "ok" && spctl.code === 0;
verdict.status = verdict.signature_status !== "ok" ? "failed" : verdict.distribution_ready ? "ok" : "gatekeeper_rejected";
console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.status === "ok" ? 0 : 1);
