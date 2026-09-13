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
console.log("Rendered canonical whale/pointer variants and the menu-bar template.");
