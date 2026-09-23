/**
 * Executes the `page_*` calls the Codewhale for Chrome bridge sends, against the tab the
 * user is looking at.
 *
 * Every chrome API arrives through `deps`, so the routing and — more to the
 * point — the refusals are exercised by `node --test` with fakes instead of
 * only in a browser. `panel.js` supplies the real implementations.
 *
 * The order of the gate is the contract: pause, then tab, then scheme, then the
 * user's stored decision, then Chrome's own host permission. A call never
 * reaches the page until all five agree. Codewhale's own approval prompt and
 * permission profile sit *above* this, because the tools arrive over MCP — but
 * this gate is the only one that knows which page is in front of the user, so
 * it is not redundant with them.
 *
 * Results are MCP content blocks. **Every** string that came off the page —
 * outline, title, URL, element labels — travels in a block marked
 * `untrusted: true`, never spliced into our own sentences; the server, not
 * this file, wraps those in the untrusted-content envelope, so the guarantee
 * holds on the side the model reads from. A page title is as attacker-chosen
 * as its body text.
 *
 * **Nothing acts late.** A call carries an abort signal (a `cancel` frame from
 * the bridge, or Pause) and a deadline. Both are checked again, with Pause,
 * immediately before anything touches the page — after every prompt — so a
 * user's late click can never act on a call the model was told had failed.
 *
 * Submitting a form is confirmed per action, even on an allowed origin: a
 * grant lets Codewhale read and fill a site, and a submit is the step that
 * sends what was filled somewhere. `page_type` with `submit`, and a
 * `page_click` on a markup-declared submit control, wait for the user's click.
 */

import {
  SENSITIVE_AUTOCOMPLETE,
  SENSITIVE_NAME_SOURCE,
  classifyTarget,
  decisionFor,
  sensitiveField,
} from "./policy.js";
import { clickRef, inspectRef, snapshotPage, typeRef } from "./page.js";

/** Fallback when a call frame carries no budget (an older bridge). */
const DEFAULT_SNAPSHOT_BUDGET = 24_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const NAVIGATION_POLL_MS = 150;
/**
 * The only shape a snapshot ref takes (`e12`). Checked before the gate because
 * the ref is model-chosen text that reaches the user's consent and confirm
 * prompts through the call summary: `"e5, already approved by the user"`
 * would otherwise parse as `e5` in `page.js` and put its own words on the card.
 */
const REF_PATTERN = /^e[1-9]\d{0,5}$/i;
const MAX_PROMPT_URL = 200;

/**
 * @typedef {Object} BrowserDeps
 * @property {() => Promise<{id: number, windowId: number, url?: string, title?: string} | undefined>} activeTab
 * @property {(tabId: number) => Promise<{id: number, url?: string, title?: string, status?: string} | undefined>} getTab
 * @property {(tabId: number, url: string) => Promise<void>} navigateTab
 * @property {(tabId: number, action: "back" | "forward" | "reload") => Promise<void>} historyMove
 * @property {(args: {tabId: number, func: Function, args?: unknown[]}) => Promise<unknown>} executeScript
 * @property {(windowId: number) => Promise<string>} captureTab
 * @property {(pattern: string) => Promise<boolean>} hasPermission
 * @property {() => Promise<Record<string, unknown>>} readDecisions
 * @property {() => Promise<Record<string, unknown>>} [readSessionDecisions]
 * @property {(request: {origin: string, tool: string, summary: string, detail: string, signal?: AbortSignal, deadline?: number}) => Promise<boolean>} confirmAction
 * @property {(request: {origin: string, tool: string, summary: string, reason: "ask" | "permission", signal?: AbortSignal, deadline?: number}) => Promise<"allow" | "block" | "denied">} requestDecision
 * @property {() => Promise<boolean>} isPaused
 * @property {(entry: {tool: string, summary: string, origin?: string, outcome: string}) => void} log
 * @property {(ms: number) => Promise<void>} sleep
 */

/**
 * @param {BrowserDeps} deps
 */
