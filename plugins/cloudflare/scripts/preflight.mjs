#!/usr/bin/env node
// Static, offline pre-deploy check for a Cloudflare Worker project.
//
// Reads wrangler.jsonc / wrangler.json / wrangler.toml and the project tree.
// It never runs Wrangler, never opens a network connection and never prints
// the value of anything that looks like a credential: findings name the key.
//
//   node preflight.mjs [dir-or-config-file] [--json] [--today YYYY-MM-DD]
//
// Exit status: 0 = no errors (warnings allowed), 1 = at least one error,
// 2 = no readable configuration.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- JSONC

/** Remove // and /* *\/ comments and trailing commas without touching strings. */
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated block comment");
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Second pass: trailing commas before } or ].
  let res = "";
  i = 0;
  while (i < out.length) {
    const c = out[i];
    if (c === '"') {
      let j = i + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === "\\" ? 2 : 1;
      res += out.slice(i, j + 1);
      i = j + 1;
    } else if (c === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === "}" || out[j] === "]") i++;
      else {
        res += c;
        i++;
      }
    } else {
      res += c;
      i++;
    }
  }
  return res;
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text.replace(/^﻿/, "")));
}

// ----------------------------------------------------------------- TOML
// A deliberately small subset: tables, arrays of tables, dotted keys, strings,
// numbers, booleans, (multi-line) arrays and inline tables. Anything else
// (triple-quoted strings) throws, and the caller downgrades to a warning.

function stripTomlComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

function bracketsBalanced(s) {
  let depth = 0;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth <= 0;
}

function parseTomlValue(s, i) {
  while (s[i] === " " || s[i] === "\t" || s[i] === "\n") i++;
  const c = s[i];
  if (c === '"' || c === "'") {
    if (s.startsWith(c.repeat(3), i)) throw new Error("multi-line TOML strings are not supported");
    let j = i + 1;
    let v = "";
    while (j < s.length && s[j] !== c) {
      if (c === '"' && s[j] === "\\") {
        const e = s[j + 1];
        v += e === "n" ? "\n" : e === "t" ? "\t" : e;
        j += 2;
      } else v += s[j++];
    }
    if (j >= s.length) throw new Error("unterminated TOML string");
    return [v, j + 1];
  }
  if (c === "[") {
    const arr = [];
    i++;
    for (;;) {
      while (/[\s,]/.test(s[i] ?? "")) i++;
      if (i >= s.length) throw new Error("unterminated TOML array");
      if (s[i] === "]") return [arr, i + 1];
      const [v, ni] = parseTomlValue(s, i);
      arr.push(v);
      i = ni;
    }
  }
  if (c === "{") {
    const obj = {};
    i++;
    for (;;) {
      while (/[\s,]/.test(s[i] ?? "")) i++;
      if (i >= s.length) throw new Error("unterminated TOML inline table");
      if (s[i] === "}") return [obj, i + 1];
      const m = /^([A-Za-z0-9_.-]+|"[^"]*")\s*=\s*/.exec(s.slice(i));
      if (!m) throw new Error("bad TOML inline table");
      i += m[0].length;
      const [v, ni] = parseTomlValue(s, i);
      setDotted(obj, splitKey(m[1]), v);
      i = ni;
    }
  }
  const m = /^[^\s,\]}]+/.exec(s.slice(i));
  if (!m) throw new Error("bad TOML value");
  const raw = m[0];
  let v = raw;
  if (raw === "true") v = true;
  else if (raw === "false") v = false;
  else if (/^[+-]?(\d[\d_]*)(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) v = Number(raw.replace(/_/g, ""));
  return [v, i + raw.length];
}

function splitKey(k) {
  return k.split(".").map((p) => p.replace(/^"(.*)"$/, "$1"));
}

function setDotted(obj, keys, value) {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = Array.isArray(cur[keys[i]]) ? cur[keys[i]].at(-1) : cur[keys[i]];
  }
  cur[keys.at(-1)] = value;
}

