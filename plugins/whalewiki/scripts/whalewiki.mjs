#!/usr/bin/env node
// WhaleWiki engine — deterministic receipts, staleness, repo map, export.
// Zero dependencies, Node >= 20. The model writes prose; this tool owns
// evidence: which files each page was written from and whether they moved.
//
//   whalewiki.mjs scaffold            create whalewiki/ in the repo root
//   whalewiki.mjs scan [--json]       repo inventory for planning pages
//   whalewiki.mjs map                 write codemap.md
//   whalewiki.mjs manifest set <page> --sources a.rs,b.rs [--root name]
//   whalewiki.mjs manifest show
//   whalewiki.mjs status [--short|--json|--exit-stale|--mark]
//   whalewiki.mjs search <query>      grep-ranked page matches
//   whalewiki.mjs export [--out f.html]

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WIKI_DIRNAME = "whalewiki";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PAGE_PATH = /^pages\/[\w][\w.-]*\.md$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_SCAN_FILES = 8000;
const MAX_SYMBOLS_PER_FILE = 12;

const IGNORE_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "target", "dist", "build", "out",
  ".next", ".nuxt", ".cache", "coverage", ".codewhale", "vendor",
  ".venv", "venv", "__pycache__", ".idea", ".vscode", ".tool",
]);
const TEXT_EXT = new Set([
  ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java",
  ".rb", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".kt", ".kts", ".toml",
  ".md", ".json", ".yaml", ".yml", ".sh", ".zsh", ".fish", ".sql", ".html",
  ".css", ".scss", ".proto", ".zig", ".lua", ".ex", ".exs", ".erl", ".hs",
]);
const SYMBOL_RULES = [
  [/\.rs$/, /\b(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|trait|impl|mod)\s+([A-Za-z_]\w*)/g],
  [/\.[cm]?[jt]sx?$/, /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g],
  [/\.py$/, /^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/gm],
  [/\.go$/, /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^type\s+([A-Za-z_]\w*)/gm],
];
const EDGE_RULES = [
  [/\.rs$/, /^\s*use\s+(crate::[\w:]+(?:::\w+)?)/gm],
  [/\.[cm]?[jt]sx?$/, /(?:import(?:\s+type)?[\s\S]*?from|import|require\()\s*['"]([^'"]+)['"]/g],
  [/\.py$/, /^from\s+([\w.]+)\s+import|^import\s+([\w.]+)/gm],
];

// ---------- paths & config ---------------------------------------------------

export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return path.resolve(cwd);
  }
}

export function wikiDir(root = repoRoot()) {
  const env = process.env.WHALEWIKI_DIR;
  if (env) return path.resolve(env);
  const direct = path.join(root, WIKI_DIRNAME);
  if (fs.existsSync(direct)) return direct;
  // Pod mode: a manifest may live under cwd even when cwd is a source root.
  let dir = path.resolve(root);
  for (;;) {
    const candidate = path.join(dir, WIKI_DIRNAME, "manifest.json");
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return direct;
    dir = parent;
  }
}

// Minimal TOML for whalewiki.toml: `ignore = [...]` and `[[sources]] root=`.
export function readWikiConfig(wiki) {
  const file = path.join(wiki, "whalewiki.toml");
  const cfg = { ignores: [], sources: [] };
  if (!fs.existsSync(file)) return cfg;
  let inSources = false;
  for (const raw of fs.readFileSync(safeFile(wiki, "whalewiki.toml"), "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "[[sources]]") { cfg.sources.push({}); inSources = true; continue; }
    if (line.startsWith("[")) { inSources = false; continue; }
    const m = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (!m || line.startsWith("#")) continue;
    const [, key, val] = m;
    const str = (s) => s.trim().replace(/^["']|["']$/g, "");
    if (key === "ignore" && val.startsWith("[")) {
      cfg.ignores = val.slice(1, -1).split(",").map(str).filter(Boolean);
    } else if (inSources && key === "root") {
      cfg.sources[cfg.sources.length - 1].root = str(val);
    } else if (inSources && key === "name") {
      cfg.sources[cfg.sources.length - 1].name = str(val);
    }
  }
  return cfg;
}

// ---------- hashing & manifest ----------------------------------------------

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Do not infer semantic equivalence without a language parser. Whitespace in
// Python and string literals, comments used as directives, and docs are evidence.
export function normalizeContent(text) { return text; }

// Every component is checked, including symlinked parents. Configuration may
// explicitly name another source root; a source path may never escape that root.
export function safeFile(base, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\\") || rel.includes("\0") ||
      path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error(`invalid relative file path: ${rel}`);
  }
  let current = path.resolve(base);
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error("wiki/source root must not be a symlink");
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`symlink is not allowed: ${rel}`);
  }
  const stat = fs.statSync(current);
  if (!stat.isFile()) throw new Error(`not a regular file: ${rel}`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`file exceeds ${MAX_FILE_BYTES} bytes: ${rel}`);
  return current;
}

