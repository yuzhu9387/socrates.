import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceSync, rebaseCanonical } from '../src/app-sync.js';

const workspace = (summary = 'Server') => ({
  version: 1,
  notes: [{ id: 'note-1', summary, body: '', tags: [], kind: 'thought', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', deleted: false }],
  tags: [], maps: [], theme: 'light', motion: true,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('a newer local edit survives an in-flight canonical acknowledgement and is sent next', async () => {
  const first = deferred();
  const calls = [];
  const seen = [];
  const sync = new WorkspaceSync({
    revision: 4,
    data: workspace(),
    send: (request) => { calls.push(request); return calls.length === 1 ? first.promise : Promise.resolve({ revision: 6, data: workspace('Second canonical') }); },
    read: async () => ({ revision: 6, data: workspace('Second canonical') }),
    onData: (data) => seen.push(data.notes[0].summary),
    debounceMs: 0,
  });

  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'First local' }] }));
  const firstFlush = sync.flush();
  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Newer local' }] }));
  first.resolve({ revision: 5, data: workspace('First canonical') });
  await firstFlush;
  await sync.flush();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].expectedRevision, 4);
  assert.equal(calls[0].data.notes[0].summary, 'First local');
  assert.equal(calls[1].expectedRevision, 5);
  assert.equal(calls[1].data.notes[0].summary, 'Newer local');
  assert.equal(seen.includes('First canonical'), false);
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Second canonical');
  assert.equal(sync.getSnapshot().status, 'Saved');
});

test('a failed write keeps local data and retries the same request without optimistic Saved state', async () => {
  const calls = [];
  let fail = true;
  const sync = new WorkspaceSync({
    revision: 2,
    data: workspace(),
    send: async (request) => {
      calls.push(request);
      if (fail) { fail = false; throw new TypeError('Failed to fetch'); }
      return { revision: 3, data: workspace('Canonical retry') };
    },
    read: async () => ({ revision: 3, data: workspace('Canonical retry') }),
    debounceMs: 0,
  });

  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Offline local' }] }));
  await sync.flush();
  assert.equal(sync.getSnapshot().status, 'Offline');
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Offline local');
  await sync.retry();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey);
  assert.equal(sync.getSnapshot().status, 'Saved');
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Canonical retry');
});

test('a version conflict pauses writes, preserves further edits, and reloads only explicitly', async () => {
  const calls = [];
  const conflict = Object.assign(new Error('Workspace changed elsewhere'), { status: 409, code: 'VERSION_CONFLICT', currentRevision: 9 });
  const sync = new WorkspaceSync({
    revision: 7,
    data: workspace(),
    send: async (request) => { calls.push(request); throw conflict; },
    read: async () => ({ revision: 9, data: workspace('Server after conflict') }),
    debounceMs: 0,
  });

  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Conflicted local' }] }));
  await sync.flush();
  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Still recoverable' }] }));
  await sync.flush();

  assert.equal(calls.length, 1);
  assert.equal(sync.getSnapshot().status, 'Conflict');
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Still recoverable');
  await sync.reloadServer();
  assert.equal(sync.getSnapshot().revision, 9);
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Server after conflict');
  assert.equal(sync.getSnapshot().status, 'Saved');
});

test('a focus refresh cannot overwrite an edit made while its read is in flight', async () => {
  const pending = deferred();
  const sync = new WorkspaceSync({
    revision: 3,
    data: workspace(),
    send: async () => ({ revision: 5, data: workspace('Saved local') }),
    read: () => pending.promise,
    debounceMs: 10000,
  });

  const refresh = sync.refreshIfClean();
  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Edit during refresh' }] }));
  pending.resolve({ revision: 4, data: workspace('Remote refresh') });
  assert.equal(await refresh, false);
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Edit during refresh');
  assert.equal(sync.getSnapshot().revision, 3);
  sync.destroy();
});

