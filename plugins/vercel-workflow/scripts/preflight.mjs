#!/usr/bin/env node
// Static, offline pre-deploy check for a Vercel project (often Next.js).
//
// Reads vercel.json, env files (variable NAMES only), package.json, the
// Next.js config as text, and .vercel/project.json. It never runs the Vercel
// CLI, never evaluates vercel.ts or next.config, never opens a network
// connection, and never prints a value that looks like a credential.
//
//   node preflight.mjs [project-dir] [--json]
//
// Exit status: 0 = no errors (warnings allowed), 1 = at least one error,
// 2 = directory not found.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------- helpers

const TOKEN_SHAPES = [
  /^(sk|pk|rk)[-_](live|test)?[-_]?[A-Za-z0-9_-]{16,}/,
  /^gh[pousr]_[A-Za-z0-9]{20,}/,
  /^github_pat_[A-Za-z0-9_]{20,}/,
  /^AKIA[0-9A-Z]{16}$/,
  /^xox[abprs]-/,
  /^vc[a-z]_[A-Za-z0-9]{20,}/,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const EXAMPLE_ENV = /^\.env(\.[a-z]+)*\.(example|sample|template|defaults?)$/i;
const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|NUXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_|GATSBY_)/;
const HARD_SECRET = /(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE)/i;
const SOFT_SECRET = /(TOKEN|API_?KEY|AUTH_?KEY)/i;
const PUBLISHABLE = /(PUBLISHABLE|ANON|PUBLIC_KEY|SITE_KEY|CLIENT_ID)/i;

