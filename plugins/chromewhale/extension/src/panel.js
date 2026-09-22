/**
 * The Chromewhale side panel.
 *
 * It holds two loopback connections, and they do different jobs:
 *
 * - the **Codewhale runtime** (`/v1/*`) carries the conversation — this is the
 *   chat you see, streamed over SSE like any other runtime client;
 * - the **Chromewhale bridge** carries tool calls from the plugin's MCP server
 *   to this tab, and results back.
 *
 * Keeping them separate is what lets the tools go through Codewhale's normal
 * MCP path — permission profiles, approval prompts, the plugin trust review —
 * instead of being asserted by this client. The panel's own per-origin gate
 * sits underneath all of that, because it is the only part that knows which
 * page is actually in front of the user.
 *
 * Both live in this document rather than the service worker — see
 * `background.js` for why. Two consequences are deliberate:
 *
 * - Browser tools work only while the panel is open. Close it and the streams,
 *   the tool loop, and the extension's ability to touch a page all stop.
 * - Transcript text is written with `textContent`, never `innerHTML`. Model
 *   output and page-derived results both land here and neither is trusted
 *   markup. There is no markdown renderer for the same reason.
 */

import { RuntimeClient } from "./runtime.js";
import { BridgeClient } from "./bridge.js";
import { createBrowserTools } from "./browser.js";
import { withDecision } from "./policy.js";

const DEFAULT_SETTINGS = {
  host: "127.0.0.1",
  port: 7878,
  token: "",
  bridgePort: 8899,
  bridgeToken: "",
};

/**
 * How long an origin prompt waits for the user. Well under the bridge's
 * 90-second call timeout so the model gets an explicit refusal rather than a
 * silent timeout it cannot explain.
 */
const DECISION_TIMEOUT_MS = 60_000;

const MAX_ACTIVITY_ROWS = 40;

const dom = {
  status: document.getElementById("status"),
  bridgeStatus: document.getElementById("bridge-status"),
  pause: document.getElementById("pause"),
  toggleSettings: document.getElementById("toggle-settings"),
  settings: document.getElementById("settings"),
  host: document.getElementById("host"),
  port: document.getElementById("port"),
  token: document.getElementById("token"),
  bridgePort: document.getElementById("bridge-port"),
  bridgeToken: document.getElementById("bridge-token"),
  save: document.getElementById("save-settings"),
  newThread: document.getElementById("new-thread"),
  sites: document.getElementById("sites"),
  activity: document.getElementById("activity"),
  transcript: document.getElementById("transcript"),
  prompts: document.getElementById("prompts"),
  composer: document.getElementById("composer"),
  input: document.getElementById("input"),
  stop: document.getElementById("stop"),
};

/** @type {RuntimeClient | undefined} */
let client;
/** @type {BridgeClient | undefined} */
let bridge;
/** @type {string | undefined} */
let threadId;
/** @type {string | undefined} */
let streamingTurnId;
let lastSeq = 0;
/** @type {AbortController | undefined} */
let streamAbort;
/** @type {Map<string, HTMLElement>} */
const itemNodes = new Map();
/** @type {Array<{tool: string, summary: string, origin?: string, outcome: string}>} */
const activity = [];

const browserTools = createBrowserTools({
  activeTab: async () => {
    const win = await chrome.windows.getCurrent();
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab;
  },
  getTab: (tabId) => chrome.tabs.get(tabId).catch(() => undefined),
  navigateTab: async (tabId, url) => {
    await chrome.tabs.update(tabId, { url });
  },
  historyMove: async (tabId, action) => {
    if (action === "reload") {
      await chrome.tabs.reload(tabId);
    } else if (action === "back") {
      await chrome.tabs.goBack(tabId);
    } else {
      await chrome.tabs.goForward(tabId);
    }
  },
  executeScript: async ({ tabId, func, args }) => {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return injection?.result;
  },
  captureTab: (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 }),
  hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }),
  readDecisions: async () => (await chrome.storage.local.get({ origins: {} })).origins,
  readSessionDecisions: async () => (await chrome.storage.session.get({ origins: {} })).origins,
  requestDecision,
  confirmAction,
  isPaused: async () => (await chrome.storage.local.get({ paused: false })).paused === true,
  log: recordActivity,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

// --- settings -------------------------------------------------------------

