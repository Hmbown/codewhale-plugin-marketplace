import assert from "node:assert/strict";
import test from "node:test";

import { SseParser, bridgeFrame, frameData, runtimeEvent } from "../extension/src/sse.js";

test("an event split across network chunks is reassembled once, not twice", () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push('data: {"seq":1,"eve'), []);
  assert.deepEqual(parser.push('nt":"turn.completed"}'), []);
  const payloads = parser.push("\n\n");
  assert.equal(payloads.length, 1);
  assert.equal(runtimeEvent(payloads[0]).event, "turn.completed");
});

test("CRLF and LF frame boundaries both terminate a frame", () => {
  const parser = new SseParser();
  const payloads = parser.push('data: {"seq":1,"event":"a"}\r\n\r\ndata: {"seq":2,"event":"b"}\n\n');
  assert.deepEqual(
    payloads.map((data) => runtimeEvent(data).event),
    ["a", "b"],
  );
});

test("heartbeats and comments yield nothing", () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push(": keep-alive\n\n"), []);
  assert.deepEqual(parser.push("\n\n"), []);
});

test("multi-line data fields join with newlines before parsing", () => {
  const data = frameData('data: {"seq":2,\ndata: "event":"item.completed"}');
  const event = runtimeEvent(data);
  assert.equal(event.seq, 2);
  assert.equal(event.event, "item.completed");
});

test("the parser is transport-agnostic: both streams share the framing", () => {
  // The bridge sends plain objects with no `seq`. A parser that insisted on the
  // runtime envelope would drop every one of them — which is exactly why the
  // framing and the envelope are separate functions.
  const parser = new SseParser();
  const [payload] = parser.push('data: {"type":"call","id":"c1","tool":"page_snapshot"}\n\n');
  assert.equal(runtimeEvent(payload), undefined, "a bridge frame is not a runtime event");
  assert.deepEqual(bridgeFrame(payload), { type: "call", id: "c1", tool: "page_snapshot" });
});

test("a runtime envelope missing its identifiers is not an event", () => {
  assert.equal(runtimeEvent("not json"), undefined);
  assert.equal(runtimeEvent('{"event":"no-seq"}'), undefined);
  assert.equal(runtimeEvent('{"seq":9}'), undefined);
  assert.equal(runtimeEvent('"a string"'), undefined);
});

test("a bridge frame without a type is not a frame", () => {
  assert.equal(bridgeFrame('{"id":"c1"}'), undefined);
  assert.equal(bridgeFrame("not json"), undefined);
  assert.equal(bridgeFrame('{"type":7}'), undefined);
});

test("previous_seq travels so a client can tell that replay skipped history", () => {
  const event = runtimeEvent('{"seq":90,"previous_seq":12,"event":"item.started"}');
  assert.equal(event.previousSeq, 12);
});

test("the ready frame's version is checked against the extension's", async () => {
  const { readyStatus } = await import("../extension/src/bridge.js");
  assert.equal(readyStatus("0.1.0", "0.1.0").detail, "Attached to the Chromewhale bridge.");
  assert.match(readyStatus("0.2.0", "0.1.0").detail, /plugin is 0\.2\.0 and this extension is 0\.1\.0.*\/chromewhale setup/);
  assert.equal(readyStatus(undefined, "0.1.0").detail, "Attached to the Chromewhale bridge.", "an older bridge sends none");
});
