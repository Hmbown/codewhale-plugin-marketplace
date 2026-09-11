// One synchronous command runner shared by the parity engine and its desktop
// drivers. Never throws: a failed or missing command is a receipt.
import { execFileSync } from "node:child_process";

export function sh(cmd, args, { env = {}, timeoutMs = 15_000 } = {}) {
  try {
    const out = execFileSync(cmd, args, { env: { ...process.env, ...env }, timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout: out };
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}
