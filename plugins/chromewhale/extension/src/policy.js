/**
 * Codewhale for Chrome's trust boundary: which page a browser tool may touch, and which
 * field it may never type into.
 *
 * Deliberately pure — no `chrome.*`, no DOM — so `node --test` exercises the
 * guards directly instead of through a browser harness. Everything that decides
 * "may this act on that page" lives here; `browser.js` only routes.
 *
 * Known limitations, stated where the behaviour is owned:
 *
 * - This is the *second* gate, not the only one. The `page_*` tools reach
 *   Codewhale over MCP (`mcp/server.mjs`), so every call first passes
 *   Codewhale's own approval path and permission profile. That gate knows the
 *   tool and its arguments but not which page is in front of the user; this
 *   module is the only part that does. Do not weaken either assuming the other.
 * - A decision is per **origin**, matching Chrome's own permission granularity.
 *   There is no per-path grant, and none is planned: a grant that is finer
 *   than the platform's would be a claim the platform cannot keep. Submitting
 *   a form is confirmed per action (`browser.js`), which is a confirmation on
 *   top of the grant, not a finer grant.
 * - The default answer is "Allow for this session". "Always allow" is a
 *   separate, deliberate click.
 * - The sensitive-field list below is a floor, not a promise that every secret
 *   input is recognised. It refuses the fields whose markup says what they are.
 */

/** Schemes a browser tool must never touch, whatever the user granted. */
const BLOCKED_SCHEMES = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "chrome-search:",
  "devtools:",
  "edge:",
  "about:",
  "view-source:",
  "file:",
  "data:",
  "blob:",
  "javascript:",
  "filesystem:",
  "ws:",
  "wss:",
]);

/**
 * Hosts Chrome itself refuses to let extensions script. Listed so the model
 * gets a sentence it can act on instead of an opaque injection failure.
 */
const BLOCKED_HOSTS = new Set([
  "chromewebstore.google.com",
  "chrome.google.com",
  "microsoftedge.microsoft.com",
]);

/**
 * `autocomplete` tokens and input types that name a secret. Typing into these
 * is refused outright: the model has no business filling a password, a
 * one-time code, or a card number, and a user who wants that typed can type it.
 */
const SENSITIVE_INPUT_TYPES = new Set(["password"]);
export const SENSITIVE_AUTOCOMPLETE = [
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
];

/**
 * Field names, ids, labels and placeholders that name a secret. Matched against
 * text normalized by `fieldText` (camelCase split, lowercased). Long terms are
 * unanchored — real markup says `user_password`, `login[passwd]`,
 * `card-number` — and short ones need a non-letter on each side, where `_` and
 * digits count, so `otp_code`, `cvv2` and `card_cvv` match while `spinner`
 * and `helpotpimal` do not. Erring toward refusal is the safe direction: the
 * user can always type the field themselves.
 *
 * Shared with the snapshot as a *string*, because injected page functions must
 * be self-contained and cannot import it.
 */
export const SENSITIVE_NAME_SOURCE =
  "pass(word|wd|code|phrase)|secret|card.?(number|num|no\\b)|cc.?(number|num)|ccnum|credit.?card|" +
  "security.?code|verification.?code|auth(entication)?.?code|authenticator|two.?factor|one.?time|social.?security|" +
  "(^|[^a-z])(otp|totp|mfa|2fa|cvv\\d?|cvc\\d?|csc|pin|ssn)($|[^a-z])";
const SENSITIVE_NAME = new RegExp(SENSITIVE_NAME_SOURCE);

/**
 * Normalize one naming attribute for `SENSITIVE_NAME`.
 *
 * @param {unknown} value
 */
export function fieldText(value) {
  return typeof value === "string" ? value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase() : "";
}

/**
 * Classify a tab URL (or a navigation target) for tool use.
 *
 * @param {unknown} rawUrl
 * @returns {{ok: true, origin: string, pattern: string, host: string}
 *          | {ok: false, reason: string}}
 */
