import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(SAMPLES, ...p), "utf8");
const json = (...p) => JSON.parse(read(...p));

// The Claude manifest schema Codewhale parses is closed (unknown keys are
// rejected), so the sample must stay inside this set.
const CLAUDE_KEYS = new Set(["name", "version", "description", "keywords", "author", "homepage", "repository", "license", "skills", "commands", "agents", "mcpServers", "interface"]);

test("every sample ships README and LICENSE", () => {
  for (const name of ["dsh-sample", "claude-sample", "hello-extension"]) {
    for (const file of ["README.md", "LICENSE"]) assert.ok(fs.existsSync(path.join(SAMPLES, name, file)), `${name}/${file}`);
  }
});

test("claude-sample: manifest uses only keys Codewhale accepts and components exist", () => {
  const manifest = json("claude-sample/.claude-plugin/plugin.json");
  for (const key of Object.keys(manifest)) assert.ok(CLAUDE_KEYS.has(key), `unexpected manifest key ${key}`);
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(!fs.existsSync(path.join(SAMPLES, "claude-sample/plugin.json")), "no native manifest: this sample must exercise the Claude loader");
  assert.ok(!fs.existsSync(path.join(SAMPLES, "claude-sample/hooks")), "hooks are rejected by the importer");
  const skill = read("claude-sample/skills/commit-message/SKILL.md");
  assert.match(skill, /^---\nname: commit-message\ndescription: .+\n---/);
  assert.match(read("claude-sample/commands/draft-commit.md"), /^---\ndescription: .+\n---/);
  assert.ok(!read("claude-sample/.claude-plugin/plugin.json").includes("CLAUDE_PLUGIN_ROOT"));
});

test("dsh-sample: package declares a patch whose rows are the ones the README promises", () => {
  const pkg = json("dsh-sample/package.json");
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.ok(!fs.existsSync(path.join(SAMPLES, "dsh-sample/plugin.json")), "a plugin.json would bypass the DSH importer");
  const patch = read("dsh-sample/cordis.patch.yml");
  for (const row of ["@deepseek-ai/dsh-skill-filesystem", "@deepseek-ai/dsh-mcp-client", "@deepseek-ai/dsh-client-ui-theme"]) assert.ok(patch.includes(row), row);
  assert.match(patch, /command: node/);
  assert.match(patch, /cwd: mcp/);
  assert.ok(fs.existsSync(path.join(SAMPLES, "dsh-sample/mcp/server.mjs")));
  // The DSH importer accepts only these frontmatter keys; anything else (for example
  // the native `invocation:` key) is refused with "Unsupported fields".
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read("dsh-sample/skills/dsh-sample-notes/SKILL.md"))[1];
  const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "disable-model-invocation", "user-invocable"]);
  const keys = frontmatter.split("\n").filter((l) => /^[A-Za-z]/.test(l)).map((l) => l.split(":")[0]);
  assert.ok(keys.includes("name") && keys.includes("description"));
  for (const key of keys) assert.ok(allowed.has(key), `DSH importer refuses skill frontmatter key '${key}'`);
  assert.ok(!/\b(token|secret|password)\b\s*[:=]/i.test(patch), "no credentials");
});