test('open editors and board gestures guard clean refreshes before and during a read', async () => {
  const pending = deferred();
  let reads = 0;
  const sync = new WorkspaceSync({
    revision: 3,
    data: workspace(),
    send: async ({ data }) => ({ revision: 4, data }),
    read: () => { reads += 1; return pending.promise; },
  });

  sync.setEditing(true);
  assert.equal(await sync.refreshIfClean(), false);
  assert.equal(reads, 0);

  sync.setEditing(false);
  const refresh = sync.refreshIfClean();
  sync.setInteracting(true);
  sync.setInteracting(false);
  pending.resolve({ revision: 4, data: workspace('Remote while dragging') });

  assert.equal(await refresh, false);
  assert.equal(sync.getSnapshot().revision, 3);
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Server');
});

test('a canonical response rebases unchanged server fields into a queued local edit', async () => {
  const first = deferred();
  const calls = [];
  const initial = { ...workspace(), maps: [{ id: 'map-1', name: 'Map', nodes: [], edges: [], saved: null, history: [] }] };
  const sync = new WorkspaceSync({
    revision: 1,
    data: initial,
    send: (request) => {
      calls.push(request);
      if (calls.length === 1) return first.promise;
      return Promise.resolve({ revision: 3, data: request.data });
    },
    read: async () => ({ revision: 3, data: initial }),
    debounceMs: 0,
  });

  sync.update((data) => ({ ...data, maps: [{ ...data.maps[0], saved: { number: 1, date: 'client-date', name: 'Map', nodes: [], edges: [], notes: [], tagOrder: [] } }] }));
  const writing = sync.flush();
  sync.update((data) => ({ ...data, theme: 'dark' }));
  first.resolve({ revision: 2, data: { ...calls[0].data, maps: [{ ...calls[0].data.maps[0], saved: { ...calls[0].data.maps[0].saved, date: 'server-date' } }] } });
  await writing;
  await sync.flush();

  assert.equal(calls[1].data.theme, 'dark');
  assert.equal(calls[1].data.maps[0].saved.date, 'server-date');
});

test('destroy ignores a late write response and reload refuses to race an active write', async () => {
  const pending = deferred();
  const seen = [];
  const sync = new WorkspaceSync({
    revision: 1,
    data: workspace(),
    send: () => pending.promise,
    read: async () => ({ revision: 9, data: workspace('Reloaded') }),
    onData: (data) => seen.push(data.notes[0].summary),
    debounceMs: 0,
  });
  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Pending' }] }));
  const writing = sync.flush();
  assert.equal(await sync.reloadServer(), false);
  sync.destroy();
  pending.resolve({ revision: 2, data: workspace('Late canonical') });
  await writing;
  assert.equal(seen.includes('Late canonical'), false);
  assert.equal(sync.getSnapshot().revision, 1);
});

test('a server validation rejection pauses with its message and keeps local recovery data', async () => {
  const rejection = Object.assign(new Error('Saved revision content is immutable'), { status: 400, code: 'IMMUTABLE_REVISION' });
  let reject = true;
  const sync = new WorkspaceSync({
    revision: 5,
    data: workspace(),
    send: async ({ data }) => {
      if (reject) throw rejection;
      return { revision: 6, data };
    },
    read: async () => ({ revision: 5, data: workspace() }),
    debounceMs: 0,
  });
  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Rejected local' }] }));
  await sync.flush();
  assert.equal(sync.getSnapshot().status, 'Save failed');
  assert.equal(sync.getSnapshot().error.message, 'Saved revision content is immutable');
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Rejected local');
  reject = false;
  await sync.retry();
  assert.equal(sync.getSnapshot().status, 'Saved');
});

