#!/usr/bin/env node
// The Native Messaging host Chrome starts for the side panel. Installed by
// `/chromewhale setup`, which writes a small launcher that runs this file with
// an absolute Node path (Chrome starts hosts with a minimal PATH). See
// `src/native.mjs`.

import path from "node:path";
import url from "node:url";

import { runNativeHost } from "../src/native.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
// stdout is the Native Messaging channel; nothing else may be written to it.
await runNativeHost({ stdin: process.stdin, stdout: process.stdout, root: ROOT });
process.exit(0);
