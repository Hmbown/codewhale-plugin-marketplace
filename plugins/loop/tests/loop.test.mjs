// Tests for the loop plugin engine. They exercise the real hook boundary: the
// engine runs as the same `node loop.mjs gate|turn-end` process Codewhale spawns,
// reads the hook JSON from stdin, and talks to a fake control socket that speaks
// the real newline-framed JSON-RPC (`status` and `message`).
// What this does not prove: Codewhale itself delivering those hooks. That is the
// separate terminal-UI test in tests/e2e.test.mjs.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  DEFAULT_MAX, HARD_MAX, MAX_AGE_MS, STALE_MS, parseLoopArgs, readState, statePath, writeState,
  hasPhrase, iterationPrompt, gate, turnEnd, describe, STALLED_MS,
} from '../scripts/loop.mjs';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(PLUGIN, 'scripts', 'loop.mjs');
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

// ------------------------------------------------------------------ fixtures

// Unix socket paths are limited to ~104 bytes, so fixtures live under /tmp.
function sandbox() {
  const root = fs.mkdtempSync('/tmp/cwlt-');
  const home = path.join(root, 'h');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(path.join(home, 'sessions'), {recursive: true});
  fs.mkdirSync(ws);
  const env = {...process.env, CODEWHALE_HOME: home, LOOP_TRANSCRIPT_WAIT_MS: '400'};
  return {root, home, ws, env, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}

// A control socket server with the real wire shape. `received` records `message` texts.
async function fakeSocket(box, uuid = UUID_A, opts = {}) {
  const dir = path.join(box.home, 'sessions', uuid);
  fs.mkdirSync(dir, {recursive: true});
  const sock = path.join(dir, 'control.sock');
  const received = [];
  const server = net.createServer((c) => {
    let buf = '';
    c.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      const req = JSON.parse(buf.slice(0, i));
      let res;
      if (req.method === 'status') {
        res = {id: req.id, result: {type: 'status', turn_state: 'idle', goal: opts.goal ?? {objective: null, status: 'active', paused: false}}};
      } else if (req.method === 'message') {
        received.push(req.params.text);
        res = opts.refuseMessages
          ? {id: req.id, error: {code: 'command_error', message: 'refused'}}
          : {id: req.id, result: {type: 'message_sent', delivery: 'dispatched'}};
      }
      c.end(JSON.stringify(res) + '\n');
    });
    c.on('error', () => {});
  });
  await new Promise((r) => server.listen(sock, r));
  return {sock, uuid, received, close: () => new Promise((r) => server.close(r))};
}

// Session transcript as Codewhale persists it: messages with typed content blocks.
function transcript(box, uuid, ws, replies) {
  const messages = [];
  for (const [prompt, reply] of replies) {
    messages.push({role: 'user', content: [{type: 'text', text: prompt}, {type: 'text', text: '<turn_meta>x</turn_meta>'}]});
    if (reply !== null) messages.push({role: 'assistant', content: [{type: 'text', text: reply}]});
  }
  fs.writeFileSync(path.join(box.home, 'sessions', `${uuid}.json`), JSON.stringify({metadata: {id: uuid, workspace: ws}, messages}));
}

const SESSION = 'sess_aaaa1111';
const submit = (box, text, session = SESSION) => ({event: 'message_submit', text, session_id: session, workspace: box.ws});
const ended = (box, over = {}) => ({event: 'turn_end', session_id: SESSION, workspace: box.ws, model_backed: true, status: 'completed', ...over});
// What a person sees back: a notice rewritten into a model turn, or a block reason.
const said = (res) => {
  const body = JSON.parse(res.out);
  return body.reason ?? body.text;
};
const isNotice = (res) => res.code === 0 && JSON.parse(res.out).text?.startsWith('[loop notice]');
const isIgnored = (res) => isNotice(res) && said(res).includes('A queued loop request was ignored');
const startText = (args) => `<<loop-start>>\n${args}\n<<loop-end>>\n\nignored trailer`;

async function started(box, args = 'fix the tests --max 3 --until ALL_GREEN') {
  const res = await gate(submit(box, startText(args)), box.env);
  assert.equal(res.code, 0, res.out);
  return {state: readState(box.ws), prompt: JSON.parse(res.out).text};
}

