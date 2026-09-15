#!/usr/bin/env node
// Whalesong MCP server — analysis surface over the local Whalesong platform.
// Reads ~/.whalesong/env for WHALESONG_URL / WHALESONG_SECRET_KEY /
// WHALESONG_HOME / WHALESONG_DATA. Trace analysis opens the platform SQLite
// store read-side (WAL) and runs the same deterministic analysis core the
// instrument uses — no model calls, nothing leaves the machine.
// Stdio JSON-RPC, newline-delimited, zero dependencies.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ---------------- config ---------------- */
const ENV_FILE = path.join(os.homedir(), ".whalesong", "env");
for (const line of fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8").split("\n") : []) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const URL_BASE = (process.env.WHALESONG_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const SECRET = process.env.WHALESONG_SECRET_KEY;
const WSHOME = process.env.WHALESONG_HOME;
const WSDATA = process.env.WHALESONG_DATA;

const SOURCE_PREFIX = { codewhale: "cw:", claude: "claude:", codex: "codex:", kimi: "kimi:", grok: "grok:", devin: "devin:", muse: "muse:", amp: "amp:" };

/* ---------------- http ---------------- */
async function api(p, { method = "GET", body } = {}) {
  if (!SECRET) throw new Error(`WHALESONG_SECRET_KEY is not set — expected it in ${ENV_FILE}`);
  const res = await fetch(`${URL_BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

/* ---------------- lazy core imports (analysis runs locally, not over HTTP) */
let _core;
async function core() {
  if (_core) return _core;
  if (!WSHOME) throw new Error("WHALESONG_HOME is not set — expected it in ~/.whalesong/env");
  const imp = rel => import(pathToFileURL(path.join(WSHOME, rel)).href);
  const [{ PlatformStore }, analysis, { importTrace }, signal, audio, { analysisReport }] = await Promise.all([
    imp("scripts/lib/store.mjs"), imp("dist/core/analysis.js"), imp("dist/core/ingest.js"),
    imp("dist/core/signal.js"), imp("dist/core/audio.js"), imp("dist/core/report.js"),
  ]);
  _core = { PlatformStore, importTrace, signal, audio, analysisReport, ...analysis };
  return _core;
}
let _db, _pid;
async function store() {
  const { PlatformStore } = await core();
  if (!_db) {
    if (!WSDATA) throw new Error("WHALESONG_DATA is not set — expected it in ~/.whalesong/env");
    if (!fs.existsSync(WSDATA)) throw new Error(`Whalesong database not found at ${WSDATA}`);
    _db = new PlatformStore(WSDATA);
  }
  if (!_pid) {
    const p = _db.listProjects().find(p => p.name === "agent-sessions") ?? _db.listProjects()[0];
    if (!p) throw new Error("No Whalesong project exists yet.");
    _pid = p.id;
  }
  return _db;
}

async function loadTrace(ref) {
  // ref may be a platform trace id or a filesystem path to JSONL/OTLP/Codewhale JSON
  if (typeof ref !== "string" || !ref.length) throw new Error("a trace id or file path is required");
  const { importTrace } = await core();
  if (fs.existsSync(ref)) {
    const traces = importTrace(fs.readFileSync(ref, "utf8"), path.basename(ref), { privacy: "retain" });
    if (!traces.length) throw new Error("The file produced no traces.");
    return traces[0];
  }
  const db = await store();
  const trace = db.instrumentTrace(_pid, ref, "retain");
  if (!trace) throw new Error(`Trace not found: ${ref}`);
  return trace;
}

const cap = (arr, n, key = "id") => arr.length > n ? [...arr.slice(0, n).map(x => typeof x === "string" ? x : x?.[key]), `… ${arr.length - n} more`] : arr.map(x => typeof x === "string" ? x : x?.[key]);
const resultText = v => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

function analysisOut(a) {
  return {
    name: a.trace.name, events: a.stats.events, agents: a.stats.agents,
    durationMs: a.stats.duration, errors: a.stats.errors, retries: a.stats.retries,
    tokens: { input: a.stats.inputTokens, output: a.stats.outputTokens, cached: a.stats.cachedTokens, coverage: `${a.stats.tokenCount}/${a.stats.events}` },
    cost: a.stats.costKnown ? a.stats.cost : null,
    latencyMs: { p50: a.stats.latencyP50, p95: a.stats.latencyP95 },
    observedGapRatio: a.stats.observedGapRatio,
    findings: a.findings.map(f => ({
      kind: f.kind, severity: f.severity, title: f.title, detail: f.detail,
      atMs: f.startTime, agent: f.agentId, events: cap(f.events ?? [], 12), evidence: f.evidence,
    })),
    fingerprint: { features: a.fingerprint.features },
    warnings: a.trace.warnings,
    computeMs: Math.round(a.computeMs),
    note: "Findings are computed heuristics over the record — descriptive, not proof of intent or correctness. An absent span is missing observation, not inactivity.",
  };
}

/* ---------------- tools ---------------- */
const TOOLS = [
  {
    name: "whalesong_health",
    description: "Whalesong platform status: server version, projects, trace/observation counts. Use first to check the platform is up.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "whalesong_list_traces",
    description: "List recorded agent sessions (traces), newest first. Filter by name substring, source tool (claude, codex, kimi, grok, devin, muse, amp, codewhale), or recent window.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Substring match on trace name" },
        source: { type: "string", description: "Source tool: claude|codex|kimi|grok|devin|muse|amp|codewhale", enum: [...Object.keys(SOURCE_PREFIX)] },
        since_hours: { type: "number", description: "Only traces newer than this many hours ago" },
        limit: { type: "number", default: 20 },
      },
    },
  },
  {
    name: "whalesong_get_trace",
    description: "One trace's detail plus a rollup of its observations: counts by type/category, models, token usage, errors, wall-clock span.",
    inputSchema: {
      type: "object",
      properties: { trace_id: { type: "string", description: "Trace id, e.g. claude:<uuid> or codex:<uuid>" } },
      required: ["trace_id"],
    },
  },
  {
    name: "whalesong_observations",
    description: "Waterfall rows for a trace: id, type (SPAN/GENERATION/EVENT), name, start/end, level, model, usage. Filter by type, name substring or level.",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string" },
        type: { type: "string", enum: ["SPAN", "GENERATION", "EVENT"] },
        name: { type: "string" },
        level: { type: "string", enum: ["DEFAULT", "WARNING", "ERROR"] },
        limit: { type: "number", default: 50 },
        full: { type: "boolean", description: "Include input/output/statusMessage payloads (truncated to 4000 chars each). Needed to see WHY a call failed or what a loop was doing." },
      },
      required: ["trace_id"],
    },
  },
  {
    name: "whalesong_tools",
    description: "Aggregate stats over a recent window across all sessions: calls, errors and total tokens per tool/model/source. The fastest way to answer 'what are my agents actually doing'.",
    inputSchema: {
      type: "object",
      properties: {
        since_hours: { type: "number", default: 24 },
      },
    },
  },
  {
    name: "whalesong_find",
    description: "Search observations across all recent traces by name substring, model, or level (e.g. find every errored tool call today).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        model: { type: "string" },
        level: { type: "string", enum: ["DEFAULT", "WARNING", "ERROR"] },
        since_hours: { type: "number" },
        limit: { type: "number", default: 50 },
      },
    },
  },
  {
    name: "whalesong_analyze",
    description: "Full Whalesong analysis of one session: computed findings (loops, retries, bursts, gaps, context pressure, divergence, spawns), stats, and the deterministic fingerprint. Give a trace_id from the platform, or an absolute path to a session file (Whalesong JSONL, OTLP JSON, Codewhale session JSON, Codewhale runtime JSONL).",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string" },
        path: { type: "string", description: "Absolute path to a trace file" },
      },
    },
  },
  {
    name: "whalesong_compare",
    description: "Compare two sessions deterministically: similarity score, channel/temporal similarity, deltas in duration/tokens/errors/latency/findings, and where the timelines diverge most. Each side takes a trace_id or file path.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "trace_id or file path" },
        b: { type: "string", description: "trace_id or file path" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "whalesong_daily",
    description: "Per-day recorded usage: traces, observations, tokens and cost per model, with coverage flags. Unknown values stay null — never fabricated.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", default: 7, description: "How many recent days to return" } },
    },
  },
  {
    name: "whalesong_listen",
    description: "Render a session to a stereo WAV using Whalesong's deterministic synthesizer: model/reasoning/subagent work becomes sustained harmonic voices, tool/file/network activity becomes short envelopes at fixed category registers, error density becomes beating/dissonance. Meaning lives in density, repetition and transitions — a pleasant chord is not success. Returns the file path; play it with afplay.",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string" },
        path: { type: "string" },
        seconds: { type: "number", default: 30, description: "Output duration; the run is time-compressed into this" },
        out: { type: "string", description: "Output .wav path. Default: ~/.whalesong/renders/" },
      },
    },
  },
  {
    name: "whalesong_rhythm",
    description: "Spectral forensics on a session's onset train: autocorrelation plus Hann-windowed periodogram. Answers 'was this metronomic' with a dominant period in seconds, spectral entropy, and the strongest self-similarity lag — quantifying poll loops and periodic stalls instead of eyeballing them.",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string" },
        path: { type: "string" },
        category: { type: "string", description: "Restrict to one category (tool, reasoning, code, ...)" },
        start_ms: { type: "number", description: "Window start, relative to trace start" },
        end_ms: { type: "number" },
      },
    },
  },
  {
    name: "whalesong_report",
    description: "The shareable numerical report for a session: counts, timings, channel shares, temporal shape, autocorrelation fingerprint, finding kinds — with prompts, payloads, names, ids and absolute timestamps deliberately omitted.",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string" },
        path: { type: "string" },
      },
    },
  },
  {
    name: "whalesong_score",
    description: "Attach a score to a trace after review (feedback/annotation). value may be a number (NUMERIC), boolean (BOOLEAN) or string (CATEGORICAL).",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string" },
        name: { type: "string", description: "Score name, e.g. review-passed" },
        value: { description: "number | boolean | string" },
        comment: { type: "string" },
      },
      required: ["trace_id", "name"],
    },
  },
];
for (const tool of TOOLS) {
  tool.annotations = {
    readOnlyHint: tool.name !== "whalesong_score",
    destructiveHint: false,
    openWorldHint: false,
  };
  tool.inputSchema.additionalProperties = false;
}

/* ---------------- implementations ---------------- */
async function fetchObservations(traceId, { limit = 50, type, name, level } = {}) {
  const q = new URLSearchParams({ traceId, limit: String(Math.min(limit, 1000)) });
  if (type) q.set("type", type);
  if (name) q.set("name", name);
  if (level) q.set("level", level);
  const rows = [];
  let page = 1;
  while (rows.length < limit) {
    q.set("page", String(page));
    const d = await api(`/api/public/observations?${q}`);
    rows.push(...(d.data ?? []));
    if (!d.meta || page >= d.meta.totalPages) break;
    page++;
  }
  return rows.slice(0, limit);
}

const trunc = (v, n = 4000) => {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + `… [${s.length - n} chars truncated]` : s;
};

const obsRow = (o, full = false) => ({
  id: o.id, type: o.type, name: o.name, level: o.level,
  start: o.startTime, end: o.endTime, model: o.metadata?.model ?? o.model ?? undefined,
  usage: o.usage, latency: o.latency, parent: o.parentObservationId,
  category: o.metadata?.whalesong?.category, tool: o.metadata?.whalesong?.tool,
  ...(full ? { statusMessage: o.statusMessage, input: trunc(o.input), output: trunc(o.output) } : {}),
});

async function callTool(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  switch (name) {
    case "whalesong_health": {
      let health = null;
      try { health = await (await fetch(`${URL_BASE}/healthz`)).json(); }
      catch (e) { return resultText({ ok: false, error: `platform unreachable at ${URL_BASE}: ${e.message}`, hint: "launchctl kickstart gui/$(id -u)/ai.whalesong.platform or: npm run platform in WHALESONG_HOME" }); }
      const db = await store().catch(() => null);
      const projects = db ? db.listProjects().map(p => ({
        id: p.id, name: p.name,
        traces: db.get("SELECT count(*) c FROM traces WHERE project_id=?", p.id).c,
        observations: db.get("SELECT count(*) c FROM observations WHERE project_id=?", p.id).c,
      })) : [];
      return resultText({ ok: true, ...health, url: URL_BASE, projects });
    }
    case "whalesong_list_traces": {
      const limit = Math.min(Math.max(1, args.limit ?? 20), 100);
      const q = new URLSearchParams({ limit: String(limit), orderBy: "timestamp.desc" });
      if (args.name) q.set("name", args.name);
      if (args.since_hours != null) q.set("fromTimestamp", new Date(Date.now() - args.since_hours * 3600_000).toISOString());
      const d = await api(`/api/public/traces?${q}`);
      let rows = d.data ?? [];
      if (args.source) rows = rows.filter(t => t.id.startsWith(SOURCE_PREFIX[args.source]));
      return resultText({
        total: d.meta?.totalItems,
        traces: rows.map(t => ({
          id: t.id, name: t.name, at: t.timestamp, source: t.id.split(":")[0],
          observations: Array.isArray(t.observations) ? t.observations.length : t.observations,
          latency: t.latency, cost: t.totalCost,
        })),
      });
    }
    case "whalesong_get_trace": {
      const { observations: _ids, ...t } = await api(`/api/public/traces/${encodeURIComponent(args.trace_id)}`);
      const rows = await fetchObservations(args.trace_id, { limit: 10000 });
      const byType = {}, byCat = {}, models = new Set(), tools = {};
      let input = 0, output = 0, errors = 0, start = Infinity, end = 0;
      for (const o of rows) {
        byType[o.type] = (byType[o.type] ?? 0) + 1;
        const cat = o.metadata?.whalesong?.category ?? "?";
        byCat[cat] = (byCat[cat] ?? 0) + 1;
        if (o.metadata?.whalesong?.tool) tools[o.metadata.whalesong.tool] = (tools[o.metadata.whalesong.tool] ?? 0) + 1;
        const mdl = o.metadata?.model; if (mdl) models.add(mdl);
        input += o.usage?.input ?? 0; output += o.usage?.output ?? 0;
        if (o.level === "ERROR") errors++;
        const s = Date.parse(o.startTime), e = Date.parse(o.endTime ?? o.startTime);
        if (Number.isFinite(s)) start = Math.min(start, s);
        if (Number.isFinite(e)) end = Math.max(end, e);
      }
      return resultText({
        ...t,
        instrumentUrl: `${URL_BASE}/?capture=platform:${t.projectId}:${t.id}`,
        rollup: {
          observations: rows.length, byType, byCategory: byCat, models: [...models],
          topTools: Object.fromEntries(Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 15)),
          tokens: { input, output }, errors,
          spanMs: Number.isFinite(start) ? Math.round(end - start) : null,
        },
      });
    }
    case "whalesong_observations":
      return resultText((await fetchObservations(args.trace_id, args)).map(o => obsRow(o, !!args.full)));
    case "whalesong_tools": {
      const sinceMs = Date.now() - (args.since_hours ?? 24) * 3600_000;
      const db = await store();
      const perTool = db.all(`SELECT json_extract(metadata,'$.whalesong.tool') name, count(*) calls,
        sum(level='ERROR') errors FROM observations
        WHERE project_id=? AND start_ms>=? AND json_extract(metadata,'$.whalesong.tool') IS NOT NULL
        GROUP BY name ORDER BY calls DESC LIMIT 25`, _pid, sinceMs);
      const perModel = db.all(`SELECT COALESCE(model, json_extract(metadata,'$.model')) name, count(*) calls,
        sum(COALESCE(json_extract(usage,'$.input'),0)) input, sum(COALESCE(json_extract(usage,'$.output'),0)) output
        FROM observations WHERE project_id=? AND start_ms>=? AND COALESCE(model, json_extract(metadata,'$.model')) IS NOT NULL
        GROUP BY name ORDER BY output DESC LIMIT 15`, _pid, sinceMs);
      const perSource = db.all(`SELECT substr(trace_id,1,instr(trace_id,':')-1) source, count(*) observations,
        sum(level='ERROR') errors, count(DISTINCT trace_id) traces
        FROM observations WHERE project_id=? AND start_ms>=? GROUP BY source ORDER BY observations DESC`, _pid, sinceMs);
      return resultText({ since_hours: args.since_hours ?? 24, perSource, perModel, perTool });
    }
    case "whalesong_find": {
      const limit = Math.min(Math.max(1, args.limit ?? 50), 500);
      const q = new URLSearchParams({ limit: String(limit) });
      if (args.name) q.set("name", args.name);
      if (args.model) q.set("model", args.model);
      if (args.level) q.set("level", args.level);
      if (args.since_hours != null) q.set("fromTimestamp", new Date(Date.now() - args.since_hours * 3600_000).toISOString());
      const d = await api(`/api/public/observations?${q}`);
      return resultText({ total: d.meta?.totalItems, observations: (d.data ?? []).map(o => ({ traceId: o.traceId, ...obsRow(o) })) });
    }
    case "whalesong_analyze": {
      if (!args.trace_id && !args.path) throw new Error("trace_id or path is required");
      const { analyze } = await core();
      const trace = await loadTrace(args.trace_id ?? args.path);
      return resultText(analysisOut(analyze(trace)));
    }
    case "whalesong_compare": {
      const { analyze, compare } = await core();
      const [ta, tb] = await Promise.all([loadTrace(args.a), loadTrace(args.b)]);
      const aa = analyze(ta), bb = analyze(tb);
      return resultText({
        a: { name: ta.name, events: aa.stats.events, durationMs: aa.stats.duration },
        b: { name: tb.name, events: bb.stats.events, durationMs: bb.stats.duration },
        ...compare(aa, bb),
        note: "Similarity is a descriptive feature comparison, not a success probability.",
      });
    }
    case "whalesong_daily": {
      const days = Math.min(Math.max(1, args.days ?? 7), 90);
      const d = await api(`/api/public/metrics/daily?fromTimestamp=${new Date(Date.now() - days * 86400_000).toISOString()}`);
      return resultText(d);
    }
    case "whalesong_listen": {
      const { signal: { buildPyramid }, audio: { renderPCM, encodeWav } } = await core();
      const trace = await loadTrace(args.trace_id ?? args.path);
      const seconds = Math.min(Math.max(5, args.seconds ?? 30), 300);
      const pcm = renderPCM(buildPyramid(trace.events, trace.duration), 0, trace.duration, trace.duration / (seconds * 1000));
      const dir = args.out ? path.dirname(args.out) : path.join(os.homedir(), ".whalesong", "renders");
      fs.mkdirSync(dir, { recursive: true });
      const file = args.out ?? path.join(dir, `${(args.trace_id ?? trace.name ?? "trace").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60)}-${Date.now()}.wav`);
      fs.writeFileSync(file, encodeWav(pcm));
      return resultText({
        file, durationSeconds: Math.round(pcm.left.length / pcm.sampleRate * 10) / 10,
        sampleRate: pcm.sampleRate, peak: +pcm.peak.toFixed(3), rms: +pcm.rms.toFixed(4),
        play: `afplay "${file}"`,
        vocabulary: {
          "sustained harmonics": "model/reasoning, retrieval, subagent activity",
          "short envelopes at fixed registers": "tool, file, code, browser, network calls",
          "beating / dissonance": "error density",
          "stereo pan": "fixed by category",
        },
        note: "Deterministic render of the signal pyramid — density, repetition and transitions carry meaning. Not a correctness score. A/B comparisons need the same duration.",
      });
    }
    case "whalesong_rhythm": {
      const { signal: { onsetSeries, autocorrelation, periodogram } } = await core();
      const trace = await loadTrace(args.trace_id ?? args.path);
      const start = args.start_ms ?? 0, end = args.end_ms ?? trace.duration;
      if (!(end > start)) throw new Error("empty window");
      const n = 1024, series = onsetSeries(trace.events, start, end, n, args.category);
      const sampleHz = n / ((end - start) / 1000);
      const spec = periodogram(series, sampleHz);
      const ac = autocorrelation(series, Math.min(256, n >> 1));
      const bestLag = ac.indexOf(Math.max(...ac.slice(1))) === 0 ? 0 : ac.slice(1).indexOf(Math.max(...ac.slice(1))) + 1;
      return resultText({
        windowMs: end - start, category: args.category ?? "all", onsets: series.reduce((a, b) => a + b, 0),
        dominantPeriodSeconds: spec.peakHz > 0 ? +(1 / spec.peakHz).toFixed(2) : null,
        peakHz: +spec.peakHz.toFixed(4), spectralEntropy: +spec.entropy.toFixed(3),
        strongestAutocorrLagSeconds: +(bestLag / sampleHz).toFixed(2),
        autocorrAtBestLag: bestLag > 0 ? +ac[bestLag].toFixed(3) : null,
        note: "PeakHz/period describe the onset *train*, not audio pitch. A strong autocorr lag + dominant period = metronomic repetition; high entropy = arrhythmic. Sparse trains can show harmonics.",
      });
    }
    case "whalesong_report": {
      const { analyze, analysisReport } = await core();
      const trace = await loadTrace(args.trace_id ?? args.path);
      return resultText(analysisReport(analyze(trace)));
    }
    case "whalesong_score": {
      if (typeof args.trace_id !== "string" || typeof args.name !== "string") throw new Error("trace_id and name are required strings");
      const v = args.value;
      const body = { traceId: args.trace_id, name: args.name, comment: args.comment };
      if (typeof v === "boolean") { body.dataType = "BOOLEAN"; body.value = v ? 1 : 0; }
      else if (typeof v === "number") { body.dataType = "NUMERIC"; body.value = v; }
      else if (typeof v === "string") { body.dataType = "CATEGORICAL"; body.stringValue = v; }
      else if (v === undefined) { body.dataType = "CATEGORICAL"; body.stringValue = args.comment ?? "reviewed"; }
      else throw new Error("value must be a number, boolean or string");
      return resultText(await api("/api/public/scores", { method: "POST", body }));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ---------------- stdio JSON-RPC ---------------- */
const PROTOCOL_VERSION = "2024-11-05";

async function handle(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const { id, method, params } = msg;
  if (id === undefined) return null;
  switch (method) {
    case "initialize":
      return { id, result: {
        protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "whalesong", version: "0.1.0" },
      } };
    case "notifications/initialized":
    case "initialized":
      return null;
    case "ping":
      return { id, result: {} };
    case "tools/list":
      return { id, result: { tools: TOOLS } };
    case "tools/call":
      try {
        return { id, result: await callTool(params?.name, params?.arguments || {}) };
      } catch (error) {
        return { id, result: { content: [{ type: "text", text: `whalesong error: ${error.message}` }], isError: true } };
      }
    default:
      return { id, error: { code: -32601, message: `method not supported: ${method}` } };
  }
}

let buffer = "", discarding = false;
const emit = res => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...res }) + "\n");
async function lineReceived(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { emit({ id: null, error: { code: -32700, message: "Parse error" } }); return; }
  const res = await handle(msg);
  if (res) emit(res);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  for (const [index, part] of chunk.split("\n").entries()) {
    if (index > 0) {
      if (!discarding) void lineReceived(buffer);
      buffer = ""; discarding = false;
    }
    if (discarding) continue;
    if (Buffer.byteLength(buffer) + Buffer.byteLength(part) > 256 * 1024) {
      buffer = ""; discarding = true;
      emit({ id: null, error: { code: -32600, message: "Request exceeds 256 KiB" } });
    } else buffer += part;
  }
});
process.stdin.on("end", () => { if (buffer && !discarding) void lineReceived(buffer); });
