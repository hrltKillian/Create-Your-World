import { fmtNumber } from '../../i18n/fmt.ts';
import { t } from '../../i18n/i18n.ts';
import {
  CROUCH_MODES,
  FOV_RANGE,
  PIXEL_RATIOS,
  QUALITIES,
  qualityOf,
  RENDER_DISTANCES,
  SENSITIVITY_RANGE,
  type Settings,
  UI_SCALE_RANGE,
  type Volumes,
  withQuality,
} from '../../platform/settings.ts';
import { h } from '../h.ts';
import { menuButton, menuPanel, slider } from './menuParts.ts';

const VOLUME_BUSES: readonly (keyof Volumes)[] = ['master', 'effects', 'ambience', 'ui'];
/** Percent sliders move by this much. */
const PERCENT_STEP = 5;
const percent = (value: number) => t('settings.percent', { n: fmtNumber(value) });

export interface SettingsActions {
  /** The settings in use (a change starts from them). */
  current(): Settings;
  /** Every change, at once: the app applies and stores it. */
  change(settings: Settings): void;
  /** Opens the Key bindings screen. */
  keys(): void;
  back(): void;
}

/** A control that shows one value. */
interface Control<T> {
  readonly element: HTMLElement;
  set(value: T): void;
}

/**
 * The Settings screen (docs « Interface » → Settings): graphics (quality preset, render distance,
 * field of view, resolution, particles, view bob), controls (mouse sensitivity, inverted look,
 * crouch mode, and the Key bindings screen), the four volumes and the interface scale. Every
 * change is sent at once and the screen shows the result: a preset sets the render distance, the
 * resolution and the particles, and no preset is checked when they match none. Sliders show
 * percents; settings keep factors (0–1, or the sensitivity and scale factors).
 */
export class SettingsScreen {
  readonly element: HTMLElement;
  /** Every control, each showing its part of the settings. */
  private readonly views: readonly ((settings: Settings) => void)[];

  constructor(actions: SettingsActions) {
    const change = (next: Settings) => {
      this.show(next);
      actions.change(next);
    };
    const patch = (fields: Partial<Settings>) => change({ ...actions.current(), ...fields });
    const quality = segmented(
      'quality',
      QUALITIES,
      (q) => t(`settings.quality.${q}`),
      (q) => change(withQuality(actions.current(), q)),
    );
    const distance = segmented(
      'renderDistance',
      RENDER_DISTANCES,
      (n) => t(`settings.rd.${n}`),
      (renderDistance) => patch({ renderDistance }),
    );
    const fov = slider(
      'fov',
      t('settings.fov'),
      { ...FOV_RANGE, step: 1 },
      (value) => t('settings.degrees', { n: fmtNumber(value) }),
      (value) => patch({ fov: value }),
    );
    const resolution = segmented(
      'pixelRatio',
      PIXEL_RATIOS,
      (n) => t('settings.pixelRatio.value', { n: fmtNumber(n, decimalsOf(n)) }),
      (pixelRatio) => patch({ pixelRatio }),
    );
    const particles = checkbox('particles', 'settings.particles', (on) => patch({ particles: on }));
    const viewBob = checkbox('viewBob', 'settings.viewBob', (on) => patch({ viewBob: on }));
    const gamma = percentSlider('gamma', 'settings.gamma', { min: 0, max: 1 }, (n) =>
      patch({ gamma: n }),
    );
    const sensitivity = percentSlider(
      'sensitivity',
      'settings.sensitivity',
      SENSITIVITY_RANGE,
      (n) => patch({ sensitivity: n }),
    );
    const invertY = checkbox('invertY', 'settings.invertY', (on) => patch({ invertY: on }));
    const crouch = segmented(
      'crouch',
      CROUCH_MODES,
      (mode) => t(`settings.crouch.${mode}`),
      (mode) => patch({ crouch: mode }),
    );
    const volumes = VOLUME_BUSES.map((bus) =>
      percentSlider(bus, `settings.volume.${bus}`, { min: 0, max: 1 }, (n) =>
        patch({ volumes: { ...actions.current().volumes, [bus]: n } }),
      ),
    );
    const uiScale = percentSlider('uiScale', 'settings.uiScale', UI_SCALE_RANGE, (n) =>
      patch({ uiScale: n }),
    );
    this.views = [
      (s) => quality.set(qualityOf(s)),
      (s) => distance.set(s.renderDistance),
      (s) => fov.set(s.fov),
      (s) => resolution.set(s.pixelRatio),
      (s) => particles.set(s.particles),
      (s) => viewBob.set(s.viewBob),
      (s) => gamma.set(s.gamma),
      (s) => sensitivity.set(s.sensitivity),
      (s) => invertY.set(s.invertY),
      (s) => crouch.set(s.crouch),
      (s) => {
        for (let i = 0; i < VOLUME_BUSES.length; i++) volumes[i]!.set(s.volumes[VOLUME_BUSES[i]!]);
      },
      (s) => uiScale.set(s.uiScale),
    ];
    const keys = menuButton('controls', t('settings.keys'), () => actions.keys());
    const done = menuButton('back', t('menu.back'), actions.back, 'button');
    this.element = menuPanel(
      'screen-settings',
      'settings.title',
      group(
        'settings.graphics',
        labelled('settings.quality', quality.element),
        labelled('settings.renderDistance', distance.element),
        fov.element,
        labelled('settings.pixelRatio', resolution.element),
        particles.element,
        viewBob.element,
        gamma.element,
      ),
      group(
        'settings.controls',
        sensitivity.element,
        invertY.element,
        labelled('settings.crouch', crouch.element),
        h('div', { class: 'menu-row' }, keys),
      ),
      group('settings.audio', ...volumes.map((volume) => volume.element)),
      group('settings.interface', uiScale.element),
      h('div', { class: 'menu-row' }, done),
    );
  }

