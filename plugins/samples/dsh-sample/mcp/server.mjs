// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). One tool,
// `echo`, that returns its input. No network, no filesystem access.
import readline from "node:readline";

const TOOL = {
  name: "echo",
  description: "Return the given message unchanged. Used to prove the imported server runs.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
    additionalProperties: false,
  },
};

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "parse error");
  }
  if (!Object.hasOwn(msg, "id")) return; // notifications need no reply
  switch (msg.method) {
    case "initialize":
      return respond(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        serverInfo: { name: "dsh-sample", version: "0.1.0" },
        capabilities: { tools: {} },
      });
    case "ping":
      return respond(msg.id, {});
    case "tools/list":
      return respond(msg.id, { tools: [TOOL] });
    case "tools/call": {
      if (msg.params?.name !== TOOL.name) return fail(msg.id, -32602, `unknown tool ${msg.params?.name}`);
      const message = msg.params.arguments?.message;
      if (typeof message !== "string") return fail(msg.id, -32602, "message must be a string");
      return respond(msg.id, { content: [{ type: "text", text: message }] });
    }
    default:
      return fail(msg.id, -32601, `method not found: ${msg.method}`);
  }
});