function gitignoreLines(dir) {
  const lines = [];
  let cur = path.resolve(dir);
  for (let depth = 0; depth < 8; depth++) {
    const gi = path.join(cur, ".gitignore");
    if (fs.existsSync(gi)) lines.unshift(...fs.readFileSync(gi, "utf8").split(/\r?\n/).map((pattern) => ({ pattern: pattern.trim(), dir: cur })));
    if (fs.existsSync(path.join(cur, ".git"))) break;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return lines.filter(({ pattern }) => pattern && !pattern.startsWith("#"));
}

export function isIgnored(name, lines, dir = ".") {
  let ignored = false;
  for (const rule of lines) {
    const line = typeof rule === "string" ? rule : rule.pattern;
    const relativeName = (typeof rule === "string" ? name : path.relative(rule.dir, path.resolve(dir, name))).split(path.sep).join("/");
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

function* walkStrings(value, p = "") {
  if (typeof value === "string") yield [p, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* walkStrings(v, `${p}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* walkStrings(v, p ? `${p}.${k}` : k);
}

/** Names (and, for example files, values) from a dotenv-style file. */
export function parseEnvFile(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    out.push({ name: m[1], value: v });
  }
  return out;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// -------------------------------------------------------------- checks

function checkVercelJson(cfg, add) {
  const legacyConflicts = ["rewrites", "redirects", "headers", "cleanUrls", "trailingSlash"].filter((k) => cfg[k] !== undefined);
  if (cfg.routes !== undefined && legacyConflicts.length) add("error", "VC-ROUTES-MIX", `vercel.json uses legacy \`routes\` together with ${legacyConflicts.map((k) => `\`${k}\``).join(", ")}; they cannot be combined, so the deployment is rejected. Convert \`routes\` to rewrites/redirects/headers`);
  else if (cfg.routes !== undefined) add("warn", "VC-LEGACY-ROUTES", "vercel.json uses legacy `routes`; prefer `rewrites`, `redirects` and `headers`");
  if (cfg.builds !== undefined) add("warn", "VC-LEGACY-BUILDS", "vercel.json sets `builds`, the legacy build configuration; prefer framework detection with `buildCommand` / `outputDirectory`");
  if (isObj(cfg.env) && Object.keys(cfg.env).length) add("warn", "VC-LEGACY-ENV", "vercel.json has an `env` block; values committed there are visible in the repository. Use Vercel environment variables instead");
  if (isObj(cfg.build?.env) && Object.keys(cfg.build.env).length) add("warn", "VC-LEGACY-BUILD-ENV", "vercel.json has `build.env`; values committed there are visible in the repository. Use Vercel environment variables instead");

  if (cfg.crons !== undefined) {
    if (!Array.isArray(cfg.crons)) add("error", "VC-CRON-SHAPE", "`crons` must be an array of { path, schedule }");
    else
      for (const [i, c] of cfg.crons.entries()) {
        if (typeof c?.path !== "string" || !c.path.startsWith("/")) add("error", "VC-CRON-PATH", `crons[${i}].path must be a string starting with "/"`);
        if (typeof c?.schedule !== "string" || c.schedule.trim().split(/\s+/).length !== 5) add("error", "VC-CRON-SCHEDULE", `crons[${i}].schedule must be a 5-field cron expression`);
      }
  }
  for (const key of ["rewrites", "redirects"]) {
    if (cfg[key] === undefined) continue;
    if (!Array.isArray(cfg[key])) { add("error", "VC-RULE-SHAPE", `\`${key}\` must be an array`); continue; }
    for (const [i, r] of cfg[key].entries()) if (typeof r?.source !== "string" || typeof r?.destination !== "string") add("error", "VC-RULE-FIELDS", `${key}[${i}] needs string \`source\` and \`destination\``);
  }
  if (cfg.headers !== undefined) {
    if (!Array.isArray(cfg.headers)) add("error", "VC-RULE-SHAPE", "`headers` must be an array");
    else for (const [i, h] of cfg.headers.entries()) if (typeof h?.source !== "string" || !Array.isArray(h?.headers) || h.headers.some((x) => typeof x?.key !== "string" || typeof x?.value !== "string")) add("error", "VC-HEADER-FIELDS", `headers[${i}] needs \`source\` and a \`headers\` array of { key, value }`);
  }
  if (isObj(cfg.functions)) {
    for (const [k, v] of Object.entries(cfg.functions)) if (v?.maxDuration !== undefined && !(Number.isInteger(v.maxDuration) && v.maxDuration > 0)) add("error", "VC-MAXDURATION", `functions[${JSON.stringify(k)}].maxDuration must be a positive integer (seconds)`);
  }
  if (cfg.regions !== undefined && (!Array.isArray(cfg.regions) || cfg.regions.some((r) => typeof r !== "string"))) add("error", "VC-REGIONS", "`regions` must be an array of region id strings");
  for (const [p, v] of walkStrings(cfg)) if (TOKEN_SHAPES.some((re) => re.test(v))) add("error", "VC-CREDENTIAL-IN-CONFIG", `vercel.json ${p} holds a value shaped like a credential (value hidden); remove it and rotate it if it was ever committed`);
}

export function checkProject(dir) {
  const out = [];
  const add = (level, code, message) => out.push({ level, code, message });
  const ignore = gitignoreLines(dir);
  const exists = (...p) => fs.existsSync(path.join(dir, ...p));

  // Configuration files: only one allowed.
  const cfgFiles = ["vercel.json", "vercel.toml", "vercel.ts", "now.json"].filter((f) => exists(f));
  if (cfgFiles.length > 1) add("error", "VC-MULTI-CONFIG", `several project config files found (${cfgFiles.join(", ")}); Vercel allows only one`);
  if (cfgFiles.includes("now.json")) add("warn", "VC-NOW-JSON", "now.json is a retired name; rename it to vercel.json");
  if (cfgFiles.includes("vercel.ts")) add("info", "VC-VERCEL-TS", "vercel.ts is programmatic config and is not evaluated by this check");
  if (cfgFiles.includes("vercel.toml")) add("info", "VC-VERCEL-TOML", "vercel.toml is not parsed by this check");
  if (exists("vercel.json")) {
    try {
      const cfg = readJson(path.join(dir, "vercel.json"));
      if (isObj(cfg)) checkVercelJson(cfg, add);
      else add("error", "VC-JSON-SHAPE", "vercel.json must be a JSON object");
    } catch (e) {
      add("error", "VC-JSON-PARSE", `vercel.json is not valid JSON: ${e.message}`);
    }
  }

  // Project link. A deploy from an unlinked directory prompts to create a project,
  // and the first deployment of a project is always production.
  const linkFile = path.join(dir, ".vercel", "project.json");
  if (fs.existsSync(linkFile)) {
    try {
      const link = readJson(linkFile);
      add("info", "VC-LINKED", `linked to project ${JSON.stringify(link.projectName ?? "(unnamed)")}${link.orgId ? "" : " (no orgId recorded)"}; confirm this is the intended project and team before any deploy`);
    } catch {
      add("warn", "VC-LINK-UNREADABLE", ".vercel/project.json exists but is not valid JSON; re-run `vercel link`");
    }
  } else {
    add("warn", "VC-NOT-LINKED", "no .vercel/project.json: running `vercel` here would create or link a project, and the first deployment of a new project is always production. Link explicitly with `vercel link` after approval");
  }
  if (exists(".vercel") && !isIgnored(".vercel", ignore, dir)) add("warn", "VC-VERCEL-DIR", ".vercel/ holds project IDs and pulled environment files but is not in .gitignore");

  // Environment files.
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { /* unreadable dir is reported by caller */ }
  const envFiles = entries.filter((f) => /^\.env(\..+)?$/.test(f) && fs.statSync(path.join(dir, f)).isFile());
  if (exists(".vercel")) {
    try {
      for (const f of fs.readdirSync(path.join(dir, ".vercel"))) if (/^\.env/.test(f)) envFiles.push(path.join(".vercel", f));
    } catch { /* ignore */ }
  }
  for (const f of envFiles) {
    const example = EXAMPLE_ENV.test(path.basename(f));
    let vars = [];
    try { vars = parseEnvFile(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!example && !isIgnored(f, ignore, dir) && !(f.startsWith(".vercel") && isIgnored(".vercel", ignore, dir))) add("error", "VC-ENV-NOT-IGNORED", `${f} is not covered by .gitignore; local environment files can contain secrets`);
    for (const v of vars) {
      if (example && v.value && TOKEN_SHAPES.some((re) => re.test(v.value))) add("error", "VC-CREDENTIAL-IN-EXAMPLE", `${f}: ${v.name} holds a value shaped like a credential (value hidden); example files are committed`);
      if (PUBLIC_PREFIX.test(v.name) && !PUBLISHABLE.test(v.name)) {
        if (HARD_SECRET.test(v.name)) add("error", "VC-PUBLIC-SECRET", `${f}: ${v.name} has a browser-exposed prefix but a secret-like name; public variables are inlined into client bundles`);
        else if (SOFT_SECRET.test(v.name)) add("warn", "VC-PUBLIC-TOKEN", `${f}: ${v.name} is browser-exposed (public prefix); make sure it is meant to be public`);
      }
    }
  }

  // package.json and Next.js.
  let pkg = null;
  if (exists("package.json")) {
    try { pkg = readJson(path.join(dir, "package.json")); } catch (e) { add("error", "VC-PKG-PARSE", `package.json is not valid JSON: ${e.message}`); }
  }
  const nextRange = pkg && (pkg.dependencies?.next ?? pkg.devDependencies?.next);
  const nextMajor = nextRange ? Number((/(\d+)/.exec(nextRange) ?? [])[1]) : null;
  const nextConfigName = ["next.config.ts", "next.config.mts", "next.config.js", "next.config.mjs", "next.config.cjs"].find((f) => exists(f));
  if (nextRange || nextConfigName) {
    if (nextMajor && nextMajor >= 16) {
      const mw = ["middleware.ts", "middleware.js", "src/middleware.ts", "src/middleware.js"].filter((f) => exists(f));
      const px = ["proxy.ts", "proxy.js", "src/proxy.ts", "src/proxy.js"].filter((f) => exists(f));
      if (mw.length && px.length) add("error", "VC-MW-AND-PROXY", `both ${mw[0]} and ${px[0]} exist; Next.js 16 uses proxy, so remove the old middleware file after merging its logic`);
      else if (mw.length) add("warn", "VC-MIDDLEWARE-RENAMED", `${mw[0]}: the \`middleware\` file convention is deprecated in Next.js 16 and renamed \`proxy\` (codemod: npx @next/codemod@canary middleware-to-proxy .)`);
    }
    if (nextConfigName) {
      const src = fs.readFileSync(path.join(dir, nextConfigName), "utf8");
      const exportMode = /output\s*:\s*["']export["']/.test(src);
      if (exportMode && /\b(async\s+)?(headers|redirects|rewrites)\s*\(/.test(src)) add("warn", "VC-EXPORT-IGNORES-RULES", `${nextConfigName} sets output "export" and also defines headers/redirects/rewrites; a static export does not run them. Put them in vercel.json or drop static export`);
      if (/output\s*:\s*["']standalone["']/.test(src)) add("info", "VC-STANDALONE", `${nextConfigName} sets output "standalone", which is for self-hosting; it is not needed on Vercel`);
      if (/ignoreBuildErrors\s*:\s*true/.test(src) || /ignoreDuringBuilds\s*:\s*true/.test(src)) add("warn", "VC-BUILD-CHECKS-OFF", `${nextConfigName} turns off build-time type or lint errors; a production deploy would ship code that does not typecheck`);
    }
  }
  return out;
}

export function runPreflight(target = ".") {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return { code: 2, dir: target, findings: [], error: `not a directory: ${target}` };
  const dir = path.resolve(target);
  const findings = checkProject(dir);
  return { code: findings.some((f) => f.level === "error") ? 1 : 0, dir, findings };
}

function main(argv) {
  const json = argv.includes("--json");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const res = runPreflight(positional[0] ?? ".");
  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return res.code;
  }
  if (res.error) {
    console.error(`vercel preflight: ${res.error}`);
    return res.code;
  }
  const count = (l) => res.findings.filter((f) => f.level === l).length;
  console.log(`vercel preflight: ${res.dir}`);
  for (const f of res.findings) console.log(`  ${f.level.toUpperCase().padEnd(5)} ${f.code}  ${f.message}`);
  console.log(`summary: ${count("error")} error(s), ${count("warn")} warning(s), ${count("info")} note(s)`);
  console.log(res.code === 0 ? "No blocking problems. This check is static and does not prove the deploy will succeed." : "Fix the errors above before asking to deploy.");
  return res.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
