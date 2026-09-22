// `/chromewhale status | token | setup`, as a script the command runs.
//
// The command used to be a curl line that hard-coded port 8899 and rebuilt the
// state path by hand, so it asked the wrong place whenever
// `CHROMEWHALE_STATE_DIR` or `CHROMEWHALE_BRIDGE_PORT` was set. This reads the
// same pairing record the server writes (`src/pairing.mjs`), which the bridge
// that owns the port updates with where it actually bound.
//
// `setup` copies the extension to a stable path outside the plugin's staged
// root. The staged root is content-hashed and moves on every plugin update; an
// unpacked extension's ID is derived from its path, so loading it from there
// would give the user a new, unpaired extension after each update.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { isLoopbackHost, readPairing, resolveEndpoint, stateDir } from "./pairing.mjs";

const PREVIEW =
  "Chromewhale is a developer preview: you load it unpacked, and it works inside your own Chrome profile " +
  "(your logged-in sessions), one allowed site at a time.";

/**
 * @param {string[]} argv
 * @param {{env?: NodeJS.ProcessEnv, root: string, out?: (line: string) => void,
 *          err?: (line: string) => void}} io
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, io) {
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
        return setup(env, io.root, out, err);
      default:
        err(`Unknown command "${command}". Use status, token, or setup.`);
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
          `No pairing token at ${pairing.file} yet: the Chromewhale server has never run here.`,
          "Enable the plugin in Codewhale (/plugin show chromewhale), then run /chromewhale setup.",
        ],
      },
      1,
    );
  }
  const health = await getHealth(pairing.host, pairing.port, pairing.token);
  if (health.status === 200 && health.body?.service === "chromewhale") {
    const body = health.body;
    return finish(
      {
        up: true,
        paired: body.paired === true,
        pid: body.pid,
        version: body.version,
        lines: [
          `Chromewhale bridge: up on ${where} (pid ${body.pid ?? "?"}, plugin ${body.version ?? "?"}).`,
          body.paired === true
            ? "Side panel: attached. The page_* tools will reach the active tab."
            : "Side panel: not attached. Open the Chromewhale side panel in Chrome; the page_* tools refuse until it is.",
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
          `A Chromewhale bridge is listening on ${where}${health.body?.pid ? ` (pid ${health.body.pid})` : ""}, but it rejects the token in ${pairing.file}.`,
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
          `Nothing is answering on ${where}: the Chromewhale MCP server is not running.`,
          "Check that the plugin is enabled (/plugin show chromewhale) and that this Codewhale session has started it.",
        ],
      },
      1,
    );
  }
  return finish({ up: false, lines: [`${where} answered HTTP ${health.status}; it is not a Chromewhale bridge.`] }, 1);
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
 * Copy the bundled extension to `<state dir>/extension` and explain loading it.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root plugin root holding `extension/`
 * @param {(line: string) => void} out
 * @param {(line: string) => void} err
 */
function setup(env, root, out, err) {
  const source = path.join(root, "extension");
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
  const dest = path.join(stateDir(env), "extension");
  if (fs.existsSync(dest) && !isOurExtension(dest)) {
    err(`${dest} exists and is not a Chromewhale extension copy; move it aside and run setup again.`);
    return 1;
  }
  // Copy beside, then swap, so Chrome never reloads a half-written tree.
  const staging = `${dest}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.cpSync(source, staging, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);

  const endpoint = resolveEndpoint(env);
  out(PREVIEW);
  out("");
  out(`Extension ${manifest.version} copied to: ${dest}`);
  out("That path stays the same across plugin updates, so Chrome keeps the same extension ID.");
  out("After updating the plugin, run /chromewhale setup again and click Reload on the Chromewhale card.");
  out("");
  out("1. Open chrome://extensions and turn on Developer mode.");
  out(`2. Choose Load unpacked and select ${dest}`);
  out("3. Click the Chromewhale toolbar button to open the side panel.");
  out(`4. In Settings → Chromewhale bridge, set port ${endpoint.port} and paste the token from /chromewhale token.`);
  out("5. The panel's bridge line reads \"Attached\" when it worked; /chromewhale status confirms it.");
  return 0;
}

/** @param {string} dir */
function isOurExtension(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).name === "Chromewhale";
  } catch {
    return false;
  }
}

/**
 * @param {string} host
 * @param {number} port
 * @param {string} bearer
 * @returns {Promise<{status: number, body?: any}>}
 */
function getHealth(host, port, bearer) {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: "/health", method: "GET", timeout: 3_000, headers: { Authorization: `Bearer ${bearer}` } },
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
