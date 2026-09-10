import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createPool, migrate } from '../server/src/db.mjs';
import { makeSeed, saveMap } from '../demo/src/model.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
const testUrl = new URL(process.env.TEST_DATABASE_URL);
if (!/test/i.test(testUrl.pathname)) throw new Error('Refusing to capture README fixtures outside a test database.');

const schema = `readme_${randomUUID().replaceAll('-', '')}`;
const port = 3003;
const origin = `http://127.0.0.1:${port}`;
const output = path.resolve('docs/assets/screenshots');
const admin = createPool(testUrl.href);
await admin.query(`CREATE SCHEMA ${schema}`);
testUrl.searchParams.set('options', `-c search_path=${schema}`);
const pool = createPool(testUrl.href);
let server;
let browser;

function sampleWorkspace() {
  let data = makeSeed();
  const map = data.maps.find(item => item.id === 'map-expression');
  const positions = [
    { x: 110, y: 120, color: 'sage' },
    { x: 475, y: 65, color: 'sand' },
    { x: 820, y: 145, color: 'clay' },
    { x: 285, y: 405, color: 'slate' },
    { x: 665, y: 415, color: 'lilac' },
  ];
  map.nodes = map.nodes.map((node, index) => ({
    ...node,
    position: { x: positions[index].x, y: positions[index].y },
    color: positions[index].color,
    zIndex: 10 + index,
  }));
  map.nodes.push(
    {
      id: 'readme-region-listening', type: 'shape', position: { x: 55, y: 35 }, zIndex: -20,
      style: { width: 1080, height: 315 },
      data: { shape: 'rectangle', label: 'Listen before explaining', color: 'sage', strokeStyle: 'dashed' },
    },
    {
      id: 'readme-region-clarity', type: 'shape', position: { x: 205, y: 340 }, zIndex: -18,
      style: { width: 800, height: 330 },
      data: { shape: 'ellipse', label: 'Clarity through reflection', color: 'slate', strokeStyle: 'solid' },
    },
    {
      id: 'readme-annotation', type: 'annotation', position: { x: 990, y: 430 }, zIndex: 30,
      data: { label: 'What changes when I listen first?' },
    },
  );
  const labels = ['Makes visible', 'Creates space for', 'Deepens', 'Becomes'];
  map.edges = map.edges.map((edge, index) => ({
    ...edge,
    label: labels[index],
    zIndex: 25,
    ...(index === 1 ? { route: [{ x: 742, y: 88 }, { x: 774, y: 213 }] } : {}),
  }));
  map.summary = 'Listening turns honest moments into ideas worth sharing.';
  map.description = 'A fictional sample map about listening, expression, and reflection. The saved view keeps both the source notes and the relationships between them.';
  map.noteOrder = map.nodes.filter(node => node.noteId).map(node => node.noteId);
  data = saveMap(data, map.id);
  data.theme = 'light';
  data.motion = false;
  return data;
}

async function startServer() {
  server = spawn(process.execPath, ['server/src/index.mjs'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      DATABASE_URL: testUrl.href,
      PORT: String(port),
      HOST: '127.0.0.1',
      APP_ORIGIN: origin,
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`README capture server failed:\n${logs}`);
    if (logs.includes('Socrates is ready')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out starting README capture server.\n${logs}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  const force = setTimeout(() => server.kill('SIGKILL'), 10_000);
  server.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(force); }
}

async function ready(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts?.ready);
  await page.locator('.app-sync-status').waitFor({ state: 'hidden' }).catch(() => {});
  await page.waitForTimeout(250);
}

async function capture(page, name) {
  await ready(page);
  await page.screenshot({
    path: path.join(output, name),
    fullPage: false,
    animations: 'disabled',
  });
}

try {
  await fs.mkdir(output, { recursive: true });
  await migrate(pool);
  await startServer();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(origin);
  await page.getByLabel('Email', { exact: true }).fill('readme-sample@example.test');
  await page.getByLabel('Password', { exact: true }).fill(`Readme-${randomUUID()}`);
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await page.getByRole('heading', { name: 'Notes', exact: true }).waitFor();

  const imported = await page.evaluate(async data => {
    const response = await fetch('/api/v1/workspace', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Socrates-CSRF': '1' },
      body: JSON.stringify({ expectedRevision: 0, mode: 'import', data }),
    });
    return { status: response.status, body: await response.json() };
  }, sampleWorkspace());
  assert.equal(imported.status, 200, JSON.stringify(imported.body));

  await page.goto(`${origin}/#/dashboard`);
  await page.reload();
  await page.locator('.note-card').first().waitFor();
  assert.ok(await page.locator('.note-card').count() >= 6);
  await capture(page, 'dashboard.png');

  await page.goto(`${origin}/#/brainstorm/map-expression`);
  await page.locator('.board-root').waitFor();
  await page.getByRole('button', { name: 'Fit all cards in view', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.react-flow__node-shape').count(), 2);
  assert.ok(await page.locator('.react-flow__edge').count() >= 4);
  await capture(page, 'brainstorm-board.png');

  await page.goto(`${origin}/#/maps/map-expression`);
  await page.getByRole('button', { name: 'Graph View', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Graph View', exact: true }).getAttribute('aria-pressed'), 'true');
  await capture(page, 'knowledge-map-graph.png');

  await page.goto(`${origin}/#/settings`);
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Activity', exact: true }).count(), 0);
  assert.equal(await page.getByText('Import demo data', { exact: true }).count(), 0);
  assert.equal(await page.locator('.app-connections').getAttribute('open'), null);
  await capture(page, 'settings.png');

  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({
    schema,
    origin,
    account: 'readme-sample@example.test',
    screenshots: ['dashboard.png', 'brainstorm-board.png', 'knowledge-map-graph.png', 'settings.png'],
    pageErrors,
  }, null, 2));
} finally {
  await browser?.close();
  await stopServer();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
