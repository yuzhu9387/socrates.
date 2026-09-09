import test from 'node:test';
import assert from 'node:assert/strict';
import { getMapNotes, saveMap } from '../src/model.js';
const notes = ['a','b','c'].map(id => ({ id, summary:id, body:'中文', tags:[], deleted:false }));
const map = { id:'m', name:'Map', summary:'Summary', description:'', tagOrder:[], nodes:[{id:'n1',noteId:'a'},{id:'n2',noteId:'b'},{id:'n3',noteId:'a'},{id:'n4',noteId:'c'}],edges:[],noteOrder:['c','a'],saved:null,history:[] };
test('presentation order deduplicates repeated cards and appends new source notes', () => {
 assert.deepEqual(getMapNotes(map,notes).map(note=>note.id),['c','a','b']);
});
test('new saved content freezes its note order and allocates above every retained revision', () => {
 const prior = {number:4};
 const result = saveMap({notes,tags:[],maps:[{...map,saved:{number:2},history:[prior]}]},'m');
 assert.equal(result.maps[0].saved.number,5);
 assert.deepEqual(result.maps[0].saved.noteOrder,['c','a','b']);
 assert.deepEqual(result.maps[0].saved.notes.map(note=>note.id),['c','a','b']);
});
