import { i18nMissing, t } from '../../i18n/i18n.ts';
import { DEFAULT_BINDINGS } from '../../input/bindings.ts';
import { loadSettings, SETTINGS_KEY } from '../../platform/settings.ts';
import { QUALITIES, QUALITY_PRESETS } from '../../render/quality.ts';
import { canonicalJson } from '../../sim/stateHash.ts';
import type { App } from '../App.ts';
import { click } from './menuSteps.ts';
import {
  assert,
  needsFlatPlayer,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
} from './support.ts';

/**
 * M11 settings checks (docs « Interface » → Settings, « Entrées »), in the flat world with fixed
 * steps (?worldType=flat&fixedStep=1), driven through the pause menu by clicks and key presses as
 * a player does: a key rebound on the Key bindings screen applies at once, is stored under
 * cyw.settings.v1 and read back, conflicts are refused, and the pause and debug keys follow it;
 * the particles, view bob, quality presets (the pixel ratio), crouch mode, interface scale and
 * gamma apply at once. Each case puts the player's stored settings back and returns to play.
 */

/** Runs `body` from the Settings screen (over the pause menu), then restores and plays again. */
async function onSettingsScreen(app: App, body: () => Promise<void> | void): Promise<void> {
  const game = app.game!;
  const stored = localStorage.getItem(SETTINGS_KEY);
  const before = game.settings;
  game.pause();
  assert(game.menus.screen() === 'pause', `pausing showed ${game.menus.screen()}`);
  try {
    click('#screen-pause [data-action="settings"]');
    assert(game.menus.screen() === 'settings', `Settings showed ${game.menus.screen()}`);
    await body();
    assert(i18nMissing().length === 0, `missing strings: ${i18nMissing().join(', ')}`);
  } finally {
    // The player's own settings come back (a selftest page plays on the defaults).
    game.changeSettings(before);
    if (stored === null) localStorage.removeItem(SETTINGS_KEY);
    else localStorage.setItem(SETTINGS_KEY, stored);
    let screen = game.menus.screen();
    while (screen !== null && screen !== 'pause' && game.menus.back()) screen = game.menus.screen();
    if (screen === 'pause') click('#screen-pause [data-action="resume"]');
  }
  assert(game.menus.screen() === null, `Resume left ${game.menus.screen()} open`);
}

/** A key pressed and released (the game and the screens listen on the window). */
/**
 * A key pressed as the keyboard sends it: at the focused element, so the window's capture
 * listeners (the Key bindings screen waiting for a key) come before its others (the pause key).
 */
function press(code: string, key = code): void {
  const target = document.activeElement ?? document.body;
  for (const type of ['keydown', 'keyup'] as const)
    target.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
}

/** A key slot's button on the Key bindings screen (`jump:0`…). */
function keySlot(bind: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `#screen-controls [data-bind="${bind}"]`,
  );
  assert(button, `no key slot ${bind}`);
  return button;
}

/** Clicks a key slot, then presses a key for it. */
function rebindBy(bind: string, code: string, key = code): void {
  click(`#screen-controls [data-bind="${bind}"]`);
  assert(keySlot(bind).classList.contains('waiting'), `the ${bind} slot does not wait for a key`);
  press(code, key);
}

function controlsStatus(): string {
  return document.querySelector('#screen-controls .controls-status')?.textContent ?? '';
}

function settingsField(selector: string): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>(`#screen-settings ${selector}`);
  assert(field, `no ${selector} on the Settings screen`);
  return field;
}

