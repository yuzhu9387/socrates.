import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, KeyRound, LogOut, Moon, PenLine, Plus, Sun, Trash2, Upload, X } from 'lucide-react';
import { STORAGE_KEY } from './model.js';
import './app-settings.css';

const fmt = (value) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Never';
const activityLabels = {
  'workspace.commit': 'Workspace updated',
  'workspace.import': 'Workspace imported',
  'workspace.replace': 'Workspace replaced',
  'preferences.update': 'Settings updated',
  'note.create': 'Note created',
  'note.update': 'Note updated',
  'note.tags': 'Note tags changed',
  'note.trash': 'Note moved to Trash',
  'tag.create': 'Tag created',
  'tag.rename': 'Tag renamed',
  'tag.delete': 'Tag deleted',
  'map.create': 'Map created',
  'map.update': 'Map updated',
  'map.trash': 'Map moved to Trash',
  'map.tags': 'Map tags changed',
  'map.note_order': 'Map note order changed',
  'revision.create': 'Map version saved',
  'revision.label': 'Version label changed',
  'revision.restore': 'Version restored',
  'revision.delete': 'Version deleted',
  'connection.create': 'Connection created',
  'connection.rename': 'Connection renamed',
  'connection.revoke': 'Connection revoked',
};
const activityLabel = (action = '') => activityLabels[action] || action.split(/[._]/).filter(Boolean).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ') || 'Workspace activity';
const sourceLabel = (source = '') => ({ ui: 'Socrates', api: 'API', mcp: 'AI tool' })[source.toLowerCase()] || 'External tool';
const objectLabel = (type = '') => type ? type[0].toUpperCase() + type.slice(1) : '';

function browserWorkspace() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value?.version === 1 && Array.isArray(value.notes) && Array.isArray(value.maps) ? value : null;
  } catch {
    return null;
  }
}

