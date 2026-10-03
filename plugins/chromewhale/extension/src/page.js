/**
 * The four functions Codewhale for Chrome injects into a granted page.
 *
 * `chrome.scripting.executeScript({ func })` serializes the function source and
 * re-evaluates it in the target frame, so **each function here must be
 * self-contained**: no imports, no module-scope references, every helper nested
 * inside. Adding a shared top-level helper and calling it from one of these
 * silently breaks injection at runtime, not at load.
 *
 * They run in the default ISOLATED world, whose globals survive between
 * `executeScript` calls on the same document but are thrown away on navigation.
 * That is exactly the lifetime a snapshot's element refs should have: after a
 * page load the refs are gone, and a click against them reports staleness
 * instead of hitting whatever element now sits at that index.
 *
 * Ref numbers are never reused within a document: each snapshot continues the
 * count, so a ref from an older snapshot is reported as stale rather than
 * quietly naming a different element. A single-page app that changes its URL
 * without a load also invalidates the refs.
 *
 * Every function takes the origin the call was checked for and refuses to
 * touch a document from any other origin — the tab can move between the check
 * in the panel and the moment the script lands.
 *
 * Known limitations:
 * - Only the top frame is walked. Text and controls inside cross-origin iframes
 *   are invisible to a snapshot, and a ref can never point into one.
 * - Open shadow roots are traversed; closed ones are not reachable by design.
 * - `element.click()` dispatches an untrusted event. Sites that gate on
 *   `event.isTrusted` will ignore it, and nothing here can change that.
 */

/**
 * Walk the visible top frame, numbering interactive elements.
 *
 * @param {number} budget maximum characters of outline to return
 * @param {{origin?: string, names?: string, autocomplete?: string[]}} [rules]
 *   the origin the call was checked for, and `policy.js`'s sensitive-field
 *   rules (passed as data: this function cannot import them)
 * @returns {{url: string, title: string, outline: string, refCount: number,
 *            truncated: boolean, first: number} | {wrongOrigin: true, url: string}}
 */
export function snapshotPage(budget, rules = {}) {
  if (rules.origin && location.origin !== rules.origin) {
    return { wrongOrigin: true, url: location.href };
  }
  const SECRET_NAME = rules.names ? new RegExp(rules.names) : /pass(word|wd|code)|(^|[^a-z])(otp|cvv|cvc)($|[^a-z])/;
  const SECRET_AUTOCOMPLETE = new Set(
    rules.autocomplete ?? ["current-password", "new-password", "one-time-code", "cc-number", "cc-csc", "cc-exp"],
  );
  const INTERACTIVE =
    'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],' +
    '[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitem"],' +
    '[role="option"],[role="searchbox"],[role="textbox"],[contenteditable=""],' +
    '[contenteditable="true"]';
  // Compared against upper-cased tag names: SVG elements keep their
  // lowercase `tagName` even in HTML documents.
  const SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "HEAD",
    "SVG",
    "CANVAS",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "AUDIO",
    "VIDEO",
  ]);
  const MAX_ELEMENTS = 8000;

  const refs = [];
  const lines = [];
  let used = 0;
  let truncated = false;
  let seen = 0;

  const store = (globalThis.__chromewhale = globalThis.__chromewhale || { refs: [], first: 1, next: 1 });
  const first = store.next || 1;

  function collapse(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function clip(value, max) {
    const text = collapse(value);
    return text.length <= max ? text : `${text.slice(0, max)}…`;
  }

  function visible(element) {
    if (typeof element.checkVisibility === "function") {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        return false;
      }
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function accessibleName(element) {
    const aria = element.getAttribute("aria-label");
    if (aria) {
      return clip(aria, 120);
    }
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => node.textContent);
      if (parts.length) {
        return clip(parts.join(" "), 120);
      }
    }
    if (element.labels && element.labels.length) {
      const labelled = clip(
        Array.from(element.labels)
          .map((label) => label.textContent)
          .join(" "),
        120,
      );
      if (labelled) {
        return labelled;
      }
    }
    for (const attribute of ["alt", "placeholder", "title", "name"]) {
      const value = element.getAttribute(attribute);
      if (value) {
        return clip(value, 120);
      }
    }
    return clip(element.textContent, 120);
  }

  function fieldText(value) {
    return typeof value === "string" ? value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase() : "";
  }

  // The same rules `policy.js` applies before typing, so a field Codewhale
  // refuses to fill is also one whose value it never reads back.
  function sensitive(element) {
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (type === "password") {
      return true;
    }
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
    if (autocomplete.some((token) => SECRET_AUTOCOMPLETE.has(token))) {
      return true;
    }
    const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent).join(" ") : "";
    const named = [
      element.getAttribute("name"),
      element.id,
      element.getAttribute("aria-label"),
      labels,
      element.getAttribute("placeholder"),
    ]
      .map(fieldText)
      .join(" | ");
    return SECRET_NAME.test(named);
  }

  function describe(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    const type = (element.getAttribute("type") || "").toLowerCase();
    let kind = role || tag;
    if (tag === "a") {
      kind = "link";
    } else if (tag === "input") {
      kind = `input(${type || "text"})`;
    }
    const parts = [kind];
    const label = accessibleName(element);
    if (label) {
      parts.push(`"${label}"`);
    }
    if (tag === "a") {
      const href = element.getAttribute("href");
      if (href) {
        parts.push(`-> ${clip(href, 80)}`);
      }
    }
    if ((tag === "input" || tag === "textarea") && !sensitive(element)) {
      const value = clip(element.value, 60);
      if (value) {
        parts.push(`value="${value}"`);
      }
    }
    if (sensitive(element)) {
      parts.push("(protected)");
    }
    if (element.checked === true) {
      parts.push("checked");
    }
    if (element.disabled === true) {
      parts.push("disabled");
    }
    if (tag === "select") {
      const selected = clip(element.options?.[element.selectedIndex]?.text, 60);
      if (selected) {
        parts.push(`selected="${selected}"`);
      }
    }
    return parts.join(" ");
  }

  function push(line) {
    if (truncated || !line) {
      return;
    }
    if (used + line.length + 1 > budget) {
      truncated = true;
      return;
    }
    lines.push(line);
    used += line.length + 1;
  }

  function walk(element) {
    if (truncated) {
      return;
    }
    if (seen >= MAX_ELEMENTS) {
      truncated = true;
      return;
    }
    seen += 1;
    if (SKIP.has(element.tagName.toUpperCase()) || element.getAttribute("aria-hidden") === "true") {
      return;
    }
    if (!visible(element)) {
      return;
    }
    if (element.matches(INTERACTIVE)) {
      refs.push(element);
      push(`[e${first + refs.length - 1}] ${describe(element)}`);
      return;
    }
    if (/^H[1-6]$/.test(element.tagName)) {
      const heading = clip(element.textContent, 200);
      if (heading) {
        push(`${"#".repeat(Number(element.tagName[1]))} ${heading}`);
      }
      return;
    }
    const root = element.shadowRoot;
    const children = root ? [...root.childNodes, ...element.childNodes] : element.childNodes;
    for (const child of children) {
      if (truncated) {
        return;
      }
      if (child.nodeType === 3) {
        push(clip(child.nodeValue, 400));
      } else if (child.nodeType === 1) {
        walk(child);
      }
    }
  }

  if (document.body) {
    walk(document.body);
  }
  store.refs = refs;
  store.first = first;
  store.next = first + refs.length;
  store.url = location.href.split("#")[0];

  return {
    url: location.href,
    title: document.title,
    outline: lines.join("\n"),
    refCount: refs.length,
    truncated,
    first,
  };
}

