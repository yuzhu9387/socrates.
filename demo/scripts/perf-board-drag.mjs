import {chromium} from '/Users/guoyuzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {makeSeed,STORAGE_KEY} from '../src/model.js';

const label=process.argv[2]||'sample',root=new URL('../',import.meta.url);
const sourceHash=async()=>createHash('sha256').update(await fs.readFile(new URL('src/board.jsx',root))).digest('hex');
const initialHash=await sourceHash(),results=[];
const browser=await chromium.launch({headless:true,executablePath:'/Users/guoyuzhu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'});

function fixture(count){
 const data=makeSeed(),map=data.maps[0];
 if(count!==5){
  map.nodes=Array.from({length:count},(_,i)=>({id:`perf-note-${i}`,type:'note',noteId:data.notes[i%data.notes.length].id,position:{x:80+i%10*290,y:90+Math.floor(i/10)*220}}));
  map.edges=map.nodes.slice(1).map((node,i)=>({id:`perf-edge-${i}`,source:map.nodes[i].id,target:node.id,label:'Connects · 关联'}));
 }
 map.nodes.push({id:'perf-region',type:'shape',position:{x:-300,y:100},style:{width:280,height:230},zIndex:-10,data:{shape:'rectangle',label:'Reflection region',strokeStyle:'dashed',color:'sage'}});
 return data;
}

const quantile=(values,p)=>{const ordered=values.slice().sort((a,b)=>a-b);return ordered[Math.min(ordered.length-1,Math.floor((ordered.length-1)*p))]||0;};
const rounded=value=>Math.round(value*100)/100;

try{
 for(const count of [5,100,200]){
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const data=fixture(count),map=data.maps[0];
  await page.addInitScript(({key,value})=>{
   localStorage.setItem(key,JSON.stringify(value));
   window.__dragPerf={active:false,rootCommits:0,boardCanvasRenders:0,gaps:[],longTasks:[],writes:0};
   window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject(){return 1;},onCommitFiberRoot(_id,root){
    const sample=window.__dragPerf;if(!sample.active)return;sample.rootCommits++;
    const pending=[root.current];
    while(pending.length){const fiber=pending.pop(),type=fiber.type,name=type?.name||type?.displayName||type?.type?.name;
     if(name==='BoardCanvas'){if(fiber.flags&1)sample.boardCanvasRenders++;break;}
     if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
    }
   },onCommitFiberUnmount(){},checkDCE(){}};
   let previous=null;
   function frame(now){const sample=window.__dragPerf;if(sample.active&&previous!==null)sample.gaps.push(now-previous);previous=sample.active?now:null;requestAnimationFrame(frame);}
   requestAnimationFrame(frame);
   new PerformanceObserver(list=>{if(window.__dragPerf.active)window.__dragPerf.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})));}).observe({type:'longtask',buffered:false});
   const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__dragPerf.active&&key==='socrates-uiux-v1')window.__dragPerf.writes++;return write.call(this,key,value);};
  },{key:STORAGE_KEY,value:data});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto('http://127.0.0.1:4173/#/brainstorm/map-expression');
  await page.waitForLoadState('networkidle');await page.waitForTimeout(700);
  for(const [kind,id] of [['card',map.nodes[0].id],['shape','perf-region']]){
   await page.getByRole('button',{name:'Fit all cards in view',exact:true}).click();await page.waitForTimeout(500);
   const target=page.locator(`[data-testid="rf__node-${id}"]`),box=await target.boundingBox();
   if(!box)throw new Error(`Missing ${count} ${kind}`);
   const initial=await target.getAttribute('style');
   const x=box.x+box.width*.45,y=box.y+box.height*(kind==='card'?.42:.25);
   await page.mouse.move(x,y);
   const metricsBefore=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
   await page.evaluate(()=>{Object.assign(window.__dragPerf,{active:true,rootCommits:0,boardCanvasRenders:0,gaps:[],longTasks:[],writes:0,start:performance.now()});});
   await page.mouse.down();
   const inputStart=performance.now(),moves=120,targetDuration=2400;
   for(let step=1;step<=moves;step++){
    const ratio=step/moves;
    await page.mouse.move(x+100*Math.sin(ratio*Math.PI*2)+ratio*32,y+55*Math.sin(ratio*Math.PI));
    const remaining=inputStart+step*targetDuration/moves-performance.now();
    if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
   }
   const during=await page.evaluate(()=>({writes:window.__dragPerf.writes}));
   await page.mouse.up();await page.waitForTimeout(100);
   const sample=await page.evaluate(()=>{window.__dragPerf.active=false;return {...window.__dragPerf,elapsedMs:performance.now()-window.__dragPerf.start};});
   const metricsAfter=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
   const changed=await target.getAttribute('style')!==initial;
   const cpu=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[`${name}Ms`,rounded((metricsAfter[name]-metricsBefore[name])*1000)]));
   const result={noteInstances:count,totalNodes:map.nodes.length,kind,cpuThrottle:4,inputMoves:moves,targetInputWindowMs:targetDuration,actualWindowMs:rounded(sample.elapsedMs),moved:changed,reactRootCommits:sample.rootCommits,boardCanvasRenderCommits:sample.boardCanvasRenders,persistenceWritesDuringMoves:during.writes,persistenceWritesIncludingRelease:sample.writes,rafSamples:sample.gaps.length,rafGapMedianMs:rounded(quantile(sample.gaps,.5)),rafGapP95Ms:rounded(quantile(sample.gaps,.95)),rafGapMaxMs:rounded(Math.max(...sample.gaps)),rafGapsOver33Ms:sample.gaps.filter(gap=>gap>33.4).length,longTaskCount:sample.longTasks.length,longTaskTotalMs:rounded(sample.longTasks.reduce((sum,entry)=>sum+entry.duration,0)),...cpu,errors,raw:{rafGapsMs:sample.gaps,longTasks:sample.longTasks}};
   results.push(result);console.log(JSON.stringify({...result,raw:undefined}));
  }
  await context.close();
 }
 const report={label,capturedAt:new Date().toISOString(),boardSourceSha256:initialHash,sourceUnchangedDuringCapture:initialHash===await sourceHash(),method:'Headless Chromium; 1440×1000; 4× CPU throttle; DevTools commit hook; 120 actual mouse moves scheduled over 2400 ms. rAF gaps measure browser callback cadence, not input-event FPS or a hardware guarantee. Metrics include drag release and 100 ms settling. Fresh isolated localStorage fixtures only.',results};
 const output=new URL(`screenshots/drag-performance-${label}.json`,root);await fs.writeFile(output,JSON.stringify(report,null,2));
 console.log(`Saved ${output.pathname}; source unchanged: ${report.sourceUnchangedDuringCapture}`);
}finally{await browser.close();}
