import type { BagPage } from '../../ui/screens/bag.ts';
import type { App } from '../App.ts';
import { click, clickSlot, waitForChunks } from '../automation.ts';
import { assert, playerSession, standAt } from './support.ts';

/**
 * Steps on the slot screens shared by the M13 cases (m13.ts, m13bench.ts): a player ready at a
 * spot with no screen open, the Bag opened on a page of its tab bar, a screen closed, a slot
 * clicked as the mouse does; each applied by a fixed step.
 */

/** Open ground east of the arena's features, where the Bag cases stand. */
export const SCREEN_SPOT = { x: 20, z: 8 };

/** The screens of a play session (they exist once a world is open). */
const screens = (app: App) => app.inventory!;

/** The player standing at a spot of the arena, no screen open, the cursor empty. */
export async function ready(app: App, spot = SCREEN_SPOT) {
  const session = await playerSession(app);
  screens(app).closeScreen();
  session.step(1);
  await standAt(app, spot);
  await waitForChunks(app, 1, 15_000);
  assert(session.player.cursor === null, 'the cursor holds a stack with no screen open');
  return session;
}

/** Opens the Bag (its key) on a page of its tab bar. */
export function openBag(app: App, page: BagPage): void {
  const ui = screens(app);
  ui.closeScreen();
  assert(ui.toggleBag() && ui.screen() === 'bag', `the bag key opened ${ui.screen()}`);
  assert(click(`#screen-bag [data-page="${page}"]`), `the Bag has no ${page} tab`);
  assert(ui.bag.shown() === page, `the Bag shows its ${ui.bag.shown()} page, not ${page}`);
}

/** Closes the open screen (its key) and applies it: the cursor stack goes back to the inventory. */
export function closeScreen(app: App): void {
  screens(app).closeScreen();
  app.session!.step(1);
}

/** A left (0) or right (1) click on a slot of the open screen as the mouse does, then a tick. */
export function clickAt(app: App, slot: number, button: 0 | 1 = 0, shift = false): void {
  assert(clickSlot(slot, button, shift), `slot ${slot} does not show on the open screen`);
  app.session!.step(1);
}
