// Register the Native Messaging host with the user's Chromium browsers.
//
// Chrome looks for a host by name in fixed per-user places — a directory of
// JSON manifests on macOS and Linux, a registry key on Windows — and starts
// the `path` a manifest names, only for the extension IDs in its
// `allowed_origins`. So `setup`:
//
// 1. copies the host's few files to `<state dir>/host`, a path that does not
//    move when the plugin updates (the plugin's staged root is content-hashed);
// 2. writes a launcher there that runs them with an absolute Node path, since
//    Chrome starts hosts with a minimal PATH that often lacks `node`, and that
//    pins `CHROMEWHALE_STATE_DIR` so the host reads the same pairing file as
//    the MCP server;
// 3. writes the host manifest for each installed browser, allowing only the
//    Codewhale for Chrome extension ID(s).
//
// Nothing here needs elevated rights: every location is per user.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

import { HOST_NAME } from "./native.mjs";

/**
 * IDs the Chrome Web Store (and Edge Add-ons) assign to published builds. The
 * development ID comes from the manifest `key`; a store listing gets its own
 * ID on first upload, which is added here so both builds can reach the host.
 */
export const STORE_EXTENSION_IDS = Object.freeze([]);

/** Files the host needs, relative to the plugin root. */
const HOST_FILES = [
  "plugin.json",
  "bin/native-host.mjs",
  "src/native.mjs",
  "src/pairing.mjs",
  "extension/src/bridge.js",
  "extension/src/sse.js",
];

/**
 * The extension ID Chrome derives from a manifest `key`: the first 128 bits
 * of SHA-256 over the public key, written with the letters a–p.
 *
 * @param {string} key base64 DER SubjectPublicKeyInfo
 */
export function extensionIdFromKey(key) {
  const hex = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}

/**
 * Where each browser reads per-user host manifests, for browsers whose
 * profile directory exists. macOS and Linux only; Windows uses the registry.
 *
 * @param {NodeJS.Platform} platform
 * @param {string} home
 * @returns {Array<{browser: string, dir: string}>}
 */
export function manifestDirs(platform, home) {
  /** @type {Array<[string, string]>} */
  const roots =
    platform === "darwin"
      ? [
          ["Google Chrome", "Library/Application Support/Google/Chrome"],
          ["Google Chrome Beta", "Library/Application Support/Google/Chrome Beta"],
          ["Google Chrome Canary", "Library/Application Support/Google/Chrome Canary"],
          ["Chromium", "Library/Application Support/Chromium"],
          ["Microsoft Edge", "Library/Application Support/Microsoft Edge"],
          ["Brave", "Library/Application Support/BraveSoftware/Brave-Browser"],
        ]
      : platform === "linux"
        ? [
            ["Google Chrome", ".config/google-chrome"],
            ["Google Chrome Beta", ".config/google-chrome-beta"],
            ["Chromium", ".config/chromium"],
            ["Microsoft Edge", ".config/microsoft-edge"],
            ["Brave", ".config/BraveSoftware/Brave-Browser"],
          ]
        : [];
  return roots
    .map(([browser, relative]) => ({ browser, root: path.join(home, relative) }))
    .filter(({ root }) => fs.existsSync(root))
    .map(({ browser, root }) => ({ browser, dir: path.join(root, "NativeMessagingHosts") }));
}

