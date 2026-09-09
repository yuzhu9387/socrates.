import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getRoutedPath} from '../src/board-geometry.js';

test('manual connection routes pass through every bend and keep distant detours inside fitted bounds',()=>{
 const route=[{x:410,y:-280},{x:660,y:-280}],before=structuredClone(route);
 const result=getRoutedPath({sourceX:300,sourceY:160,targetX:760,targetY:220,route});
 const segments=[...result.path.matchAll(/C ([^C]+)/g)].map(match=>match[1].trim().split(/[,\s]+/).map(Number));
 assert.equal(segments.length,3);
 assert.deepEqual(segments.slice(0,-1).map(segment=>({x:segment[4],y:segment[5]})),route);
 assert.deepEqual(segments.at(-1).slice(-2),[760,220]);
 assert.ok(result.bounds.top<=-280);
 assert.ok(result.labelX>=result.bounds.left&&result.labelX<=result.bounds.right);
 assert.ok(result.labelY>=result.bounds.top&&result.labelY<=result.bounds.bottom);
 assert.deepEqual(route,before);
});

test('backward, vertical, and coincident connections always have a finite editable handle',()=>{
 for(const [sourceX,sourceY,targetX,targetY] of [[500,200,0,400],[100,0,100,500],[42,42,42,42]]){
  const geometry=getRoutedPath({sourceX,sourceY,targetX,targetY});
  assert.equal(geometry.handles.length,1);
  assert.ok(Number.isFinite(geometry.handles[0].x)&&Number.isFinite(geometry.handles[0].y));
  assert.doesNotMatch(geometry.path,/NaN|Infinity/);
  assert.match(geometry.path,/ C /);
 }
});
