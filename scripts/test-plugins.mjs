#!/usr/bin/env node
// Run every plugin's own tests: plugins/<name>/tests/*.test.mjs, found by
// discovery so a new plugin cannot ship tests that npm test never runs.
//
// Plugins that have their own npm script (they need dependencies, fixtures or a
// different runner) are listed in OWNED_ELSEWHERE; a plugin with tests that is
// in neither place fails the run rather than being skipped.
//
// Opt-in suites (need tmux, a Codewhale binary, or the npm registry) stay
// skipped unless their variable is set:
//   LOOP_E2E=1   plugins/loop   real Codewhale TUI through tmux
//   WAB_E2E=1    plugins/web-artifacts-builder   npm install + vite build
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNED_ELSEWHERE = new Map([
  ['computer-use', 'npm run test:computer-use'],
  ['chromewhale', 'npm run test:chromewhale'],
  ['whalewiki', 'npm run test:whalewiki'],
]);

const files = [];
const plugins = [];
for (const entry of fs.readdirSync(path.join(ROOT, 'plugins'), {withFileTypes: true}).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  if (OWNED_ELSEWHERE.has(entry.name)) continue;
  const tests = path.join(ROOT, 'plugins', entry.name, 'tests');
  if (!fs.existsSync(tests)) continue;
  const found = fs.readdirSync(tests).filter((f) => f.endsWith('.test.mjs')).sort();
  if (!found.length) continue;
  plugins.push(entry.name);
  for (const f of found) files.push(path.join('plugins', entry.name, 'tests', f));
}
if (!files.length) { console.error('FAIL: no plugin tests found under plugins/*/tests'); process.exit(1); }
console.log(`plugin tests: ${plugins.length} plugins, ${files.length} files (${plugins.join(', ')})`);
const run = spawnSync(process.execPath, ['--test', ...files], {cwd: ROOT, stdio: 'inherit'});
process.exit(run.status ?? 1);
