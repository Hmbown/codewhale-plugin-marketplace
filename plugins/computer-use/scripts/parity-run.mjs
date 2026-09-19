// Parity runner: executes a task suite against the real MCP server and
// disposable fixtures, with a pre-declared oracle per step. Zero dependencies.
// See parity/tasks.json $schema_note for the DSL.
//
// The engine here is platform-neutral. Everything that knows about a specific
// desktop — how fixtures launch, where their client origin is, how the oracle
// is read, how host interference is measured — lives in a driver under
// scripts/lib/desktop-<platform>.mjs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import { sh } from "./lib/sh.mjs";
import { checkExpect } from "./lib/parity-oracle.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PARITY = path.join(ROOT, "parity");
const HOME = os.homedir();
const USER = os.userInfo().username;

// ---------- cli ----------
const argv = process.argv.slice(2);
function opt(name, dflt = null) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : dflt;
}
function optAll(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1] != null) out.push(argv[i + 1]);
  return out;
}
const ISOLATED = argv.includes("--isolated");
const TASK_GLOBS = optAll("--task");
const CODEX_RESULTS = opt("--codex-results");
/** Per-platform suites exist where the fixtures differ; else the shared one. */
function defaultTasksFile() {
  const perPlatform = path.join(PARITY, `tasks.${process.platform}.json`);
  return fs.existsSync(perPlatform) ? perPlatform : path.join(PARITY, "tasks.json");
}
const TASKS_FILE = opt("--tasks", defaultTasksFile());
const TASKS_DOC = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
const REPEATS = Number(opt("--repeats", TASKS_DOC.repeats ?? 5));

// ---------- desktop driver ----------
// Named explicitly rather than defaulted: falling back to the X11 driver on a
// platform that has none would fail deep inside xdotool instead of saying what
// is missing. See docs/PORTING.md to add one.
const DRIVERS = { darwin: "./lib/desktop-darwin.mjs", linux: "./lib/desktop-x11.mjs", win32: "./lib/desktop-win32.mjs" };
if (!DRIVERS[process.platform]) {
  console.error(`parity-run: no desktop driver for ${process.platform}. Implement scripts/lib/desktop-${process.platform}.mjs (see docs/PORTING.md) and register it here.`);
  process.exit(2);
}
const { createDesktop } = await import(DRIVERS[process.platform]);
const desktop = createDesktop({ parityDir: PARITY, tasksDoc: TASKS_DOC, isolated: ISOLATED });

// ---------- MCP server ----------
class Server {
  constructor(env) {
    this.env = env;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = "";
    this.start();
  }
  start() {
    this.proc = spawn("node", [path.join(ROOT, "mcp", "server.mjs")], {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
        } catch {}
      }
    });
  }
  rpc(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    return { id, p };
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async call(name, args = {}) {
    const { p } = this.rpc("tools/call", { name, arguments: args });
    const res = await p;
    const text = res.result?.content?.[0]?.text ?? "{}";
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { isError: res.result?.isError === true || parsed?.ok === false, parsed, raw: res };
  }
  async restart() {
    await this.stop();
    this.pending.clear();
    this.buf = "";
    this.start();
    await this.rpc("initialize", { protocolVersion: "2025-06-18" }).p;
  }
  async stop() {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    const waitForExit = (ms) => new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true);
      const done = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { proc.off("exit", done); resolve(false); }, ms);
      proc.once("exit", done);
    });
    // EOF lets the server release this session's input and daemon backend.
    proc.stdin.end();
    if (await waitForExit(3500)) return;
    proc.kill("SIGTERM");
    if (await waitForExit(1500)) return;
    proc.kill("SIGKILL");
    await waitForExit(2000);
  }
}


// ---------- oracle ----------
async function awaitExpect(task, repCtx, exp, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await desktop.oracleState(task, repCtx);
    if (last && checkExpect(exp, last)) return { ok: true, state: last };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, state: last, detail: `expect ${JSON.stringify(exp)} never held; last=${JSON.stringify(last)}` };
}

