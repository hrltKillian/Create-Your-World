import { describe, expect, it } from 'vitest';
import type { App } from '../../../src/app/App.ts';
import { placeCreature } from '../../../src/app/creatureAutomation.ts';

describe('placeCreature (the hook entities.spawn)', () => {
  it('returns the new creature, not an older one of its kind that comes back in the same pump', () => {
    const trotter = (id: number) => ({ kind: 'creature', id, creature: 'creature:trotter' });
    const entities = new Map<number, unknown>([[1, { kind: 'player', id: 1 }]]);
    const session = {
      host: {
        view: { entities },
        // The spawn makes creature 3; its pump brings parked creature 2 back, the map in id order.
        send: () => {},
      },
      pumpOnce: () => {
        entities.set(2, trotter(2));
        entities.set(3, trotter(3));
      },
    };
    const app = { session } as unknown as App;
    expect(placeCreature(app, 'creature:trotter', 0.5, 'surface', 0.5)).toBe(3);
  });
});
