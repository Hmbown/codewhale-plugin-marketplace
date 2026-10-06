#!/usr/bin/env node
// Engine for the Codewhale `loop` plugin. Two hook entry points:
//
//   loop.mjs gate      message_submit hook. Owns /loop, /cancel-loop, /loop-status
//                      and every continuation message. Everything else passes through.
//   loop.mjs turn-end  turn_end hook. After a finished turn it either stops the loop
//                      or asks the same session for the next iteration.
//
// Codewhale hooks cannot make a turn start by themselves (turn_end is an observer),
// so the next iteration is requested over the session's own control socket
// ([control_socket] enabled = true), the supported "supervised operation" surface.
// The request is a bare marker message; the gate is the only place an iteration is
// counted, capped and rewritten into a real prompt, so no hook race or duplicate
// event can run past the cap.
//
// State lives in <workspace>/.codewhale/loop/state.json. Node built-ins only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const DEFAULT_MAX = 10;
export const HARD_MAX = 50; // ceiling for --max; the cap cannot be configured past this
export const MAX_AGE_MS = 6 * 3600e3; // a loop never outlives this, whatever its iteration count
export const STALE_MS = 2 * 3600e3; // an "active" loop untouched this long is abandoned and may be replaced
export const MAX_PROMPT_CHARS = 8000;
export const MAX_UNTIL_CHARS = 200;

const STATUSES = new Set(['active', 'completed', 'cancelled', 'capped', 'stopped', 'error', 'expired']);
const START = '<<loop-start>>';
const END = '<<loop-end>>';
const CANCEL = '<<loop-cancel>>';
const STATUS = '<<loop-status>>';
const NEXT = /^<<loop-next:([0-9a-f]{32}):(\d{1,3})>>$/;
const WRAPUP = /^<<loop-wrapup:([0-9a-f]{32})>>$/;

// ---------------------------------------------------------------- arguments

export function parseLoopArgs(raw) {
  let rest = String(raw ?? '');
  let max = DEFAULT_MAX;
  let until = null;
  const maxRe = /(^|\s)--max(?:=|\s+)(\S+)(?=\s|$)/;
  const untilRe = /(^|\s)--until(?:=|\s+)("[^"]*"|'[^']*'|\S+)(?=\s|$)/;
  const m = maxRe.exec(rest);
  if (m) {
    rest = rest.replace(maxRe, '$1');
    if (!/^\d+$/.test(m[2])) return {error: 'The --max value must be a whole number.'};
    max = Number(m[2]);
    if (max < 1 || max > HARD_MAX) return {error: `The --max value must be between 1 and ${HARD_MAX}.`};
  }
  const u = untilRe.exec(rest);
  if (u) {
    rest = rest.replace(untilRe, '$1');
    until = u[2].replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
    if (!until) return {error: 'The --until phrase is empty.'};
    if (/[\r\n]/.test(until)) return {error: 'The --until phrase must be a single line.'};
    if (until.length > MAX_UNTIL_CHARS) return {error: `The --until phrase is longer than ${MAX_UNTIL_CHARS} characters.`};
  }
  if (/(^|\s)--(max|until)(?=\s|=|$)/.test(rest)) return {error: 'A --max or --until flag is missing its value.'};
  const prompt = rest.trim();
  if (!prompt) return {error: 'Usage: /loop <prompt> [--max N] [--until <phrase>]'};
  if (prompt.length > MAX_PROMPT_CHARS) return {error: `The prompt is longer than ${MAX_PROMPT_CHARS} characters.`};
  return {prompt, max, until};
}

// -------------------------------------------------------------------- state

export function stateDir(workspace) {
  return path.join(workspace, '.codewhale', 'loop');
}
export function statePath(workspace) {
  return path.join(stateDir(workspace), 'state.json');
}

export function validState(s) {
  return Boolean(s) && typeof s === 'object'
    && /^[0-9a-f]{32}$/.test(s.id ?? '')
    && STATUSES.has(s.status)
    && Number.isInteger(s.max) && s.max >= 1 && s.max <= HARD_MAX
    && Number.isInteger(s.iteration) && s.iteration >= 0 && s.iteration <= s.max
    && typeof s.prompt === 'string'
    && (s.until === null || typeof s.until === 'string')
    && typeof s.owner_session === 'string'
    && typeof s.turn_open === 'boolean'
    && Number.isFinite(Date.parse(s.updated_at)) && Number.isFinite(Date.parse(s.deadline_at));
}