// ---------- substitution + target sugar ----------
let currentRaster = null; // {origin:{x,y}, scale, pixels:{w,h}} — screen-points space
let lastAppState = null;  // {state_id, elements}

function substitute(v, vars) {
  if (typeof v === "string") {
    // A whole-string reference keeps the variable's type: app_ref.pid must
    // stay an integer, not become "4711".
    const whole = /^\$\{(\w+)\}$/.exec(v);
    if (whole && vars[whole[1]] != null) return vars[whole[1]];
    return v.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? v);
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, vars));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = substitute(x, vars);
    return out;
  }
  return v;
}

function toRasterPixels(sx, sy) {
  const r = currentRaster;
  if (!r) throw new Error("no raster bound (take a screenshot first)");
  const s = r.scale || 1;
  return { x: Math.round((sx - r.origin.x) * s), y: Math.round((sy - r.origin.y) * s) };
}

/** Resolve DSL target sugar to a real target. Returns {target} or {skipReason}. */
async function resolveTarget(spec, task, repCtx, server) { // repCtx carries the cached doc offset
  if (!spec || typeof spec !== "object") return { target: spec };
  if (spec.client) {
    const org = desktop.clientOrigin(task.fixture, { window: spec.window ?? "main", repCtx });
    if (process.env.PARITY_DEBUG) console.error("  [dbg] clientOrigin", JSON.stringify(org), "client", spec.client);
    const [x, y] = spec.client;
    const px = toRasterPixels(org.x + x, org.y + y);
    return { target: { type: "coordinate", ...px } };
  }
  if (spec.client_zoom) {
    const org = desktop.clientOrigin(task.fixture, { window: spec.window ?? "main", repCtx });
    const [x, y] = spec.client_zoom;
    const px = toRasterPixels(org.x + x, org.y + y);
    return { target: { type: "coordinate", ...px } };
  }
  if (spec.window_title) {
    // A point inside a non-fixture window (native dialogs, choosers) located by
    // title on the work display. `at` is an offset from the window's top-left;
    // a negative component measures back from the far edge, so e.g. [-60,-40]
    // stays on the bottom-right button however the WM sizes the window.
    const g = desktop.windowGeometry?.(spec.window_title, repCtx);
    if (!g) return { error: `window "${spec.window_title}" not found on the work display` };
    const [ox, oy] = spec.at ?? [0, 0];
    const px = toRasterPixels(g.x + (ox < 0 ? g.w + ox : ox), g.y + (oy < 0 ? g.h + oy : oy));
    return { target: { type: "coordinate", ...px } };
  }
  if (spec.element_by_label != null) {
    if (!lastAppState?.elements) {
      return task.optional_a11y ? { skipReason: "get_app_state did not return elements" } : { error: "element_by_label without prior get_app_state" };
    }
    let el = lastAppState.elements.find((e) => e.label === spec.element_by_label);
    if (!el && lastAppState.truncated && lastAppState.args) {
      // A 16KB-budget page can hide the target. Re-observe with a server-side
      // query: the filtered answer is small and cannot be truncated away.
      const res = await server.call("get_app_state", { ...lastAppState.args, query: spec.element_by_label });
      if (res.parsed?.ok) {
        lastAppState = { state_id: res.parsed.state_id, elements: res.parsed.elements ?? [], truncated: res.parsed.truncated, args: lastAppState.args };
        el = lastAppState.elements.find((e) => e.label === spec.element_by_label);
      }
    }
    if (!el) {
      return task.optional_a11y
        ? { skipReason: `no element labelled "${spec.element_by_label}" in app state` }
        : { error: `no element labelled "${spec.element_by_label}"` };
    }
    return { target: { type: "element", state_id: lastAppState.state_id, index: el.index } };
  }
  if (spec.element_match) {
    // element_match accepts one spec or a list — a list matches an element
    // satisfying ANY spec (native widgets present under different roles).
    const matchSpecs = Array.isArray(spec.element_match) ? spec.element_match : [spec.element_match];
    const matchAll = (els) => els.filter((el) => matchSpecs.some((ms) => matchElement(el, ms)));
    let elements = lastAppState?.elements ?? [];
    let matches = matchAll(elements);
    if (matches.length !== 1 && lastAppState?.truncated && lastAppState.args) {
      const filter = {};
      if (matchSpecs[0].label) filter.query = String(matchSpecs[0].label);
      else if (matchSpecs[0].role) filter.role = String(matchSpecs[0].role);
      if (Object.keys(filter).length) {
        const res = await server.call("get_app_state", { ...lastAppState.args, ...filter });
        if (res.parsed?.ok) {
          lastAppState = { state_id: res.parsed.state_id, elements: res.parsed.elements ?? [], truncated: res.parsed.truncated, args: lastAppState.args };
          elements = lastAppState.elements;
          matches = matchAll(elements);
        }
      }
    }
    if (matches.length !== 1) return { error: `expected one observed element matching ${JSON.stringify(spec.element_match)}; found ${matches.length}` };
    let element = matches[0];
    if (spec.ancestor_role) {
      const ancestors = elements.filter((el) => el.role === spec.ancestor_role && el.windowIndex === element.windowIndex
        && Array.isArray(el.path) && Array.isArray(element.path) && el.path.length < element.path.length
        && el.path.every((part, index) => part === element.path[index])).sort((a, b) => b.path.length - a.path.length);
      if (!ancestors.length || ancestors[0].path.length === ancestors[1]?.path.length) return { error: `no unique nearest ${spec.ancestor_role} ancestor in the observed state` };
      element = ancestors[0];
    }
    return { target: { type: "element", state_id: lastAppState.state_id, index: element.index } };
  }
  return { target: spec };
}