async function loadSettings() {
  const stored = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  const settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  dom.host.value = settings.host;
  dom.port.value = String(settings.port);
  dom.token.value = settings.token;
  dom.bridgePort.value = String(settings.bridgePort);
  dom.bridgeToken.value = settings.bridgeToken;
  return settings;
}

async function saveSettings() {
  const settings = {
    host: dom.host.value.trim() || DEFAULT_SETTINGS.host,
    port: readPort(dom.port.value, DEFAULT_SETTINGS.port),
    token: dom.token.value,
    bridgePort: readPort(dom.bridgePort.value, DEFAULT_SETTINGS.bridgePort),
    bridgeToken: dom.bridgeToken.value.trim(),
  };
  await chrome.storage.local.set({ settings });
  return settings;
}

/**
 * @param {string} raw
 * @param {number} fallback
 */
function readPort(raw, fallback) {
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

// --- connection and streams -----------------------------------------------

async function connect() {
  const settings = await loadSettings();
  connectBridge(settings);

  client = new RuntimeClient({
    baseUrl: `http://${settings.host}:${settings.port}`,
    token: settings.token,
  });
  const state = await client.connect();
  setStatus(state.kind, state.detail);
  if (state.kind !== "connected") {
    openSettings();
    return;
  }
  await ensureThread();
}

/**
 * The bridge is always loopback, whatever the runtime host is set to. The two
 * are different services: pointing the runtime at another machine must not
 * quietly aim tool calls there too, and `manifest.json` grants no other host
 * anyway.
 *
 * @param {{bridgePort: number, bridgeToken: string}} settings
 */
function connectBridge(settings) {
  bridge?.stop();
  if (!settings.bridgeToken) {
    setBridgeStatus("offline", "Bridge: paste the pairing token from /chromewhale in Settings.");
    return;
  }
  bridge = new BridgeClient({
    baseUrl: `http://127.0.0.1:${settings.bridgePort}`,
    token: settings.bridgeToken,
    onCall: (call) => browserTools.execute(call),
    version: chrome.runtime.getManifest().version,
    onStatus: ({ kind, detail }) => setBridgeStatus(kind, `Bridge: ${detail}`),
  });
  bridge.start();
}

async function ensureThread() {
  if (!client) {
    return;
  }
  const stored = await chrome.storage.local.get({ threadId: "" });
  if (stored.threadId) {
    try {
      const detail = await client.threadDetail(stored.threadId);
      threadId = stored.threadId;
      hydrate(detail);
      openStream();
      return;
    } catch {
      // A thread from a previous runtime process is gone; start a fresh one.
    }
  }
  const thread = await client.createThread({});
  threadId = thread?.id;
  await chrome.storage.local.set({ threadId });
  resetTranscript();
  openStream();
}

/** @param {any} detail */
function hydrate(detail) {
  resetTranscript();
  lastSeq = Number(detail?.latest_seq ?? 0);
  for (const item of detail?.items ?? []) {
    renderItem(item.id, {
      kind: item.kind,
      status: item.status,
      text: item.detail || item.summary || "",
    });
  }
  for (const approval of detail?.pending_approvals ?? []) {
    renderApprovalCard(approval);
  }
}

function openStream() {
  closeStream();
  if (!client || !threadId) {
    return;
  }
  const controller = new AbortController();
  streamAbort = controller;
  void pump(client, threadId, controller);
}

/**
 * @param {RuntimeClient} runtime
 * @param {string} id
 * @param {AbortController} controller
 */
async function pump(runtime, id, controller) {
  let backoffMs = 500;
  while (!controller.signal.aborted) {
    try {
      for await (const event of runtime.events(id, lastSeq, controller.signal)) {
        backoffMs = 500;
        if (event.seq <= lastSeq) {
          continue;
        }
        lastSeq = event.seq;
        handleEvent(event);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setStatus("error", `Event stream dropped: ${messageOf(error)}`);
    }
    if (controller.signal.aborted) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    backoffMs = Math.min(backoffMs * 2, 10_000);
  }
}

function closeStream() {
  streamAbort?.abort();
  streamAbort = undefined;
}

/** @param {{seq: number, event: string, itemId?: string, turnId?: string, payload: any}} event */
function handleEvent(event) {
  const payload = event.payload ?? {};
  switch (event.event) {
    case "item.started":
    case "item.completed":
    case "item.failed":
    case "item.interrupted":
    case "item.canceled": {
      const item = payload.item && typeof payload.item === "object" ? payload.item : payload;
      const id = event.itemId ?? item.id;
      if (id) {
        renderItem(id, {
          kind: item.kind,
          status: item.status ?? statusForEvent(event.event),
          text: item.detail || item.summary || undefined,
        });
      }
      break;
    }
    case "item.delta": {
      if (event.itemId && typeof payload.delta === "string") {
        appendDelta(event.itemId, payload.kind ?? "agent_message", payload.delta);
      }
      break;
    }
    case "approval.required": {
      renderApprovalCard(payload);
      break;
    }
    case "approval.decided":
    case "approval.timeout": {
      document.getElementById(`approval-${payload.approval_id ?? payload.id}`)?.remove();
      break;
    }
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted":
    case "turn.ended": {
      if (event.turnId === streamingTurnId) {
        streamingTurnId = undefined;
        dom.stop.hidden = true;
      }
      break;
    }
    default:
      break;
  }
}

/** @param {string} event */
function statusForEvent(event) {
  if (event === "item.completed") {
    return "completed";
  }
  if (event === "item.failed") {
    return "failed";
  }
  if (event === "item.interrupted" || event === "item.canceled") {
    return "interrupted";
  }
  return "in_progress";
}

// --- per-origin decisions -------------------------------------------------

/**
 * Ask the user whether Chromewhale may work on an origin.
 *
 * Resolving to `"allow"` means both gates passed: the user said yes *and*
 * Chrome granted the optional host permission. `chrome.permissions.request` is
 * called first thing inside the click handler so the user gesture is still live.
 *
 * The first button, and the one Enter lands on, is "Allow for this session":
 * the grant lives in `chrome.storage.session` and is gone when Chrome exits.
 * "Always allow" is a separate, deliberate click.
 *
 * @param {{origin: string, tool: string, summary: string, reason: "ask" | "permission"}} request
 * @returns {Promise<"allow" | "block" | "denied">}
 */
function requestDecision(request) {
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = `Let Codewhale ${request.summary}?`;
    card.append(title);

    const detail = document.createElement("p");
    detail.textContent =
      request.reason === "permission"
        ? `${request.origin} is allowed, but Chrome no longer holds access to it. Grant it again to continue.`
        : `Codewhale wants to use ${request.tool} on ${request.origin}. Allowing lets it read and act on every page of that site whenever this panel is open, until Chrome quits; "Always allow" keeps that after a restart. Submitting a form still asks each time.`;
    card.append(detail);

    const row = document.createElement("div");
    row.className = "row";
    const session = document.createElement("button");
    session.type = "button";
    session.textContent = "Allow for this session";
    const always = document.createElement("button");
    always.type = "button";
    always.className = "ghost";
    always.textContent = `Always allow ${request.origin}`;
    const block = document.createElement("button");
    block.type = "button";
    block.className = "ghost danger";
    block.textContent = "Block";
    row.append(session, always, block);
    card.append(row);
    dom.prompts.append(card);
    session.focus();

    let settled = false;
    /** @param {"allow" | "block" | "denied"} answer */
    const finish = (answer) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      card.remove();
      resolve(answer);
    };
    const timer = setTimeout(() => finish("denied"), DECISION_TIMEOUT_MS);

    /** @param {"session" | "allow"} scope */
    const grant = (scope) => {
      // Kept synchronous: an await before this call would spend the gesture.
      chrome.permissions
        .request({ origins: [`${request.origin}/*`] })
        .then(async (granted) => {
          if (!granted) {
            finish("denied");
            return;
          }
          await persistDecision(request.origin, scope);
          finish("allow");
        })
        .catch(() => finish("denied"));
    };
    session.addEventListener("click", () => grant("session"));
    always.addEventListener("click", () => grant("allow"));
    block.addEventListener("click", () => {
      void persistDecision(request.origin, "block").then(() => finish("block"));
    });
  });
}

