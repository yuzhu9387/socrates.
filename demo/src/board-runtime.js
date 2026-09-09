const samePoint = (a, b) => a?.x === b?.x && a?.y === b?.y;
const sameStyle = (a = {}, b = {}) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key]);

// Semantic edits travel into the native canvas separately from pointer motion.
// Read the current domain ref when a queued update runs, never replay a stale
// render's coordinates over a live drag. Measurements belong to the renderer.
export function syncRuntimeNodes(projected, runtime, domain) {
  const current = new Map(runtime.map((node) => [node.id, node]));
  const latest = new Map(domain.map((node) => [node.id, node]));
  return projected.filter((node) => latest.has(node.id)).map((node) => {
    const stored = latest.get(node.id), before = current.get(node.id);
    const position = samePoint(before?.position, stored.position) ? before.position : stored.position;
    const desiredStyle = { ...node.style, ...stored.style };
    const style = before && sameStyle(before.style, desiredStyle) ? before.style : desiredStyle;
    const fixedSize = node.type === 'shape' || node.type === 'group';
    const next = {
      ...node, position, style,
      ...(before?.type === node.type ? { measured: before.measured, dragging: before.dragging, resizing: before.resizing } : {}),
      ...(fixedSize ? { width: Number(style.width), height: Number(style.height) } : {}),
    };
    return before && Object.keys(next).every((key) => before[key] === next[key]) && Object.keys(before).every((key) => key in next)
      ? before : next;
  });
}

export function syncRuntimeEdges(projected, runtime, domain) {
  const latest = new Map(domain.map((edge) => [edge.id, edge]));
  const current = new Map(runtime.map((edge) => [edge.id, edge]));
  return projected.filter((edge) => latest.has(edge.id)).map((edge) => {
    const stored = latest.get(edge.id), before = current.get(edge.id);
    const data = edge.data.route === stored.route ? edge.data : { ...edge.data, route: stored.route };
    const next = { ...edge, route: stored.route, data };
    return before && Object.keys(next).every((key) => before[key] === next[key]) ? before : next;
  });
}
