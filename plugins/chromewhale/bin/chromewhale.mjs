#!/usr/bin/env node
// `node bin/chromewhale.mjs [status [--json] | token | setup]` — what
// `/chromewhale` runs. See `src/cli.mjs`.

import path from "node:path";
import url from "node:url";

import { runCli } from "../src/cli.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
process.exitCode = await runCli(process.argv.slice(2), { root: ROOT });
