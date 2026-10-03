// `/chromewhale status | token | setup`, as a script the command runs.
//
// The command used to be a curl line that hard-coded port 8899 and rebuilt the
// state path by hand, so it asked the wrong place whenever
// `CHROMEWHALE_STATE_DIR` or `CHROMEWHALE_BRIDGE_PORT` was set. This reads the
// same pairing record the server writes (`src/pairing.mjs`), which the bridge
// that owns the port updates with where it actually bound.
//
// `setup` copies the extension to a stable path outside the plugin's staged
// root (which is content-hashed and moves on every plugin update), and
// installs the Native Messaging connector that pairs the panel with no token
// to paste (`src/install.mjs`). The extension's ID comes from the `key` in its
// manifest, so it is the same wherever it is loaded from.
//
// `status` asks the running bridge over the signed challenge-response
// protocol: it never sends the pairing token to whatever holds the port.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { STORE_EXTENSION_IDS, extensionIdFromKey, installHost, registeredBrowsers, removeHost } from "./install.mjs";
import {
  bridgeMessage,
  isLoopbackHost,
  mac,
  macMatches,
  newNonce,
  readPairing,
  resolveEndpoint,
  signedAuthorization,
  stateDir,
} from "./pairing.mjs";

const PREVIEW =
  "Codewhale for Chrome is a developer preview: you load it unpacked, and it works inside your own Chrome profile " +
  "(your logged-in sessions), one allowed site at a time.";

/** Names this extension has shipped under, for recognising an earlier copy. */
const EXTENSION_NAMES = new Set(["Codewhale for Chrome", "Chromewhale"]);

/**
 * @param {string[]} argv
 * @param {{env?: NodeJS.ProcessEnv, root: string, out?: (line: string) => void,
 *          err?: (line: string) => void, platform?: NodeJS.Platform, home?: string,
 *          registry?: (args: string[]) => void}} io
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, io) {
  // `platform`, `home` and `registry` are seams for the tests; the real
  // command uses this machine's.
  const env = io.env ?? process.env;
  const out = io.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line) => process.stderr.write(`${line}\n`));
  const [command = "status", ...rest] = argv;
  try {
    switch (command) {
      case "status":
        return await status(env, out, rest.includes("--json"));
      case "token":
        return token(env, out);
      case "setup":
        return rest.includes("--remove") ? teardown(env, out, io) : setup(env, io.root, out, err, io);
      default:
        err(`Unknown command "${command}". Use status, token, setup, or setup --remove.`);
        return 2;
    }
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {(line: string) => void} out
 * @param {boolean} json
 */