export function createBrowserTools(deps) {
  /**
   * Run one bridge call and produce its result blocks.
   *
   * Never throws: a refusal and a crash both become `success: false` with a
   * readable sentence, so the model learns what happened instead of the call
   * sitting until the bridge's timeout fires.
   *
   * @param {{tool: string, args?: Record<string, unknown>, summary?: string, budget?: number,
   *          deadline?: number, signal?: AbortSignal}} call
   */
  async function execute(call) {
    const name = call?.tool ?? "";
    const args = call?.args && typeof call.args === "object" ? call.args : {};
    const summary = typeof call?.summary === "string" && call.summary ? call.summary : name;
    const budget = Number.isFinite(call?.budget) ? Number(call.budget) : DEFAULT_SNAPSHOT_BUDGET;
    /** @type {Live} */
    const live = {
      signal: call?.signal,
      deadline: Number.isFinite(call?.deadline) ? Number(call.deadline) : undefined,
    };
    try {
      switch (name) {
        case "page_snapshot":
          return await runSnapshot(summary, budget, live);
        case "page_navigate":
          return await runNavigate(args, summary, live);
        case "page_click":
          return await runClick(args, summary, live);
        case "page_type":
          return await runType(args, summary, live);
        case "page_screenshot":
          return await runScreenshot(summary, live);
        default:
          return failure(`Codewhale for Chrome's panel does not implement "${name}".`);
      }
    } catch (error) {
      deps.log({ tool: name, summary, outcome: "error" });
      return failure(`Codewhale for Chrome could not run ${name}: ${messageOf(error)}`);
    }
  }

  /**
   * Why this call must not act now, or `undefined` if it still may. Checked
   * right before every side effect, after any prompt the user answered.
   *
   * @param {Live} live
   */
  async function halted(live) {
    if (live.signal?.aborted) {
      return live.signal.reason === "paused"
        ? "The user paused Codewhale for Chrome while this call was waiting. Nothing was done."
        : "This call was cancelled before it acted. Nothing was done.";
    }
    if (live.deadline !== undefined && Date.now() > live.deadline) {
      return "This call ran out of time before it could act (the user may not have answered a prompt). Nothing was done.";
    }
    if (await deps.isPaused()) {
      return "Codewhale for Chrome is paused. The user can resume it from the side panel.";
    }
    return undefined;
  }

  /**
   * `halted` as a refusal result, or `undefined` to proceed.
   *
   * @param {string} tool
   * @param {string} summary
   * @param {string | undefined} origin
   * @param {Live} live
   */
  async function stop(tool, summary, origin, live) {
    const reason = await halted(live);
    if (!reason) {
      return undefined;
    }
    deps.log({ tool, summary, origin, outcome: "refused" });
    return failure(reason);
  }

  /** The sensitive-field rules and the checked origin, as page-script data. */
  function pageRules(origin) {
    return { origin, names: SENSITIVE_NAME_SOURCE, autocomplete: SENSITIVE_AUTOCOMPLETE };
  }

  /**
   * The five-step gate. Returns the tab and origin, or the refusal.
   *
   * @param {string} tool
   * @param {string} summary
   * @param {Live} live
   * @param {string} [targetUrl] the URL the call is *about*, when it is not the
   *   tab's current one (a navigation's destination).
   */
  async function gate(tool, summary, live, targetUrl) {
    if (await deps.isPaused()) {
      return refuse(tool, summary, undefined, "Codewhale for Chrome is paused. The user can resume it from the side panel.");
    }
    const tab = await deps.activeTab();
    if (!tab || typeof tab.id !== "number") {
      return refuse(tool, summary, undefined, "No active Chrome tab is available.");
    }
    const classified = classifyTarget(targetUrl ?? tab.url);
    if (!classified.ok) {
      return refuse(tool, summary, undefined, classified.reason);
    }
    const { origin, pattern } = classified;

    const session = deps.readSessionDecisions ? await deps.readSessionDecisions() : {};
    let decision = decisionFor(await deps.readDecisions(), origin, session);
    if (decision === "block") {
      return refuse(tool, summary, origin, `The user has blocked Codewhale for Chrome on ${origin}.`);
    }

    // An allowed origin whose Chrome host permission was revoked (or never
    // granted, on a decision restored from storage) needs a fresh user gesture.
    let permitted = await deps.hasPermission(pattern);
    if (decision === "ask" || !permitted) {
      const answer = await deps.requestDecision({
        origin,
        tool,
        summary,
        reason: decision === "ask" ? "ask" : "permission",
        signal: live.signal,
        deadline: live.deadline,
      });
      if (answer !== "allow") {
        return refuse(
          tool,
          summary,
          origin,
          answer === "block"
            ? `The user blocked Codewhale for Chrome on ${origin}.`
            : `The user did not grant Codewhale for Chrome access to ${origin}.`,
        );
      }
      decision = "allow";
      permitted = await deps.hasPermission(pattern);
    }
    if (!permitted) {
      return refuse(tool, summary, origin, `Chrome did not grant Codewhale for Chrome access to ${origin}.`);
    }
    const late = await halted(live);
    if (late) {
      return refuse(tool, summary, origin, late);
    }
    return { ok: /** @type {true} */ (true), tab, origin };
  }

  /**
   * @param {string} summary
   * @param {number} budget
   * @param {Live} live
   */
  async function runSnapshot(summary, budget, live) {
    const gated = await gate("page_snapshot", summary, live);
    if (!gated.ok) {
      return gated.result;
    }
    const page = await deps.executeScript({
      tabId: gated.tab.id,
      func: snapshotPage,
      args: [budget, pageRules(gated.origin)],
    });
    if (!page || typeof page !== "object") {
      return failure("The page did not return a snapshot. It may still be loading.");
    }
    if (page.wrongOrigin) {
      return failure(`The tab left ${gated.origin} before it could be read. Nothing was read; snapshot again.`);
    }
    deps.log({ tool: "page_snapshot", summary, origin: gated.origin, outcome: "ran" });
    const header = [
      `interactive elements: ${Number(page.refCount) || 0}`,
      page.truncated ? "note: the outline was cut at Codewhale for Chrome's size budget." : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      success: true,
      content: [
        { type: "text", text: header },
        pageText([`url: ${page.url}`, `title: ${page.title}`, "", String(page.outline ?? "")]),
      ],
    };
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {string} summary
   * @param {Live} live
   */
  async function runNavigate(args, summary, live) {
    const url = typeof args?.url === "string" ? args.url.trim() : "";
    const action = typeof args?.action === "string" ? args.action : "";
    if (Boolean(url) === Boolean(action)) {
      return failure("page_navigate takes exactly one of url or action.");
    }
    if (action && !["back", "forward", "reload"].includes(action)) {
      return failure(`Unknown navigate action "${action}". Use back, forward, or reload.`);
    }
    // The prompt names the parsed address, not the model's raw string: a URL
    // with spaces in it parses, and would read as a sentence on the card.
    const shown = url ? promptUrl(url) : undefined;
    const gated = await gate("page_navigate", shown ? `open ${shown}` : summary, live, url || undefined);
    if (!gated.ok) {
      return gated.result;
    }
    if (url) {
      await deps.navigateTab(gated.tab.id, url);
    } else {
      await deps.historyMove(gated.tab.id, /** @type {"back"|"forward"|"reload"} */ (action));
    }
    const settled = await waitForLoad(gated.tab.id);
    deps.log({ tool: "page_navigate", summary, origin: gated.origin, outcome: "ran" });
    return {
      success: true,
      content: [
        {
          type: "text",
          text:
            settled?.status === "complete"
              ? "The page finished loading. Call page_snapshot to read it."
              : "The page was still loading when Codewhale for Chrome stopped waiting. Snapshot to see its current state.",
        },
        pageText([`url: ${settled?.url ?? "unknown"}`, `title: ${settled?.title ?? ""}`]),
      ],
    };
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {string} summary
   * @param {Live} live
   */
  async function runClick(args, summary, live) {
    const ref = typeof args?.ref === "string" ? args.ref : "";
    if (!ref) {
      return failure("page_click needs a ref from the latest page_snapshot.");
    }
    if (!REF_PATTERN.test(ref)) {
      return failure(`"${truncate(ref, 40)}" is not an element ref. Use one like e12 from the latest page_snapshot.`);
    }
    const gated = await gate("page_click", summary, live);
    if (!gated.ok) {
      return gated.result;
    }
    // A failed inspection is not fatal here: `clickRef` reports staleness and
    // unknown refs in its own words. Only a control that declares it submits
    // a form needs the extra confirmation.
    const target = await deps.executeScript({ tabId: gated.tab.id, func: inspectRef, args: [ref, gated.origin] });
    if (target?.ok && target.submits === true) {
      const confirmed = await deps.confirmAction({
        origin: gated.origin,
        tool: "page_click",
        summary,
        detail: `Clicking ${ref} submits a form on ${gated.origin}.`,
        signal: live.signal,
        deadline: live.deadline,
      });
      if (!confirmed) {
        deps.log({ tool: "page_click", summary, origin: gated.origin, outcome: "refused" });
        return failure(`The user did not confirm submitting the form on ${gated.origin}. Nothing was clicked.`);
      }
    }
    const late = await stop("page_click", summary, gated.origin, live);
    if (late) {
      return late;
    }
    const outcome = await deps.executeScript({ tabId: gated.tab.id, func: clickRef, args: [ref, gated.origin] });
    if (!outcome?.ok) {
      deps.log({ tool: "page_click", summary, origin: gated.origin, outcome: "refused" });
      return failure(outcome?.error ?? "The click did not reach an element.");
    }
    const settled = await waitForLoad(gated.tab.id, 2_000);
    deps.log({ tool: "page_click", summary, origin: gated.origin, outcome: "ran" });
    return {
      success: true,
      content: [
        { type: "text", text: `Clicked ${ref}. Call page_snapshot to see what changed.` },
        pageText([`clicked: ${outcome.label || ref}`, `url: ${settled?.url ?? outcome.url}`]),
      ],
    };
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {string} summary
   * @param {Live} live
   */
  async function runType(args, summary, live) {
    const ref = typeof args?.ref === "string" ? args.ref : "";
    const text = typeof args?.text === "string" ? args.text : "";
    if (!ref) {
      return failure("page_type needs a ref from the latest page_snapshot.");
    }
    if (!REF_PATTERN.test(ref)) {
      return failure(`"${truncate(ref, 40)}" is not an element ref. Use one like e12 from the latest page_snapshot.`);
    }
    const gated = await gate("page_type", summary, live);
    if (!gated.ok) {
      return gated.result;
    }
    const field = await deps.executeScript({ tabId: gated.tab.id, func: inspectRef, args: [ref, gated.origin] });
    if (!field?.ok) {
      return failure(field?.error ?? `Element ${ref} could not be inspected.`);
    }
    const verdict = sensitiveField(field);
    if (verdict.sensitive) {
      deps.log({ tool: "page_type", summary, origin: gated.origin, outcome: "refused" });
      return failure(
        `Refused to type into ${ref}: ${verdict.reason}. Ask the user to fill this field themselves.`,
      );
    }
    if (!field.editable) {
      // No tag name here: custom-element names are page-chosen text too.
      return failure(`Element ${ref} does not accept typed text.`);
    }
    if (args?.submit === true) {
      const confirmed = await deps.confirmAction({
        origin: gated.origin,
        tool: "page_type",
        summary,
        detail: `Typing into ${ref} and pressing Enter submits it on ${gated.origin}.`,
        signal: live.signal,
        deadline: live.deadline,
      });
      if (!confirmed) {
        deps.log({ tool: "page_type", summary, origin: gated.origin, outcome: "refused" });
        return failure(
          `The user did not confirm submitting on ${gated.origin}. Nothing was typed; ` +
            "call page_type without submit to fill the field only.",
        );
      }
    }
    const late = await stop("page_type", summary, gated.origin, live);
    if (late) {
      return late;
    }
    const outcome = await deps.executeScript({
      tabId: gated.tab.id,
      func: typeRef,
      args: [ref, text, args?.clear !== false, args?.submit === true, gated.origin],
    });
    if (!outcome?.ok) {
      return failure(outcome?.error ?? "The text did not reach the field.");
    }
    const settled = args?.submit === true ? await waitForLoad(gated.tab.id, 5_000) : undefined;
    deps.log({ tool: "page_type", summary, origin: gated.origin, outcome: "ran" });
    return {
      success: true,
      content: [
        { type: "text", text: `Typed into ${ref}. Call page_snapshot to see the result.` },
        pageText([`typed into: ${field.label || ref}`, `url: ${settled?.url ?? outcome.url}`]),
      ],
    };
  }

  /**
   * @param {string} summary
   * @param {Live} live
   */
  async function runScreenshot(summary, live) {
    const gated = await gate("page_screenshot", summary, live);
    if (!gated.ok) {
      return gated.result;
    }
    let dataUrl;
    try {
      dataUrl = await deps.captureTab(gated.tab.windowId);
    } catch (error) {
      // Chrome lets an extension capture a tab only under `activeTab`, which
      // the user grants by clicking its toolbar button on that tab. A site
      // grant is not enough, and asking for every site to get it would be.
      if (/activeTab|all_urls/i.test(messageOf(error))) {
        deps.log({ tool: "page_screenshot", summary, origin: gated.origin, outcome: "refused" });
        return failure(
          "Chrome only lets Codewhale for Chrome capture a tab after the user clicks its toolbar button on that " +
            "tab. Ask the user to click the Codewhale for Chrome button, then try again — or use page_snapshot.",
        );
      }
      throw error;
    }
    const image = splitDataUrl(dataUrl);
    if (!image) {
      return failure("Chrome did not return an image for the visible tab.");
    }
    deps.log({ tool: "page_screenshot", summary, origin: gated.origin, outcome: "ran" });
    return {
      success: true,
      content: [
        { type: "text", text: "Visible area of the active tab." },
        pageText([`url: ${gated.tab.url ?? gated.origin}`]),
        { type: "image", data: image.data, mimeType: image.mimeType },
      ],
    };
  }

  /**
   * @param {number} tabId
   * @param {number} [timeoutMs]
   */
  async function waitForLoad(tabId, timeoutMs = NAVIGATION_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let latest;
    do {
      latest = await deps.getTab(tabId);
      if (!latest || latest.status === "complete") {
        return latest;
      }
      await deps.sleep(NAVIGATION_POLL_MS);
    } while (Date.now() < deadline);
    return latest;
  }

  /**
   * @param {string} tool
   * @param {string} summary
   * @param {string | undefined} origin
   * @param {string} reason
   */
  function refuse(tool, summary, origin, reason) {
    deps.log({ tool, summary, origin, outcome: "refused" });
    return { ok: /** @type {false} */ (false), result: failure(reason) };
  }

  return { execute };
}

/**
 * What a call carries to decide whether it may still act.
 *
 * @typedef {{signal?: AbortSignal, deadline?: number}} Live
 */

/**
 * Split a `data:` URL into the pieces an MCP image block needs.
 *
 * @param {unknown} dataUrl
 * @returns {{data: string, mimeType: string} | undefined}
 */
export function splitDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    return undefined;
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  return match ? { mimeType: match[1].toLowerCase(), data: match[2] } : undefined;
}

/**
 * A text block of page-derived strings, marked for the server's envelope.
 *
 * @param {string[]} lines
 */
function pageText(lines) {
  return { type: "text", text: lines.join("\n"), untrusted: true };
}

/**
 * @param {string} raw
 */
function promptUrl(raw) {
  let href = raw;
  try {
    href = new URL(raw).href;
  } catch {
    // The gate refuses it with its own reason; only the wording is at stake.
  }
  return truncate(href, MAX_PROMPT_URL);
}

/**
 * @param {string} value
 * @param {number} max
 */
function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** @param {string} text */
function failure(text) {
  return { success: false, content: [{ type: "text", text }] };
}

/** @param {unknown} error */
function messageOf(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "unknown error";
}
