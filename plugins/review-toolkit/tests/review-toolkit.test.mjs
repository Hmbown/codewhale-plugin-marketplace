// Contract tests for the review-toolkit bundle. They check the shipped files
// against the Codewhale agent-profile loader's rules (mirrored from
// crates/tui/src/fleet/profile.rs), the real marketplace checker and the real
// packager. They do not prove model behavior; the install test in the plugin's
// validation record drives the installed Codewhale binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(PLUGIN));
const AGENTS = path.join(PLUGIN, 'agents');
const SHORT_NAMES = { general: 'review-general', 'silent-failures': 'review-silent-failures', 'type-design': 'review-type-design', 'test-gaps': 'review-test-gaps', comments: 'review-comments', simplifier: 'review-simplifier' };

const python = spawnSync('python3', ['-c', 'import tomllib'], { encoding: 'utf8' });
const hasPython = python.status === 0;

/** Parse a TOML file with a real parser (python3 tomllib). */
function parseToml(file) {
  const out = execFileSync('python3', ['-c', 'import sys,json,tomllib;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', file], { encoding: 'utf8' });
  return JSON.parse(out);
}
const agentFiles = () => fs.readdirSync(AGENTS).filter((f) => f.endsWith('.toml')).sort();
const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');

// The keys Codewhale's AgentProfileToml accepts (deny_unknown_fields).
const ALLOWED_TOP = new Set(['id', 'name', 'display_name', 'description', 'role_hint', 'base_role', 'persona', 'loadout', 'model', 'model_hint', 'model_id', 'provider', 'reasoning_effort', 'thinking', 'reasoning', 'instructions', 'tools', 'permissions']);

test('manifest is a closed Agent Plugins v1 document with the three components', () => {
  const m = JSON.parse(read('plugin.json'));
  assert.deepEqual(Object.keys(m).filter((k) => !['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'].includes(k)), []);
  assert.equal(m.name, 'review-toolkit');
  assert.match(m.name, /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/);
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  const ns = m.extensions['net.codewhale'];
  assert.deepEqual(Object.keys(ns).sort(), ['agents', 'commands', 'display_name', 'skills', 'when']);
  for (const c of ['agents', 'commands', 'skills']) assert.ok(fs.statSync(path.join(PLUGIN, ns[c].path)).isDirectory(), c);
  // No network, MCP or credential surface: this bundle is prompts only.
  assert.equal(ns.capabilities, undefined);
  assert.equal(fs.existsSync(path.join(PLUGIN, 'mcp.json')), false);
  assert.ok(fs.existsSync(path.join(PLUGIN, 'LICENSE')) && fs.existsSync(path.join(PLUGIN, 'README.md')));
});

test('six reviewer profiles ship, one per specialty', () => {
  assert.deepEqual(agentFiles(), Object.values(SHORT_NAMES).map((id) => `${id}.toml`).sort());
});

