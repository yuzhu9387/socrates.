import React, { memo, useCallback, useLayoutEffect, useRef } from 'react';
import { NodeResizer, ViewportPortal, useStoreApi } from '@xyflow/react';
import { getCardColor } from './board-palette.js';
import './board-shapes.css';

// Reused without editor controls when showing an immutable saved board.
export const ShapeVisual = memo(function ShapeVisual({ data = {}, selected = false }) {
  const color = getCardColor(data.color);
  const shape = data.shape === 'ellipse' ? 'ellipse' : 'rectangle';
  const strokeStyle = data.strokeStyle === 'dashed' ? 'dashed' : 'solid';

  return <div
    className={`board-region is-${shape}${selected ? ' is-selected' : ''}`}
    data-region-shape={shape}
    data-region-color={color.id}
    data-region-stroke={strokeStyle}
    style={{
      '--region-fill': `${color.accent}09`,
      '--region-stroke': `${color.accent}99`,
      '--region-accent': color.accent,
      borderStyle: strokeStyle,
    }}
  >
    {data.label && <span className="board-region-label">{data.label}</span>}
  </div>;
}, (previous, next) => previous.selected === next.selected
  && previous.data?.shape === next.data?.shape
  && previous.data?.label === next.data?.label
  && previous.data?.strokeStyle === next.data?.strokeStyle
  && previous.data?.color === next.data?.color);

// Only selected regions subscribe to editor geometry. A pointer move changes
// these three DOM styles directly rather than rerendering the region artwork
// and all eight resize controls for every internal-node update.
const ShapeResizeOverlay = memo(function ShapeResizeOverlay({ id, color, onResize, onResizeEnd }) {
  const store = useStoreApi();
  const element = useRef(null);
  useLayoutEffect(() => {
    let previous = null;
    const updateGeometry = (state) => {
      const node = state.nodeLookup.get(id), target = element.current;
      if (!target) return;
      if (!node) { target.style.visibility = 'hidden'; previous = null; return; }
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? 0, height = node.measured.height ?? 0;
      if (previous && previous.x === x && previous.y === y && previous.width === width && previous.height === height) return;
      target.style.visibility = '';
      if (!previous || previous.x !== x || previous.y !== y) target.style.transform = `translate(${x}px, ${y}px)`;
      if (!previous || previous.width !== width) target.style.width = `${width}px`;
      if (!previous || previous.height !== height) target.style.height = `${height}px`;
      previous = { x, y, width, height };
    };
    updateGeometry(store.getState());
    return store.subscribe(updateGeometry);
  }, [id, store]);

  return <ViewportPortal><div ref={element}
    className="board-region-resizer-overlay nodrag nopan"
    data-region-resizer={id}
  ><NodeResizer
    nodeId={id}
    minWidth={120}
    minHeight={90}
    color={color}
    handleClassName="board-region-resize-handle"
    lineClassName="board-region-resize-line"
    onResize={onResize}
    onResizeEnd={onResizeEnd}
  /></div></ViewportPortal>;
});

export const ShapeNode = memo(function ShapeNode({ id, data, selected }) {
  const color = getCardColor(data.color);
  const resizing = useRef(false);
  const resize = useCallback((_event, params) => {
    // XYFlow starts on pointer down but omits its end callback for a click
    // without movement. Start our transaction only when dimensions change.
    if (!resizing.current) {
      resizing.current = true;
      data.onResizeStart?.();
    }
    data.onResize?.(id, { x: params.x, y: params.y, width: params.width, height: params.height });
  }, [id, data.onResizeStart, data.onResize]);
  const resizeEnd = useCallback((_event, params) => {
    if (!resizing.current) return;
    resizing.current = false;
    // The final callback also runs when a resize gesture ends without a last move.
    data.onResize?.(id, { x: params.x, y: params.y, width: params.width, height: params.height });
    data.onResizeEnd?.();
  }, [id, data.onResize, data.onResizeEnd]);

  return <>
    {selected && <ShapeResizeOverlay id={id} color={color.accent} onResize={resize} onResizeEnd={resizeEnd}/>}
    <ShapeVisual data={data} selected={selected} />
  </>;
});
