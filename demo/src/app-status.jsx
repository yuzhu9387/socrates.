import React from 'react';
import { AlertTriangle, Check, CloudOff, LoaderCircle } from 'lucide-react';
import './app-status.css';

export default function AppStatus({ status = 'Saved', error, recoveryWarning, onRetry, onDownload, onReload, onReauthenticate }) {
  const Icon = status === 'Saving' ? LoaderCircle : status === 'Offline' ? CloudOff : ['Conflict', 'Save failed', 'Account changed'].includes(status) ? AlertTriangle : Check;
  return <>
    {status !== 'Saved' && <span className={`app-sync-status is-${status.toLowerCase().replace(/\s+/g, '-')}`} role="status"><Icon size={13} />{status}</span>}
    {status === 'Offline' && <button type="button" className="app-sync-action" onClick={onRetry}>Retry</button>}
    {status === 'Conflict' && <div className="app-conflict" role="alert"><span>Workspace changed elsewhere. Your local changes are preserved.</span><button type="button" onClick={onDownload}>Download local changes</button><button type="button" onClick={onReload}>Reload server data</button></div>}
    {status === 'Save failed' && <div className="app-conflict" role="alert"><span>{error?.message || 'The server rejected this change.'} Your local changes are preserved.</span><button type="button" onClick={onDownload}>Download local changes</button><button type="button" onClick={onRetry}>Retry</button></div>}
    {status === 'Account changed' && <div className="app-conflict" role="alert"><span>{error?.message || 'The signed-in account changed.'} Local changes for this account are preserved.</span><button type="button" onClick={onDownload}>Download local changes</button><button type="button" onClick={onReauthenticate}>Sign in again</button></div>}
    {recoveryWarning && <div className="app-recovery-warning" role="alert"><span>{recoveryWarning}</span><button type="button" onClick={onDownload}>Download local changes</button></div>}
  </>;
}
