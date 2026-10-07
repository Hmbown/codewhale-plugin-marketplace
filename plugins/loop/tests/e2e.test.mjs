// End-to-end: the real Codewhale terminal UI, driven through a pseudo-terminal (tmux),
// with the loop plugin installed through the real /plugin trust flow and a local
// stand-in for the model provider. Opt-in because it needs a Codewhale binary and tmux:
//
//   LOOP_E2E=1 node --test plugins/loop/tests/e2e.test.mjs
//   CODEWHALE_BIN=/path/to/codewhale   (default: `codewhale` on PATH)
//
// Everything runs in a scratch CODEWHALE_HOME and HOME under /tmp (Unix socket paths
// are limited to ~104 bytes, so the scratch directory must be short). Nothing in the
// real ~/.codewhale is read or written, and no provider key or network is involved:
// the "model" is an in-process HTTP server that replies from a script and records
// every request, which is how the tests see exactly what each iteration was asked.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = process.env.CODEWHALE_BIN || 'codewhale';

function skipReason() {
  if (process.env.LOOP_E2E !== '1') return 'set LOOP_E2E=1 to run the terminal-UI test';
  for (const [cmd, args] of [['tmux', ['-V']], [BIN, ['--version']]]) {
    const r = spawnSync(cmd, args, {stdio: 'ignore'});
    if (r.error || r.status !== 0) return `${cmd} is not available`;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Scripted OpenAI-compatible chat server. `replies[i]` answers request i (the last one repeats).
async function fakeModel(replies, delayMs = 0) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, {'content-type': 'application/json'});
        return res.end(JSON.stringify({object: 'list', data: [{id: 'fake-model', object: 'model'}]}));
      }
      if (!req.url.endsWith('/chat/completions')) {
        res.writeHead(404);
        return res.end('{}');
      }
      const parsed = JSON.parse(body || '{}');
      const idx = requests.length;
      const last = [...parsed.messages].reverse().find((m) => m.role === 'user');
      const lastText = typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((b) => b.text ?? '').join('\n');
      requests.push(lastText.split('<turn_meta')[0].trim());
      const text = replies[Math.min(idx, replies.length - 1)];
      const base = {id: `c${idx}`, object: 'chat.completion.chunk', created: 1, model: 'fake-model'};
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const usage = {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15};
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
      send({...base, choices: [{index: 0, delta: {role: 'assistant', content: ''}, finish_reason: null}]});
      const parts = delayMs ? text.match(/.{1,6}/gs) : [text];
      let i = 0;
      const tick = setInterval(() => {
        if (res.destroyed || res.writableEnded) return clearInterval(tick);
        if (i < parts.length) return send({...base, choices: [{index: 0, delta: {content: parts[i++]}, finish_reason: null}]});
        clearInterval(tick);
        send({...base, choices: [{index: 0, delta: {}, finish_reason: 'stop'}], usage});
        res.write('data: [DONE]\n\n');
        res.end();
      }, delayMs || 0);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {port: server.address().port, requests, close: () => server.close()};
}

