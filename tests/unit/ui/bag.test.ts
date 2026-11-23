import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS } from '../../../src/sim/inventory.ts';
import { BagScreen } from '../../../src/ui/screens/bag.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { registry } from '../../helpers/registry.ts';

beforeEach(installFakeDom);
afterEach(removeFakeDom);

describe('BagScreen', () => {
  it('shows the close key as labelled when it opens (the layout map loads after boot)', () => {
    let label = 'E';
    const bag = new BagScreen(
      { registry, icons: [] },
      { send: () => {}, click: () => {} },
      INVENTORY_SLOTS,
      () => label,
    );
    const hint = () => (bag.element as unknown as FakeElement).querySelector('.bag-close');
    bag.open();
    expect(hint()?.textContent).toBe('E or Esc to close');
    bag.close();
    label = 'Ê';
    bag.open();
    expect(hint()?.textContent).toBe('Ê or Esc to close');
  });
});
