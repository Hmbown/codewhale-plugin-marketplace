import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reuses the Codewhale desktop runtime preparation contract.
const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxBytes = 256 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function verifyNodeArchive(bytes, artifact) {
  if (!bytes.length || bytes.length > maxBytes || digest(bytes) !== artifact.sha256) {
    throw new Error(`The pinned Node archive did not verify: ${artifact.archive}`);
  }
}

export function nodeTarget(env = process.env) {
  const requested = env.CWC_NODE_TARGET || env.TAURI_ENV_TARGET_TRIPLE;
  if (requested) return requested;
  const host = execFileSync("rustc", ["-vV"], { encoding: "utf8", timeout: 10_000 }).match(/^host: (.+)$/m)?.[1];
  if (!host) throw new Error("The desktop build target could not be determined.");
  return host;
}

export async function prepareNodeRuntime({ target = nodeTarget(), outputRoot = process.env.CODEWHALE_CU_NODE_OUT || join(shellRoot, "dist", "node") } = {}) {
  if (target === "universal-apple-darwin") {
    return Promise.all(["aarch64-apple-darwin", "x86_64-apple-darwin"].map((entry) => prepareNodeRuntime({ target: entry, outputRoot })));
  }
  const lock = JSON.parse(await readFile(join(shellRoot, "app", "node-lock.json"), "utf8"));
  const artifact = lock.targets[target];
  if (!artifact) throw new Error(`No pinned Node runtime is available for desktop target ${target}.`);
  const directory = join(outputRoot, target);
  const binaryName = target.includes("windows") ? "node.exe" : "node";
  const archivePath = join(directory, artifact.archive);
  await mkdir(directory, { recursive: true });
  let bytes = await readFile(archivePath).catch(() => null);
  if (bytes) verifyNodeArchive(bytes, artifact);
  else {
    const response = await fetch(`https://nodejs.org/dist/v${lock.version}/${artifact.archive}`, { redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) throw new Error(`Downloading the pinned Node runtime failed (${response.status}).`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("The pinned Node archive exceeded its size limit.");
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    verifyNodeArchive(bytes, artifact);
    await writeFile(`${archivePath}.partial`, bytes, { mode: 0o600 });
    await rename(`${archivePath}.partial`, archivePath);
  }
  // Stream only these two fixed members to memory. Never extract an archive's
  // paths, permissions, links, npm, or install scripts into the user's machine.
  const prefix = artifact.archive.replace(/\.(?:tar\.gz|zip)$/, "");
  const member = (name) => execFileSync("tar", ["-xOf", "-", `${prefix}/${name}`], { input: bytes, maxBuffer: maxBytes, timeout: 30_000 });
  const binary = member(artifact.binary);
  const license = member("LICENSE");
  if (!binary.length || binary.length > maxBytes || !license.length) throw new Error("The pinned Node archive is missing its binary or license.");
  const receipt = { version: lock.version, target, archive: artifact.archive, archiveSha256: artifact.sha256, binarySha256: digest(binary), binaryBytes: binary.length };
  for (const [name, data] of [[binaryName, binary], ["LICENSE", license], ["receipt.json", JSON.stringify(receipt, null, 2) + "\n"]]) {
    await writeFile(join(directory, `${name}.partial`), data, { mode: name === binaryName ? 0o755 : 0o644 });
    await rename(join(directory, `${name}.partial`), join(directory, name));
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputRoot = process.env.CODEWHALE_CU_NODE_OUT || join(shellRoot, "dist", "node");
  const receipts = await prepareNodeRuntime({ target: "universal-apple-darwin", outputRoot });
  execFileSync("lipo", ["-create", join(outputRoot,"aarch64-apple-darwin","node"), join(outputRoot,"x86_64-apple-darwin","node"), "-output", join(outputRoot,"node")]);
  await writeFile(join(outputRoot,"LICENSE"), await readFile(join(outputRoot,"aarch64-apple-darwin","LICENSE")));
  await writeFile(join(outputRoot,"receipt.json"), JSON.stringify(receipts,null,2)+"\n");
  console.log(JSON.stringify(receipts));
}
