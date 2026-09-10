import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createPool, migrate } from '../server/src/db.mjs';
import { createAccount } from '../server/src/auth.mjs';
import { saveMap, STORAGE_KEY } from '../demo/src/model.js';
import { downloadBackup } from '../demo/src/transfers.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for isolated end-to-end tests.');
const testUrl = new URL(process.env.TEST_DATABASE_URL);
if (!/test/i.test(testUrl.pathname)) throw new Error('Refusing to run browser fixtures against a database without test in its name.');
const schema = `e2e_${randomUUID().replaceAll('-', '')}`;
const admin = createPool(testUrl.href);
await admin.query(`CREATE SCHEMA ${schema}`);
testUrl.searchParams.set('options', `-c search_path=${schema}`);
const pool = createPool(testUrl.href);
let server, browser;
async function startServer() {
  const child = spawn(process.execPath, ['server/src/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, DATABASE_URL: testUrl.href, PORT: '3002', HOST: '127.0.0.1', APP_ORIGIN: 'http://127.0.0.1:3002', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Test server failed: ${output}`);
    if (output.includes('Socrates is ready')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out starting isolated test server.');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  const force = setTimeout(() => server.kill('SIGKILL'), 12000);
  server.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(force); }
}
const checks = [], errors = [], activityRequests = [];
const screenshots = path.resolve('demo/screenshots/production');
await fs.mkdir(screenshots, { recursive: true });
try {
  await migrate(pool);
  await startServer();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/activity')) activityRequests.push(request.url()); });
  const origin = 'http://127.0.0.1:3002';
  await page.goto(origin); await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(screenshots, 'setup.png') });
  const email = `browser-${randomUUID()}@example.test`, password = `Socrates-${randomUUID()}`;
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Create your account|Create account|Set up workspace|Create workspace/ }).click();
  await page.getByRole('heading', { name: 'Notes', exact: true }).waitFor();
  const api = (method, route, data) => page.evaluate(async ({ method, route, data }) => {
    const response = await fetch(`/api/v1${route}`, { method, headers: { 'Content-Type': 'application/json', 'X-Socrates-CSRF': '1' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  }, { method, route, data });
  const waitForWorkspace = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await api('GET', '/workspace');
      if (response.status === 200 && predicate(response.body.data)) return response.body;
      await page.waitForTimeout(100);
    }
    throw new Error('Timed out waiting for durable workspace state.');
  };
  let workspace = await api('GET', '/workspace');
  assert.equal(workspace.status, 200); assert.equal(workspace.body.data.notes.length, 0);
  checks.push('First-run account setup and authenticated empty PostgreSQL workspace');

  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New note', exact: true });
  const summary = '真正的复盘 connects stories 🙂';
  await dialog.getByLabel('One-line summary', { exact: false }).fill(summary);
  await dialog.getByLabel('Tags', { exact: true }).fill('复盘'); await page.keyboard.press('Enter');
  await dialog.getByLabel('Details', { exact: true }).fill('今天学习 AI，learning by doing。\n\n## A story\nKeep 中文 and English together.');
  await dialog.getByRole('button', { name: /Save note/ }).click();
  await waitForWorkspace(data => data.notes.length === 1);
  workspace = await api('GET', '/workspace');
  const note = workspace.body.data.notes[0];
  assert.equal(note.summary, summary); assert.deepEqual(note.tags, ['复盘']);
  await page.reload(); await page.getByRole('heading', { name: 'Notes', exact: true }).waitFor();
  await page.getByText(summary, { exact: true }).first().waitFor();
  checks.push('Bilingual note and tag saved to PostgreSQL and survive full-page reload');
  assert.equal(await page.locator('.topbar .breadcrumb, .topbar kbd, .sidebar .keyhint').count(), 0);
  assert.equal(await page.locator('.topbar').getByText('Saved', { exact: true }).count(), 0);
  assert.equal(await page.locator('.sidebar').getByText('PostgreSQL workspace', { exact: true }).count(), 0);
  assert.equal(await page.locator('.sidebar a').filter({ hasText: /^Settings$/ }).count(), 0);
  await page.keyboard.press('Meta+f');
  await page.getByRole('dialog', { name: 'Search notes', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'library-search-input');
  await page.getByLabel('Search your entire library', { exact: true }).fill('复盘');
  await page.keyboard.press('Meta+f');
  assert.equal(await page.getByLabel('Search your entire library', { exact: true }).inputValue(), '复盘');
  await page.locator('.search-result').first().click();
  await page.getByRole('dialog', { name: 'Your notebook', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.locator('.account-popover').count(), 0, 'The avatar navigates directly without an account dropdown.');
  assert.equal(await page.getByRole('button', { name: 'Open settings', exact: true }).getAttribute('aria-expanded'), null);
  await page.getByRole('button', { name: 'Import file', exact: true }).click();
  await page.getByRole('dialog', { name: 'Import notes', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.nav-item[href="#/dashboard"]').click();
  checks.push('Quiet header, Command-F search with autofocus and bilingual results, avatar Settings navigation and file import entry');
  await page.screenshot({ path: path.join(screenshots, 'notes.png') });

  await page.getByRole('link', { name: 'Brainstorm', exact: true }).click();
  await page.getByRole('button', { name: 'New whiteboard', exact: true }).first().click();
  await page.locator('.board-root').waitFor();
  await waitForWorkspace(data => data.maps.length === 1);
  const addCard = page.getByRole('button', { name: new RegExp(`Add .*${summary.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`) });
  if (await addCard.count()) await addCard.first().click();
  else await page.locator('.board-library-card').first().getByRole('button').last().click();
  await page.locator('.react-flow__node-note').waitFor();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const mapDialog = page.getByRole('dialog', { name: 'Save knowledge map', exact: true });
  await mapDialog.getByLabel('Map name', { exact: true }).fill('复盘与故事');
  await mapDialog.getByLabel('One-line summary', { exact: false }).fill('Experience becomes a story.');
  await mapDialog.getByRole('button', { name: 'Save Knowledge Map', exact: true }).click();
  await waitForWorkspace(data => Boolean(data.maps[0]?.saved));
  await page.locator('.app-sync-status').waitFor({ state: 'hidden' });
  workspace = await api('GET', '/workspace');
  const savedMap = workspace.body.data.maps[0];
  assert.equal(savedMap.saved.notes[0].body, note.body);
  await page.reload(); await page.getByRole('button', { name: 'Original Board', exact: true }).click();
  await page.locator('.big-graph .board-note').waitFor();
  await page.getByRole('button', { name: 'Continue Editing', exact: true }).click();
  await page.locator('.react-flow__node-note').waitFor();
  checks.push('Create board, add a note, save a canonical revision and reopen the persisted original board');
  await page.screenshot({ path: path.join(screenshots, 'board.png') });

  const tokenResponse = await api('POST', '/connections', { name: 'Browser integration', scopes: ['read', 'write'] });
  assert.equal(tokenResponse.status, 201);
  const token = tokenResponse.body.token;
  const remoteRead = await fetch(`${origin}/api/v1/workspace`, { headers: { Authorization: `Bearer ${token}` } });
  const remoteWorkspace = await remoteRead.json();
  const remoteChange = await fetch(`${origin}/api/v1/notes/${encodeURIComponent(note.id)}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: remoteWorkspace.revision, summary: 'MCP-ready · 新的理解' }) });
  assert.equal(remoteChange.status, 200);
  await page.goto(`${origin}/#/dashboard`); await page.reload();
  await page.getByText('MCP-ready · 新的理解', { exact: true }).first().waitFor();
  workspace = await api('GET', '/workspace');
  assert.equal(workspace.body.data.maps[0].saved.notes[0].summary, summary);
  const stale = await api('PUT', '/workspace', { expectedRevision: remoteWorkspace.revision, data: remoteWorkspace.data });
  assert.equal(stale.status, 409);

  // Opening an editor must pin its base revision while external writes happen.
  for (let open = 0; open < 2; open++) {
    await page.goto(`${origin}/#/notes/${note.id}`);
    await page.getByRole('dialog', { name: 'Your notebook', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.goto(`${origin}/#/notes/missing-note`);
  await page.getByText('Note not found', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.goto(`${origin}/#/notes/${note.id}`);
  await page.getByRole('button', { name: 'Edit note', exact: true }).click();
  await page.getByLabel('One-line summary', { exact: false }).fill('My unsaved local interpretation');
  const current = (await api('GET', '/workspace')).body;
  const concurrent = await fetch(`${origin}/api/v1/notes/${note.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: current.revision, summary: 'Remote version · 保留' }),
  });
  assert.equal(concurrent.status, 200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: /Save note/ }).click();
  await page.locator('.app-sync-status').filter({ hasText: /^Conflict$/ }).waitFor();
  assert.equal((await api('GET', '/workspace')).body.data.notes[0].summary, 'Remote version · 保留');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local changes', exact: true }).click();
  const recoveryDownload = await downloadPromise;
  const recovery = JSON.parse(await fs.readFile(await recoveryDownload.path(), 'utf8'));
  assert.equal(recovery.notes[0].summary, 'My unsaved local interpretation');
  await page.getByRole('button', { name: 'Reload server data', exact: true }).click();
  await page.locator('.app-sync-status').waitFor({ state: 'hidden' });
  await page.getByText('Remote version · 保留', { exact: true }).first().waitFor();
  checks.push('Repeatable/missing note deep links and real editor conflict retain downloadable local edits without overwriting the server');

  await api('DELETE', `/connections/${tokenResponse.body.connection.id}`);
  assert.equal((await fetch(`${origin}/api/v1/workspace`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  checks.push('API token changes reach UI; saved text stays frozen; stale writes and revoked tokens are rejected');

  let backup = (await api('GET', '/workspace')).body.data;
  backup = saveMap(saveMap(backup, savedMap.id), savedMap.id);
  const archive = await downloadBackup(backup);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByLabel('Choose import file', { exact: true }).setInputFiles({ name: archive.filename, mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await waitForWorkspace(data => data.maps[0]?.history?.length === backup.maps[0].history.length);
  assert.deepEqual((await api('GET', '/workspace')).body.data.maps[0].history, backup.maps[0].history);
  checks.push('Real ZIP backup restores a nonempty account with multiple frozen historical revisions');

  await page.goto(`${origin}/#/settings`);
  await page.getByRole('heading', { name: 'AI & integrations', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Activity', exact: true }).count(), 0);
  assert.equal(await page.locator('.app-legacy-import').count(), 0, 'Legacy browser import is not exposed in Settings.');
  assert.equal(await page.locator('.app-connections').getAttribute('open'), null, 'Connection controls start collapsed.');
  const headingStyles = await page.locator('.app-settings-heading h2').evaluateAll(headings => headings.map(heading => {
    const style = getComputedStyle(heading);
    return [style.fontFamily, style.fontSize, style.fontWeight, style.color];
  }));
  assert.equal(new Set(headingStyles.map(style => JSON.stringify(style))).size, 1, 'Settings section titles share one typography style.');
  assert.deepEqual(activityRequests, [], 'Settings does not fetch hidden activity data.');
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(screenshots, 'settings-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await waitForWorkspace(data => data.theme === 'dark');
  await page.screenshot({ path: path.join(screenshots, 'settings-dark.png'), fullPage: true });
  const darkHeading = await page.getByRole('heading', { name: 'Appearance', exact: true }).evaluate(heading => getComputedStyle(heading).color);
  assert.notEqual(darkHeading, headingStyles[0][3], 'Settings titles follow the selected theme.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(screenshots, 'settings-mobile-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.sidebar.is-open').count(), 0, 'Opening Settings from the avatar closes mobile navigation.');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await waitForWorkspace(data => data.theme === 'light');
  await page.screenshot({ path: path.join(screenshots, 'settings-mobile-light.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('Settings sections share the theme; desktop dark/light and mobile layouts have working avatar navigation');
  await page.locator('.app-connections > summary').click();
  await page.getByLabel('Token name', { exact: true }).fill('UI integration');
  await page.screenshot({ path: path.join(screenshots, 'settings-connections.png'), fullPage: true });
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const formFits = await page.locator('.app-token-form').evaluate(form => {
      const bounds = form.getBoundingClientRect();
      return [...form.querySelectorAll('input, button')].every(control => {
        const rect = control.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right;
      });
    });
    assert.ok(formFits, `Connection controls fit the Settings card at ${width}px.`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('checkbox', { name: 'write', exact: true }).check();
  await page.getByRole('button', { name: 'Create token', exact: true }).click();
  const visibleToken = await page.locator('.app-token-once code').textContent();
  assert.equal((await fetch(`${origin}/api/v1/workspace/status`, { headers: { Authorization: `Bearer ${visibleToken}` } })).status, 200);
  await page.getByRole('button', { name: 'Rename UI integration', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename UI integration', exact: true }).fill('Renamed UI integration');
  await page.getByRole('button', { name: 'Save UI integration', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke Renamed UI integration', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke token', exact: true }).click();
  await page.getByText('API token revoked', { exact: true }).waitFor();
  assert.equal((await fetch(`${origin}/api/v1/workspace/status`, { headers: { Authorization: `Bearer ${visibleToken}` } })).status, 401);
  checks.push('Settings creates, renames and revokes a real API token');

  const legacyBackup = structuredClone(backup);
  legacyBackup.notes[0].summary = 'Legacy source · 不导入';
  await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: STORAGE_KEY, data: legacyBackup });
  await page.reload();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.locator('.app-legacy-import, .app-activity-list').count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Activity', exact: true }).count(), 0);
  assert.equal(await page.getByText('Replace with browser data', { exact: true }).count(), 0);
  assert.deepEqual(activityRequests, [], 'Settings never requests the removed activity section.');
  assert.equal((await api('GET', '/workspace')).body.data.notes[0].summary, backup.notes[0].summary);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY), legacyBackup);
  checks.push('Settings omits Activity and browser migration, makes no activity requests, and leaves legacy browser data and account notes unchanged');

  const owner = (await api('GET', '/auth/me')).body.user;
  await pool.query(`INSERT INTO api_connections(id,user_id,name,token_hash,scopes,created_at,revoked_at)
    SELECT id,$1,'History token '||ordinality,'revoked-fixture-'||id::text,ARRAY['read'],now()-ordinality*interval '1 ms',now()
    FROM unnest($2::uuid[]) WITH ORDINALITY AS fixture(id,ordinality)`, [owner.id, Array.from({ length: 55 }, () => randomUUID())]);
  await page.reload();
  await page.locator('.app-connections > summary').click();
  await page.getByRole('button', { name: 'Load more connections', exact: true }).click();
  await page.getByText('History token 55', { exact: true }).waitFor();
  assert.ok(await page.locator('.app-token-list .app-management-row').count() > 50);
  assert.equal(await page.getByRole('button', { name: 'Rename History token 55', exact: true }).count(), 0);
  checks.push('Settings paginates past 50 connections and shows revoked history correctly');

  await stopServer();
  await startServer();
  await page.goto(`${origin}/#/dashboard`); await page.reload();
  await page.getByText(backup.notes[0].summary, { exact: true }).first().waitFor();
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto(origin);
  await secondPage.getByLabel('Email', { exact: true }).fill(email);
  await secondPage.getByLabel('Password', { exact: true }).fill(password);
  await secondPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await secondPage.getByText(backup.notes[0].summary, { exact: true }).first().waitFor();
  await secondContext.close();
  checks.push('Server restart retains database content and session; a separate browser context can sign in and read the same library');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300); // Let the off-canvas responsive transition finish.
  const mobileSidebar = await page.locator('.sidebar').boundingBox();
  assert.ok(mobileSidebar.x + mobileSidebar.width <= 1, 'Closed mobile navigation is fully off screen.');
  await page.screenshot({ path: path.join(screenshots, 'mobile-notes.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/#/notes/${note.id}`);
  await page.getByRole('button', { name: 'Edit note', exact: true }).click();
  await page.getByLabel('One-line summary', { exact: false }).fill('Account A private pending text');
  const beforeSwitch = (await api('GET', '/workspace')).body;
  const accountB = await createAccount(pool, { email: `other-${randomUUID()}@example.test`, password }, false);
  // Same revision removes the ordinary stale-write guard as an accidental defense.
  await pool.query('UPDATE workspaces SET revision=$1 WHERE owner_id=$2', [beforeSwitch.revision, accountB.id]);
  const switchTab = await context.newPage();
  await switchTab.goto(`${origin}/#/settings`);
  await switchTab.getByRole('button', { name: 'Sign out', exact: true }).click();
  await switchTab.getByLabel('Email', { exact: true }).fill(accountB.email);
  await switchTab.getByLabel('Password', { exact: true }).fill(password);
  await switchTab.getByRole('button', { name: 'Sign in', exact: true }).click();
  await switchTab.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  const rejectedRequest = page.waitForResponse(response => response.url().endsWith('/api/v1/workspace') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: /Save note/ }).click();
  const accountRejection = await rejectedRequest;
  assert.equal(accountRejection.status(), 409);
  assert.equal((await accountRejection.json()).error.code, 'ACCOUNT_CHANGED');
  const bContent = await switchTab.evaluate(async () => (await (await fetch('/api/v1/workspace')).json()).data);
  assert.equal(bContent.notes.length, 0);
  assert.equal(bContent.maps.length, 0);
  await page.getByRole('button', { name: 'Download local changes', exact: true }).waitFor();
  await switchTab.close();
  checks.push('Two tabs switching accounts at equal workspace revisions cannot leak or overwrite the other account; pending text remains recoverable');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(screenshots, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  if (browser) { const pages = browser.contexts().flatMap(context => context.pages()); await pages[0]?.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {}); }
  throw error;
} finally {
  await browser?.close();
  await stopServer();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
