import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../scripts/package-plugin.mjs';

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace.json'), 'utf8'));
const entries = catalog.plugins.map((p) => ({...p, dir: path.join(ROOT, p.source.replace(/^path:/, ''))}));
const read = (f) => fs.readFileSync(f, 'utf8');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else if (e.isFile()) out.push(full);
  }
  return out;
}

test('every catalog entry points at a bundle whose manifest name and version match', () => {
  for (const p of entries) {
    const manifest = JSON.parse(read(path.join(p.dir, 'plugin.json')));
    assert.equal(manifest.name, p.name, `${p.source}: manifest name`);
    assert.equal(manifest.version, p.version, `${p.name}: catalog version`);
    assert.ok(p.display_name && p.description, `${p.name}: display_name and description`);
    const homepage = new URL(p.homepage);
    if (homepage.hostname === 'github.com' && homepage.pathname.includes('/codewhale-plugin-marketplace')) {
      assert.equal(homepage.pathname.split('/')[1], 'codewhale-hq', `${p.name}: canonical repository owner`);
      const sourcePath = homepage.pathname.split('/tree/main/')[1];
      if (sourcePath) assert.equal(sourcePath, p.source.slice(5), `${p.name}: homepage points at its source`);
    }
  }
  assert.equal(new Set(entries.map((p) => p.name)).size, entries.length, 'duplicate catalog names');
});

test('every plugin bundle under plugins/ is cataloged, except documented repository-only fixtures', () => {
  const relative = (dir) => path.relative(ROOT, dir).split(path.sep).join('/');
  const listed = new Set(entries.map((p) => relative(p.dir)));
  const found = [];
  for (const f of walk(path.join(ROOT, 'plugins'))) {
    if (path.basename(f) === 'plugin.json' && !f.includes(`${path.sep}tests${path.sep}`)) found.push(relative(path.dirname(f)));
  }
  // claude-sample and dsh-sample prove import paths the catalog tooling does not
  // package yet (see plugins/samples/README.md); they are fixtures, not catalog rows.
  const fixtures = /^plugins\/samples\/(claude-sample|dsh-sample)(\/|$)/;
  const unlisted = found.filter((d) => !listed.has(d)).filter((d) => !fixtures.test(d) && !/^plugins\/[^/]+\/(skills|templates|node_modules)\//.test(d));
  assert.deepEqual(unlisted, [], 'bundles with a plugin.json that are not in marketplace.json');
});

test('a qualified skill reference names the plugin that actually ships that skill', () => {
  const owners = new Map();
  for (const p of entries) {
    const root = p.source === 'path:skills' ? p.dir : path.join(p.dir, 'skills');
    if (!fs.existsSync(root)) continue;
    for (const e of fs.readdirSync(root, {withFileTypes: true})) {
      if (e.isDirectory() && fs.existsSync(path.join(root, e.name, 'SKILL.md'))) owners.set(e.name, [...(owners.get(e.name) ?? []), p.name]);
    }
  }
  const plugins = new Set(entries.map((p) => p.name));
  const bad = [];
  for (const p of entries) {
    if (['computer-use', 'chromewhale', 'whalewiki', 'whalesong'].includes(p.name) || p.source === 'path:skills') continue;
    for (const f of walk(p.dir).filter((x) => /\.(md|toml)$/.test(x))) {
      for (const m of read(f).matchAll(/(?<![\w/.-])([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?![\w:/-])/g)) {
        const [, prefix, skill] = m;
        if (!owners.has(skill)) continue;
        if (!owners.get(skill).includes(prefix) && (plugins.has(prefix) || ['github', 'linear', 'vercel'].includes(prefix))) {
          bad.push(`${path.relative(ROOT, f)}: ${prefix}:${skill} (shipped by ${owners.get(skill).join(', ')})`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('install and review commands in a plugin README name the installed plugin id', () => {
  const bad = [];
  for (const p of entries) {
    const readme = path.join(p.dir, 'README.md');
    if (!fs.existsSync(readme) || p.source === 'path:skills') continue;
    for (const m of read(readme).matchAll(/\/plugin (?:show|trust|enable|disable|uninstall|update) ([a-z][a-z0-9-]*)/g)) {
      if (m[1] !== p.name && !['<name>', 'name'].includes(m[1]) && entries.some((e) => e.name === m[1]) === false && !/^[<]/.test(m[1])) bad.push(`${p.name}/README.md: /plugin ... ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the top-level README links every cataloged plugin', () => {
  const readme = read(path.join(ROOT, 'README.md'));
  const missing = entries.filter((p) => p.source !== 'path:skills' && !readme.includes(`${p.source.replace(/^path:/, '')}/`) && !readme.includes(`\`${p.name}\``)).map((p) => p.name);
  assert.deepEqual(missing, [], 'plugins missing from README.md');
});

test('plugins that only work on some systems say so in the catalog', () => {
  const byName = Object.fromEntries(entries.map((p) => [p.name, p]));
  assert.deepEqual(byName.loop.platforms, ['macos', 'linux']);
  assert.deepEqual(byName['computer-use'].platforms, ['macos']);
  assert.deepEqual(byName['hello-extension'].platforms, ['macos', 'linux']);
});

test('the domain skill plugins match the skills/ mirror pin', () => {
  const out = execFileSync(process.execPath, ['scripts/sync-skill-plugins.mjs', '--check'], {cwd: ROOT, encoding: 'utf8'});
  assert.match(out, /0 stale/);
});
