import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {makeSeed,saveMap,getMapNotes} from '../src/model.js';
import {downloadBackup,downloadNotes,parseImport} from '../src/transfers.js';

test('a real ZIP backup restores draft and frozen instance colors without adding color to source notes',async()=>{
 let data=makeSeed();
 data.maps[0].nodes[0].color='sage';
 data.maps[0].nodes.push({...data.maps[0].nodes[0],id:'alternate-color',color:'clay'});
 data=saveMap(data,'map-expression');
 data.maps[0].nodes[0].color='slate';
 data=saveMap(data,'map-expression');
 data.maps[0].nodes[0].color='lilac';
 const exported=await downloadBackup(data);
 const restored=await parseImport(new File([exported.blob],exported.filename));
 assert.equal(restored.kind,'backup');
 assert.deepEqual(restored.data,data);
 assert.equal(restored.data.maps[0].nodes[0].color,'lilac');
 assert.equal(restored.data.maps[0].saved.nodes[0].color,'slate');
 assert.equal(restored.data.maps[0].history.at(-1).nodes[0].color,'sage');
 assert.equal(restored.data.maps[0].nodes.at(-1).color,'clay');
 assert.ok(restored.data.notes.every(note=>!Object.hasOwn(note,'color')));
});

test('Excel map exports expose each card color and retain complete instance metadata',async()=>{
 const data=makeSeed(),map=data.maps[0];
 map.nodes[0].color='sage';
 map.nodes.push({...map.nodes[0],id:'second-reference',color:'sand'});
 const exported=await downloadNotes(getMapNotes(map,data.notes),'xlsx',map);
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await exported.blob.arrayBuffer());
 const sheet=workbook.getWorksheet('Nodes');
 const headers=sheet.getRow(1).values;
 const column=name=>headers.indexOf(name);
 const rows=[];
 sheet.eachRow((row,index)=>{if(index>1)rows.push(row);});
 const original=rows.find(row=>row.getCell(column('id')).value===map.nodes[0].id);
 const second=rows.find(row=>row.getCell(column('id')).value==='second-reference');
 assert.equal(original.getCell(column('color')).value,'sage');
 assert.equal(second.getCell(column('color')).value,'sand');
 assert.equal(original.getCell(column('note_id')).value,second.getCell(column('note_id')).value);
 assert.equal(JSON.parse(original.getCell(column('properties_json')).value).color,'sage');
 assert.equal(workbook.getWorksheet('Notes').rowCount,6);
});

test('legacy uncolored backups remain readable and non-string colors are rejected',async()=>{
 const data=makeSeed();
 const legacy=await parseImport(new File([JSON.stringify(data)],'legacy.json'));
 assert.equal(legacy.kind,'backup');
 assert.equal(legacy.data.maps[0].nodes[0].color,undefined);
 data.maps[0].nodes[0].color={background:'red'};
 await assert.rejects(parseImport(new File([JSON.stringify(data)],'invalid.json')),/invalid card color/);
});

test('region styling, layers, and routed labels survive ZIP backup as independent saved versions',async()=>{
 let data=makeSeed(),map=data.maps[0];
 map.nodes.push({id:'region-review',type:'shape',position:{x:12,y:-40},style:{width:980,height:620},zIndex:-10,data:{shape:'ellipse',label:'复盘 · Reflection',strokeStyle:'dashed',color:'sage'}});
 map.edges[0]={...map.edges[0],label:'故事 → Insight',route:[{x:360,y:-220},{x:470,y:-210}],zIndex:2};
 data=saveMap(data,map.id);
 data.maps[0].nodes.at(-1).data.strokeStyle='solid';
 data.maps[0].nodes.at(-1).zIndex=4;
 data.maps[0].edges[0].route[0].y=-80;
 const exported=await downloadBackup(data),restored=await parseImport(new File([exported.blob],exported.filename));
 assert.deepEqual(restored.data,data);
 assert.equal(restored.data.maps[0].saved.nodes.at(-1).data.strokeStyle,'dashed');
 assert.equal(restored.data.maps[0].saved.nodes.at(-1).zIndex,-10);
 assert.equal(restored.data.maps[0].saved.edges[0].route[0].y,-220);
 assert.equal(restored.data.maps[0].saved.edges[0].label,'故事 → Insight');
});

test('malformed routes, dimensions, and region styling cannot enter the canvas through backup imports',async()=>{
 const data=makeSeed();
 data.maps[0].nodes.push({id:'test-region',type:'shape',position:{x:0,y:0},style:{width:360,height:240},zIndex:-10,data:{shape:'rectangle',label:'Region',strokeStyle:'solid',color:'paper'}});
 const cases=[
  [draft=>{draft.maps[0].edges[0].route=[{x:20,y:null}];},/invalid connection route/],
  [draft=>{draft.maps[0].edges[0].route=Array.from({length:65},()=>({x:0,y:0}));},/invalid connection route/],
  [draft=>{draft.maps[0].nodes.at(-1).style.width=-1;},/invalid region dimensions/],
  [draft=>{draft.maps[0].nodes.at(-1).data.strokeStyle='not-a-style';},/invalid region outline/],
  [draft=>{draft.maps[0].nodes.at(-1).zIndex='front';},/invalid layer order/],
 ];
 for(const [corrupt,message] of cases){
  const draft=structuredClone(data);corrupt(draft);
  await assert.rejects(parseImport(new File([JSON.stringify(draft)],'invalid.json')),message);
 }
});
