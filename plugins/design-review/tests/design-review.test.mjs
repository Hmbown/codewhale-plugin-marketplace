import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanHtml, contrast, parseColor, extractStrings } from "../scripts/design-review.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "scripts", "design-review.mjs");
const fixture = (name) => fs.readFileSync(path.join(HERE, "fixtures", name), "utf8");
const rules = (findings) => findings.map((f) => f.rule);

test("a well-formed page produces no findings", () => {
  assert.deepEqual(scanHtml(fixture("good.html")), []);
});

test("the broken page trips every rule it was built to trip", () => {
  const found = new Set(rules(scanHtml(fixture("bad.html"))));
  for (const rule of [
    "html-lang", "page-title", "viewport-zoom", "meta-refresh", "focus-outline-removed", "heading-order", "img-alt",
    "input-label", "button-name", "link-name", "link-purpose", "link-as-button", "click-no-keyboard", "duplicate-id",
    "tabindex-positive", "aria-hidden-focusable", "iframe-title", "autoplay-audio", "video-captions", "table-header",
    "landmark-main", "page-has-h1",
  ]) assert.ok(found.has(rule), `expected rule ${rule}; got ${[...found].join(", ")}`);
});

test("findings carry the line they came from and a WCAG criterion", () => {
  const f = scanHtml(fixture("bad.html")).find((x) => x.rule === "img-alt");
  assert.equal(f.severity, "error");
  assert.equal(f.wcag, "1.1.1");
  assert.equal(fixture("bad.html").split("\n")[f.line - 1].trim().startsWith("<img"), true);
});

test("labels are recognised through for=, wrapping, aria-label and aria-labelledby", () => {
  const ok = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>x</h1><span id="l">Name</span>' +
    '<label for="a">A</label><input id="a"><label>B <input></label><input aria-label="C"><input aria-labelledby="l"></main></body></html>';
  assert.deepEqual(rules(scanHtml(ok)), []);
  const bad = ok.replace('<input aria-labelledby="l">', '<input aria-labelledby="missing">');
  assert.deepEqual(rules(scanHtml(bad)), ["input-label"]);
});

test("hidden, submit and image inputs follow their own rules", () => {
  const html = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>x</h1>' +
    '<input type="hidden" name="t"><input type="submit" value="Send"><input type="submit"><input type="image" src="a.png"></main></body></html>';
  assert.deepEqual(rules(scanHtml(html)), ["button-name", "button-name"]);
});

test("script and style bodies are not parsed as markup", () => {
  const html = '<!doctype html><html lang="en"><head><title>t</title><script>var s = "<img src=x>"; if (a < b) {}</script></head><body><main><h1>x</h1></main></body></html>';
  assert.deepEqual(scanHtml(html), []);
});

test("buttons are named by text, aria-label, img alt and svg title", () => {
  const body = '<button>Go</button><button aria-label="Go"></button><button><img src="a.png" alt="Go"></button><button><svg><title>Go</title></svg></button>';
  const html = `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>x</h1>${body}</main></body></html>`;
  assert.deepEqual(rules(scanHtml(html)), []);
});

test("contrast matches the published WCAG reference values", () => {
  assert.equal(contrast("#000", "#fff").ratio, 21);
  assert.equal(contrast("#ffffff", "#ffffff").ratio, 1);
  // #767676 on white is the well-known smallest gray that passes AA for body text.
  const gray = contrast("#767676", "#ffffff");
  assert.equal(gray.ratio, 4.54);
  assert.equal(gray.normalText.AA, true);
  assert.equal(gray.normalText.AAA, false);
  // One shade lighter (#777) is 4.48:1 and fails: the threshold is not rounded up.
  const light = contrast("#777777", "#ffffff");
  assert.equal(light.ratio, 4.48);
  assert.equal(light.normalText.AA, false);
  assert.equal(light.largeText.AA, true);
  const fail = contrast("#999999", "#ffffff");
  assert.equal(fail.ratio, 2.85);
  assert.equal(fail.normalText.AA, false);
  assert.equal(fail.largeText.AA, false);
  assert.equal(contrast("#949494", "#ffffff").uiComponents.AA, true);
});

test("color parsing accepts the documented forms and refuses alpha and junk", () => {
  assert.deepEqual(parseColor("#0af"), [0, 170, 255]);
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.deepEqual(parseColor("White"), [255, 255, 255]);
  assert.throws(() => parseColor("#00000080"), /alpha/);
  assert.throws(() => parseColor("rgb(300,0,0)"), /cannot read/);
  assert.throws(() => parseColor("var(--x)"), /cannot read/);
});

test("strings lists the visible UI text with its kind", () => {
  const items = extractStrings(fixture("good.html"));
  const has = (kind, text) => items.some((i) => i.kind === kind && i.text === text);
  assert.ok(has("title", "Account settings"));
  assert.ok(has("heading", "Profile"));
  assert.ok(has("button", "Save changes"));
  assert.ok(has("aria-label", "Close dialog"));
  assert.ok(has("link", "Manage billing"));
  assert.ok(has("alt", "Your profile photo"));
  assert.ok(has("label", "Display name"));
  assert.ok(!items.some((i) => i.text.includes("outline")), "style text is not UI text");
});

test("visible text decodes each original HTML entity once", () => {
  const html = '<p>&amp;lt; &amp;#60; &amp;#x3c; &#38;amp; &lt; &#60; &#x3c; &#x1f433;</p>';
  assert.equal(extractStrings(html)[0].text, '&lt; &#60; &#x3c; &amp; < < < 🐳');
  assert.deepEqual(scanHtml(html), []);
});

test("invalid numeric HTML entities cannot crash a static review", () => {
  const html = '<p>&#0; &#x110000; &#xd800; &#xdfff; &#99999999999999999999999999999999999999999999;</p>';
  assert.equal(extractStrings(html)[0].text, '\ufffd \ufffd \ufffd \ufffd \ufffd');
  assert.deepEqual(scanHtml(html), []);
});

test("CLI: scan exits 0 on a clean page and 1 with errors, JSON is parseable, contrast gates on AA", () => {
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: "utf8" });
  const good = run("scan", path.join(HERE, "fixtures/good.html"));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /0 error\(s\), 0 warning\(s\)/);
  const bad = run("scan", path.join(HERE, "fixtures/bad.html"), "--json");
  assert.equal(bad.status, 1);
  const parsed = JSON.parse(bad.stdout);
  assert.ok(parsed.errors > 5 && parsed.findings.length > parsed.errors);
  assert.equal(run("contrast", "#767676", "#fff").status, 0);
  assert.equal(run("contrast", "#999", "#fff").status, 1);
  assert.equal(run("contrast", "#999").status, 2);
  assert.equal(run("scan", "/nonexistent/file.html").status, 2);
});
