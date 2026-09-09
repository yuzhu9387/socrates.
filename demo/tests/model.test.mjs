import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeSeed, normalizeTag, getMapNotes, saveMap, upsertNote, removeNode, markdownForNotes} from '../src/model.js';
test('tag keys fold width and case without translating Chinese',()=>{assert.equal(normalizeTag(' ＡＩ '),normalizeTag('AI'));assert.notEqual(normalizeTag('学习'),normalizeTag('Learning'));});
test('saving a map freezes original bilingual content across later edits',()=>{let d=makeSeed();d=saveMap(d,'map-expression');const text=d.maps[0].saved.notes[0].body;d=upsertNote(d,{...d.notes[0],body:'新的 insight 🙂'});assert.equal(d.maps[0].saved.notes[0].body,text);assert.equal(d.notes[0].body,'新的 insight 🙂');});
test('recoloring one card leaves its shared note, other references and saved versions intact',()=>{
 let data=makeSeed();
 const originalNote=structuredClone(data.notes[0]);
 data.maps[0].nodes[0].color='sage';
 data.maps[0].nodes.push({...data.maps[0].nodes[0],id:'another-reference',color:'clay'});
 data=saveMap(data,'map-expression');
 const savedNumber=data.maps[0].saved.number;
 data.maps[0].nodes[0].color='slate';
 assert.equal(data.maps[0].saved.nodes[0].color,'sage');
 assert.equal(data.maps[0].nodes.at(-1).color,'clay');
 data=saveMap(data,'map-expression');
 assert.equal(data.maps[0].saved.nodes[0].color,'slate');
 assert.equal(data.maps[0].history.find(version=>version.number===savedNumber).nodes[0].color,'sage');
 assert.deepEqual(data.notes[0],originalNote);
 assert.equal(getMapNotes(data.maps[0],data.notes).length,5);
});
test('duplicate card instances only count one source note',()=>{const d=makeSeed();const m=d.maps[0];m.nodes.push({...m.nodes[0],id:'duplicate'});assert.equal(getMapNotes(m,d.notes).length,5);});
test('removing a card removes its edges but preserves the source note',()=>{const d=makeSeed();const m=removeNode(d.maps[0],d.maps[0].nodes[0].id);assert.equal(m.nodes.length,d.maps[0].nodes.length-1);assert.ok(m.edges.every(e=>e.source!==d.maps[0].nodes[0].id&&e.target!==d.maps[0].nodes[0].id));assert.equal(d.notes.length,12);});
test('removing a nested group preserves the world positions of its released children',()=>{
 const map={nodes:[
  {id:'outer',type:'group',position:{x:100,y:200}},
  {id:'inner',type:'group',parentId:'outer',position:{x:30,y:40}},
  {id:'note',type:'note',noteId:'source',parentId:'inner',position:{x:5,y:6}},
 ],edges:[]};
 const result=removeNode(map,'inner');
 const note=result.nodes.find(n=>n.id==='note');
 assert.equal(note.parentId,undefined);
 assert.deepEqual(note.position,{x:135,y:246});
 assert.deepEqual(result.nodes.find(n=>n.id==='outer').position,{x:100,y:200});
 assert.deepEqual(map.nodes.find(n=>n.id==='note').position,{x:5,y:6});
 assert.equal(map.nodes.find(n=>n.id==='note').parentId,'inner');
});
test('removing an outer group keeps surviving nested relationships intact',()=>{
 const map={nodes:[
  {id:'outer',type:'group',position:{x:100,y:200}},
  {id:'inner',type:'group',parentId:'outer',position:{x:30,y:40}},
  {id:'note',type:'note',noteId:'source',parentId:'inner',position:{x:5,y:6}},
 ],edges:[]};
 const result=removeNode(map,'outer');
 const inner=result.nodes.find(n=>n.id==='inner');
 const note=result.nodes.find(n=>n.id==='note');
 assert.equal(inner.parentId,undefined);
 assert.deepEqual(inner.position,{x:130,y:240});
 assert.equal(note.parentId,'inner');
 assert.deepEqual(note.position,{x:5,y:6});
});
test('a deleted note prevents a fresh misleading snapshot',()=>{const d=makeSeed();d.notes[0].deleted=true;assert.throws(()=>saveMap(d,'map-expression'),/deleted/i);});
test('Markdown preserves bilingual text and emits metadata safely',()=>{const result=markdownForNotes([{id:'n',summary:'复盘: AI',tags:['学习','AI'],body:'中文\nEnglish 🙂'}]);assert.ok(result.includes('中文\nEnglish 🙂'));assert.ok(result.includes('"复盘: AI"'));});
