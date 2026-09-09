import { chromium } from '/Users/guoyuzhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, executablePath: '/Users/guoyuzhu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(7000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('socrates-uiux-v1')));
const cardPosition = data => data.maps.find(map => map.id === 'map-expression').nodes.find(node => node.id === 'map-expression-n0').position;
try {
  await page.goto('http://127.0.0.1:4173/#/brainstorm/map-expression');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Fit all cards in view', exact: true }).click();
  await page.waitForTimeout(400);
  const initial = await state();
  const card = page.locator('[data-testid="rf__node-map-expression-n0"]');
  const box = await card.boundingBox();
  const start = { x: Math.round(box.x + 55), y: Math.round(box.y + 55), id: 1 };
  const client = await context.newCDPSession(page);
  await page.evaluate(() => {
    window.__touchSizes = [];
    document.addEventListener('touchmove', event => window.__touchSizes.push(event.touches.length), { capture: true, passive: true });
  });
  const touch = (type, touchPoints) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  await touch('touchStart', [start]);
  let first;
  for (let step = 1; step <= 10; step += 1) {
    first = { ...start, x: start.x + step * 7, y: start.y + step * 3 };
    await touch('touchMove', [first]);
  }
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.board-root.is-dragging').count(), 1, 'A real touch drag entered its active state');
  assert.deepEqual(cardPosition(await state()), cardPosition(initial), 'The live touch movement is not persisted before termination');
  const movedBox = await card.boundingBox();
  const movedPosition = await card.evaluate(element => { const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform); return { x: matrix.m41, y: matrix.m42 }; });
  assert.ok(movedBox.x > box.x + 45, 'The note actually moved under the first finger');

  // Put a second finger on open canvas: XYDrag sees two active touches and
  // takes its abort branch, which has no ordinary onNodeDragStop callback.
  const canvas = await page.locator('.board-canvas').boundingBox();
  const second = { id: 2, x: Math.round(canvas.x + canvas.width - 70), y: Math.round(canvas.y + canvas.height - 170) };
  await touch('touchStart', [first, second]);
  await touch('touchMove', [{ ...first, x: first.x + 5 }, { ...second, x: second.x - 5 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => window.__touchSizes)).includes(2), 'The app received a genuine two-touch move');
  assert.equal(await page.locator('.board-root.is-dragging').count(), 0, 'Interrupted touch drag clears the active latch');
  const completed = await state();
  assert.notDeepEqual(cardPosition(completed), cardPosition(initial), 'The terminal touch position was persisted');
  // A pinch may legitimately change the viewport. Check the card's board
  // coordinates instead of its now-zoomed browser bounding rectangle.
  assert.ok(Math.abs(cardPosition(completed).x - movedPosition.x) < 1 && Math.abs(cardPosition(completed).y - movedPosition.y) < 1, 'Abort does not snap the card back in board coordinates');
  assert.deepEqual(completed.notes, initial.notes, 'Touch movement never changes source notes');
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(120);
  assert.deepEqual(cardPosition(await state()), cardPosition(initial), 'Keyboard undo works after an aborted drag');
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(120);
  assert.deepEqual(cardPosition(await state()), cardPosition(completed), 'Keyboard redo restores the finished gesture');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: ['Actual touch drag interrupted by a second finger', 'No drag-state latch or release snapback', 'Final position persisted without changing notes', 'Keyboard undo and redo after abort'], errors }, null, 2));
} finally {
  await browser.close();
}