export default function AppSettings({ data, setData, app, notify, confirm, onDownload, onImport }) {
  const [connections, setConnections] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [moreConnections, setMoreConnections] = useState(false);
  const [loadingMore, setLoadingMore] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['read']);
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);
  const empty = data.notes.length === 0 && data.maps.length === 0;

  const load = async () => {
    try {
      const [connectionResult, activityResult] = await Promise.all([app.api.getConnections(), app.api.getActivity({ limit: 50, offset: 0 })]);
      setConnections(connectionResult.items || []);
      setMoreConnections((connectionResult.items || []).length === connectionResult.limit);
      setActivity(activityResult.items || []);
      setActivityTotal(activityResult.total || 0);
    } catch (error) {
      notify(error.message || 'Could not load account settings');
    }
  };
  useEffect(() => { load(); }, []);

  const loadMore = async (collection) => {
    if (loadingMore) return;
    setLoadingMore(collection);
    try {
      if (collection === 'tokens') {
        const result = await app.api.getConnections({ offset: connections.length });
        setConnections((current) => [...current, ...result.items.filter((item) => !current.some((old) => old.id === item.id))]);
        setMoreConnections(result.items.length === result.limit);
      } else {
        const result = await app.api.getActivity({ offset: activity.length });
        setActivity((current) => [...current, ...result.items.filter((item) => !current.some((old) => old.id === item.id))]);
        setActivityTotal(result.total);
      }
    } catch (error) { notify(error.message || 'Could not load more entries'); }
    finally { setLoadingMore(''); }
  };

  const copyToken = async () => {
    try { await navigator.clipboard.writeText(token); notify('Token copied'); }
    catch { notify('Select the token and copy it with your keyboard.'); }
  };
  const signOut = () => {
    const leave = async () => { try { await app.logout(); } catch (error) { notify(error.message || 'Could not sign out'); } };
    if (app.status === 'Saved') leave();
    else confirm('Sign out with pending changes?', 'Download local changes before leaving if you need a separate copy.', leave, 'Sign out');
  };

  const toggleScope = (scope) => setScopes((current) => {
    if (scope === 'read') return current;
    if (scope === 'write') return current.includes('write') ? current.filter((item) => item !== 'write' && item !== 'purge') : [...new Set([...current, 'read', 'write'])];
    return current.includes('purge') ? current.filter((item) => item !== 'purge') : [...new Set([...current, 'read', 'write', 'purge'])];
  });
  const createConnection = async (event) => {
    event.preventDefault();
    if (!name.trim() || !scopes.length) return;
    setBusy(true);
    try {
      const result = await app.api.createConnection({ name: name.trim(), scopes });
      setConnections((current) => [result.connection, ...current]);
      setToken(result.token);
      setName('');
      setScopes(['read']);
    } catch (error) {
      notify(error.message || 'Could not create token');
    } finally {
      setBusy(false);
    }
  };
  const saveName = async (id) => {
    try {
      const result = await app.api.renameConnection(id, editingName.trim());
      setConnections((current) => current.map((item) => item.id === id ? result.connection : item));
      setEditing(null);
    } catch (error) { notify(error.message); }
  };
  const revoke = (connection) => confirm('Revoke API token?', `${connection.name} will immediately lose access.`, async () => {
    try {
      await app.api.revokeConnection(connection.id);
      setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, revokedAt: new Date().toISOString() } : item));
      notify('API token revoked');
    } catch (error) { notify(error.message); }
  }, 'Revoke token');
  const removeActivity = async (id) => {
    try { await app.api.deleteActivity(id); setActivity((current) => current.filter((item) => item.id !== id)); setActivityTotal((total) => Math.max(0, total - 1)); }
    catch (error) { notify(error.message); }
  };
  const clearActivity = () => confirm('Clear activity?', 'This removes the visible activity history for this account.', async () => {
    try { await app.api.clearActivity(); setActivity([]); setActivityTotal(0); notify('Activity cleared'); }
    catch (error) { notify(error.message); }
  }, 'Clear activity');
  const importBrowser = () => {
    const old = browserWorkspace();
    if (!old) { notify('No browser demo workspace found'); return; }
    const apply = async () => {
      try {
        await app.importWorkspace(old, empty ? 'import' : 'replace');
        notify('Browser workspace imported');
      } catch (error) {
        notify(error.message || 'Could not import the browser workspace');
      }
    };
    if (empty) apply();
    else confirm('Replace this workspace?', 'This replaces the notes and maps in this account with your browser demo data. Download a backup first if needed.', apply, 'Replace workspace');
  };

  return <div className="page utility-page app-settings">
    <div className="page-heading"><div><h1>Settings</h1></div></div>
    <section className="settings-section"><div className="app-settings-heading"><h2>Appearance</h2></div><div className="setting-row"><div><strong>Color theme</strong></div><div className="segmented">{[['light', Sun], ['dark', Moon]].map(([value, Icon]) => <button key={value} className={data.theme === value ? 'active' : ''} onClick={() => setData((current) => ({ ...current, theme: value }))}><Icon size={15} />{value === 'light' ? 'Light' : 'Dark'}</button>)}</div></div><div className="setting-row"><div><strong>Graph animation</strong></div><button role="switch" aria-checked={data.motion !== false} aria-label="Graph animation" className={`switch ${data.motion !== false ? 'on' : ''}`} onClick={() => setData((current) => ({ ...current, motion: !(current.motion !== false) }))}><span /></button></div></section>

    <section className="settings-section"><div className="app-settings-heading"><h2>Your data</h2></div><div className="setting-actions app-settings-actions"><button className="btn" onClick={onImport}><Upload size={16} />Import file</button><button className="btn" onClick={onDownload}><Download size={16} />Download backup</button></div>{browserWorkspace() && <details className="app-settings-disclosure app-legacy-import"><summary>Import demo data</summary><div className="app-settings-disclosure-body"><p>Move data saved by the browser demo into this account.</p><button className="btn" onClick={importBrowser}><Upload size={15} />{empty ? 'Import demo data' : 'Replace with demo data'}</button></div></details>}</section>

    <section className="settings-section"><div className="app-settings-heading"><h2>Account</h2></div><div className="setting-row"><strong>{app.user.email}</strong><button className="btn" onClick={signOut}><LogOut size={15} />Sign out</button></div></section>

    <section className="settings-section"><div className="app-settings-heading"><div><h2>AI &amp; integrations</h2><p>Let external tools and AI access your notes with a scoped connection.</p></div></div><details className="app-settings-disclosure app-connections"><summary>Manage connections <span>{connections.filter((connection) => !connection.revokedAt).length} active</span></summary><div className="app-settings-disclosure-content"><form className="app-token-form" onSubmit={createConnection}><div className="app-token-name-field"><label htmlFor="app-token-name">Token name</label><input id="app-token-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="My integration" required /></div><fieldset><legend>Scopes</legend>{['read', 'write', 'purge'].map((scope) => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} disabled={scope === 'read'} onChange={() => toggleScope(scope)} />{scope}</label>)}</fieldset><button className="btn btn-primary" disabled={busy || !scopes.length}><Plus size={15} />Create token</button></form>
        {token && <div className="app-token-once" role="status"><div><strong>Copy this token now</strong><p>It will not be shown again.</p></div><code tabIndex={0}>{token}</code><button className="btn" onClick={copyToken}><Copy size={14} />Copy</button><button className="btn-icon" aria-label="Hide new token" onClick={() => setToken('')}><X size={14} /></button></div>}
        <div className="app-management-list app-token-list">{connections.map((connection) => <div className="app-management-row" key={connection.id}>
          <KeyRound size={16} /><div>{editing === connection.id ? <input aria-label={`Rename ${connection.name}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} /> : <strong>{connection.name}</strong>}<small>{connection.revokedAt ? `Revoked ${fmt(connection.revokedAt)}` : (connection.scopes || []).join(', ')} · Created {fmt(connection.createdAt)} · Last used {fmt(connection.lastUsedAt)}</small></div>
          {!connection.revokedAt && <>{editing === connection.id ? <><button className="btn-icon" aria-label={`Save ${connection.name}`} disabled={!editingName.trim()} onClick={() => saveName(connection.id)}><Check size={14} /></button><button className="btn-icon" aria-label="Cancel token rename" onClick={() => setEditing(null)}><X size={14} /></button></> : <button className="btn-icon" aria-label={`Rename ${connection.name}`} onClick={() => { setEditing(connection.id); setEditingName(connection.name); }}><PenLine size={14} /></button>}<button className="btn-icon" aria-label={`Revoke ${connection.name}`} onClick={() => revoke(connection)}><Trash2 size={14} /></button></>}
        </div>)}{!connections.length && <p className="app-settings-empty">No connections</p>}</div>
        {moreConnections && <div className="app-load-more"><button className="btn" disabled={Boolean(loadingMore)} onClick={() => loadMore('tokens')}>{loadingMore === 'tokens' ? 'Loading…' : 'Load more connections'}</button></div>}
      </div></details></section>

    <section className="settings-section"><div className="app-settings-heading"><div><h2>Activity</h2><p>{activityTotal} {activityTotal === 1 ? 'event' : 'events'}</p></div>{activity.length > 0 && <button className="btn" onClick={clearActivity}>Clear activity</button>}</div><div className="app-management-list app-activity-list">{activity.map((item) => <div className="app-management-row" key={item.id}><span className="app-activity-dot" /><div><strong>{activityLabel(item.action)}</strong><small>{fmt(item.createdAt)} · {sourceLabel(item.source)}{item.objectType ? ` · ${objectLabel(item.objectType)}` : ''}</small></div><button className="btn-icon" aria-label={`Delete ${activityLabel(item.action)} activity`} onClick={() => removeActivity(item.id)}><Trash2 size={14} /></button></div>)}{!activity.length && <p className="app-settings-empty">No activity</p>}</div>
      {activity.length < activityTotal && <div className="app-load-more"><button className="btn" disabled={Boolean(loadingMore)} onClick={() => loadMore('activity')}>{loadingMore === 'activity' ? 'Loading…' : 'Load more activity'}</button></div>}
    </section>
  </div>;
}
