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
  assert.equal(m.name, 'github-workflow');
  assert.deepEqual(Object.keys(m).sort(), ['$schema', 'author', 'description', 'extensions', 'keywords', 'license', 'name', 'version']);
  assert.deepEqual(m.extensions['net.codewhale'].capabilities.network_hosts, ['api.githubcopilot.com']);
});

test('the only MCP server is the official credential-free-in-bundle remote with env-backed auth', () => {
  const servers = json('mcp.json').mcpServers;
  assert.deepEqual(Object.keys(servers), ['github']);
  const s = servers.github, cw = s.extensions['net.codewhale'];
  assert.equal(s.url, 'https://api.githubcopilot.com/mcp/');
  assert.equal(s.type, 'streamable-http');
  assert.equal(cw.bearer_token_env_var, 'GITHUB_PERSONAL_ACCESS_TOKEN');
  assert.ok(cw.disabled_tools.includes('merge_pull_request'));
  assert.equal(s.headers, undefined, 'literal headers are rejected by the host');
  assert.equal(s.oauth, undefined);
});

test('no file embeds a token-shaped credential', () => {
  const shapes = /(ghp_|gho_|ghu_|ghs_|github_pat_)[A-Za-z0-9_]{10,}/;
  const walk = (d) => fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(root)) assert.ok(!shapes.test(fs.readFileSync(f, 'utf8')), f);
});

for (const skill of ['pr-review', 'issue-triage']) {
  test(`${skill} skill forbids drive-by comments and unapproved writes`, () => {
    const body = text(`skills/${skill}/SKILL.md`);
    const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(body);
    assert.ok(fm, 'frontmatter');
    assert.equal(fm[1], skill);
    assert.match(body, /No drive-by comments/);
    assert.match(body, /exact (text|content)/i);
    assert.match(body, /untrusted data/);
  });
}

test('the read-only command never instructs a post', () => {
  const body = text('commands/pr.md');
  assert.match(body, /^---\ndescription: .+\nusage: .+\n---\n/);
  assert.match(body, /read-only/);
  assert.match(body, /Do not post/);
});
