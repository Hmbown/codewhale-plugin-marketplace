import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { qualifyModelTrials, modelProfile } from "../scripts/lib/model-trials.mjs";
import { checkExpect } from "../scripts/lib/parity-oracle.mjs";

const script = path.resolve("scripts/parity-matrix.mjs");
const suite = JSON.parse(fs.readFileSync("parity/tasks.model-native.json", "utf8"));
const prefix = (surface) => surface === "codewhale" ? "mcp__plugin-codewhale-computer-use_computer__" : "mcp__plugin-kimi-cu_mac__";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-model-evidence-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function evidence(dir, { task = "entry_apply", surface = "codewhale", mode = "text", trial = 1, overrides = {}, extra = [] } = {}) {
  const expect = suite.tasks.find((entry) => entry.id === task).expect;
  const oracle = { [expect.path]: "contains" in expect ? [expect.contains] : expect.equals };
  const receipt = { task, surface, mode, trial, oracle, timeout: false, exit_code: 0, ok: true, ...overrides };
  const stem = `${task}-${surface}-${mode}-${trial}`;
  const call = (id, name, args = {}) => ({ role: "assistant", tool_calls: [{ id, function: { name: prefix(surface) + name, arguments: JSON.stringify(args) } }] });
  const response = (id, content = "fixture observation") => ({ role: "tool", tool_call_id: id, content });
  const trace = [call("observe", "get_app_state", surface === "kimi" ? { mode: mode === "vision" ? "full" : "ax" } : {}),
    response("observe", mode === "vision" ? [{ type: "image_url", image_url: { url: "data:image/png;base64,synthetic" } }] : "fixture observation"),
    call("act", surface === "kimi" ? "click" : "left_click"), response("act"), ...extra,
    { role: "assistant", content: "DONE fixture outcome observed" }];
  receipt.tool_calls ??= trace.reduce((count, event) => count + (event.tool_calls?.length ?? 0), 0);
  const log = path.join(dir, `log-${stem}.jsonl`), state = path.join(dir, `state-${stem}.json`);
  fs.writeFileSync(log, trace.map((event) => JSON.stringify(event)).join("\n") + "\n");
  fs.writeFileSync(state, JSON.stringify(oracle));
  fs.appendFileSync(path.join(dir, "receipts.jsonl"), JSON.stringify(receipt) + "\n");
  return { receipt, log, state, trace };
}

test("matrix accepts complete fixture evidence for both surfaces and modes without a provider", (t) => {
  const dir = fixture(t);
  for (const task of suite.tasks) for (const surface of ["codewhale", "kimi"]) for (const mode of suite.modes) {
    for (let trial = 1; trial <= 5; trial++) evidence(dir, { task: task.id, surface, mode, trial });
  }
  const out = path.join(dir, "report");
  const result = spawnSync(process.execPath, [script, "--model-trials", dir, "--out", out], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "parity/results/model-trials-1.json"), "utf8"));
  assert.equal(report.eligible, true);
  assert.equal(report.trials.length, 120);
  assert.ok(report.summary.every((row) => row.successes === 5 && row.excluded === 0));
  assert.match(fs.readFileSync(path.join(out, "docs/PARITY_MATRIX.md"), "utf8"), /eligible fixture outcomes/);
});

