import { fmtBytes } from '../i18n/fmt.ts';
import { t } from '../i18n/i18n.ts';
import { exportWorld, importWorld } from '../platform/exportWorld.ts';
import { storageEstimate } from '../platform/SaveManager.ts';
import type { Settings } from '../platform/settings.ts';
import type { Storage, WorldRecord } from '../sim/storage.ts';
import { h } from '../ui/h.ts';
import { ControlsScreen } from '../ui/screens/controls.ts';
import { MainMenu } from '../ui/screens/mainMenu.ts';
import { type NewWorldForm, NewWorldScreen } from '../ui/screens/newWorld.ts';
import { PauseScreen } from '../ui/screens/pause.ts';
import { SettingsScreen } from '../ui/screens/settings.ts';
import { WorldsScreen } from '../ui/screens/worlds.ts';
import { MenuNav, type MenuScreen } from './appState.ts';
import {
  byLastPlayed,
  deleteClosedWorld,
  exportFileName,
  newWorldId,
  openErrorKey,
} from './worlds.ts';

/** What the menus ask of the app. */
export interface MenuHost {
  readonly storage: Storage;
  readonly touchOnly: boolean;
  /** Seed suggested by the New world screen (`?seed=` in dev builds). */
  readonly seed: string;
  settings(): Settings;
  /** A key's or mouse button's label on the player's keyboard layout. */
  keyLabel(code: string): string;
  /** Interface click sound. */
  click(): void;
  play(id: string): void;
  create(form: NewWorldForm): void;
  resume(): void;
  saveAndQuit(): void;
  /** After a failed Save & quit, confirmed on the pause menu. */
  quitWithoutSaving(): void;
  changeSettings(settings: Settings): void;
}

/**
 * The menu layer (docs « Menus »): the main menu, Worlds, New world, Settings with its Key
 * bindings, and the pause menu, built once and shown one at a time from a stack (Back and the
 * pause key go down one). It reads and edits
 * the stored worlds (delete, export, import) and hands play, creation, resume and quitting to
 * the app. A notice line reports what went wrong (a world open in another tab, a bad file…).
 */
export class Menus {
  readonly element: HTMLElement;
  private readonly host: MenuHost;
  private readonly nav = new MenuNav();
  private readonly main: MainMenu;
  private readonly worlds: WorldsScreen;
  private readonly newWorld: NewWorldScreen;
  private readonly settings: SettingsScreen;
  private readonly controls: ControlsScreen;
  private readonly pause: PauseScreen;
  private readonly screens: Readonly<Record<MenuScreen, HTMLElement>>;
  private readonly notice: HTMLElement;
  /** Stored worlds, most recently played first. */
  private list: WorldRecord[] = [];