// Run the engine as Codewhale would: a child process fed the payload on stdin.
function run(mode, payload, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENGINE, mode], {env, stdio: ['pipe', 'pipe', 'pipe']});
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({code, out, err}));
    child.stdin.end(JSON.stringify(payload));
  });
}

// ----------------------------------------------------------------- arguments

test('parseLoopArgs: defaults, flags in any position, quoting', () => {
  assert.deepEqual(parseLoopArgs('fix the build'), {prompt: 'fix the build', max: DEFAULT_MAX, until: null});
  assert.deepEqual(parseLoopArgs('fix it --max 5 --until DONE'), {prompt: 'fix it', max: 5, until: 'DONE'});
  assert.deepEqual(parseLoopArgs('--max=7 --until "ALL TESTS PASS" fix it'), {prompt: 'fix it', max: 7, until: 'ALL TESTS PASS'});
  assert.deepEqual(parseLoopArgs("run it --until 'x y'"), {prompt: 'run it', max: DEFAULT_MAX, until: 'x y'});
  assert.equal(parseLoopArgs('use npm test --silent --max 2').prompt, 'use npm test --silent');
});

test('parseLoopArgs: rejects what could weaken the cap or the phrase', () => {
  for (const bad of ['', '   ', '--max 3', 'x --max 0', `x --max ${HARD_MAX + 1}`, 'x --max abc', 'x --max -1', 'x --max 1.5',
    'x --max', 'x --until', 'x --until ""', 'x --until "a\nb"', `x --until ${'y'.repeat(201)}`, 'y'.repeat(8001)]) {
    assert.ok(parseLoopArgs(bad).error, `should reject ${JSON.stringify(bad.slice(0, 30))}`);
  }
  assert.equal(parseLoopArgs(`x --max ${HARD_MAX}`).max, HARD_MAX);
});

test('hasPhrase: whole line only, tolerant of emphasis, never a substring', () => {
  assert.equal(hasPhrase('did it\nALL_GREEN', 'ALL_GREEN'), true);
  assert.equal(hasPhrase('done\n**ALL_GREEN**\n', 'ALL_GREEN'), true);
  assert.equal(hasPhrase('done\r\nALL_GREEN  \r\n', 'ALL_GREEN'), true);
  assert.equal(hasPhrase('I will print ALL_GREEN when finished', 'ALL_GREEN'), false);
  assert.equal(hasPhrase('"ALL_GREEN" is the phrase I must not write yet', 'ALL_GREEN'), false);
  assert.equal(hasPhrase('NOT_ALL_GREEN', 'ALL_GREEN'), false);
});

// ---------------------------------------------------------------------- gate

test('gate: ordinary messages pass through without touching disk', async () => {
  const box = sandbox();
  try {
    for (const text of ['hello', '/review', '<<loop', 'talk about <<loop-start>> later', '<<loop-unknown>>', '']) {
      const res = await gate(submit(box, text), box.env);
      assert.deepEqual(res, {code: 0, out: ''}, text);
    }
    assert.equal(fs.existsSync(path.join(box.ws, '.codewhale')), false);
  } finally { box.cleanup(); }
});

test('gate: /loop writes state, keeps it out of git, and rewrites the message into the iteration prompt', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state, prompt} = await started(box);
    assert.equal(state.status, 'active');
    assert.equal(state.iteration, 1);
    assert.equal(state.max, 3);
    assert.equal(state.until, 'ALL_GREEN');
    assert.equal(state.owner_session, SESSION);
    assert.ok(prompt.startsWith(`[loop ${state.id} #1/3]`));
    assert.ok(prompt.includes('fix the tests'));
    assert.ok(prompt.includes('exactly: ALL_GREEN'));
    assert.ok(!prompt.includes('ignored trailer') && !prompt.includes('<<loop'));
    assert.equal(fs.statSync(statePath(box.ws)).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(box.ws, '.codewhale', 'loop', '.gitignore'), 'utf8'), '*\n');
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: /loop without --until says so in the prompt', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state, prompt} = await started(box, 'polish the docs --max 2');
    assert.equal(state.until, null);
    assert.ok(prompt.includes('no completion phrase'));
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: /loop refuses to start without a control socket, and says how to fix it', async () => {
  const box = sandbox();
  try {
    const res = await gate(submit(box, startText('do it')), box.env);
    assert.ok(isNotice(res), res.out);
    assert.match(said(res), /control_socket/);
    assert.equal(readState(box.ws), null);
  } finally { box.cleanup(); }
});