// A real Codewhale TUI in a tmux pane, scratch home, loop plugin installed and enabled.
async function session(name, model, {controlSocket = true} = {}) {
  const root = fs.mkdtempSync('/tmp/cwle-');
  const home = path.join(root, 'h');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(home, 'config.toml'), [
    'provider = "vllm"',
    'default_text_model = "fake-model"',
    'telemetry = false',
    '',
    '[providers.vllm]',
    `base_url = "http://127.0.0.1:${model.port}/v1"`,
    'model = "fake-model"',
    '',
    ...(controlSocket ? ['[control_socket]', 'enabled = true', ''] : []),
    '[hooks]',
    'enabled = true',
    '',
  ].join('\n'));
  const tmux = (...args) => execFileSync('tmux', args, {encoding: 'utf8'});
  const id = `${name}-${process.pid}`;
  tmux('new-session', '-d', '-s', id, '-x', '150', '-y', '45', '-c', ws,
    `env CODEWHALE_HOME=${home} HOME=${root} TERM=xterm-256color ${BIN}`);
  const api = {
    root, home, ws,
    screen: () => tmux('capture-pane', '-p', '-t', id),
    send(text) {
      tmux('send-keys', '-t', id, '-l', text);
      execFileSync('sleep', ['0.3']);
      tmux('send-keys', '-t', id, 'Enter');
    },
    key: (k) => tmux('send-keys', '-t', id, k),
    async until(label, pred, timeoutMs = 20000) {
      const stop = Date.now() + timeoutMs;
      for (;;) {
        const v = pred();
        if (v) return v;
        if (Date.now() > stop) throw new Error(`timed out waiting for ${label}\n${api.screen()}`);
        await sleep(250);
      }
    },
    state: () => {
      try { return JSON.parse(fs.readFileSync(path.join(ws, '.codewhale', 'loop', 'state.json'), 'utf8')); } catch { return null; }
    },
    stop() {
      try { tmux('kill-session', '-t', id); } catch { /* already gone */ }
      try { fs.chmodSync(root, 0o700); execFileSync('chmod', ['-R', 'u+w', root]); } catch { /* best effort */ }
      fs.rmSync(root, {recursive: true, force: true});
    },
  };
  await api.until('the TUI to start', () => api.screen().includes('fake-model'), 30000);
  // The real review-and-trust flow: install, read the tokens off `show`, trust them, enable, reload.
  api.send(`/plugin install ${PLUGIN}`);
  const hashes = await api.until('the plugin review', () => {
    const s = api.screen();
    const content = /Content hash: (\w{64})/.exec(s)?.[1];
    const capability = /Capability hash: (\w{64})/.exec(s)?.[1];
    return content && capability ? {content, capability} : null;
  });
  api.send(`/plugin trust loop ${hashes.content}.${hashes.capability}`);
  await api.until('trust', () => api.screen().includes("'loop': trusted"));
  api.send('/plugin enable loop');
  await api.until('enable', () => api.screen().includes("'loop': enabled"));
  api.send('/plugin reload');
  await sleep(2500);
  api.send('/hooks list');
  await api.until('both hooks to be listed', () => /loop-gate/.test(api.screen()) && /loop-turn-end/.test(api.screen()));
  return api;
}

