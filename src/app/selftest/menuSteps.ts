import type { App } from '../App.ts';
import { waitUntil } from '../automation.ts';
import { assert } from './support.ts';

/**
 * The menus driven as a player does (m7): clicks on the buttons named by their `data-action`, Esc,
 * the notice line and the world cards.
 */

/** Longest wait for a menu step (save & quit, a world opened, imported or deleted). */
export const MENU_MS = 10_000;

/** Clicks an element like a player; fails when it is missing or disabled. */
export function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  assert(element, `no ${selector}`);
  assert(!(element instanceof HTMLButtonElement && element.disabled), `${selector} is disabled`);
  element.click();
}

/** The menus' notice line ('' while hidden). */
export function notice(): string {
  const line = document.querySelector<HTMLElement>('#menus .menu-notice');
  return line && !line.hidden ? (line.textContent ?? '') : '';
}

/** World ids of the cards on the Worlds screen. */
export function cards(): string[] {
  return [...document.querySelectorAll('#screen-worlds .world-card')].map(
    (card) => card.getAttribute('data-world') ?? '',
  );
}

/** Esc (unless paused), then Save & quit on the pause menu; resolves on the main menu. */
export async function quitToMenu(app: App): Promise<void> {
  const game = app.game!;
  if (app.state !== 'paused') {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape' }));
  }
  assert(game.menus.screen() === 'pause', `Esc showed ${game.menus.screen()}, not the pause menu`);
  click('#screen-pause [data-action="save-quit"]');
  await waitUntil(() => app.state === 'menu' && game.menus.screen() === 'main', {
    timeoutMs: MENU_MS,
    label: 'Save & quit did not reach the main menu',
    pollMs: 20,
  });
  assert(notice() === '', `the main menu says "${notice()}"`);
}

/** The Worlds screen, the open world saved and quit first. */
export async function worldsScreen(app: App): Promise<void> {
  const game = app.game!;
  if (game.open) await quitToMenu(app);
  if (game.menus.screen() === 'main') click('#screen-main [data-action="worlds"]');
  assert(game.menus.screen() === 'worlds', `the menus show ${game.menus.screen()}, not Worlds`);
}

/**
 * From the main menu: Worlds, New world, the form filled, Create; resolves once a world is open
 * (a world that cannot open sends the player back to the menu with a notice).
 */
export async function createThroughMenus(app: App, name: string, hostiles: boolean): Promise<void> {
  const game = app.game!;
  click('#screen-main [data-action="worlds"]');
  click('#screen-worlds [data-action="new-world"]');
  assert(game.menus.screen() === 'newWorld', `the menus show ${game.menus.screen()}`);
  const form = '#screen-new-world';
  const nameField = document.querySelector<HTMLInputElement>(`${form} input[name="name"]`);
  const hostilesBox = document.querySelector<HTMLInputElement>(`${form} input[name="hostiles"]`);
  assert(nameField && hostilesBox, 'the New world form has no name or hostiles field');
  nameField.value = name;
  hostilesBox.checked = hostiles;
  click(`${form} [data-action="create"]`);
  await waitUntil(() => app.session !== null || notice() !== '', {
    timeoutMs: MENU_MS,
    label: 'no world opened',
    pollMs: 20,
  });
  assert(app.session, `the world did not open: "${notice()}"`);
}

/** Delete on a world's card, then the confirmation; resolves once the card is gone. */
export async function deleteThroughCard(id: string): Promise<void> {
  const card = `#screen-worlds .world-card[data-world="${id}"]`;
  click(`${card} [data-action="delete"]`);
  click(`${card} [data-action="confirm-delete"]`);
  await waitUntil(() => !cards().includes(id), {
    timeoutMs: MENU_MS,
    label: `the card of world ${id} stayed`,
    pollMs: 20,
  });
  assert(notice() === '', `deleting world ${id}: "${notice()}"`);
}