test('gate: /loop refuses while a native /goal is active, allows it when paused', async () => {
  const box = sandbox();
  const busy = await fakeSocket(box, UUID_A, {goal: {objective: 'ship it', status: 'active', paused: false}});
  try {
    const res = await gate(submit(box, startText('do it')), box.env);
    assert.ok(isNotice(res), res.out);
    assert.match(said(res), /\/goal/);
    assert.equal(readState(box.ws), null);
  } finally { await busy.close(); }
  const paused = await fakeSocket(box, UUID_A, {goal: {objective: 'ship it', status: 'active', paused: true}});
  try {
    const ok = await gate(submit(box, startText('do it')), box.env);
    assert.ok(!isNotice(ok) && readState(box.ws).status === 'active');
  } finally { await paused.close(); box.cleanup(); }
});

test('gate: a second /loop is refused while one is active, but replaces a stale or finished one', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const first = (await started(box, 'one --max 2')).state;
    const refused = await gate(submit(box, startText('two')), box.env);
    assert.ok(isNotice(refused));
    assert.match(said(refused), /cancel-loop/);
    assert.equal(readState(box.ws).id, first.id);

    const stale = readState(box.ws);
    stale.updated_at = new Date(Date.now() - STALE_MS - 1000).toISOString();
    fs.writeFileSync(statePath(box.ws), JSON.stringify(stale));
    const replaced = await gate(submit(box, startText('three')), box.env);
    assert.equal(replaced.code, 0);
    assert.notEqual(readState(box.ws).id, first.id);

    const cur = readState(box.ws);
    cur.status = 'completed';
    writeState(box.ws, cur);
    assert.equal((await gate(submit(box, startText('four')), box.env)).code, 0);
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: /cancel-loop cancels, and a continuation already in flight is then dropped', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box);
    const next = `<<loop-next:${state.id}:2>>`;
    const cancelled = await gate(submit(box, '<<loop-cancel>>'), box.env);
    assert.ok(isNotice(cancelled));
    assert.match(said(cancelled), /cancelled after iteration 1 of at most 3/i);
    assert.equal(readState(box.ws).status, 'cancelled');
    const late = await gate(submit(box, next), box.env);
    assert.ok(isIgnored(late), 'a queued continuation must not start a turn after cancel');
    assert.equal(readState(box.ws).iteration, 1);
    assert.match(said(await gate(submit(box, '<<loop-cancel>>'), box.env)), /Nothing to cancel/);
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: /loop-status relays the state in a short notice', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    assert.match(said(await gate(submit(box, '<<loop-status>>'), box.env)), /No loop has run/);
    await started(box);
    const res = await gate(submit(box, '<<loop-status>>'), box.env);
    assert.ok(isNotice(res));
    assert.match(said(res), /active: iteration 1 of at most 3/);
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: continuation counts exactly once, in order, for the owning session only', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box);
    const msg = (n, id = state.id) => `<<loop-next:${id}:${n}>>`;
    assert.ok(isIgnored((await gate(submit(box, msg(3)), box.env))), 'skipping ahead is dropped');
    assert.ok(isIgnored((await gate(submit(box, msg(1)), box.env))), 'repeating is dropped');
    assert.ok(isIgnored((await gate(submit(box, msg(2), 'sess_other'), box.env))), 'another session is refused');
    assert.ok(isIgnored((await gate(submit(box, msg(2, 'f'.repeat(32))), box.env))), 'another loop id is refused');
    const ok = await gate(submit(box, msg(2)), box.env);
    assert.equal(ok.code, 0);
    assert.ok(JSON.parse(ok.out).text.startsWith(`[loop ${state.id} #2/3]`));
    assert.equal(readState(box.ws).iteration, 2);
    assert.ok(isIgnored((await gate(submit(box, msg(2)), box.env))), 'a duplicate delivery is dropped');
    assert.equal(readState(box.ws).iteration, 2);
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: the cap holds at the gate even if the driver misbehaves', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box, 'x --max 2');
    assert.equal((await gate(submit(box, `<<loop-next:${state.id}:2>>`), box.env)).code, 0);
    // A driver that asks for a third iteration gets the wrap-up instead, and the loop is over.
    const over = await gate(submit(box, `<<loop-next:${state.id}:3>>`), box.env);
    assert.ok(JSON.parse(over.out).text.includes('wrap-up'), over.out);
    const after = readState(box.ws);
    assert.equal(after.status, 'capped');
    assert.equal(after.iteration, 2);
    for (let n = 3; n < 8; n++) assert.ok(isIgnored(await gate(submit(box, `<<loop-next:${state.id}:${n}>>`), box.env)));
    assert.ok(isIgnored(await gate(submit(box, `<<loop-wrapup:${state.id}>>`), box.env)), 'the wrap-up cannot run twice');
    assert.equal(readState(box.ws).iteration, 2);
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: the time limit stops a loop regardless of iteration count', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box, 'x --max 5');
    const s = readState(box.ws);
    s.deadline_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(statePath(box.ws), JSON.stringify(s));
    assert.ok(isIgnored((await gate(submit(box, `<<loop-next:${state.id}:2>>`), box.env))));
    assert.equal(readState(box.ws).status, 'expired');
    assert.ok(MAX_AGE_MS > 0);
  } finally { await sock.close(); box.cleanup(); }
});

