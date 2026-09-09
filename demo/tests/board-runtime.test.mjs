import test from 'node:test';
import assert from 'node:assert/strict';
import { syncRuntimeNodes, syncRuntimeEdges } from '../src/board-runtime.js';

test('a queued semantic update preserves the latest pointer coordinates and measured card dimensions', () => {
  const measured = { width: 256, height: 184 }, data = { note: { summary: '更新 · A live thought' } };
  const rendered = { id: 'n', type: 'note', position: { x: 10, y: 20 }, style: { width: 256 }, data };
  const runtime = { ...rendered, position: { x: 90, y: 72 }, measured, dragging: true };
  const domain = { id: 'n', type: 'note', position: { x: 96, y: 75 } };
  const [next] = syncRuntimeNodes([rendered], [runtime], [domain]);
  assert.deepEqual(next.position, domain.position);
  assert.equal(next.measured, measured);
  assert.equal(next.data, data);
  assert.equal(next.dragging, true);
  assert.deepEqual(rendered.position, { x: 10, y: 20 });
});

test('undoing a shape resize replaces native width and height while keeping the region identity and source metadata', () => {
  const old = { id: 'shape', type: 'shape', position: { x: 20, y: 30 }, style: { width: 300, height: 200 }, data: { shape: 'ellipse', label: '想法' } };
  const runtime = { ...old, width: 500, height: 350, measured: { width: 500, height: 350 }, style: { width: 500, height: 350 } };
  const [restored] = syncRuntimeNodes([old], [runtime], [old]);
  assert.equal(restored.width, 300); assert.equal(restored.height, 200);
  assert.equal(restored.data, old.data);
  assert.deepEqual(restored.position, old.position);
});

test('runtime synchronization removes deleted objects and preserves intentional reparenting and undo moves', () => {
  const a = { id: 'a', type: 'note', parentId: 'group', position: { x: 5, y: 10 }, data: {}, style: { width: 256 } };
  const b = { id: 'b', type: 'note', position: { x: 100, y: 30 }, data: {}, style: { width: 256 } };
  const restored = { ...a, parentId: undefined, position: { x: 600, y: 500 } };
  const result = syncRuntimeNodes([restored, b], [a, b], [restored]);
  assert.equal(result.length, 1); assert.equal(result[0].parentId, undefined);
  assert.deepEqual(result[0].position, { x: 600, y: 500 });
});

test('queued edge updates keep live bends and delete removed connections without serializing callbacks', () => {
  const onEdit = () => {}, route = [{ x: 220, y: -100 }];
  const edge = { id: 'e', source: 'a', target: 'b', data: { route: undefined, onEdit }, label: '关联' };
  const domain = { id: 'e', source: 'a', target: 'b', route, label: '关联' };
  const result = syncRuntimeEdges([edge, { ...edge, id: 'removed' }], [edge], [domain]);
  assert.equal(result.length, 1); assert.equal(result[0].route, route); assert.equal(result[0].data.route, route);
  assert.equal(result[0].data.onEdit, onEdit); assert.equal(domain.data, undefined);
});
