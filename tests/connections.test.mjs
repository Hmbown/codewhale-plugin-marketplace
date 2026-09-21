import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/connections.mjs', import.meta.url));
const syntheticKey = 'synthetic-baizhi-key-not-a-real-credential';

function run(t, args, extraEnv = {}) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'codewhale-connections-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  return execFileSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd: temp,
    env: { PATH: path.dirname(process.execPath), HOME: temp, ...extraEnv },
  });
}

test('Baizhi setup emits the documented remote endpoint and host-owned bearer source', t => {
  const output = run(t, ['show', 'baizhi'], { BAIZHI_API_KEY: syntheticKey });
  const json = output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1);
  const config = JSON.parse(json);
  assert.equal(config.servers.baizhi.url, 'https://agent-toolkit.app.baizhi.cloud/mcp');
  assert.equal(config.servers.baizhi.bearer_token_env_var, 'BAIZHI_API_KEY');
  assert.equal(config.servers.baizhi.headers, undefined);
  assert.ok(!output.includes(syntheticKey));
  assert.ok(!output.includes('mcp login'));
  assert.ok(output.includes('codewhale doctor'));
  assert.ok(!output.includes('codewhale mcp doctor'));
});

for (const [label, extraEnv, expected] of [
  ['missing', {}, 'missing'],
  ['present', { BAIZHI_API_KEY: syntheticKey }, 'present (not validated)'],
]) {
  test(`Baizhi doctor reports ${label} credentials without claiming service acceptance`, t => {
    const output = run(t, ['doctor', 'baizhi'], extraEnv);
    const status = JSON.parse(output);
    assert.equal(status.credential, expected);
    assert.equal(status.authenticated, false);
    assert.equal(status.tools_verified, false);
    assert.equal(status.status, 'documented');
    assert.ok(!output.includes(syntheticKey));
  });
}

const catalog = JSON.parse(readFileSync(new URL('../connections/catalog.json', import.meta.url), 'utf8'));
for (const connection of catalog.connections.filter(c => c.auth === 'bearer' && c.status === 'documented')) {
  test(`${connection.id} uses the native host bearer field, without a nested extension or secret`, t => {
    const output = run(t, ['show', connection.id], { [connection.env]: syntheticKey });
    const config = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
    assert.deepEqual(config, { servers: { [connection.id]: { url: connection.url, bearer_token_env_var: connection.env } } });
    assert.ok(!output.includes(syntheticKey));
  });
}

test('OAuth setup uses the released CLI command shape and the existing doctor command', t => {
  const output = run(t, ['show', 'linear']);
  assert.ok(output.includes('codewhale mcp add linear --url https://mcp.linear.app/mcp/readonly'));
  assert.ok(output.includes('codewhale doctor'));
  assert.ok(!output.includes('codewhale mcp doctor'));
});
