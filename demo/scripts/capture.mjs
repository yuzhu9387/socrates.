import { chromium } from '/Users/guoyuzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const out = new URL('../screenshots/', import.meta.url).pathname;
await fs.mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true,executablePath:'/Users/guoyuzhu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const page = await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
for (const [name, route] of [['dashboard','dashboard'],['brainstorm','brainstorm/map-expression'],['knowledge-maps','maps'],['knowledge-map-detail','maps/map-expression']]) {
  await page.goto(`http://127.0.0.1:4173/#/${route}`);
  await page.waitForLoadState('networkidle');
  if(name==='brainstorm') {
    await page.getByRole('button',{name:'Fit all cards in view',exact:true}).click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({path:`${out}${name}.png`});
  console.log(`${name}: ${await page.title()}, width ${await page.evaluate(()=>document.documentElement.scrollWidth)}`);
}
await page.setViewportSize({width:390,height:844});
for(const route of ['dashboard','brainstorm/map-expression','maps','maps/map-expression','tags','trash','settings']) {
  await page.goto(`http://127.0.0.1:4173/#/${route}`);
  await page.waitForLoadState('networkidle');
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
  if(dimensions.scroll>dimensions.viewport+1) errors.push(`Horizontal overflow at ${route}: ${dimensions.scroll}`);
  console.log(`mobile ${route}: ${JSON.stringify(dimensions)}`);
}
await page.goto('http://127.0.0.1:4173/#/dashboard');
await page.waitForLoadState('networkidle');
await page.screenshot({path:`${out}mobile-dashboard.png`,fullPage:true});
await fs.writeFile(`${out}capture-results.json`, JSON.stringify({errors},null,2));
await browser.close();
if(errors.length) throw new Error(errors.join('\n'));
