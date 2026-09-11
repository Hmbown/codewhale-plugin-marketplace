#!/usr/bin/env node
// WhaleWiki MCP server — read-only surface over a repo's whalewiki/ directory.
// Mirrors DeepWiki's read tools, plus wiki_status (freshness receipts), which
// no hosted wiki can answer. Stdio JSON-RPC, newline-delimited, zero deps.
// The server never writes to the repository.

import fs from "node:fs";
import path from "node:path";
import {
  wikiDir, loadManifest, statusReport, searchWiki, pageVerdict, sourceRoots, readWikiFile,
} from "../scripts/whalewiki.mjs";

const TOOLS = [
  {
    name: "wiki_structure",
    description: "List the wiki's pages with titles and per-page freshness verdicts (fresh/stale/orphaned/unsealed).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wiki_read",
    description: "Read one wiki page. The response is prefixed with its freshness verdict and which basis files changed, so a stale page is never quoted as current.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "string", description: "Page path, e.g. pages/architecture.md" },
      },
      required: ["page"],
    },
  },
  {
    name: "wiki_search",
    description: "Ranked search over wiki pages and the codemap. Returns matching pages with line snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", default: 8 },
      },
      required: ["query"],
    },
  },
  {
    name: "wiki_status",
    description: "Full freshness report: which pages are stale, which basis files changed or went missing. The wiki's receipts, not a timestamp.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wiki_codemap",
    description: "The deterministic repo map: language mix, per-directory modules and symbols, internal import edges.",
    inputSchema: { type: "object", properties: {} },
  },
];

for (const tool of TOOLS) {
  tool.annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  tool.inputSchema.properties.workspace = { type: "string", description: "Absolute path to the repository. Pass the active workspace here when the plugin host starts this server in its install directory." };
  tool.inputSchema.additionalProperties = false;
}

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function callTool(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  if (args.workspace !== undefined && (typeof args.workspace !== "string" || !path.isAbsolute(args.workspace))) throw new Error("workspace must be an absolute repository path");
  const wiki = args.workspace ? wikiDir(args.workspace) : wikiDir();
  if (!fs.existsSync(path.join(wiki, "manifest.json"))) {
    return { ...text("No wiki found. Pass the active repository as workspace, or run /whalewiki init there first."), isError: true };
  }
  switch (name) {
    case "wiki_structure": {
      const report = statusReport(wiki, { receipt: false });
      return text({
        wiki,
        counts: report.counts,
        pages: report.pages.map((p) => ({ page: p.page, title: p.title, verdict: p.verdict })),
      });
    }
    case "wiki_read": {
      if (typeof args.page !== "string") throw new Error("page is required and must be a string");
      const page = args.page;
      const body = readWikiFile(wiki, page);
      // Hash only this page's basis — not every sealed file in the manifest.
      const entry = loadManifest(wiki).pages?.[page];
      const v = entry ? pageVerdict(entry, sourceRoots(wiki), wiki, page) : null;
      const head = v
        ? `[freshness: ${v.verdict}${v.page_changed ? " — page edited since sealing" : ""}${v.changed.length ? ` — changed: ${v.changed.join(", ")}` : ""}${v.missing.length ? ` — missing: ${v.missing.join(", ")}` : ""}]\n\n`
        : "[freshness: unsealed]\n\n";
      return text(head + body);
    }
    case "wiki_search": {
      if (typeof args.query !== "string" || args.query.length > 1000) throw new Error("query must be a string of at most 1000 characters");
      if (args.max_results !== undefined && (!Number.isInteger(args.max_results) || args.max_results < 1 || args.max_results > 50)) throw new Error("max_results must be an integer from 1 to 50");
      const manifest = loadManifest(wiki), roots = sourceRoots(wiki);
      return text(searchWiki(args.query, wiki, args.max_results || 8).map(result => ({
        ...result, verdict: manifest.pages[result.page] ? pageVerdict(manifest.pages[result.page], roots, wiki, result.page).verdict : "unsealed",
      })));
    }
    case "wiki_status":
      return text(statusReport(wiki, { receipt: false }));
    case "wiki_codemap": {
      const codemapPath = path.join(wiki, "codemap.md");
      return text(fs.existsSync(codemapPath)
        ? readWikiFile(wiki, "codemap.md")
        : "No codemap.md yet — run /whalewiki map.");
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const PROTOCOL_VERSION = "2024-11-05";

function handle(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const { id, method, params } = msg;
  if (id === undefined) return null;
  switch (method) {
    case "initialize":
      return { id, result: {
        protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "whalewiki", version: "0.1.0" },
      } };
    case "notifications/initialized":
    case "initialized":
      return null;
    case "ping":
      return { id, result: {} };
    case "tools/list":
      return { id, result: { tools: TOOLS } };
    case "tools/call": {
      try {
        return { id, result: callTool(params?.name, params?.arguments || {}) };
      } catch (error) {
        return { id, result: { content: [{ type: "text", text: `whalewiki error: ${error.message}` }], isError: true } };
      }
    }
    default:
      if (id === undefined) return null;
      return { id, error: { code: -32601, message: `method not supported: ${method}` } };
  }
}

// Bound incomplete frames as well as complete requests. Never buffer an
// unlimited newline-free payload from an MCP client.
let buffer = "", discarding = false;
const emit = res => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...res }) + "\n");
function lineReceived(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { emit({ id: null, error: { code: -32700, message: "Parse error" } }); return; }
  const res = handle(msg);
  if (res) emit(res);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  for (const [index, part] of chunk.split("\n").entries()) {
    if (index > 0) {
      if (!discarding) lineReceived(buffer);
      buffer = ""; discarding = false;
    }
    if (discarding) continue;
    if (Buffer.byteLength(buffer) + Buffer.byteLength(part) > 256 * 1024) {
      buffer = ""; discarding = true;
      emit({ id: null, error: { code: -32600, message: "Request exceeds 256 KiB" } });
    } else buffer += part;
  }
});
process.stdin.on("end", () => { if (buffer && !discarding) lineReceived(buffer); });