  constructor(host: MenuHost) {
    this.host = host;
    this.main = new MainMenu(
      {
        play: () => {
          const last = this.list[0];
          if (last) host.play(last.id);
          else this.open('newWorld');
        },
        worlds: () => this.open('worlds'),
        settings: () => this.open('settings'),
      },
      host.touchOnly,
    );
    this.worlds = new WorldsScreen({
      play: (id) => host.play(id),
      exportWorld: (id) => void this.exportWorld(id),
      deleteWorld: (id) => void this.deleteWorld(id),
      importFile: (file) => void this.importFile(file),
      newWorld: () => this.open('newWorld'),
      back: () => this.back(),
    });
    this.newWorld = new NewWorldScreen({
      create: (form) => host.create(form),
      back: () => this.back(),
    });
    this.settings = new SettingsScreen({
      current: () => host.settings(),
      change: (settings) => host.changeSettings(settings),
      keys: () => this.open('controls'),
      back: () => this.back(),
    });
    this.controls = new ControlsScreen({
      label: (code) => host.keyLabel(code),
      change: (bindings) => host.changeSettings({ ...host.settings(), bindings }),
      back: () => this.back(),
    });
    this.pause = new PauseScreen({
      resume: () => host.resume(),
      settings: () => this.open('settings'),
      saveAndQuit: () => host.saveAndQuit(),
      quitWithoutSaving: () => host.quitWithoutSaving(),
    });
    this.screens = {
      main: this.main.element,
      worlds: this.worlds.element,
      newWorld: this.newWorld.element,
      settings: this.settings.element,
      controls: this.controls.element,
      pause: this.pause.element,
    };
    this.notice = h('p', { class: 'menu-notice', attrs: { role: 'alert' } });
    this.element = h(
      'div',
      { id: 'menus', class: 'menu-layer' },
      this.notice,
      ...Object.values(this.screens),
    );
    // Every menu button clicks (the sound plays once the audio context exists).
    this.element.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) host.click();
    });
    this.render();
  }

  /** The screen shown, null when the menus are closed. */
  screen(): MenuScreen | null {
    return this.nav.current;
  }

  /** The main menu over its backdrop, the worlds read again; `notice`: an i18n key to show. */
  async openMain(notice: string | null = null): Promise<void> {
    await this.refresh();
    this.nav.reset('main');
    this.element.classList.remove('over-world');
    this.render(notice);
  }

  /** The pause menu over the world. */
  openPause(worldName: string): void {
    this.pause.setWorld(worldName);
    this.pause.setStatus(null);
    this.pause.setBusy(false);
    this.pause.setFailed(false);
    this.nav.reset('pause');
    this.element.classList.add('over-world');
    this.render();
  }

  close(): void {
    this.nav.close();
    this.render();
  }

  /** Back one screen (Back, Esc); false at the main or pause menu. */
  back(): boolean {
    if (!this.nav.back()) return false;
    // Back from Key bindings: the settings as they are now.
    if (this.nav.current === 'settings') this.settings.show(this.host.settings());
    this.render();
    return true;
  }

  /** Shows the save state on the pause menu (an i18n key, or null). */
  setSaveStatus(key: string | null): void {
    this.pause.setStatus(key);
  }

  /** Save & quit is under way: the pause menu waits. */
  setQuitting(quitting: boolean): void {
    this.pause.setBusy(quitting);
    if (quitting) this.pause.setStatus('save.status.saving');
  }

  /** A later save went through: the failure box of a failed Save & quit goes away. */
  clearQuitFailed(): void {
    this.pause.setFailed(false);
    this.render();
  }

  /** Save & quit failed, the world still open: the pause menu says so, with what to do next. */
  quitFailed(): void {
    this.pause.setBusy(false);
    this.pause.setFailed(true);
    this.render();
  }

  private open(screen: MenuScreen): void {
    if (screen === 'settings') this.settings.show(this.host.settings());
    else if (screen === 'controls') this.controls.show(this.host.settings().bindings);
    else if (screen === 'worlds') this.showWorlds();
    else if (screen === 'newWorld')
      this.newWorld.reset(t('newWorld.defaultName', { n: this.list.length + 1 }), this.host.seed);
    this.nav.open(screen);
    this.render();
  }

  /** Shows the current screen (and the notice: an i18n key, cleared by default), focused. */
  private render(notice: string | null = null): void {
    const current = this.nav.current;
    // A key the Key bindings screen waited for is not awaited once it is gone.
    if (current !== 'controls') this.controls.stop();
    this.element.hidden = current === null;
    for (const [name, element] of Object.entries(this.screens)) element.hidden = name !== current;
    this.notice.textContent = notice === null ? '' : t(notice);
    this.notice.hidden = notice === null;
    if (current) this.screens[current].querySelector<HTMLElement>('input, button')?.focus();
  }

  /** Reads the stored worlds again (the main menu's Continue and the Worlds screen). */
  private async refresh(): Promise<void> {
    try {
      this.list = byLastPlayed(await this.host.storage.listWorlds());
    } catch {
      this.list = [];
    }
    this.main.setContinue(this.list[0]?.name ?? null);
  }

  /** The world cards, then the storage line once the browser has estimated it. */
  private showWorlds(): void {
    this.worlds.show(this.list);
    void storageEstimate().then((estimate) => {
      this.worlds.setUsage(
        estimate && estimate.quota > 0
          ? t('worlds.storage', { used: fmtBytes(estimate.usage), quota: fmtBytes(estimate.quota) })
          : null,
      );
    });
  }

  /** After a change to the stored worlds: the list again, and a notice if any. */
  private async changed(notice: string | null): Promise<void> {
    await this.refresh();
    this.showWorlds();
    this.render(notice);
  }

  private async exportWorld(id: string): Promise<void> {
    try {
      const bytes = await exportWorld(this.host.storage, id);
      const name = this.list.find((world) => world.id === id)?.name ?? id;
      download(bytes, exportFileName(name));
    } catch {
      this.render('error.export');
    }
  }

  /** Deletes a world, unless another tab is playing it. */
  private async deleteWorld(id: string): Promise<void> {
    try {
      if (await deleteClosedWorld(this.host.storage, id)) await this.changed(null);
      else this.render('error.world.locked');
    } catch {
      this.render('error.delete');
    }
  }

  private async importFile(file: File): Promise<void> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await importWorld(this.host.storage, bytes, newWorldId());
      await this.changed('worlds.imported');
    } catch (error) {
      this.render(openErrorKey(error, 'error.import'));
    }
  }
}

/** Hands bytes to the browser as a file download. */
function download(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);
  h('a', { attrs: { href: url, download: fileName } }).click();
  // The download has started from the URL by then.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
