#!/usr/bin/env node
// design-review helper: static accessibility scan, WCAG contrast ratio, and a
// visible-text inventory for copy review. Node 22+, no npm dependencies.
//
//   design-review.mjs scan <file.html> [--json]
//   design-review.mjs contrast <foreground> <background> [--json]
//   design-review.mjs strings <file.html> [--json]
//
// This is a STATIC check of markup you give it. It cannot see computed styles,
// scripts that build the DOM later, focus order, keyboard traps or what a
// screen reader announces. A clean scan is not proof of an accessible page.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------- HTML parsing

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style"]);
const ENTITIES = {nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'"};

function decode(text) {
  return text.replace(/&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity) => {
    const value = entity.toLowerCase();
    if (value[0] !== "#") return ENTITIES[value];
    const point = value.startsWith("#x") ? parseInt(value.slice(2), 16) : Number(value.slice(1));
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : "\ufffd";
  });
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

export function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null, line: 1 };
  let cur = root;
  const lineAt = (i) => html.slice(0, i).split("\n").length;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let last = 0;
  let m;
  const text = (from, to) => {
    const t = html.slice(from, to);
    if (t) cur.children.push({ text: decode(t) });
  };
  while ((m = re.exec(html))) {
    text(last, m.index);
    last = re.lastIndex;
    if (m[0].startsWith("<!")) continue;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let n = cur; n && n !== root; n = n.parent) {
        if (n.tag === name) { cur = n.parent; break; }
      }
      continue;
    }
    const tag = m[2].toLowerCase();
    const selfClosed = /\/\s*$/.test(m[3]);
    const node = { tag, attrs: parseAttrs(m[3]), children: [], parent: cur, line: lineAt(m.index) };
    cur.children.push(node);
    if (RAW.has(tag) && !selfClosed) {
      const close = new RegExp(`</${tag}\\s*>`, "i");
      close.lastIndex = 0;
      const rest = html.slice(re.lastIndex);
      const end = rest.search(close);
      const body = end < 0 ? rest : rest.slice(0, end);
      node.children.push({ raw: body });
      re.lastIndex += end < 0 ? rest.length : end + rest.match(close)[0].length;
      last = re.lastIndex;
    } else if (!VOID.has(tag) && !selfClosed) cur = node;
  }
  text(last, html.length);
  return root;
}

function* walk(node) {
  for (const c of node.children ?? []) {
    if (c.tag) { yield c; yield* walk(c); }
  }
}

function textOf(node) {
  let out = "";
  for (const c of node.children ?? []) {
    if (c.text) out += c.text;
    else if (c.tag === "img" && c.attrs.alt) out += ` ${c.attrs.alt} `;
    else if (c.tag === "svg") out += svgName(c);
    else if (c.tag && c.attrs["aria-hidden"] !== "true" && !RAW.has(c.tag)) out += textOf(c);
  }
  return out.replace(/\s+/g, " ").trim();
}

function svgName(svg) {
  if (svg.attrs["aria-label"]) return ` ${svg.attrs["aria-label"]} `;
  for (const c of svg.children) if (c.tag === "title") return ` ${textOf(c)} `;
  return "";
}

// --------------------------------------------------------------- the rules

const NONTEXT_INPUT = new Set(["hidden", "submit", "button", "reset", "image"]);
const FOCUSABLE = new Set(["a", "button", "input", "select", "textarea", "summary"]);

function labelledByText(node, ids) {
  return (node.attrs["aria-labelledby"] ?? "").split(/\s+/).filter(Boolean)
    .map((id) => (ids.has(id) ? textOf(ids.get(id)) : "")).join(" ").trim();
}

function accessibleName(node, ids) {
  const a = node.attrs;
  if (a["aria-label"]?.trim()) return a["aria-label"].trim();
  const labelled = labelledByText(node, ids);
  if (labelled) return labelled;
  const own = textOf(node);
  if (own) return own;
  return a.title?.trim() || "";
}