export function readWikiFile(wiki, rel) {
  if (!PAGE_PATH.test(rel) && !["INDEX.md", "codemap.md"].includes(rel)) {
    throw new Error("page must be pages/<name>.md, INDEX.md or codemap.md");
  }
  return fs.readFileSync(safeFile(wiki, rel), "utf8");
}

function ensureDirectory(dir) {
  const absolute = path.resolve(dir);
  const root = path.resolve(repoRoot());
  // Check repository-controlled parents as well as the destination itself.
  // An explicitly selected external directory is its own trust anchor.
  const rootStat = fs.lstatSync(root);
  let anchor = absolute;
  // Git may spell /var as /private/var on macOS. Match the trusted root's
  // identity without realpath-ing repository-controlled descendants.
  for (let candidate = absolute;; candidate = path.dirname(candidate)) {
    const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (stat?.isDirectory() && stat.dev === rootStat.dev && stat.ino === rootStat.ino) { anchor = candidate; break; }
    if (path.dirname(candidate) === candidate) break;
  }
  let current = anchor;
  for (const part of ["", ...path.relative(anchor, absolute).split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`directory must not be a symlink or file: ${current}`);
    if (!stat) fs.mkdirSync(current, { recursive: current === anchor });
  }
  return absolute;
}

function writeTarget(base, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\\") || rel.includes("\0") ||
      path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error(`invalid relative file path: ${rel}`);
  }
  ensureDirectory(base);
  let parent = path.resolve(base);
  for (const part of rel.split("/").slice(0, -1)) parent = ensureDirectory(path.join(parent, part));
  const target = path.join(parent, path.basename(rel));
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`output must be a regular file, not a symlink: ${rel}`);
  return target;
}