export function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = stripTomlComment(lines[ln]).trim();
    if (!line) continue;
    let m = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line);
    if (m) {
      const keys = splitKey(m[1]);
      let parent = root;
      for (const k of keys.slice(0, -1)) {
        if (Array.isArray(parent[k])) parent = parent[k].at(-1);
        else parent = parent[k] ??= {};
      }
      const last = keys.at(-1);
      parent[last] = Array.isArray(parent[last]) ? parent[last] : [];
      const item = {};
      parent[last].push(item);
      cur = item;
      continue;
    }
    m = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (m) {
      let t = root;
      for (const k of splitKey(m[1])) {
        if (Array.isArray(t[k])) t = t[k].at(-1);
        else t = t[k] ??= {};
      }
      cur = t;
      continue;
    }
    m = /^([A-Za-z0-9_.-]+|"[^"]*")\s*=\s*(.*)$/.exec(line);
    if (!m) throw new Error(`unsupported TOML on line ${ln + 1}`);
    let rest = m[2];
    while (!bracketsBalanced(rest) && ln + 1 < lines.length) rest += "\n" + stripTomlComment(lines[++ln]);
    const [v] = parseTomlValue(rest, 0);
    setDotted(cur, splitKey(m[1]), v);
  }
  return root;
}

// ------------------------------------------------------------ discovery

const CONFIG_NAMES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

export function findConfigs(dir) {
  return CONFIG_NAMES.map((n) => path.join(dir, n)).filter((p) => fs.existsSync(p));
}

export function loadConfig(file) {
  const text = fs.readFileSync(file, "utf8");
  return file.endsWith(".toml") ? parseToml(text) : parseJsonc(text);
}

