import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp, Moon, Settings, Sun } from 'lucide-react';

export default function ProfileMenu({ email, theme, onSettings, onToggleTheme }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const key = (event) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return <div className="profile-menu" ref={root}>
    <button ref={trigger} className="account-trigger" aria-label="Account menu" aria-expanded={open} aria-controls="account-options" onClick={() => setOpen((value) => !value)}>
      <span className="avatar">{email?.[0]?.toUpperCase() || 'G'}</span>
      <span className="account-name" title={email || 'My account'}>{email || 'My account'}</span>
      <ChevronUp size={14} className={open ? 'is-open' : ''} />
    </button>
    {open && <div id="account-options" className="account-popover" role="group" aria-label="Account options">
      <button onClick={() => { setOpen(false); onSettings(); }}><Settings size={16} />Settings</button>
      <button onClick={onToggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? 'Use light theme' : 'Use dark theme'}</button>
    </div>}
  </div>;
}