/**
 * Report what an element ref points at, without touching it.
 *
 * The typing guard runs on this descriptor in `policy.js`, where it is pure and
 * unit-tested, rather than inside the page where it could only be asserted
 * through a browser.
 *
 * @param {string} ref
 * @param {string} [origin] the origin the call was checked for
 */
export function inspectRef(ref, origin) {
  if (origin && location.origin !== origin) {
    return { ok: false, stale: true, error: "The tab is on a different site than the one this call was checked for. Nothing was done; snapshot again." };
  }
  const store = globalThis.__chromewhale;
  const index = Number.parseInt(String(ref).replace(/^e/i, ""), 10);
  if (!store || !Array.isArray(store.refs) || store.refs.length === 0) {
    return { ok: false, stale: true, error: "No snapshot for this page. Call page_snapshot first." };
  }
  if (store.url && location.href.split("#")[0] !== store.url) {
    return { ok: false, stale: true, error: `The page changed its address since the last snapshot, so ${ref} may point elsewhere. Snapshot again.` };
  }
  const first = store.first || 1;
  if (Number.isFinite(index) && index < first) {
    return { ok: false, stale: true, error: `${ref} is from an older snapshot. Use the refs from the latest page_snapshot.` };
  }
  const element = Number.isFinite(index) ? store.refs[index - first] : undefined;
  if (!element) {
    return { ok: false, error: `Unknown element ref "${ref}". Call page_snapshot again.` };
  }
  if (!element.isConnected) {
    return { ok: false, stale: true, error: `Element ${ref} is no longer on the page. Snapshot again.` };
  }
  return {
    ok: true,
    tag: element.tagName.toLowerCase(),
    type: (element.getAttribute("type") || "").toLowerCase(),
    autocomplete: element.getAttribute("autocomplete") || "",
    name: element.getAttribute("name") || "",
    id: element.id || "",
    ariaLabel: element.getAttribute("aria-label") || "",
    fieldLabel: element.labels
      ? Array.from(element.labels)
          .map((label) => label.textContent)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200)
      : "",
    placeholder: element.getAttribute("placeholder") || "",
    editable:
      element.isContentEditable === true ||
      element.tagName === "TEXTAREA" ||
      (element.tagName === "INPUT" &&
        ["text", "search", "email", "url", "tel", "number", ""].includes(element.type || "")),
    disabled: element.disabled === true,
    // A click on this element submits a form. Only the markup-declared cases:
    // a script-driven "submit" on a div cannot be told apart from any click.
    // The `type` *property*, not the attribute: a button whose attribute is
    // missing or invalid (`type="submit "`, `type="x"`) still submits.
    submits:
      (element.tagName === "BUTTON" && element.type === "submit" && Boolean(element.form)) ||
      (element.tagName === "INPUT" && ["submit", "image"].includes(element.type) && Boolean(element.form)),
    label: (element.getAttribute("aria-label") || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120),
  };
}

