import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const manifest = JSON.parse(read("plugin.json"));
const skillDirs = fs.readdirSync(path.join(root, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

function frontmatter(text) {
  assert.ok(text.startsWith("---\n"), "frontmatter missing");
  const end = text.indexOf("\n---", 3);
  const fm = Object.fromEntries(text.slice(4, end).split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  return { fm, body: text.slice(end + 4) };
}

test("manifest follows the marketplace contract", () => {
  assert.equal(manifest.name, "cloudflare");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, "MIT");
  assert.deepEqual(Object.keys(manifest).filter((k) => !["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"].includes(k)), []);
  const stoplist = ["accessibility", "automation", "browser", "browsers", "chrome", "codebase", "docs", "documentation", "extension", "extensions", "screenshot", "screenshots", "web", "website", "wiki"];
  assert.ok(manifest.keywords.every((k) => !stoplist.includes(k)));
  const cw = manifest.extensions["net.codewhale"];
  assert.equal(cw.skills.path, "skills");
  assert.equal(cw.commands.path, "commands");
  assert.equal(cw.capabilities, undefined, "no network or filesystem capability should be requested");
});

test("ships README, LICENSE and no MCP, hooks or agents", () => {
  for (const f of ["README.md", "LICENSE"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  for (const f of ["mcp.json", "hooks", "agents"]) assert.ok(!fs.existsSync(path.join(root, f)), `${f} must not exist`);
});

test("each skill has matching name, description, and a body", () => {
  assert.deepEqual(skillDirs.sort(), ["cloudflare-deploy", "cloudflare-durable-objects", "cloudflare-pages-to-workers", "cloudflare-storage", "cloudflare-workers"]);
  for (const dir of skillDirs) {
    const { fm, body } = frontmatter(read(`skills/${dir}/SKILL.md`));
    assert.equal(fm.name, dir);
    assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(fm.description.length > 40 && fm.description.length < 400, `${dir} description length`);
    assert.ok(body.length > 800, `${dir} is not an empty shell`);
  }
});

test("the deploy skill states the approval rule and classifies commands", () => {
  const t = read("skills/cloudflare-deploy/SKILL.md");
  assert.match(t, /Never run a command from the "needs approval" list/);
  for (const cmd of ["wrangler deploy", "versions upload", "versions deploy", "wrangler rollback", "secret put", "--remote", "wrangler login"]) {
    const afterHeading = t.split("Needs approval")[1].split("## Workflow")[0];
    assert.ok(afterHeading.includes(cmd), `${cmd} must be in the needs-approval list`);
  }
  const safe = t.split("Safe without approval")[1].split("Needs approval")[0];
  assert.ok(safe.includes("--dry-run"));
  assert.ok(!/wrangler deploy\b(?! --dry-run)/.test(safe.replace(/wrangler deploy --dry-run/g, "")), "safe list must not include a real deploy");
  assert.match(t, /explicit yes/);
});

test("no skill instructs a mutating Wrangler command without a nearby approval cue", () => {
  const mutating = /wrangler (deploy\b(?! --dry-run)|versions (upload|deploy)|rollback|secret (put|delete|bulk)|delete|kv namespace (create|delete)|d1 (create|delete)|r2 bucket (create|delete))|(migrations apply|execute)[^\n]*--remote|--remote\b/;
  const cue = /approv|ask|yes|remote|dry-run|needs|explicit|cloudflare-deploy|user|never|prompts|account|not to deploy|do not|don't/i;
  for (const dir of skillDirs) {
    if (dir === "cloudflare-deploy") continue; // classified in full by the previous test
    const lines = read(`skills/${dir}/SKILL.md`).split("\n");
    lines.forEach((line, i) => {
      if (!mutating.test(line)) return;
      const window = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
      assert.ok(cue.test(window), `${dir}:${i + 1} mentions a mutating command with no approval cue nearby: ${line.trim()}`);
    });
  }
});

test("the command points at a script that exists and states it is not an approval", () => {
  const t = read("commands/cloudflare-preflight.md");
  assert.match(t, /scripts\/preflight\.mjs/);
  assert.ok(fs.existsSync(path.join(root, "scripts/preflight.mjs")));
  assert.match(t, /not a deploy\s+approval/);
  const { fm } = frontmatter(t);
  assert.ok(fm.description);
});

test("every skill cross-reference resolves", () => {
  for (const dir of skillDirs) {
    for (const [, ref] of read(`skills/${dir}/SKILL.md`).matchAll(/`(cloudflare-[a-z-]+)`/g)) {
      assert.ok(skillDirs.includes(ref) || ref === "cloudflare-docs" || ref === "cloudflare-preflight", `${dir} references unknown ${ref}`);
    }
  }
});

test("the bundle contains no credential-shaped strings", () => {
  const shapes = [/ghp_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /sk-[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./, /\b[0-9a-f]{40}\b/];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(root)) {
    if (f.includes(`${path.sep}tests${path.sep}`)) continue;
    const t = fs.readFileSync(f, "utf8");
    for (const re of shapes) assert.ok(!re.test(t), `${path.relative(root, f)} matches ${re}`);
  }
});