export function readState(workspace) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(workspace), 'utf8'));
    return validState(s) ? s : null;
  } catch {
    return null;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Two hook workers can run at once, so every read-modify-write holds a mkdir lock.
export function withLock(workspace, fn) {
  const dir = stateDir(workspace);
  // A repository could plant .codewhale/loop as a symlink to aim our writes elsewhere.
  for (const part of [path.join(workspace, '.codewhale'), dir]) {
    try {
      if (fs.lstatSync(part).isSymbolicLink()) throw new Error('the loop state directory is a symlink, so it was not used');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n'); // keeps loop state out of commits, itself included
  const lock = path.join(dir, '.lock');
  const until = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 15000) fs.rmdirSync(lock);
      } catch { /* raced with the holder */ }
      if (Date.now() > until) throw new Error('state lock busy');
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.rmdirSync(lock); } catch { /* already gone */ }
  }
}

export function writeState(workspace, state) {
  state.updated_at = new Date().toISOString();
  const file = statePath(workspace);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(tmp, file);
}

export function isStale(state, now = Date.now()) {
  return state.status === 'active' && now - Date.parse(state.updated_at) > STALE_MS;
}

export const STALLED_MS = 2 * 60e3; // between a finished turn and the next iteration is normally seconds

export function describe(state, now = Date.now()) {
  const goal = state.until ? `until the last line of a reply is "${state.until}"` : 'with no completion phrase';
  const base = `Loop ${state.id.slice(0, 8)} is ${state.status}: iteration ${state.iteration} of at most ${state.max}, ${goal}.`;
  const stalled = state.status === 'active' && !state.turn_open && now - Date.parse(state.updated_at) > STALLED_MS;
  const note = state.reason ?? (stalled ? 'No iteration has started for a while, so it may have stalled. /cancel-loop clears it.' : '');
  return note ? `${base} ${note}` : base;
}

// ------------------------------------------------------------------ prompts

export function iterationPrompt(s) {
  const lines = [
    `[loop ${s.id} #${s.iteration}/${s.max}]`,
    '',
    s.prompt,
    '',
    '---',
    `Loop rules (iteration ${s.iteration} of at most ${s.max}):`,
    '- Earlier iterations left their work in this workspace: files, git history, notes. Inspect that first and continue from where it stands instead of starting over.',
    '- Make real progress, then end your reply. The next iteration starts automatically after each reply until the loop ends.',
  ];
  if (s.until) {
    lines.push(
      `- When the task is completely done and verified, make the final line of your reply exactly: ${s.until}`,
      '  Write that line only when it is true. Never quote it, plan it or mention it otherwise.',
    );
  } else {
    lines.push('- This loop has no completion phrase. It ends after the iteration limit or when the user cancels it.');
  }
  lines.push('- If you are blocked and need the user, say so plainly and make no further changes.');
  return lines.join('\n');
}

export function wrapupPrompt(s) {
  return [
    `[loop ${s.id} wrap-up]`,
    '',
    `The loop reached its limit of ${s.max} iterations and stopped without the completion phrase appearing.`,
    'Do not start new work. Report in a few lines: what is finished, what remains, and the single best next step.',
    'The user can start another loop with /loop to continue.',
  ].join('\n');
}

// ------------------------------------------------------------ control socket

export function rpc(sockPath, method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(sockPath);
    let buf = '';
    const timer = setTimeout(() => { s.destroy(); reject(new Error('control socket timed out')); }, timeoutMs);
    s.on('connect', () => s.write(JSON.stringify({id: 'loop', method, params}) + '\n'));
    s.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      clearTimeout(timer);
      s.end();
      try { resolve(JSON.parse(buf.slice(0, i))); } catch (e) { reject(e); }
    });
    s.on('error', (e) => { clearTimeout(timer); reject(e); });
    s.on('close', () => { clearTimeout(timer); reject(new Error('control socket closed')); });
  });
}

export function sessionsDir(env = process.env) {
  const home = env.CODEWHALE_HOME && path.isAbsolute(env.CODEWHALE_HOME)
    ? env.CODEWHALE_HOME
    : path.join(os.homedir(), '.codewhale');
  return path.join(home, 'sessions');
}

function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function ancestorPids() {
  const pids = new Set();
  let pid = process.pid;
  for (let i = 0; i < 16 && pid > 1; i++) {
    pids.add(pid);
    try {
      pid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {encoding: 'utf8', timeout: 3000}).trim());
    } catch { break; }
    if (!Number.isInteger(pid)) break;
  }
  return pids;
}

