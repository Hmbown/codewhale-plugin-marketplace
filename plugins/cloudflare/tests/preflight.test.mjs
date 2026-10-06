import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stripJsonc, parseJsonc, parseToml, checkConfig, runPreflight, isIgnored } from "../scripts/preflight.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "../scripts/preflight.mjs");
const TODAY = "2026-10-05";
const codes = (findings) => findings.map((f) => f.code);
const tmp = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfpre-"));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
};
const good = { name: "w", main: "src/index.ts", compatibility_date: "2026-09-01", observability: { enabled: true } };
const check = (cfg, extra = {}) => checkConfig(cfg, { today: TODAY, fsChecks: false, ...extra });

test("jsonc: comments and trailing commas, strings untouched", () => {
  const v = parseJsonc('{\n // c\n "a": "x // not a comment", /* b */ "b": [1,2,],\n}');
  assert.deepEqual(v, { a: "x // not a comment", b: [1, 2] });
  assert.equal(stripJsonc('{"u":"http://x"}'), '{"u":"http://x"}');
  assert.throws(() => stripJsonc("/* open"));
});

test("toml subset: tables, arrays of tables, multi-line arrays, inline tables", () => {
  const t = parseToml(`
name = "w"  # trailing comment
compatibility_flags = [
  "nodejs_compat", # why
  "other",
]
[vars]
MODE = 'prod'
[assets]
directory = "./dist"
[[kv_namespaces]]
binding = "A"
id = "abc"
[[kv_namespaces]]
binding = "B"
[[durable_objects.bindings]]
name = "R"
class_name = "Room"
[[migrations]]
tag = "v1"
new_sqlite_classes = ["Room"]
[exports.Room]
type = "durable-object"
inline = { a = 1, b = "x" }
`);
  assert.equal(t.name, "w");
  assert.deepEqual(t.compatibility_flags, ["nodejs_compat", "other"]);
  assert.equal(t.vars.MODE, "prod");
  assert.equal(t.kv_namespaces.length, 2);
  assert.equal(t.kv_namespaces[1].binding, "B");
  assert.equal(t.durable_objects.bindings[0].class_name, "Room");
  assert.deepEqual(t.migrations[0].new_sqlite_classes, ["Room"]);
  assert.deepEqual(t.exports.Room.inline, { a: 1, b: "x" });
  assert.throws(() => parseToml('a = """multi"""'));
});

test("a healthy config has no errors or warnings", () => {
  const f = check(good);
  assert.deepEqual(f.filter((x) => x.level !== "info"), []);
});

test("missing name, nothing to deploy, bad and future compatibility dates", () => {
  assert.ok(codes(check({})).includes("CF-NO-NAME"));
  assert.ok(codes(check({ name: "w" })).includes("CF-NOTHING-TO-DEPLOY"));
  assert.ok(codes(check({ ...good, compatibility_date: "2027-01-01" })).includes("CF-FUTURE-COMPAT-DATE"));
  assert.ok(codes(check({ ...good, compatibility_date: "yesterday" })).includes("CF-BAD-COMPAT-DATE"));
  assert.ok(codes(check({ ...good, compatibility_date: undefined })).includes("CF-NO-COMPAT-DATE"));
  assert.ok(codes(check({ ...good, compatibility_date: "2024-01-01" })).includes("CF-OLD-COMPAT-DATE"));
});

test("pages config is flagged, not treated as nothing-to-deploy", () => {
  const c = codes(check({ name: "p", pages_build_output_dir: "dist" }));
  assert.ok(c.includes("CF-PAGES-CONFIG"));
  assert.ok(!c.includes("CF-NOTHING-TO-DEPLOY"));
});

