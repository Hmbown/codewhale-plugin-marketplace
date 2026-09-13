import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const script = path.resolve("scripts/check-receipts.mjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-receipt-scan-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function scan(target) {
  return spawnSync(process.execPath, [script, target], { encoding: "utf8" });
}

test("receipt gate rejects a credential in a nested model stream without printing its content", (t) => {
  const dir = fixture(t);
  const logs = path.join(dir, "trials");
  fs.mkdirSync(logs);
  const file = path.join(logs, "model.JSONL");
  const token = "sk-synthetic-regression-canary";
  const privateText = "PRIVATE_FIXTURE_CONTEXT";
  fs.writeFileSync(file, JSON.stringify({ role: "assistant", content: "safe fixture" }) + "\n"
    + JSON.stringify({ role: "tool", content: `${token} ${privateText}` }) + "\n");

  for (const target of [dir, file]) {
    const result = scan(target);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout.includes(`${file}:2: api key`));
    assert.ok(!(result.stdout + result.stderr).includes(token));
    assert.ok(!(result.stdout + result.stderr).includes(privateText));
  }
});

test("receipt diagnostics retain file and line without echoing JSON or Markdown evidence", (t) => {
  const dir = fixture(t);
  const token = "ghp_SYNTHETICREGRESSIONCANARY";
  const privateText = "PRIVATE_FIXTURE_CONTEXT";
  for (const name of ["run.json", "notes.md"]) {
    fs.writeFileSync(path.join(dir, name), `safe line\n${token} ${privateText}\n`);
  }
  const result = scan(dir);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stdout.includes("run.json:2: github token"));
  assert.ok(result.stdout.includes("notes.md:2: github token"));
  assert.ok(!(result.stdout + result.stderr).includes(token));
  assert.ok(!(result.stdout + result.stderr).includes(privateText));
});

test("sanitized JSONL receipts pass the release hygiene gate", (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, "model.jsonl"), JSON.stringify({
    role: "tool", content: { task: "entry_apply", oracle: { applied: "Ada Lovelace" } },
  }) + "\n");
  const result = scan(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "check-receipts: clean");
});

test("generic CI account prose passes while home paths and credentials still fail", t => {
  const dir = fixture(t), file = path.join(dir, "notes.md");
  const run = () => spawnSync(process.execPath, ["--input-type=module", "-e", `
    import os from "node:os";
    os.userInfo = () => ({ username: "runner" });
    os.homedir = () => "/home/runner";
    process.argv = [process.execPath, ${JSON.stringify(script)}, ${JSON.stringify(dir)}];
    await import(${JSON.stringify(pathToFileURL(script).href)});
  `], { encoding: "utf8" });
  fs.writeFileSync(file, "The parity runner records a fixture result.\n");
  assert.equal(run().status, 0);
  for (const evidence of ["/home/runner/private/file", "sk-synthetic-ci-canary"]) {
    fs.writeFileSync(file, evidence);
    const result = run();
    assert.equal(result.status, 1);
    assert.ok(!result.stdout.includes(evidence));
  }
});