test('every profile parses as TOML and satisfies the Codewhale loader rules', { skip: !hasPython && 'python3 tomllib unavailable' }, () => {
  const ids = new Set();
  for (const file of agentFiles()) {
    const p = parseToml(path.join(AGENTS, file));
    const where = file;
    for (const k of Object.keys(p)) assert.ok(ALLOWED_TOP.has(k), `${where}: unknown key ${k}`);
    assert.match(p.id, /^[A-Za-z0-9._-]+$/, `${where}: id must be a simple token`);
    assert.equal(`${p.id}.toml`, file, `${where}: id must match the file name`);
    assert.ok(!ids.has(p.id.toLowerCase()), `${where}: duplicate id`);
    ids.add(p.id.toLowerCase());
    assert.ok(p.id.startsWith('review-'), `${where}: ids are global to the roster, keep the review- prefix`);
    assert.equal(p.role_hint, 'reviewer', `${where}: reviewers use the read-only reviewer role`);
    assert.ok(p.display_name && p.description, `${where}: needs display_name and description`);
    // A profile can never widen authority; do not even ask.
    assert.equal(p.permissions, undefined, `${where}: no permissions table`);
    assert.deepEqual(p.tools, { posture: 'read-only' }, `${where}: tools.posture must be read-only`);
    // Provider neutrality: no model or provider pin.
    for (const k of ['model', 'model_hint', 'model_id', 'provider']) assert.equal(p[k], undefined, `${where}: ${k} would pin a vendor`);
    assert.deepEqual(Object.keys(p.instructions), ['text'], `${where}: instructions has only text`);
    const text = p.instructions.text;
    assert.ok(text.length > 1500 && text.length < 9000, `${where}: instructions length ${text.length}`);
    assert.match(text, /Read-only\. Never edit, stage, commit, push/, `${where}: states it is read-only`);
    assert.match(text, /data under\s+review/, `${where}: treats repository text as data`);
    assert.match(text, /## Findings/, `${where}: defines the Findings section`);
    assert.match(text, /## Clear/, `${where}: defines the Clear section`);
    assert.match(text, /Could not confirm|Considered, not findings/, `${where}: separates unconfirmed items`);
  }
  assert.equal(ids.size, 6);
});

test('profile prompts stay specialized and share a finding format', { skip: !hasPython && 'python3 tomllib unavailable' }, () => {
  const text = (short) => parseToml(path.join(AGENTS, `${SHORT_NAMES[short]}.toml`)).instructions.text;
  assert.match(text('silent-failures'), /catch|except/);
  assert.match(text('silent-failures'), /Who would ever find out/);
  assert.match(text('type-design'), /Invariants/);
  assert.match(text('type-design'), /Representable invalid states/);
  assert.match(text('test-gaps'), /which test\s+would fail/);
  assert.match(text('test-gaps'), /Suggested test/);
  assert.match(text('comments'), /still true after this change/);
  assert.match(text('simplifier'), /preserve behavior/i);
  assert.match(text('simplifier'), /Never recommend removing/);
  assert.match(text('general'), /## Verdict/);
  for (const short of Object.keys(SHORT_NAMES)) assert.match(text(short), /\[severity: /, `${short}: shared severity marker`);
});

test('skill, command and profiles agree on names', () => {
  const skill = read('skills/review-panel/SKILL.md');
  const fm = skill.match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.match(fm, /^name: review-panel$/m);
  assert.match(fm, /^description: .{40,}/m);
  const command = read('commands/review-pr.md');
  assert.match(command, /^description: .+/m);
  assert.match(command, /review-toolkit:review-panel/);
  assert.match(command, /\$ARGUMENTS/);
  for (const [short, id] of Object.entries(SHORT_NAMES)) {
    assert.ok(skill.includes(`| ${short} | \`${id}\` |`), `skill maps ${short} to ${id}`);
    assert.ok(command.includes(short), `command usage lists ${short}`);
    assert.ok(fs.existsSync(path.join(AGENTS, `${id}.toml`)), `${id} ships`);
  }
  // The skill must never tell the chair to mutate anything.
  assert.match(skill, /do not edit code, stage files,\s+push, or post comments/i);
  assert.doesNotMatch(read('commands/review-pr.md') + skill, /git (push|commit|add)\b(?!,)(?! files)/);
});

test('no credential-shaped strings are baked into any file', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(PLUGIN)) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/, f);
  }
});

/** A throwaway repository holding only this plugin, a catalog row, and the real scripts. */
function fixtureRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-review-toolkit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const s of ['check-marketplace.mjs', 'package-plugin.mjs']) fs.copyFileSync(path.join(REPO, 'scripts', s), path.join(root, 'scripts', s));
  fs.cpSync(PLUGIN, path.join(root, 'plugins/review-toolkit'), { recursive: true });
  const manifest = JSON.parse(read('plugin.json'));
  fs.writeFileSync(path.join(root, 'marketplace.json'), JSON.stringify({ name: 'fixture', plugins: [{ name: manifest.name, version: manifest.version, description: manifest.description, source: 'path:plugins/review-toolkit' }] }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

test('the real marketplace checker accepts the bundle once it has a catalog row', (t) => {
  const root = fixtureRepo(t);
  const r = spawnSync(process.execPath, ['scripts/check-marketplace.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the real packager produces a clean installable tree', (t) => {
  const root = fixtureRepo(t);
  const out = path.join(root, 'out');
  const r = spawnSync(process.execPath, ['scripts/package-plugin.mjs', 'review-toolkit', '--out', out], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const pkg = path.join(out, 'review-toolkit');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.relative(pkg, path.join(d, e.name)))));
  walk(pkg);
  for (const must of ['plugin.json', 'README.md', 'LICENSE', 'commands/review-pr.md', 'skills/review-panel/SKILL.md', ...Object.values(SHORT_NAMES).map((id) => `agents/${id}.toml`)]) assert.ok(files.includes(must), `package lacks ${must}`);
  assert.ok(JSON.parse(r.stdout).bytes < 5 * 1024 * 1024);
});
