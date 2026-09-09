import React, { memo, useEffect, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow } from '@xyflow/react';
import { Check, X } from 'lucide-react';
import { getRoutedPath, getRouteLabelPosition } from './board-geometry.js';

function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, label, selected, data }) {
  const flow = useReactFlow();
  const geometry = getRoutedPath({ sourceX, sourceY, targetX, targetY, route: data.route });
  const labelPosition = getRouteLabelPosition(geometry);
  const [draft, setDraft] = useState(label || '');
  const input = useRef(null), gesture = useRef(null), composing = useRef(false);
  useEffect(() => { if (data.editing) { setDraft(label || ''); requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); } }, [data.editing, label]);
  const edit = (event) => { event.stopPropagation(); data.onEdit(id); };
  const finish = () => { if (!gesture.current) return; gesture.current = null; data.onGestureEnd(); };
  const save = (event) => { event.preventDefault(); event.stopPropagation(); if (composing.current) return; data.onLabelChange(id, draft.trim()); };
  return <>
    <BaseEdge id={id} path={geometry.path} markerEnd={markerEnd} style={style} interactionWidth={26}/>
    <EdgeLabelRenderer>
      <div className={`board-edge-label nodrag nopan ${selected ? 'is-selected' : ''}`} data-edge-label={id} style={{ transform: `translate(-50%, -100%) translate(${labelPosition.x}px, ${labelPosition.y}px)` }} onDoubleClick={edit}>
        {data.editing ? <form className="board-edge-editor" onSubmit={save} onKeyDown={(event) => { event.stopPropagation(); if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; } if (event.key === 'Escape') { event.preventDefault(); data.onEdit(null); } }}>
          <input ref={input} aria-label="Edit connection text" value={draft} maxLength={240} placeholder="Describe the connection…" onChange={(event) => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}/>
          <button type="submit" aria-label="Save connection text" title="Save connection text"><Check size={13}/></button>
          <button type="button" aria-label="Cancel connection text edit" title="Cancel connection text edit" onClick={() => data.onEdit(null)}><X size={13}/></button>
        </form> : <button type="button" className="board-edge-text" aria-label={`Connection text: ${label || 'Unlabeled'}. Double-click to edit`} title="Double-click to edit text" onClick={(event) => { event.stopPropagation(); data.onSelect(id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); edit(event); } }}>{label || (selected ? 'Add a relationship' : '···')}</button>}
      </div>
      {selected && !data.editing && geometry.handles.map((point, index) => <button type="button" key={index} className="board-edge-bend nodrag nopan" aria-label={`Drag connection bend ${index + 1}`} title="Drag to route around cards · Arrow keys to adjust" style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
        onPointerDown={(event) => { if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { index, pointerId: event.pointerId, start: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), handles: geometry.handles.map((p) => ({ ...p })) }; data.onGestureStart(); }}
        onPointerMove={(event) => { const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return; event.preventDefault(); event.stopPropagation(); const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const next = current.handles.map((p) => ({ ...p })); next[current.index] = { x: next[current.index].x + p.x - current.start.x, y: next[current.index].y + p.y - current.start.y }; data.onRouteChange(id, next); }}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 1 : 10; const next = geometry.handles.map((p) => ({ ...p })); next[index].x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; next[index].y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0; data.onGestureStart(); data.onRouteChange(id, next); data.onGestureEnd(); }}><span/></button>)}
    </EdgeLabelRenderer>
  </>;
}

export default memo(RoutedEdge);
