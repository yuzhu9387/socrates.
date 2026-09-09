import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap,
  Handle, Position, MarkerType, SelectionMode, ConnectionLineType, useReactFlow,
} from '@xyflow/react';
import {
  ArrowLeft, ArrowUpRight, Check, Circle, FileText, Folder,
  Frame, GripVertical, Hand, Layers, Link2, Maximize, Minus, MousePointer2,
  PanelLeftClose, PanelLeftOpen, Pencil, Plus, Redo2, Save, Search,
  StickyNote, Trash2, Undo2, Ungroup, X, Eye, Palette, Shapes, Square, MoveUp, MoveDown, ChevronsUp, ChevronsDown, RotateCcw,
} from 'lucide-react';
import BoardHelp from './board-help.jsx';
import { CARD_COLORS, getCardColor } from './board-palette.js';
import { ShapeNode } from './board-shapes.jsx';
import RoutedEdge from './board-edge.jsx';
import { getRoutedPath } from './board-geometry.js';
import { layerValue, reorderLayers, effectiveLayerValues } from './board-layers.js';
import { syncRuntimeNodes, syncRuntimeEdges } from './board-runtime.js';
import '@xyflow/react/dist/style.css';
import './board.css';

const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const cloneGraph = (value) => JSON.parse(JSON.stringify({ nodes: value.nodes || [], edges: value.edges || [] }));
const graphSignature = (value) => JSON.stringify({ nodes: value.nodes || [], edges: value.edges || [] });
const editableTarget = (target) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"]'));
const MULTI_SELECT_KEYS = ['Meta', 'Control', 'Shift'];
const PAN_BUTTONS = [1, 2];
const FIT_OPTIONS = { padding: 0.18, maxZoom: 0.95 };
const FLOW_OPTIONS = { hideAttribution: true };
const CONNECTION_STYLE = { stroke: '#8b918e', strokeWidth: 1.7, strokeDasharray: '5 4' };
const minimapNodeColor = (node) => node.type === 'group' ? '#e9e9e2' : getCardColor(node.color).border;

export function isNoteConnection(connection, nodes) {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  return Boolean(source?.type === 'note' && source.noteId && target?.type === 'note' && target.noteId);
}

export function mergeDragGraph(baseline, local, incoming) {
  const baselineById = new Map(baseline.nodes.map((node) => [node.id, node]));
  const localById = new Map(local.nodes.map((node) => [node.id, node]));
  const samePosition = (a, b) => a?.x === b?.x && a?.y === b?.y;
  return {
    nodes: (incoming.nodes || []).map((node) => {
      const before = baselineById.get(node.id);
      const moved = localById.get(node.id);
      // Preserve only this drag's position changes. Newer external moves and
      // hierarchy changes win, while new/deleted cards follow the parent.
      const keepDrag = before && moved && node.parentId === before.parentId && moved.parentId === before.parentId && samePosition(node.position, before.position) && !samePosition(moved.position, before.position);
      return keepDrag ? { ...node, position: { ...moved.position } } : node;
    }),
    edges: incoming.edges || [],
  };
}

function IconButton({ label, children, active, className = '', ...props }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} className={`board-icon ${active ? 'is-active' : ''} ${className}`} {...props}>{children}</button>;
}

function ColorChoices({ value, onChange }) {
  return <div className="board-color-choices" role="group" aria-label="Card color options">
    {CARD_COLORS.map((color) => <button type="button" key={color.id} aria-label={`Use ${color.label} color`} aria-pressed={value === color.id} title={color.label} onClick={() => onChange(color.id)}>
      <span className="board-color-swatch" style={{ background: color.background, borderColor: color.border, color: color.accent }}>{value === color.id && <Check size={14}/>}</span>
      <span>{color.label}</span>
    </button>)}
  </div>;
}