function atomicWrite(wiki, rel, body) {
  const target = writeTarget(wiki, rel);
  const temp = path.join(path.dirname(target), `.whalewiki-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, body, { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function manifestPath(wiki = wikiDir()) {
  return path.join(wiki, "manifest.json");
}

export function loadManifest(wiki = wikiDir()) {
  const file = manifestPath(wiki);
  if (!fs.existsSync(file)) return { version: 1, tool: "whalewiki", pages: {} };
  const manifest = JSON.parse(fs.readFileSync(safeFile(wiki, "manifest.json"), "utf8"));
  if (![1, 2].includes(manifest.version) || !manifest.pages || typeof manifest.pages !== "object" || Array.isArray(manifest.pages)) {
    throw new Error("invalid manifest: expected version 1 or 2 and a pages object");
  }
  if (Object.keys(manifest.pages).length > 1000) throw new Error("manifest exceeds 1000 pages");
  for (const [page, entry] of Object.entries(manifest.pages)) {
    if (!PAGE_PATH.test(page) || !entry || !Array.isArray(entry.sources) || entry.sources.length > 1000) {
      throw new Error(`invalid manifest page: ${page}`);
    }
    for (const src of entry.sources) {
      if (!src || typeof src.path !== "string" || !HASH.test(src.sha256) ||
          (src.root !== undefined && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(src.root))) {
        throw new Error(`invalid source record for ${page}`);
      }
    }
  }
  return manifest;
}

function saveManifest(manifest, wiki = wikiDir()) {
  manifest.updated_at = new Date().toISOString();
  atomicWrite(wiki, "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
}

// Resolve the absolute root a manifest source entry is relative to. The wiki
// lives at <root>/whalewiki, so "repo" is the wiki's parent — this stays
// correct when the engine runs from a plugin dir or another workspace.
export function sourceRoots(wiki) {
  const cfg = readWikiConfig(wiki);
  const roots = Object.assign(Object.create(null), { repo: path.dirname(path.resolve(wiki)) });
  cfg.sources.forEach((s, i) => {
    const name = s.name || `src${i}`;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || Object.hasOwn(roots, name) || name === "constructor" || name === "prototype") {
      throw new Error(`invalid or duplicate source root: ${name}`);
    }
    if (s.root) roots[name] = path.resolve(path.dirname(wiki), s.root);
  });
  return roots;
}

// One page's verdict against live basis files — the unit wiki_read needs so a
// page fetch does not re-hash every other page's sources.
export function pageVerdict(entry, roots, wiki, page) {
  const missing = [], changed = [], touched = [];
  for (const src of entry.sources || []) {
    const base = roots[src.root || "repo"];
    try {
      if (!base) throw new Error("unknown root");
      if (sha256(safeFile(base, src.path)) !== src.sha256) changed.push(src.path);
    } catch { missing.push(src.path); }
  }
  let page_changed = false;
  if (wiki && page) {
    try { page_changed = !!entry.page_sha256 && sha256(safeFile(wiki, page)) !== entry.page_sha256; }
    catch { missing.push(page); }
  }
  const verdict = missing.length ? "orphaned"
    : changed.length || page_changed ? "stale"
    : !entry.page_sha256 || !entry.sources?.length ? "unsealed" : "fresh";
  return { verdict, changed, touched, missing, page_changed };
}

export function statusReport(wiki = wikiDir(), { receipt = false } = {}) {
  const manifest = loadManifest(wiki);
  const roots = sourceRoots(wiki);
  const pages = [];
  for (const [page, entry] of Object.entries(manifest.pages || {})) {
    pages.push({ page, title: entry.title || "", sealed_at: entry.sealed_at, ...pageVerdict(entry, roots, wiki, page) });
  }
  const pagesDir = path.join(wiki, "pages");
  const sealed = new Set(Object.keys(manifest.pages || {}));
  if (fs.existsSync(pagesDir)) {
    if (fs.lstatSync(pagesDir).isSymbolicLink()) throw new Error("pages directory must not be a symlink");
    for (const f of fs.readdirSync(pagesDir).filter(f => f.endsWith(".md")).sort()) {
      const rel = `pages/${f}`;
      if (!sealed.has(rel)) pages.push({ page: rel, title: "", verdict: "unsealed", changed: [], touched: [], missing: [], page_changed: false });
    }
  }
  const counts = { fresh: 0, stale: 0, touched: 0, orphaned: 0, unsealed: 0 };
  for (const p of pages) counts[p.verdict] += 1;
  const report = { wiki, total: pages.length, counts, pages, checked_at: new Date().toISOString() };
  if (receipt) atomicWrite(wiki, ".last-run.json", JSON.stringify({ at: report.checked_at, counts }, null, 2) + "\n");
  return report;
}

// ---------- repo scanning ----------------------------------------------------

function walk(root, extraIgnores = []) {
  const files = [];
  const ignoreSet = new Set([...IGNORE_DIRS, ...extraIgnores]);
  const stack = [root];
  let visited = 0;
  while (stack.length && files.length < MAX_SCAN_FILES && visited++ < 20000) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_SCAN_FILES) break;
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      if (ignoreSet.has(e.name) || path.join(dir, e.name) === wikiDir(root)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) files.push(full);
    }
  }
  return files.sort();
}

function symbols(file, rel) {
  const ext = path.extname(file);
  if (!TEXT_EXT.has(ext)) return [];
  let text;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) return [];
    text = fs.readFileSync(file, "utf8");
  } catch { return []; }
  for (const [extRe, rule] of SYMBOL_RULES) {
    if (!extRe.test(rel)) continue;
    const names = [];
    for (const m of text.matchAll(rule)) {
      const name = m[1] || m[2];
      if (name && !names.includes(name)) names.push(name);
      if (names.length >= MAX_SYMBOLS_PER_FILE) break;
    }
    return names;
  }
  return [];
}

function edges(file, rel) {
  let text;
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return [];
    text = fs.readFileSync(file, "utf8");
  } catch { return []; }
  for (const [extRe, rule] of EDGE_RULES) {
    if (!extRe.test(rel)) continue;
    return [...text.matchAll(rule)]
      .map((m) => m[1] || m[2])
      .filter((t) => t && (t.startsWith(".") || t.startsWith("crate::") || !t.includes("/")))
      .slice(0, 20);
  }
  return [];
}

export function scan(root = repoRoot()) {
  const cfg = readWikiConfig(wikiDir(root));
  let files;
  try {
    const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    const ignores = new Set([...IGNORE_DIRS, ...cfg.ignores]);
    files = [...new Set(output.split("\0").filter(Boolean))].sort().filter(rel =>
      path.resolve(root,rel) !== wikiDir(root) && !path.resolve(root,rel).startsWith(wikiDir(root)+path.sep) && !rel.split("/").some(part => ignores.has(part) || (part.startsWith(".") && part !== ".github"))
    ).filter(rel => { try { safeFile(root, rel); return true; } catch { return false; } }).slice(0, MAX_SCAN_FILES).map(rel => path.join(root, rel));
  } catch { files = walk(root, cfg.ignores); }
  const byExt = {};
  const inventory = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const ext = path.extname(file) || "(none)";
    byExt[ext] = (byExt[ext] || 0) + 1;
    inventory.push({ path: rel, symbols: symbols(file, rel), imports: edges(file, rel) });
  }
  return { root, files: files.length, limit: MAX_SCAN_FILES, truncated: files.length >= MAX_SCAN_FILES, by_ext: byExt, inventory };
}

export function codemap(root = repoRoot()) {
  const { inventory, by_ext, files } = scan(root);
  const lines = [
    "# Codemap",
    "",
    `_${files} files. Regenerate with \`whalewiki map\` — deterministic, no model._`,
    "",
    "## Languages",
    "",
    ...Object.entries(by_ext).sort((a, b) => b[1] - a[1]).map(([e, n]) => `- \`${e}\` — ${n}`),
    "",
    "## Modules",
    "",
  ];
  const dirs = {};
  for (const f of inventory) {
    const d = path.dirname(f.path);
    (dirs[d] ||= []).push(f);
  }
  for (const [d, fs_] of Object.entries(dirs).sort()) {
    lines.push(`### \`${d}/\` (${fs_.length} files)`, "");
    for (const f of fs_.slice(0, 30)) {
      const syms = f.symbols.length ? ` — ${f.symbols.map((s) => `\`${s}\``).join(", ")}` : "";
      lines.push(`- \`${path.basename(f.path)}\`${syms}`);
    }
    if (fs_.length > 30) lines.push(`- … ${fs_.length - 30} more`);
    lines.push("");
  }
  lines.push("## Internal edges", "");
  for (const f of inventory) {
    const local = f.imports.filter((i) => i.startsWith(".") || i.startsWith("crate::"));
    if (local.length) lines.push(`- \`${f.path}\` → ${local.map((i) => `\`${i}\``).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- search -----------------------------------------------------------

export function searchWiki(query, wiki = wikiDir(), limit = 8) {
  limit = Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.floor(limit) : 8));
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  const pagesDir = path.join(wiki, "pages");
  const results = [];
  const docs = fs.existsSync(pagesDir)
    ? fs.readdirSync(pagesDir).filter((f) => f.endsWith(".md")).map((f) => path.join(pagesDir, f))
    : [];
  for (const doc of [...docs, path.join(wiki, "INDEX.md"), path.join(wiki, "codemap.md")]) {
    if (!fs.existsSync(doc)) continue;
    const text = readWikiFile(wiki, path.relative(wiki, doc).split(path.sep).join("/"));
    const lines = text.split("\n");
    let score = 0;
    const hits = [];
    lines.forEach((line, i) => {
      const low = line.toLowerCase();
      const lineHits = terms.filter((t) => low.includes(t));
      if (lineHits.length) {
        score += lineHits.length * (line.startsWith("#") ? 3 : 1);
        if (hits.length < 3) hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
      }
    });
    if (score) results.push({ page: path.relative(wiki, doc).split(path.sep).join("/"), score, hits });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- scaffold ---------------------------------------------------------

const INSTRUCTIONS_TEMPLATE = `# WhaleWiki brief

What this wiki must help a reader (human or agent) do, in your words: scope,
priorities, what to leave out. WhaleWiki reads this on init and update and
never rewrites it.

- Audience:
- Must cover:
- Skip:
`;

const WIKI_TOML_TEMPLATE = `# WhaleWiki configuration.
# Extra ignore names for scanning, in addition to the built-in list:
# ignore = ["fixtures", "benches"]
#
# Pod mode — additional source roots this wiki covers (paths relative to the
# directory containing whalewiki/):
# [[sources]]
# name = "api"
# root = "../api"
`;

const INDEX_TEMPLATE = `# WhaleWiki

| Page | Covers | Basis |
| --- | --- | --- |
| *(planned)* | | |

_Pages are sealed in \`manifest.json\` against the source files they were
written from. \`node whalewiki/.tool/status.mjs\` recomputes freshness._
`;

export function scaffold(root = repoRoot()) {
  const wiki = process.env.WHALEWIKI_DIR ? path.resolve(process.env.WHALEWIKI_DIR) : path.join(root, WIKI_DIRNAME);
  ensureDirectory(wiki);
  for (const rel of ["pages", ".tool"]) ensureDirectory(path.join(wiki, rel));
  const self = fileURLToPath(import.meta.url);
  const target = writeTarget(wiki, ".tool/status.mjs");
  if (!fs.existsSync(target) || fs.realpathSync(self) !== fs.realpathSync(target)) atomicWrite(wiki, ".tool/status.mjs", fs.readFileSync(self));
  for (const [name, body] of [
    ["whalewiki.toml", WIKI_TOML_TEMPLATE],
    ["INSTRUCTIONS.md", INSTRUCTIONS_TEMPLATE],
    ["INDEX.md", INDEX_TEMPLATE],
  ]) {
    const p = writeTarget(wiki, name);
    if (!fs.existsSync(p)) atomicWrite(wiki, name, body);
  }
  if (!fs.existsSync(writeTarget(wiki, "manifest.json"))) {
    saveManifest({ version: 2, tool: "whalewiki", pages: {} }, wiki);
  }
  return wiki;
}

// ---------- markdown → HTML export -------------------------------------------

// Only static markup generated here enters the viewer; repository HTML is text.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const pageId = rel => `p-${Buffer.from(rel).toString("base64url")}`;
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").trim().replace(/\s+/g, "-");

function safeHref(value, page) {
  if (!value || /[\x00-\x20\x7f\\]/.test(value) || value.startsWith("//")) return null;
  if (/^(https?:|mailto:)/i.test(value)) {
    try { const u = new URL(value); return u.username || u.password ? null : u.href; } catch { return null; }
  }
  if (/^[^/#?]*:/.test(value)) return null;
  const [file, fragment] = value.split("#", 2);
  if (!file) return `#${pageId(page)}--${slug(fragment || "")}`;
  if (file.endsWith(".md")) {
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(page), file));
    if (rel.startsWith("../") || path.posix.isAbsolute(rel)) return null;
    return `#${pageId(rel)}${fragment ? `--${slug(fragment)}` : ""}`;
  }
  // Non-wiki source references stay text: the export has no source files.
  return null;
}

function inline(text, page = "INDEX.md") {
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let out = "", end = 0;
  for (const m of text.matchAll(pattern)) {
    out += esc(text.slice(end, m.index));
    if (m[1] !== undefined) out += `<code>${esc(m[1])}</code>`;
    else if (m[2] !== undefined) {
      const href = safeHref(m[3], page);
      out += href ? `<a href="${esc(href)}">${esc(m[2])}</a>` : `${esc(m[2])} (${esc(m[3])})`;
    } else if (m[4] !== undefined) out += `<strong>${esc(m[4])}</strong>`;
    else out += `<em>${esc(m[5])}</em>`;
    end = m.index + m[0].length;
  }
  return out + esc(text.slice(end));
}

export function mdToHtml(md, page = "INDEX.md") {
  const out = [], headings = new Map();
  let inCode = false, list = "", inTable = false, paragraph = [];
  const flush = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(" "), page)}</p>`); paragraph = []; } };
  const close = () => {
    flush();
    if (list) { out.push(`</${list}>`); list = ""; }
    if (inTable) { out.push("</tbody></table></div>"); inTable = false; }
  };
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { close(); out.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(esc(line) + "\n"); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      close(); const name = slug(h[2]), count = headings.get(name) || 0; headings.set(name, count + 1);
      const id = `${pageId(page)}--${name}${count ? `-${count}` : ""}`;
      out.push(`<h${h[1].length} id="${esc(id)}">${inline(h[2], page)}</h${h[1].length}>`); continue;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      const cells = line.trim().slice(1, -1).split("|").map(c => c.trim());
      if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue;
      const tag = inTable ? "td" : "th";
      if (!inTable) { close(); out.push('<div class="table-scroll"><table><tbody>'); inTable = true; }
      out.push("<tr>" + cells.map(c => `<${tag}${tag === "th" ? ' scope="col"' : ""}>${inline(c, page)}</${tag}>`).join("") + "</tr>"); continue;
    }
    const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
    if (li) {
      const kind = /\d/.test(li[1]) ? "ol" : "ul";
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(li[2], page)}</li>`); continue;
    }
    if (/^---+$/.test(line.trim())) { close(); out.push("<hr>"); continue; }
    if (/^>\s?/.test(line)) { close(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""), page)}</blockquote>`); continue; }
    if (!line.trim()) { close(); continue; }
    if (list || inTable) close();
    paragraph.push(line);
  }
  close(); if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

export function exportHtml(wiki = wikiDir()) {
  const report = statusReport(wiki);
  const verdicts = Object.fromEntries(report.pages.map(p => [p.page, p]));
  const docs = ["INDEX.md", "codemap.md", ...report.pages.map(p => p.page)].filter((rel, i, a) =>
    a.indexOf(rel) === i && fs.existsSync(path.join(wiki, rel)));
  const entries = docs.map(rel => {
    const md = readWikiFile(wiki, rel);
    return { rel, md, title: /^#\s+(.+)$/m.exec(md)?.[1] || rel, v: verdicts[rel] };
  });
  const nav = entries.map(({rel, title, v}) => `<li data-page="${pageId(rel)}"><a href="#${pageId(rel)}"><span>${esc(title)}</span>${v ? `<small class="v-${v.verdict}">${v.verdict}</small>` : ""}</a></li>`).join("");
  const sections = entries.map(({rel, md, v}) => {
    const reasons = v ? [v.page_changed ? "Page edited since sealing." : "", ...v.changed.map(s => `Changed source: ${s}`), ...v.missing.map(s => `Missing or unreadable: ${s}`)].filter(Boolean) : [];
    return `<section id="${pageId(rel)}" tabindex="-1" data-verdict="${v?.verdict || "navigation"}"><div class="page-meta"><span>${esc(rel)}</span>${v ? `<strong class="v-${v.verdict}">${v.verdict}</strong>` : ""}</div>${v && v.verdict !== "fresh" ? `<aside class="notice"><strong>Check the sources before relying on this page.</strong><p>${esc(reasons.join(" ") || "This page needs to be sealed against its current prose and sources.")}</p></aside>` : ""}${mdToHtml(md, rel, wiki)}</section>`;
  }).join("\n");
  const script = `(() => {
    const pages = [...document.querySelectorAll('main section')];
    const items = [...document.querySelectorAll('nav li[data-page]')];
    const input = document.getElementById('search');
    const status = document.getElementById('search-status');
    const filter = document.getElementById('freshness');
    const contents = new Map(pages.map(p => [p.id, p.textContent.toLocaleLowerCase()]));
    function search() {
      const query = input.value.trim().toLocaleLowerCase(); let count = 0;
      items.forEach(item => {
        const page = document.getElementById(item.dataset.page);
        const match = (!query || contents.get(page.id).includes(query)) && (filter.value === 'all' || !['fresh', 'navigation'].includes(page.dataset.verdict));
        item.hidden = !match; if (match) count++;
      });
      status.textContent = count ? count + ' pages found' : 'No matching pages. Try another word or show all pages.';
    }
    function select(focus = false) {
      let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
      if (id === 'content') return;
      const target = document.getElementById(id);
      const chosen = target?.closest('main section') || pages[0];
      pages.forEach(p => p.hidden = p !== chosen);
      items.forEach(item => { const a = item.querySelector('a'); if (item.dataset.page === chosen?.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      if (focus && chosen) { chosen.focus({preventScroll:true}); (target || chosen).scrollIntoView(); }
    }
    input.addEventListener('input', search); filter.addEventListener('change', search);
    addEventListener('hashchange', () => select(true));
    document.getElementById('clear-search').addEventListener('click', () => { input.value = ''; filter.value = 'all'; search(); input.focus(); });
    document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); document.getElementById('browse').open = true; input.focus(); } });
    if (matchMedia('(max-width:760px)').matches) document.getElementById('browse').open = false;
    select(); search();
  })();`;
  const scriptHash = createHash("sha256").update(script).digest("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'; form-action 'none'"><title>WhaleWiki</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf8;--panel:#f1f3f0;--text:#202d2b;--muted:#56635f;--line:#d6dcd6;--accent:#176250;--code:#edf0eb;--warn:#785000;--danger:#a32b2b;--selection:#d4e9df}
*{box-sizing:border-box}body{font:16px/1.7 system-ui,-apple-system,sans-serif;margin:0;color:var(--text);background:var(--bg);display:grid;grid-template-columns:290px minmax(0,1fr)}
::selection{background:var(--selection)}a{color:var(--accent);text-underline-offset:.2em}a:hover{text-decoration-thickness:2px}:focus-visible{outline:2px solid var(--accent);outline-offset:4px}[hidden]{display:none!important}
.skip{position:fixed;inset-block-start:0;background:var(--bg);padding:12px;z-index:2;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}.skip:focus{width:auto;height:auto;clip-path:none}
nav{position:sticky;top:0;height:100vh;overflow:auto;padding:28px 22px;border-inline-end:1px solid var(--line);background:var(--panel);scrollbar-color:var(--muted) var(--panel)}
.brand{font-size:23px;font-weight:700;letter-spacing:-.025em;margin:0 0 2px}.intro{font-size:14px;color:var(--muted);margin:0 0 26px}
summary{cursor:pointer;padding:12px 0;font-weight:600}nav summary{display:none}label{display:block;font-size:14px;font-weight:600;margin:16px 0 5px}input,select,button{font:inherit;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:5px;padding:9px 10px;max-width:100%;caret-color:var(--accent)}input,select{width:100%}button{cursor:pointer;font-size:14px;margin-top:8px}button:hover{border-color:var(--accent)}
#search-status{font-size:14px;color:var(--muted);min-height:24px;margin:12px 0}nav ul{list-style:none;padding:0;margin:18px 0}nav li{margin:2px 0}nav li a{display:flex;align-items:baseline;gap:10px;justify-content:space-between;color:var(--text);padding:10px 8px;text-decoration:none;border-radius:4px;overflow-wrap:anywhere}nav li a:hover,nav li a[aria-current]{background:var(--selection)}nav li a[aria-current]{font-weight:600}small{font-size:12px;font-weight:600;white-space:nowrap}
footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}main{padding:48px clamp(24px,5vw,80px);min-width:0}section{max-width:74ch;margin:0 auto 72px;overflow-wrap:anywhere;scroll-margin-top:24px}section:focus{outline:none}.page-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;color:var(--muted);font-size:13px;margin-bottom:24px;font-variant-numeric:tabular-nums}
h1{font-size:clamp(30px,4vw,42px);line-height:1.15;letter-spacing:-.03em;margin:0 0 24px;text-wrap:balance}h2{font-size:25px;line-height:1.3;margin:40px 0 14px;letter-spacing:-.02em}h3{font-size:20px;margin:30px 0 10px}p{margin:0 0 18px}li{margin:6px 0}pre{background:var(--code);padding:20px;overflow:auto;border-radius:6px;line-height:1.6}code{font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}p code,li code{background:var(--code);padding:2px 4px;border-radius:3px}.table-scroll{overflow:auto;margin-block:24px}table{border-collapse:collapse;width:100%;text-align:start;font-size:14px}td,th{padding:12px;border-bottom:1px solid var(--line);text-align:start}th{background:var(--panel)}blockquote{margin:24px 0;padding:16px 20px;background:var(--panel)}hr{border:0;border-top:1px solid var(--line);margin:32px 0}.notice{padding:18px;background:var(--panel);border:1px solid var(--line);margin-bottom:26px}.notice p{margin:6px 0 0;font-size:14px}.v-fresh{color:var(--accent)}.v-stale,.v-unsealed{color:var(--warn)}.v-orphaned{color:var(--danger)}
@media(prefers-color-scheme:dark){:root{--bg:#18221f;--panel:#202c27;--text:#e0e7df;--muted:#b1beb5;--line:#435249;--accent:#9bdbbb;--code:#24332b;--warn:#efd391;--danger:#ffb2b2;--selection:#334b3e}}
@media(max-width:760px){nav summary{display:list-item}body{display:block}nav{position:static;height:auto;padding:22px;border-inline-end:0;border-bottom:1px solid var(--line)}nav ul{max-height:240px;overflow:auto}.intro{margin-bottom:14px}main{padding:30px 22px}.page-meta{font-size:12px}footer{margin-top:18px}}
@media print{body{display:block}nav,.skip{display:none}main{padding:0}main section[hidden]{display:block!important}section{break-after:page}pre{white-space:pre-wrap}}
</style></head><body><a class="skip" href="#content">Skip to content</a><nav aria-label="Wiki pages"><p class="brand">WhaleWiki</p><p class="intro">Read the code. Keep the context.</p><details id="browse" open><summary>Browse pages and search</summary><label for="search">Search this wiki</label><input id="search" type="search" placeholder="Find a page or phrase" autocomplete="off"><label for="freshness">Show</label><select id="freshness"><option value="all">All pages</option><option value="attention">Needs review</option></select><button id="clear-search" type="button">Clear filters</button><p id="search-status" role="status" aria-live="polite"></p><ul>${nav}</ul></details><footer>${report.counts.fresh} fresh · ${report.counts.stale + report.counts.orphaned + report.counts.unsealed} need review<br>Snapshot checked ${esc(report.checked_at)}<br>Fresh means unchanged evidence, not verified claims. Re-export to refresh.</footer></nav><main id="content" tabindex="-1">${sections || '<section><h1>Your wiki is ready for its first page</h1><p>Run /whalewiki init in Codewhale to read your repository, write pages and seal their sources.</p></section>'}</main><script>${script}</script></body></html>`;
}