// Element specs match by strict equality; a key suffixed _contains does a
// substring test against that attribute — e.g. {label_contains:"CU-FIXTURE"}
// identifies a window whose title embeds live state that can't be matched
// exactly.
function matchElement(el, spec) {
  return Object.entries(spec).every(([key, value]) => {
    // path_prefix scopes a match to a subtree — e.g. [5,1] reaches a native
    // panel's hosted sheet without also matching same-role elements in the
    // app's own window (a find bar next to a Go to Folder field).
    if (key === "path_prefix") {
      return Array.isArray(el.path) && Array.isArray(value)
        && value.every((part, index) => el.path[index] === part);
    }
    return key.endsWith("_contains")
      ? String(el[key.slice(0, -9)] ?? "").includes(String(value))
      : el[key] === value;
  });
}

function resolveRegion(spec, task, repCtx) {
  if (spec && typeof spec === "object" && spec.client) {
    const org = desktop.clientOrigin(task.fixture, { window: spec.window ?? "main", repCtx });
    const [x, y, w, h] = spec.client;
    const tl = toRasterPixels(org.x + x, org.y + y);
    const s = currentRaster?.scale || 1;
    return [tl.x, tl.y, Math.round(w * s), Math.round(h * s)];
  }
  return spec;
}

function sanitize(obj) {
  const seen = (v) => {
    if (typeof v === "string") {
      return v.split(HOME).join("~").split(USER).join("<user>");
    }
    if (Array.isArray(v)) return v.map(seen);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if ((k === "file" || k === "path" || k === "dir" || k === "source") && typeof x === "string") out[k] = path.basename(x);
        else out[k] = seen(x);
      }
      return out;
    }
    return v;
  };
  return seen(obj);
}

// ---------- task execution ----------
class SkipRep extends Error {}