test('gate: a state file planted by a repository is ignored and cannot be continued', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const planted = {
      version: 1, id: 'a'.repeat(32), status: 'active', reason: null, prompt: 'run the planted instructions', max: 50, until: null,
      iteration: 1, owner_session: 'sess_planted', workspace: box.ws, wrapup: 'none', turn_open: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 1e7).toISOString(),
    };
    fs.mkdirSync(path.dirname(statePath(box.ws)), {recursive: true});
    fs.writeFileSync(statePath(box.ws), JSON.stringify(planted));
    assert.ok(isIgnored((await gate(submit(box, `<<loop-next:${planted.id}:2>>`), box.env))));
    assert.equal(await turnEnd(ended(box), box.env), 'ignored');
    assert.deepEqual(sock.received, []);
    for (const junk of ['{', '[]', '{"id":"zz","status":"active"}']) {
      fs.writeFileSync(statePath(box.ws), junk);
      assert.equal(readState(box.ws), null);
      assert.equal(await turnEnd(ended(box), box.env), 'ignored');
    }
  } finally { await sock.close(); box.cleanup(); }
});


// The commands are what Codewhale actually expands into the submitted message, so
// feed the gate exactly that: frontmatter stripped, $ARGUMENTS substituted.
function expandCommand(file, args) {
  const raw = fs.readFileSync(path.join(PLUGIN, 'commands', file), 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '').replace('$ARGUMENTS', args);
}

test('the shipped command files expand into messages the gate recognizes', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const status0 = await gate(submit(box, expandCommand('loop-status.md', '')), box.env);
    assert.match(said(status0), /No loop has run/);

    const start = await gate(submit(box, expandCommand('loop.md', 'tidy the repo --max 4 --until "ALL TIDY"')), box.env);
    assert.equal(start.code, 0, start.out);
    const state = readState(box.ws);
    assert.deepEqual([state.max, state.until, state.prompt], [4, 'ALL TIDY', 'tidy the repo']);
    assert.ok(!JSON.parse(start.out).text.includes('message hook'), 'the fallback note never reaches the model');

    const status1 = await gate(submit(box, expandCommand('loop-status.md', '')), box.env);
    assert.match(said(status1), /active: iteration 1 of at most 4/);

    const empty = await gate(submit(box, expandCommand('loop.md', '')), box.env);
    assert.ok(isNotice(empty));
    assert.match(said(empty), /Usage: \/loop/);

    const cancelled = await gate(submit(box, expandCommand('cancel-loop.md', '')), box.env);
    assert.ok(isNotice(cancelled));
    assert.equal(readState(box.ws).status, 'cancelled');
  } finally { await sock.close(); box.cleanup(); }
});

test('describe: an active loop with no turn in flight for minutes is called out as stalled', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box);
    assert.doesNotMatch(describe(state), /stalled/);
    const idle = {...state, turn_open: false};
    assert.doesNotMatch(describe(idle, Date.now()), /stalled/, 'seconds between turns is normal');
    assert.match(describe(idle, Date.now() + STALLED_MS + 1000), /may have stalled/);
    assert.doesNotMatch(describe({...state, turn_open: true}, Date.now() + STALLED_MS * 10), /stalled/, 'a long turn is not a stall');
  } finally { await sock.close(); box.cleanup(); }
});

