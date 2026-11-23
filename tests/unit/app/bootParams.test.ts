import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOT_PARAMS, parseBootParams } from '../../../src/app/bootParams.ts';

describe('boot params', () => {
  it('parses flags and values in dev builds', () => {
    const p = parseBootParams('?seed=42&storage=memory&noLock=1&debug=1&forceNoWebGL=1', true);
    expect(p.seed).toBe('42');
    expect(p.storage).toBe('memory');
    expect(p.noLock).toBe(true);
    expect(p.debug).toBe(true);
    expect(p.forceNoWebGL).toBe(true);
    expect(p.skipMenu).toBe(false);
  });

  it('boots into a world without the menus for selftests, or into a saved world', () => {
    expect(parseBootParams('?skipMenu=1', true).skipMenu).toBe(true);
    expect(parseBootParams('?selftest=m0', true)).toMatchObject({ skipMenu: true, noLock: true });
    expect(parseBootParams('?world=abc', true)).toMatchObject({ world: 'abc', skipMenu: false });
    expect(parseBootParams('', true).world).toBeNull();
  });

  it('knows the test world types', () => {
    expect(parseBootParams('?worldType=arena', true).worldType).toBe('arena');
    expect(parseBootParams('?worldType=flat', true).worldType).toBe('flat');
    expect(parseBootParams('?worldType=moon', true).worldType).toBe('default');
  });

  it('reads the clock hour and freeze flag, ignoring hours out of range', () => {
    const p = parseBootParams('?time=13.5&freezeTime=1', true);
    expect(p.time).toBe(13.5);
    expect(p.freezeTime).toBe(true);
    expect(parseBootParams('?time=0', true).time).toBe(0);
    expect(parseBootParams('?time=24', true).time).toBeNull();
    expect(parseBootParams('?time=noon', true).time).toBeNull();
    expect(parseBootParams('', true)).toMatchObject({ time: null, freezeTime: false });
  });

  it('ignores every parameter in production', () => {
    expect(parseBootParams('?seed=42&forceNoWebGL=1', false)).toEqual(DEFAULT_BOOT_PARAMS);
  });

  it('keeps selftest timing thresholds unless ?timing=0', () => {
    expect(parseBootParams('?seed=1', true).timing).toBe(true);
    expect(parseBootParams('?timing=0', true).timing).toBe(false);
    expect(parseBootParams('?timing=0', false).timing).toBe(true);
  });
});