const rebindingCase: SelftestCase = {
  name: 'a key rebound by clicks applies at once, is stored and read back; pause and debug follow',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    const game = app.game!;
    const input = app.input!;
    await onSettingsScreen(app, () => {
      click('#screen-settings [data-action="controls"]');
      assert(game.menus.screen() === 'controls', `Key bindings showed ${game.menus.screen()}`);
      rebindBy('jump:0', 'KeyK', 'k');
      assert(input.bindings.jump[0] === 'KeyK', `jump is bound to ${input.bindings.jump}`);
      const label = input.labels.label('KeyK');
      assert(
        keySlot('jump:0').textContent === label,
        `the jump slot shows "${keySlot('jump:0').textContent}"`,
      );
      const read = loadSettings();
      assert(
        canonicalJson(read.bindings) === canonicalJson(input.bindings),
        `read back ${JSON.stringify(read.bindings)}`,
      );

      // A key another action holds is refused, and the line says so.
      rebindBy('forward:0', 'KeyK', 'k');
      assert(input.bindings.forward[0] === 'KeyW', `forward moved to ${input.bindings.forward}`);
      const taken = t('controls.taken', { key: label, action: t('action.jump') });
      assert(controlsStatus() === taken, `the line says "${controlsStatus()}"`);
      // Esc stops waiting and stays on the screen.
      rebindBy('forward:0', 'Escape');
      assert(game.menus.screen() === 'controls', `Esc while waiting showed ${game.menus.screen()}`);
      assert(!keySlot('forward:0').classList.contains('waiting'), 'Esc did not stop the wait');

      // The debug overlay toggles on its new key.
      rebindBy('debug:0', 'KeyO', 'o');
      const overlay = app.overlay!;
      const shown = overlay.isVisible();
      press('KeyO', 'o');
      assert(overlay.isVisible() !== shown, 'the rebound debug key does not toggle the overlay');
      press('KeyO', 'o');

      // The pause key goes back a screen on its new key, and Esc no longer does.
      rebindBy('pause:0', 'KeyP', 'p');
      press('Escape');
      assert(game.menus.screen() === 'controls', `Esc showed ${game.menus.screen()}`);
      press('KeyP', 'p');
      assert(game.menus.screen() === 'settings', `P showed ${game.menus.screen()}, not Settings`);

      click('#screen-settings [data-action="controls"]');
      click('#screen-controls [data-action="reset-keys"]');
      const defaults = canonicalJson(DEFAULT_BINDINGS);
      assert(canonicalJson(input.bindings) === defaults, 'Reset did not restore the default keys');
      assert(
        canonicalJson(loadSettings().bindings) === defaults,
        'the default keys are not stored',
      );
      assert(keySlot('jump:0').textContent === input.labels.label('Space'), 'the jump slot label');
    });
  },
};

const liveCase: SelftestCase = {
  name: 'particles, view bob, quality presets (pixel ratio), crouch mode, UI scale and gamma apply at once',
  scenes: PLAY_SCENES,
  skip: (app) =>
    app.params.quality !== null
      ? 'needs no ?quality= (it overrides the resolution and the particles)'
      : __BENCH__ || app.params.bench
        ? 'the bench build renders at a fixed pixel ratio'
        : needsFlatPlayer(app),
  run: async (app) => {
    const session = await playerSession(app);
    const game = app.game!;
    const webgl = app.renderer!.webgl;
    await onSettingsScreen(app, () => {
      settingsField('input[name="particles"]').click();
      assert(!session.play.particles.enabled, 'the particles are still on');
      settingsField('input[name="viewBob"]').click();
      assert(!session.rig.viewBob, 'the view bob is still on');
      settingsField('input[name="viewBob"]').click();
      assert(session.rig.viewBob, 'the view bob is still off');

      for (const quality of QUALITIES) {
        settingsField(`input[name="quality"][value="${quality}"]`).click();
        const preset = QUALITY_PRESETS[quality];
        const cap = Math.min(window.devicePixelRatio || 1, preset.pixelRatio);
        const ratio = cap * app.params.renderScale;
        assert(
          webgl.getPixelRatio() === ratio,
          `${quality}: pixel ratio ${webgl.getPixelRatio()}, not ${ratio}`,
        );
        assert(session.play.particles.enabled === preset.particles, `${quality}: particles`);
        const rd = app.params.rd ?? preset.renderDistance;
        assert(
          session.renderDistance === rd,
          `${quality}: render distance ${session.renderDistance}`,
        );
      }

      settingsField('input[name="crouch"][value="toggle"]').click();
      assert(app.input!.crouchToggle, 'crouch is not a toggle');

      const scale = settingsField('input[name="uiScale"]');
      scale.value = '125';
      scale.dispatchEvent(new Event('input'));
      assert(game.settings.uiScale === 1.25, `UI scale ${game.settings.uiScale}`);
      const zoom = Number.parseFloat(getComputedStyle(game.menus.element).getPropertyValue('zoom'));
      assert(Math.abs(zoom - 1.25) < 1e-6, `the menus are zoomed ${zoom}, not 1.25`);

      // Gamma (plan v3 « M28 »): the light curve's brightness, in the shaders at once.
      const gamma = settingsField('input[name="gamma"]');
      gamma.value = '100';
      gamma.dispatchEvent(new Event('input'));
      const uniform = app.view!.materials.uniforms.uGamma;
      assert(game.settings.gamma === 1 && uniform.value === 1, `gamma ${uniform.value}, not 1`);
    });
    const restored = app.view!.materials.uniforms.uGamma.value;
    assert(restored === game.settings.gamma, `gamma ${restored} after the settings came back`);
    const zoom = Number.parseFloat(getComputedStyle(game.menus.element).getPropertyValue('zoom'));
    assert(zoom === 1, `the menus stay zoomed ${zoom} after the settings came back`);
  },
};

/** The M11 settings cases (no closing noErrorsCase: the suite adds its own). */
export const SETTINGS_CASES: readonly SelftestCase[] = [rebindingCase, liveCase];
