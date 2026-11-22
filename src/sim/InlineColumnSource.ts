import type { Registry } from '../content/registry.ts';
import { Column, sectionPayloads } from '../world/Column.ts';
import { createGenContext, type GenContext, generateColumn } from '../world/gen/generateColumn.ts';
import type { GenResult } from '../world/protocol.ts';
import type { ColumnSource, WorldSpec } from './ports.ts';

/** Synchronous column source for Node (tests, headless runs): deterministic delivery order. */
export class InlineColumnSource implements ColumnSource {
  private readonly registry: Registry;
  private ctx: GenContext | null = null;
  private deliver: (result: GenResult) => void = () => {};

  constructor(registry: Registry) {
    this.registry = registry;
  }

  connect(deliver: (result: GenResult) => void): void {
    this.deliver = deliver;
  }

  request(world: WorldSpec, cx: number, cz: number): void {
    const seed = world.seed;
    if (!this.ctx || this.ctx.seed !== seed || this.ctx.worldType !== world.worldType) {
      this.ctx = createGenContext(seed, this.registry, world.worldType);
    }
    const column = new Column(cx, cz, this.registry.air);
    generateColumn(this.ctx, column);
    this.deliver({
      kind: 'gen',
      seed,
      cx,
      cz,
      sections: sectionPayloads(column),
      heightmap: column.heightmap,
      biomes: column.biomes,
      ms: 0,
    });
  }
}