export function scanHtml(html) {
  const findings = [];
  const add = (severity, rule, wcag, node, message) => findings.push({ severity, rule, wcag, line: node?.line ?? 1, message });
  const root = parseHtml(html);
  const nodes = [...walk(root)];
  const ids = new Map();
  const dupes = new Set();
  for (const n of nodes) {
    const id = n.attrs.id;
    if (id === undefined) continue;
    if (ids.has(id)) { if (!dupes.has(id)) add("error", "duplicate-id", "4.1.2", n, `id="${id}" is used more than once, so labels and aria references point at the wrong element`); dupes.add(id); }
    else ids.set(id, n);
  }
  const labelFor = new Set(nodes.filter((n) => n.tag === "label" && n.attrs.for).map((n) => n.attrs.for));
  const inLabel = (n) => { for (let p = n.parent; p; p = p.parent) if (p.tag === "label") return true; return false; };

  const htmlEl = nodes.find((n) => n.tag === "html");
  if (htmlEl && !htmlEl.attrs.lang?.trim()) add("error", "html-lang", "3.1.1", htmlEl, "<html> has no lang attribute, so screen readers may use the wrong pronunciation");
  if (htmlEl || nodes.some((n) => n.tag === "head")) {
    const title = nodes.find((n) => n.tag === "title");
    if (!title || !textOf(title)) add("error", "page-title", "2.4.2", title ?? htmlEl, "the page has no non-empty <title>");
  }
  for (const n of nodes.filter((x) => x.tag === "meta")) {
    const content = n.attrs.content ?? "";
    if (n.attrs.name?.toLowerCase() === "viewport" && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0*)?(?![\d.])/i.test(content)) add("error", "viewport-zoom", "1.4.4", n, "the viewport blocks pinch zoom; low-vision users cannot enlarge the page");
    if (n.attrs["http-equiv"]?.toLowerCase() === "refresh" && /^\s*[1-9]\d*/.test(content)) add("warning", "meta-refresh", "2.2.1", n, "the page refreshes or redirects on a timer, which disorients and interrupts users");
  }

  let prevLevel = 0;
  let h1s = 0;
  for (const n of nodes) {
    const t = n.tag;
    const a = n.attrs;
    const role = a.role?.toLowerCase();
    if (t === "img" && !("alt" in a) && role !== "presentation" && role !== "none") add("error", "img-alt", "1.1.1", n, `<img${a.src ? ` src="${a.src.slice(0, 40)}"` : ""}> has no alt attribute; use alt="" if it is decorative`);
    if (t === "iframe" && !a.title?.trim() && !a["aria-label"]) add("error", "iframe-title", "4.1.2", n, "<iframe> has no title describing its content");
    if (t === "input" && NONTEXT_INPUT.has((a.type ?? "text").toLowerCase())) {
      if (["submit", "button", "reset"].includes((a.type ?? "").toLowerCase()) && !a.value && !a["aria-label"] && !a.title) add("error", "button-name", "4.1.2", n, `<input type="${a.type}"> has no value or label`);
      if ((a.type ?? "").toLowerCase() === "image" && !a.alt && !a["aria-label"]) add("error", "button-name", "1.1.1", n, '<input type="image"> has no alt text');
    } else if (["input", "select", "textarea"].includes(t)) {
      const named = a["aria-label"]?.trim() || labelledByText(n, ids) || (a.id && labelFor.has(a.id)) || inLabel(n);
      if (!named) add("error", "input-label", "1.3.1", n, `<${t}${a.name ? ` name="${a.name}"` : ""}> has no label; a placeholder is not a label${a.title ? " (title is a weak fallback)" : ""}`);
    }
    if (t === "button" || role === "button") {
      if (!accessibleName(n, ids)) add("error", "button-name", "4.1.2", n, "button has no accessible name (empty, or icon only without aria-label)");
    }
    if (t === "a" && a.href !== undefined && !accessibleName(n, ids)) add("error", "link-name", "2.4.4", n, `link to "${a.href.slice(0, 40)}" has no accessible name`);
    if (t === "a" && a.href !== undefined) {
      const name = accessibleName(n, ids).toLowerCase();
      if (/^(click here|here|read more|more|link)$/.test(name)) add("warning", "link-purpose", "2.4.4", n, `link text "${name}" does not say where it goes`);
    }
    if (t === "a" && a.href === undefined && a.onclick !== undefined) add("warning", "link-as-button", "4.1.2", n, "<a> without href acts as a button but is not focusable or announced as one; use <button>");
    if ((t === "div" || t === "span") && a.onclick !== undefined && !role && a.tabindex === undefined) add("warning", "click-no-keyboard", "2.1.1", n, `<${t} onclick> is not keyboard reachable; use <button> or add role, tabindex and key handling`);
    if (a.tabindex !== undefined && Number(a.tabindex) > 0) add("warning", "tabindex-positive", "2.4.3", n, `tabindex="${a.tabindex}" overrides the natural focus order; use 0 or -1`);
    if (a["aria-hidden"] === "true" && (FOCUSABLE.has(t) && !(t === "a" && a.href === undefined)) && a.tabindex !== "-1") add("error", "aria-hidden-focusable", "4.1.2", n, `<${t} aria-hidden="true"> can still receive focus, so keyboard users land on something hidden`);
    if ((t === "video" || t === "audio") && "autoplay" in a && !("muted" in a)) add("warning", "autoplay-audio", "1.4.2", n, `<${t} autoplay> plays sound without being muted; provide a way to stop it`);
    if (t === "video" && !nodes.some((x) => x.tag === "track" && isInside(x, n))) add("warning", "video-captions", "1.2.2", n, "<video> has no <track> for captions; confirm captions exist another way");
    if (t === "table" && !nodes.some((x) => x.tag === "th" && isInside(x, n)) && role !== "presentation" && role !== "none") add("warning", "table-header", "1.3.1", n, "<table> has no <th> header cells; if it is for layout, use CSS instead");
    const h = /^h([1-6])$/.exec(t);
    if (h) {
      const level = Number(h[1]);
      if (level === 1) h1s++;
      if (prevLevel && level > prevLevel + 1) add("warning", "heading-order", "1.3.1", n, `heading jumps from h${prevLevel} to h${level}`);
      if (!textOf(n)) add("warning", "empty-heading", "2.4.6", n, `<${t}> is empty`);
      prevLevel = level;
    }
  }
  if (nodes.some((n) => n.tag === "body")) {
    if (h1s === 0) add("warning", "page-has-h1", "1.3.1", nodes.find((n) => n.tag === "body"), "no <h1>; give the page a top-level heading");
    if (h1s > 1) add("warning", "multiple-h1", "1.3.1", nodes.find((n) => n.tag === "h1"), `${h1s} <h1> elements; usually one names the page`);
    if (!nodes.some((n) => n.tag === "main" || n.attrs.role === "main")) add("warning", "landmark-main", "1.3.1", nodes.find((n) => n.tag === "body"), "no <main> landmark; screen reader users cannot jump to the content");
  }

  const css = [];
  for (const n of nodes) {
    if (n.tag === "style") css.push({ text: n.children.map((c) => c.raw ?? "").join(""), line: n.line });
    if (n.attrs.style) css.push({ text: `x{${n.attrs.style}}`, line: n.line });
  }
  for (const { text, line } of css) {
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let r;
    while ((r = rule.exec(text))) {
      const [, selector, body] = r;
      if (!/outline\s*:\s*(none|0)\b/i.test(body)) continue;
      const keyboardSelectors = selector.split(",").filter((part) => !/:not\(\s*:focus-visible\s*\)/i.test(part));
      if (!keyboardSelectors.length) continue; // :focus:not(:focus-visible) keeps keyboard focus styled
      // Decoration on a generic selector is not a focus change. This only
      // recognises same-rule focus replacements; cascade/contrast need review.
      const focusOnly = keyboardSelectors.every((part) => /:focus(?:-visible)?(?![-\w])/i.test(part.replace(/:not\(\s*:focus\s*\)/gi, "")));
      if (focusOnly && /box-shadow\s*:\s*(?!none\b)\S|border(-color)?\s*:|background(-color)?\s*:|text-decoration\s*:/i.test(body)) continue;
      add("warning", "focus-outline-removed", "2.4.7", { line }, `"${selector.trim().slice(0, 50)}" removes the outline without a replacement focus style`);
    }
  }
  return findings.map((f, i) => [f, i]).sort((a, b) => a[0].line - b[0].line || a[1] - b[1]).map(([f]) => f);
}