// Talk to the sample MCP server the way Codewhale does: newline-delimited JSON-RPC on stdio.
function session() {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: path.join(SAMPLES, "dsh-sample/mcp"), stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let n = 0;
  return {
    child,
    call(method, params) {
      const id = ++n;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    notify(method) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n"); },
    raw(text) { child.stdin.write(text + "\n"); },
    close() { child.stdin.end(); },
  };
}

test("dsh-sample MCP server speaks the protocol: initialize, list, call, errors", async () => {
  const s = session();
  try {
    const init = await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.serverInfo.name, "dsh-sample");
    assert.deepEqual(init.result.capabilities, { tools: {} });
    s.notify("notifications/initialized");
    const list = await s.call("tools/list", {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ["echo"]);
    assert.equal(list.result.tools[0].inputSchema.required[0], "message");
    const ok = await s.call("tools/call", { name: "echo", arguments: { message: "héllo \"quoted\"\nline2" } });
    assert.equal(ok.result.content[0].text, "héllo \"quoted\"\nline2");
    assert.equal((await s.call("tools/call", { name: "echo", arguments: { message: 5 } })).error.code, -32602);
    assert.equal((await s.call("tools/call", { name: "nope", arguments: {} })).error.code, -32602);
    assert.equal((await s.call("resources/list", {})).error.code, -32601);
    assert.deepEqual((await s.call("ping", {})).result, {});
  } finally {
    s.close();
  }
});

test("dsh-sample MCP server survives garbage input and exits when stdin closes", async () => {
  const s = session();
  const exited = new Promise((resolve) => s.child.on("exit", (code) => resolve(code)));
  s.raw("not json");
  const list = await s.call("tools/list", {});
  assert.equal(list.result.tools.length, 1, "still serving after a parse error");
  s.close();
  assert.equal(await exited, 0);
});

// hello-extension: run the real module against a stand-in for the host-supplied
// schema library, with a fake registration context.
test("hello-extension: tool and command behave as documented", { skip: !process.features.typescript && "Node without type stripping" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hello-ext-"));
  const lib = path.join(dir, "node_modules/@deepseek-ai/schemastery");
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, "package.json"), '{"name":"@deepseek-ai/schemastery","type":"module","exports":"./index.js"}');
  // Stand-in: records the default and lets `Config` be applied by the test.
  fs.writeFileSync(path.join(lib, "index.js"), "const chain = (d) => ({ default: (v) => chain(v), value: d });\nexport default { object: (shape) => ({ shape }), string: () => chain(undefined) };\n");
  fs.copyFileSync(path.join(SAMPLES, "hello-extension/hello.mts"), path.join(dir, "hello.mts"));
  const mod = await import(pathToFileURL(path.join(dir, "hello.mts")).href);
  assert.equal(mod.name, "hello-extension");
  assert.deepEqual(mod.inject, ["tools", "commands"]);
  assert.equal(mod.Config.shape.greeting.value, "Hello", "default greeting");

  const tools = [];
  const commands = [];
  mod.apply({ tools: { register: (t) => tools.push(t) }, commands: { register: (c) => commands.push(c) } }, { greeting: "Howdy" });
  assert.equal(tools[0].name, "hello_greet");
  assert.equal(commands[0].name, "hello-greet");
  const signal = new AbortController().signal;
  assert.deepEqual(tools[0].execute({ name: "Ada" }, { signal, callId: "c1" }), { greeting: "Howdy, Ada!", callId: "c1" });
  assert.equal(tools[0].execute({}, { signal, callId: "c2" }).greeting, "Howdy, world!");
  assert.deepEqual(commands[0].handler({ args: "Ada", signal }), { kind: "success", text: "Howdy, Ada!" });
  assert.equal(commands[0].handler({ args: "", signal }).text, "Howdy, world!");
  const aborted = new AbortController();
  aborted.abort();
  assert.throws(() => tools[0].execute({}, { signal: aborted.signal, callId: "c3" }));
});

test("hello-extension: manifest points at the native module and declares no network or filesystem authority", () => {
  const manifest = json("hello-extension/plugin.json");
  assert.equal(manifest.name, "hello-extension");
  const cw = manifest.extensions["net.codewhale"];
  assert.equal(cw.native.path, "hello.mts");
  assert.ok(fs.existsSync(path.join(SAMPLES, "hello-extension", cw.native.path)));
  assert.equal(cw.capabilities, undefined);
  const src = read("hello-extension/hello.mts");
  assert.ok(!/fetch\(|node:fs|node:child_process|node:net|process\.env/.test(src));
});