test("timeout and disallowed trace calls cannot count even when runner and oracle say success", (t) => {
  const dir = fixture(t);
  const canary = "sk-synthetic-private-canary";
  evidence(dir, { trial: 1, overrides: { timeout: true, stderr: canary } });
  const cleanCalls = Array.from({ length: 60 }, (_, i) => [
    { role: "assistant", tool_calls: [{ id: `wait-${i}`, function: { name: prefix("codewhale") + "wait", arguments: "{}" } }] },
    { role: "tool", tool_call_id: `wait-${i}`, content: "ok" },
  ]).flat();
  evidence(dir, { trial: 2, overrides: { tool_names: Array(60).fill("cw:wait") }, extra: [...cleanCalls,
    { role: "assistant", tool_calls: [{ id: "forbidden", function: { name: "Bash", arguments: JSON.stringify({ command: canary }) } }] },
    { role: "tool", tool_call_id: "forbidden", content: canary },
  ] });
  const out = path.join(dir, "report");
  const result = spawnSync(process.execPath, [script, "--model-trials", dir, "--out", out], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  const reportText = fs.readFileSync(path.join(out, "parity/results/model-trials-1.json"), "utf8");
  const report = JSON.parse(reportText);
  assert.equal(report.eligible, false);
  assert.ok(report.trials.every((row) => row.status === "excluded" && row.fixture_outcome === "passed"));
  assert.ok(report.trials[0].exclusions.includes("timeout"));
  assert.ok(report.trials[1].exclusions.includes("disallowed_tool"));
  const markdown = fs.readFileSync(path.join(out, "docs/PARITY_MATRIX.md"), "utf8");
  assert.ok(!(reportText + markdown + result.stdout + result.stderr).includes(canary));
  assert.ok(report.summary.every((row) => row.successes === 0));
});

test("missing, mismatched, duplicate and unfinished evidence stays excluded", (t) => {
  const dir = fixture(t);
  const absent = evidence(dir, { trial: 1 }); fs.unlinkSync(absent.state);
  const changed = evidence(dir, { trial: 2 }); fs.writeFileSync(changed.state, JSON.stringify({ applied: "other" }));
  evidence(dir, { trial: 3 }); evidence(dir, { trial: 3 });
  const unfinished = evidence(dir, { trial: 4 }); fs.writeFileSync(unfinished.log, JSON.stringify(unfinished.trace[0]) + "\n");
  evidence(dir, { trial: 5, overrides: { exit_code: undefined } });
  const result = qualifyModelTrials(dir, 5);
  const reasons = result.trials.flatMap((row) => row.exclusions);
  for (const reason of ["missing_or_unreadable_oracle", "oracle_mismatch", "duplicate_trial", "missing_tool_result", "missing_final_response", "unknown_process_exit"]) assert.ok(reasons.includes(reason), reason);
  assert.ok(result.trials.every((row) => row.status === "excluded"));
});

test("text image use and vision without an image-based action cannot qualify", (t) => {
  const dir = fixture(t);
  const text = evidence(dir, { surface: "kimi", trial: 1 });
  text.trace[0].tool_calls[0].function.arguments = JSON.stringify({ mode: "full" });
  fs.writeFileSync(text.log, text.trace.map(JSON.stringify).join("\n"));
  const vision = evidence(dir, { mode: "vision", trial: 2 });
  vision.trace[1].content = "text only";
  fs.writeFileSync(vision.log, vision.trace.map(JSON.stringify).join("\n"));
  const result = qualifyModelTrials(dir, 5);
  assert.ok(result.trials.find((row) => row.mode === "text").exclusions.includes("image_in_text_trial"));
  assert.ok(result.trials.find((row) => row.mode === "vision").exclusions.includes("missing_vision_action"));
});

test("failed fixture outcomes remain valid failures and missing observations never satisfy a negative oracle", (t) => {
  const dir = fixture(t);
  const sample = evidence(dir, { overrides: { oracle: { applied: "wrong" }, ok: true } });
  fs.writeFileSync(sample.state, JSON.stringify({ applied: "wrong" }));
  const result = qualifyModelTrials(dir, 5);
  assert.equal(result.trials[0].status, "valid");
  assert.equal(result.trials[0].fixture_outcome, "failed");
  assert.equal(result.eligible, false);
  assert.equal(result.summary[0].successes, 0);
  assert.equal(result.summary[0].failures, 1);
  assert.equal(checkExpect({ path: "submitted.value", not_equals: "forbidden" }, {}), false);
});

test("malformed identifiers, trace bodies and symlinked oracles fail without exposing evidence", (t) => {
  const dir = fixture(t), canary = "sk-synthetic-private-canary";
  const sample = evidence(dir);
  fs.writeFileSync(sample.log, canary);
  fs.unlinkSync(sample.state);
  const privateFile = path.join(dir, "private.json"); fs.writeFileSync(privateFile, canary);
  fs.symlinkSync(privateFile, sample.state);
  fs.appendFileSync(path.join(dir, "receipts.jsonl"), JSON.stringify({ ...sample.receipt, task: `../${canary}` }) + "\n");
  const result = qualifyModelTrials(dir, 5);
  assert.equal(result.eligible, false);
  assert.ok(result.errors.includes("invalid_receipt"));
  assert.ok(result.trials.flatMap((row) => row.exclusions).includes("malformed_trace"));
  assert.ok(result.trials.flatMap((row) => row.exclusions).includes("missing_or_unreadable_oracle"));
  assert.ok(!JSON.stringify(result).includes(canary));
});

test("future Kimi agent profiles expose only explicit tools on their selected CU surface", () => {
  for (const surface of ["codewhale", "kimi"]) {
    const profile = modelProfile(surface);
    assert.deepEqual(profile.subagents, []);
    assert.ok(profile.tools.length > 0);
    assert.ok(profile.tools.every((name) => name.startsWith(prefix(surface)) && !name.includes("*")));
    assert.ok(!profile.tools.some((name) => /recording|clipboard|computer_switch|computer_register|list_apps/.test(name)));
  }
});
