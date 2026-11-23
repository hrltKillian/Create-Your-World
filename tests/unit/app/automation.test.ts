import { describe, expect, it } from 'vitest';
import type { App } from '../../../src/app/App.ts';
import { blockEntityContents } from '../../../src/app/automation.ts';
import type { BlockEntity } from '../../../src/sim/blockEntities.ts';
import { registry } from '../../helpers/registry.ts';

/** An app whose session sees one block entity at cell (1, 2, 3). */
function appWith(entity: BlockEntity): App {
  const blockEntity = (x: number, y: number, z: number) =>
    x === 1 && y === 2 && z === 3 ? entity : undefined;
  return { session: { host: { view: { registry, blockEntity } } } } as unknown as App;
}

describe('blockEntityContents (the hook container.contents)', () => {
  it('lists an Abandoned Pack’s worn items apart from its slots', () => {
    const coat = { item: 'item:fur_coat', count: 1, durability: 40 };
    const app = appWith({
      kind: 'grave',
      x: 1,
      y: 2,
      z: 3,
      slots: [{ item: 'item:dirt', count: 3 }, null],
      worn: [null, null, coat, null, null],
    });
    expect(blockEntityContents(app, 1, 2, 3)).toEqual({
      kind: 'grave',
      slots: [{ item: 'item:dirt', count: 3 }, null],
      worn: [null, null, coat, null, null],
    });
    expect(blockEntityContents(app, 0, 0, 0)).toBeNull();
  });
});