  /** Shows these settings (when the screen shows, and after each change). */
  show(settings: Settings): void {
    for (const view of this.views) view(settings);
  }
}

function group(titleKey: string, ...content: HTMLElement[]): HTMLElement {
  return h('fieldset', { class: 'setting-group' }, h('legend', null, t(titleKey)), ...content);
}

/** A setting's row: its name, then its control. */
function labelled(labelKey: string, control: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'setting' },
    h('span', { class: 'setting-label' }, t(labelKey)),
    control,
  );
}

/** One of a few values, as a segmented row of radios; a value no radio has checks none. */
function segmented<T extends string | number>(
  name: string,
  values: readonly T[],
  label: (value: T) => string,
  pick: (value: T) => void,
): Control<T | null> {
  const radios = values.map((value) => {
    const radio = h('input', { attrs: { type: 'radio', name, value: String(value) } });
    radio.addEventListener('change', () => pick(value));
    return radio;
  });
  const element = h(
    'div',
    { class: 'segmented', attrs: { role: 'radiogroup' } },
    ...radios.map((radio, i) =>
      h('label', { class: 'segment' }, radio, h('span', null, label(values[i]!))),
    ),
  );
  const set = (value: T | null) => {
    for (let i = 0; i < radios.length; i++) radios[i]!.checked = values[i] === value;
  };
  return { element, set };
}

function checkbox(name: string, labelKey: string, toggle: (on: boolean) => void): Control<boolean> {
  const box = h('input', { attrs: { type: 'checkbox', name } });
  box.addEventListener('change', () => toggle(box.checked));
  const element = h(
    'label',
    { class: 'setting setting-check' },
    box,
    h('span', { class: 'setting-label' }, t(labelKey)),
  );
  const set = (on: boolean) => {
    box.checked = on;
  };
  return { element, set };
}

/** A slider in percents (PERCENT_STEP apart) of a factor within `range`. */
function percentSlider(
  name: string,
  labelKey: string,
  range: { readonly min: number; readonly max: number },
  input: (factor: number) => void,
): Control<number> {
  const percents = { min: range.min * 100, max: range.max * 100, step: PERCENT_STEP };
  const control = slider(name, t(labelKey), percents, percent, (value) => input(value / 100));
  return { element: control.element, set: (factor) => control.set(Math.round(factor * 100)) };
}

/** Decimals that show a value such as 0.75 or 1.5 whole (0 for whole numbers, at most 2). */
function decimalsOf(n: number): number {
  if (Number.isInteger(n)) return 0;
  return Number.isInteger(n * 10) ? 1 : 2;
}
