#!/usr/bin/env node
// Refresh the skills-* domain plugins from the skills/ mirror.
//
// `npm run sync:skills` rewrites skills/ from Core and pins a new commit and
// generation in skills/upstream.json. Each skills-* plugin ships byte-for-byte
// copies of some of those SKILL.md files and records the pin and a SHA-256 per
// file in its provenance.json. This script copies the current bytes over and
// rewrites provenance.json so the plugins cannot silently lag the mirror.
//
// It never adds or removes a skill from a plugin: the set of skills a plugin
// ships is the key set of its provenance.json. A skill that left the mirror is
// an error; remove it from the plugin by hand (and from its README) first.
//
// Usage: node scripts/sync-skill-plugins.mjs [--check]
//   --check   write nothing; exit 1 if any plugin differs from skills/
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const upstream = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/upstream.json'), 'utf8'));
const plugins = fs.readdirSync(path.join(ROOT, 'plugins')).filter((n) => n.startsWith('skills-') && fs.existsSync(path.join(ROOT, 'plugins', n, 'provenance.json'))).sort();
const problems = [];
let changed = 0;

for (const name of plugins) {
  const dir = path.join(ROOT, 'plugins', name);
  const file = path.join(dir, 'provenance.json');
  const prov = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = {...prov, repository: upstream.repository, commit: upstream.commit, generation: upstream.generation, skills: {}};
  let dirty = prov.repository !== upstream.repository || prov.commit !== upstream.commit || prov.generation !== upstream.generation;
  for (const skill of Object.keys(prov.skills)) {
    if (!upstream.skills.includes(skill)) { problems.push(`${name}: ${skill} is no longer an active mirrored skill`); continue; }
    const body = fs.readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'));
    const target = path.join(dir, 'skills', skill, 'SKILL.md');
    next.skills[skill] = sha(body);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(body)) {
      dirty = true;
      if (!check) { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, body); }
    }
  }
  if (dirty) {
    changed++;
    if (check) problems.push(`${name}: out of date with skills/ (run npm run sync:skills)`);
    else fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  }
}

if (problems.length) { for (const p of problems) console.error(`FAIL: ${p}`); process.exit(1); }
console.log(`skills-* plugins: ${plugins.length} checked, ${changed} ${check ? 'stale' : 'updated'}, pin ${upstream.commit.slice(0, 12)} generation ${upstream.generation}`);
