export const layerValue = (item) => Number.isFinite(item.zIndex) ? item.zIndex : item.type === 'group' ? -20 : item.type === 'shape' ? -10 : item.source ? -1 : 0;

// XYFlow keeps a child above its parent even in manual z-index mode. Use the
// same effective values when presenting older boards with overlapping ranks.
export function effectiveLayerValues(nodes, edges = []) {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const ranks = new Map();
  const visit = (node, path = new Set()) => {
    if (ranks.has(node.id)) return ranks.get(node.id);
    let rank = layerValue(node);
    const parent = lookup.get(node.parentId);
    if (parent && !path.has(parent.id)) rank = Math.max(rank, visit(parent, new Set([...path, node.id])) + 1);
    ranks.set(node.id, rank);
    return rank;
  };
  nodes.forEach((node) => visit(node));
  edges.forEach((edge) => ranks.set(edge.id, layerValue(edge)));
  return ranks;
}

function ancestorsFirst(items) {
  // Stable topological ordering clamps a child above its ancestors while
  // retaining the requested order of every unrelated object.
  const pending = [...items], remaining = new Set(items.map((item) => item.id)), result = [];
  while (pending.length) {
    const index = pending.findIndex((item) => !item.parentId || !remaining.has(item.parentId));
    const [item] = pending.splice(index < 0 ? 0 : index, 1);
    remaining.delete(item.id);
    result.push(item);
  }
  return result;
}

// A selected group and its descendants travel as one stacking unit. A child
// selected by itself may move independently, but never below its ancestors.
export function reorderLayers(graph, ids, action) {
  const chosen = new Set(ids);
  const effective = effectiveLayerValues(graph.nodes, graph.edges);
  const items = [...graph.nodes, ...graph.edges].sort((a, b) => effective.get(a.id) - effective.get(b.id));
  const children = new Map();
  graph.nodes.forEach((node) => {
    if (!node.parentId) return;
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  });
  const collect = (id, members = new Set()) => {
    if (members.has(id)) return members;
    members.add(id);
    (children.get(id) || []).forEach((childId) => collect(childId, members));
    return members;
  };
  const groups = graph.nodes.filter((node) => node.type === 'group' && chosen.has(node.id)).map((node) => ({ id: node.id, members: collect(node.id) }));
  const roots = groups.filter((group) => !groups.some((other) => other.id !== group.id && other.members.has(group.id)));
  const owner = new Map();
  roots.forEach((group) => group.members.forEach((id) => owner.set(id, group.id)));
  const blocks = new Map(roots.map((group) => [group.id, items.filter((item) => group.members.has(item.id))]));
  const units = [];
  items.forEach((item) => {
    const groupId = owner.get(item.id);
    if (!groupId) units.push({ items: [item], selected: chosen.has(item.id) });
    else if (blocks.get(groupId).at(-1).id === item.id) {
      // The group's foremost member defines its place among outside objects.
      units.push({ items: ancestorsFirst(blocks.get(groupId)), selected: true });
    }
  });
  let result = [...units];
  if (action === 'front') result = [...units.filter((unit) => !unit.selected), ...units.filter((unit) => unit.selected)];
  else if (action === 'back') result = [...units.filter((unit) => unit.selected), ...units.filter((unit) => !unit.selected)];
  else if (action === 'forward') {
    for (let i = result.length - 2; i >= 0; i--) if (result[i].selected && !result[i + 1].selected) [result[i], result[i + 1]] = [result[i + 1], result[i]];
  } else if (action === 'backward') {
    for (let i = 1; i < result.length; i++) if (result[i].selected && !result[i - 1].selected) [result[i], result[i - 1]] = [result[i - 1], result[i]];
  }
  const ranks = new Map(ancestorsFirst(result.flatMap((unit) => unit.items)).map((item, index) => [item.id, index]));
  return { nodes: graph.nodes.map((item) => ({ ...item, zIndex: ranks.get(item.id) })), edges: graph.edges.map((item) => ({ ...item, zIndex: ranks.get(item.id) })) };
}
