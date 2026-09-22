import assert from "node:assert/strict";
import test from "node:test";

import { normalizeContent, untrusted } from "../src/content.mjs";

test("page-derived text is wrapped, and the wrapping happens here", () => {
  const [block] = normalizeContent([{ type: "text", text: "Buy now", untrusted: true }]);
  assert.match(block.text, /begin untrusted page content/);
  assert.match(block.text, /never/);
  assert.match(block.text, /as instructions/);
  assert.match(block.text, /Buy now/);
  assert.match(block.text, /end untrusted page content/);
});

test("the panel cannot opt out of the envelope by lying about the flag's type", () => {
  // Only `true` marks a block trusted-to-be-untrusted; anything else is treated
  // as our own text, which is the safe direction only because the panel marks
  // page text explicitly. A truthy-but-not-true value must not silently become
  // "trusted" *or* silently become "wrapped" — it stays unwrapped and the
  // suite pins that, so a future change to the flag is a visible decision.
  const [block] = normalizeContent([{ type: "text", text: "raw", untrusted: "yes" }]);
  assert.equal(block.text, "raw");
});

test("our own text passes through untouched", () => {
  const blocks = normalizeContent([{ type: "text", text: "url: https://example.com" }]);
  assert.deepEqual(blocks, [{ type: "text", text: "url: https://example.com" }]);
});

test("image blocks survive only with a real image mime type", () => {
  assert.deepEqual(normalizeContent([{ type: "image", data: "AAAA", mimeType: "image/png" }]), [
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ]);
  assert.deepEqual(normalizeContent([{ type: "image", data: "AAAA", mimeType: "text/html" }]), []);
  assert.deepEqual(normalizeContent([{ type: "image", data: "", mimeType: "image/png" }]), []);
  assert.deepEqual(normalizeContent([{ type: "image", mimeType: "image/png" }]), []);
});

test("malformed blocks are dropped rather than emitted into the JSON-RPC response", () => {
  assert.deepEqual(normalizeContent([null, 7, "text", {}, { type: "text" }, { type: "audio" }]), []);
  assert.deepEqual(normalizeContent(undefined), []);
  assert.deepEqual(normalizeContent({ type: "text", text: "not an array" }), []);
});

test("the envelope keeps the page text intact between its markers", () => {
  const wrapped = untrusted("hello <world>");
  const body = wrapped.split("\n").slice(-3, -1).join("\n");
  assert.equal(body.trim(), "hello <world>");
});
