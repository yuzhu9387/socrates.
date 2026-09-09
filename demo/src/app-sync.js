const makeKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const itemKey = (item) => item && typeof item === 'object' ? ('id' in item ? `id:${item.id}` : 'number' in item ? `number:${item.number}` : null) : null;

function mergeCanonical(base, local, canonical) {
  if (sameValue(local, base)) return canonical;
  if (!base || !local || !canonical || typeof base !== 'object' || typeof local !== 'object' || typeof canonical !== 'object') return local;
  if (Array.isArray(base) || Array.isArray(local) || Array.isArray(canonical)) {
    if (!Array.isArray(base) || !Array.isArray(local) || !Array.isArray(canonical)) return local;
    const keyed = [...base, ...local, ...canonical].every((item) => itemKey(item));
    if (!keyed) return local;
    const before = new Map(base.map((item) => [itemKey(item), item]));
    const server = new Map(canonical.map((item) => [itemKey(item), item]));
    return local.map((item) => {
      const key = itemKey(item);
      return before.has(key) && server.has(key) ? mergeCanonical(before.get(key), item, server.get(key)) : item;
    });
  }
  const result = {};
  for (const key of new Set([...Object.keys(canonical), ...Object.keys(local)])) {
    if (!(key in local) && key in base) continue;
    result[key] = key in base && key in canonical ? mergeCanonical(base[key], local[key], canonical[key]) : local[key] ?? canonical[key];
  }
  return result;
}

const revisionsByNumber = (map) => new Map([map?.saved, ...(map?.history || [])].filter(Boolean).map((revision) => [revision.number, revision]));

export function rebaseCanonical(base, local, canonical) {
  const merged = mergeCanonical(base, local, canonical);
  if (![base?.maps, local?.maps, canonical?.maps, merged?.maps].every(Array.isArray)) return merged;
  const baseMaps = new Map(base.maps.map((map) => [map.id, map]));
  const localMaps = new Map(local.maps.map((map) => [map.id, map]));
  const canonicalMaps = new Map(canonical.maps.map((map) => [map.id, map]));
  return {
    ...merged,
    maps: merged.maps.map((map) => {
      const before = baseMaps.get(map.id);
      const changed = localMaps.get(map.id);
      const server = canonicalMaps.get(map.id);
      if (!before || !changed || !server) return map;
      const beforeRevisions = revisionsByNumber(before);
      const localRevisions = revisionsByNumber(changed);
      const serverRevisions = revisionsByNumber(server);
      const canonicalize = (revision) => {
        const authoritative = serverRevisions.get(revision?.number);
        if (!authoritative) return revision;
        const previous = beforeRevisions.get(revision.number);
        const newer = localRevisions.get(revision.number);
        return previous && newer && newer.label !== previous.label ? { ...authoritative, label: newer.label } : authoritative;
      };
      return { ...map, saved: map.saved ? canonicalize(map.saved) : map.saved, history: (map.history || []).map(canonicalize) };
    }),
  };
}

export class WorkspaceSync {
  constructor({ revision, data, send, read, onData = () => {}, onState = () => {}, onRecovery = () => {}, onSaved = () => {}, debounceMs = 180 }) {
    this.revision = revision;
    this.data = data;
    this.send = send;
    this.read = read;
    this.onData = onData;
    this.onState = onState;
    this.onRecovery = onRecovery;
    this.onSaved = onSaved;
    this.debounceMs = debounceMs;
    this.status = 'Saved';
    this.dirty = false;
    this.paused = false;
    this.inFlight = false;
    this.localVersion = 0;
    this.conflict = null;
    this.error = null;
    this.timer = null;
    this.failedAttempt = null;
    this.failedImport = null;
    this.importInFlight = false;
    this.idleWaiters = [];
    this.destroyed = false;
    this.editingSources = new Set();
    this.editing = false;
    this.interacting = false;
    this.refreshGuardVersion = 0;
    this.emitState();
  }

  setEditing(active, source = 'default') {
    if (active) this.editingSources.add(source);
    else this.editingSources.delete(source);
    const next = this.editingSources.size > 0;
    if (next !== this.editing) this.refreshGuardVersion += 1;
    this.editing = next;
  }

  setInteracting(active) {
    const next = Boolean(active);
    if (next !== this.interacting) this.refreshGuardVersion += 1;
    this.interacting = next;
  }