function isInside(node, ancestor) {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

// --------------------------------------------------------------- contrast

const NAMED = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", gray: "#808080", grey: "#808080", yellow: "#ffff00", navy: "#000080", silver: "#c0c0c0", orange: "#ffa500", purple: "#800080", teal: "#008080", maroon: "#800000" };

export function parseColor(input) {
  let s = String(input).trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/.test(s)) throw new Error(`'${input}' has an alpha channel; contrast depends on what is behind it, so composite it onto the real background first`);
  m = /^rgb\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)$/.exec(s);
  if (m && [m[1], m[2], m[3]].every((v) => Number(v) <= 255)) return [m[1], m[2], m[3]].map(Number);
  throw new Error(`cannot read color '${input}'; use #rgb, #rrggbb, rgb(r,g,b) or a basic color name`);
}

function luminance([r, g, b]) {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(fg, bg) {
  const a = luminance(parseColor(fg));
  const b = luminance(parseColor(bg));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return {
    ratio: Math.round(ratio * 100) / 100,
    normalText: { AA: ratio >= 4.5, AAA: ratio >= 7 },
    largeText: { AA: ratio >= 3, AAA: ratio >= 4.5 },
    uiComponents: { AA: ratio >= 3 },
  };
}

// ---------------------------------------------------------------- strings

export function extractStrings(html) {
  const root = parseHtml(html);
  const out = [];
  const seen = new Set();
  const push = (kind, text, node) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    const key = `${kind}\0${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, text: t, line: node.line });
  };
  for (const n of walk(root)) {
    const a = n.attrs;
    if (RAW.has(n.tag) || ["head", "meta", "link", "title"].includes(n.tag)) { if (n.tag === "title") push("title", textOf(n), n); continue; }
    if (/^h[1-6]$/.test(n.tag)) push("heading", textOf(n), n);
    else if (n.tag === "button" || a.role === "button") push("button", textOf(n) || a["aria-label"] || "", n);
    else if (n.tag === "a" && a.href !== undefined) push("link", textOf(n), n);
    else if (n.tag === "label") push("label", textOf(n), n);
    else if (["p", "li", "td", "th", "figcaption", "legend", "summary", "dt", "dd", "option"].includes(n.tag)) {
      const own = n.children.filter((c) => c.text).map((c) => c.text).join(" ");
      push(n.tag === "option" ? "option" : "text", own, n);
    }
    if (a.placeholder) push("placeholder", a.placeholder, n);
    if (a["aria-label"]) push("aria-label", a["aria-label"], n);
    if (a.alt) push("alt", a.alt, n);
    if (a.title && !["iframe"].includes(n.tag)) push("title-attr", a.title, n);
    if (a.role === "alert" || a["aria-live"]) push("live-region", textOf(n), n);
    if (n.tag === "input" && ["submit", "button", "reset"].includes((a.type ?? "").toLowerCase())) push("button", a.value ?? "", n);
  }
  return out;
}

// -------------------------------------------------------------------- CLI

function main(argv) {
  const [cmd, ...rest] = argv;
  const json = rest.includes("--json");
  const args = rest.filter((a) => a !== "--json");
  const usage = "usage: design-review.mjs scan <file.html> [--json] | contrast <fg> <bg> [--json] | strings <file.html> [--json]";
  if (cmd === "scan" || cmd === "strings") {
    if (!args[0]) throw new Error(usage);
    const html = fs.readFileSync(path.resolve(args[0]), "utf8");
    if (cmd === "strings") {
      const items = extractStrings(html);
      if (json) console.log(JSON.stringify(items, null, 2));
      else for (const i of items) console.log(`${String(i.line).padStart(4)}  ${i.kind.padEnd(11)} ${i.text}`);
      return 0;
    }
    const findings = scanHtml(html);
    const errors = findings.filter((f) => f.severity === "error").length;
    if (json) console.log(JSON.stringify({ errors, warnings: findings.length - errors, findings }, null, 2));
    else {
      for (const f of findings) console.log(`${f.severity.padEnd(7)} line ${String(f.line).padStart(4)}  ${f.rule} (WCAG ${f.wcag})  ${f.message}`);
      console.log(`scan: ${errors} error(s), ${findings.length - errors} warning(s). Static markup only: contrast, focus order, keyboard traps and screen reader output still need a manual pass.`);
    }
    return errors ? 1 : 0;
  }
  if (cmd === "contrast") {
    if (args.length !== 2) throw new Error(usage);
    const r = contrast(args[0], args[1]);
    if (json) console.log(JSON.stringify(r, null, 2));
    else {
      const yn = (v) => (v ? "pass" : "FAIL");
      console.log(`contrast ${r.ratio}:1`);
      console.log(`  normal text  AA ${yn(r.normalText.AA)} (4.5)  AAA ${yn(r.normalText.AAA)} (7)`);
      console.log(`  large text   AA ${yn(r.largeText.AA)} (3)    AAA ${yn(r.largeText.AAA)} (4.5)`);
      console.log(`  UI component or graphic  AA ${yn(r.uiComponents.AA)} (3)`);
    }
    return r.normalText.AA ? 0 : 1;
  }
  throw new Error(usage);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