test('state directory: a symlinked .codewhale/loop planted by a repository is refused', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const elsewhere = path.join(box.root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.join(box.ws, '.codewhale'));
    fs.symlinkSync(elsewhere, path.join(box.ws, '.codewhale', 'loop'));
    const res = await gate(submit(box, startText('x')), box.env);
    assert.ok(isNotice(res));
    assert.match(said(res), /symlink/);
    assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing was written through the link');
  } finally { await sock.close(); box.cleanup(); }
});

// ------------------------------------------------------------------ turn end

test('turn-end: asks for the next iteration over the control socket', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box, 'x --max 3');
    assert.equal(await turnEnd(ended(box), box.env), 'continued');
    assert.deepEqual(sock.received, [`<<loop-next:${state.id}:2>>`]);
    assert.equal(readState(box.ws).iteration, 1, 'only the gate counts iterations');
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: ignores other sessions, no loop, finished loops and non-model turns', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    assert.equal(await turnEnd(ended(box), box.env), 'ignored');
    await started(box, 'x --max 3');
    assert.equal(await turnEnd(ended(box, {session_id: 'sess_other'}), box.env), 'ignored');
    assert.equal(await turnEnd(ended(box, {model_backed: false}), box.env), 'ignored');
    await gate(submit(box, '<<loop-cancel>>'), box.env);
    assert.equal(await turnEnd(ended(box), box.env), 'ignored');
    assert.deepEqual(sock.received, []);
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: only a turn the loop started counts, and a duplicate event sends nothing twice', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box, 'x --max 5');
    assert.equal(state.turn_open, true);
    assert.equal(await turnEnd(ended(box), box.env), 'continued');
    assert.equal(readState(box.ws).turn_open, false);
    assert.equal(await turnEnd(ended(box), box.env), 'ignored', 'the same turn ending twice');
    assert.equal(sock.received.length, 1);

    // The turn started by the continuation reopens it ...
    await gate(submit(box, sock.received[0]), box.env);
    assert.equal(readState(box.ws).turn_open, true);
    // ... but a status reply in between is a foreign turn: claim it first and it is ignored.
    await turnEnd(ended(box), box.env);
    await gate(submit(box, '<<loop-status>>'), box.env);
    assert.equal(await turnEnd(ended(box), box.env), 'ignored', 'the status reply is not an iteration');
    assert.equal(sock.received.length, 2);
    assert.equal(readState(box.ws).status, 'active');
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: a continuation that lost a race with /cancel-loop is not sent', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box, 'x --max 5 --until DONE');
    transcript(box, UUID_A, box.ws, [[iterationPrompt(state), 'working']]);
    // Cancel lands while the driver is still reading the transcript.
    const driver = turnEnd(ended(box), box.env);
    await gate(submit(box, '<<loop-cancel>>'), box.env);
    await driver;
    assert.equal(readState(box.ws).status, 'cancelled');
    assert.deepEqual(sock.received, []);
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: a failed or interrupted turn ends the loop (Esc cancels it)', async () => {
  for (const status of ['failed', 'interrupted']) {
    const box = sandbox();
    const sock = await fakeSocket(box);
    try {
      await started(box, 'x --max 3');
      assert.equal(await turnEnd(ended(box, {status}), box.env), 'stopped');
      const s = readState(box.ws);
      assert.equal(s.status, 'stopped');
      assert.match(s.reason, new RegExp(status));
      assert.deepEqual(sock.received, []);
    } finally { await sock.close(); box.cleanup(); }
  }
});