const marker = (text) => /^\[loop \w+ (#\d+\/\d+|wrap-up)\]/.exec(text)?.[1] ?? text.slice(0, 40);

const reason = skipReason();

test('pty: a capped loop runs exactly --max iterations, then one wrap-up, then stops', {skip: reason ?? false}, async () => {
  const model = await fakeModel(['not done', 'still not done', 'nearly', 'Wrap-up: item X remains.']);
  const tui = await session('cap', model);
  try {
    tui.send('/loop make the build green --max 3 --until ALL_GREEN');
    await tui.until('the wrap-up turn', () => model.requests.length >= 4, 40000);
    await sleep(6000); // a runaway would show up as a fifth request
    assert.deepEqual(model.requests.map(marker), ['#1/3', '#2/3', '#3/3', 'wrap-up']);
    for (const r of model.requests) assert.doesNotMatch(r, /<<loop/, 'no internal marker reaches the model');
    const state = tui.state();
    assert.deepEqual([state.status, state.iteration, state.max], ['capped', 3, 3]);
  } finally { tui.stop(); model.close(); }
});

test('pty: the completion phrase stops the loop, and only on its own final line', {skip: reason ?? false}, async () => {
  const model = await fakeModel([
    'Working.',
    'Still working; I will print ALL_GREEN when the suite passes.',
    'All 12 tests pass.\n\nALL_GREEN',
    'MUST NOT BE REQUESTED BY THE LOOP',
  ]);
  const tui = await session('phrase', model);
  try {
    tui.send('/loop make npm test pass --max 8 --until ALL_GREEN');
    await tui.until('completion', () => tui.state()?.status === 'completed', 40000);
    await sleep(5000);
    assert.deepEqual(model.requests.map(marker), ['#1/8', '#2/8', '#3/8']);
    assert.equal(tui.state().iteration, 3);
  } finally { tui.stop(); model.close(); }
});

test('pty: /cancel-loop mid-run ends it cleanly, with no marker text left behind', {skip: reason ?? false}, async () => {
  const long = 'Working through the task step by step. '.repeat(6);
  const model = await fakeModel([long], 100);
  const tui = await session('cancel', model);
  try {
    tui.send('/loop keep improving things --max 20');
    await tui.until('the second iteration', () => model.requests.length >= 2, 40000);
    tui.send('/cancel-loop');
    await tui.until('cancellation', () => tui.state()?.status === 'cancelled', 40000);
    await tui.until('the acknowledgement turn', () => model.requests.some((r) => r.startsWith('[loop notice]')), 40000);
    await sleep(10000); // anything the loop wrongly kept going would show up in this window
    const iterations = model.requests.filter((r) => /^\[loop \w+ #\d+\//.test(r));
    const others = model.requests.filter((r) => !/^\[loop \w+ #\d+\//.test(r));
    const final = tui.state();
    assert.equal(final.status, 'cancelled');
    assert.deepEqual(iterations.map(marker), Array.from({length: final.iteration}, (_, i) => `#${i + 1}/20`), 'no iteration started after the cancel took effect');
    // The cancel is answered by a short notice turn. If the driver's continuation raced the
    // cancel it is answered by a second one; either way nothing else reaches the model.
    assert.ok(others.length >= 1 && others.length <= 2, `unexpected extra requests: ${JSON.stringify(others)}`);
    assert.match(others[0], /^\[loop notice\]\nThe loop was cancelled after iteration \d+ of at most 20/);
    for (const r of others) assert.match(r, /^\[loop notice\]\n/);
    assert.doesNotMatch(tui.screen(), /<<loop-/, 'neither the screen nor the composer holds a leaked marker');
  } finally { tui.stop(); model.close(); }
});

test('pty: Esc ends the loop', {skip: reason ?? false}, async () => {
  const long = 'Working through the task step by step. '.repeat(8);
  const model = await fakeModel([long], 120);
  const tui = await session('esc', model);
  try {
    tui.send('/loop keep improving things --max 20');
    await tui.until('the second iteration to be running', () => model.requests.length >= 2, 40000);
    tui.key('Escape');
    await tui.until('the loop to stop', () => tui.state()?.status === 'stopped', 20000);
    const seen = model.requests.length;
    await sleep(6000);
    assert.equal(model.requests.length, seen);
    assert.match(tui.state().reason, /interrupted/);
  } finally { tui.stop(); model.close(); }
});

test('pty: your own messages pass through untouched and do not count as iterations', {skip: reason ?? false}, async () => {
  const long = 'Working through the task step by step. '.repeat(5);
  const model = await fakeModel([long], 80);
  const tui = await session('chat', model);
  try {
    tui.send('hello, before any loop');
    await tui.until('the first reply', () => model.requests.length >= 1, 20000);
    tui.send('/loop keep going --max 3');
    await tui.until('iteration 1', () => model.requests.length >= 2, 20000);
    tui.send('also mention lint');
    await tui.until('the loop to finish', () => tui.state()?.status === 'capped', 60000);
    await sleep(4000);
    const iterations = model.requests.filter((r) => r.startsWith('[loop ') && !r.includes('wrap-up'));
    assert.deepEqual(iterations.map(marker), ['#1/3', '#2/3', '#3/3']);
    assert.ok(model.requests.includes('hello, before any loop'));
    assert.ok(model.requests.includes('also mention lint'));
  } finally { tui.stop(); model.close(); }
});

test('pty: without [control_socket] /loop explains and starts nothing', {skip: reason ?? false}, async () => {
  const model = await fakeModel(['ok']);
  const tui = await session('nosock', model, {controlSocket: false});
  try {
    tui.send('/loop do the thing --max 3');
    await tui.until('the notice to reach the model', () => model.requests.length >= 1, 20000);
    assert.match(model.requests[0], /^\[loop notice\]\nThe loop cannot start: no live Codewhale control socket/);
    assert.equal(tui.state(), null, 'no state was written');
    await sleep(3000);
    assert.equal(model.requests.length, 1);
  } finally { tui.stop(); model.close(); }
});

test('pty: editing the installed engine after trust is refused until it is reviewed again', {skip: reason ?? false}, async () => {
  const model = await fakeModel(['ok']);
  const tui = await session('tamper', model);
  try {
    const engine = path.join(tui.home, 'plugins', 'loop', 'scripts', 'loop.mjs');
    fs.chmodSync(engine, 0o644);
    fs.appendFileSync(engine, '\n// edited after review\n');
    tui.send('/loop anything --max 2');
    await tui.until('the denial', () => /was denied: Plugin bundle loop reviewed source changed after review/.test(tui.screen().replace(/\s+/g, ' ')));
    assert.equal(model.requests.length, 0, 'the model was never asked');
    assert.equal(tui.state(), null);
  } finally { tui.stop(); model.close(); }
});
