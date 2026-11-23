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

  it('knows the test world types', () => {
    expect(parseBootParams('?worldType=arena', true).worldType).toBe('arena');
    expect(parseBootParams('?worldType=flat', true).worldType).toBe('flat');
    expect(parseBootParams('?worldType=moon', true).worldType).toBe('default');
  });

  it('ignores every parameter in production', () => {
    expect(parseBootParams('?seed=42&forceNoWebGL=1', false)).toEqual(DEFAULT_BOOT_PARAMS);
  });
});
