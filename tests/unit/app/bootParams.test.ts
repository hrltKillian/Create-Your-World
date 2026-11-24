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

  it('reads the creature spawns and grace period, null when absent or malformed', () => {
    expect(parseBootParams('?spawns=1&grace=0', true)).toMatchObject({ spawns: true, grace: 0 });
    expect(parseBootParams('?spawns=0&grace=900', true)).toMatchObject({
      spawns: false,
      grace: 900,
    });
    expect(parseBootParams('?grace=-1', true).grace).toBeNull();
    expect(parseBootParams('?grace=soon', true).grace).toBeNull();
    expect(parseBootParams('', true)).toMatchObject({ spawns: null, grace: null });
    // Selftests run without creatures unless they ask for them.
    expect(parseBootParams('?selftest=m9', true).spawns).toBe(false);
    expect(parseBootParams('?selftest=m10&spawns=1', true).spawns).toBe(true);
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