// pid that owns each listening unix socket path, from `lsof` (best effort)
function socketOwners() {
  const out = execFileSync('lsof', ['-nP', '-U', '-Fpn'], {encoding: 'utf8', timeout: 8000, maxBuffer: 64 << 20});
  const owners = new Map();
  let pid = null;
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) {
      const name = line.slice(1);
      if (!owners.has(name)) owners.set(name, new Set());
      owners.get(name).add(pid);
    }
  }
  return owners;
}

// Find the control socket of the Codewhale session this hook belongs to.
// Sockets live at <sessions>/<uuid>/control.sock. The hook's session id is not the
// uuid, so narrow by workspace, then by "owned by one of my ancestor processes".
// Anything still ambiguous is an error, never a guess: the loop must not drive a
// different session.
export async function resolveSocket(workspace, env = process.env) {
  const dir = sessionsDir(env);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* no sessions dir */ }
  const alive = [];
  for (const name of names) {
    const sock = path.join(dir, name, 'control.sock');
    try {
      if (!fs.lstatSync(sock).isSocket()) continue;
      const res = await rpc(sock, 'status', {}, 1500);
      if (res?.result?.type === 'status') alive.push({uuid: name, sock, status: res.result});
    } catch { /* stale socket */ }
  }
  if (!alive.length) {
    throw new Error('no live Codewhale control socket was found. Set [control_socket] enabled = true in config.toml and restart Codewhale.');
  }
  const ws = real(workspace);
  for (const c of alive) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, `${c.uuid}.json`), 'utf8')).metadata;
      c.workspace = meta?.workspace ? real(meta.workspace) : null;
    } catch { c.workspace = null; }
  }
  let pool = alive.filter((c) => c.workspace === ws);
  if (!pool.length) pool = alive.filter((c) => c.workspace === null);
  if (pool.length > 1) {
    try {
      const ancestors = ancestorPids();
      const owners = socketOwners();
      const mine = pool.filter((c) => [c.sock, real(c.sock)].some((n) => [...(owners.get(n) ?? [])].some((p) => ancestors.has(p))));
      if (mine.length) pool = mine;
    } catch { /* lsof or ps unavailable */ }
  }
  if (pool.length !== 1) {
    throw new Error(pool.length ? 'several Codewhale sessions use this workspace and the right one could not be identified. Close the others.' : 'no Codewhale session for this workspace has a control socket.');
  }
  return {sock: pool[0].sock, uuid: pool[0].uuid, status: pool[0].status};
}

// ---------------------------------------------------------------- transcript

function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

// Final reply of the iteration whose prompt carries `marker`, or null if the
// transcript does not hold it (yet).
export function finalReply(sessionFile, marker) {
  let messages;
  try { messages = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).messages; } catch { return null; }
  if (!Array.isArray(messages)) return null;
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && textOf(messages[i]).includes(marker)) { start = i; break; }
  }
  if (start < 0) return null;
  for (let i = messages.length - 1; i > start; i--) {
    if (messages[i]?.role === 'assistant') {
      const t = textOf(messages[i]);
      if (t.trim()) return t;
    }
  }
  return null;
}

const strip = (s) => s.trim().replace(/^[`*_>\s]+|[`*_\s]+$/g, '');

export function hasPhrase(reply, phrase) {
  const want = phrase.trim();
  const last = reply.trimEnd().split(/\r?\n/).at(-1) ?? '';
  return last.trim() === want || strip(last) === want;
}

