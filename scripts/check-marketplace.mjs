#!/usr/bin/env node
// Validate the marketplace catalog against the tree it describes — the same
// contract Codewhale's reviewed installer enforces:
//
//   * marketplace.json parses; every entry has a unique name, a `source`
//     Codewhale accepts (`path:`, `github:owner/repo`, `https://`), and a
//     one-line human description (no YAML markers, no empty strings).
//   * `path:` sources resolve relative to this file's directory and point at
//     a real plugin bundle — a directory holding plugin.json,
//     kimi.plugin.json, or plugin.toml, because that is what the staged
//     installer requires. A bare SKILL.md folder is NOT installable.
//   * the bundle's manifest name equals the catalog name, and a declared
//     catalog `version` matches the manifest version.
//   * the installable tree fits the host's per-bundle size cap
//     (5 MiB uncompressed, measured over files that would be copied —
//     everything on disk except .git).
//   * every SKILL.md under a bundle's skills roots has parseable frontmatter
//     with a name and a non-empty description.
//
// Optional: --core <path-to-codewhale-repo> also checks that skills/<name>/
// mirrors crates/tui/assets/skills/<name>/SKILL.md byte-for-byte, so the
// readable mirror can never silently drift from what the binary ships.
//
// Exit 0 on success; prints one line per problem and exits 1 otherwise.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const CAP = 5 * 1024 * 1024; // host plugin-install cap, uncompressed bytes
const MANIFESTS = ["plugin.json", "kimi.plugin.json", "plugin.toml"];
const ENTRY_FIELDS = new Set(["name", "source", "description", "version", "homepage"]);

const args = process.argv.slice(2);
const coreIdx = args.indexOf("--core");
const CORE = coreIdx >= 0 ? path.resolve(args[coreIdx + 1]) : null;

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const note = (m) => notes.push(m);

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`${label}: not valid JSON — ${e.message}`);
    return null;
  }
}

function trackedSizeBytes(dir) {
  try {
    const rel = path.relative(ROOT, dir);
    const out = execFileSync("git", ["ls-files", "-z", "--", rel], { cwd: ROOT });
    let total = 0;
    for (const f of out.toString("utf8").split("\0")) {
      if (!f) continue;
      const p = path.join(ROOT, f);
      try { total += fs.statSync(p).size; } catch {}
    }
    return total;
  } catch { return null; }
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { fail(`symlink inside bundle: ${path.relative(ROOT, p)}`); continue; }
    if (entry.isDirectory()) total += dirSizeBytes(p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

function manifestOf(dir) {
  for (const name of MANIFESTS) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    if (name === "plugin.toml") {
      const text = fs.readFileSync(p, "utf8");
      return { file: name, name: /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1], version: /^\s*version\s*=\s*"([^"]+)"/m.exec(text)?.[1], skillsRoots: null };
    }
    const doc = readJson(p, `${path.relative(ROOT, dir)}/${name}`);
    if (!doc) return null;
    const cw = doc.extensions?.["net.codewhale"] ?? {};
    const roots = [];
    const spec = cw.skills;
    if (spec?.path) roots.push(spec.path);
    for (const extra of spec?.paths ?? []) roots.push(extra);
    return {
      file: name,
      name: doc.name,
      version: doc.version,
      skillsRoots: roots.length ? roots : (fs.existsSync(path.join(dir, "skills")) ? ["skills"] : []),
      networkHosts: cw.capabilities?.network_hosts ?? [],
    };
  }
  return null;
}

function checkSkillMd(file, label) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.startsWith("---")) { fail(`${label}: SKILL.md missing frontmatter`); return; }
  const end = text.indexOf("\n---", 3);
  if (end < 0) { fail(`${label}: SKILL.md frontmatter never closes`); return; }
  const fm = text.slice(3, end);
  const name = /^name:[ \t]*(.*)$/m.exec(fm)?.[1]?.trim();
  const desc = /^description:[ \t]*(.*)$/m.exec(fm);
  if (!name) fail(`${label}: SKILL.md frontmatter missing name`);
  if (!desc) { fail(`${label}: SKILL.md frontmatter missing description`); return; }
  let value = desc[1].trim();
  // Core supports folded/literal block scalars. Require their indented text,
  // rather than rejecting a valid description or accepting an empty marker.
  if (/^[>|][-+]?$/.test(value)) {
    const lines = fm.slice(desc.index + desc[0].length).split("\n").slice(1);
    const body = [];
    for (const line of lines) {
      if (line.trim() && !/^[ \t]/.test(line)) break;
      body.push(line.trim());
    }
    value = body.join(" ").trim();
  }
  if (!value || value === '""' || value === "''") fail(`${label}: SKILL.md description must contain text`);
}