/**
 * Ask the user to confirm one action on an origin they already allowed.
 *
 * Used for form submission. Resolves `false` on Cancel and on timeout, so an
 * unattended panel never submits anything.
 *
 * @param {{origin: string, tool: string, summary: string, detail: string}} request
 * @returns {Promise<boolean>}
 */
function confirmAction(request) {
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = `Confirm: ${request.summary}`;
    const detail = document.createElement("p");
    detail.textContent = `${request.detail} Codewhale needs your click to send it.`;
    const row = document.createElement("div");
    row.className = "row";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = "Submit";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost danger";
    cancel.textContent = "Cancel";
    row.append(confirm, cancel);
    card.append(title, detail, row);
    dom.prompts.append(card);
    cancel.focus();

    let settled = false;
    /** @param {boolean} answer */
    const finish = (answer) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      card.remove();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(false), DECISION_TIMEOUT_MS);
    confirm.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
  });
}

/**
 * Record a decision. `"session"` lands in `chrome.storage.session`; `"allow"`
 * and `"block"` in `chrome.storage.local`; `"ask"` (Forget) clears both.
 *
 * @param {string} origin
 * @param {"allow" | "block" | "ask" | "session"} decision
 */
async function persistDecision(origin, decision) {
  const stored = await chrome.storage.local.get({ origins: {} });
  const scoped = await chrome.storage.session.get({ origins: {} });
  const standing = decision === "session" ? "ask" : decision;
  await chrome.storage.local.set({ origins: withDecision(stored.origins, origin, standing) });
  await chrome.storage.session.set({
    origins: withDecision(scoped.origins, origin, decision === "session" ? "allow" : "ask"),
  });
  if (decision === "ask" || decision === "block") {
    await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
  }
  await renderSites();
}

