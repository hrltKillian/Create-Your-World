import { describe, expect, it } from 'vitest';
import { actionForCode, DEFAULT_BINDINGS, HOTBAR_CODES } from '../../../src/input/bindings.ts';
import { KeyLabels, presetFromLanguage } from '../../../src/input/keyLabels.ts';

const forwardCode = DEFAULT_BINDINGS.forward[0]!;

function layoutMap(entries: Record<string, string>) {
  return {
    getLayoutMap: async () => new Map(Object.entries(entries)) as ReadonlyMap<string, string>,
  };
}

describe('physical key bindings', () => {
  it('binds movement to physical positions, not printed letters', () => {
    expect(DEFAULT_BINDINGS.forward).toEqual(['KeyW']);
    expect(DEFAULT_BINDINGS.left).toEqual(['KeyA']);
    expect(DEFAULT_BINDINGS.back).toEqual(['KeyS']);
    expect(DEFAULT_BINDINGS.right).toEqual(['KeyD']);
    // The same physical key drives the same action whatever it prints.
    expect(actionForCode(DEFAULT_BINDINGS, 'KeyW')).toBe('forward');
  });
});

describe('key labels', () => {
  it('labels the forward key W on QWERTY and Z on AZERTY', () => {
    const qwerty = new KeyLabels('en-US');
    const azerty = new KeyLabels('en-US');
    azerty.force('azerty');
    expect(qwerty.label(forwardCode)).toBe('W');
    expect(azerty.label(forwardCode)).toBe('Z');
    expect(azerty.label('KeyA')).toBe('Q');
    expect(azerty.label('KeyS')).toBe('S');
    expect(azerty.label('KeyD')).toBe('D');
  });

  it('prefers the browser layout map', async () => {
    const labels = new KeyLabels('en-US');
    await labels.loadLayoutMap(layoutMap({ KeyW: 'z', KeyA: 'q' }));
    expect(labels.label('KeyW')).toBe('Z');
    expect(labels.label('KeyA')).toBe('Q');
    // Keys missing from the map fall back to the preset.
    expect(labels.label('KeyD')).toBe('D');
  });

  it('survives a layout map that rejects or is missing', async () => {
    const labels = new KeyLabels('fr-FR');
    await labels.loadLayoutMap({ getLayoutMap: () => Promise.reject(new Error('denied')) });
    expect(labels.label('KeyW')).toBe('Z');
    await labels.loadLayoutMap(undefined);
    expect(labels.label('KeyW')).toBe('Z');
  });

  it('learns labels from real key presses when there is no layout map', () => {
    const labels = new KeyLabels('en-US');
    labels.learn('KeyW', 'z');
    expect(labels.label('KeyW')).toBe('Z');
    labels.learn('KeyQ', 'Shift');
    expect(labels.label('KeyQ')).toBe('Q');
  });

  it('lets a forced preset override the layout map', async () => {
    const labels = new KeyLabels('en-US');
    await labels.loadLayoutMap(layoutMap({ KeyW: 'w' }));
    labels.force('azerty');
    expect(labels.label('KeyW')).toBe('Z');
    labels.force(null);
    expect(labels.label('KeyW')).toBe('W');
  });

  it('always shows digits for the hotbar and words for named keys', () => {
    const labels = new KeyLabels('fr-FR');
    expect(HOTBAR_CODES.map((code) => labels.label(code))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(labels.label('Space')).toBe('Space');
    expect(labels.label('F3')).toBe('F3');
  });

  it('guesses the layout from the browser language', () => {
    expect(presetFromLanguage('fr-FR')).toBe('azerty');
    expect(presetFromLanguage('fr-BE')).toBe('azerty');
    expect(presetFromLanguage('fr-CA')).toBe('qwerty');
    expect(presetFromLanguage('fr-CH')).toBe('qwertz');
    expect(presetFromLanguage('de-DE')).toBe('qwertz');
    expect(presetFromLanguage('en-GB')).toBe('qwerty');
    expect(new KeyLabels('de-DE').label('KeyY')).toBe('Z');
  });
});