test("durable objects: binding without lifecycle, both styles, kv backend, duplicate tags", () => {
  const binding = { durable_objects: { bindings: [{ name: "R", class_name: "Room" }] } };
  assert.ok(codes(check({ ...good, ...binding })).includes("CF-DO-NO-LIFECYCLE"));
  assert.ok(!codes(check({ ...good, ...binding, migrations: [{ tag: "v1", new_sqlite_classes: ["Room"] }] })).includes("CF-DO-NO-LIFECYCLE"));
  assert.ok(!codes(check({ ...good, ...binding, exports: { Room: { type: "durable-object", storage: "sqlite" } } })).includes("CF-DO-NO-LIFECYCLE"));
  assert.ok(codes(check({ ...good, ...binding, exports: { Room: { type: "durable-object", storage: "sqlite" } } })).includes("CF-EXPORTS-WRANGLER"));
  assert.ok(codes(check({ ...good, ...binding, exports: { Room: { type: "durable-object" } }, migrations: [{ tag: "v1", new_sqlite_classes: ["Room"] }] })).includes("CF-DO-BOTH"));
  assert.ok(codes(check({ ...good, ...binding, migrations: [{ tag: "v1", new_classes: ["Room"] }] })).includes("CF-DO-KV-BACKEND"));
  assert.ok(codes(check({ ...good, migrations: [{ tag: "v1" }, { tag: "v1" }] })).includes("CF-DO-DUP-TAG"));
  // a deleted tombstone does not satisfy a binding
  assert.ok(codes(check({ ...good, ...binding, exports: { Room: { type: "durable-object", state: "deleted" } } })).includes("CF-DO-NO-LIFECYCLE"));
  // a binding to another Worker's class is not ours to declare
  assert.ok(!codes(check({ ...good, durable_objects: { bindings: [{ name: "R", class_name: "Room", script_name: "other" }] } })).includes("CF-DO-NO-LIFECYCLE"));
});

test("placeholder resource ids are errors; missing ids are notes", () => {
  const f = check({ ...good, d1_databases: [{ binding: "DB", database_id: "<UUID>" }], kv_namespaces: [{ binding: "K", id: "xxxxxxxx" }, { binding: "K2" }] });
  assert.equal(f.filter((x) => x.code === "CF-PLACEHOLDER-ID").length, 2);
  assert.equal(f.filter((x) => x.code === "CF-UNBOUND-ID" && x.level === "info").length, 1);
  const real = check({ ...good, d1_databases: [{ binding: "DB", database_id: "5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b" }] });
  assert.ok(!codes(real).includes("CF-PLACEHOLDER-ID"));
});

test("env scopes are checked too", () => {
  const f = check({ ...good, env: { staging: { kv_namespaces: [{ binding: "K", id: "<ID>" }], vars: { DB_PASSWORD: "hunter2hunter2" } } } });
  const placeholder = f.find((x) => x.code === "CF-PLACEHOLDER-ID");
  assert.match(placeholder.message, /^env\.staging\./);
  assert.ok(f.some((x) => x.code === "CF-SECRET-VAR" && /env\.staging\.vars\.DB_PASSWORD/.test(x.message)));
});

test("credentials: named and shaped values are flagged and never echoed", () => {
  const secret = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
  const f = check({ ...good, vars: { API_KEY: "plain-literal-value", MODE: "prod", NOTE: secret } });
  assert.ok(f.some((x) => x.code === "CF-SECRET-VAR" && x.level === "warn"));
  assert.ok(f.some((x) => x.code === "CF-CREDENTIAL-IN-CONFIG" && x.level === "error" && x.message.includes("vars.NOTE")));
  const blob = JSON.stringify(f);
  assert.ok(!blob.includes(secret));
  assert.ok(!blob.includes("plain-literal-value"));
  // empty and placeholder values are not credentials
  assert.ok(!codes(check({ ...good, vars: { API_KEY: "" , TOKEN: "<set with wrangler secret>" } })).includes("CF-SECRET-VAR"));
});

test("legacy keys warn", () => {
  const c = codes(check({ ...good, node_compat: true, site: { bucket: "./x" } }));
  assert.ok(c.includes("CF-NODE-COMPAT") && c.includes("CF-WORKERS-SITES"));
});

test("gitignore matching", () => {
  assert.ok(isIgnored(".dev.vars", [".dev.vars*"]));
  assert.ok(isIgnored(".env", [".env", "node_modules"]));
  assert.ok(isIgnored(".env", [".env*"]));
  assert.ok(!isIgnored(".env", ["node_modules", ".envrc"]));
});

