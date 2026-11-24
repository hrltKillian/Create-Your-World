import { i18nMissing } from '../../i18n/i18n.ts';
import { patchSettings, type SettingsPatch } from '../../platform/settings.ts';
import type { App } from '../App.ts';
import {
  click,
  clickOutside,
  clickSlot,
  hotbarView,
  openBlock,
  reloadWorld,
  saveNow,
} from '../automation.ts';
import { onboardingState, restartOnboarding } from '../onboardingAutomation.ts';
import { byLastPlayed, deleteClosedWorld } from '../worlds.ts';

/** `__game.ui`: the HUD text, the slot screens and the menus. */
export function uiHook(app: App) {
  return {
    i18nMissing,
    /** Text of the first match of a selector, e.g. `#hud-clock`, `#hud-effects`, `#screen-death`. */
    text: (selector: string) => document.querySelector(selector)?.textContent ?? null,
    toggleDebug: () => app.overlay?.toggle(),
    /** Opens or closes the bag like its key does (no argument: toggles); returns whether it is open. */
    bag: (open?: boolean) => {
      const inventory = app.inventory;
      if (!inventory) return false;
      if (open === undefined || open !== inventory.bag.isOpen()) inventory.toggleBag();
      return inventory.bag.isOpen();
    },
    /**
     * Opens a screen; returns `screen()` after. No cell: the bag, like its key. A cell: its chest,
     * station or workbench, like secondary on it (`debug.open`: within 5 blocks, no aim needed;
     * applied at once in fixed steps, else on the next tick).
     */
    open: (x?: number, y?: number, z?: number) => {
      const inventory = app.inventory;
      if (x !== undefined && y !== undefined && z !== undefined) {
        // Like the bag's key: an open chest or station screen closes first (no pause flicker).
        if (inventory?.screen() && inventory.screen() !== 'bag') inventory.closeScreen();
        openBlock(app, x, y, z);
      } else if (inventory && inventory.screen() !== 'bag') {
        // The bag's key closes a chest or station screen first.
        if (inventory.screen()) inventory.closeScreen();
        inventory.toggleBag();
      }
      return inventory?.screen() ?? null;
    },
    /** Closes the open bag, chest or station screen like its key does; returns what is open after. */
    close: () => {
      app.inventory?.closeScreen();
      return app.inventory?.screen() ?? null;
    },
    /**
     * The open screen: 'death', 'bag' (with the Logbook), 'container', 'station' or 'workbench'
     * (with its Logbook) over the world, a menu ('main', 'worlds', 'newWorld', 'settings',
     * 'pause'), or null while playing.
     */
    screen: () =>
      (app.hud?.deathOpen() ? 'death' : null) ??
      app.inventory?.screen() ??
      app.game?.menus.screen() ??
      null,
    /**
     * A slot number: clicks that `[data-slot]` of the open screen like the mouse, button 0 (left)
     * or 1 (right), with Shift or not (false: the slot does not show). A selector: clicks the
     * first element it matches (false: none, or a disabled button).
     */
    click: (target: number | string, button: 0 | 1 = 0, shift = false) =>
      typeof target === 'number' ? clickSlot(target, button, shift) : click(target),
    /**
     * Clicks beside the open screen's panel like the mouse: throws the cursor stack (0, left) or
     * one of its items (1, right); false when no slot screen is open.
     */
    clickOutside: (button: 0 | 1 = 0) => clickOutside(button),
    /** What the hotbar shows: the selected slot and each slot's count text. */
    hotbar: () => hotbarView(app),
  };
}

/** `__game.settings`: the player settings, read and changed like the Settings screen. */
export function settingsHook(app: App) {
  return {
    /** The settings in use (as stored under `cyw.settings.v1`); null in developer scenes. */
    get: () => app.game?.settings ?? null,
    /**
     * Changes settings like the Settings screen does (applied at once and stored); `volumes` and
     * `bindings` change one entry at a time, and every field is checked as when it is read back
     * (a bad value gets its default). Returns the settings in use.
     */
    set: (patch: SettingsPatch) => {
      const game = app.game;
      if (!game) return null;
      game.changeSettings(patchSettings(game.settings, patch));
      return game.settings;
    },
  };
}

/** `__game.save`: saving, reloading, listing, inspecting and wiping worlds. */
export function saveHook(app: App) {
  /** The game's save storage (IndexedDB, or memory); throws in the developer scenes. */
  const saves = () => {
    const storage = app.game?.backend.storage;
    if (!storage) throw new Error('No save storage (developer scene)');
    return storage;
  };
  return {
    /** Saves the open world now (deflated, one transaction); resolves with the save's success. */
    now: () => saveNow(app),
    /** Save & quit, then the same world opened again; resolves once its loading radius is meshed. */
    reload: () => reloadWorld(app),
    /** The stored worlds, most recently played first. */
    worlds: async () =>
      byLastPlayed(await saves().listWorlds()).map(({ id, name, seed, savedAt }) => ({
        id,
        name,
        seed,
        savedAt,
      })),
    /** Records of a world (default: the open one) in each store: { worlds, players, columns }. */
    inspect: async (id = app.game?.open?.info.id) => {
      if (!id) throw new Error('No open world: pass a world id');
      return saves().inspect(id);
    },
    /** Deletes every stored world no tab has open (this tab's open world is kept). */
    wipeAll: async () => {
      const storage = saves();
      let deleted = 0;
      let kept = 0;
      for (const { id } of await storage.listWorlds()) {
        if (await deleteClosedWorld(storage, id)) deleted++;
        else kept++;
      }
      return { deleted, kept };
    },
  };
}

/** `__game.onboarding`: the controls card and the contextual tips (M11). */
export function onboardingHook(app: App) {
  return {
    /** Whether they may show, the card open, the tip on screen and the ones already seen. */
    state: () => onboardingState(app),
    /** Starts over as in a new browser (in memory only: the card shows); `false` turns it off. */
    restart: (on = true) => restartOnboarding(app, on),
  };
}
