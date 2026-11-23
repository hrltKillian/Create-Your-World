import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings, i18nMissing } from '../../../src/i18n/i18n.ts';
import { HINT_SECONDS, HudHint, hintText } from '../../../src/ui/hud/hudHint.ts';
import { installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';

beforeEach(installFakeDom);
afterEach(removeFakeDom);

describe('HudHint', () => {
  it("builds the text from the engine key and the pack's name keys", () => {
    addStrings(basePack.strings);
    const params = { tier: 'tier.bronze', tool: 'tool.axe' };
    expect(hintText('hint.toolTooWeak', params)).toBe('Tool too weak: Bronze hatchet required');
    expect(i18nMissing()).toEqual([]);
  });

  it('shows a line for 2.5 s, and a new hint starts the time again', () => {
    const hint = new HudHint();
    expect(hint.element.hidden).toBe(true);
    hint.show('first');
    expect(hint.element.hidden).toBe(false);
    expect(hint.element.textContent).toBe('first');
    hint.frame(HINT_SECONDS - 0.5);
    hint.show('second');
    hint.frame(HINT_SECONDS - 0.1);
    expect(hint.element.hidden).toBe(false);
    expect(hint.element.textContent).toBe('second');
    hint.frame(0.2);
    expect(hint.element.hidden).toBe(true);
  });
});