/** Run one DSL step. Returns the step record; throws to fail the rep. */
async function runStep(step, { task, repCtx, server, ctx, vars, rep, counts }) {
  const stepInfo = { index: counts.index, step: sanitize(step) };
  if (step.restart_server) {
    await server.restart();
    // Keep currentRaster: its geometry is still needed to convert client
    // sugar into raster pixels — the *server* must be the one rejecting
    // stale state (no_raster / unknown_state), not the runner.
    lastAppState = null;
    stepInfo.result = "restarted";
  } else if (step.sleep != null) {
    await new Promise((r) => setTimeout(r, step.sleep));
    stepInfo.result = "slept";
  } else if (step.key) {
    stepInfo.call = "key";
    counts.calls++;
    const res = await server.call("key", { text: step.key });
    stepInfo.receipt = sanitize(res.parsed ?? {});
    if (res.isError) throw new Error(`key "${step.key}" failed: ${res.parsed?.error?.code ?? "?"} ${res.parsed?.error?.message ?? ""}`);
  } else if (step.expect) {
    const r = await awaitExpect(task, repCtx, step.expect);
    stepInfo.result = r.ok ? "held" : "timeout";
    stepInfo.state = sanitize(r.state ?? {});
    if (!r.ok) throw new Error(r.detail);
  } else if (step.expect_file) {
    const f = path.join(ctx.downloadDir, step.expect_file.name);
    const deadline = Date.now() + 5000;
    let ok = false, content = null;
    while (Date.now() < deadline) {
      if (fs.existsSync(f)) {
        content = fs.readFileSync(f, "utf8");
        if (!step.expect_file.contains || content.includes(step.expect_file.contains)) { ok = true; break; }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    stepInfo.result = ok ? "file_ok" : "file_missing";
    if (!ok) throw new Error(`expect_file ${step.expect_file.name}: ${content == null ? "never appeared" : "content mismatch"}`);
  } else if (step.diag_shot) {
    // Whole-display capture for diagnosing native dialogs — window-scoped
    // screenshots cannot see out-of-process panels (open/save panels are
    // hosted by openAndSavePanelService, not the app).
    const file = path.join(ctx.outDir, `diag-${step.diag_shot}-r${rep.rep ?? 0}.jpg`);
    await new Promise((resolve) => {
      const p = spawn("screencapture", ["-x", "-o", "-t", "jpg", file]);
      p.on("close", resolve);
      p.on("error", resolve);
    });
    stepInfo.result = fs.existsSync(file) ? file : "capture failed";
  } else if (step.until_element) {
    // Poll for an element the way a person would watch for it. Native
    // dialogs (the ONS-hosted open panel and its sheets) appear on their
    // own schedule, and a chord sent while the panel is still becoming
    // key is a silent no-op — so a missing element after retry_after_ms
    // re-sends the optional retry step instead of just waiting longer.
    const specs = Array.isArray(step.until_element) ? step.until_element : [step.until_element];
    const app_ref = substitute(step.app_ref ?? {}, vars);
    // The unfiltered dump truncates native-dialog elements out (the menu
    // bar eats the cap), so poll once per distinct role — a role-filtered
    // query returns the full matching set, including unbridged panels.
    const roles = [...new Set(specs.map((s) => s.role).filter(Boolean))];
    const queries = roles.length ? roles.map((role) => ({ app_ref, detail: "full", role })) : [{ app_ref, detail: "full" }];
    const timeout = step.timeout_ms ?? 6000;
    const deadline = Date.now() + timeout;
    const retryAfter = step.retry_after_ms ?? 1500;
    const started = Date.now();
    let nextRetry = started + retryAfter, retries = 0, found = false, lastError = null, lastSeen = [];
    const matches = (els) => specs.some((spec) => els.some((el) => matchElement(el, spec)));
    poll: while (Date.now() < deadline) {
      lastSeen = [];
      for (const args of queries) {
        counts.calls++;
        const res = await server.call("get_app_state", args);
        if (res.parsed?.ok) {
          // Keep the matching query's state — resolveTarget consumes
          // lastAppState, so it must be the filtered set that actually
          // contains the element, not the last query's.
          lastAppState = { state_id: res.parsed.state_id, elements: res.parsed.elements ?? [], truncated: res.parsed.truncated, args };
          lastSeen = lastSeen.concat(lastAppState.elements);
          if (matches(lastAppState.elements)) { found = true; break poll; }
        } else lastError = res.parsed?.error?.message;
      }
      if (step.retry && retries < (step.retries ?? 1) && Date.now() >= nextRetry) {
        retries++;
        nextRetry = Date.now() + retryAfter;
        for (const rs of Array.isArray(step.retry) ? step.retry : [step.retry]) {
          if (rs.sleep != null) await new Promise((r) => setTimeout(r, rs.sleep));
          else {
            counts.calls++;
            let rres;
            if (rs.key) rres = await server.call("key", { text: rs.key });
            else {
              const rargs = substitute(rs.args ?? {}, vars);
              let unresolved = false;
              for (const key of ["target", "from_target", "to"]) {
                if (rargs[key]) {
                  const rt = await resolveTarget(rargs[key], task, repCtx, server);
                  if (rt.error || rt.skipReason) { unresolved = true; break; }
                  rargs[key] = rt.target;
                }
              }
              // A retry step whose target can't resolve (e.g. a dialog
              // button that's legitimately absent) is skipped — retries
              // are best-effort nudges, never a failure cause.
              if (unresolved) continue;
              rres = await server.call(rs.call, rargs);
              // A retry observation feeds the next retry step's
              // element_match — e.g. refresh buttons, press Cancel.
              if (rs.call === "get_app_state" && rres.parsed?.ok) {
                lastAppState = { state_id: rres.parsed.state_id, elements: rres.parsed.elements ?? [], truncated: rres.parsed.truncated, args: rargs };
              }
            }
            // A failed nudge (refused click, transient tool error) is
            // logged and polling continues — retries must never be the
            // thing that fails a rep.
            if (rres.isError) stepInfo.retry_errors = (stepInfo.retry_errors ?? []).concat(`${rs.key ?? rs.call}: ${rres.parsed?.error?.code ?? "?"} ${rres.parsed?.error?.message ?? ""}`);
          }
        }
      }
      await new Promise((r) => setTimeout(r, step.poll_ms ?? 400));
    }
    stepInfo.result = found ? "observed" : "timeout";
    stepInfo.retries = retries;
    if (!found && !step.optional) {
      // Diagnostic: an AXButton scan tells the failure whether a native
      // dialog was up at all (Cancel/Open exist) or the panel never
      // presented — the difference between a missed chord and a missed
      // click.
      let probeNote = "";
      counts.calls++;
      const probe = await server.call("get_app_state", { app_ref, detail: "full", role: "AXButton" });
      if (probe.parsed?.ok) probeNote = `; dialog buttons: ${JSON.stringify((probe.parsed.elements ?? []).map((b) => b.label ?? b.role).slice(0, 10))}`;
      // Summarize what the role queries actually returned — a present-but-
      // unfocused field (toggle-eaten chord) looks different from no field.
      const seen = lastSeen.slice(0, 8).map((el) => ({ role: el.role, label: el.label ?? el.description, focused: el.focused, enabled: el.enabled, value: typeof el.value === "string" ? el.value.slice(0, 40) : undefined }));
      if (seen.length) probeNote += `; queried: ${JSON.stringify(seen)}`;
      const retryNote = retries ? `; retries=${retries}${stepInfo.retry_errors?.length ? ` retry_errors=${JSON.stringify(stepInfo.retry_errors)}` : ""}` : "";
      throw new Error(`until_element ${JSON.stringify(specs)} not observed within ${timeout}ms${retryNote}${probeNote}${lastError ? ` (${lastError})` : ""}`);
    }
  } else if (step.call) {
    const args = substitute(step.args ?? {}, vars);
    const name = step.call;
    for (const key of ["target", "from_target", "to"]) {
      if (args[key]) {
        const r = await resolveTarget(args[key], task, repCtx, server);
        if (r.skipReason) { rep.status = "skipped"; rep.reason = r.skipReason; throw new SkipRep(r.skipReason); }
        if (r.error) {
          // optional steps tolerate an absent target — e.g. an "Open"
          // button that is legitimately gone because Return already
          // accepted the dialog. The task's expect step decides success.
          if (step.optional) { stepInfo.result = `skipped: ${r.error}`; stepInfo.ok = true; return stepInfo; }
          throw new Error(r.error);
        }
        args[key] = r.target;
      }
    }
    if (args.region) args.region = resolveRegion(args.region, task, repCtx);
    if (process.env.PARITY_DEBUG) console.error("  [dbg]", name, JSON.stringify(args));
    counts.calls++;
    stepInfo.call = name;

    if (step.cancel_after_ms != null || step.expect_no_response_ms != null) {
      const { id, p } = server.rpc("tools/call", { name, arguments: args });
      let responded = false;
      p.then(() => { responded = true; }).catch(() => {});
      if (step.cancel_after_ms != null) {
        await new Promise((r) => setTimeout(r, step.cancel_after_ms));
        server.notify("notifications/cancelled", { requestId: id });
      }
      if (step.expect_no_response_ms != null) {
        await new Promise((r) => setTimeout(r, step.expect_no_response_ms));
        stepInfo.result = responded ? "responded" : "no_response";
        if (responded) throw new Error(`request ${id} was cancelled but still produced a response`);
      } else {
        await p;
      }
    } else {
      const res = await server.call(name, args);
      stepInfo.receipt = sanitize(res.parsed ?? {});
      // raster bookkeeping
      if (name === "screenshot" && res.parsed?.ok) {
        currentRaster = {
          origin: { x: res.parsed.points?.x ?? 0, y: res.parsed.points?.y ?? 0 },
          scale: res.parsed.scale ?? 1,
          pixels: res.parsed.pixels ?? null,
        };
      }
      if (name === "zoom" && res.parsed?.ok && currentRaster) {
        const [rx, ry, rw, rh] = args.region;
        const s = currentRaster.scale || 1;
        currentRaster = {
          origin: { x: currentRaster.origin.x + rx / s, y: currentRaster.origin.y + ry / s },
          scale: s,
          pixels: { w: rw, h: rh },
        };
      }
      if (name === "get_app_state" && res.parsed?.ok) {
        lastAppState = { state_id: res.parsed.state_id, elements: res.parsed.elements ?? [], truncated: res.parsed.truncated, args };
      }
      if (step.expect_error) {
        if (!(res.isError && res.parsed?.error?.code === step.expect_error)) {
          throw new Error(`expected error ${step.expect_error}, got ${res.isError ? res.parsed?.error?.code : "ok"}`);
        }
        if (step.expect_message_contains && !String(res.parsed?.error?.message ?? "").includes(step.expect_message_contains)) {
          throw new Error(`error message lacks "${step.expect_message_contains}": ${res.parsed?.error?.message}`);
        }
      } else if (step.expect_error_any) {
        if (!res.isError) throw new Error("expected an error receipt, got ok");
        if (step.expect_message_contains && !String(res.parsed?.error?.message ?? "").includes(step.expect_message_contains)) {
          throw new Error(`error message lacks "${step.expect_message_contains}": ${res.parsed?.error?.message}`);
        }
      } else if (res.isError) {
        if (step.optional) { stepInfo.result = `skipped: ${res.parsed?.error?.code ?? "?"} ${res.parsed?.error?.message ?? ""}`; stepInfo.ok = true; return stepInfo; }
        throw new Error(`${name} failed: ${res.parsed?.error?.code ?? "?"} ${res.parsed?.error?.message ?? ""}`);
      }
    }
  }
  stepInfo.ok = true;
  return stepInfo;
}

let activeCleanup = null;

async function runRep(task, repIdx, ctx) {
  const started = Date.now();
  const rep = { task: task.id, rep: repIdx, status: "ok", steps: [], toolCalls: 0, preludeCalls: 0, notes: [] };

  // A task the platform genuinely cannot express is recorded as a skip with a
  // reason, never silently dropped from the matrix.
  if (task.skip) {
    return { ...rep, status: "skipped", reason: task.skip, elapsed_ms: 0,
             interference: { pointer_displacement_px: 0, active_window_changed: false },
             interference_actions: { pointer_displacement_px: 0, active_window_changed: false } };
  }

  let proc = null;
  const repCtx = { dir: ctx.repDir, downloadDir: ctx.downloadDir, winId: null, nativeStateFile: null };
  const before = desktop.hostProbe();
  const server = new Server({
    ...desktop.baseEnv(),
    CODEWHALE_CU_RECORDINGS_DIR: ctx.recDir,
    ...desktop.serverEnv(ctx),
    ...(task.server_env ?? {}),
  });
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    await desktop.killFixture(proc, repCtx);
    await server.stop();
  })();
  activeCleanup = cleanup;
  const vars = { UPLOAD_FILE: ctx.uploadFile, BROWSER_APP_NAME: desktop.browserAppName?.() ?? "chrome", FIXTURE_PID: null };
  let afterLaunch = before;

  try {
    await server.rpc("initialize", { protocolVersion: "2025-06-18" }).p;
    server.notify("notifications/initialized", {});
    if (task.fixture) {
      proc = await desktop.launchFixture(task.fixture, repCtx);
      desktop.focusFixture(repCtx);
      vars.FIXTURE_PID = repCtx.pid ?? null;
      // give the page/app a beat to settle (first paint, a11y registration)
      await new Promise((r) => setTimeout(r, 600));
    }
    // Interference caused by *the agent's actions* is measured from here: the
    // fixture's own launch is the runner's doing, not the tool surface's.
    afterLaunch = desktop.hostProbe();
    currentRaster = null;
    lastAppState = null;

    const prelude = desktop.prelude?.(task, repCtx) ?? [];
    const counts = { calls: 0, index: 0 };
    for (let i = 0; i < prelude.length; i++) {
      counts.index = i - prelude.length;
      const info = await runStep(prelude[i], { task, repCtx, server, ctx, vars, rep, counts });
      info.prelude = true;
      rep.steps.push(info);
    }
    rep.preludeCalls = counts.calls;
    counts.calls = 0;

    for (let si = 0; si < task.steps.length; si++) {
      counts.index = si;
      try {
        rep.steps.push(await runStep(task.steps[si], { task, repCtx, server, ctx, vars, rep, counts }));
      } catch (e) {
        if (e instanceof SkipRep) break;
        rep.status = "failed";
        rep.failStep = si;
        rep.failReason = String(e.message ?? e).slice(0, 500);
        rep.steps.push({ index: si, step: sanitize(task.steps[si]), ok: false, error: rep.failReason });
        break;
      }
    }
    rep.toolCalls = counts.calls;
  } catch (e) {
    if (!(e instanceof SkipRep)) {
      rep.status = "failed";
      rep.failReason = `runner: ${String(e.message ?? e).slice(0, 400)}`;
    }
  } finally {
    const after = desktop.hostProbe();
    const span = (a, b) => ({
      pointer_displacement_px: Math.round(Math.hypot(b.pointer.x - a.pointer.x, b.pointer.y - a.pointer.y) * 10) / 10,
      active_window_changed: a.activeWindow !== b.activeWindow,
    });
    rep.interference = { ...span(before, after), pointer_before: before.pointer, pointer_after: after.pointer };
    rep.interference_actions = { ...span(afterLaunch, after), foreground_before: afterLaunch.activeWindow, foreground_after: after.activeWindow };
    rep.elapsed_ms = Date.now() - started;
    await cleanup();
    activeCleanup = null;
  }
  return rep;
}