test('turn-end: the completion phrase on its own line stops the loop', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state, prompt} = await started(box);
    transcript(box, UUID_A, box.ws, [[prompt, 'Fixed everything.\nAll 12 tests pass.\n\nALL_GREEN']]);
    assert.equal(await turnEnd(ended(box), box.env), 'completed');
    assert.equal(readState(box.ws).status, 'completed');
    assert.deepEqual(sock.received, []);
    assert.equal(state.iteration, 1);
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: the phrase quoted in passing, or in an earlier iteration, does not stop the loop', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state, prompt} = await started(box);
    const second = prompt.replace('#1/3', '#2/3');
    transcript(box, UUID_A, box.ws, [
      [prompt, 'All done.\nALL_GREEN'], // iteration 1 said it (and was wrongly not stopped in this fixture)
      [second, 'Still working. I will say ALL_GREEN once the suite passes.'],
    ]);
    const s = readState(box.ws);
    s.iteration = 2;
    fs.writeFileSync(statePath(box.ws), JSON.stringify(s));
    assert.equal(await turnEnd(ended(box), box.env), 'continued');
    assert.deepEqual(sock.received, [`<<loop-next:${state.id}:3>>`]);
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: with --until, an unreadable transcript fails closed instead of looping blind', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    await started(box);
    assert.equal(await turnEnd(ended(box), box.env), 'error');
    const s = readState(box.ws);
    assert.equal(s.status, 'error');
    assert.match(s.reason, /transcript/);
    assert.deepEqual(sock.received, []);
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: without --until the transcript is not needed', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    await started(box, 'x --max 3');
    assert.equal(await turnEnd(ended(box), box.env), 'continued');
  } finally { await sock.close(); box.cleanup(); }
});

test('turn-end: a missing control socket or a refused message stops the loop with a reason', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  await started(box, 'x --max 3');
  await sock.close();
  fs.rmSync(path.dirname(sock.sock), {recursive: true});
  try {
    assert.equal(await turnEnd(ended(box), box.env), 'error');
    assert.match(readState(box.ws).reason, /control socket/);
  } finally { box.cleanup(); }

  const box2 = sandbox();
  const refusing = await fakeSocket(box2, UUID_A, {refuseMessages: true});
  try {
    await started(box2, 'x --max 3');
    assert.equal(await turnEnd(ended(box2), box2.env), 'error');
    assert.match(readState(box2.ws).reason, /refused/);
  } finally { await refusing.close(); box2.cleanup(); }
});

// ---------------------------------------------- whole loop, hook by hook, capped

test('a whole loop: runs exactly --max iterations, wraps up once, then every later event is inert', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const turns = []; // what the "model" was asked, in order
    let res = await gate(submit(box, startText('improve it --max 3 --until FINISHED')), box.env);
    turns.push(JSON.parse(res.out).text);
    for (let guard = 0; guard < 20; guard++) {
      const id = readState(box.ws).id;
      transcript(box, UUID_A, box.ws, turns.map((t) => [t, 'worked, not done']));
      const outcome = await turnEnd(ended(box), box.env);
      const asked = sock.received.at(-1);
      if (outcome === 'continued') {
        res = await gate(submit(box, asked), box.env); // Codewhale routes the socket message through the gate
        assert.equal(res.code, 0);
        turns.push(JSON.parse(res.out).text);
      } else {
        assert.equal(outcome, 'capped');
        assert.equal(asked, `<<loop-wrapup:${id}>>`);
        res = await gate(submit(box, asked), box.env);
        turns.push(JSON.parse(res.out).text);
        break;
      }
    }
    assert.equal(turns.length, 4, '3 iterations plus the wrap-up turn');
    assert.deepEqual(turns.slice(0, 3).map((t) => t.split('\n')[0].replace(/^\[loop \w+ /, '')), ['#1/3]', '#2/3]', '#3/3]']);
    assert.ok(turns[3].includes('wrap-up') && turns[3].includes('limit of 3'));
    const final = readState(box.ws);
    assert.equal(final.status, 'capped');
    assert.equal(final.iteration, 3);
    // Nothing more can happen: not another wrap-up, not another iteration, not a stray turn end.
    assert.ok(isIgnored((await gate(submit(box, `<<loop-wrapup:${final.id}>>`), box.env))));
    assert.ok(isIgnored((await gate(submit(box, `<<loop-next:${final.id}:4>>`), box.env))));
    const before = sock.received.length;
    assert.equal(await turnEnd(ended(box), box.env), 'ignored');
    assert.equal(sock.received.length, before);
  } finally { await sock.close(); box.cleanup(); }
});