async function status(env, out, json) {
  const pairing = readPairing(env);
  const where = `${pairing.host}:${pairing.port}`;
  /** @param {Record<string, unknown>} report @param {number} code */
  const finish = (report, code) => {
    if (json) {
      out(JSON.stringify({ endpoint: where, ...report }));
    } else {
      for (const line of /** @type {string[]} */ (report.lines)) {
        out(line);
      }
    }
    return code;
  };
  if (!isLoopbackHost(pairing.host)) {
    // The token is a bearer credential over plain HTTP. Never send it off-box,
    // whatever the pairing file says.
    return finish(
      { up: false, lines: [`Refusing to query ${where}: the bridge is loopback-only and ${pairing.file} names another host.`] },
      2,
    );
  }
  if (!pairing.token) {
    return finish(
      {
        up: false,
        lines: [
          `No pairing token at ${pairing.file} yet: the Codewhale for Chrome server has never run here.`,
          "Enable the plugin in Codewhale (/plugin show chromewhale), then run /chromewhale setup.",
        ],
      },
      1,
    );
  }
  const health = await getHealth(pairing.host, pairing.port, pairing.token);
  const connector = registeredBrowsers();
  const connectorLine = connector.length
    ? `Connector: registered for ${connector.map((entry) => entry.browser).join(", ")}.`
    : "Connector: not registered (run /chromewhale setup), so the panel needs a pasted token.";
  if (health.status === 200 && health.verified && health.body?.service === "chromewhale") {
    const body = health.body;
    return finish(
      {
        up: true,
        paired: body.paired === true,
        pid: body.pid,
        version: body.version,
        lines: [
          `Codewhale for Chrome bridge: up on ${where} (pid ${body.pid ?? "?"}, plugin ${body.version ?? "?"}).`,
          body.paired === true
            ? "Side panel: attached. The page_* tools will reach the active tab."
            : "Side panel: not attached. Open the Codewhale for Chrome side panel in Chrome; the page_* tools refuse until it is.",
          ...(process.platform === "win32" ? [] : [connectorLine]),
        ],
      },
      0,
    );
  }
  if (health.status === 401) {
    return finish(
      {
        up: true,
        paired: false,
        lines: [
          `A Codewhale for Chrome bridge is listening on ${where}${health.body?.pid ? ` (pid ${health.body.pid})` : ""}, but it rejects the token in ${pairing.file}.`,
          "Another session is probably running with CHROMEWHALE_BRIDGE_TOKEN set. Unset it there, or use a different CHROMEWHALE_BRIDGE_PORT.",
        ],
      },
      1,
    );
  }
  if (health.status === 0) {
    return finish(
      {
        up: false,
        lines: [
          `Nothing is answering on ${where}: the Codewhale for Chrome MCP server is not running.`,
          "Check that the plugin is enabled (/plugin show chromewhale) and that this Codewhale session has started it.",
        ],
      },
      1,
    );
  }
  if (health.status === 200) {
    return finish(
      { up: false, lines: [`${where} answers like a Codewhale for Chrome bridge but could not prove it holds the pairing token. Something else may be listening there.`] },
      1,
    );
  }
  return finish({ up: false, lines: [`${where} answered HTTP ${health.status}; it is not a Codewhale for Chrome bridge.`] }, 1);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {(line: string) => void} out
 */
function token(env, out) {
  const endpoint = resolveEndpoint(env);
  out(endpoint.token);
  return 0;
}

/**
 * Copy the bundled extension to `<state dir>/extension`, install the
 * connector, and explain loading the extension.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root plugin root holding `extension/`
 * @param {(line: string) => void} out
 * @param {(line: string) => void} err
 * @param {{platform?: NodeJS.Platform, home?: string, registry?: (args: string[]) => void}} seams
 */
function setup(env, root, out, err, seams) {
  const source = path.join(root, "extension");
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
  const state = stateDir(env);
  const dest = path.join(state, "extension");
  if (fs.existsSync(dest) && !isOurExtension(dest)) {
    err(`${dest} exists and is not a Codewhale for Chrome extension copy; move it aside and run setup again.`);
    return 1;
  }
  // Copy beside, then swap, so Chrome never reloads a half-written tree.
  const staging = `${dest}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.cpSync(source, staging, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);

  // The server writes the token on first run; make sure it exists so the
  // connector can pair even before the first Codewhale session starts it.
  resolveEndpoint(env);
  const id = extensionIdFromKey(manifest.key);
  const host = installHost({
    root,
    stateDir: state,
    env,
    extensionIds: [id, ...STORE_EXTENSION_IDS],
    platform: seams.platform,
    home: seams.home,
    registry: seams.registry,
  });

  out(PREVIEW);
  out("");
  out(`Extension ${manifest.version} copied to: ${dest}`);
  out(`Its ID is ${id}, the same wherever it is loaded from.`);
  if (host.installed.length) {
    out(`Connector installed for: ${host.installed.join(", ")}. The panel pairs by itself — no token to paste.`);
  } else {
    out("No Chrome, Chromium, Edge or Brave profile was found, so the connector was not registered. Install a");
    out("browser and run setup again, or paste the port and token from /chromewhale token into the panel's Settings.");
  }
  out("After updating the plugin, run /chromewhale setup again and click Reload on the Codewhale for Chrome card.");
  out("");
  out("1. Open chrome://extensions and turn on Developer mode.");
  out(`2. Choose Load unpacked and select ${dest}`);
  out("3. Click the Codewhale for Chrome toolbar button to open the side panel.");
  out("4. The panel's bridge line reads \"Attached\" once a Codewhale session with the plugin is running;");
  out("   /chromewhale status confirms it.");
  return 0;
}

/**
 * Undo `setup`'s connector registration (the extension itself is removed from
 * chrome://extensions by the user).
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {(line: string) => void} out
 * @param {{platform?: NodeJS.Platform, home?: string, registry?: (args: string[]) => void}} seams
 */
function teardown(env, out, seams) {
  const removed = removeHost({ stateDir: stateDir(env), platform: seams.platform, home: seams.home, registry: seams.registry });
  out(
    removed.length
      ? `Connector removed from: ${removed.join(", ")}.`
      : "The connector was not registered with any browser.",
  );
  out("Remove the Codewhale for Chrome card in chrome://extensions to finish uninstalling the extension.");
  return 0;
}

/** @param {string} dir */
function isOurExtension(dir) {
  try {
    return EXTENSION_NAMES.has(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).name);
  } catch {
    return false;
  }
}

/**
 * `GET /health`, signed against a fresh challenge; the reply is only trusted
 * (`verified`) when its proof checks out. The token itself is never sent.
 *
 * @param {string} host
 * @param {number} port
 * @param {string} token
 * @returns {Promise<{status: number, body?: any, verified: boolean}>}
 */
async function getHealth(host, port, token) {
  const challenge = await getJson(host, port, "/challenge", {});
  if (challenge.status !== 200 || typeof challenge.body?.nonce !== "string") {
    // An older bridge has no /challenge; it answers 401 and names itself.
    return { status: challenge.status, body: challenge.body, verified: false };
  }
  const nonce = challenge.body.nonce;
  const cnonce = newNonce();
  const answer = await getJson(host, port, "/health", {
    Authorization: signedAuthorization(token, "GET", "/health", nonce, cnonce),
  });
  if (answer.body && typeof answer.body.proof === "string") {
    const { proof, ...body } = answer.body;
    return { status: answer.status, body, verified: macMatches(proof, mac(token, bridgeMessage(nonce, cnonce, JSON.stringify(body)))) };
  }
  return { status: answer.status, body: answer.body, verified: false };
}

/**
 * @param {string} host
 * @param {number} port
 * @param {string} pathname
 * @param {Record<string, string>} headers
 * @returns {Promise<{status: number, body?: any}>}
 */
function getJson(host, port, pathname, headers) {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: pathname, method: "GET", timeout: 3_000, headers },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = undefined;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", () => resolve({ status: 0 }));
    req.end();
  });
}