function gitignoreLines(dir) {
  const lines = [];
  let cur = path.resolve(dir);
  for (let depth = 0; depth < 8; depth++) {
    const gi = path.join(cur, ".gitignore");
    if (fs.existsSync(gi)) lines.unshift(...fs.readFileSync(gi, "utf8").split(/\r?\n/));
    if (fs.existsSync(path.join(cur, ".git"))) break;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

export function isIgnored(name, lines) {
  let ignored = false;
  const relativeName = name.split(path.sep).join("/");
  for (const line of lines) {
    const negated = line.startsWith("!");
    const rawPattern = negated ? line.slice(1) : line;
    const pattern = rawPattern.replace(/^\//, "").replace(/\/$/, "");
    const target = rawPattern.startsWith("/") || pattern.includes("/") ? relativeName : path.posix.basename(relativeName);
    if (pattern === target || pattern === "*") ignored = !negated;
    else if (pattern.includes("*")) {
      const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if (re.test(target)) ignored = !negated;
    }
  }
  return ignored;
}

// --------------------------------------------------------------- checks

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|API_?KEY|CREDENTIAL|AUTH_?KEY)/i;
const TOKEN_SHAPES = [
  /^(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/,
  /^gh[pousr]_[A-Za-z0-9]{20,}/,
  /^github_pat_[A-Za-z0-9_]{20,}/,
  /^AKIA[0-9A-Z]{16}$/,
  /^xox[abprs]-/,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const PLACEHOLDER = /^(<.*>|\{.*\}|your[-_ ].*|x{3,}.*|todo|changeme|replace.*|0{8}-0{4}-0{4}-0{4}-0{12})$/i;

function* walkStrings(value, p = "") {
  if (typeof value === "string") yield [p, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* walkStrings(v, `${p}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* walkStrings(v, p ? `${p}.${k}` : k);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function checkConfig(config, { dir = ".", today = new Date().toISOString().slice(0, 10), configFiles = [], fsChecks = true } = {}) {
  const out = [];
  const add = (level, code, message) => out.push({ level, code, message });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  if (configFiles.length > 1) add("warn", "CF-MULTI-CONFIG", `several Wrangler config files found (${configFiles.map((f) => path.basename(f)).join(", ")}); Wrangler reads only one, so make sure the edited one is live`);

  // Identity.
  if (typeof config.name !== "string" || !config.name) add("error", "CF-NO-NAME", "`name` is missing; the Worker would deploy under an unintended name");
  add("info", "CF-ACCOUNT", config.account_id ? "`account_id` is set in the config; confirm it is the intended account" : "no `account_id` in the config: Wrangler uses the logged-in or CLOUDFLARE_ACCOUNT_ID account, so review the cf migration and confirm with `cf auth whoami` before any deploy");

  // What gets deployed.
  const isPages = config.pages_build_output_dir !== undefined;
  if (isPages) add("warn", "CF-PAGES-CONFIG", "`pages_build_output_dir` marks a Cloudflare Pages project; see the cloudflare-pages-to-workers skill before using `cf deploy`");
  else if (!config.main && !config.assets) add("error", "CF-NOTHING-TO-DEPLOY", "neither `main` nor `assets` is set, so there is nothing to deploy");

  // Compatibility date.
  const cd = config.compatibility_date;
  if (!cd) add("warn", "CF-NO-COMPAT-DATE", "`compatibility_date` is missing; runtime behavior is not pinned (set it to today's date for a new project)");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cd)) || Number.isNaN(Date.parse(String(cd))) || new Date(String(cd)).toISOString().slice(0, 10) !== String(cd)) add("error", "CF-BAD-COMPAT-DATE", "`compatibility_date` must be a real YYYY-MM-DD date");
  else if (String(cd) > today) add("error", "CF-FUTURE-COMPAT-DATE", `\`compatibility_date\` ${cd} is after today (${today}); the deploy is rejected`);
  else if (daysBetween(String(cd), today) > 365) add("info", "CF-OLD-COMPAT-DATE", `\`compatibility_date\` ${cd} is over a year old; newer runtime behavior is opt-in, so move it forward only with tests`);

  // Observability and legacy keys.
  if (!isObj(config.observability) || config.observability.enabled === false) add("info", "CF-NO-OBSERVABILITY", "observability is not enabled; production Workers are hard to debug without logs (`observability.enabled = true`)");
  if (config.node_compat !== undefined) add("warn", "CF-NODE-COMPAT", "`node_compat` is deprecated; use compatibility_flags [\"nodejs_compat\"]");
  if (config.site !== undefined) add("warn", "CF-WORKERS-SITES", "`site` (Workers Sites) is deprecated; use the `assets` key");

  // Durable Objects: bindings need a class lifecycle declaration, exactly one style.
  const scopes = [["", config], ...Object.entries(isObj(config.env) ? config.env : {}).map(([n, e]) => [`env.${n}.`, e])];
  for (const [prefix, scope] of scopes) {
    if (!isObj(scope)) continue;
    const bindings = (scope.durable_objects?.bindings ?? []).filter((b) => b && !b.script_name);
    const migrations = Array.isArray(scope.migrations) ? scope.migrations : [];
    const exportsMap = isObj(scope.exports) ? scope.exports : {};
    const doExports = Object.entries(exportsMap).filter(([, v]) => isObj(v) && v.type === "durable-object");
    if (migrations.length && doExports.length) add("error", "CF-DO-BOTH", `${prefix}\`migrations\` and Durable Object entries in \`exports\` cannot be combined; pick one lifecycle style`);
    const declared = new Set();
    for (const m of migrations) {
      for (const c of [...(m.new_classes ?? []), ...(m.new_sqlite_classes ?? [])]) declared.add(c);
      for (const r of m.renamed_classes ?? []) declared.add(r.to);
      for (const r of m.transferred_classes ?? []) declared.add(r.to);
      if (m.new_classes?.length) add("warn", "CF-DO-KV-BACKEND", `${prefix}migration ${JSON.stringify(m.tag)} uses \`new_classes\` (key-value storage); new Durable Object namespaces need SQLite (\`new_sqlite_classes\`)`);
    }
    for (const [name, v] of doExports) if (!v.state || v.state === "created") declared.add(name);
    if (doExports.length) add("info", "CF-EXPORTS-WRANGLER", `${prefix}\`exports\` is a recent Wrangler feature; an older Wrangler warns 'Unexpected fields found in top-level field: "exports"' and ignores it, so review the supported lifecycle mapping during cf migration or keep \`migrations\``);
    const tags = migrations.map((m) => m.tag);
    if (new Set(tags).size !== tags.length) add("error", "CF-DO-DUP-TAG", `${prefix}migration tags must be unique`);
    for (const b of bindings) if (b.class_name && !declared.has(b.class_name)) add("error", "CF-DO-NO-LIFECYCLE", `${prefix}Durable Object binding ${JSON.stringify(b.name)} uses class ${JSON.stringify(b.class_name)} which has no \`migrations\` or \`exports\` entry; deploy fails or the class has no storage`);
  }

  // Resource IDs that are still placeholders.
  for (const [prefix, scope] of scopes) {
    if (!isObj(scope)) continue;
    const idFields = [["kv_namespaces", "id"], ["d1_databases", "database_id"], ["hyperdrive", "id"]];
    for (const [key, field] of idFields) {
      for (const [i, entry] of (Array.isArray(scope[key]) ? scope[key] : []).entries()) {
        const v = entry?.[field];
        if (typeof v === "string" && PLACEHOLDER.test(v.trim())) add("error", "CF-PLACEHOLDER-ID", `${prefix}${key}[${i}].${field} is still a placeholder; the deploy would fail`);
        else if (v === undefined) add("info", "CF-UNBOUND-ID", `${prefix}${key}[${i}] (${entry?.binding ?? "?"}) has no ${field}; recent Wrangler versions may create the resource during deploy, so read the dry-run output and treat that as part of the approval`);
      }
    }
  }

  // Credentials in vars, and credential-shaped values anywhere in the file.
  for (const [prefix, scope] of scopes) {
    if (!isObj(scope?.vars)) continue;
    for (const [k, v] of Object.entries(scope.vars)) {
      if (typeof v !== "string" || !v || PLACEHOLDER.test(v)) continue;
      if (SECRET_NAME.test(k)) add("warn", "CF-SECRET-VAR", `${prefix}vars.${k} has a secret-like name and a literal value; plain vars are visible in config and the dashboard, so use the approved cf secret-update workflow (value not shown)`);
    }
  }
  for (const [p, v] of walkStrings(config)) {
    if (TOKEN_SHAPES.some((re) => re.test(v))) add("error", "CF-CREDENTIAL-IN-CONFIG", `${p} holds a value shaped like a credential (value hidden); remove it from the file and rotate it if it was ever committed`);
  }

  if (fsChecks) {
    const ignore = gitignoreLines(dir);
    for (const f of [".dev.vars", ".env"]) {
      if (fs.existsSync(path.join(dir, f)) && !isIgnored(f, ignore)) add("error", "CF-LOCAL-SECRETS-TRACKED", `${f} exists and is not in .gitignore; local secrets could be committed`);
    }
    if (fs.existsSync(path.join(dir, ".wrangler")) && !isIgnored(".wrangler", ignore)) add("warn", "CF-WRANGLER-DIR", ".wrangler/ (local state) is not in .gitignore");
    if (typeof config.assets?.directory === "string" && !fs.existsSync(path.resolve(dir, config.assets.directory))) add("warn", "CF-ASSETS-MISSING", `assets.directory ${JSON.stringify(config.assets.directory)} does not exist yet; run the project build before deploying`);
    if (typeof config.main === "string" && !fs.existsSync(path.resolve(dir, config.main))) add("warn", "CF-MAIN-MISSING", `main ${JSON.stringify(config.main)} does not exist; fine if it is a build output, otherwise fix the path`);
  }
  return out;
}

// ------------------------------------------------------------------ CLI

export function runPreflight(target = ".", opts = {}) {
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!stat) return { code: 2, findings: [], error: `not found: ${target}` };
  const dir = stat.isDirectory() ? path.resolve(target) : path.dirname(path.resolve(target));
  const typed = path.join(dir, "cloudflare.config.ts");
  if (fs.existsSync(typed)) return {
    code: 2, file: typed, validated: false, findings: [],
    error: "cloudflare.config.ts is executable TypeScript and is not validated by this offline checker. Read it, run project tests, then cf build and cf deploy --dry-run; no legacy config was accepted instead.",
  };
  const files = stat.isDirectory() ? findConfigs(dir) : [path.resolve(target)];
  if (!files.length) return { code: 2, findings: [], error: `no wrangler.jsonc, wrangler.json or wrangler.toml in ${dir}` };
  let config;
  try {
    config = loadConfig(files[0]);
  } catch (e) {
    const finding = { level: "error", code: "CF-UNPARSEABLE", message: `${path.basename(files[0])} could not be parsed: ${e.message}` };
    return { code: 1, file: files[0], findings: [finding] };
  }
  const findings = checkConfig(config, { dir, configFiles: files, ...opts });
  return { code: findings.some((f) => f.level === "error") ? 1 : 0, file: files[0], findings };
}

function main(argv) {
  const json = argv.includes("--json");
  const ti = argv.indexOf("--today");
  const today = ti >= 0 ? argv[ti + 1] : undefined;
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(ti >= 0 && i === ti + 1));
  const res = runPreflight(positional[0] ?? ".", today ? { today } : {});
  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return res.code;
  }
  if (res.error) {
    console.error(`cloudflare preflight: ${res.error}`);
    return res.code;
  }
  const count = (l) => res.findings.filter((f) => f.level === l).length;
  console.log(`cloudflare preflight: ${res.file}`);
  for (const f of res.findings) console.log(`  ${f.level.toUpperCase().padEnd(5)} ${f.code}  ${f.message}`);
  console.log(`summary: ${count("error")} error(s), ${count("warn")} warning(s), ${count("info")} note(s)`);
  console.log(res.code === 0 ? "No blocking problems. This check is static and does not prove the deploy will succeed." : "Fix the errors above before asking to deploy.");
  return res.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