/** Registry keys the Windows builds read, per user. */
export const WINDOWS_REGISTRY_KEYS = Object.freeze([
  ["Google Chrome", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Chromium", `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Microsoft Edge", `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Brave", `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`],
]);

/**
 * A Node path that survives upgrades: the `node` on PATH (often a stable
 * symlink such as /opt/homebrew/bin/node) when it exists, else this one.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 */
export function stableNode(env, platform) {
  const names = platform === "win32" ? ["node.exe"] : ["node"];
  for (const dir of String(env.PATH ?? env.Path ?? "").split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (path.isAbsolute(candidate)) {
          return candidate;
        }
      } catch {
        // not here
      }
    }
  }
  return process.execPath;
}

/**
 * Install (or refresh) the host for every browser found.
 *
 * @param {{root: string, stateDir: string, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform,
 *          home?: string, extensionIds: string[], registry?: (args: string[]) => void}} options
 * @returns {{hostDir: string, launcher: string, node: string, installed: string[], manifest: object}}
 */
export function installHost(options) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const hostDir = path.join(options.stateDir, "host");
  const staging = `${hostDir}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  for (const file of HOST_FILES) {
    const target = path.join(staging, file);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(options.root, file), target);
  }
  fs.rmSync(hostDir, { recursive: true, force: true });
  fs.renameSync(staging, hostDir);

  const node = stableNode(options.env, platform);
  const script = path.join(hostDir, "bin", "native-host.mjs");
  let launcher;
  if (platform === "win32") {
    launcher = path.join(hostDir, "codewhale-for-chrome-host.cmd");
    fs.writeFileSync(
      launcher,
      ["@echo off", `set "CHROMEWHALE_STATE_DIR=${options.stateDir}"`, `"${node}" "${script}" %*`, ""].join("\r\n"),
    );
  } else {
    launcher = path.join(hostDir, "codewhale-for-chrome-host");
    fs.writeFileSync(
      launcher,
      ["#!/bin/sh", `CHROMEWHALE_STATE_DIR=${shellQuote(options.stateDir)}`, "export CHROMEWHALE_STATE_DIR",
        `exec ${shellQuote(node)} ${shellQuote(script)} "$@"`, ""].join("\n"),
      { mode: 0o755 },
    );
    fs.chmodSync(launcher, 0o755);
  }

  const manifest = {
    name: HOST_NAME,
    description: "Codewhale for Chrome connector: pairs the side panel with your local Codewhale session.",
    path: launcher,
    type: "stdio",
    allowed_origins: [...new Set(options.extensionIds)].map((id) => `chrome-extension://${id}/`),
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  /** @type {string[]} */
  const installed = [];
  if (platform === "win32") {
    const file = path.join(hostDir, `${HOST_NAME}.json`);
    fs.writeFileSync(file, text);
    const registry = options.registry ?? ((args) => execFileSync("reg", args, { stdio: "ignore" }));
    for (const [browser, key] of WINDOWS_REGISTRY_KEYS) {
      registry(["add", key, "/ve", "/t", "REG_SZ", "/d", file, "/f"]);
      installed.push(browser);
    }
  } else {
    for (const { browser, dir } of manifestDirs(platform, home)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${HOST_NAME}.json`), text);
      installed.push(browser);
    }
  }
  return { hostDir, launcher, node, installed, manifest };
}

/**
 * Remove the host registrations and the copied host files.
 *
 * @param {{stateDir: string, platform?: NodeJS.Platform, home?: string,
 *          registry?: (args: string[]) => void}} options
 * @returns {string[]} browsers it was removed from
 */
export function removeHost(options) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  /** @type {string[]} */
  const removed = [];
  if (platform === "win32") {
    const registry = options.registry ?? ((args) => execFileSync("reg", args, { stdio: "ignore" }));
    for (const [browser, key] of WINDOWS_REGISTRY_KEYS) {
      try {
        registry(["delete", key, "/f"]);
        removed.push(browser);
      } catch {
        // not registered for this browser
      }
    }
  } else {
    for (const { browser, dir } of manifestDirs(platform, home)) {
      const file = path.join(dir, `${HOST_NAME}.json`);
      if (fs.existsSync(file)) {
        fs.rmSync(file);
        removed.push(browser);
      }
    }
  }
  fs.rmSync(path.join(options.stateDir, "host"), { recursive: true, force: true });
  return removed;
}

/**
 * Which browsers currently have the host registered (macOS and Linux).
 *
 * @param {{platform?: NodeJS.Platform, home?: string}} [options]
 */
export function registeredBrowsers(options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  return manifestDirs(platform, home)
    .filter(({ dir }) => fs.existsSync(path.join(dir, `${HOST_NAME}.json`)))
    .map(({ browser, dir }) => ({ browser, file: path.join(dir, `${HOST_NAME}.json`) }));
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