export function classifyTarget(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return { ok: false, reason: "No page is open in the active tab." };
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Not a usable page address: ${truncate(rawUrl, 120)}` };
  }
  if (BLOCKED_SCHEMES.has(url.protocol)) {
    return {
      ok: false,
      reason: `Codewhale for Chrome never acts on ${url.protocol} pages. Open an http(s) page first.`,
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `Codewhale for Chrome only acts on http and https pages, not ${url.protocol}.`,
    };
  }
  if (BLOCKED_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      reason: `Chrome blocks extensions on ${url.hostname}, so Codewhale for Chrome cannot act there.`,
    };
  }
  return {
    ok: true,
    origin: url.origin,
    host: url.hostname,
    pattern: `${url.origin}/*`,
  };
}

/**
 * Read the decision for an origin.
 *
 * Two stores feed it. `store` is the standing one (`chrome.storage.local`):
 * "Always allow" and "Block" live there and survive restarts. `session` holds
 * "Allow for this session" grants (`chrome.storage.session`), which Chrome
 * clears when the browser exits. A standing block beats a session grant, so a
 * block is never silently overridden by an older, looser answer.
 *
 * @param {Record<string, unknown> | undefined | null} store
 * @param {string} origin
 * @param {Record<string, unknown> | undefined | null} [session]
 * @returns {"allow" | "block" | "ask"}
 */
export function decisionFor(store, origin, session) {
  const value = store && typeof store === "object" ? store[origin] : undefined;
  if (value === "allow" || value === "block") {
    return value;
  }
  const scoped = session && typeof session === "object" ? session[origin] : undefined;
  return scoped === "allow" ? "allow" : "ask";
}

/**
 * Apply a decision to the stored map, returning a new map.
 *
 * `"ask"` removes the entry, which is how the panel's "Forget" control works:
 * an origin with no entry is asked about again on the next call.
 *
 * @param {Record<string, unknown> | undefined | null} store
 * @param {string} origin
 * @param {"allow" | "block" | "ask"} decision
 * @returns {Record<string, "allow" | "block">}
 */
export function withDecision(store, origin, decision) {
  /** @type {Record<string, "allow" | "block">} */
  const next = {};
  for (const [key, value] of Object.entries(store && typeof store === "object" ? store : {})) {
    if (key !== origin && (value === "allow" || value === "block")) {
      next[key] = value;
    }
  }
  if (decision === "allow" || decision === "block") {
    next[origin] = decision;
  }
  return next;
}

/**
 * Is this form field one Codewhale for Chrome must refuse to type into?
 *
 * @param {{tag?: unknown, type?: unknown, autocomplete?: unknown, name?: unknown,
 *          id?: unknown, ariaLabel?: unknown, fieldLabel?: unknown, placeholder?: unknown}} field
 * @returns {{sensitive: true, reason: string} | {sensitive: false}}
 */
export function sensitiveField(field) {
  const descriptor = field && typeof field === "object" ? field : {};
  const type = lower(descriptor.type);
  if (SENSITIVE_INPUT_TYPES.has(type)) {
    return {
      sensitive: true,
      reason: "this is a password field; Codewhale for Chrome never types into one",
    };
  }
  const autocomplete = lower(descriptor.autocomplete);
  for (const token of autocomplete.split(/\s+/)) {
    if (SENSITIVE_AUTOCOMPLETE.includes(token)) {
      return {
        sensitive: true,
        reason: `the field is marked autocomplete="${token}"; Codewhale for Chrome never types credentials or card details`,
      };
    }
  }
  const named = [descriptor.name, descriptor.id, descriptor.ariaLabel, descriptor.fieldLabel, descriptor.placeholder]
    .map(fieldText)
    .join(" | ");
  if (SENSITIVE_NAME.test(named)) {
    return {
      sensitive: true,
      reason: "the field names itself a password, one-time code, or card number",
    };
  }
  return { sensitive: false };
}

/** @param {unknown} value */
function lower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {string} value
 * @param {number} max
 */
function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
