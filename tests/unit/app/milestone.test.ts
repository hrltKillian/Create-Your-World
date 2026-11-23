import { describe, expect, it } from 'vitest';
import { MILESTONE } from '../../../src/app/App.ts';
import { SUITES } from '../../../src/app/selftest/suites.ts';

describe('milestone', () => {
  it('the title shows the milestone of the latest selftest suite', () => {
    expect(`m${MILESTONE}`).toBe(Object.keys(SUITES).at(-1));
  });
});
