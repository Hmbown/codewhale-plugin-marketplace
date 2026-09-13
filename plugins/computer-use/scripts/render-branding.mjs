#!/usr/bin/env node
// Build-time SVG renderer; the shipped MCP runtime remains dependency-free.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const assets=fileURLToPath(new URL("../assets/",import.meta.url));
for(const variant of ["light","dark"]) {
  const svg=fs.readFileSync(path.join(assets,`icon-${variant}.svg`));
  for(const size of [32,64,256]) await sharp(svg).resize(size,size).png().toFile(path.join(assets,`icon-${variant}-${size}.png`));
  if(variant==="dark") await sharp(svg).resize(1024,1024).png().toFile(path.join(assets,"icon-source.png"));
}
await sharp(fs.readFileSync(path.join(assets,"icon-mono.svg"))).resize(36,36).png().toFile(path.join(assets,"icon-menubar.png"));
// Disk-image window background at 1x and 2x; scripts/package-dmg.mjs combines
// them into one Retina-aware TIFF at packaging time.
const background=fs.readFileSync(path.join(assets,"macos","dmg-background.svg"));
for(const scale of [1,2]) await sharp(background,{density:72*scale}).resize(660*scale,400*scale).png().toFile(path.join(assets,"macos",`dmg-background${scale===2?"@2x":""}.png`));
console.log("Rendered canonical whale/pointer variants, the menu-bar template and the disk-image background.");
