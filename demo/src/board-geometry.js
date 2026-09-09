const finite = value => Number.isFinite(value) ? value : 0;
const point = value => ({ x: finite(value.x), y: finite(value.y) });
const coordinate = value => Math.round(value * 1000) / 1000;
const pair = value => `${coordinate(value.x)},${coordinate(value.y)}`;
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cubic(segment, t) {
  const a = interpolate(segment[0], segment[1], t);
  const b = interpolate(segment[1], segment[2], t);
  const c = interpolate(segment[2], segment[3], t);
  return interpolate(interpolate(a, b, t), interpolate(b, c, t), t);
}

function halfwayAlong(segments) {
  const samples = [{ ...segments[0][0], distance: 0 }];
  let distance = 0;
  for (const segment of segments) {
    for (let step = 1; step <= 32; step += 1) {
      const next = cubic(segment, step / 32), previous = samples.at(-1);
      distance += Math.hypot(next.x - previous.x, next.y - previous.y);
      samples.push({ ...next, distance });
    }
  }
  const middle = distance / 2;
  const index = Math.max(1, samples.findIndex(sample => sample.distance >= middle));
  const a = samples[index - 1], b = samples[index];
  return interpolate(a, b, b.distance === a.distance ? 0 : (middle - a.distance) / (b.distance - a.distance));
}

/** Persist only route anchors; both editor and saved boards derive the same curve. */
export function getRoutedPath({ sourceX, sourceY, targetX, targetY, route = [] }) {
  const source = point({ x: sourceX, y: sourceY }), target = point({ x: targetX, y: targetY });
  const anchors = Array.isArray(route) ? route.filter(anchor => anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)).map(point) : [];
  let segments;
  if (!anchors.length) {
    const reach = Math.max(48, Math.min(180, Math.abs(target.x - source.x) * 0.5 + Math.abs(target.y - source.y) * 0.12));
    segments = [[source, { x: source.x + reach, y: source.y }, { x: target.x - reach, y: target.y }, target]];
  } else {
    const points = [source, ...anchors, target];
    const tangents = points.map((anchor, index) => {
      if (index === 0 || index === points.length - 1) {
        const neighbor = points[index === 0 ? 1 : index - 1];
        return { x: Math.min(120, Math.max(20, Math.hypot(neighbor.x - anchor.x, neighbor.y - anchor.y) * 0.3)), y: 0 };
      }
      const before = points[index - 1], after = points[index + 1];
      // A short tangent limits overshoot while keeping a continuous direction at every bend.
      return { x: (after.x - before.x) * 0.18, y: (after.y - before.y) * 0.18 };
    });
    segments = points.slice(1).map((end, index) => [
      points[index],
      { x: points[index].x + tangents[index].x, y: points[index].y + tangents[index].y },
      { x: end.x - tangents[index + 1].x, y: end.y - tangents[index + 1].y },
      end,
    ]);
  }
  const middle = halfwayAlong(segments), hull = segments.flat();
  return {
    path: `M ${pair(source)} ${segments.map(segment => `C ${pair(segment[1])} ${pair(segment[2])} ${pair(segment[3])}`).join(' ')}`,
    labelX: middle.x,
    labelY: middle.y,
    handles: anchors.length ? anchors : [middle],
    bounds: { left: Math.min(...hull.map(p => p.x)), right: Math.max(...hull.map(p => p.x)), top: Math.min(...hull.map(p => p.y)), bottom: Math.max(...hull.map(p => p.y)) },
  };
}

/** The label is bottom-aligned here in both the interactive and saved board. */
export function getRouteLabelPosition(geometry) {
  const nearbyHandles = geometry.handles.filter(anchor => Math.abs(anchor.x - geometry.labelX) < 175 && Math.abs(anchor.y - geometry.labelY) < 100);
  return {
    x: geometry.labelX,
    y: Math.min(geometry.labelY - 16, ...nearbyHandles.map(anchor => anchor.y - 24)),
  };
}
