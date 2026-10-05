#!/usr/bin/env node
// web-artifacts-builder engine: scaffold, check, build and preview a page that
// ships as ONE self-contained HTML file. Node 22+, no npm dependencies.
//
//   wab.mjs new <dir> [--template single|react] [--title "Name"]
//   wab.mjs check <file.html> [--json] [--max-kb N] [--allow-network]
//   wab.mjs build <react-project-dir>        (runs npm install + npm run build)
//   wab.mjs preview <file-or-dir> [--port N]  (loopback only; Ctrl-C to stop)
//
// Nothing here publishes, deploys or contacts a service. `build` runs npm,
// which downloads packages from the npm registry; every other command is local.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, "..", "templates");
const DEFAULT_MAX_KB = 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// ---------------------------------------------------------------- scaffold

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// JSX text treats { and } as code, so encode them as character references.
function escapeJsx(text) {
  return escapeHtml(text).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

function slug(text) {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "artifact";
}

function copyTree(from, to, fill) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`template contains a symlink: ${src}`);
    if (entry.isDirectory()) copyTree(src, dst, fill);
    else if (entry.isFile()) fs.writeFileSync(dst, fill(fs.readFileSync(src, "utf8"), entry.name));
  }
}

export function scaffold(dir, { template = "single", title } = {}) {
  if (!["single", "react"].includes(template)) throw new Error(`unknown template '${template}' (use single or react)`);
  const target = path.resolve(dir);
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} already exists and is not empty; choose a new directory`);
  const name = title || path.basename(target);
  const fill = (text, file) => {
    const safe = file.endsWith(".jsx") ? escapeJsx(name) : escapeHtml(name);
    return text.replaceAll("{{TITLE}}", safe).replaceAll("{{NAME}}", slug(name));
  };
  copyTree(path.join(TEMPLATES, template), target, fill);
  return { dir: target, template, entry: template === "single" ? "index.html" : "dist/index.html (after build)" };
}

// ------------------------------------------------------------------- check

const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, "an API key shaped like sk-..."],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "a GitHub token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key block"],
];

// Elements whose src/href load a resource. <a href> is navigation, not loading.
const LOADERS = new Set(["script", "link", "img", "source", "video", "audio", "iframe", "embed", "object", "track", "input"]);

function tagAttributes(html) {
  const found = [];
  const tag = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m;
  while ((m = tag.exec(html))) {
    const attrs = m[2];
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a;
    while ((a = re.exec(attrs))) found.push({ tag: m[1].toLowerCase(), name: a[1].toLowerCase(), value: a[3] ?? a[4] ?? a[5] ?? "" });
  }
  return found;
}

export function checkHtml(html, { maxKb = DEFAULT_MAX_KB, allowNetwork = false } = {}) {
  const errors = [];
  const warnings = [];
  const bytes = Buffer.byteLength(html);
  if (!/^\s*<!doctype html>/i.test(html)) errors.push("missing <!doctype html> (the page would render in quirks mode)");
  if (!/<html\b[^>]*\blang\s*=/i.test(html)) warnings.push("<html> has no lang attribute (screen readers guess the language)");
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!title || !title[1].trim()) errors.push("missing or empty <title>");
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html)) errors.push('missing <meta name="viewport"> (phones render a zoomed-out desktop page)');
  if (/\{\{(TITLE|NAME)\}\}/.test(html)) errors.push("unreplaced {{TITLE}} or {{NAME}} placeholder");
  if (bytes > maxKb * 1024) errors.push(`file is ${(bytes / 1024).toFixed(0)} KB, over the ${maxKb} KB limit (--max-kb)`);

  const external = (what, where) => (allowNetwork ? warnings : errors).push(`${where} loads ${what} from the network, so the page is not self-contained (pass --allow-network to accept this)`);
  for (const { tag, name, value } of tagAttributes(html)) {
    if (!LOADERS.has(tag) || !["src", "href", "srcset", "poster", "data"].includes(name)) continue;
    if (tag === "input" && name !== "src") continue;
    const v = value.trim();
    if (!v || v.startsWith("#") || /^(data|blob|about|mailto|tel|javascript):/i.test(v)) continue;
    if (/^(https?:)?\/\//i.test(v)) external(v, `<${tag} ${name}>`);
    else if (tag === "link" && !/\.(css|js|mjs|ico|png|svg|webmanifest)(\?|$)/i.test(v)) continue;
    else errors.push(`<${tag} ${name}="${v}"> references a separate file, so the page is not a single file`);
  }
  for (const m of html.matchAll(/url\(\s*["']?(https?:)?\/\/[^)"']+/gi)) external(m[0].replace(/^url\(\s*["']?/i, ""), "CSS url()");
  for (const m of html.matchAll(/@import\s+(?:url\()?\s*["']?(https?:)?\/\/[^"')\s;]+/gi)) external(m[0].replace(/^@import\s+(?:url\()?\s*["']?/i, ""), "@import");
  for (const m of html.matchAll(/\bimport\s*(?:\([^)]*)?["'`](https?:\/\/[^"'`]+)/g)) external(m[1], "a JavaScript import");
  for (const m of html.matchAll(/\bfrom\s+["'](https?:\/\/[^"']+)["']/g)) external(m[1], "a JavaScript import");

  for (const [re, label] of SECRET_PATTERNS) if (re.test(html)) errors.push(`contains ${label}; a page file is readable by everyone who gets it`);
  if (/(\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\)/.test(html)) warnings.push("contains what looks like a local filesystem path");
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/i.test(html)) warnings.push("viewport disables pinch zoom, which blocks low-vision users");
  return { ok: errors.length === 0, bytes, errors, warnings };
}