test('a whole loop: stops early on the phrase before the cap', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const turns = [JSON.parse((await gate(submit(box, startText('go --max 9 --until FINISHED')), box.env)).out).text];
    transcript(box, UUID_A, box.ws, [[turns[0], 'not yet']]);
    assert.equal(await turnEnd(ended(box), box.env), 'continued');
    turns.push(JSON.parse((await gate(submit(box, sock.received.at(-1)), box.env)).out).text);
    transcript(box, UUID_A, box.ws, [[turns[0], 'not yet'], [turns[1], 'done at last\nFINISHED']]);
    assert.equal(await turnEnd(ended(box), box.env), 'completed');
    assert.equal(readState(box.ws).status, 'completed');
    assert.equal(sock.received.length, 1);
  } finally { await sock.close(); box.cleanup(); }
});

// ------------------------------------------------------- hook process contract

test('cli gate: exit codes and stdout follow the message_submit contract', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const plain = await run('gate', submit(box, 'hello there'), box.env);
    assert.deepEqual([plain.code, plain.out], [0, '']);
    const bad = await run('gate', submit(box, startText('x --max 99')), box.env);
    assert.equal(bad.code, 0);
    assert.match(said(bad), /between 1 and 50/);
    const good = await run('gate', submit(box, startText('x --max 2')), box.env);
    assert.equal(good.code, 0);
    assert.match(JSON.parse(good.out).text, /^\[loop [0-9a-f]{32} #1\/2\]/);
    const garbage = spawn(process.execPath, [ENGINE, 'gate'], {env: box.env, stdio: ['pipe', 'pipe', 'pipe']});
    garbage.stdin.end('not json');
    assert.equal(await new Promise((r) => garbage.on('close', r)), 0, 'unreadable input must never block a message');
  } finally { await sock.close(); box.cleanup(); }
});

test('cli: concurrent hook processes cannot advance the same iteration twice', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const {state} = await started(box, 'x --max 5');
    const results = await Promise.all(Array.from({length: 8}, () => run('gate', submit(box, `<<loop-next:${state.id}:2>>`), box.env)));
    const advanced = results.filter((r) => JSON.parse(r.out).text.startsWith(`[loop ${state.id} #2/5]`));
    assert.equal(advanced.length, 1, 'exactly one process advanced the iteration');
    assert.equal(results.filter((r) => r.code === 0 && JSON.parse(r.out).text.startsWith('[loop notice]')).length, 7, 'the rest were ignored');
    assert.equal(readState(box.ws).iteration, 2);
    assert.equal(fs.existsSync(path.join(box.ws, '.codewhale', 'loop', '.lock')), false, 'lock released');
  } finally { await sock.close(); box.cleanup(); }
});

test('cli turn-end: runs from a symlinked install path', async () => {
  const box = sandbox();
  const sock = await fakeSocket(box);
  try {
    const link = path.join(box.root, 'plugin-link');
    fs.symlinkSync(PLUGIN, link);
    await started(box, 'x --max 3');
    const res = await new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join(link, 'scripts', 'loop.mjs'), 'turn-end'], {env: box.env, stdio: ['pipe', 'pipe', 'pipe']});
      let err = '';
      c.stderr.on('data', (d) => (err += d));
      c.on('close', (code) => resolve({code, err}));
      c.stdin.end(JSON.stringify(ended(box)));
    });
    assert.match(res.err, /loop: continued/);
    assert.equal(sock.received.length, 1);
  } finally { await sock.close(); box.cleanup(); }
});