/**
 * Click the element a ref points at.
 *
 * @param {string} ref
 * @param {string} [origin] the origin the call was checked for
 */
export function clickRef(ref, origin) {
  if (origin && location.origin !== origin) {
    return { ok: false, error: "The tab is on a different site than the one this call was checked for. Nothing was clicked; snapshot again." };
  }
  const store = globalThis.__chromewhale;
  const index = Number.parseInt(String(ref).replace(/^e/i, ""), 10);
  if (!store || !Array.isArray(store.refs) || store.refs.length === 0) {
    return { ok: false, error: "No snapshot for this page. Call page_snapshot first." };
  }
  if (store.url && location.href.split("#")[0] !== store.url) {
    return { ok: false, error: `The page changed its address since the last snapshot, so ${ref} may point elsewhere. Snapshot again.` };
  }
  const first = store.first || 1;
  if (Number.isFinite(index) && index < first) {
    return { ok: false, error: `${ref} is from an older snapshot. Use the refs from the latest page_snapshot.` };
  }
  const element = Number.isFinite(index) ? store.refs[index - first] : undefined;
  if (!element) {
    return { ok: false, error: `Unknown element ref "${ref}". Call page_snapshot again.` };
  }
  if (!element.isConnected) {
    return { ok: false, error: `Element ${ref} is no longer on the page. Snapshot again.` };
  }
  if (element.disabled === true) {
    return { ok: false, error: `Element ${ref} is disabled.` };
  }
  const label = (element.getAttribute("aria-label") || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus?.();
  element.click();
  return { ok: true, label, url: location.href };
}

/**
 * Type into the element a ref points at.
 *
 * The password check is repeated here as defence in depth. The richer policy
 * lives in `policy.js` and runs before this is injected; this copy exists so a
 * future caller that forgets the pre-check still cannot fill a password box.
 *
 * @param {string} ref
 * @param {string} text
 * @param {boolean} clear
 * @param {boolean} submit
 * @param {string} [origin] the origin the call was checked for
 */
export function typeRef(ref, text, clear, submit, origin) {
  if (origin && location.origin !== origin) {
    return { ok: false, error: "The tab is on a different site than the one this call was checked for. Nothing was typed; snapshot again." };
  }
  const store = globalThis.__chromewhale;
  const index = Number.parseInt(String(ref).replace(/^e/i, ""), 10);
  if (!store || !Array.isArray(store.refs) || store.refs.length === 0) {
    return { ok: false, error: "No snapshot for this page. Call page_snapshot first." };
  }
  if (store.url && location.href.split("#")[0] !== store.url) {
    return { ok: false, error: `The page changed its address since the last snapshot, so ${ref} may point elsewhere. Snapshot again.` };
  }
  const first = store.first || 1;
  if (Number.isFinite(index) && index < first) {
    return { ok: false, error: `${ref} is from an older snapshot. Use the refs from the latest page_snapshot.` };
  }
  const element = Number.isFinite(index) ? store.refs[index - first] : undefined;
  if (!element || !element.isConnected) {
    return { ok: false, error: `Element ${ref} is not on the page. Call page_snapshot again.` };
  }
  if ((element.getAttribute("type") || "").toLowerCase() === "password") {
    return { ok: false, error: "Codewhale for Chrome never types into a password field." };
  }
  if (element.disabled === true || element.readOnly === true) {
    return { ok: false, error: `Element ${ref} does not accept input.` };
  }
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  if (element.isContentEditable) {
    // Through the editing pipeline, not `textContent`: that would replace every
    // child node (links, mentions, formatting) and rich editors revert it.
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      if (!clear) {
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!inserted) {
      if (clear) {
        element.textContent = "";
      }
      element.append(document.createTextNode(text));
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  } else {
    // The prototype's setter, not `element.value =`: frameworks such as React
    // shadow the instance property to track changes, and an assignment that
    // skips their tracker is silently reverted on the next render.
    const next = clear ? text : `${element.value}${text}`;
    const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(element, next);
    } else {
      element.value = next;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (submit) {
    // A page that handles Enter itself (and says so with preventDefault) has
    // submitted already; submitting the form as well would send it twice.
    const down = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true });
    const handled = !element.dispatchEvent(down);
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    const form = element.form;
    if (!handled && form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
    }
  }
  return { ok: true, url: location.href };
}