// ------------------------------------------------------------------- build

export function build(dir) {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, "package.json"))) throw new Error(`${root} has no package.json; scaffold one with: new <dir> --template react`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const run = (args) => execFileSync(npm, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (!fs.existsSync(path.join(root, "node_modules"))) run(["install", "--no-audit", "--no-fund"]);
  run(["run", "build"]);
  const out = path.join(root, "dist", "index.html");
  if (!fs.existsSync(out)) throw new Error("build finished but dist/index.html is missing; check that vite-plugin-singlefile is in vite.config.js");
  return out;
}

// ----------------------------------------------------------------- preview

export async function startPreview(target, { port = 0, host = "127.0.0.1" } = {}) {
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("preview binds loopback only");
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`${abs} does not exist`);
  const isFile = fs.statSync(abs).isFile();
  const root = isFile ? path.dirname(abs) : abs;
  const index = isFile ? path.basename(abs) : "index.html";
  const realRoot = fs.realpathSync(root);
  const server = http.createServer((req, res) => {
    const send = (code, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "method not allowed");
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(400, "bad request"); }
    if (rel.includes("\0")) return send(400, "bad request");
    if (rel === "/") rel = "/" + index;
    const file = path.join(root, rel);
    let real;
    try { real = fs.realpathSync(file); } catch { return send(404, "not found"); }
    const inside = path.relative(realRoot, real);
    if (inside.startsWith("..") || path.isAbsolute(inside)) return send(403, "forbidden");
    if (!fs.statSync(real).isFile()) return send(404, "not found");
    send(200, req.method === "HEAD" ? "" : fs.readFileSync(real), MIME[path.extname(real).toLowerCase()] || "application/octet-stream");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host === "::1" ? "[::1]" : host}:${server.address().port}/` }));
  });
}

// --------------------------------------------------------------------- CLI

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["json", "allow-network"].includes(key)) flags[key] = true;
      else flags[key] = argv[++i];
    } else rest.push(a);
  }
  return { flags, rest };
}

const USAGE = `usage:
  wab.mjs new <dir> [--template single|react] [--title "Name"]
  wab.mjs check <file.html> [--json] [--max-kb N] [--allow-network]
  wab.mjs build <react-project-dir>
  wab.mjs preview <file-or-dir> [--port N]`;

async function main(argv) {
  const [cmd, ...args] = argv;
  const { flags, rest } = parse(args);
  if (cmd === "new") {
    if (!rest[0]) throw new Error(USAGE);
    const r = scaffold(rest[0], { template: flags.template, title: flags.title });
    console.log(`created ${r.template} template in ${r.dir}\nnext: ${r.template === "react" ? `wab.mjs build ${r.dir}` : `wab.mjs preview ${r.dir}`}`);
  } else if (cmd === "check") {
    if (!rest[0]) throw new Error(USAGE);
    const file = path.resolve(rest[0]);
    const html = fs.readFileSync(file, "utf8");
    const r = checkHtml(html, { maxKb: flags["max-kb"] ? Number(flags["max-kb"]) : DEFAULT_MAX_KB, allowNetwork: !!flags["allow-network"] });
    if (flags.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`${file}: ${(r.bytes / 1024).toFixed(1)} KB`);
      for (const e of r.errors) console.log(`  error: ${e}`);
      for (const w of r.warnings) console.log(`  warning: ${w}`);
      console.log(r.ok ? "check: OK" : `check: FAILED (${r.errors.length} error(s))`);
    }
    process.exitCode = r.ok ? 0 : 1;
  } else if (cmd === "build") {
    if (!rest[0]) throw new Error(USAGE);
    const out = build(rest[0]);
    console.log(`built ${out}; run: wab.mjs check ${out}`);
  } else if (cmd === "preview") {
    if (!rest[0]) throw new Error(USAGE);
    const { url } = await startPreview(rest[0], { port: flags.port ? Number(flags.port) : 0 });
    console.log(`preview: ${url}  (loopback only, Ctrl-C to stop)`);
  } else {
    throw new Error(USAGE);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