async function waitForReply(sessionFile, marker, env) {
  const limit = Number(env.LOOP_TRANSCRIPT_WAIT_MS ?? 10000);
  const stop = Date.now() + limit;
  for (;;) {
    const reply = finalReply(sessionFile, marker);
    if (reply !== null || Date.now() >= stop) return reply;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// --------------------------------------------------------------------- gate

const pass = {code: 0, out: ''};
// The gate never blocks a message: Codewhale hands a blocked message back to the
// composer, which would leave marker text there. Every outcome that needs a word to
// the user becomes a short, clean model turn that relays it instead.
const rewrite = (text) => ({code: 0, out: JSON.stringify({text})});
const notice = (text) => rewrite(`[loop notice]\n${text}\n\nTell the user this in one or two short sentences. Do not run any tools, change any files or continue earlier work.`);

function finish(workspace, id, status, reason, extra = {}) {
  withLock(workspace, () => {
    const s = readState(workspace);
    if (!s || s.id !== id || s.status !== 'active') return;
    Object.assign(s, {status, reason}, extra);
    writeState(workspace, s);
  });
}

export async function gate(payload, env = process.env) {
  const text = String(payload?.text ?? '').trim();
  if (!text.startsWith('<<loop-')) return pass;
  const workspace = payload.workspace;
  const session = payload.session_id;
  if (typeof workspace !== 'string' || !workspace || typeof session !== 'string' || !session) return pass;

  // The command files append a fallback note after the marker, so match the first line.
  const first = text.split(/\r?\n/, 1)[0].trim();
  try {
    if (text.startsWith(START)) return await start(text, workspace, session, env);
    if (first === CANCEL) return cancel(workspace);
    if (first === STATUS) {
      const s = readState(workspace);
      return notice(s ? describe(s) : 'No loop has run in this workspace. Start one with /loop <prompt> [--max N] [--until <phrase>].');
    }
    const next = NEXT.exec(first);
    if (next) return advance(workspace, session, next[1], Number(next[2]));
    const wrap = WRAPUP.exec(first);
    if (wrap) return wrapup(workspace, wrap[1]);
  } catch (e) {
    return notice(`The loop could not complete this step: ${e.message}`);
  }
  return pass;
}

async function start(text, workspace, session, env) {
  const body = text.slice(START.length);
  const end = body.indexOf(END);
  const parsed = parseLoopArgs(end >= 0 ? body.slice(0, end) : body);
  if (parsed.error) return notice(`The loop was not started. ${parsed.error}`);

  const existing = readState(workspace);
  if (existing?.status === 'active' && !isStale(existing)) {
    return notice(`The loop was not started. ${describe(existing)} Run /cancel-loop first to start a different one.`);
  }

  let target;
  try {
    target = await resolveSocket(workspace, env);
  } catch (e) {
    return notice(`The loop cannot start: ${e.message}`);
  }
  const goal = target.status.goal ?? {};
  if (goal.objective && goal.status === 'active' && !goal.paused) {
    return notice('The loop was not started: a /goal is already active in this session and would run alongside it. Pause or clear it first (/goal pause or /goal clear).');
  }

  const now = Date.now();
  const state = {
    version: 1,
    id: crypto.randomBytes(16).toString('hex'),
    status: 'active',
    reason: null,
    prompt: parsed.prompt,
    max: parsed.max,
    until: parsed.until,
    iteration: 1,
    owner_session: session,
    workspace,
    wrapup: 'none',
    turn_open: true,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    deadline_at: new Date(now + MAX_AGE_MS).toISOString(),
  };
  withLock(workspace, () => writeState(workspace, state));
  return rewrite(iterationPrompt(state));
}

function cancel(workspace) {
  return withLock(workspace, () => {
    const s = readState(workspace);
    if (!s || s.status !== 'active') return notice(s ? `${describe(s)} Nothing to cancel.` : 'No loop is running in this workspace.');
    s.status = 'cancelled';
    s.reason = 'Cancelled by the user.';
    s.turn_open = false;
    writeState(workspace, s);
    return notice(`The loop was cancelled after iteration ${s.iteration} of at most ${s.max}. No further iteration will start.`);
  });
}

// A continuation nobody typed can arrive after the loop has ended (a cancel that raced
// the driver, a duplicate). Blocking it would hand the marker text back to the composer,
// so it becomes a short notice turn instead: nothing is lost and nothing is left behind.
const ignored = (why) => notice(`A queued loop request was ignored: ${why}`);

function advance(workspace, session, id, n) {
  return withLock(workspace, () => {
    const s = readState(workspace);
    if (!s || s.id !== id) return ignored('that loop is no longer current.');
    if (s.status !== 'active') return ignored(describe(s));
    if (s.owner_session !== session) return ignored('that loop belongs to a different Codewhale session.');
    if (Date.now() > Date.parse(s.deadline_at)) {
      s.status = 'expired';
      s.reason = 'Stopped at the loop time limit.';
      writeState(workspace, s);
      return ignored(s.reason);
    }
    if (n !== s.iteration + 1) return ignored('it was out of order or repeated.');
    if (n > s.max) {
      // The driver stops at the cap itself; this is the backstop if it ever does not.
      s.status = 'capped';
      s.reason = `Stopped at the limit of ${s.max} iterations.`;
      s.wrapup = 'sent';
      s.turn_open = false;
      writeState(workspace, s);
      return rewrite(wrapupPrompt(s));
    }
    s.iteration = n;
    s.turn_open = true;
    writeState(workspace, s);
    return rewrite(iterationPrompt(s));
  });
}

function wrapup(workspace, id) {
  return withLock(workspace, () => {
    const s = readState(workspace);
    if (!s || s.id !== id || s.status !== 'capped' || s.wrapup !== 'pending') return ignored('there is no wrap-up to run for that loop.');
    s.wrapup = 'sent';
    writeState(workspace, s);
    return rewrite(wrapupPrompt(s));
  });
}

// ----------------------------------------------------------------- turn end

async function post(sock, text) {
  const res = await rpc(sock, 'message', {text});
  if (res?.result?.type !== 'message_sent') throw new Error(res?.error?.message ?? 'the control socket refused the message');
  return res.result.delivery;
}

// The gate marks a loop's turn as open when it starts an iteration; the first turn_end
// afterwards claims it. Turns that were not started by the loop (a status or cancel
// reply, a message you typed yourself) therefore never advance, stop or double-send it.
function claimTurn(workspace, payload) {
  return withLock(workspace, () => {
    const s = readState(workspace);
    if (!s || s.status !== 'active' || !s.turn_open) return null;
    if (s.owner_session !== payload.session_id) return null;
    s.turn_open = false;
    writeState(workspace, s);
    return s;
  });
}

function stillCurrent(workspace, state) {
  const s = readState(workspace);
  return Boolean(s) && s.status === 'active' && s.id === state.id && s.iteration === state.iteration;
}

export async function turnEnd(payload, env = process.env) {
  const workspace = payload?.workspace;
  if (typeof workspace !== 'string' || !workspace || payload.model_backed === false) return 'ignored';
  const peek = readState(workspace);
  if (!peek || peek.status !== 'active' || !peek.turn_open || peek.owner_session !== payload.session_id) return 'ignored';
  const state = claimTurn(workspace, payload);
  if (!state) return 'ignored';

  if (Date.now() > Date.parse(state.deadline_at)) {
    finish(workspace, state.id, 'expired', 'Stopped at the loop time limit.');
    return 'expired';
  }
  if (payload.status !== 'completed') {
    finish(workspace, state.id, 'stopped', `Stopped because the turn ended as ${String(payload.status)}.`);
    return 'stopped';
  }

  let target;
  try {
    target = await resolveSocket(workspace, env);
  } catch (e) {
    finish(workspace, state.id, 'error', `Stopped: ${e.message}`);
    return 'error';
  }

  if (state.until) {
    const reply = await waitForReply(path.join(sessionsDir(env), `${target.uuid}.json`), `[loop ${state.id} #${state.iteration}/`, env);
    if (reply === null) {
      finish(workspace, state.id, 'error', 'Stopped: the reply could not be read from the session transcript to check for the completion phrase.');
      return 'error';
    }
    if (hasPhrase(reply, state.until)) {
      finish(workspace, state.id, 'completed', 'The completion phrase appeared.');
      return 'completed';
    }
  }

  // Cancelled while we were reading the transcript? Then say nothing.
  if (!stillCurrent(workspace, state)) return 'ignored';
  try {
    if (state.iteration >= state.max) {
      finish(workspace, state.id, 'capped', `Stopped at the limit of ${state.max} iterations.`, {wrapup: 'pending'});
      await post(target.sock, `<<loop-wrapup:${state.id}>>`);
      return 'capped';
    }
    await post(target.sock, `<<loop-next:${state.id}:${state.iteration + 1}>>`);
    return 'continued';
  } catch (e) {
    finish(workspace, state.id, 'error', `Stopped: ${e.message}`);
    return 'error';
  }
}

// --------------------------------------------------------------------- main

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const mode = process.argv[2];
  let payload;
  try { payload = JSON.parse(await readStdin()); } catch { payload = null; }
  if (!payload) {
    process.exit(mode === 'gate' ? 0 : 1);
  } else if (mode === 'gate') {
    const result = await gate(payload);
    if (result.out) process.stdout.write(result.out + '\n');
    process.exitCode = result.code;
  } else if (mode === 'turn-end') {
    const outcome = await turnEnd(payload);
    process.stderr.write(`loop: ${outcome}\n`);
  } else {
    process.stderr.write('usage: loop.mjs gate|turn-end < hook-payload.json\n');
    process.exitCode = 64;
  }
}
