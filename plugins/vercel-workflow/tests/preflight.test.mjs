import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnvFile, runPreflight, checkProject, isIgnored } from "../scripts/preflight.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "../scripts/preflight.mjs");
const codes = (f) => f.map((x) => x.code);
const tmp = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vcpre-"));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
};
const linked = { ".vercel/project.json": { projectId: "prj_x", orgId: "team_x", projectName: "demo" }, ".gitignore": ".vercel\n.env*.local\nnode_modules\n" };

test("env file parser returns names and values", () => {
  const v = parseEnvFile('# c\nA=1\nexport B="two words"\nbad line\nC=\n');
  assert.deepEqual(v, [{ name: "A", value: "1" }, { name: "B", value: "two words" }, { name: "C", value: "" }]);
});

test("gitignore matching", () => {
  assert.ok(isIgnored(".env.local", [".env*.local"]));
  assert.ok(isIgnored(".env.local", [".env*"]));
  assert.ok(isIgnored(".vercel", [".vercel"]));
  assert.ok(!isIgnored(".env.local", ["node_modules"]));
});

test("the last matching gitignore rule decides whether an env file is ignored", () => {
  assert.equal(isIgnored(".env.production", [".env*", "!.env.production", "node_modules"]), false);
  assert.equal(isIgnored(".env.production", ["!.env.production", ".env*"]), true);
  assert.equal(isIgnored(".env.production", [".env*", "!.env.example"]), true);
  assert.equal(isIgnored(".env.production", ["/.env*", "!/.env.production"]), false);
  assert.equal(isIgnored(".env.production", [".env*", "!.env.prod*"]), false);
  assert.equal(isIgnored(path.join(".vercel", ".env.production.local"), [".env*", "!.vercel/.env.production.local"]), false);
  assert.equal(isIgnored(path.join(".vercel", ".env.production.local"), ["/.env*"]), false);
});

test("filesystem and CLI flag env files re-included by negated gitignore rules", () => {
  const dir = tmp({ ...linked, ".env.production": "API_TOKEN=private-fixture-value\n", ".gitignore": ".vercel\n.env*\n!.env.production\n" });
  const result = runPreflight(dir);
  assert.equal(result.code, 1);
  assert.equal(result.findings.filter((f) => f.code === "VC-ENV-NOT-IGNORED").length, 1);
  const cli = spawnSync(process.execPath, [script, dir, "--json"], { encoding: "utf8" });
  assert.equal(cli.status, 1, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).code, 1);
  assert.ok(!cli.stdout.includes("private-fixture-value"));
  fs.writeFileSync(path.join(dir, ".gitignore"), ".vercel\n!.env.production\n.env*\n");
  assert.equal(runPreflight(dir).code, 0);
});

