// Checks this domain plugin against its own manifest and, when it sits inside
// the marketplace checkout, against the skills/ mirror it was copied from.
// Run: node --test plugins/<name>/tests/*.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
const prov = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8'));
const onDisk = fs.readdirSync(path.join(dir, 'skills'), {withFileTypes: true}).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const mirror = path.resolve(dir, '../../skills');
const inCheckout = fs.existsSync(path.join(mirror, 'upstream.json'));

test('manifest identifies the plugin and its skills root', () => {
  assert.equal(manifest.name, path.basename(dir));
  assert.equal(manifest.extensions['net.codewhale'].skills.path, 'skills');
  assert.ok(fs.existsSync(path.join(dir, 'LICENSE')) && fs.existsSync(path.join(dir, 'README.md')));
  assert.equal(manifest.license, 'MIT');
});
test('shipped skills equal the provenance list, with valid frontmatter and matching hashes', () => {
  assert.deepEqual(onDisk, Object.keys(prov.skills).sort());
  assert.ok(onDisk.length > 0);
  for (const name of onDisk) {
    const body = fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'));
    assert.equal(sha(body), prov.skills[name], `${name} differs from provenance.json`);
    const fm = /^---\n([\s\S]*?)\n---/.exec(body.toString('utf8'))?.[1] ?? '';
    assert.equal(/^name:[ \t]*(.+)$/m.exec(fm)?.[1].trim(), name);
    assert.ok(/^description:[ \t]*\S/m.test(fm), `${name} lacks a description`);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'skills', name)), ['SKILL.md'], `${name} has unexpected files`);
  }
});
test('no MCP, hooks, commands or network capability are declared', () => {
  const cw = manifest.extensions['net.codewhale'];
  for (const key of ['hooks', 'commands', 'agents', 'capabilities']) assert.equal(cw[key], undefined, key);
  assert.equal(fs.existsSync(path.join(dir, 'mcp.json')), false);
});
test('copies are byte-identical to the skills/ mirror at the recorded revision', {skip: !inCheckout && 'not inside the marketplace checkout'}, () => {
  const up = JSON.parse(fs.readFileSync(path.join(mirror, 'upstream.json'), 'utf8'));
  assert.equal(prov.commit, up.commit, 'skills/ was re-synced; refresh this plugin from skills/ and provenance.json');
  assert.equal(prov.generation, up.generation);
  for (const name of onDisk) {
    assert.ok(up.skills.includes(name), `${name} is no longer an active mirrored skill`);
    assert.ok(fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md')).equals(fs.readFileSync(path.join(mirror, name, 'SKILL.md'))), `${name} drifted from skills/${name}`);
  }
});
test('no skill is shipped by two skills-* domain plugins', {skip: !inCheckout && 'not inside the marketplace checkout'}, () => {
  const siblings = fs.readdirSync(path.dirname(dir)).filter((n) => n.startsWith('skills-') && n !== path.basename(dir));
  for (const sib of siblings) {
    const other = path.join(path.dirname(dir), sib, 'skills');
    if (!fs.existsSync(other)) continue;
    for (const name of fs.readdirSync(other)) assert.ok(!onDisk.includes(name), `${name} is in both ${path.basename(dir)} and ${sib}`);
  }
});