test('socket choice: the session whose socket my parent process owns wins an otherwise ambiguous workspace', async (t) => {
  try { execFileSync('lsof', ['-v'], {stdio: 'ignore'}); } catch { try { execFileSync('lsof', ['-h'], {stdio: 'ignore'}); } catch { return t.skip('lsof is not installed'); } }
  const box = sandbox();
  const mine = await fakeSocket(box, UUID_A);
  // A second live session for the same workspace, served by an unrelated process.
  const otherDir = path.join(box.home, 'sessions', UUID_B);
  fs.mkdirSync(otherDir, {recursive: true});
  const helper = spawn(process.execPath, ['-e', `
    const net = require('node:net');
    net.createServer((c) => { c.on('data', () => c.end(JSON.stringify({id:'1',result:{type:'status',turn_state:'idle',goal:{objective:null,status:'active',paused:false}}}) + '\\n')); })
      .listen(${JSON.stringify(path.join(otherDir, 'control.sock'))}, () => console.log('up'));
    setInterval(() => {}, 1000);`], {stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((r) => helper.stdout.once('data', r));
  try {
    transcript(box, UUID_A, box.ws, []);
    transcript(box, UUID_B, box.ws, []);
    const res = await run('gate', submit(box, startText('x --max 2')), box.env);
    assert.equal(res.code, 0, res.out);
    assert.ok(!isNotice(res), 'it found exactly one socket to drive');
    assert.equal(readState(box.ws).status, 'active');
  } finally { helper.kill(); await mine.close(); box.cleanup(); }
});

test('socket choice: sessions of other workspaces are never driven, and ambiguity refuses', async () => {
  const box = sandbox();
  const elsewhere = await fakeSocket(box, UUID_B);
  try {
    transcript(box, UUID_B, '/somewhere/else', []);
    const res = await gate(submit(box, startText('x')), box.env);
    assert.ok(isNotice(res), 'the only live session belongs to another workspace');
    assert.match(said(res), /cannot start/);
    assert.equal(readState(box.ws), null);
  } finally { await elsewhere.close(); box.cleanup(); }
});

// --------------------------------------------------------- packaging contract

test('hook commands locate the installed engine and are inert when it is missing', async () => {
  const toml = fs.readFileSync(path.join(PLUGIN, 'hooks', 'loop.toml'), 'utf8');
  const commands = [...toml.matchAll(/command = '''\n([\s\S]*?)'''/g)].map((m) => m[1]);
  assert.equal(commands.length, 2);
  const events = [...toml.matchAll(/event = "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(events, ['message_submit', 'turn_end']);

  const box = sandbox();
  try {
    const empty = path.join(box.root, 'empty-home');
    fs.mkdirSync(empty);
    const none = await new Promise((resolve) => {
      const c = spawn('sh', ['-c', commands[0]], {env: {...process.env, CODEWHALE_HOME: empty, HOME: empty}, stdio: ['pipe', 'pipe', 'pipe']});
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('close', (code) => resolve({code, out}));
      c.stdin.end('{}');
    });
    assert.deepEqual(none, {code: 0, out: ''});

    fs.mkdirSync(path.join(empty, 'plugins'));
    fs.symlinkSync(PLUGIN, path.join(empty, 'plugins', 'loop'));
    const found = await new Promise((resolve) => {
      const c = spawn('sh', ['-c', commands[0]], {env: {...process.env, CODEWHALE_HOME: empty, HOME: empty}, stdio: ['pipe', 'pipe', 'pipe']});
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('close', (code) => resolve({code, out}));
      c.stdin.end(JSON.stringify(submit(box, startText('x'))));
    });
    assert.equal(found.code, 0);
    assert.match(said(found), /control_socket/, 'the engine ran (no control socket in this home, so /loop is refused)');
  } finally { box.cleanup(); }
});

test('bundle: manifest, commands and skill are consistent', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'loop');
  const ext = manifest.extensions['net.codewhale'];
  for (const key of ['commands', 'skills', 'hooks']) assert.ok(fs.existsSync(path.join(PLUGIN, ext[key].path)), key);
  assert.deepEqual(ext.when.os, ['macos', 'linux'], 'control sockets are unix-only');

  // A command `description` becomes the session's native /goal objective in Codewhale,
  // which starts a second, unbounded continuation loop. These commands must not set one.
  const commandFiles = fs.readdirSync(path.join(PLUGIN, 'commands')).sort();
  assert.deepEqual(commandFiles, ['cancel-loop.md', 'loop-status.md', 'loop.md']);
  for (const file of commandFiles) {
    const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(PLUGIN, 'commands', file), 'utf8'))?.[1];
    assert.ok(front, `${file} has frontmatter`);
    assert.doesNotMatch(front, /^description\s*:/m, `${file} must not set a description (it would start a native goal)`);
  }

  const skill = fs.readFileSync(path.join(PLUGIN, 'skills', 'iterate-until-done', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: iterate-until-done\ndescription: \S/);
  assert.ok(fs.existsSync(path.join(PLUGIN, 'LICENSE')) && fs.existsSync(path.join(PLUGIN, 'README.md')));
});

test('the largest prompt stays under the host message limit', () => {
  const s = {id: 'a'.repeat(32), iteration: 50, max: 50, prompt: 'p'.repeat(8000), until: 'u'.repeat(200)};
  assert.ok(iterationPrompt(s).length < 32000);
});
