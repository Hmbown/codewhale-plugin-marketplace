import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scaffold, checkHtml, startPreview, build } from "../scripts/wab.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WAB = path.join(HERE, "..", "scripts", "wab.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "wab-test-"));
const get = (url) =>
  new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on("error", reject);
  });
const GOOD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title></head><body><p>x</p></body></html>';

test("single template scaffolds a page that passes its own check", () => {
  const dir = path.join(tmp(), "page");
  const r = scaffold(dir, { template: "single", title: "My <Tool> & more" });
  const html = fs.readFileSync(path.join(r.dir, "index.html"), "utf8");
  assert.match(html, /<title>My &lt;Tool&gt; &amp; more<\/title>/);
  assert.ok(!html.includes("{{TITLE}}"));
  const result = checkHtml(html);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("scaffold refuses a non-empty directory and unknown templates", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "keep.txt"), "x");
  assert.throws(() => scaffold(dir), /not empty/);
  assert.throws(() => scaffold(path.join(tmp(), "n"), { template: "vue" }), /unknown template/);
});

test("react template fills name and title, encoding JSX-significant characters", () => {
  const dir = path.join(tmp(), "dash");
  scaffold(dir, { template: "react", title: "Sales {Q3} <view>" });
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.equal(pkg.name, "sales-q3-view");
  const app = fs.readFileSync(path.join(dir, "src/App.jsx"), "utf8");
  assert.ok(app.includes("Sales &#123;Q3&#125; &lt;view&gt;"), "JSX text is entity-encoded");
  assert.ok(!/\{\{TITLE\}\}/.test(app));
  assert.ok(fs.existsSync(path.join(dir, "vite.config.js")));
});

test("check flags each structural and self-containment failure", () => {
  const bad = (html, needle, opts) => {
    const r = checkHtml(html, opts);
    assert.ok(r.errors.some((e) => e.includes(needle)), `${needle} in ${JSON.stringify(r.errors)}`);
    assert.equal(r.ok, false);
  };
  bad("<html><body></body></html>", "doctype");
  bad(GOOD.replace("<title>T</title>", ""), "title");
  bad(GOOD.replace(/<meta name="viewport"[^>]*>/, ""), "viewport");
  bad(GOOD.replace("<title>T</title>", "<title>{{TITLE}}</title>"), "placeholder");
  bad(GOOD.replace("</head>", '<script src="https://cdn.example.invalid/x.js"></script></head>'), "network");
  bad(GOOD.replace("</head>", '<link rel="stylesheet" href="//cdn.example.invalid/x.css"></head>'), "network");
  bad(GOOD.replace("</head>", '<style>@import url("https://x.example.invalid/f.css");</style></head>'), "network");
  bad(GOOD.replace("</head>", "<style>body{background:url(https://x.example.invalid/a.png)}</style></head>"), "network");
  bad(GOOD.replace("</body>", '<script type="module">import R from "https://esm.example.invalid/react";</script></body>'), "network");
  bad(GOOD.replace("</head>", '<script type="module" src="./main.js"></script></head>'), "separate file");
  bad(GOOD.replace("</body>", '<img src="logo.png"></body>'), "separate file");
  bad(GOOD.replace("<p>x</p>", "<p>key sk-abcdefghijklmnopqrstuvwxyz0123</p>"), "API key");
  bad(GOOD.replace("<p>x</p>", "<p>-----BEGIN RSA PRIVATE KEY-----</p>"), "private key");
  bad(GOOD, "limit", { maxKb: 0.05 });
});

test("check accepts data URIs, anchors and in-page links, and downgrades network under --allow-network", () => {
  const ok = GOOD.replace("<p>x</p>", '<a href="/docs">docs</a><a href="#top">top</a><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><link rel="icon" href="data:,">');
  assert.deepEqual(checkHtml(ok).errors, []);
  const cdn = GOOD.replace("</head>", '<script src="https://cdn.example.invalid/x.js"></script></head>');
  const r = checkHtml(cdn, { allowNetwork: true });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("network")));
});

test("check warns about a missing lang and a zoom-blocking viewport", () => {
  const r = checkHtml(GOOD.replace(' lang="en"', "").replace("initial-scale=1", "initial-scale=1, user-scalable=no"));
  assert.ok(r.warnings.some((w) => w.includes("lang")));
  assert.ok(r.warnings.some((w) => w.includes("pinch zoom")));
});

test("CLI check exits 0 for a good page, 1 for a bad one, 2 for bad usage", () => {
  const dir = tmp();
  const good = path.join(dir, "good.html");
  const badFile = path.join(dir, "bad.html");
  fs.writeFileSync(good, GOOD);
  fs.writeFileSync(badFile, "<p>no doctype</p>");
  const run = (...a) => spawnSync(process.execPath, [WAB, ...a], { encoding: "utf8" });
  const g = run("check", good, "--json");
  assert.equal(g.status, 0, g.stderr);
  assert.equal(JSON.parse(g.stdout).ok, true);
  const b = run("check", badFile);
  assert.equal(b.status, 1);
  assert.match(b.stdout, /check: FAILED/);
  assert.equal(run("nonsense").status, 2);
});

test("preview serves the page on loopback and refuses traversal, writes and other hosts", async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "site"));
  fs.writeFileSync(path.join(root, "site", "index.html"), GOOD);
  fs.writeFileSync(path.join(root, "secret.txt"), "TOP SECRET");
  const { server, url } = await startPreview(path.join(root, "site"));
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(server.address().address, "127.0.0.1");
    const page = await get(url);
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.equal(page.body, GOOD);
    assert.equal((await get(url + "nope.html")).status, 404);
    // Raw socket request so the client cannot normalize the traversal away.
    const raw = await new Promise((resolve) => {
      const s = net.connect(new URL(url).port, "127.0.0.1", () => s.write("GET /../secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
      let data = "";
      s.on("data", (d) => (data += d));
      s.on("close", () => resolve(data));
    });
    assert.ok(!raw.includes("TOP SECRET"), raw);
    const post = await new Promise((resolve) => {
      const req = http.request(url, { method: "POST" }, (res) => resolve(res.statusCode));
      req.end();
    });
    assert.equal(post, 405);
  } finally {
    server.close();
  }
  await assert.rejects(() => startPreview(root, { host: "0.0.0.0" }), /loopback/);
  await assert.rejects(() => startPreview(path.join(root, "missing")), /does not exist/);
});

test("preview of a single file serves that file at /", async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "one.html"), GOOD);
  const { server, url } = await startPreview(path.join(root, "one.html"));
  try {
    assert.equal((await get(url)).body, GOOD);
  } finally {
    server.close();
  }
});

test("build refuses a directory without package.json", () => {
  assert.throws(() => build(tmp()), /no package.json/);
});

// Optional end-to-end: needs npm and the registry. Run with WAB_E2E=1.
test("react template builds to one self-contained file that passes check", { skip: !process.env.WAB_E2E, timeout: 600000 }, () => {
  const dir = path.join(tmp(), "e2e");
  scaffold(dir, { template: "react", title: "E2E page" });
  const out = build(dir);
  const html = fs.readFileSync(out, "utf8");
  const result = checkHtml(html);
  assert.deepEqual(result.errors, []);
  assert.ok(html.includes("E2E page"));
  assert.ok(!/<script[^>]+src=/.test(html), "no external script tags");
});
