import assert from 'node:assert/strict';
import {chromium} from '/Users/guoyuzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {makeSeed,saveMap,STORAGE_KEY} from '../src/model.js';
import {getRoutedPath,getRouteLabelPosition} from '../src/board-geometry.js';

const browser=await chromium.launch({headless:true,executablePath:'/Users/guoyuzhu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const context=await browser.newContext({viewport:{width:1512,height:1080}}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
let data=makeSeed();
data.maps[0].nodes.push(
 {id:'saved-region-back',type:'shape',position:{x:40,y:0},style:{width:1060,height:560},zIndex:-10,data:{shape:'rectangle',label:'表达与理解 · Expression',strokeStyle:'dashed',color:'sage'}},
 {id:'saved-region-front',type:'shape',position:{x:850,y:310},style:{width:300,height:220},zIndex:5,data:{shape:'ellipse',label:'Reflection',strokeStyle:'solid',color:'slate'}},
 {id:'legacy-high-group',type:'group',position:{x:30,y:80},style:{width:380,height:380},zIndex:10,data:{label:'A higher group'}},
);
data.maps[0].nodes[0].parentId='legacy-high-group';
data.maps[0].nodes[0].zIndex=0;
data.maps[0].nodes[0].position.x-=30;
data.maps[0].nodes[0].position.y-=80;
data.maps[0].edges[0].route=[{x:380,y:-180},{x:520,y:-180}];
data.maps[0].edges[0].label='新的视角 → A new perspective connects the stories we tell with the questions that open a deeper conversation. 把故事连接起来，寻找新的理解。';
data=saveMap(data,'map-expression');
data.maps[0].nodes.find(node=>node.id==='saved-region-front').data.strokeStyle='dashed';
data.maps[0].edges[0].route[0].y=100;
await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:STORAGE_KEY,value:data});
await page.goto('http://127.0.0.1:4173/#/maps/map-expression');
await page.getByRole('button',{name:'Original Board',exact:true}).click();
await page.locator('[data-saved-layer="saved-region-front"] [data-region-shape="ellipse"]').waitFor();
assert.equal(await page.locator('.big-graph [data-region-shape]').count(),2);
assert.equal(await page.locator('[data-saved-layer="saved-region-front"] [data-region-stroke]').getAttribute('data-region-stroke'),'solid');
const layers=await page.locator('.big-graph [data-saved-layer]').evaluateAll(elements=>elements.map(element=>({id:element.dataset.savedLayer,order:Number(element.dataset.layerOrder)})));
assert.equal(layers[0].id,'saved-region-back');
assert.equal(layers.at(-1).id,data.maps[0].nodes[0].id);
assert.equal(layers.find(layer=>layer.id==='legacy-high-group').order,10);
assert.equal(layers.at(-1).order,11);
assert.ok(layers.every((layer,index)=>!index||layer.order>=layers[index-1].order));
const curve=await page.locator(`[data-saved-layer="${data.maps[0].edges[0].id}"] path`).getAttribute('d');
assert.match(curve,/380,-180/);
const label=page.locator(`[data-saved-connection-label="${data.maps[0].edges[0].id}"]`);
const values=curve.match(/[-+]?\d*\.?\d+/g).map(Number),last=values.slice(-2);
const labelPosition=getRouteLabelPosition(getRoutedPath({sourceX:values[0],sourceY:values[1],targetX:last[0],targetY:last[1],route:data.maps[0].saved.edges[0].route}));
assert.ok(Math.abs(Number(await label.getAttribute('y'))-labelPosition.y)<.001);
const dimensions=await label.locator('.board-edge-text').evaluate(element=>({height:element.offsetHeight,lineHeight:parseFloat(getComputedStyle(element).lineHeight),width:element.offsetWidth}));
assert.ok(dimensions.height>dimensions.lineHeight*2);
assert.ok(dimensions.width<=300);
await page.getByRole('button',{name:'View saved region Reflection',exact:true}).click();
await page.getByText('Ellipse · Solid outline · Slate',{exact:true}).waitFor();
await page.screenshot({path:'/Users/guoyuzhu/Socrates/demo/screenshots/saved-regions.png',fullPage:true});
await page.getByRole('button',{name:'Graph View',exact:true}).click();
assert.equal(await page.getByRole('button',{name:/Explore note /}).count(),5);
assert.deepEqual(errors,[]);
console.log(JSON.stringify({passed:['saved region artwork','layer ordering including legacy grouped children','frozen route and outline','shared wrapped connection label placement','region inspector','semantic graph excludes shapes'],errors}));
await context.close();await browser.close();
