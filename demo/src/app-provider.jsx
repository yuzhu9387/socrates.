import React, { useCallback, useEffect, useRef, useState } from 'react';
import AppAuth from './app-auth.jsx';
import { api, createApiClient } from './app-api.js';
import { WorkspaceSync } from './app-sync.js';

const recoveryKey = (user) => `socrates-app-recovery:${user.id || encodeURIComponent(user.email)}`;

function readRecovery(user) {
  try {
    const value = JSON.parse(localStorage.getItem(recoveryKey(user)));
    return value?.data?.version === 1 && Number.isInteger(value.revision) ? value : null;
  } catch {
    return null;
  }
}

function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function WorkspaceSession({ user, onSignedOut, children }) {
  const accountApiRef = useRef(null);
  if (!accountApiRef.current) accountApiRef.current = createApiClient({ accountId: user.id, onAccountChanged: (error) => syncRef.current?.accountChanged(error) });
  const accountApi = accountApiRef.current;
  const [view, setView] = useState({ loading: true, data: null, status: 'Saved', revision: 0, error: '', recoveryWarning: '' });
  const syncRef = useRef(null);

  useEffect(() => {
    let active = true;
    accountApi.getWorkspace().then((server) => {
      if (!active) return;
      const sync = new WorkspaceSync({
        revision: server.revision,
        data: server.data,
        send: accountApi.putWorkspace,
        read: accountApi.getWorkspace,
        onData: (data) => active && setView((current) => ({ ...current, data })),
        onState: (state) => active && setView((current) => ({ ...current, loading: false, status: state.status, revision: state.revision, conflict: state.conflict, syncError: state.error, importing: state.importing })),
        onRecovery: (recovery) => {
          try { localStorage.setItem(recoveryKey(user), JSON.stringify(recovery)); }
          catch { if (active) setView((current) => ({ ...current, recoveryWarning: 'Local recovery storage is unavailable. Download local changes before leaving.' })); }
        },
        onSaved: () => {
          try { localStorage.removeItem(recoveryKey(user)); }
          catch { if (active) setView((current) => ({ ...current, recoveryWarning: 'Local recovery storage could not be cleared.' })); }
        },
      });
      syncRef.current = sync;
      setView({ loading: false, data: server.data, status: 'Saved', revision: server.revision, error: '' });
      const recovery = readRecovery(user);
      if (recovery) sync.restoreRecovery(recovery);
    }).catch((error) => active && setView((current) => ({ ...current, loading: false, error: error.message || 'Could not load the workspace.' })));
    return () => { active = false; syncRef.current?.destroy(); syncRef.current = null; };
  }, [user, accountApi]);

  useEffect(() => {
    const refresh = () => syncRef.current?.refreshIfClean();
    const visibility = () => { if (document.visibilityState === 'visible') refresh(); };
    const poll = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(poll); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  useEffect(() => {
    let boardPropertyDirty = false;
    let boardPropertyValue = '';
    let propertyResetTimer = null;
    const pointerDown = (event) => {
      if (!event.target?.closest?.('.app-board')) return;
      syncRef.current?.setInteracting(true);
      if (boardPropertyDirty && event.target?.closest?.('.react-flow__pane,.react-flow__node,.react-flow__edge,.board-layer-row')) {
        clearTimeout(propertyResetTimer);
        propertyResetTimer = setTimeout(() => {
          const current = document.querySelector('.app-board #board-property-text');
          if (!current || current.value !== boardPropertyValue) {
            boardPropertyDirty = false;
            syncRef.current?.setEditing(false, 'board-property');
          }
        }, 0);
      }
    };
    const pointerEnd = () => syncRef.current?.setInteracting(false);
    const input = (event) => {
      if (event.target?.matches?.('#board-property-text') && event.target.closest('.app-board')) {
        boardPropertyDirty = true;
        boardPropertyValue = event.target.value;
        syncRef.current?.setEditing(true, 'board-property');
      }
    };
    const submit = (event) => {
      if (!event.target?.querySelector?.('#board-property-text')) return;
      boardPropertyDirty = false;
      syncRef.current?.setEditing(false, 'board-property');
    };
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', pointerEnd, true);
    document.addEventListener('pointercancel', pointerEnd, true);
    document.addEventListener('input', input, true);
    document.addEventListener('submit', submit, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', pointerEnd, true);
      document.removeEventListener('pointercancel', pointerEnd, true);
      document.removeEventListener('input', input, true);
      document.removeEventListener('submit', submit, true);
      clearTimeout(propertyResetTimer);
      syncRef.current?.setEditing(false, 'board-property');
    };
  }, []);

  useEffect(() => {
    const beforeUnload = (event) => {
      const snapshot = syncRef.current?.getSnapshot();
      if (!snapshot?.dirty && !snapshot?.inFlight) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const setData = useCallback((value) => syncRef.current?.update(value), []);
  const retry = useCallback(async () => {
    try { return await syncRef.current?.retry(); }
    catch { return syncRef.current?.getSnapshot(); } // The sync state already exposes the retry error.
  }, []);
  const setEditing = useCallback((active) => syncRef.current?.setEditing(active), []);
  const importWorkspace = useCallback((data, mode) => syncRef.current?.importData(data, mode), []);
  const reloadServer = useCallback(() => syncRef.current?.reloadServer(), []);
  const downloadLocalChanges = useCallback(() => {
    const data = syncRef.current?.getSnapshot().data;
    if (data) downloadJson(data, 'socrates-local-changes.json');
  }, []);
  const logout = useCallback(async () => { await accountApi.logout(); onSignedOut(); }, [accountApi, onSignedOut]);

  if (view.loading) return <div className="app-loading" role="status">Loading workspace…</div>;
  if (view.error) return <AppAuth busy={false} error={view.error} onSubmit={() => {}} onRetry={() => location.reload()} />;
  return children({
    appMode: true,
    data: view.data,
    setData,
    status: view.status,
    importing: Boolean(view.importing),
    error: view.syncError,
    recoveryWarning: view.recoveryWarning,
    revision: view.revision,
    user,
    api: accountApi,
    retry,
    setEditing,
    importWorkspace,
    reloadServer,
    downloadLocalChanges,
    logout,
    reauthenticate: () => location.reload(),
  });
}

export default function AppProvider({ children }) {
  const [auth, setAuth] = useState({ loading: true, setupRequired: false, user: null, error: '', busy: false });

  const loadStatus = useCallback(() => {
    setAuth((current) => ({ ...current, loading: true, error: '' }));
    api.authStatus().then((result) => setAuth({ loading: false, setupRequired: Boolean(result.setupRequired), user: result.authenticated ? result.user : null, error: '', busy: false })).catch((error) => setAuth({ loading: false, setupRequired: false, user: null, error: error.message || 'Could not reach the server.', busy: false, retry: true }));
  }, []);
  useEffect(loadStatus, [loadStatus]);

  const submit = async (credentials) => {
    setAuth((current) => ({ ...current, busy: true, error: '' }));
    try {
      const result = auth.setupRequired ? await api.setup(credentials) : await api.login(credentials);
      setAuth({ loading: false, setupRequired: false, user: result.user, error: '', busy: false });
    } catch (error) {
      setAuth((current) => ({ ...current, busy: false, error: error.message || 'Authentication failed.' }));
    }
  };

  if (auth.loading) return <div className="app-loading" role="status">Connecting…</div>;
  if (!auth.user) return <AppAuth setupRequired={auth.setupRequired} busy={auth.busy} error={auth.error} onSubmit={submit} onRetry={auth.retry ? loadStatus : null} />;
  return <WorkspaceSession key={auth.user.id || auth.user.email} user={auth.user} onSignedOut={() => setAuth((current) => ({ ...current, user: null }))}>{children}</WorkspaceSession>;
}
