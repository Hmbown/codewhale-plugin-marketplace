// Parity matrix generator: reads one or more parity run.json dirs and emits
// docs/PARITY_MATRIX.md plus committable summaries in parity/results/.
// Statuses derive mechanically from parity/thresholds.json — never hand-edit.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PARITY = path.join(ROOT, "parity");
const thresholds = JSON.parse(fs.readFileSync(path.join(PARITY, "thresholds.json"), "utf8"));
const REPEATS_REQUIRED = thresholds.repeats_required;

const argv = process.argv.slice(2);
function opts(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === name) out.push(argv[i + 1]);
  return out;
}
const runDirs = opts("--run");
const codexFiles = opts("--codex");
// Surfaces recorded on another machine: their run.json never reaches this
// repo (receipts/ is ignored), but the committed summary is enough to render
// the row, so the document can show every surface at once.
const summaryFiles = opts("--summary");
const modelDirs = opts("--model-trials");
const outputRoot = path.resolve(opts("--out")[0] ?? ROOT);

if (!runDirs.length && !summaryFiles.length && !modelDirs.length) {
  console.error("usage: node scripts/parity-matrix.mjs --run <run-dir> [--summary <results.json>...] [--codex <file>...] [--model-trials <dir>...] [--out <output-dir>]");
  process.exit(2);
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Codex baseline files: parity/results/codex-*.json mapping task id ->
// {successes, repeats, elapsed_ms, tool_calls, interruptions, notes}
const codex = {};
for (const f of codexFiles) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const data = j.tasks ?? j;
  for (const [k, v] of Object.entries(data)) codex[k] = v;
}
const codexAvailable = codexFiles.length > 0;

/** Task metadata comes from the suite the run actually executed. */
const taskDocs = new Map();
function metaForRun(run) {
  const file = run.meta.tasks_file ?? "tasks.json";
  if (typeof file !== "string" || !/^tasks(?:\.[a-z0-9-]+)*\.json$/.test(file)) throw new Error("invalid tasks_file in run metadata");
  if (path.dirname(fs.realpathSync(path.join(PARITY, file))) !== fs.realpathSync(PARITY)) throw new Error("tasks_file must remain in the parity directory");
  if (!taskDocs.has(file)) {
    const doc = JSON.parse(fs.readFileSync(path.join(PARITY, file), "utf8"));
    taskDocs.set(file, new Map(doc.tasks.map((t) => [t.id, t])));
  }
  return taskDocs.get(file);
}

function statusFor(successes, attempts, skippedAll, codexSucc) {
  // status_rules from thresholds.json, implemented literally.
  if (attempts === 0 || skippedAll) return "untested";
  if (successes === 0) return "missing";
  if (successes === REPEATS_REQUIRED && (codexSucc == null || codexSucc <= successes)) return "demonstrated";
  if (successes >= 1 && successes < REPEATS_REQUIRED) return "partial";
  if (successes === REPEATS_REQUIRED && codexSucc != null && codexSucc > successes) return "partial";
  return "missing";
}

const lines = [];
const summaries = [];
const summaryCounts = new Map();
/** surface -> evidence sentence; anything absent stays untested. */
const surfaces = new Map();

