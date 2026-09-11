import fs from 'node:fs';
import {defineConfig} from '@playwright/test';
const localChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.CW_BROWSER_PATH||(process.platform==='darwin'&&fs.existsSync(localChrome)?localChrome:undefined);
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,reporter:'list',
  use:{headless:true,launchOptions:executablePath?{executablePath}:{}},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true}}],
});
