#!/usr/bin/env node
// Record only the owned practice surface. No model, user app, or user data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBackgroundCheck } from "../app/background-check.mjs";
const bundle = process.env.CODEWHALE_CU_APP_BUNDLE || path.join(os.homedir(), "Applications", "Codewhale Computer Use.app");
process.env.CODEWHALE_CU_APP_BUNDLE = bundle;
const output = path.resolve(process.argv[2] || `receipts/demo-${Date.now()}`);
if (fs.existsSync(output)) throw new Error("Choose a new output directory to preserve earlier demo evidence.");
fs.mkdirSync(output, { recursive: true });
const result = await runBackgroundCheck({ bundle, demoDirectory: output });
fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ output, ...result }, null, 2));
if (!result.ok) process.exitCode = 1;
