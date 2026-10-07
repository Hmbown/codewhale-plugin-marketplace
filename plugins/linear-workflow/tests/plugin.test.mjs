import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const text = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('manifest is a closed Agent Plugins document with a matching network host', () => {
  const m = json('plugin.json');
  assert.equal(m.name, 'linear-workflow');
  assert.deepEqual(Object.keys(m).sort(), ['$schema', 'author', 'description', 'extensions', 'keywords', 'license', 'name', 'version']);
  assert.deepEqual(m.extensions['net.codewhale'].capabilities.network_hosts, ['mcp.linear.app']);
});

test('the only MCP server is the official remote with env-backed auth and no delete tools', () => {
  const servers = json('mcp.json').mcpServers;
  assert.deepEqual(Object.keys(servers), ['linear']);
  const s = servers.linear, cw = s.extensions['net.codewhale'];
  assert.equal(s.url, 'https://mcp.linear.app/mcp');
  assert.equal(s.type, 'streamable-http');
  assert.equal(cw.bearer_token_env_var, 'LINEAR_API_KEY');
  for (const t of ['delete_comment', 'delete_attachment', 'delete_status_update']) assert.ok(cw.disabled_tools.includes(t), t);
  assert.equal(s.headers, undefined);
  assert.equal(s.oauth, undefined);
});

test('no file embeds a Linear key', () => {
  const walk = (d) => fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(root)) assert.ok(!/lin_(api|oauth)_[A-Za-z0-9]{10,}/.test(fs.readFileSync(f, 'utf8')), f);
});

for (const skill of ['issue-triage', 'status-update']) {
  test(`${skill} skill requires approval before shared writes`, () => {
    const body = text(`skills/${skill}/SKILL.md`);
    const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(body);
    assert.ok(fm, 'frontmatter');
    assert.equal(fm[1], skill);
    assert.match(body, /untrusted data/);
    assert.match(body, /public/i);
  });
}

test('claim workflow refuses to take another person\'s issue', () => {
  const body = text('skills/issue-triage/SKILL.md');
  assert.match(body, /assigned to someone else/);
  assert.match(body, /Never overwrite someone else's work/);
});

test('command has usage metadata and names both skills', () => {
  const body = text('commands/linear.md');
  assert.match(body, /^---\ndescription: .+\nusage: .+\n---\n/);
  assert.match(body, /linear-workflow:issue-triage/);
  assert.match(body, /linear-workflow:status-update/);
});
