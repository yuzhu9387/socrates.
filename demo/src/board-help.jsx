import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './board-help.css';

const HELP_ROWS = [
  ['Move', 'Drag an object. Shift-click to select more.'],
  ['Connect', 'Drag between card handles.'],
  ['Edit connections', 'Drag bend points. Double-click a line to edit text.'],
  ['Shapes', 'Drag to draw. Hold Shift for a square or circle.'],
  ['Arrange', 'Use Layers to select covered objects and change their order.'],
];

export default function BoardHelp() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return <div className="board-help" ref={rootRef}>
    <button
      type="button"
      className={`board-help-trigger ${open ? 'is-active' : ''}`}
      aria-label="Whiteboard help"
      aria-expanded={open}
      aria-controls={panelId}
      ref={triggerRef}
      onClick={() => setOpen((value) => !value)}
    >Help</button>
    {open && <div className="board-help-panel" id={panelId} role="dialog" aria-label="Whiteboard controls">
      <div className="board-help-heading">
        <strong>Whiteboard controls</strong>
        <button type="button" className="board-help-close" aria-label="Close whiteboard help" onClick={closeAndRestoreFocus}><X size={14} /></button>
      </div>
      <dl>
        {HELP_ROWS.map(([term, description]) => <div className="board-help-row" key={term}><dt>{term}</dt><dd>{description}</dd></div>)}
      </dl>
    </div>}
  </div>;
}
