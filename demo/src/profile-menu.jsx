import React from 'react';

export default function ProfileMenu({ email, onSettings }) {
  return <div className="profile-menu">
    <button type="button" className="account-trigger" aria-label="Open settings" title="Settings" onClick={onSettings}>
      <span className="avatar">{email?.[0]?.toUpperCase() || 'G'}</span>
      <span className="account-name" title={email || 'My account'}>{email || 'My account'}</span>
    </button>
  </div>;
}
