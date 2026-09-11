import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("a filtered parity run reports unexecuted tasks and requires all five repetitions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cu-matrix-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "parity", "run"]) fs.mkdirSync(path.join(root, dir));
  for (const file of ["scripts/parity-matrix.mjs", "parity/thresholds.json"]) fs.copyFileSync(file, path.join(root, file));
  fs.writeFileSync(path.join(root, "parity/tasks.json"), JSON.stringify({ tasks: [
    { id: "browser.verified", issue: 1 }, { id: "browser.partial", issue: 2 }, { id: "browser.unexecuted", issue: 3 },
  ] }));
  fs.writeFileSync(path.join(root, "run/run.json"), JSON.stringify({
    meta: { platform: "darwin", session_type: "aqua", date: "2026-09-07", repeats: 5, display_geometry: "100x100@2x", codewhale_commit: "fixture" },
    reps: [...Array.from({ length: 5 }, () => ({ task: "browser.verified", status: "ok" })), { task: "browser.partial", status: "ok" }],
  }));
  fs.mkdirSync(path.join(root, "retry"));
  const retry = JSON.parse(fs.readFileSync(path.join(root, "run/run.json"), "utf8"));
  retry.meta.git_dirty = true;
  retry.reps = Array.from({ length: 5 }, () => ({ task: "browser.partial", status: "ok" }));
  fs.writeFileSync(path.join(root, "retry/run.json"), JSON.stringify(retry));
  const result = spawnSync(process.execPath, ["scripts/parity-matrix.mjs", "--run", "run", "--run", "retry"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(root, "parity/results/darwin-aqua-2026-09-07.json"), "utf8"));
  assert.equal(summary.tasks["browser.verified"].status, "demonstrated");
  assert.equal(summary.tasks["browser.partial"].status, "partial");
  assert.equal(summary.tasks["browser.unexecuted"].status, "untested");
  assert.equal(summary.tasks["browser.unexecuted"].attempts, 0);
  const second = JSON.parse(fs.readFileSync(path.join(root, "parity/results/darwin-aqua-2026-09-07-run2.json"), "utf8"));
  assert.equal(second.tasks["browser.partial"].status, "demonstrated");
  assert.equal(second.tasks["browser.verified"].status, "untested");
  assert.equal(second.git_dirty, true);
  const matrix = fs.readFileSync(path.join(root, "docs/PARITY_MATRIX.md"), "utf8");
  assert.match(matrix, /1\/3 tasks demonstrated/);
  assert.match(matrix, /not executed in this run/);
  assert.match(matrix, /separate run:/);
});