// ---------- main ----------
async function main() {
  await desktop.start();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(opt("--out") ?? path.join(ROOT, "receipts", "parity", `${process.platform}-${desktop.sessionType()}-${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });
  const downloadDir = path.join(outDir, "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  const uploadFile = path.join(outDir, "upload", "cu-upload.txt");
  fs.mkdirSync(path.dirname(uploadFile), { recursive: true });
  fs.writeFileSync(uploadFile, "codewhale upload fixture\n");
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-parity-state-"));
  const recDir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-parity-rec-"));
  const repDir = path.join(outDir, "reps");
  fs.mkdirSync(repDir, { recursive: true });

  let tasks = TASKS_DOC.tasks;
  if (TASK_GLOBS.length) {
    const res = TASK_GLOBS.map((g) => new RegExp("^" + g.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"));
    tasks = tasks.filter((t) => res.some((re) => re.test(t.id)));
  }
  console.log(`parity run: ${tasks.length} tasks x ${REPEATS} reps on ${process.platform}/${desktop.sessionType()} -> ${outDir}`);

  const ctx = { outDir, downloadDir, uploadFile, stateDir, recDir, repDir };
  const reps = [];
  for (const task of tasks) {
    for (let i = 0; i < REPEATS; i++) {
      let rep = await runRep(task, i + 1, ctx);
      // A runner-class failure means the fixture never ran the task — the rep
      // is not a capability sample. Retry once and keep the retry visible in
      // the receipt via launch_retry.
      if (rep.status === "failed" && /^runner:/.test(rep.failReason ?? "")) {
        const retry = await runRep(task, i + 1, ctx);
        retry.launch_retry = rep.failReason;
        rep = retry;
      }
      reps.push(rep);
      const mark = rep.status === "ok" ? "ok" : rep.status === "skipped" ? `SKIP(${rep.reason})` : `FAIL(step ${rep.failStep}: ${rep.failReason})`;
      console.log(`  ${task.id} rep ${i + 1}/${REPEATS}: ${mark} [${rep.elapsed_ms}ms, ${rep.toolCalls} calls, drift=${rep.interference.pointer_displacement_px}px]`);
    }
  }

  const cleanup = (await desktop.stop()) ?? {};

  // ---------- run.json ----------
  const meta = {
    codewhale_commit: sh("git", ["rev-parse", "HEAD"], { env: {} }).stdout.trim(),
    git_dirty: sh("git", ["status", "--porcelain"], { env: {} }).stdout.trim().length > 0,
    node: process.version,
    os: `${process.platform} ${os.release()}`,
    platform: process.platform,
    session_type: desktop.sessionType(),
    tasks_file: path.basename(TASKS_FILE),
    date: new Date().toISOString(),
    repeats: REPEATS,
    isolated: ISOLATED,
    tasks: tasks.map((t) => t.id),
    cleanup,
    ...desktop.meta(),
    codex: { available: false, note: "no matching full-suite Codex baseline supplied for this run" },
  };
  if (CODEX_RESULTS && fs.existsSync(CODEX_RESULTS)) {
    meta.codex = { available: true, merged_from: path.basename(CODEX_RESULTS), data: JSON.parse(fs.readFileSync(CODEX_RESULTS, "utf8")) };
  }
  fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify({ meta, reps: reps.map(sanitize) }, null, 2));

  // ---------- summary ----------
  const byTask = new Map();
  for (const r of reps) {
    if (!byTask.has(r.task)) byTask.set(r.task, []);
    byTask.get(r.task).push(r);
  }
  console.log("\n=== summary ===");
  let anyNonOptionalFail = false;
  for (const t of tasks) {
    const rs = byTask.get(t.id) ?? [];
    const ok = rs.filter((r) => r.status === "ok").length;
    const sk = rs.filter((r) => r.status === "skipped").length;
    const fa = rs.filter((r) => r.status === "failed").length;
    if (fa > 0 && !t.optional_a11y) anyNonOptionalFail = true;
    console.log(`  ${t.id}: ${ok}/${REPEATS} ok, ${sk} skipped, ${fa} failed${t.optional_a11y ? " (optional_a11y)" : ""}`);
  }
  console.log(`run.json: ${path.join(outDir, "run.json")}`);

  for (const d of [stateDir, recDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  process.exit(anyNonOptionalFail ? 1 : 0);
}

let stopping = false;
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    try { await activeCleanup?.(); await desktop.stop(); } catch {}
    process.exit(code);
  });
}
main().catch(async (e) => { console.error("parity-run fatal:", e); try { await activeCleanup?.(); await desktop.stop(); } catch {} process.exit(2); });
