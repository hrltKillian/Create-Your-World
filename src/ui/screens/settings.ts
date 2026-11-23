import { fmtNumber } from '../../i18n/fmt.ts';
import { t } from '../../i18n/i18n.ts';
import {
  FOV_RANGE,
  RENDER_DISTANCES,
  SENSITIVITY_RANGE,
  type Settings,
  type Volumes,
} from '../../platform/settings.ts';
import { h } from '../h.ts';
import { menuButton, menuPanel, type Slider, slider } from './menuParts.ts';

const VOLUME_BUSES: readonly (keyof Volumes)[] = ['master', 'effects', 'ambience', 'ui'];
const percent = (value: number) => t('settings.percent', { n: fmtNumber(value) });

/**
 * The Settings screen: render distance presets and field of view, mouse sensitivity and inverted
 * look, and the four volumes. Every change is sent at once (`onChange`): the app applies and
 * stores it. Sliders show percents; settings keep factors (0–1, or the sensitivity factor).
 */
export class SettingsScreen {
  readonly element: HTMLElement;
  private settings: Settings | null = null;
  private readonly distances: HTMLInputElement[] = [];
  private readonly fov: Slider;
  private readonly sensitivity: Slider;
  private readonly invertY: HTMLInputElement;
  private readonly volumes: Record<keyof Volumes, Slider>;

  constructor(onChange: (settings: Settings) => void, back: () => void) {
    const change = (patch: Partial<Settings>) => {
      if (!this.settings) return;
      this.settings = { ...this.settings, ...patch };
      onChange(this.settings);
    };
    for (const n of RENDER_DISTANCES) {
      const radio = h('input', {
        attrs: { type: 'radio', name: 'renderDistance', value: String(n) },
      });
      radio.addEventListener('change', () => change({ renderDistance: n }));
      this.distances.push(radio);
    }
    const presets = h(
      'div',
      { class: 'segmented', attrs: { role: 'radiogroup' } },
      ...this.distances.map((radio) =>
        h('label', { class: 'segment' }, radio, h('span', null, t(`settings.rd.${radio.value}`))),
      ),
    );
    this.fov = slider(
      'fov',
      t('settings.fov'),
      { ...FOV_RANGE, step: 1 },
      (value) => t('settings.degrees', { n: fmtNumber(value) }),
      (value) => change({ fov: value }),
    );
    this.sensitivity = slider(
      'sensitivity',
      t('settings.sensitivity'),
      { min: SENSITIVITY_RANGE.min * 100, max: SENSITIVITY_RANGE.max * 100, step: 5 },
      percent,
      (value) => change({ sensitivity: value / 100 }),
    );
    this.invertY = h('input', { attrs: { type: 'checkbox', name: 'invertY' } });
    this.invertY.addEventListener('change', () => change({ invertY: this.invertY.checked }));
    const volume = (bus: keyof Volumes) =>
      slider(bus, t(`settings.volume.${bus}`), { min: 0, max: 100, step: 5 }, percent, (value) =>
        change({ volumes: { ...this.settings!.volumes, [bus]: value / 100 } }),
      );
    this.volumes = {
      master: volume('master'),
      effects: volume('effects'),
      ambience: volume('ambience'),
      ui: volume('ui'),
    };
    const done = menuButton('back', t('menu.back'), back, 'button');
    this.element = menuPanel(
      'screen-settings',
      'settings.title',
      group(
        'settings.graphics',
        h(
          'div',
          { class: 'setting' },
          h('span', { class: 'setting-label' }, t('settings.renderDistance')),
          presets,
        ),
        this.fov.element,
      ),
      group(
        'settings.controls',
        this.sensitivity.element,
        h(
          'label',
          { class: 'setting setting-check' },
          this.invertY,
          h('span', { class: 'setting-label' }, t('settings.invertY')),
        ),
      ),
      group('settings.audio', ...VOLUME_BUSES.map((bus) => this.volumes[bus].element)),
      h('div', { class: 'menu-row' }, done),
    );
  }

  /** Shows the current settings (call before the screen opens). */
  show(settings: Settings): void {
    this.settings = settings;
    for (const radio of this.distances)
      radio.checked = Number(radio.value) === settings.renderDistance;
    this.fov.set(settings.fov);
    this.sensitivity.set(Math.round(settings.sensitivity * 100));
    this.invertY.checked = settings.invertY;
    for (const bus of VOLUME_BUSES) this.volumes[bus].set(Math.round(settings.volumes[bus] * 100));
  }
}

function group(titleKey: string, ...content: HTMLElement[]): HTMLElement {
  return h('fieldset', { class: 'setting-group' }, h('legend', null, t(titleKey)), ...content);
}
