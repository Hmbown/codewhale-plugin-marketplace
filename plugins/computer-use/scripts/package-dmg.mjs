#!/usr/bin/env node
// Build the drag-to-Applications disk image for an already notarized, stapled
// release app; sign, notarize and staple the image itself; mount it to check
// its contents; then record it in the release receipt next to the archive.
// The archive stays the updater's input; the disk image is the human download.
// This never tags or publishes a release.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "../src/app-socket.mjs";
import { verifyReleaseBundle } from "../app/install-macos.mjs";
import { ensureIcons, macSigningIdentity, timestampArg } from "./build-app.mjs";

const ROOT=fileURLToPath(new URL("..",import.meta.url));
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const app=path.resolve(option("--app",`dist/macos/${APP_NAME}.app`));
const output=path.resolve(option("--out","dist/release"));
const profile=option("--notary-profile",process.env.CODEWHALE_CU_NOTARY_PROFILE);
// dmgbuild (https://github.com/dmgbuild/dmgbuild) writes the Finder layout
// directly, so packaging needs no Finder scripting or accessibility grants.
const dmgbuild=option("--dmgbuild",process.env.CODEWHALE_CU_DMGBUILD??"dmgbuild");
const run=(command,argv)=>{
  const result=spawnSync(command,argv,{encoding:"utf8",maxBuffer:8*1024*1024});
  if(result.status!==0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
if(process.platform!=="darwin") throw new Error("macOS packaging requires macOS.");
verifyReleaseBundle(app);
const version=run("/usr/libexec/PlistBuddy",["-c","Print :CFBundleShortVersionString",path.join(app,"Contents","Info.plist")]);
if(!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version.");
const receiptPath=path.join(output,"release.json");
if(!fs.existsSync(receiptPath)) throw new Error("Package the archive first: release.json is missing from the output directory.");
const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
if(receipt.version!==version||receipt.notarized!==true) throw new Error("release.json does not describe this notarized app version.");
const name=`Codewhale-Computer-Use-${version}-macos-universal.dmg`;
const image=path.join(output,name);
if(fs.existsSync(image)||receipt.dmg) throw new Error(`${name} is already recorded in ${output}. Choose a fresh output directory to preserve the prior receipt.`);
ensureIcons();
const background=path.join(ROOT,"assets","macos","dmg-background.png"); // dmgbuild pairs it with dmg-background@2x.png
const icon=path.join(ROOT,"assets","icon.icns");
for(const file of [background,`${background.slice(0,-4)}@2x.png`,icon]) if(!fs.existsSync(file)) throw new Error(`Missing packaging asset ${file}.`);
// Layout: 660x400 window, 128pt icons, the app on the left and the
// Applications shortcut on the right, matching assets/macos/dmg-background.svg.
const settings=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"codewhale-cu-dmg-")),"settings.py");
fs.writeFileSync(settings,`import os
application = defines["app"]
appname = os.path.basename(application)
format = "UDZO"
filesystem = "HFS+"
files = [application]
symlinks = {"Applications": "/Applications"}
icon = defines["icon"]
icon_locations = {appname: (165, 190), "Applications": (495, 190)}
background = defines["background"]
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
show_icon_preview = False
include_icon_view_settings = "auto"
include_list_view_settings = "auto"
arrange_by = None
grid_offset = (0, 0)
grid_spacing = 100
scroll_position = (0, 0)
label_pos = "bottom"
text_size = 14
icon_size = 128
`);
try { run(dmgbuild,["-s",settings,"-D",`app=${app}`,"-D",`icon=${icon}`,"-D",`background=${background}`,APP_NAME,image]); }
finally { fs.rmSync(path.dirname(settings),{recursive:true,force:true}); }
const identity=macSigningIdentity(app);
if(identity==="-") throw new Error("A Developer ID identity is required to sign the disk image.");
run("codesign",["--force",timestampArg(identity),"--sign",identity,image]);
run("codesign",["--verify","--strict",image]);
let notarization=null;
if(profile) {
  notarization=JSON.parse(run("xcrun",["notarytool","submit",image,"--keychain-profile",profile,"--wait","--timeout","20m","--output-format","json"]));
  fs.writeFileSync(path.join(output,"notarization-dmg.json"),JSON.stringify(notarization,null,2)+"\n");
  if(notarization.status!=="Accepted") { fs.rmSync(image,{force:true}); throw new Error(`Apple returned ${notarization.status}; no disk image produced.`); }
  run("xcrun",["stapler","staple",image]);
}
run("xcrun",["stapler","validate",image]);
const assessment=spawnSync("spctl",["--assess","--type","open","--context","context:primary-signature","--verbose=2",image],{encoding:"utf8"});
if(assessment.status!==0||!/source=Notarized Developer ID/.test(assessment.stderr+assessment.stdout)) { fs.rmSync(image,{force:true}); throw new Error(`Gatekeeper did not accept the disk image: ${assessment.stderr||assessment.stdout}`); }
// Mount the finished image and check what a person will see before recording it.
const mountPoint=fs.mkdtempSync(path.join(os.tmpdir(),"codewhale-cu-mount-"));
run("hdiutil",["attach","-nobrowse","-readonly","-noautoopen","-mountpoint",mountPoint,image]);
try {
  const mountedApp=path.join(mountPoint,`${APP_NAME}.app`);
  if(!fs.existsSync(mountedApp)) throw new Error("The disk image does not contain the app.");
  if(fs.readlinkSync(path.join(mountPoint,"Applications"))!=="/Applications") throw new Error("The disk image lacks the Applications shortcut.");
  verifyReleaseBundle(mountedApp);
} finally { spawnSync("hdiutil",["detach",mountPoint,"-force"]); fs.rmSync(mountPoint,{recursive:true,force:true}); }
const bytes=fs.readFileSync(image),sha256=crypto.createHash("sha256").update(bytes).digest("hex");
fs.appendFileSync(path.join(output,"SHA256SUMS.txt"),`${sha256}  ${name}\n`);
receipt.dmg={archive:name,size:bytes.length,sha256,notarized:true,submissionId:notarization?.id??null};
fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n");
console.log(JSON.stringify({image,sha256,size:bytes.length,releaseReady:true},null,2));
