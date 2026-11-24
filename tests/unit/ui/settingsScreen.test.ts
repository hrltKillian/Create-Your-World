import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, withQuality } from '../../../src/platform/settings.ts';
import { QUALITY_PRESETS } from '../../../src/render/quality.ts';
import { SettingsScreen } from '../../../src/ui/screens/settings.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';

/*
 * The Settings screen (docs « Interface » → Settings): each control sends the settings changed at
 * once, a quality preset sets the render distance, the resolution and the particles, and the
 * preset radios show which preset the settings match (none for a custom mix).
 */

beforeEach(() => installFakeDom());
afterEach(() => removeFakeDom());

type Input = FakeElement & { checked: boolean; value: string };

function setup(start: Settings = DEFAULT_SETTINGS) {
  let current = start;
  let keys = 0;
  const screen = new SettingsScreen({
    current: () => current,
    change: (next) => {
      current = next;
    },
    keys: () => keys++,
    back: () => {},
  });
  screen.show(current);
  const root = screen.element as unknown as FakeElement;
  const field = (name: string, value?: string) =>
    root.findAll(
      (e) =>
        e.tagName === 'INPUT' &&
        e.getAttribute('name') === name &&
        (value === undefined || e.getAttribute('value') === value),
    )[0] as Input;
  /** Checks a radio or a box, as a click does. */
  const pick = (name: string, value?: string) => {
    const input = field(name, value);
    input.checked = value === undefined ? !input.checked : true;
    input.dispatch('change');
  };
  const slide = (name: string, value: number) => {
    const input = field(name);
    input.value = String(value);
    input.dispatch('input');
  };
  return {
    settings: () => current,
    /** The settings changed elsewhere (the Key bindings screen, through the app). */
    elsewhere: (next: Settings) => {
      current = next;
    },
    field,
    pick,
    slide,
    keys: () => keys,
    root,
  };
}

const checked = (s: ReturnType<typeof setup>, name: string, values: readonly string[]) =>
  values.filter((value) => s.field(name, value).checked);

describe('SettingsScreen', () => {
  it('shows the settings, the Medium preset checked for the defaults', () => {
    const s = setup();
    expect(checked(s, 'quality', ['low', 'medium', 'high'])).toEqual(['medium']);
    expect(checked(s, 'pixelRatio', ['0.75', '1', '1.5', '2'])).toEqual(['1.5']);
    expect(checked(s, 'crouch', ['hold', 'toggle'])).toEqual(['hold']);
    expect(s.field('particles').checked).toBe(true);
    expect(s.field('viewBob').checked).toBe(true);
    expect(s.field('uiScale').value).toBe('100');
  });

  it('applies a preset to the render distance, the resolution and the particles', () => {
    const s = setup();
    s.pick('quality', 'low');
    expect(s.settings()).toEqual(withQuality(DEFAULT_SETTINGS, 'low'));
    expect(s.field('particles').checked).toBe(QUALITY_PRESETS.low.particles);
    expect(checked(s, 'renderDistance', ['4', '6', '8', '10'])).toEqual(['4']);
    expect(checked(s, 'pixelRatio', ['0.75', '1', '1.5', '2'])).toEqual(['1']);
    // A change off the preset: no preset is checked.
    s.pick('pixelRatio', '2');
    expect(s.settings().pixelRatio).toBe(2);
    expect(checked(s, 'quality', ['low', 'medium', 'high'])).toEqual([]);
  });

  it('sends each control at once: boxes, crouch mode, sliders as factors', () => {
    const s = setup();
    s.pick('particles');
    s.pick('viewBob');
    s.pick('crouch', 'toggle');
    s.slide('uiScale', 125);
    s.slide('ambience', 40);
    expect(s.settings()).toEqual({
      ...DEFAULT_SETTINGS,
      particles: false,
      viewBob: false,
      crouch: 'toggle',
      uiScale: 1.25,
      volumes: { ...DEFAULT_SETTINGS.volumes, ambience: 0.4 },
    });
    s.root.findAction('controls')!.dispatch('click');
    expect(s.keys()).toBe(1);
  });

  it('starts each change from the settings in use (a rebinding made meanwhile stays)', () => {
    const s = setup();
    const rebound: Settings = {
      ...DEFAULT_SETTINGS,
      bindings: { ...DEFAULT_SETTINGS.bindings, jump: ['KeyJ'] },
    };
    s.elsewhere(rebound);
    s.slide('fov', 90);
    expect(s.settings()).toEqual({ ...rebound, fov: 90 });
  });
});
