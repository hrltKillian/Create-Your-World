import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { CI_FACTOR, gameReady, type Hook, pageErrors } from './selftest.ts';

/**
 * Real input (docs « Entrées »): trusted key and mouse events sent through the DevTools protocol,
 * as a keyboard and a mouse would, on the flat world in fixed steps (ticks advance only through
 * `sim.step`, so a held key or button acts for exactly those ticks). Keys bind by physical
 * position (`KeyboardEvent.code`): the key above S moves forward whether it types w (QWERTY) or
 * z (AZERTY); the key the AZERTY layout labels W (code KeyZ) is bound to nothing.
 */

const FLAT = '/?storage=memory&noLock=1&skipMenu=1&seed=42&worldType=flat&fixedStep=1&mute=1';
/** Ticks a key is held, and what they cover at walking speed (4.3 m/s: about 2.9 m). */
const HOLD_TICKS = 20;
const MIN_WALKED = 1;
/** « grass breaks in 41 ticks » by hand (selftest m4). */
const DIG_TICKS = 60;

/** A key's down or up, with what it types on this layout (`key`) at a physical position. */
async function key(cdp: CDPSession, type: 'keyDown' | 'keyUp', code: string, typed: string) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: type === 'keyDown' ? 'rawKeyDown' : type,
    code,
    key: typed,
  });
}

/** Holds a key for HOLD_TICKS fixed steps, then releases it; returns the distance walked (m). */
async function walkWith(page: Page, cdp: CDPSession, code: string, typed: string): Promise<number> {
  const position = () => page.evaluate(() => (window.__game as Hook).player.get()!);
  const before = await position();
  await key(cdp, 'keyDown', code, typed);
  await page.evaluate((ticks) => (window.__game as Hook).sim.step(ticks), HOLD_TICKS);
  await key(cdp, 'keyUp', code, typed);
  // The body slows down to a stop.
  await page.evaluate(() => (window.__game as Hook).sim.step(10));
  const after = await position();
  return Math.hypot(after.x - before.x, after.z - before.z);
}

/** The flat world meshed around the player, who looks north; a DevTools session to type with. */
async function openFlatWorld(page: Page, query = ''): Promise<CDPSession> {
  await page.goto(`${FLAT}${query}`);
  await gameReady(page);
  await page.evaluate(async () => {
    const game = window.__game as Hook;
    await game.world.waitForChunks();
    // Along −z, level.
    game.input.look(0, 0);
  });
  return page.context().newCDPSession(page);
}

test('movement keys bind by physical position: KeyW walks typing w or z; the AZERTY w key does not', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const cdp = await openFlatWorld(page, '&kb=azerty');
  // ?kb=azerty: the labels of an AZERTY keyboard.
  const labels = await page.evaluate(() =>
    ['forward', 'left'].map((action) => (window.__game as Hook).input.keyLabel(action)),
  );
  expect(labels).toEqual(['Z', 'Q']);
  expect(await walkWith(page, cdp, 'KeyW', 'z')).toBeGreaterThan(MIN_WALKED);
  expect(await walkWith(page, cdp, 'KeyW', 'w')).toBeGreaterThan(MIN_WALKED);
  expect(await walkWith(page, cdp, 'KeyZ', 'w')).toBeLessThan(0.01);
  expect(await walkWith(page, cdp, 'KeyA', 'q')).toBeGreaterThan(MIN_WALKED);
  expect(await page.evaluate(() => (window.__game as Hook).errors())).toEqual([]);
  expect(errors, 'uncaught page errors').toEqual([]);
});

test('the left button held digs the block under the crosshair; digits, the wheel and E work', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const cdp = await openFlatWorld(page);
  // Straight down at the grass under the feet.
  const cell = await page.evaluate(async () => {
    const game = window.__game as Hook;
    game.input.look(0, -Math.PI / 2);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return game.render.target()?.block ?? null;
  });
  expect(cell, 'no block under the crosshair').not.toBeNull();
  const { x, y, z } = cell!;
  const air = await page.evaluate(
    ({ x, y, z }) => (window.__game as Hook).world.block(x, y + 2, z),
    cell!,
  );
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.down();
  await page.evaluate((ticks) => (window.__game as Hook).sim.step(ticks), DIG_TICKS);
  await page.mouse.up();
  expect(
    await page.evaluate((c) => (window.__game as Hook).world.block(c.x, c.y, c.z), { x, y, z }),
  ).toBe(air);

  const selected = () => page.evaluate(() => (window.__game as Hook).ui.hotbar()?.selected);
  await key(cdp, 'keyDown', 'Digit3', '"');
  await key(cdp, 'keyUp', 'Digit3', '"');
  // The hotbar shows the slot on the next frame.
  await expect.poll(selected, { timeout: 5000 * CI_FACTOR }).toBe(2);
  // One notch of a mouse wheel (60 px or more: one slot, InputManager's WHEEL_STEP).
  await page.mouse.wheel(0, 60);
  await expect.poll(selected, { timeout: 5000 * CI_FACTOR }).toBe(3);

  const screen = () => page.evaluate(() => (window.__game as Hook).ui.screen());
  await key(cdp, 'keyDown', 'KeyE', 'e');
  await key(cdp, 'keyUp', 'KeyE', 'e');
  await expect.poll(screen, { timeout: 5000 * CI_FACTOR }).toBe('bag');
  await key(cdp, 'keyDown', 'KeyE', 'e');
  await key(cdp, 'keyUp', 'KeyE', 'e');
  await expect.poll(screen, { timeout: 5000 * CI_FACTOR }).toBe(null);
  expect(await page.evaluate(() => (window.__game as Hook).errors())).toEqual([]);
  expect(errors, 'uncaught page errors').toEqual([]);
});
