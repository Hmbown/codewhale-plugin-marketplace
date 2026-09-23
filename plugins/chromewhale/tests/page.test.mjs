import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { clickRef, inspectRef, snapshotPage, typeRef } from "../extension/src/page.js";

const SOURCE = readFileSync(new URL("../extension/src/page.js", import.meta.url), "utf8");

test("page.js imports nothing, because injected functions lose their module scope", () => {
  // `chrome.scripting.executeScript({ func })` re-evaluates `func.toString()`
  // in the page. A module-scope reference compiles fine here and throws there,
  // at the moment a user is watching. Pin the invariant the module doc states.
  assert.equal(/^\s*import\s/m.test(SOURCE), false, "page.js must stay import-free");
  for (const fn of [snapshotPage, inspectRef, clickRef, typeRef]) {
    assert.doesNotThrow(
      () => new Function(`return (${fn.toString()})`)(),
      `${fn.name} must rebuild from its own source alone`,
    );
  }
});

test("a ref without a snapshot tells the model to snapshot first", () => {
  delete globalThis.__chromewhale;
  for (const [name, outcome] of [
    ["inspectRef", inspectRef("e1")],
    ["clickRef", clickRef("e1")],
    ["typeRef", typeRef("e1", "hi", true, false)],
  ]) {
    assert.equal(outcome.ok, false, name);
    assert.match(outcome.error, /page_snapshot/);
    assert.doesNotMatch(outcome.error, /browser_/, "Chromewhale has no browser_* tools");
  }
});

test("an unknown ref names itself instead of hitting whatever sits at that index", () => {
  globalThis.__chromewhale = { refs: [fakeElement()] };
  const outcome = inspectRef("e9");
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /e9/);
});

test("a ref whose element left the page reports staleness", () => {
  globalThis.__chromewhale = { refs: [fakeElement({ isConnected: false })] };
  const inspected = inspectRef("e1");
  assert.equal(inspected.ok, false);
  assert.equal(inspected.stale, true);
  assert.equal(clickRef("e1").ok, false);
});

test("typeRef refuses a password field even when the policy gate was skipped", () => {
  // Defence in depth: `browser.js` already checks, but a future caller that
  // forgets must still not be able to fill a credential box.
  globalThis.__chromewhale = { refs: [fakeElement({ attributes: { type: "password" } })] };
  const outcome = typeRef("e1", "hunter2", true, false);
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /never types into a password field/);
});

test("refs are one-based, matching the [eN] markers a snapshot prints", () => {
  const first = fakeElement({ attributes: { type: "text" } });
  const second = fakeElement({ attributes: { type: "password" } });
  globalThis.__chromewhale = { refs: [first, second] };
  assert.equal(inspectRef("e1").type, "text");
  assert.equal(inspectRef("e2").type, "password");
});

/**
 * The smallest element shape these guards actually touch: attributes, an
 * `isConnected` flag, and a tag name. Nothing here needs a DOM.
 */
function fakeElement({ attributes = {}, isConnected = true, tagName = "INPUT", form = null } = {}) {
  return {
    tagName,
    isConnected,
    form,
    id: attributes.id ?? "",
    textContent: attributes.textContent ?? "",
    getAttribute: (name) => attributes[name] ?? null,
  };
}

test("inspectRef says which controls submit a form", () => {
  const form = {};
  globalThis.__chromewhale = {
    refs: [
      fakeElement({ tagName: "BUTTON", form }),
      fakeElement({ tagName: "BUTTON", form, attributes: { type: "button" } }),
      fakeElement({ tagName: "BUTTON" }),
      fakeElement({ tagName: "INPUT", attributes: { type: "submit" } }),
      fakeElement({ tagName: "INPUT", attributes: { type: "text" } }),
    ],
  };
  assert.deepEqual(
    ["e1", "e2", "e3", "e4", "e5"].map((ref) => inspectRef(ref).submits),
    [true, false, false, true, false],
  );
});

test("no source string names a browser_* tool, which Chromewhale does not have", async () => {
  // `browser_*` belongs to computer-use. Error text pointing the model at it
  // sends it to the wrong plugin. Comments may name it to explain the split;
  // strings the model can read may not.
  const { readdirSync } = await import("node:fs");
  const roots = ["../extension/src/", "../src/", "../mcp/"];
  for (const root of roots) {
    const dir = new URL(root, import.meta.url);
    for (const name of readdirSync(dir).filter((file) => /\.m?js$/.test(file))) {
      const code = readFileSync(new URL(name, dir), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /browser_[a-z]/, `${root}${name} names a browser_* tool outside a comment`);
    }
  }
});
