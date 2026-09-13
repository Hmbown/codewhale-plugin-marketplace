#!/usr/bin/env node
// Build a release archive only after exact-bundle signature, notarization,
// stapling and Gatekeeper checks. This never tags or publishes a release.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { APP_NAME } from "../src/app-socket.mjs";
import { verifyReleaseBundle, verifySignature } from "../app/install-macos.mjs";
import { validateReleaseZip } from "../app/updates.mjs";
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const app=path.resolve(option("--app",`dist/macos/${APP_NAME}.app`));
const output=path.resolve(option("--out","dist/release"));
const profile=option("--notary-profile",process.env.CODEWHALE_CU_NOTARY_PROFILE);
const run=(command,argv)=>{
  const result=spawnSync(command,argv,{encoding:"utf8",maxBuffer:4*1024*1024});
  if(result.status!==0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
if(process.platform!=="darwin") throw new Error("macOS packaging requires macOS.");
verifySignature(app);
if(!fs.existsSync(path.join(app,"Contents","MacOS","node"))) throw new Error("Build with --node-runtime before packaging a release.");
const authority=spawnSync("codesign",["--display","--verbose=4",app],{encoding:"utf8"}).stderr;
if(!authority.includes("Authority=Developer ID Application:")||!authority.includes("TeamIdentifier=5RDNSHA5TY")) throw new Error("A Codewhale Developer ID signature is required.");
const version=run("/usr/libexec/PlistBuddy",["-c","Print :CFBundleShortVersionString",path.join(app,"Contents","Info.plist")]);
if(!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version.");
fs.mkdirSync(output,{recursive:true});
const name=`Codewhale-Computer-Use-${version}-macos-universal.zip`;
const archive=path.join(output,name);
const zip=()=>{ if(fs.existsSync(archive)) throw new Error("This archive already exists. Choose a fresh output directory to preserve the prior receipt."); run("ditto",["-c","-k","--keepParent","--norsrc",app,archive]); validateReleaseZip(fs.readFileSync(archive)); };
let notarization=null;
if(profile) {
  const submission=path.join(output,`notary-submission-${Date.now()}.zip`);
  run("ditto",["-c","-k","--keepParent","--norsrc",app,submission]);
  notarization=JSON.parse(run("xcrun",["notarytool","submit",submission,"--keychain-profile",profile,"--wait","--timeout","20m","--output-format","json"]));
  fs.writeFileSync(path.join(output,"notarization.json"),JSON.stringify(notarization,null,2)+"\n");
  if(notarization.status!=="Accepted") throw new Error(`Apple returned ${notarization.status}; no release archive produced.`);
  run("xcrun",["stapler","staple",app]);
}
try { run("xcrun",["stapler","validate",app]); verifyReleaseBundle(app); }
catch(error) {
  fs.writeFileSync(path.join(output,"candidate.json"),JSON.stringify({version,app,releaseReady:false,reason:error.message},null,2)+"\n");
  throw new Error(`${error.message} Use --notary-profile <saved Keychain profile> to submit the signed candidate.`);
}
zip();
const bytes=fs.readFileSync(archive),sha256=crypto.createHash("sha256").update(bytes).digest("hex");
fs.writeFileSync(path.join(output,"SHA256SUMS.txt"),`${sha256}  ${name}\n`);
// This receipt is published with the archive. Keep local build paths out of it.
fs.writeFileSync(path.join(output,"release.json"),JSON.stringify({version,platform:"macos",arch:"universal",archive:name,size:bytes.length,sha256,notarized:true,submissionId:notarization?.id??null,createdAt:new Date().toISOString()},null,2)+"\n");
console.log(JSON.stringify({archive,sha256,releaseReady:true},null,2));
