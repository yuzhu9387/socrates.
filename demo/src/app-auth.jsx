import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import SocratesMark from './logo.jsx';
import './app-auth.css';

export default function AppAuth({ setupRequired, busy, error, onSubmit, onRetry }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const title = setupRequired ? 'Create your account' : 'Sign in';

  const submit = (event) => {
    event.preventDefault();
    onSubmit({ email: email.trim(), password });
  };

  return <main className="app-auth-shell">
    <section className="app-auth-card" aria-labelledby="app-auth-title">
      <span className="app-auth-mark"><SocratesMark /></span>
      <p className="app-auth-brand">SOCRATES</p>
      <h1 id="app-auth-title">{title}</h1>
      <p>{setupRequired ? 'Set up the first account for this server.' : 'Open your personal workspace.'}</p>
      <form onSubmit={submit}>
        <label htmlFor="app-auth-email">Email</label>
        <input id="app-auth-email" type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="app-auth-password">Password</label>
        <input id="app-auth-password" type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
        {setupRequired && <small className="app-auth-hint">Use at least 12 characters.</small>}
        {error && <p className="app-auth-error" role="alert">{error}</p>}
        <button type="submit" className="app-auth-submit" disabled={busy}>{busy ? 'Please wait…' : title}<ArrowRight size={16} /></button>
        {onRetry && <button type="button" className="app-auth-retry" onClick={onRetry}>Retry connection</button>}
      </form>
    </section>
  </main>;
}