// ---------- output helpers ---------------------------------------------------

function formatStatus(report, short) {
  const c = report.counts;
  if (short) {
    return report.total === 0
      ? "whalewiki: no pages sealed yet"
      : `whalewiki: ${c.fresh} fresh, ${c.stale} stale, ${c.touched} touched, ${c.orphaned} orphaned, ${c.unsealed} unsealed (${report.total} pages)`;
  }
  const lines = [formatStatus(report, true), ""];
  for (const p of report.pages) {
    const why = p.page_changed ? " — page edited since sealing" : p.changed.length ? ` — changed: ${p.changed.join(", ")}`
      : p.missing.length ? ` — missing: ${p.missing.join(", ")}`
      : p.touched?.length ? ` — cosmetic: ${p.touched.join(", ")}` : "";
    lines.push(`  ${p.verdict.padEnd(9)} ${p.page}${why}`);
  }
  return lines.join("\n");
}

// ---------- CLI --------------------------------------------------------------

export function main(argv = process.argv.slice(2)) {
  let [cmd, ...rest] = argv;
  // Bare flags (or nothing) mean status — `status.mjs --short` works when the
  // engine is copied into the wiki as the self-verifier.
  if (cmd === "--help" || cmd === "-h" || cmd === "help") cmd = undefined;
  else if (cmd === undefined || cmd.startsWith("-")) {
    rest = cmd === undefined ? [] : argv;
    cmd = "status";
  }
  const flag = (name) => rest.includes(name);
  const opt = (name, dflt) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : dflt;
  };
  switch (cmd) {
    case "scaffold": {
      const wiki = scaffold();
      console.log(`whalewiki: scaffolded ${wiki}`);
      console.log("next: edit whalewiki/INSTRUCTIONS.md, then scan + plan pages");
      break;
    }
    case "scan": {
      const s = scan();
      if (flag("--json")) { console.log(JSON.stringify(s)); break; }
      console.log(`${s.files} files at ${s.root}`);
      for (const [e, n] of Object.entries(s.by_ext).sort((a, b) => b[1] - a[1]).slice(0, 12))
        console.log(`  ${e.padEnd(8)} ${n}`);
      console.log("\nKey files (with symbols):");
      for (const f of s.inventory.filter((f) => f.symbols.length).slice(0, 60))
        console.log(`  ${f.path} — ${f.symbols.slice(0, 5).join(", ")}`);
      break;
    }
    case "map": {
      const wiki = wikiDir();
      const out = path.join(wiki, "codemap.md");
      atomicWrite(wiki, "codemap.md", codemap());
      console.log(`whalewiki: wrote ${out}`);
      break;
    }
    case "manifest": {
      const wiki = wikiDir();
      const manifest = loadManifest(wiki);
      if (rest[0] === "set") {
        const page = rest[1];
        if (typeof page !== "string" || !PAGE_PATH.test(page)) {
          console.error(`page must look like 'pages/<name>.md', got: ${page}`);
          process.exitCode = 1;
          break;
        }
        const pageFile = safeFile(wiki, page);
        const srcArg = opt("--sources", "");
        if (!srcArg.trim()) throw new Error("sealing requires at least one source file");
        const rootName = opt("--root", "repo");
        const roots = sourceRoots(wiki);
        const base = roots[rootName];
        if (!base) { console.error(`unknown source root '${rootName}'`); process.exitCode = 1; break; }
        const sources = srcArg.split(",").map((s) => s.trim()).filter(Boolean).map((spec) => {
          // `name:path` qualifies a source against a named [[sources]] root —
          // how a pod page seals files across several repos at once.
          let rel = spec, srcRoot = rootName;
          const colon = spec.indexOf(":");
          if (colon > 0 && roots[spec.slice(0, colon)]) {
            srcRoot = spec.slice(0, colon);
            rel = spec.slice(colon + 1);
          }
          const srcBase = roots[srcRoot];
          const abs = safeFile(srcBase, rel);
          return { path: rel, root: srcRoot, sha256: sha256(abs), bytes: fs.statSync(abs).size };
        });
        manifest.pages[page] = {
          title: page.replace(/^pages\/|\.md$/g, "").replace(/[-_]/g, " "),
          page_sha256: sha256(pageFile),
          sources, sealed_at: new Date().toISOString(),
        };
        manifest.version = 2;
        saveManifest(manifest, wiki);
        console.log(`sealed ${page} against ${sources.length} source(s)`);
      } else {
        console.log(JSON.stringify(manifest, null, 2));
      }
      break;
    }
    case "status": {
      const report = statusReport(wikiDir(), { receipt: flag("--receipt") });
      if (flag("--mark")) {
        const indexFile = path.join(report.wiki, "INDEX.md");
        if (fs.lstatSync(indexFile, { throwIfNoEntry: false })) {
          const byPage = Object.fromEntries(report.pages.map((p) => [p.page, p.verdict]));
          const marked = readWikiFile(report.wiki, "INDEX.md").split("\n").map((line) => {
            const m = line.match(/\((pages\/[^)]+\.md)\)/);
            return m && byPage[m[1]]
              ? line.replace(/\s*<!--\s*ww:\w+\s*-->$/, "") + ` <!-- ww:${byPage[m[1]]} -->`
              : line;
          }).join("\n");
          atomicWrite(report.wiki, "INDEX.md", marked);
        }
      }
      if (flag("--json")) console.log(JSON.stringify(report, null, 2));
      else console.log(formatStatus(report, flag("--short")));
      if (flag("--exit-stale")) {
        const c = report.counts;
        if (report.total === 0 || c.stale + c.orphaned + c.unsealed > 0) process.exitCode = 2;
      }
      break;
    }
    case "search": {
      const q = rest.filter((r) => !r.startsWith("-")).join(" ");
      for (const r of searchWiki(q)) {
        console.log(`${r.page} (score ${r.score})`);
        for (const h of r.hits) console.log(`  ${h.line}: ${h.text}`);
      }
      break;
    }
    case "export": {
      const out = opt("--out", path.join(wikiDir(), "whalewiki.html"));
      atomicWrite(path.dirname(path.resolve(out)), path.basename(out), exportHtml());
      console.log(`whalewiki: wrote ${out}`);
      break;
    }
    default:
      console.log(`whalewiki — evidence-bound repo wiki
  scaffold | scan [--json] | map | manifest set <page> --sources a,b [--root n] | manifest show
  status [--short|--json|--exit-stale|--mark] | search <q> | export [--out f.html]`);
      if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
  }
}

// argv[1] may traverse a symlink (e.g. /var → /private/var on macOS) while
// import.meta.url is already resolved — compare realpaths.
const invokedAs = process.argv[1] && fs.existsSync(process.argv[1])
  ? pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href
  : "";
if (import.meta.url === invokedAs) {
  try { main(); } catch (error) { console.error(`whalewiki: ${error.message}`); process.exitCode = 1; }
}
