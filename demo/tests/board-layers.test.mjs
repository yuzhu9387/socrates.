import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerValue, effectiveLayerValues, reorderLayers } from '../src/board-layers.js';

const ordered = (graph) => [...graph.nodes, ...graph.edges].sort((a, b) => layerValue(a) - layerValue(b)).map((item) => item.id);
const sample = () => ({
  nodes: [
    { id: 'group', type: 'group', position: { x: 20, y: 30 }, data: { label: 'A frame' } },
    { id: 'region', type: 'shape', position: { x: 5, y: 10 }, style: { width: 400, height: 280 }, data: { shape: 'ellipse', color: 'sage', strokeStyle: 'dashed' } },
    { id: 'a', type: 'note', noteId: 'source-a', position: { x: 40, y: 60 } },
    { id: 'b', type: 'note', noteId: 'source-b', parentId: 'group', position: { x: 140, y: 160 } },
  ],
  edges: [{ id: 'edge', source: 'a', target: 'b', label: '支持 supports', route: [{ x: 110, y: 5 }, { x: 190, y: 270 }] }],
});

test('default layers put quiet regions and lines behind source cards', () => {
  assert.deepEqual(ordered(sample()), ['group', 'region', 'edge', 'a', 'b']);
  assert.equal(layerValue({ type: 'shape', zIndex: 12 }), 12);
  assert.equal(layerValue({ type: 'shape', zIndex: NaN }), -10);
});

test('send to back and bring to front affect the whole canvas object order', () => {
  const front = reorderLayers(sample(), ['region'], 'front');
  assert.deepEqual(ordered(front), ['group', 'edge', 'a', 'b', 'region']);
  assert.deepEqual(ordered(reorderLayers(front, ['region'], 'back')), ['region', 'group', 'edge', 'a', 'b']);
});

test('one-step arrangement advances across equal initial z values', () => {
  assert.deepEqual(ordered(reorderLayers(sample(), ['a'], 'forward')), ['group', 'region', 'edge', 'b', 'a']);
  assert.deepEqual(ordered(reorderLayers(sample(), ['b'], 'backward')), ['group', 'region', 'edge', 'b', 'a']);
});

test('a contiguous multi-selection moves one neighbor without reversing its objects', () => {
  const graph = { nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, type: 'note' })), edges: [] };
  assert.deepEqual(ordered(reorderLayers(graph, ['b', 'c'], 'forward')), ['a', 'd', 'b', 'c', 'e']);
  assert.deepEqual(ordered(reorderLayers(graph, ['b', 'c'], 'backward')), ['b', 'c', 'a', 'd', 'e']);
});

test('layer operations never change source references, geometry, parents, or connection routing', () => {
  const graph = sample(), before = structuredClone(graph);
  const result = reorderLayers(graph, ['region', 'a', 'edge'], 'front');
  const withoutLayer = (item) => { const { zIndex, ...rest } = item; return rest; };
  assert.deepEqual(result.nodes.map(withoutLayer), graph.nodes);
  assert.deepEqual(result.edges.map(withoutLayer), graph.edges);
  assert.deepEqual(graph, before, 'the draft used by Undo must remain immutable');
  assert.equal(new Set([...result.nodes, ...result.edges].map(layerValue)).size, graph.nodes.length + graph.edges.length);
});

test('moving an object past a layer boundary preserves visible order', () => {
  const graph = sample();
  assert.deepEqual(ordered(reorderLayers(graph, ['b'], 'forward')), ordered(graph));
  const back = reorderLayers(graph, ['region'], 'back');
  assert.deepEqual(ordered(reorderLayers(back, ['region'], 'backward')), ordered(back));
});

test('a selected group passes an outsider as one block rather than interleaving its children', () => {
  const graph = { nodes: [
    { id: 'group', type: 'group', zIndex: 0 },
    { id: 'child', type: 'note', parentId: 'group', zIndex: 1 },
    { id: 'outside', type: 'note', zIndex: 2 },
    { id: 'last', type: 'note', zIndex: 3 },
  ], edges: [] };
  const forward = reorderLayers(graph, ['group'], 'forward');
  assert.deepEqual(ordered(forward), ['outside', 'group', 'child', 'last']);
  assert.deepEqual(ordered(reorderLayers(forward, ['group'], 'backward')), ['group', 'child', 'outside', 'last']);
});

test('arranging a group includes nested descendants even if only the outer group is selected', () => {
  const graph = { nodes: [
    { id: 'outer', type: 'group', zIndex: 0 },
    { id: 'inner', type: 'group', parentId: 'outer', zIndex: 1 },
    { id: 'child', type: 'note', parentId: 'inner', zIndex: 2 },
    { id: 'outside', type: 'note', zIndex: 3 },
  ], edges: [] };
  const result = reorderLayers(graph, ['outer', 'inner'], 'front');
  assert.deepEqual(ordered(result), ['outside', 'outer', 'inner', 'child']);
  assert.equal(result.nodes.find((node) => node.id === 'inner').parentId, 'outer');
});

test('a child sent to the back clamps above its parent and uses the same rank when rendered', () => {
  const result = reorderLayers(sample(), ['b'], 'back');
  assert.deepEqual(ordered(result), ['group', 'b', 'region', 'edge', 'a']);
  const effective = effectiveLayerValues(result.nodes, result.edges);
  for (const item of [...result.nodes, ...result.edges]) assert.equal(effective.get(item.id), item.zIndex);
});

test('effective ranks reproduce XYFlow nested parent elevation for older saved boards', () => {
  const nodes = [
    { id: 'child', type: 'note', parentId: 'inner', zIndex: -5 },
    { id: 'inner', type: 'group', parentId: 'outer', zIndex: 0 },
    { id: 'outer', type: 'group', zIndex: 10 },
    { id: 'orphan', type: 'note', parentId: 'missing', zIndex: 2 },
  ];
  const ranks = effectiveLayerValues(nodes, [{ id: 'edge', source: 'child', target: 'orphan', zIndex: 4 }]);
  assert.equal(ranks.get('outer'), 10);
  assert.equal(ranks.get('inner'), 11);
  assert.equal(ranks.get('child'), 12);
  assert.equal(ranks.get('orphan'), 2);
  assert.equal(ranks.get('edge'), 4);
});