test("a project gitignore overrides its parent rules", () => {
  const root = tmp({
    ".git": "",
    ".gitignore": ".env*\n",
    "project/.gitignore": ".vercel\n!.env.production\n",
    "project/.env.production": "API_TOKEN=fixture\n",
    "project/.vercel/project.json": { projectId: "prj_x", orgId: "team_x", projectName: "demo" },
  });
  const dir = path.join(root, "project");
  assert.ok(codes(runPreflight(dir).findings).includes("VC-ENV-NOT-IGNORED"));
  fs.writeFileSync(path.join(root, ".gitignore"), "!.env.production\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".vercel\n.env*\n");
  assert.equal(runPreflight(dir).code, 0);
});

test("ancestor ignore paths and negations are relative to the file that defines them", (t) => {
  const root = tmp({
    ".git/keep": "", ".gitignore": ".env*\n!project/.env.production\n",
    "project/.vercel/project.json": { projectId: "prj_x", orgId: "team_x" }, "project/.env.production": "API_TOKEN=fixture\n",
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "project");
  assert.ok(codes(checkProject(dir)).includes("VC-ENV-NOT-IGNORED"));
  fs.writeFileSync(path.join(root, ".gitignore"), "/.env.production\n");
  assert.ok(codes(checkProject(dir)).includes("VC-ENV-NOT-IGNORED"), "a root-anchored rule does not cover the nested project's env file");
  fs.writeFileSync(path.join(root, ".gitignore"), "/project/.env.production\n");
  assert.ok(!codes(checkProject(dir)).includes("VC-ENV-NOT-IGNORED"));
});

test("path-specific negation for pulled env files cannot be overridden by basename matching", () => {
  const dir = tmp({ ...linked, ".vercel/.env.production.local": "API_TOKEN=fixture\n", ".gitignore": ".env*\n!.vercel/.env.production.local\n" });
  assert.ok(codes(runPreflight(dir).findings).includes("VC-ENV-NOT-IGNORED"));
  fs.writeFileSync(path.join(dir, ".gitignore"), "!.vercel/.env.production.local\n.env*\n");
  assert.ok(!codes(runPreflight(dir).findings).includes("VC-ENV-NOT-IGNORED"));
  // Git cannot re-include a file while its entire parent directory is excluded.
  fs.writeFileSync(path.join(dir, ".gitignore"), ".vercel/\n!.vercel/.env.production.local\n");
  assert.ok(!codes(runPreflight(dir).findings).includes("VC-ENV-NOT-IGNORED"));
});

test("a linked, clean project has no errors or warnings", () => {
  const dir = tmp({ ...linked, "vercel.json": { buildCommand: "npm run build", crons: [{ path: "/api/cron", schedule: "0 5 * * *" }], rewrites: [{ source: "/a", destination: "/b" }] }, "package.json": { name: "x" } });
  const r = runPreflight(dir);
  assert.equal(r.code, 0);
  assert.deepEqual(r.findings.filter((f) => f.level !== "info"), []);
  assert.ok(r.findings.some((f) => f.code === "VC-LINKED" && /demo/.test(f.message)));
});

test("an unlinked directory is warned: the first deploy is production", () => {
  const r = runPreflight(tmp({ "package.json": { name: "x" } }));
  const f = r.findings.find((x) => x.code === "VC-NOT-LINKED");
  assert.equal(f.level, "warn");
  assert.match(f.message, /always production/);
});

test("vercel.json: parse errors, legacy routes mix, builds, env, multiple config files", () => {
  assert.ok(codes(runPreflight(tmp({ "vercel.json": "{ nope" })).findings).includes("VC-JSON-PARSE"));
  assert.ok(codes(runPreflight(tmp({ "vercel.json": [] })).findings).includes("VC-JSON-SHAPE"));
  const mix = runPreflight(tmp({ "vercel.json": { routes: [{ src: "/a", dest: "/b" }], headers: [] } }));
  assert.equal(mix.code, 1);
  assert.ok(codes(mix.findings).includes("VC-ROUTES-MIX"));
  assert.ok(codes(runPreflight(tmp({ "vercel.json": { routes: [] } })).findings).includes("VC-LEGACY-ROUTES"));
  const legacy = codes(runPreflight(tmp({ "vercel.json": { builds: [], env: { A: "b" }, build: { env: { C: "d" } } } })).findings);
  for (const c of ["VC-LEGACY-BUILDS", "VC-LEGACY-ENV", "VC-LEGACY-BUILD-ENV"]) assert.ok(legacy.includes(c), c);
  const multi = runPreflight(tmp({ "vercel.json": {}, "vercel.ts": "export default {}", "now.json": {} }));
  assert.ok(codes(multi.findings).includes("VC-MULTI-CONFIG"));
  assert.ok(codes(multi.findings).includes("VC-NOW-JSON"));
});

test("vercel.json: crons, rules, headers, functions, regions", () => {
  const bad = runPreflight(tmp({
    "vercel.json": {
      crons: [{ path: "api/x", schedule: "* * *" }],
      rewrites: [{ source: "/a" }],
      redirects: "no",
      headers: [{ source: "/", headers: [{ key: "A" }] }],
      functions: { "api/*.ts": { maxDuration: -1 } },
      regions: [1],
    },
  }));
  for (const c of ["VC-CRON-PATH", "VC-CRON-SCHEDULE", "VC-RULE-FIELDS", "VC-RULE-SHAPE", "VC-HEADER-FIELDS", "VC-MAXDURATION", "VC-REGIONS"]) assert.ok(codes(bad.findings).includes(c), c);
  assert.equal(bad.code, 1);
});

test("credential-shaped values are errors and never echoed", () => {
  const secret = "ghp_" + "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Jh1G";
  const dir = tmp({ ...linked, "vercel.json": { headers: [{ source: "/", headers: [{ key: "X-Token", value: secret }] }] }, ".env.example": `API=${secret}\nSAFE=changeme\n` });
  const r = runPreflight(dir);
  assert.ok(codes(r.findings).includes("VC-CREDENTIAL-IN-CONFIG"));
  assert.ok(codes(r.findings).includes("VC-CREDENTIAL-IN-EXAMPLE"));
  assert.ok(!JSON.stringify(r).includes(secret));
});

test("env files: not ignored is an error, example files are allowed", () => {
  const dir = tmp({ ".vercel/project.json": { projectName: "d" }, ".gitignore": ".vercel\n", ".env.local": "A=1\n", ".env.example": "A=\n" });
  const r = runPreflight(dir);
  const f = r.findings.filter((x) => x.code === "VC-ENV-NOT-IGNORED");
  assert.equal(f.length, 1);
  assert.match(f[0].message, /\.env\.local/);
  fs.writeFileSync(path.join(dir, ".gitignore"), ".vercel\n.env*.local\n");
  assert.ok(!codes(runPreflight(dir).findings).includes("VC-ENV-NOT-IGNORED"));
});

test("pulled env files under .vercel count, and .vercel itself should be ignored", () => {
  const dir = tmp({ ".vercel/project.json": { projectName: "d" }, ".vercel/.env.preview.local": "A=1\n", ".gitignore": "node_modules\n" });
  const c = codes(runPreflight(dir).findings);
  assert.ok(c.includes("VC-ENV-NOT-IGNORED"));
  assert.ok(c.includes("VC-VERCEL-DIR"));
});

test("public-prefixed secrets: hard names are errors, tokens warn, publishable keys pass", () => {
  const dir = tmp({ ...linked, ".env.local": "NEXT_PUBLIC_STRIPE_SECRET_KEY=a\nNEXT_PUBLIC_MAP_TOKEN=b\nNEXT_PUBLIC_SUPABASE_ANON_KEY=c\nNEXT_PUBLIC_PUBLISHABLE_KEY=d\nVITE_DB_PASSWORD=e\nSERVER_TOKEN=f\n" });
  const f = runPreflight(dir).findings;
  const by = (code) => f.filter((x) => x.code === code).map((x) => x.message);
  assert.equal(by("VC-PUBLIC-SECRET").length, 2);
  assert.ok(by("VC-PUBLIC-SECRET").some((m) => m.includes("NEXT_PUBLIC_STRIPE_SECRET_KEY")));
  assert.ok(by("VC-PUBLIC-SECRET").some((m) => m.includes("VITE_DB_PASSWORD")));
  assert.equal(by("VC-PUBLIC-TOKEN").length, 1);
  assert.ok(!JSON.stringify(f).includes('"a"'));
});

test("next.js: middleware on 16, both files, static export with rules, standalone, ignored build errors", () => {
  const base = { ...linked, "package.json": { dependencies: { next: "^16.0.0" } } };
  assert.ok(codes(runPreflight(tmp({ ...base, "middleware.ts": "export function middleware(){}" })).findings).includes("VC-MIDDLEWARE-RENAMED"));
  // the pair is detected across src/ and root locations
  assert.ok(codes(runPreflight(tmp({ ...base, "src/middleware.ts": "", "proxy.ts": "" })).findings).includes("VC-MW-AND-PROXY"));
  const both = runPreflight(tmp({ ...base, "middleware.ts": "", "proxy.ts": "" }));
  assert.ok(codes(both.findings).includes("VC-MW-AND-PROXY"));
  assert.equal(both.code, 1);
  // Next 15 keeps middleware without a warning
  assert.ok(!codes(runPreflight(tmp({ ...linked, "package.json": { dependencies: { next: "15.5.0" } }, "middleware.ts": "" })).findings).includes("VC-MIDDLEWARE-RENAMED"));
  const cfg = runPreflight(tmp({ ...base, "next.config.ts": 'export default { output: "export", async redirects(){ return [] }, typescript: { ignoreBuildErrors: true } }' }));
  assert.ok(codes(cfg.findings).includes("VC-EXPORT-IGNORES-RULES"));
  assert.ok(codes(cfg.findings).includes("VC-BUILD-CHECKS-OFF"));
  assert.ok(codes(runPreflight(tmp({ ...base, "next.config.mjs": 'export default { output: "standalone" }' })).findings).includes("VC-STANDALONE"));
  // export without rules is fine
  assert.ok(!codes(runPreflight(tmp({ ...base, "next.config.mjs": 'export default { output: "export" }' })).findings).includes("VC-EXPORT-IGNORES-RULES"));
});

test("package.json parse failure and missing directory", () => {
  assert.ok(codes(runPreflight(tmp({ "package.json": "{ x" })).findings).includes("VC-PKG-PARSE"));
  assert.equal(runPreflight("/nonexistent/vc").code, 2);
});

test("CLI: exit codes and output formats", () => {
  const bad = tmp({ "vercel.json": { routes: [], rewrites: [] } });
  const res = spawnSync(process.execPath, [script, bad], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /ERROR VC-ROUTES-MIX/);
  assert.match(res.stdout, /Fix the errors above/);
  const json = JSON.parse(spawnSync(process.execPath, [script, bad, "--json"], { encoding: "utf8" }).stdout);
  assert.equal(json.code, 1);
  const ok = tmp({ ...linked });
  const okRes = spawnSync(process.execPath, [script, ok], { encoding: "utf8" });
  assert.equal(okRes.status, 0, okRes.stdout);
  assert.equal(spawnSync(process.execPath, [script, "/nonexistent"], { encoding: "utf8" }).status, 2);
});

test("safety: the checker has no process, network, eval or write capability", () => {
  const src = fs.readFileSync(script, "utf8");
  for (const banned of [/child_process/, /\bfetch\s*\(/, /node:(https?|net|dgram|tls|dns)\b/, /\bwriteFile/, /\bappendFile/, /\bunlink(Sync)?\s*\(/, /\brmSync/, /\bspawn/, /(?<![.\w])exec(Sync|File|FileSync)?\s*\(/, /\beval\s*\(/, /new Function\b/, /\bimport\s*\(/, /\brequire\s*\(/]) {
    assert.ok(!banned.test(src), `preflight.mjs must not contain ${banned}`);
  }
});