// The host requires capabilities.network_hosts to exactly match the host set
// of every remote MCP endpoint the bundle declares — a mismatch fails
// validation at install, so catch it here.
function checkMcpContract(dir, manifest, label) {
  const mcpFile = path.join(dir, "mcp.json");
  if (!fs.existsSync(mcpFile)) return;
  const doc = readJson(mcpFile, `${label}/mcp.json`);
  if (!doc || !doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers)) { fail(`${label}/mcp.json: mcpServers must be an object`); return; }
  const remoteHosts = new Set();
  for (const [id, server] of Object.entries(doc.mcpServers)) {
    if (!server?.url) continue;
    let host;
    try { host = new URL(server.url).hostname.toLowerCase(); }
    catch { fail(`${label}/mcp.json: server '${id}' url is not a URL: ${server.url}`); continue; }
    if (!/^https:$/.test(new URL(server.url).protocol)) fail(`${label}/mcp.json: server '${id}' remote transport must be https (got ${server.url})`);
    remoteHosts.add(host);
    const cw = server.extensions?.["net.codewhale"] ?? {};
    if (cw.bearer_token_env_var && !/^[A-Z_][A-Z0-9_]*$/.test(cw.bearer_token_env_var)) {
      fail(`${label}/mcp.json: server '${id}' bearer_token_env_var '${cw.bearer_token_env_var}' is not an env-var name`);
    }
  }

  const declared = new Set((manifest.networkHosts ?? []).map((h) => h.toLowerCase()));
  for (const host of remoteHosts) {
    if (!declared.has(host)) fail(`${label}: mcp.json reaches ${host} but capabilities.network_hosts does not declare it — install would fail review`);
  }
  for (const host of declared) {
    if (!remoteHosts.has(host)) fail(`${label}: network_hosts declares ${host} but no remote endpoint uses it`);
  }
}

function checkSkillRoots(bundleDir, manifest) {
  for (const rel of manifest.skillsRoots ?? []) {
    const root = path.join(bundleDir, rel);
    if (!fs.existsSync(root)) { fail(`${bundleDir}: declared skills path '${rel}' does not exist`); continue; }
    const walk = (dir, depth) => {
      if (depth > 8) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (!e.isDirectory()) continue;
        if (fs.existsSync(path.join(p, "SKILL.md"))) checkSkillMd(path.join(p, "SKILL.md"), path.relative(ROOT, p));
        else walk(p, depth + 1);
      }
    };
    walk(root, 0);
  }
}