for (const dir of runDirs) {
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const meta = run.meta;
  for (const field of ["platform", "session_type"]) {
    if (typeof meta?.[field] !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(meta[field])) throw new Error(`invalid ${field} in run metadata`);
  }
  if (typeof meta.date !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(meta.date) || !Number.isFinite(Date.parse(meta.date)) || new Date(meta.date).toISOString().slice(0, 10) !== meta.date.slice(0, 10)) throw new Error("invalid date in run metadata");
  const surface = `${meta.platform}-${meta.session_type}${meta.isolated ? " (isolated)" : ""}`;
  const repsByTask = new Map();
  for (const r of run.reps) {
    if (!repsByTask.has(r.task)) repsByTask.set(r.task, []);
    repsByTask.get(r.task).push(r);
  }

  lines.push(`# Parity matrix — ${surface}`);
  lines.push("");
  lines.push(`- commit: \`${meta.codewhale_commit}\`${meta.git_dirty ? " (dirty)" : ""}`);
  lines.push(`- node ${meta.node}; ${meta.os}${meta.macos ? ` (macOS ${meta.macos})` : ""}; display \`${meta.display}\` geometry ${meta.display_geometry}`);
  lines.push(`- suite: \`parity/${meta.tasks_file ?? "tasks.json"}\`; chrome: ${meta.chrome}; python3: ${meta.python3}; ${meta.tk ? `tk: ${meta.tk}` : `native fixture: ${meta.native_fixture ?? "-"}`}`);
  lines.push(`- date: ${meta.date}; repeats: ${meta.repeats}`);
  lines.push(`- Codex baseline: ${codexAvailable ? "provided" : meta.codex?.available ? "merged in run" : "untested (no codex results)"}`);
  lines.push("");
  lines.push("| task | issue | Codewhale | Codex | status | median elapsed | median tool calls | pointer displacement | foreground | notes |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");

  const resultJson = { platform: surface, date: meta.date, commit: meta.codewhale_commit, git_dirty: meta.git_dirty === true, tasks: {} };

  const taskMeta = metaForRun(run);
  // A filtered run cannot erase unexecuted tasks from the qualification table.
  for (const taskId of taskMeta.keys()) if (!repsByTask.has(taskId)) repsByTask.set(taskId, []);
  for (const [taskId, reps] of [...repsByTask.entries()].sort()) {
    const t = taskMeta.get(taskId);
    const ok = reps.filter((r) => r.status === "ok").length;
    const skipped = reps.filter((r) => r.status === "skipped");
    const failed = reps.filter((r) => r.status === "failed");
    const attempts = reps.length;
    const cx = codex[taskId];
    const status = statusFor(ok, attempts, attempts > 0 && skipped.length === attempts, cx?.successes ?? null);
    const medElapsed = median(reps.map((r) => r.elapsed_ms).filter((x) => x != null));
    const medCalls = median(reps.map((r) => r.toolCalls).filter((x) => x != null));
    // interference_actions spans the agent's tool calls only; the whole-rep
    // number also contains the runner launching and killing the fixture.
    const actions = reps.map((r) => r.interference_actions ?? r.interference).filter(Boolean);
    const medDrift = median(actions.map((r) => r.pointer_displacement_px).filter((x) => x != null));
    const winChange = actions.some((r) => r.active_window_changed);
    const fgChanged = actions.filter((r) => r.active_window_changed).length;
    const notes = [];
    if (!attempts) notes.push("not executed in this run");
    if (skipped.length) notes.push(`skipped: ${[...new Set(skipped.map((r) => r.reason ?? ""))].join("; ").slice(0, 80)}`);
    if (failed.length) notes.push(`fail: ${[...new Set(failed.map((r) => `step${r.failStep} ${r.failReason ?? ""}`))].join("; ").slice(0, 120)}`);
    if (t?.optional_a11y) notes.push("optional_a11y");
    const surfaceKey = `${meta.platform}-${meta.session_type}`;
    const kl = t?.known_limitations?.[surfaceKey] ?? t?.known_limitations?.["*"];
    if (kl) notes.push(`known limitation: ${kl}`);
    const fg = attempts ? (fgChanged === 0 ? "preserved" : `taken ${fgChanged}/${attempts}`) : "-";
    lines.push(`| ${taskId} | #${t?.issue ?? "?"} | ${ok}/${attempts} | ${cx ? `${cx.successes}/${cx.repeats}` : "untested"} | ${status} | ${medElapsed ?? "-"}ms | ${medCalls ?? "-"} | ${medDrift ?? "-"}px | ${fg} | ${notes.join(" · ") || "-"} |`);
    resultJson.tasks[taskId] = { issue: t?.issue, successes: ok, attempts, skipped: skipped.length, status, median_elapsed_ms: medElapsed, median_tool_calls: medCalls, pointer_displacement_px: medDrift, foreground_taken_reps: fgChanged, notes: notes.join(" · ") || null };
  }

  lines.push("");

  // Surface evidence for the Platforms table, derived from this run only.
  const demonstrated = [...repsByTask.values()].filter((reps) => reps.length === REPEATS_REQUIRED && reps.every((r) => r.status === "ok")).length;
  const scale = /@(\d+(?:\.\d+)?)x/.exec(meta.display_geometry ?? "")?.[1];
  if (meta.platform === "darwin") {
    const key = scale && Number(scale) > 1 ? "macOS Retina" : "macOS non-Retina";
    const evidence = `${demonstrated}/${repsByTask.size} tasks demonstrated at ${meta.repeats} repeats (${surface}, ${meta.date.slice(0, 10)})`;
    surfaces.set(key, surfaces.has(key) ? `${surfaces.get(key)}; separate run: ${evidence}` : evidence);
  }
  if (meta.platform === "linux") {
    surfaces.set(meta.session_type === "wayland" ? "Wayland" : "Linux X11",
      `${demonstrated}/${repsByTask.size} tasks demonstrated at ${meta.repeats} repeats (${surface}, ${meta.date.slice(0, 10)})`);
  }
  if (meta.platform === "win32") {
    surfaces.set("Windows",
      `${demonstrated}/${repsByTask.size} tasks demonstrated at ${meta.repeats} repeats (${surface}, ${meta.date.slice(0, 10)})`);
  }

  const day = meta.date.slice(0, 10);
  const stem = `${meta.platform}-${meta.session_type}${meta.isolated ? "-isolated" : ""}-${day}`;
  const count = (summaryCounts.get(stem) ?? 0) + 1;
  summaryCounts.set(stem, count);
  // Preserve every run supplied, including failed attempts and focused retries.
  const outFile = path.join(outputRoot, "parity", "results", `${stem}${count > 1 ? `-run${count}` : ""}.json`);
  if (path.dirname(outFile) !== path.join(outputRoot, "parity", "results")) throw new Error("report filename escaped results directory");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(resultJson, null, 2));
  summaries.push(outFile);
}