// --- rendering ------------------------------------------------------------

function resetTranscript() {
  dom.transcript.replaceChildren();
  dom.prompts.replaceChildren();
  itemNodes.clear();
  lastSeq = 0;
}

/**
 * @param {string} id
 * @param {{kind?: string, status?: string, text?: string}} patch
 */
function renderItem(id, patch) {
  if (patch.kind === "agent_reasoning" || patch.kind === "context_compaction") {
    return;
  }
  let node = itemNodes.get(id);
  if (!node) {
    node = document.createElement("div");
    node.className = "msg";
    const who = document.createElement("div");
    who.className = "who";
    const body = document.createElement("div");
    body.className = "body";
    node.append(who, body);
    itemNodes.set(id, node);
    dom.transcript.append(node);
  }
  const kind = patch.kind ?? node.dataset.kind ?? "status";
  node.dataset.kind = kind;
  node.className = `msg${isToolish(kind) ? " tool" : ""}${patch.status === "failed" ? " failed" : ""}`;
  node.querySelector(".who").textContent = labelFor(kind);
  if (patch.text !== undefined) {
    node.querySelector(".body").textContent = patch.text;
  }
  dom.transcript.scrollTop = dom.transcript.scrollHeight;
}

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} delta
 */
function appendDelta(id, kind, delta) {
  if (!itemNodes.has(id)) {
    renderItem(id, { kind, status: "in_progress", text: "" });
  }
  const body = itemNodes.get(id)?.querySelector(".body");
  if (body) {
    body.textContent += delta;
    dom.transcript.scrollTop = dom.transcript.scrollHeight;
  }
}

/** @param {string} kind */
function isToolish(kind) {
  return kind !== "agent_message" && kind !== "user_message";
}

/** @param {string} kind */
function labelFor(kind) {
  switch (kind) {
    case "user_message":
      return "You";
    case "agent_message":
      return "Codewhale";
    case "error":
      return "Error";
    default:
      return kind.replace(/_/g, " ");
  }
}

/** @param {any} approval */
function renderApprovalCard(approval) {
  const id = approval?.approval_id ?? approval?.id;
  if (!id || document.getElementById(`approval-${id}`)) {
    return;
  }
  const card = document.createElement("div");
  card.className = "card";
  card.id = `approval-${id}`;

  const title = document.createElement("h3");
  title.textContent = `Codewhale wants to run ${approval.tool_name ?? "a tool"}`;
  const detail = document.createElement("p");
  detail.textContent = approval.intent_summary || approval.description || "";
  const row = document.createElement("div");
  row.className = "row";
  const allow = document.createElement("button");
  allow.type = "button";
  allow.textContent = "Allow";
  const deny = document.createElement("button");
  deny.type = "button";
  deny.className = "ghost danger";
  deny.textContent = "Deny";
  row.append(allow, deny);
  card.append(title, detail, row);
  dom.prompts.append(card);

  /** @param {"allow" | "deny"} decision */
  const settle = (decision) => {
    card.remove();
    void client?.decideApproval(id, decision).catch((error) => {
      setStatus("error", `Approval failed: ${messageOf(error)}`);
    });
  };
  allow.addEventListener("click", () => settle("allow"));
  deny.addEventListener("click", () => settle("deny"));
}