  accountChanged(error) {
    if (this.destroyed) return;
    this.paused = true;
    this.status = 'Account changed';
    this.conflict = error;
    this.error = error;
    this.failedAttempt = null;
    this.failedImport = null;
    if (this.dirty) this.onRecovery({ revision: this.revision, data: this.data });
    this.emitState();
  }

  getSnapshot() {
    return {
      revision: this.revision,
      data: this.data,
      status: this.status,
      dirty: this.dirty,
      inFlight: this.inFlight,
      importing: this.importInFlight,
      conflict: this.conflict,
      error: this.error,
    };
  }

  emitState() {
    this.onState(this.getSnapshot());
  }

  update(value) {
    if (this.importInFlight) return this.data;
    if (this.failedImport) {
      this.failedImport = null;
      this.paused = false;
      this.error = null;
    }
    this.data = typeof value === 'function' ? value(this.data) : value;
    this.localVersion += 1;
    this.dirty = true;
    if (!this.paused) this.status = this.inFlight ? 'Saving' : this.status === 'Offline' ? 'Offline' : 'Saving';
    this.onData(this.data);
    this.onRecovery({ revision: this.revision, data: this.data });
    this.emitState();
    this.schedule();
  }

  restoreRecovery(recovery) {
    if (!recovery?.data) return;
    this.data = recovery.data;
    this.localVersion += 1;
    this.dirty = true;
    this.onData(this.data);
    if (recovery.revision !== this.revision) {
      this.paused = true;
      this.status = 'Conflict';
      this.conflict = { code: 'RECOVERY_CONFLICT', currentRevision: this.revision, message: 'Server data changed while local edits were pending.' };
    } else {
      this.status = 'Saving';
      this.schedule();
    }
    this.emitState();
  }

