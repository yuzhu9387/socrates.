import { chromium } from '/Users/guoyuzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, executablePath: '/Users/guoyuzhu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(7000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('socrates-uiux-v1')));
const region = (data) => data.maps.find((map) => map.id === 'map-expression').nodes.find((node) => node.type === 'shape');
try {
  await page.goto('http://127.0.0.1:4173/#/brainstorm/map-expression');
  await page.waitForLoadState('networkidle');
  const notes = (await state()).notes;
  await page.getByRole('button', { name: 'Draw a shape', exact: true }).click();
  await page.getByRole('button', { name: /Rectangle.*Drag to draw/ }).click();
  const canvas = await page.locator('.board-canvas').boundingBox();
  await page.mouse.move(canvas.x + 70, canvas.y + 100);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 330, canvas.y + 295, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const initial = region(await state());
  assert.ok(initial, 'drawing creates a real region in the draft');
  const handle = page.locator(`[data-region-resizer="${initial.id}"] .react-flow__resize-control.handle.bottom.right`);
  await handle.click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator('.board-root.is-dragging').count(), 0, 'clicking a handle without moving cannot latch the gesture');
  assert.deepEqual(region(await state()).style, initial.style);

  let box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 55, { steps: 12 });
  assert.equal(await page.locator('.board-root.is-dragging').count(), 1);
  assert.deepEqual(region(await state()).style, initial.style, 'a live resize does not synchronously persist on each move');
  await page.mouse.up();
  await page.waitForTimeout(120);
  const resized = region(await state());
  assert.ok(resized.style.width > initial.style.width + 30 && resized.style.height > initial.style.height + 20);
  assert.equal(await page.locator('.board-root.is-dragging').count(), 0);
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(120);
  assert.deepEqual(region(await state()).style, initial.style, 'one undo reverses the complete resize');
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(120);
  assert.deepEqual(region(await state()).style, resized.style);

  // Restore selection through Layers, since Undo intentionally clears it.
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click();
  await page.locator('.board-layer-row').filter({ hasText: 'A space for ideas' }).click();
  await page.waitForTimeout(350);
  box = await handle.boundingBox();
  const start = { id: 1, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const client = await context.newCDPSession(page);
  const touch = (type, touchPoints) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  await touch('touchStart', [start]);
  let first;
  for (let step = 1; step <= 8; step++) {
    first = { ...start, x: start.x + step * 5, y: start.y + step * 3 };
    await touch('touchMove', [first]);
  }
  assert.equal(await page.locator('.board-root.is-dragging').count(), 1, 'touch resize enters a transaction');
  const surface = await page.locator('.board-canvas').boundingBox();
  const second = { id: 2, x: Math.round(surface.x + surface.width - 30), y: Math.round(surface.y + 70) };
  await touch('touchStart', [first, second]);
  await touch('touchMove', [{ ...first, x: first.x + 5 }, { ...second, x: second.x - 5 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(120);
  assert.equal(await page.locator('.board-root.is-dragging').count(), 0, 'a second finger cannot leave resize active after release');
  assert.deepEqual((await state()).notes, notes, 'region creation and resizing preserve every source note');
  const completed = region(await state());
  await page.reload();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(region(await state()), completed, 'final region size persists through reload');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: ['No-movement resize-handle click', 'Live resize with deferred persistence', 'Single-action resize Undo/Redo', 'Real touch resize and second-finger release', 'Reload and source-note independence'], errors }, null, 2));
} finally {
  await browser.close();
}