/** @param {{tool: string, summary: string, origin?: string, outcome: string}} entry */
function recordActivity(entry) {
  activity.unshift(entry);
  activity.splice(MAX_ACTIVITY_ROWS);
  dom.activity.replaceChildren(
    ...activity.map((row) => {
      const li = document.createElement("li");
      const what = document.createElement("span");
      what.textContent = `${row.summary}${row.origin ? ` · ${row.origin}` : ""}`;
      const outcome = document.createElement("span");
      outcome.className = "outcome";
      outcome.dataset.outcome = row.outcome;
      outcome.textContent = row.outcome;
      li.append(what, outcome);
      return li;
    }),
  );
}

async function renderSites() {
  const stored = await chrome.storage.local.get({ origins: {} });
  const scoped = await chrome.storage.session.get({ origins: {} });
  /** @type {Record<string, string>} */
  const merged = {};
  for (const [origin, value] of Object.entries(scoped.origins ?? {})) {
    if (value === "allow") {
      merged[origin] = "this session";
    }
  }
  for (const [origin, value] of Object.entries(stored.origins ?? {})) {
    merged[origin] = value === "allow" ? "always" : String(value);
  }
  const entries = Object.entries(merged);
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No site has been allowed or blocked yet.";
    dom.sites.replaceChildren(empty);
    return;
  }
  dom.sites.replaceChildren(
    ...entries.sort(([a], [b]) => a.localeCompare(b)).map(([origin, decision]) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = origin;
      const verdict = document.createElement("span");
      verdict.className = "verdict";
      verdict.dataset.decision = String(decision);
      verdict.textContent = String(decision);
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "ghost";
      forget.textContent = "Forget";
      forget.addEventListener("click", () => void persistDecision(origin, "ask"));
      li.append(label, verdict, forget);
      return li;
    }),
  );
}

/**
 * @param {string} kind
 * @param {string} detail
 */
function setStatus(kind, detail) {
  dom.status.dataset.kind = kind;
  dom.status.textContent = detail;
  dom.status.title = detail;
}

/**
 * @param {string} kind
 * @param {string} detail
 */
function setBridgeStatus(kind, detail) {
  dom.bridgeStatus.dataset.kind = kind === "attached" ? "connected" : kind;
  dom.bridgeStatus.textContent = detail;
  dom.bridgeStatus.title = detail;
}

function openSettings() {
  dom.settings.hidden = false;
  dom.toggleSettings.setAttribute("aria-expanded", "true");
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// --- interactions ---------------------------------------------------------

dom.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = dom.input.value.trim();
  if (!prompt || !client || !threadId) {
    return;
  }
  dom.input.value = "";
  try {
    const started = await client.startTurn(threadId, prompt);
    streamingTurnId = started?.turn?.id;
    dom.stop.hidden = !streamingTurnId;
  } catch (error) {
    setStatus("error", `Could not send: ${messageOf(error)}`);
  }
});

dom.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    dom.composer.requestSubmit();
  }
});

dom.stop.addEventListener("click", () => {
  if (client && threadId && streamingTurnId) {
    void client.interrupt(threadId, streamingTurnId).catch(() => {});
  }
});

dom.pause.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get({ paused: false });
  const paused = !stored.paused;
  await chrome.storage.local.set({ paused });
  dom.pause.setAttribute("aria-pressed", String(paused));
  dom.pause.textContent = paused ? "Paused" : "Pause";
});

dom.toggleSettings.addEventListener("click", () => {
  dom.settings.hidden = !dom.settings.hidden;
  dom.toggleSettings.setAttribute("aria-expanded", String(!dom.settings.hidden));
});

dom.save.addEventListener("click", async () => {
  await saveSettings();
  closeStream();
  await connect();
});

dom.newThread.addEventListener("click", async () => {
  closeStream();
  await chrome.storage.local.remove("threadId");
  threadId = undefined;
  resetTranscript();
  await ensureThread();
});

window.addEventListener("pagehide", () => {
  closeStream();
  bridge?.stop();
});

// --- start ----------------------------------------------------------------

void (async () => {
  const stored = await chrome.storage.local.get({ paused: false });
  dom.pause.setAttribute("aria-pressed", String(stored.paused === true));
  dom.pause.textContent = stored.paused === true ? "Paused" : "Pause";
  await renderSites();
  await connect();
})();
