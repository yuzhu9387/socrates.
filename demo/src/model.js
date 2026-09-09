export const uid = (prefix='id') => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
export const clone = value => JSON.parse(JSON.stringify(value));
export const normalizeTag = value => value.trim().replace(/^#+/,'').normalize('NFKC').toLowerCase();
export const STORAGE_KEY = 'socrates-uiux-v1';
export const getMapNotes = (map, notes) => {
 const references = [...new Set(map.nodes.filter(n=>n.noteId).map(n=>n.noteId))];
 const ids = [...new Set([...(map.noteOrder||[]).filter(id=>references.includes(id)),...references])];
 const byId = new Map(notes.map(note=>[note.id,note]));
 return ids.map(id=>byId.get(id)).filter(note=>note&&!note.deleted);
};
export const getMapTags = (map, notes) => {
 const counts=new Map(); getMapNotes(map,notes).forEach(n=>n.tags.forEach(t=>counts.set(t,(counts.get(t)||0)+1)));
 return [...new Set([...(map.tagOrder||[]).filter(t=>counts.has(t)),...[...counts].sort((a,b)=>b[1]-a[1]).map(v=>v[0])])];
};
export function upsertNote(data,note){
 const next=clone(data); const existing=next.notes.find(n=>n.id===note.id);
 const tags=[...new Set(note.tags.map(t=>{const match=next.tags.find(k=>normalizeTag(k)===normalizeTag(t));return match||t.trim().replace(/^#+/,'');}).filter(Boolean))];
 const item={...note,id:note.id||uid('note'),tags,createdAt:existing?.createdAt||note.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),deleted:false};
 if(existing)next.notes=next.notes.map(n=>n.id===item.id?item:n);else next.notes.unshift(item);
 next.tags=[...new Set([...next.tags,...tags])];return next;
}
export function saveMap(data,mapId,changes={}){
 const next=clone(data),map=next.maps.find(m=>m.id===mapId);if(!map)throw new Error('Map not found');Object.assign(map,changes);
 if(map.nodes.some(n=>n.noteId&&!next.notes.find(v=>v.id===n.noteId&&!v.deleted)))throw new Error('Restore or remove deleted source notes before saving.');
 const revision={number:Math.max(0,map.saved?.number||0,...(map.history||[]).map(r=>r.number))+1,date:new Date().toISOString(),name:map.name,summary:map.summary,description:map.description,nodes:clone(map.nodes),edges:clone(map.edges),notes:clone(getMapNotes(map,next.notes)),noteOrder:getMapNotes(map,next.notes).map(n=>n.id),tagOrder:getMapTags(map,next.notes)};
 map.history=[...(map.history||[]),...(map.saved?[map.saved]:[])];map.saved=revision;map.updatedAt=revision.date;return next;
}
export function removeNode(map,nodeId){
 const target=map.nodes.find(n=>n.id===nodeId);
 const origin={x:target?.position?.x||0,y:target?.position?.y||0};
 const byId=new Map(map.nodes.map(n=>[n.id,n]));
 const seen=new Set([nodeId]);
 let parentId=target?.parentId;
 while(parentId&&!seen.has(parentId)){
  seen.add(parentId);const parent=byId.get(parentId);if(!parent)break;
  origin.x+=parent.position?.x||0;origin.y+=parent.position?.y||0;parentId=parent.parentId;
 }
 return {...map,nodes:map.nodes.filter(n=>n.id!==nodeId).map(n=>n.parentId===nodeId?{...n,parentId:undefined,position:{x:n.position.x+origin.x,y:n.position.y+origin.y}}:n),edges:map.edges.filter(e=>e.source!==nodeId&&e.target!==nodeId)};
}
export function newMap(noteIds=[],name='Untitled board'){
 return {id:uid('map'),name,summary:'',description:'',tagOrder:[],updatedAt:new Date().toISOString(),nodes:noteIds.map((noteId,i)=>({id:uid('node'),noteId,type:'note',position:{x:80+(i%3)*300,y:70+Math.floor(i/3)*200}})),edges:[],saved:null,history:[],deleted:false};
}
export function markdownForNotes(notes){return notes.map(n=>`---\nid: ${JSON.stringify(n.id)}\nsummary: ${JSON.stringify(n.summary)}\ntags: ${JSON.stringify(n.tags)}\ncreated_at: ${JSON.stringify(n.createdAt||new Date().toISOString())}\n---\n\n${n.body}\n`).join('\n');}
export function makeSeed(){
 const examples=[
  ['Being understood starts with being honest.','今天开会时，我发现自己花了很多时间寻找“正确的表达”。\n\n真正阻碍表达的，往往不是语言，而是害怕被误解。\n\n> Clarity begins with the courage to say what you mean.',['表达','Self-awareness'],'story'],
  ['The best questions leave room for surprise.','A conversation with a friend reminded me that a good question is an invitation, not a test.\n\n## A question to keep\nWhat am I assuming that I have not actually checked?',['Learning','Self-awareness'],'thought'],
  ['先理解，再表达。','一次争论中，我们都在准备下一句话，却没有听清上一句话。\n\n停下来复述对方的意思之后，问题忽然变小了。',['表达','Relationships'],'story'],
  ['A pause can say more than another sentence.','At dinner, I resisted the urge to give advice. I waited.\n\nThe story became more honest in the silence.\n\nListening is an action.',['Relationships','表达'],'story'],
  ['Make the idea smaller. Make the meaning clearer.','一个能被记住的观点，常常只有一句话。\n\nIf I cannot explain it simply, I might still be thinking through it.\n\n- Find the central claim.\n- Add one concrete story.\n- Leave a question.',['表达','Teaching'],'thought'],
  ['What I remember is what I connect.','Reading is not the same as learning.\n\n今天把一本书的观点和上周的经历连在一起，才发现它真正的意义。',['Learning','复盘'],'thought'],
  ['复盘不是重播，而是重新理解。','The useful part of reflection is not a perfect record. It is a changed interpretation.\n\n## Next time\nAsk what this experience can teach someone else.',['复盘','Self-awareness'],'thought'],
  ['Small experiments beat perfect plans.','I spent an hour planning a ten-minute task. The first attempt taught me more than the plan.\n\nStart with the smallest question you can test.',['Learning','Growth'],'story'],
  ['教会别人，是另一种学会。','Preparing a short lesson revealed all the gaps that reading had hidden.\n\nExplain it. Notice the gap. Learn again.',['Teaching','Learning'],'thought'],
  ['The story is often hiding in the ordinary.','咖啡店里，店员记住了常客的习惯。一个很小的细节，却让陌生的空间有了归属感。',['Stories','Relationships'],'story'],
  ['Progress has a quieter voice than we expect.','Not every breakthrough announces itself.\n\n今天比昨天多一点耐心，也是成长。',['Growth','Self-awareness'],'thought'],
  ['Keep the moment before it becomes a lesson.','When writing a story, record what actually happened before explaining what it means.\n\n细节先于道理。',['Stories','Teaching'],'story']
 ];
 const notes=examples.map((v,i)=>({id:`note-${i+1}`,summary:v[0],body:v[1],tags:v[2],kind:v[3],createdAt:new Date(Date.now()-i*1000*60*60*15).toISOString(),updatedAt:new Date(Date.now()-i*1000*60*60*15).toISOString(),deleted:false}));
 const make=(id,name,summary,ids)=>({...newMap(ids,name),id,summary,description:'A collection of lived moments and connected ideas. Revisit the relationships, follow the stories, and find a useful way to share what you have learned.',nodes:ids.map((noteId,i)=>({id:`${id}-n${i}`,noteId,type:'note',position:[{x:100,y:130},{x:460,y:45},{x:820,y:145},{x:300,y:365},{x:680,y:385}][i]})),edges:ids.slice(1).map((_,i)=>({id:`${id}-e${i}`,source:`${id}-n${i}`,target:`${id}-n${i+1}`,label:['Inspires','Supports','Builds on','Related to'][i]}))});
 let d={version:1,notes,tags:[...new Set(notes.flatMap(n=>n.tags))],maps:[make('map-expression','The art of being understood','Clarity begins with listening — and the courage to be honest.',['note-1','note-3','note-4','note-5','note-2']),make('map-learning','Learning that stays','Turn experience into understanding, one connection at a time.',['note-6','note-7','note-8','note-9']),make('map-stories','The stories in between','Small moments, larger truths.',['note-10','note-11','note-12'])],theme:'light',motion:true};
 d=saveMap(d,'map-expression');d=saveMap(d,'map-learning');return d;
}
