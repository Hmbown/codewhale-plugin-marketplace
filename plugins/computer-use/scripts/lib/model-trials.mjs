// Read-only eligibility for model receipts, consumed by the existing matrix.
// Never return receipt bodies, tool arguments/results, or parser error text.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkExpect, observation } from "./parity-oracle.mjs";

const PARITY = fileURLToPath(new URL("../../parity/", import.meta.url));
const suite = JSON.parse(fs.readFileSync(path.join(PARITY, "tasks.model-native.json"), "utf8"));
const tasks = new Map(suite.tasks.map((task) => [task.id, task]));
const surfaces = ["codewhale", "kimi"];
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function modelProfile(surface) {
  if (!surfaces.includes(surface)) throw new Error("unknown model surface");
  const text = fs.readFileSync(path.join(PARITY, "agents", `${surface}-native.md`), "utf8");
  // JSON frontmatter is a YAML subset; one allowlist serves host and gate.
  return JSON.parse(text.split("---")[1]);
}

function readArtifact(dir, name) {
  try {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) return { error: "unreadable" };
    const bytes = fs.readFileSync(file);
    return { text: bytes.toString("utf8"), sha256: hash(bytes) };
  } catch { return { error: "missing" }; }
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

function hasImage(value, depth = 0) {
  if (depth > 32) throw new Error("nested trace");
  if (typeof value === "string") {
    const parsed = parseJSON(value);
    return parsed !== undefined && typeof parsed !== "string" && hasImage(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.some((item) => hasImage(item, depth + 1));
  if (!object(value)) return false;
  if (["image", "image_url"].includes(value.type) || value.mimeType?.startsWith?.("image/")) return true;
  return Object.values(value).some((item) => hasImage(item, depth + 1));
}

function inspectTrace(text, allowed, mode, reasons) {
  const pending = new Set(), seen = new Set();
  let calls = 0, final = false, image = false, imageBeforeAction = false;
  const observe = new Set(["open_application", "get_app_state", "screenshot", "zoom", "wait"]);
  try {
    for (const line of text.split("\n").filter((line) => line.trim())) {
      const event = parseJSON(line);
      if (!object(event) || !["meta", "system", "user", "assistant", "tool"].includes(event.role)) {
        reasons.add("malformed_trace"); continue;
      }
      if (event.tool_calls !== undefined && !Array.isArray(event.tool_calls)) {
        reasons.add("malformed_trace"); continue;
      }
      for (const call of event.tool_calls ?? []) {
        final = false; calls++;
        if (event.role !== "assistant" || !object(call) || typeof call.id !== "string" || seen.has(call.id)) {
          reasons.add("malformed_trace"); continue;
        }
        seen.add(call.id); pending.add(call.id);
        const name = call.function?.name;
        if (!allowed.has(name)) reasons.add("disallowed_tool");
        const args = parseJSON(call.function?.arguments);
        if (!object(args)) reasons.add("malformed_trace");
        const short = typeof name === "string" ? name.split("__").at(-1) : "";
        if (mode === "text" && (["screenshot", "zoom"].includes(short)
            || (short === "get_app_state" && ["image", "full"].includes(args?.mode)))) reasons.add("image_in_text_trial");
        if (image && allowed.has(name) && !observe.has(short)) imageBeforeAction = true;
      }
      if (event.role === "tool") {
        if (!pending.delete(event.tool_call_id)) reasons.add("unmatched_tool_result");
        if (hasImage(event.content)) image = true;
      }
      if (event.role === "assistant" && !event.tool_calls?.length && typeof event.content === "string"
          && event.content.trim() && pending.size === 0) final = true;
    }
  } catch { reasons.add("malformed_trace"); }
  if (!calls) reasons.add("no_tool_calls");
  if (pending.size) reasons.add("missing_tool_result");
  if (!final) reasons.add("missing_final_response");
  if (mode === "text" && image) reasons.add("image_in_text_trial");
  if (mode === "vision" && !imageBeforeAction) reasons.add("missing_vision_action");
  return calls;
}

export function qualifyModelTrials(dir, repeats) {
  const receiptFile = readArtifact(dir, "receipts.jsonl");
  const errors = [], rows = [], groups = new Map();
  if (receiptFile.error) errors.push("missing_or_unreadable_receipts");
  const records = (receiptFile.text ?? "").split("\n").filter((line) => line.trim()).map(parseJSON);
  const profiles = new Map(surfaces.map((surface) => [surface, new Set(modelProfile(surface).tools)]));
  for (const [index, receipt] of records.entries()) {
    // Only declared identifiers may enter artifact paths or public output.
    if (!object(receipt) || !tasks.has(receipt.task) || !surfaces.includes(receipt.surface)
        || !Number.isInteger(receipt.trial) || receipt.trial < 1 || receipt.trial > repeats
        || (receipt.mode !== undefined && !suite.modes.includes(receipt.mode))) {
      errors.push("invalid_receipt");
      rows.push({ row: index + 1, status: "excluded", fixture_outcome: "unknown", exclusions: ["invalid_receipt"] });
      continue;
    }
    const { task, surface, trial } = receipt;
    const mode = receipt.mode ?? "unknown";
    const key = `${task}/${surface}/${mode}/${trial}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ receipt, row: index + 1 });
  }
  for (const group of groups.values()) {
    const { receipt, row } = group.at(-1);
    const { task, surface, trial } = receipt;
    const mode = receipt.mode ?? "unknown", reasons = new Set();
    if (group.length !== 1) reasons.add("duplicate_trial");
    if (mode === "unknown") reasons.add("missing_mode");
    if (receipt.timeout !== false) reasons.add(receipt.timeout === true ? "timeout" : "unknown_timeout");
    if (receipt.exit_code !== 0) reasons.add(Number.isInteger(receipt.exit_code) ? "process_failed" : "unknown_process_exit");
    if (receipt.error || receipt.stderr) reasons.add("runner_error");
    // Legacy artifacts omit mode in both the receipt and filename. They can
    // expose fixture outcomes, but absent mode/exit evidence cannot qualify.
    const stem = `${task}-${surface}-${mode === "unknown" ? "" : `${mode}-`}${trial}`;
    const log = readArtifact(dir, `log-${stem}.jsonl`);
    const oracle = readArtifact(dir, `state-${stem}.json`);
    if (log.error) reasons.add("missing_or_unreadable_trace");
    if (oracle.error) reasons.add("missing_or_unreadable_oracle");
    const calls = inspectTrace(log.text ?? "", profiles.get(surface), mode, reasons);
    if (!Number.isInteger(receipt.tool_calls) || receipt.tool_calls !== calls) reasons.add("trace_call_count_mismatch");
    const state = parseJSON(oracle.text), expect = tasks.get(task).expect;
    let outcome = "unknown";
    if (!object(state) || !observation(state, expect.path).present) reasons.add("missing_oracle_observation");
    else outcome = checkExpect(expect, state) ? "passed" : "failed";
    if (!object(receipt.oracle) || !observation(receipt.oracle, expect.path).present) reasons.add("missing_recorded_oracle");
    else if (object(state) && Object.entries(receipt.oracle).some(([name, value]) =>
      JSON.stringify(state[name]) !== JSON.stringify(value))) reasons.add("oracle_mismatch");
    rows.push({ row, task, surface, mode, trial, receipt_rows: group.length,
      status: reasons.size ? "excluded" : "valid", fixture_outcome: outcome,
      exclusions: [...reasons].sort(), tool_calls: calls,
      trace_sha256: log.sha256 ?? null, oracle_sha256: oracle.sha256 ?? null });
  }
  const summary = [];
  const modes = rows.some((row) => row.mode === "unknown") ? [...suite.modes, "unknown"] : suite.modes;
  for (const task of tasks.keys()) for (const surface of surfaces) for (const mode of modes) {
    const matching = rows.filter((row) => row.task === task && row.surface === surface && row.mode === mode);
    const valid = matching.filter((row) => row.status === "valid");
    summary.push({ task, surface, mode, attempts: matching.length,
      fixture_passes: matching.filter((row) => row.fixture_outcome === "passed").length,
      successes: valid.filter((row) => row.fixture_outcome === "passed").length,
      failures: valid.filter((row) => row.fixture_outcome === "failed").length,
      excluded: matching.length - valid.length, missing: repeats - matching.length });
  }
  return { kind: "model-trial-eligibility", receipts_sha256: receiptFile.sha256 ?? null,
    receipt_rows: records.length, repeats_required: repeats,
    eligible: errors.length === 0 && rows.every((row) => row.status === "valid")
      && summary.every((row) => row.successes === repeats),
    scope: "Fixture eligibility only; host isolation, model equivalence, exact-source and package qualification require separate proof.",
    errors: [...new Set(errors)], summary, trials: rows };
}