test("filesystem: untracked local secrets, missing assets directory", () => {
  const dir = tmp({
    "wrangler.jsonc": JSON.stringify({ ...good, assets: { directory: "./dist" } }),
    ".dev.vars": "API_TOKEN=x\n",
    ".gitignore": "node_modules\n",
    "src/index.ts": "export default {}\n",
  });
  const r = runPreflight(dir, { today: TODAY });
  assert.equal(r.code, 1);
  assert.ok(codes(r.findings).includes("CF-LOCAL-SECRETS-TRACKED"));
  assert.ok(codes(r.findings).includes("CF-ASSETS-MISSING"));
  assert.ok(!codes(r.findings).includes("CF-MAIN-MISSING"));
  fs.writeFileSync(path.join(dir, ".gitignore"), ".dev.vars*\n.wrangler\n");
  fs.mkdirSync(path.join(dir, "dist"));
  const r2 = runPreflight(dir, { today: TODAY });
  assert.equal(r2.code, 0, JSON.stringify(r2.findings));
});

test("unparseable and absent config", () => {
  const bad = tmp({ "wrangler.jsonc": "{ not json" });
  assert.equal(runPreflight(bad).code, 1);
  assert.ok(codes(runPreflight(bad).findings).includes("CF-UNPARSEABLE"));
  assert.equal(runPreflight(tmp({ "README.md": "x" })).code, 2);
  assert.equal(runPreflight("/nonexistent/path/for/cf").code, 2);
});

test("CLI: exit codes, text and json output, process boundary", () => {
  const dir = tmp({ "wrangler.toml": 'name = "t"\nmain = "i.ts"\ncompatibility_date = "2026-09-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "REPLACE_ME"\n', "i.ts": "" });
  const res = spawnSync(process.execPath, [script, dir, "--today", TODAY], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /ERROR CF-PLACEHOLDER-ID/);
  assert.match(res.stdout, /Fix the errors above/);
  const json = JSON.parse(spawnSync(process.execPath, [script, dir, "--json", "--today", TODAY], { encoding: "utf8" }).stdout);
  assert.equal(json.code, 1);
  assert.ok(json.findings.some((f) => f.code === "CF-PLACEHOLDER-ID"));
  const ok = tmp({ "wrangler.jsonc": JSON.stringify(good), "src/index.ts": "", ".gitignore": ".wrangler\n" });
  const okRes = spawnSync(process.execPath, [script, ok, "--today", TODAY], { encoding: "utf8" });
  assert.equal(okRes.status, 0, okRes.stdout + okRes.stderr);
  assert.equal(spawnSync(process.execPath, [script, "/nonexistent"], { encoding: "utf8" }).status, 2);
});

test("safety: the checker has no process, network or write capability", () => {
  const src = fs.readFileSync(script, "utf8");
  for (const banned of [/child_process/, /\bfetch\s*\(/, /node:(https?|net|dgram|tls|dns)\b/, /\bwriteFile/, /\bappendFile/, /\bunlink(Sync)?\s*\(/, /\brmSync/, /\bspawn/, /(?<![.\w])exec(Sync|File|FileSync)?\s*\(/]) {
    assert.ok(!banned.test(src), `preflight.mjs must not contain ${banned}`);
  }
});


test("typed cf config cannot be evaluated or replaced by a stale legacy success", () => {
  const dir = tmp({
    "cloudflare.config.ts": 'import fs from "node:fs"; fs.writeFileSync("must-not-run.txt", "executed"); throw new Error("executed");',
    "wrangler.jsonc": JSON.stringify(good),
    "src/index.ts": "",
  });
  for (const target of [dir, path.join(dir, "cloudflare.config.ts"), path.join(dir, "wrangler.jsonc")]) {
    const result = runPreflight(target);
    assert.equal(result.code, 2);
    assert.equal(result.validated, false);
    assert.match(result.error, /not validated.*cf deploy --dry-run/);
    assert.equal(result.file, path.join(dir, "cloudflare.config.ts"));
  }
  const cli = spawnSync(process.execPath, [script, dir, "--json"], { cwd: dir, encoding: "utf8" });
  assert.equal(cli.status, 2);
  assert.equal(JSON.parse(cli.stdout).validated, false);
  assert.equal(fs.existsSync(path.join(dir, "must-not-run.txt")), false);
});