// Model comparisons use the same matrix/output workflow, but never promote
// tool availability, model narration or unchecked runner `ok` into success.
for (const [index, dir] of modelDirs.entries()) {
  const { qualifyModelTrials } = await import("./lib/model-trials.mjs");
  const result = qualifyModelTrials(dir, REPEATS_REQUIRED);
  if (!result.eligible) process.exitCode = 1;
  lines.push("# Model trial eligibility", "", result.scope, "");
  lines.push(`- receipt rows: ${result.receipt_rows}; required repeats: ${REPEATS_REQUIRED}`);
  lines.push(`- gate: ${result.eligible ? "eligible fixture outcomes" : "not qualified"}`);
  if (result.errors.length) lines.push(`- evidence errors: ${result.errors.join(", ")}`);
  lines.push("", "| task | surface | mode | raw fixture passes | valid passes | valid failures | excluded | missing |",
    "|---|---|---|---|---|---|---|---|---|");
  for (const row of result.summary) {
    lines.push(`| ${row.task} | ${row.surface} | ${row.mode} | ${row.fixture_passes}/${row.attempts} | ${row.successes} | ${row.failures} | ${row.excluded} | ${row.missing} |`);
  }
  lines.push("", "| receipt row | task | surface | mode | trial | fixture outcome | eligibility | exclusions |",
    "|---|---|---|---|---|---|---|---|");
  for (const row of result.trials) {
    lines.push(`| ${row.row} | ${row.task ?? "unknown"} | ${row.surface ?? "unknown"} | ${row.mode ?? "unknown"} | ${row.trial ?? "unknown"} | ${row.fixture_outcome} | ${row.status} | ${row.exclusions.join(", ") || "-"} |`);
  }
  lines.push("");
  const outFile = path.join(outputRoot, "parity", "results", `model-trials-${index + 1}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  summaries.push(outFile);
}

// ---------- previously recorded surfaces, rendered from their summaries ----------
for (const file of summaryFiles) {
  const prior = JSON.parse(fs.readFileSync(file, "utf8"));
  lines.push(`# Parity matrix — ${prior.platform}`);
  lines.push("");
  lines.push(`- commit: \`${prior.commit}\`; date: ${prior.date}`);
  lines.push(`- rendered from the committed summary \`${path.relative(ROOT, file)}\` (run recorded on another host)`);
  lines.push("");
  lines.push("| task | issue | Codewhale | status | median elapsed | median tool calls | pointer displacement | notes |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const [id, t] of Object.entries(prior.tasks).sort()) {
    lines.push(`| ${id} | #${t.issue ?? "?"} | ${t.successes}/${t.attempts} | ${t.status} | ${t.median_elapsed_ms ?? "-"}ms | ${t.median_tool_calls ?? "-"} | ${t.pointer_displacement_px ?? "-"}px | ${t.notes ?? "-"} |`);
  }
  lines.push("");
  const demonstrated = Object.values(prior.tasks).filter((t) => t.status === "demonstrated").length;
  const key = prior.platform.startsWith("linux") ? (prior.platform.includes("wayland") ? "Wayland" : "Linux X11") : prior.platform.startsWith("win32") ? "Windows" : prior.platform;
  if (!surfaces.has(key)) {
    surfaces.set(key, `${demonstrated}/${Object.keys(prior.tasks).length} tasks demonstrated (${prior.platform}, ${prior.date.slice(0, 10)})`);
  }
}

// ---------- one Platforms table for every surface, at the end ----------
lines.push("## Platforms");
lines.push("");
lines.push("| surface | status |");
lines.push("|---|---|");
for (const surface of [
  "macOS Retina", "macOS non-Retina", "macOS mixed", "Linux X11", "Wayland", "Windows",
  "HarmonyOS (hdc)", "SSH remote", "Codex / Claude Desktop fresh session",
  "signed-update permission persistence",
]) {
  // Surfaces this generator cannot measure defer to LIMITATIONS rather than
  // asserting anything: two files disagreeing is itself a defect.
  lines.push(`| ${surface} | ${surfaces.get(surface) ?? "untested — see docs/LIMITATIONS.md"} |`);
}
lines.push("");

const md = path.join(outputRoot, "docs", "PARITY_MATRIX.md");
fs.mkdirSync(path.dirname(md), { recursive: true });
fs.writeFileSync(md, lines.join("\n").trimEnd() + "\n");
console.log(`wrote ${md}`);
for (const s of summaries) console.log(`wrote ${s}`);