  waitUntilIdle() {
    if (!this.inFlight) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  async importData(data, mode, retryAttempt = null) {
    if (!['import', 'replace'].includes(mode)) throw new Error('Choose import or replace mode.');
    if (this.destroyed) throw new Error('The workspace session has ended.');
    if (!retryAttempt && this.failedImport?.mode === mode && sameValue(this.failedImport.data, data)) retryAttempt = this.failedImport;
    if (!retryAttempt) {
      await this.waitUntilIdle();
      if (this.dirty) await this.flush();
      await this.waitUntilIdle();
      if (this.dirty || this.paused || this.status !== 'Saved') throw this.error || new Error('Save or resolve local changes before importing.');
    }
    const attempt = retryAttempt || { data: JSON.parse(JSON.stringify(data)), mode, expectedRevision: this.revision, idempotencyKey: makeKey() };
    this.inFlight = true;
    this.importInFlight = true;
    this.paused = false;
    this.status = 'Saving';
    this.error = null;
    this.emitState();
    try {
      const result = await this.send(attempt);
      if (this.destroyed) return false;
      this.revision = result.revision;
      this.data = result.data;
      this.localVersion += 1;
      this.dirty = false;
      this.failedImport = null;
      this.conflict = null;
      this.status = 'Saved';
      this.onData(this.data);
      this.onSaved();
      return this.getSnapshot();
    } catch (error) {
      if (this.destroyed) return false;
      this.error = error;
      if (error?.code === 'ACCOUNT_CHANGED') {
        this.paused = true;
        this.status = 'Account changed';
        this.conflict = error;
        this.failedImport = null;
      } else if (error?.status === 409 || error?.code === 'VERSION_CONFLICT') {
        this.paused = true;
        this.status = 'Conflict';
        this.conflict = error;
        this.failedImport = null;
      } else {
        this.paused = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
        this.status = this.paused ? 'Save failed' : 'Offline';
        this.failedImport = attempt;
      }
      throw error;
    } finally {
      this.inFlight = false;
      this.importInFlight = false;
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
      if (!this.destroyed) this.emitState();
    }
  }

  schedule(delay = this.debounceMs) {
    if (this.destroyed || this.paused || this.inFlight || !this.dirty) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  async flush() {
    if (this.destroyed || this.paused || this.inFlight || !this.dirty) return this.getSnapshot();
    clearTimeout(this.timer);
    this.timer = null;
    const sentVersion = this.localVersion;
    const sentData = this.data;
    const retry = this.failedAttempt?.version === sentVersion;
    const idempotencyKey = retry ? this.failedAttempt.idempotencyKey : makeKey();
    this.inFlight = true;
    this.status = 'Saving';
    this.emitState();
    let sendAgain = false;

    try {
      const result = await this.send({ expectedRevision: this.revision, data: sentData, idempotencyKey });
      if (this.destroyed) return false;
      this.revision = result.revision;
      this.failedAttempt = null;
      if (this.localVersion === sentVersion) {
        this.data = result.data;
        this.dirty = false;
        this.status = 'Saved';
        this.conflict = null;
        this.error = null;
        this.onData(this.data);
        this.onSaved();
      } else {
        this.data = rebaseCanonical(sentData, this.data, result.data);
        this.dirty = true;
        this.status = 'Saving';
        this.onData(this.data);
        this.onRecovery({ revision: this.revision, data: this.data });
        sendAgain = true;
      }
    } catch (error) {
      if (this.destroyed) return false;
      if (error?.code === 'ACCOUNT_CHANGED') {
        this.paused = true;
        this.status = 'Account changed';
        this.conflict = error;
        this.error = error;
        this.failedAttempt = null;
      } else if (error?.status === 409 || error?.code === 'VERSION_CONFLICT') {
        this.paused = true;
        this.status = 'Conflict';
        this.conflict = error;
        this.error = error;
        this.failedAttempt = null;
      } else if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
        this.paused = true;
        this.status = 'Save failed';
        this.error = error;
        this.failedAttempt = { version: sentVersion, idempotencyKey };
      } else {
        this.status = 'Offline';
        this.error = error;
        this.failedAttempt = { version: sentVersion, idempotencyKey };
      }
      this.dirty = true;
      this.onRecovery({ revision: this.revision, data: this.data });
    } finally {
      this.inFlight = false;
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
      if (!this.destroyed) {
        this.emitState();
        if (sendAgain) this.schedule(0);
      }
    }
    return this.getSnapshot();
  }

  async retry() {
    if (this.failedImport) return this.importData(this.failedImport.data, this.failedImport.mode, this.failedImport).catch(() => this.getSnapshot());
    if (this.paused && this.status !== 'Save failed') return this.getSnapshot();
    if (this.status === 'Save failed') {
      this.paused = false;
      this.status = 'Saving';
      this.emitState();
    }
    return this.flush();
  }

  async refreshIfClean() {
    if (this.destroyed || this.dirty || this.inFlight || this.paused || this.editing || this.interacting) return false;
    const localVersion = this.localVersion;
    const revision = this.revision;
    const refreshGuardVersion = this.refreshGuardVersion;
    try {
      const result = await this.read();
      if (this.destroyed || this.dirty || this.inFlight || this.paused || this.editing || this.interacting || this.localVersion !== localVersion || this.revision !== revision || this.refreshGuardVersion !== refreshGuardVersion) return false;
      if (result.revision !== this.revision) {
        this.revision = result.revision;
        this.data = result.data;
        this.onData(this.data);
      }
      this.status = 'Saved';
      this.error = null;
      this.emitState();
      return true;
    } catch (error) {
      if (error?.code === 'ACCOUNT_CHANGED') {
        this.paused = true;
        this.status = 'Account changed';
        this.conflict = error;
      } else {
        this.status = 'Offline';
      }
      this.error = error;
      this.emitState();
      return false;
    }
  }

  async reloadServer() {
    if (this.destroyed || this.inFlight) return false;
    const localVersion = this.localVersion;
    const refreshGuardVersion = this.refreshGuardVersion;
    try {
      const result = await this.read();
      if (this.destroyed || this.inFlight || this.localVersion !== localVersion || this.refreshGuardVersion !== refreshGuardVersion) return false;
      this.revision = result.revision;
      this.data = result.data;
      this.localVersion += 1;
      this.dirty = false;
      this.paused = false;
      this.inFlight = false;
      this.failedAttempt = null;
      this.failedImport = null;
      this.conflict = null;
      this.error = null;
      this.status = 'Saved';
      this.onData(this.data);
      this.onSaved();
      this.emitState();
      return this.getSnapshot();
    } catch (error) {
      if (this.destroyed) return false;
      if (error?.code === 'ACCOUNT_CHANGED') {
        this.paused = true;
        this.status = 'Account changed';
        this.conflict = error;
      } else {
        this.status = 'Offline';
      }
      this.error = error;
      this.emitState();
      return false;
    }
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
}