test('a staged replacement saves pending edits first, publishes only canonical success, and does not leak mode', async () => {
  const calls = [];
  const seen = [];
  const imported = workspace('Imported');
  const sync = new WorkspaceSync({
    revision: 1,
    data: workspace(),
    send: async (request) => {
      calls.push(request);
      return { revision: calls.length + 1, data: request.mode ? workspace('Canonical import') : request.data };
    },
    read: async () => ({ revision: 1, data: workspace() }),
    onData: (data) => seen.push(data.notes[0].summary),
    debounceMs: 10000,
  });
  sync.update((data) => ({ ...data, theme: 'dark' }));
  await sync.importData(imported, 'replace');
  sync.update((data) => ({ ...data, theme: 'light' }));
  await sync.flush();

  assert.equal(calls.length, 3);
  assert.equal(calls[0].mode, undefined);
  assert.equal(calls[1].mode, 'replace');
  assert.equal(calls[1].data.notes[0].summary, 'Imported');
  assert.equal(calls[2].mode, undefined);
  assert.equal(seen.includes('Imported'), false);
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Canonical import');
});

test('a failed staged replacement keeps live data and retries the immutable import attempt', async () => {
  const calls = [];
  const replacement = workspace('Replacement');
  const sync = new WorkspaceSync({
    revision: 6,
    data: workspace('Live workspace'),
    send: async (request) => {
      calls.push(request);
      if (calls.length === 1) throw new TypeError('Failed to fetch');
      return { revision: 7, data: workspace('Canonical replacement') };
    },
    read: async () => ({ revision: 6, data: workspace('Live workspace') }),
  });

  await assert.rejects(sync.importData(replacement, 'replace'));
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Live workspace');
  await sync.importData(replacement, 'replace');

  assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey);
  assert.deepEqual(calls[1].data, calls[0].data);
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Canonical replacement');
});

test('account changes pause without rebasing or resending local data', async () => {
  const calls = [];
  const changed = Object.assign(new Error('The signed-in account changed.'), { status: 409, code: 'ACCOUNT_CHANGED' });
  const sync = new WorkspaceSync({
    revision: 4,
    data: workspace(),
    send: async (request) => { calls.push(request); throw changed; },
    read: async () => { throw changed; },
    debounceMs: 0,
  });
  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Account A local' }] }));
  await sync.flush();
  await sync.retry();

  assert.equal(calls.length, 1);
  assert.equal(sync.getSnapshot().status, 'Account changed');
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Account A local');
});

test('explicit reload ignores a response when another local edit happens during its read', async () => {
  const pending = deferred();
  const sync = new WorkspaceSync({
    revision: 2,
    data: workspace(),
    send: async ({ data }) => ({ revision: 3, data }),
    read: () => pending.promise,
    debounceMs: 10000,
  });
  const reload = sync.reloadServer();
  sync.update((data) => ({ ...data, notes: [{ ...data.notes[0], summary: 'Edit during reload' }] }));
  pending.resolve({ revision: 9, data: workspace('Other account data') });

  assert.equal(await reload, false);
  assert.equal(sync.getSnapshot().revision, 2);
  assert.equal(sync.getSnapshot().data.notes[0].summary, 'Edit during reload');
  sync.destroy();
});

test('canonical saved revisions follow their number when a newer save moves them into history', () => {
  const revision = (number, date, label) => ({ number, date, label, name: 'Map', nodes: [], edges: [], notes: [], tagOrder: [], noteOrder: [] });
  const base = { ...workspace(), maps: [{ id: 'map-1', saved: revision(1, 'client-date'), history: [] }] };
  const local = { ...base, maps: [{ id: 'map-1', saved: revision(2, 'new-client-date'), history: [{ ...base.maps[0].saved, label: 'Local label' }] }] };
  const canonical = { ...base, maps: [{ id: 'map-1', saved: revision(1, 'server-date'), history: [] }] };

  const rebased = rebaseCanonical(base, local, canonical);
  assert.equal(rebased.maps[0].saved.number, 2);
  assert.equal(rebased.maps[0].history[0].date, 'server-date');
  assert.equal(rebased.maps[0].history[0].label, 'Local label');
});
