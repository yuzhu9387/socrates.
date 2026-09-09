export class ApiError extends Error {
  constructor(status, payload = {}) {
    super(payload.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code || 'REQUEST_FAILED';
    this.currentRevision = payload.currentRevision;
    this.details = payload.details;
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, origin = globalThis.location?.origin || '', accountId = '', onAccountChanged = () => {} } = {}) {
  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const mutation = !['GET', 'HEAD'].includes(method);
    const options = {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(mutation ? { 'X-Socrates-CSRF': '1', ...(origin ? { Origin: origin } : {}) } : {}),
        ...(accountId ? { 'X-Socrates-Account': accountId } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    const response = await fetchImpl(`/api/v1${path}`, options);
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new ApiError(response.status, payload.error);
      if (error.code === 'ACCOUNT_CHANGED') onAccountChanged(error);
      throw error;
    }
    return payload;
  };

  return {
    authStatus: () => request('/auth/status'),
    setup: (credentials) => request('/auth/setup', { method: 'POST', body: credentials }),
    login: (credentials) => request('/auth/login', { method: 'POST', body: credentials }),
    me: () => request('/auth/me'),
    logout: () => request('/auth/logout', { method: 'POST' }),
    getWorkspace: () => request('/workspace'),
    putWorkspace: ({ expectedRevision, data, mode, idempotencyKey }) => request('/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { expectedRevision, data, ...(mode ? { mode } : {}) },
    }),
    getConnections: ({ limit = 50, offset = 0 } = {}) => request(`/connections?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`),
    createConnection: ({ name, scopes }) => request('/connections', { method: 'POST', body: { name, scopes } }),
    renameConnection: (id, name) => request(`/connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
    revokeConnection: (id) => request(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getActivity: ({ limit = 50, offset = 0 } = {}) => request(`/activity?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`),
    deleteActivity: (id) => request(`/activity/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearActivity: () => request('/activity', { method: 'DELETE' }),
  };
}

export const api = createApiClient();