function NoteNode({ data, selected }) {
  const note = data.note;
  const unavailable = !note || note.deleted;
  const color = getCardColor(data.color);
  return <article data-card-color={color.id} style={{ '--card-background': color.background, '--card-border': color.border, '--card-accent': color.accent }} className={`board-note ${selected ? 'is-selected' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
    <Handle type="target" position={Position.Left} isConnectable={!unavailable} aria-label="Connect to this note" />
    <div className="board-note-kind"><FileText size={12} /><span>NOTE</span><button type="button" className="board-card-color nodrag nopan" aria-label={`Change card color: ${note?.summary || 'Unavailable note'}`} title={`Card color: ${color.label}`} onClick={(event) => { event.stopPropagation(); data.onColor(data.nodeId); }}><Palette size={13}/></button></div>
    <p className="board-note-summary">{note?.summary || (unavailable ? 'Note unavailable' : 'Untitled note')}</p>
    <div className="board-note-tags">{(note?.tags || []).slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}{note?.tags?.length > 4 && <span>+{note.tags.length - 4}</span>}</div>
    <button type="button" className="board-open-note nodrag nopan" disabled={unavailable} onClick={(event) => { event.stopPropagation(); data.onOpen(note.id); }}>
      {unavailable ? 'Note is unavailable' : 'Open note'}<ArrowUpRight size={13} />
    </button>
    <Handle type="source" position={Position.Right} isConnectable={!unavailable} aria-label="Connect from this note" />
  </article>;
}

function GroupNode({ data, selected }) {
  return <div className={`board-group ${selected ? 'is-selected' : ''}`}>
    <div className="board-group-heading"><Folder size={14} /><span>{data.label || 'Untitled group'}</span><span className="board-group-count">{data.count}</span></div>
  </div>;
}

function AnnotationNode({ data, selected }) {
  return <div className={`board-annotation ${selected ? 'is-selected' : ''}`}>
    <div className="board-note-kind"><StickyNote size={12} /><span>ANNOTATION</span></div>
    <p>{data.label || 'Add a thought…'}</p>
  </div>;
}

// Positions are handled by React Flow's outer node wrapper. Card contents do
// not need to re-render for every pixel the wrapper moves.
const sameContents = (before, after) => before.data === after.data && before.selected === after.selected;
const nodeTypes = { note: memo(NoteNode, sameContents), group: memo(GroupNode, sameContents), annotation: memo(AnnotationNode, sameContents), shape: memo(ShapeNode, sameContents) };
const edgeTypes = { routed: RoutedEdge };

function absolutePosition(node, nodes, seen = new Set()) {
  if (!node || seen.has(node.id)) return { x: 0, y: 0 };
  seen.add(node.id);
  const parent = node.parentId && nodes.find((item) => item.id === node.parentId);
  const position = node.position || { x: 0, y: 0 };
  if (!parent) return { ...position };
  const base = absolutePosition(parent, nodes, seen);
  return { x: position.x + base.x, y: position.y + base.y };
}

function orderedNodes(nodes) {
  const result = [];
  const visited = new Set();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visit = (node) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (node.parentId && byId.has(node.parentId)) visit(byId.get(node.parentId));
    result.push(node);
  };
  nodes.forEach(visit);
  return result;
}

function BoardCanvas({ map, notes = [], onChange, onOpenNote, onNewNote, onSave, onPreview, onRename, onExit, notify = () => {} }) {
  const [board, setBoard] = useState(() => ({ ...map, nodes: map.nodes || [], edges: map.edges || [] }));
  const boardRef = useRef(board);
  const latestMapRef = useRef(map);
  const publishedRef = useRef(null);
  const historyRef = useRef({ past: [], future: [] });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selection, setSelection] = useState({ nodes: [], edges: [] });
  const selectionRef = useRef(selection);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState('layers');
  const [mode, setMode] = useState('select');
  const [zoom, setZoom] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [propertyText, setPropertyText] = useState('');
  const [editingEdge, setEditingEdge] = useState(null);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [shapePreview, setShapePreview] = useState(null);
  const drawRef = useRef(null);
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);
  const dragBaselineRef = useRef(null);
  const nodeProjectionCache = useRef(new Map());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const openNoteRef = useRef(onOpenNote);
  openNoteRef.current = onOpenNote;
  const openSourceNote = useCallback((id) => openNoteRef.current(id), []);
  const openCardColor = useCallback((id) => {
    setSelection({ nodes: [id], edges: [] });
    setColorOpen(true);
  }, []);
  const flow = useReactFlow();
  latestMapRef.current = map;
  selectionRef.current = selection;

  useEffect(() => {
    if (map === publishedRef.current) return;
    const incoming = { ...map, nodes: map.nodes || [], edges: map.edges || [] };
    if (draggingRef.current && dragBaselineRef.current) {
      const baseline = dragBaselineRef.current;
      const next = { ...incoming, ...mergeDragGraph(baseline, boardRef.current, incoming) };
      if (graphSignature(incoming) !== graphSignature(baseline)) {
        // Undo the drag first, then the independently added parent graph edit.
        historyRef.current.past.push(cloneGraph(incoming));
        historyRef.current.past = historyRef.current.past.slice(-60);
        historyRef.current.future = [];
        setHistoryVersion((value) => value + 1);
        dragBaselineRef.current = cloneGraph(incoming);
      }
      boardRef.current = next;
      setBoard(next);
      return;
    }
    const graphChanged = graphSignature(incoming) !== graphSignature(boardRef.current);
    if (graphChanged && !draggingRef.current) {
      // Parent-created notes are graph edits too, so they participate in Undo.
      historyRef.current.past.push(cloneGraph(boardRef.current));
      historyRef.current.past = historyRef.current.past.slice(-60);
      historyRef.current.future = [];
      setHistoryVersion((value) => value + 1);
    }
    if (!draggingRef.current) {
      boardRef.current = incoming;
      setBoard(incoming);
      setSelection((current) => ({
        nodes: current.nodes.filter((id) => incoming.nodes.some((node) => node.id === id)),
        edges: current.edges.filter((id) => incoming.edges.some((edge) => edge.id === id)),
      }));
    }
  }, [map]);

  const checkpoint = useCallback(() => {
    const snapshot = cloneGraph(boardRef.current);
    const history = historyRef.current;
    if (!history.past.length || graphSignature(history.past[history.past.length - 1]) !== graphSignature(snapshot)) history.past.push(snapshot);
    history.past = history.past.slice(-60);
    history.future = [];
    setHistoryVersion((value) => value + 1);
  }, []);

  const commit = useCallback((update, { record = true, publish = true } = {}) => {
    const current = boardRef.current;
    const patch = typeof update === 'function' ? update(current) : update;
    if (!patch) return;
    const next = {
      ...latestMapRef.current,
      nodes: current.nodes,
      edges: current.edges,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (record && graphSignature(current) !== graphSignature(next)) checkpoint();
    boardRef.current = next;
    // Native React Flow state already moves the object in this input event.
    // Keep the editor chrome and persisted graph out of the per-pixel loop.
    if (!draggingRef.current || publish) setBoard(next);
    if (publish) {
      publishedRef.current = next;
      onChangeRef.current(next);
    }
  }, [checkpoint]);

  const beginDrag = useCallback(() => {
    if (draggingRef.current) return;
    checkpoint();
    dragBaselineRef.current = cloneGraph(boardRef.current);
    draggingRef.current = true;
    setIsDragging(true);
    setColorOpen(false);
  }, [checkpoint]);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    dragBaselineRef.current = null;
    const past = historyRef.current.past;
    if (past.length && graphSignature(past[past.length - 1]) === graphSignature(boardRef.current)) {
      past.pop();
      setHistoryVersion((value) => value + 1);
    }
    commit({}, { record: false });
  }, [commit]);

  const resizeShape = useCallback((id, dimensions) => {
    const { x, y, width, height } = dimensions;
    commit((current) => ({ nodes: current.nodes.map((node) => node.id === id ? { ...node, position: { x, y }, style: { ...node.style, width, height } } : node) }), { record: !draggingRef.current, publish: !draggingRef.current });
  }, [commit]);
  const changeRoute = useCallback((id, route) => {
    commit((current) => ({ edges: current.edges.map((edge) => edge.id === id ? { ...edge, route } : edge) }), { record: !draggingRef.current, publish: !draggingRef.current });
    if (draggingRef.current) flow.setEdges((edges) => edges.map((edge) => edge.id === id ? { ...edge, route, data: { ...edge.data, route } } : edge));
  }, [commit, flow]);
  const editEdge = useCallback((id) => { setEditingEdge(id); if (id) setSelection({ nodes: [], edges: [id] }); }, []);
  const selectEdge = useCallback((id) => { setSelection({ nodes: [], edges: [id] }); setColorOpen(false); }, []);
  const changeEdgeLabel = useCallback((id, label) => {
    commit((current) => ({ edges: current.edges.map((edge) => edge.id === id ? { ...edge, label } : edge) }));
    setEditingEdge(null);
  }, [commit]);
  const changeLayer = (action) => commit((current) => reorderLayers(current, [...selectionRef.current.nodes, ...selectionRef.current.edges], action));
  const layerControls = <div className="board-layer-controls" role="group" aria-label="Arrange layers">
    <IconButton label="Bring to front" onClick={() => changeLayer('front')}><ChevronsUp size={16}/></IconButton>
    <IconButton label="Bring forward" onClick={() => changeLayer('forward')}><MoveUp size={16}/></IconButton>
    <IconButton label="Send backward" onClick={() => changeLayer('backward')}><MoveDown size={16}/></IconButton>
    <IconButton label="Send to back" onClick={() => changeLayer('back')}><ChevronsDown size={16}/></IconButton>
  </div>;

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (!history.past.length) return;
    history.future.push(cloneGraph(boardRef.current));
    const previous = history.past.pop();
    commit(previous, { record: false });
    setSelection({ nodes: [], edges: [] });
    setHistoryVersion((value) => value + 1);
  }, [commit]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (!history.future.length) return;
    history.past.push(cloneGraph(boardRef.current));
    const next = history.future.pop();
    commit(next, { record: false });
    setSelection({ nodes: [], edges: [] });
    setHistoryVersion((value) => value + 1);
  }, [commit]);

  const deleteSelection = useCallback(() => {
    const selected = selectionRef.current;
    if (!selected.nodes.length && !selected.edges.length) return;
    const nodeIds = new Set(selected.nodes);
    const edgeIds = new Set(selected.edges);
    const current = boardRef.current;
    commit({
      nodes: current.nodes.filter((node) => !nodeIds.has(node.id)).map((node) => {
        if (!node.parentId || !nodeIds.has(node.parentId)) return node;
        const next = { ...node, position: absolutePosition(node, current.nodes) };
        delete next.parentId;
        return next;
      }),
      edges: current.edges.filter((edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
    });
    setSelection({ nodes: [], edges: [] });
    notify(nodeIds.size ? 'Removed from this map. Your original notes are still in your library.' : 'Connection removed.');
  }, [commit, notify]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.isComposing || event.keyCode === 229 || editableTarget(event.target) || draggingRef.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectionRef.current.nodes.length || selectionRef.current.edges.length) { event.preventDefault(); deleteSelection(); }
      } else if (event.key === 'Escape') {
        setColorOpen(false);
        setShapesOpen(false); setShapePreview(null); drawRef.current = null; setMode('select'); setEditingEdge(null);
        setSelection({ nodes: [], edges: [] });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, deleteSelection]);

  const centerPosition = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return { x: position.x - 128, y: position.y - 85 };
  }, [flow]);

  const addNote = useCallback((noteId, position) => {
    const note = notes.find((item) => item.id === noteId && !item.deleted);
    if (!note) return;
    const existingCount = boardRef.current.nodes.filter((node) => node.noteId === noteId).length;
    const point = position || centerPosition();
    const node = { id: makeId('node'), type: 'note', noteId, position: { x: point.x + (position ? 0 : existingCount * 22), y: point.y + (position ? 0 : existingCount * 22) } };
    commit((current) => ({ nodes: [...current.nodes, node] }));
    setSelection({ nodes: [node.id], edges: [] });
    notify('Note added to your map.');
  }, [notes, centerPosition, commit, notify]);

  const onNodesChange = useCallback((changes) => {
    const selections = changes.filter((change) => change.type === 'select');
    if (selections.length) setSelection((current) => {
      const ids = new Set(current.nodes);
      selections.forEach((change) => { if (change.selected) ids.add(change.id); else ids.delete(change.id); });
      if (ids.size === current.nodes.length && current.nodes.every((id) => ids.has(id))) return current;
      return { ...current, nodes: [...ids] };
    });
    const positions = changes.filter((change) => change.type === 'position' && change.position);
    if (positions.length) {
      const byId = new Map(positions.map((change) => [change.id, change.position]));
      commit((current) => ({ nodes: current.nodes.map((node) => byId.has(node.id) ? { ...node, position: byId.get(node.id) } : node) }), { record: !draggingRef.current, publish: !draggingRef.current });
      // A second touch can cancel XYFlow's drag without a drag-stop callback.
      // Its terminal position change still arrives: flush it before leaving.
      if (draggingRef.current && positions.some((change) => change.dragging === false)) finishDrag();
    }
  }, [commit, finishDrag]);

  const onEdgesChange = useCallback((changes) => {
    const selections = changes.filter((change) => change.type === 'select');
    if (selections.length) setSelection((current) => {
      const ids = new Set(current.edges);
      selections.forEach((change) => { if (change.selected) ids.add(change.id); else ids.delete(change.id); });
      if (ids.size === current.edges.length && current.edges.every((id) => ids.has(id))) return current;
      return { ...current, edges: [...ids] };
    });
  }, []);

  const isValidConnection = useCallback((connection) => {
    if (!isNoteConnection(connection, boardRef.current.nodes)) return false;
    return [connection.source, connection.target].every((id) => {
      const node = boardRef.current.nodes.find((item) => item.id === id);
      return notes.some((note) => note.id === node.noteId && !note.deleted);
    });
  }, [notes]);

  const onConnect = useCallback((connection) => {
    if (!isValidConnection(connection)) return;
    const current = boardRef.current;
    if (current.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
      notify('These notes are already connected. Select the connection to edit its label.');
      return;
    }
    const edge = { id: makeId('edge'), source: connection.source, target: connection.target, label: 'relates to' };
    commit({ edges: [...current.edges, edge] });
    setSelection({ nodes: [], edges: [edge.id] });
    setPanelOpen(true); setPanelTab('properties');
  }, [commit, notify, isValidConnection]);

  const groupSelection = useCallback(() => {
    const current = boardRef.current;
    const ids = new Set(selectionRef.current.nodes);
    const roots = current.nodes.filter((node) => {
      if (!ids.has(node.id)) return false;
      let parentId = node.parentId;
      const seen = new Set();
      while (parentId && !seen.has(parentId)) {
        if (ids.has(parentId)) return false;
        seen.add(parentId);
        parentId = current.nodes.find((item) => item.id === parentId)?.parentId;
      }
      return true;
    });
    if (roots.length < 2) { notify('Select at least two separate cards to create a group. Hold Shift to select more.'); return; }
    const bounds = roots.map((node) => {
      const measured = flow.getNode(node.id)?.measured;
      return { ...absolutePosition(node, current.nodes), width: measured?.width || Number(node.style?.width) || 256, height: measured?.height || Number(node.style?.height) || 190 };
    });
    const x = Math.min(...bounds.map((item) => item.x)) - 28;
    const y = Math.min(...bounds.map((item) => item.y)) - 54;
    const width = Math.max(...bounds.map((item) => item.x + item.width)) - x + 28;
    const height = Math.max(...bounds.map((item) => item.y + item.height)) - y + 28;
    const group = { id: makeId('group'), type: 'group', data: { label: 'New group' }, position: { x, y }, style: { width, height } };
    const rootIds = new Set(roots.map((node) => node.id));
    const nodes = current.nodes.map((node) => {
      if (!rootIds.has(node.id)) return node;
      const point = absolutePosition(node, current.nodes);
      return { ...node, parentId: group.id, position: { x: point.x - x, y: point.y - y } };
    });
    commit({ nodes: [group, ...nodes] });
    setSelection({ nodes: [group.id], edges: [] });
    setPanelOpen(true); setPanelTab('properties');
  }, [commit, flow, notify]);

  const ungroup = useCallback((groupId) => {
    const current = boardRef.current;
    const group = current.nodes.find((node) => node.id === groupId);
    if (!group) return;
    const children = current.nodes.filter((node) => node.parentId === groupId).map((node) => node.id);
    const nodes = current.nodes.filter((node) => node.id !== groupId).map((node) => {
      if (node.parentId !== groupId) return node;
      const next = { ...node, position: absolutePosition(node, current.nodes) };
      delete next.parentId;
      return next;
    });
    commit({ nodes, edges: current.edges.filter((edge) => edge.source !== groupId && edge.target !== groupId) });
    setSelection({ nodes: children, edges: [] });
    notify('Group removed. All cards remain on the map.');
  }, [commit, notify]);

  const addAnnotation = useCallback(() => {
    const node = { id: makeId('annotation'), type: 'annotation', data: { label: 'A thought worth exploring…' }, position: centerPosition() };
    commit((current) => ({ nodes: [...current.nodes, node] }));
    setSelection({ nodes: [node.id], edges: [] });
    setPanelOpen(true); setPanelTab('properties');
  }, [commit, centerPosition]);

  const drawingShape = mode === 'rectangle' || mode === 'ellipse';
  const shapeStart = (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    drawRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, end: { x: event.clientX, y: event.clientY } };
    setShapePreview(null);
  };
  const shapeMove = (event) => {
    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;
    let dx = event.clientX - draw.start.x, dy = event.clientY - draw.start.y;
    if (event.shiftKey) { const side = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * side; dy = Math.sign(dy || 1) * side; }
    draw.end = { x: draw.start.x + dx, y: draw.start.y + dy };
    const rect = canvasRef.current.getBoundingClientRect();
    setShapePreview({ left: Math.min(draw.start.x, draw.end.x) - rect.left, top: Math.min(draw.start.y, draw.end.y) - rect.top, width: Math.abs(dx), height: Math.abs(dy) });
  };
  const shapeFinish = (event) => {
    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;
    drawRef.current = null;
    const start = flow.screenToFlowPosition(draw.start), end = flow.screenToFlowPosition(draw.end);
    const click = Math.hypot(draw.end.x - draw.start.x, draw.end.y - draw.start.y) < 4;
    const width = click ? 320 : Math.max(120, Math.abs(end.x - start.x));
    const height = click ? 220 : Math.max(90, Math.abs(end.y - start.y));
    const node = { id: makeId('shape'), type: 'shape', position: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) }, style: { width, height }, zIndex: Math.min(-10, ...boardRef.current.nodes.map(layerValue)) - 1, data: { shape: mode, label: mode === 'ellipse' ? 'An emerging idea' : 'A space for ideas', color: 'sage', strokeStyle: 'dashed' } };
    commit((current) => ({ nodes: [...current.nodes, node] }));
    setShapePreview(null); setMode('select'); setSelection({ nodes: [node.id], edges: [] }); setPanelOpen(true); setPanelTab('properties');
    notify('Region added.');
  };
  const updateShapeData = (patch) => commit((current) => ({ nodes: current.nodes.map((node) => selectionRef.current.nodes.includes(node.id) && node.type === 'shape' ? { ...node, data: { ...node.data, ...patch } } : node) }));

  const selectedNode = selection.nodes.length === 1 ? board.nodes.find((node) => node.id === selection.nodes[0]) : null;
  const selectedEdge = selection.edges.length === 1 && !selection.nodes.length ? board.edges.find((edge) => edge.id === selection.edges[0]) : null;
  const propertyId = selectedEdge?.id || selectedNode?.id;
  const propertyValue = selectedEdge?.label || selectedNode?.data?.label || '';
  useEffect(() => { setPropertyText(propertyValue); }, [propertyId, propertyValue]);
  const addBend = () => {
    if (!selectedEdge) return;
    const a = flow.getNode(selectedEdge.source), b = flow.getNode(selectedEdge.target);
    if (!a || !b) return;
    const pa = absolutePosition(a, board.nodes), pb = absolutePosition(b, board.nodes);
    const target = { x: pb.x, y: pb.y + (b.measured?.height || 174) / 2 };
    const { handles } = getRoutedPath({ sourceX: pa.x + (a.measured?.width || 256), sourceY: pa.y + (a.measured?.height || 174) / 2, targetX: target.x, targetY: target.y, route: selectedEdge.route });
    if (handles.length >= 16) { notify('Use up to 16 bends per connection.'); return; }
    const last = handles.at(-1);
    changeRoute(selectedEdge.id, [...handles, { x: (last.x + target.x) / 2, y: (last.y + target.y) / 2 - 60 }]);
  };

  const applyProperty = () => {
    const text = propertyText.trim();
    if (selectedEdge) {
      commit((current) => ({ edges: current.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, label: text } : edge) }));
    } else if (selectedNode && selectedNode.type !== 'note') {
      commit((current) => ({ nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, label: text || (node.type === 'group' ? 'Untitled group' : 'Add a thought…') } } : node) }));
    }
    notify('Changes applied.');
  };

  const selectLayerNode = (node) => {
    setSelection({ nodes: [node.id], edges: [] });
    flow.fitView({ nodes: [{ id: node.id }], padding: 0.7, maxZoom: 1.15, duration: 350 });
  };
  const selectLayerEdge = (edge) => {
    setSelection({ nodes: [], edges: [edge.id] });
    setPanelTab('properties');
    flow.fitView({ nodes: [{ id: edge.source }, { id: edge.target }], padding: 0.4, maxZoom: 1, duration: 350 });
  };

  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const availableNotes = useMemo(() => notes.filter((note) => !note.deleted), [notes]);
  const tags = useMemo(() => [...new Set(availableNotes.flatMap((note) => note.tags || []))].sort((a, b) => a.localeCompare(b)), [availableNotes]);
  const filteredNotes = useMemo(() => availableNotes.filter((note) => (!tag || note.tags?.includes(tag)) && `${note.summary || ''} ${note.body || ''} ${(note.tags || []).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [availableNotes, tag, search]);
  const nodeTitle = useCallback((node) => node.type === 'note' ? noteById.get(node.noteId)?.summary || 'Untitled note' : node.data?.label || (node.type === 'group' ? 'Untitled group' : node.type === 'shape' ? 'Region' : 'Annotation'), [noteById]);
  const effectiveLayers = useMemo(() => effectiveLayerValues(board.nodes, board.edges), [board.nodes, board.edges]);
  const flowNodes = useMemo(() => {
    const oldCache = nodeProjectionCache.current, nextCache = new Map();
    const children = new Map();
    board.nodes.forEach((node) => { if (node.parentId) children.set(node.parentId, (children.get(node.parentId) || 0) + 1); });
    const selectedIds = new Set(selection.nodes);
    const result = orderedNodes(board.nodes).map((node) => {
      const previous = oldCache.get(node.id), note = noteById.get(node.noteId), count = children.get(node.id) || 0;
      const selected = selectedIds.has(node.id);
      // Keep card data and every untouched node referentially stable. A move
      // changes the wrapper's position, not every card's rendered contents.
      const color = node.type === 'shape' ? node.data?.color : node.color;
      const data = previous && previous.source.data === node.data && previous.data.note === note && previous.data.count === count && previous.data.color === color
        ? previous.data : { ...node.data, nodeId: node.id, color, note, onOpen: openSourceNote, onColor: openCardColor, onResizeStart: beginDrag, onResize: resizeShape, onResizeEnd: finishDrag, count };
      const projected = previous && previous.source === node && previous.data === data && previous.projected.selected === selected && previous.projected.zIndex === effectiveLayers.get(node.id)
        ? previous.projected : {
          ...node, type: node.type || 'note', selected,
          zIndex: effectiveLayers.get(node.id),
          connectable: node.type === 'note' && Boolean(note && !note.deleted),
          style: node.type === 'group' ? { width: 600, height: 360, ...node.style } : { width: 256, ...node.style },
          ...(node.parentId ? { extent: 'parent' } : {}), data,
          ariaLabel: `${node.type === 'group' ? 'Group' : node.type === 'annotation' ? 'Annotation' : node.type === 'shape' ? 'Region' : 'Note'}: ${nodeTitle(node)}`,
        };
      nextCache.set(node.id, { source: node, data, projected });
      return projected;
    });
    nodeProjectionCache.current = nextCache;
    return result;
  }, [board.nodes, noteById, selection.nodes, nodeTitle, openSourceNote, openCardColor, beginDrag, resizeShape, finishDrag, effectiveLayers]);
  const flowEdges = useMemo(() => board.edges.map((edge) => ({
    ...edge,
    type: 'routed', zIndex: layerValue(edge),
    data: { route: edge.route, editing: editingEdge === edge.id, onRouteChange: changeRoute, onGestureStart: beginDrag, onGestureEnd: finishDrag, onEdit: editEdge, onLabelChange: changeEdgeLabel, onSelect: selectEdge },
    pathOptions: { curvature: 0.3 },
    selected: selection.edges.includes(edge.id),
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: selection.edges.includes(edge.id) ? '#505853' : '#a0a59f' },
    style: { stroke: selection.edges.includes(edge.id) ? '#58625c' : '#a0a59f', strokeWidth: selection.edges.includes(edge.id) ? 2 : 1.55 },
    labelStyle: { fill: '#70766f', fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: '#fbfbf9', fillOpacity: 0.94 },
    labelBgPadding: [8, 5], labelBgBorderRadius: 6, interactionWidth: 26,
    ariaLabel: `Connection: ${edge.label || 'Unlabeled'}`,
  })), [board.edges, selection.edges, editingEdge, changeRoute, beginDrag, finishDrag, editEdge, changeEdgeLabel, selectEdge]);
  const initialFlowNodes = useRef(flowNodes), initialFlowEdges = useRef(flowEdges);
  const projectionRef = useRef({ nodes: flowNodes, edges: flowEdges });
  projectionRef.current = { nodes: flowNodes, edges: flowEdges };
  useEffect(() => {
    flow.setNodes((current) => syncRuntimeNodes(projectionRef.current.nodes, current, boardRef.current.nodes));
  }, [flowNodes, flow]);
  useEffect(() => {
    flow.setEdges((current) => syncRuntimeEdges(projectionRef.current.edges, current, boardRef.current.edges));
  }, [flowEdges, flow]);
  const selectedCards = board.nodes.filter((node) => node.type === 'note' && selection.nodes.includes(node.id));
  const selectedColors = new Set(selectedCards.map((node) => getCardColor(node.color).id));
  const applyCardColor = useCallback((color) => {
    const ids = new Set(selectionRef.current.nodes);
    const current = boardRef.current;
    if (current.nodes.some((node) => ids.has(node.id) && node.type === 'note' && getCardColor(node.color).id !== color)) {
      commit({ nodes: current.nodes.map((node) => ids.has(node.id) && node.type === 'note' ? { ...node, color } : node) });
    }
    setColorOpen(false);
  }, [commit]);
  const onNodeClick = useCallback((_event, node) => { setEditingEdge(null); if (node.type === 'group' || node.type === 'annotation' || node.type === 'shape') { setPanelOpen(true); setPanelTab('properties'); } }, []);
  const onNodeDoubleClick = useCallback((_event, node) => { if (node.type === 'note' && noteById.get(node.noteId) && !noteById.get(node.noteId).deleted) openSourceNote(node.noteId); }, [noteById, openSourceNote]);
  const onEdgeClick = useCallback((event, edge) => { event.stopPropagation(); selectEdge(edge.id); }, [selectEdge]);
  const onEdgeDoubleClick = useCallback((event, edge) => { event.stopPropagation(); editEdge(edge.id); }, [editEdge]);
  const onPaneClick = useCallback(() => { setSelection({ nodes: [], edges: [] }); setColorOpen(false); setShapesOpen(false); setEditingEdge(null); }, []);
  const onMove = useCallback((_event, viewport) => setZoom(Math.round(viewport.zoom * 100) / 100), []);
  const onDragOver = useCallback((event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true); }, []);
  const onDragLeave = useCallback((event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }, []);
  const onDrop = useCallback((event) => {
    event.preventDefault(); setDragOver(false);
    const id = event.dataTransfer.getData('application/x-socrates-note');
    if (id) { const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); addNote(id, { x: point.x - 128, y: point.y - 30 }); }
  }, [flow, addNote]);
  const canDelete = Boolean(selection.nodes.length || selection.edges.length);
  const noteCount = board.nodes.filter((node) => node.type === 'note').length;
  const savedSourcesMatch = !isDragging && (!Array.isArray(map.saved?.notes) || map.saved.notes.every((savedNote) => {
    const note = noteById.get(savedNote.id);
    return note && !note.deleted && note.summary === savedNote.summary && note.body === savedNote.body && JSON.stringify(note.tags) === JSON.stringify(savedNote.tags);
  }));
  const isSaved = !isDragging && (map.saved === true || Boolean(map.saved && savedSourcesMatch && graphSignature(map.saved) === graphSignature(board) && map.saved.name === map.name && map.saved.summary === map.summary && map.saved.description === map.description));
  void historyVersion;

  return <section className={`board-root ${isDragging ? 'is-dragging' : ''}`} aria-label={`${map.name || 'Untitled map'} whiteboard`}>
    <header className="board-header">
      <div className="board-header-left">
        <IconButton label="Back to mind maps" onClick={onExit}><ArrowLeft size={18} /></IconButton>
        <div className="board-title-block"><button type="button" className="board-title-button" onClick={onRename} title="Rename map"><h1>{map.name || 'Untitled map'}</h1><Pencil size={13} /></button></div>
      </div>
      <div className="board-header-actions">
        <span className={`board-save-state ${isSaved ? 'is-saved' : ''}`}>{isSaved ? <Check size={13} /> : <Circle size={6} fill="currentColor" />}{isSaved ? 'Saved' : 'Unsaved changes'}</span>
        <button type="button" className="board-button board-preview" onClick={onPreview}><Eye size={15} />Preview</button>
        <button type="button" className="board-button" onClick={onSave}><Save size={14} /><span>Save</span></button>
        <button type="button" className="board-button board-button-dark" onClick={() => onNewNote(centerPosition())}><Plus size={16} /><span>New insight</span></button>
      </div>
    </header>

    <div className="board-subheader">
      <div className="board-subheader-left"><IconButton label={libraryOpen ? 'Hide note library' : 'Show note library'} active={libraryOpen} onClick={() => setLibraryOpen((value) => !value)}>{libraryOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</IconButton></div>
      <div className="board-subheader-right"><span className="board-map-count">{noteCount} {noteCount === 1 ? 'note' : 'notes'}<span>·</span>{board.edges.length} connections</span><button type="button" className={`board-layers-toggle ${panelOpen ? 'is-active' : ''}`} aria-pressed={panelOpen} onClick={() => { setPanelOpen((value) => !value); setPanelTab('layers'); }}><Layers size={15} />Layers</button><BoardHelp /></div>
    </div>

    <div className="board-workspace">
      {libraryOpen && <aside className="board-library" aria-label="Note library">
        <div className="board-library-heading"><h2>Your notes</h2><span>{availableNotes.length}</span></div>
        <label className="board-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a note…" aria-label="Search note library" />{search && <IconButton label="Clear note search" onClick={() => setSearch('')}><X size={12} /></IconButton>}</label>
        <div className="board-library-filters"><span>{filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}</span><select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter notes by tag"><option value="">All tags</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        <div className="board-library-list">
          {filteredNotes.map((note) => {
            const used = board.nodes.some((node) => node.noteId === note.id);
            return <article className="board-library-card" key={note.id} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-socrates-note', note.id); event.dataTransfer.effectAllowed = 'copy'; }}>
              <div className="board-library-card-top"><span><FileText size={12} />NOTE</span>{used && <span className="board-on-map"><Check size={10} />On map</span>}<GripVertical size={13} className="board-library-grip" /></div>
              <p>{note.summary || 'Untitled note'}</p>
              <div className="board-library-card-bottom"><div className="board-library-tags">{(note.tags || []).slice(0, 2).map((item) => <span key={item}>{item}</span>)}</div><IconButton label={`Add ${note.summary || 'note'} to map`} onClick={() => addNote(note.id)}><Plus size={14} /></IconButton></div>
            </article>;
          })}
          {!filteredNotes.length && <div className="board-library-empty"><Search size={22} /><strong>{availableNotes.length ? 'No notes found' : 'No notes'}</strong><p>{availableNotes.length ? 'Try another word or tag.' : 'Create a note to add it to this board.'}</p>{!availableNotes.length && <button type="button" className="board-button" onClick={() => onNewNote(centerPosition())}><Plus size={14} />New insight</button>}</div>}
        </div>
      </aside>}

      <div className={`board-canvas ${dragOver ? 'is-drop-target' : ''}`} ref={canvasRef}>
        <ReactFlow
          defaultNodes={initialFlowNodes.current} defaultEdges={initialFlowEdges.current} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection}
          onNodeDragStart={beginDrag} onNodeDragStop={finishDrag}
          onSelectionDragStart={beginDrag} onSelectionDragStop={finishDrag}
          onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick} onEdgeDoubleClick={onEdgeDoubleClick} onPaneClick={onPaneClick} onMove={onMove}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          fitView fitViewOptions={FIT_OPTIONS}
          minZoom={0.15} maxZoom={2} deleteKeyCode={null}
          selectionOnDrag={mode === 'select'} selectionMode={SelectionMode.Partial}
          panOnDrag={mode === 'pan' ? true : PAN_BUTTONS}
          selectionKeyCode="Shift" multiSelectionKeyCode={MULTI_SELECT_KEYS}
          panOnScroll zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false}
          connectionLineType={ConnectionLineType.Bezier} connectionLineStyle={CONNECTION_STYLE}
          nodeDragThreshold={2} connectionDragThreshold={2} connectionRadius={34} autoPanSpeed={8}
          zIndexMode="manual" elevateNodesOnSelect={false} elevateEdgesOnSelect={false}
          proOptions={FLOW_OPTIONS}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.15} color="#d9d9d2" />
          <MiniMap pannable zoomable position="bottom-right" className="board-minimap" nodeColor={minimapNodeColor} nodeStrokeColor="#b9b9b0" maskColor="rgba(244,244,239,0.65)" ariaLabel="Map overview. Drag to pan and scroll to zoom." />
        </ReactFlow>

        {drawingShape && <div className="board-shape-draw-surface" aria-label={`Draw ${mode} region`} onPointerDown={shapeStart} onPointerMove={shapeMove} onPointerUp={shapeFinish} onPointerCancel={() => { drawRef.current = null; setShapePreview(null); }}>
          {shapePreview && <div className={`board-shape-preview ${mode}`} style={shapePreview}/>}
          <div className="board-draw-instruction">Drag to draw · Shift: square/circle · Esc: cancel</div>
        </div>}
        {selectedEdge && !editingEdge && <div className="board-edge-actions" role="toolbar" aria-label="Connection tools"><span><Link2 size={13}/>Connection</span><button type="button" onClick={() => editEdge(selectedEdge.id)}>Edit text</button><button type="button" onClick={() => { setPanelOpen(true); setPanelTab('properties'); }}>Properties</button></div>}

        {!board.nodes.length && <div className="board-empty"><h2>No cards</h2><p>Add a note from the library or create an insight.</p><button type="button" className="board-button board-button-dark" onClick={() => onNewNote(centerPosition())}><Plus size={15} />New insight</button></div>}
        {dragOver && <div className="board-drop-hint"><Plus size={16} />Drop to add a note</div>}

        <div className="board-toolbar" role="toolbar" aria-label="Whiteboard tools">
          <IconButton label="Select cards" active={mode === 'select'} onClick={() => setMode('select')}><MousePointer2 size={18} /></IconButton>
          <IconButton label="Pan canvas" active={mode === 'pan'} onClick={() => setMode('pan')}><Hand size={18} /></IconButton>
          <span className="board-toolbar-divider" />
          <IconButton label="Group selected cards" disabled={selection.nodes.length < 2} onClick={groupSelection}><Frame size={18} /></IconButton>
          <IconButton label="Add annotation" onClick={addAnnotation}><StickyNote size={18} /></IconButton>
          <div className="board-shapes-control">
            <IconButton label="Draw a shape" active={shapesOpen || drawingShape} aria-expanded={shapesOpen} onClick={() => { setShapesOpen((open) => !open); setColorOpen(false); }}><Shapes size={18}/></IconButton>
            {shapesOpen && <div className="board-shapes-menu" role="group" aria-label="Shape tools"><span>Shapes</span><button type="button" title="Drag to draw; hold Shift for a square" onClick={() => { setMode('rectangle'); setShapesOpen(false); setSelection({ nodes: [], edges: [] }); }}><Square size={17}/><span>Rectangle</span></button><button type="button" title="Drag to draw; hold Shift for a circle" onClick={() => { setMode('ellipse'); setShapesOpen(false); setSelection({ nodes: [], edges: [] }); }}><Circle size={17}/><span>Ellipse</span></button></div>}
          </div>
          <div className="board-color-control">
            <IconButton label={selectedCards.length ? 'Card color' : 'Select a note card to change its color'} disabled={!selectedCards.length} active={colorOpen && selectedCards.length > 0} aria-expanded={colorOpen && selectedCards.length > 0} onClick={() => setColorOpen((value) => !value)}><Palette size={18}/></IconButton>
            {colorOpen && selectedCards.length > 0 && <div className="board-color-popover" role="group" aria-label="Change card colors" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setColorOpen(false); } }}>
              <div className="board-color-heading"><strong>Card color</strong><IconButton label="Close color palette" onClick={() => setColorOpen(false)}><X size={14}/></IconButton></div>
              {selectedCards.length > 1 && <p>{selectedCards.length} cards{selectedColors.size > 1 ? ' · Mixed colors' : ''}</p>}
              <ColorChoices value={selectedColors.size === 1 ? [...selectedColors][0] : null} onChange={applyCardColor}/>
            </div>}
          </div>
          <IconButton label="Remove selection from map" disabled={!canDelete} onClick={deleteSelection}><Trash2 size={17} /></IconButton>
          <span className="board-toolbar-divider" />
          <IconButton label="Undo" disabled={!historyRef.current.past.length} onClick={undo}><Undo2 size={18} /></IconButton>
          <IconButton label="Redo" disabled={!historyRef.current.future.length} onClick={redo}><Redo2 size={18} /></IconButton>
        </div>
        <div className="board-zoom-controls" role="toolbar" aria-label="Canvas zoom">
          <IconButton label="Zoom out" onClick={() => flow.zoomOut({ duration: 180 })}><Minus size={15} /></IconButton>
          <button type="button" className="board-zoom-value" title="Reset zoom to 100 percent" aria-label="Reset zoom to 100 percent" onClick={() => flow.zoomTo(1, { duration: 250 })}>{Math.round(zoom * 100)}%</button>
          <IconButton label="Zoom in" onClick={() => flow.zoomIn({ duration: 180 })}><Plus size={15} /></IconButton>
          <span className="board-toolbar-divider" />
          <IconButton label="Fit all cards in view" onClick={() => flow.fitView({ padding: 0.2, maxZoom: 1, duration: 350 })}><Maximize size={15} /></IconButton>
        </div>
      </div>

      {panelOpen && <aside className="board-right-panel" aria-label="Map layers and properties">
        <div className="board-panel-heading"><div className="board-panel-tabs"><button type="button" className={panelTab === 'layers' ? 'is-active' : ''} onClick={() => setPanelTab('layers')}>Layers</button><button type="button" className={panelTab === 'properties' ? 'is-active' : ''} onClick={() => setPanelTab('properties')}>Properties</button></div><IconButton label="Close layers panel" onClick={() => setPanelOpen(false)}><X size={15} /></IconButton></div>
        <div className="board-panel-content">
          {canDelete && <div className="board-arrange"><span>ARRANGE LAYER</span>{layerControls}</div>}
          {panelTab === 'layers' ? <>
            <div className="board-layer-heading">CARDS & REGIONS<span>{board.nodes.length}</span></div>
            {[...board.nodes].sort((a, b) => effectiveLayers.get(b.id) - effectiveLayers.get(a.id)).map((node) => <button type="button" className={`board-layer-row ${selection.nodes.includes(node.id) ? 'is-active' : ''} ${node.parentId ? 'is-child' : ''}`} key={node.id} onClick={() => selectLayerNode(node)} title={nodeTitle(node)}>{node.type === 'group' ? <Folder size={14}/> : node.type === 'annotation' ? <StickyNote size={14}/> : node.type === 'shape' ? <Shapes size={14}/> : <FileText size={14}/>}<span>{nodeTitle(node)}</span></button>)}
            {!board.nodes.length && <p className="board-panel-muted">No objects</p>}
            <div className="board-layer-heading board-connections-heading">CONNECTIONS<span>{board.edges.length}</span></div>
            {[...board.edges].sort((a, b) => layerValue(b) - layerValue(a)).map((edge) => <button type="button" className={`board-layer-row board-layer-edge ${selection.edges.includes(edge.id) ? 'is-active' : ''}`} key={edge.id} onClick={() => selectLayerEdge(edge)}><Link2 size={14}/><span><b>{edge.label || 'Unlabeled connection'}</b><small>{nodeTitle(board.nodes.find((node) => node.id === edge.source) || {})} → {nodeTitle(board.nodes.find((node) => node.id === edge.target) || {})}</small></span></button>)}
            {!board.edges.length && <p className="board-panel-muted">No connections</p>}
          </> : selectedEdge ? <div className="board-properties">
            <div className="board-property-kind"><Link2 size={17}/>Connection</div>
            <label htmlFor="board-property-text">Relationship</label>
            <form onSubmit={(event) => { event.preventDefault(); applyProperty(); }}><input id="board-property-text" aria-label="Connection relationship label" value={propertyText} onChange={(event) => setPropertyText(event.target.value)} placeholder="e.g. builds on, challenges…" maxLength={240}/><button type="submit" className="board-button board-button-dark board-property-apply"><Check size={14}/>Apply label</button></form>
            <div className="board-routing-actions"><button type="button" className="board-button" onClick={addBend}><Plus size={14}/>Add bend</button><button type="button" className="board-button" disabled={!selectedEdge.route?.length} onClick={() => changeRoute(selectedEdge.id, [])}><RotateCcw size={14}/>Reset curve</button></div>
            <div className="board-connection-endpoints"><span>FROM</span><p>{nodeTitle(board.nodes.find((node) => node.id === selectedEdge.source) || {})}</p><span>TO</span><p>{nodeTitle(board.nodes.find((node) => node.id === selectedEdge.target) || {})}</p></div>
            <button type="button" className="board-remove-button" onClick={deleteSelection}><Trash2 size={14}/>Remove connection</button>
          </div> : selectedNode ? <div className="board-properties">
            <div className="board-property-kind">{selectedNode.type === 'group' ? <Folder size={17}/> : selectedNode.type === 'annotation' ? <StickyNote size={17}/> : selectedNode.type === 'shape' ? <Shapes size={17}/> : <FileText size={17}/>}{{group:'Group',annotation:'Annotation',shape:'Region',note:'Linked note'}[selectedNode.type]}</div>
            {selectedNode.type === 'note' ? <>
              <h3>{nodeTitle(selectedNode)}</h3>
              <div className="board-property-colors"><span>Card color</span><ColorChoices value={getCardColor(selectedNode.color).id} onChange={applyCardColor}/></div>
              <button type="button" className="board-button board-button-dark" disabled={!noteById.get(selectedNode.noteId) || noteById.get(selectedNode.noteId)?.deleted} onClick={() => onOpenNote(selectedNode.noteId)}>Open note<ArrowUpRight size={14}/></button>
            </> : <>
              <label htmlFor="board-property-text">{selectedNode.type === 'group' ? 'Group name' : selectedNode.type === 'shape' ? 'Region label' : 'Annotation text'}</label>
              <form onSubmit={(event) => { event.preventDefault(); applyProperty(); }}>{selectedNode.type === 'annotation' ? <textarea id="board-property-text" aria-label="Annotation text" rows={6} value={propertyText} onChange={(event) => setPropertyText(event.target.value)}/> : <input id="board-property-text" aria-label={selectedNode.type === 'shape' ? 'Region label' : 'Group name'} value={propertyText} onChange={(event) => setPropertyText(event.target.value)}/>}<button type="submit" className="board-button board-button-dark board-property-apply"><Check size={14}/>Apply changes</button></form>
              {selectedNode.type === 'shape' && <div className="board-region-properties">
                <label htmlFor="board-region-shape">Shape</label><select id="board-region-shape" value={selectedNode.data?.shape || 'rectangle'} onChange={(event) => updateShapeData({ shape: event.target.value })}><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select>
                <span>Outline</span><div className="board-outline-options" role="group" aria-label="Region outline">{['solid','dashed'].map((stroke) => <button type="button" key={stroke} aria-pressed={selectedNode.data?.strokeStyle === stroke} onClick={() => updateShapeData({ strokeStyle: stroke })}><i style={{ borderTopStyle: stroke }}/>{stroke === 'solid' ? 'Solid' : 'Dashed'}</button>)}</div>
                <span>Region color</span><ColorChoices value={getCardColor(selectedNode.data?.color).id} onChange={(color) => updateShapeData({ color })}/>
              </div>}
              {selectedNode.type === 'group' && <button type="button" className="board-button board-ungroup-button" onClick={() => ungroup(selectedNode.id)}><Ungroup size={15}/>Ungroup cards</button>}
            </>}
            <button type="button" className="board-remove-button" onClick={deleteSelection}><Trash2 size={14}/>Remove from map</button>
          </div> : <div className="board-property-empty"><MousePointer2 size={25} strokeWidth={1.2}/><h3>{selection.nodes.length > 1 ? `${selection.nodes.length} objects selected` : 'Select an object'}</h3>{selectedCards.length > 0 && <div className="board-property-colors"><span>Card color · {selectedCards.length} cards{selectedColors.size > 1 ? ' · Mixed colors' : ''}</span><ColorChoices value={selectedColors.size === 1 ? [...selectedColors][0] : null} onChange={applyCardColor}/></div>}{selection.nodes.length > 1 && <><button type="button" className="board-button" onClick={groupSelection}><Frame size={15}/>Group cards</button><button type="button" className="board-remove-button" onClick={deleteSelection}><Trash2 size={14}/>Remove selection</button></>}</div>}
        </div>
      </aside>}
    </div>
  </section>;
}

export default function Board(props) {
  return <ReactFlowProvider key={props.map.id}><BoardCanvas {...props} /></ReactFlowProvider>;
}