// --- catalog ---
const catalogPath = path.join(ROOT, "marketplace.json");
const catalog = readJson(catalogPath, "marketplace.json");
if (catalog) {
  if (!catalog.name || typeof catalog.name !== "string") fail("marketplace.json: missing catalog name");
  if (!Array.isArray(catalog.plugins)) fail("marketplace.json: `plugins` must be an array");
  const seen = new Set();
  for (const [i, entry] of (catalog.plugins ?? []).entries()) {
    const where = `plugins[${i}]`;
    if (typeof entry !== "object" || entry === null) { fail(`${where}: entry is not an object`); continue; }
    for (const key of Object.keys(entry)) if (!ENTRY_FIELDS.has(key)) note(`${where} (${entry.name ?? "?"}): unknown field '${key}' — Codewhale parses entries with a fixed field set; extra fields warn`);
    const name = entry.name;
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) { fail(`${where}: bad or missing name`); continue; }
    if (seen.has(name)) { fail(`${where}: duplicate name '${name}'`); continue; }
    seen.add(name);
    const desc = entry.description;
    if (typeof desc !== "string" || !desc.trim() || /^[>|][-+]?$/.test(desc.trim())) {
      fail(`${name}: description is empty or a YAML fold marker — write the sentence a reviewer needs`);
    }
    const source = entry.source;
    if (typeof source !== "string" || !source.trim()) { fail(`${name}: missing source`); continue; }
    if (source.startsWith("path:")) {
      const rel = source.slice(5);
      const dir = path.resolve(ROOT, rel);
      if (fs.existsSync(dir) && fs.realpathSync(dir) !== dir) { fail(`${name}: path source must not traverse symlinks`); continue; }
      if (!path.relative(ROOT, dir).length || path.relative(ROOT, dir).startsWith("..")) { fail(`${name}: path source escapes the repository: ${source}`); continue; }
      if (!fs.existsSync(dir)) { fail(`${name}: path source does not exist: ${rel}`); continue; }
      const manifest = manifestOf(dir);
      if (!manifest) { fail(`${name}: ${rel} has no ${MANIFESTS.join("/")} — not installable as a plugin bundle`); continue; }
      if (manifest.name && manifest.name !== name) fail(`${name}: manifest name is '${manifest.name}' — install would place it under '${manifest.name}'`);
      if (entry.version && manifest.version && entry.version !== manifest.version) fail(`${name}: catalog version ${entry.version} != manifest version ${manifest.version}`);
      checkMcpContract(dir, manifest, name);
      // The host installer copies the working tree, so disk size decides a
      // `path:` install; tracked size decides what a clone/tarball ships. A
      // tracked tree over cap fails; a dirty dev tree over cap only warns —
      // the release artifact still fits but a local install of this checkout
      // would not.
      const tracked = trackedSizeBytes(dir);
      const bytes = dirSizeBytes(dir);
      if (tracked != null && tracked > CAP) fail(`${name}: ${rel} tracks ${(tracked / 1048576).toFixed(1)} MiB — over the ${(CAP / 1048576).toFixed(0)} MiB install cap`);
      else if (bytes > CAP) note(`${name}: ${rel} is ${(bytes / 1048576).toFixed(1)} MiB on disk (${(tracked / 1048576).toFixed(1)} MiB tracked) — a path: install of this dev checkout would exceed the cap; local receipts/dist output are the usual cause`);
      else note(`${name}: ${(bytes / 1048576).toFixed(2)} MiB on disk, under cap`);
      checkSkillRoots(dir, manifest);
    } else if (/^github:[^\s/]+\/[^\s/]+$/.test(source)) {
      note(`${name}: remote source '${source}' — not validated offline`);
    } else if (/^https:\/\//.test(source)) {
      note(`${name}: remote source '${source}' — not validated offline`);
    } else {
      fail(`${name}: source '${source}' is not a spec Codewhale accepts (path:, github:owner/repo, https:// tarball)`);
    }
  }
  // Every bundle directory that exists but is not listed is worth a note —
  // it is invisible to the catalog.
  for (const top of ["plugins"]) {
    const base = path.join(ROOT, top);
    if (!fs.existsSync(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const rel = `${top}/${e.name}`;
      const listed = (catalog.plugins ?? []).some((p) => p.source === `path:${rel}`);
      const hasManifest = MANIFESTS.some((m) => fs.existsSync(path.join(base, e.name, m)));
      if (hasManifest && !listed) note(`${rel}: bundle exists but is not in the catalog`);
    }
  }
}

// --- mirror check against Core's bundled skills ---
if (CORE) {
  const coreSkills = path.join(CORE, "crates", "tui", "assets", "skills");
  const mirror = path.join(ROOT, "skills");
  if (!fs.existsSync(coreSkills)) {
    fail(`--core ${CORE}: no crates/tui/assets/skills there`);
  } else {
    const coreSet = new Set(fs.readdirSync(coreSkills, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    const mirrorSet = new Set(fs.readdirSync(mirror, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    for (const name of coreSet) {
      if (!mirrorSet.has(name)) { fail(`skills/${name}: bundled in Core but missing from the marketplace mirror`); continue; }
      const a = fs.readFileSync(path.join(coreSkills, name, "SKILL.md"));
      const bPath = path.join(mirror, name, "SKILL.md");
      if (!fs.existsSync(bPath)) { fail(`skills/${name}: missing SKILL.md`); continue; }
      if (!a.equals(fs.readFileSync(bPath))) fail(`skills/${name}/SKILL.md differs from Core's bundled copy — sync or mark the fork deliberately`);
    }
    for (const name of mirrorSet) {
      if (!coreSet.has(name)) note(`skills/${name}: marketplace-only skill (not bundled in Core)`);
    }
  }
}

for (const m of notes) console.log(`note: ${m}`);
if (problems.length) {
  for (const m of problems) console.error(`FAIL: ${m}`);
  console.error(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log("marketplace.json contract: OK");
