import type { Registry } from '../content/registry.ts';
import { createGenContext, type GenContext } from '../world/gen/generateColumn.ts';
import { generateResult } from '../world/gen/generateResult.ts';
import type { SavedSection } from '../world/protocol.ts';
import type { ColumnSink, ColumnSource, WorldSpec } from './ports.ts';

/** Synchronous column source for Node (tests, headless runs): deterministic delivery order. */
export class InlineColumnSource implements ColumnSource {
  private readonly registry: Registry;
  private ctx: GenContext | null = null;
  private sink: ColumnSink | null = null;

  constructor(registry: Registry) {
    this.registry = registry;
  }

  connect(sink: ColumnSink): void {
    this.sink = sink;
  }

  request(world: WorldSpec, cx: number, cz: number, saved?: readonly SavedSection[]): void {
    if (!this.ctx || this.ctx.seed !== world.seed || this.ctx.worldType !== world.worldType) {
      this.ctx = createGenContext(world.seed, this.registry, world.worldType);
    }
    this.sink?.deliver(generateResult(this.ctx, this.registry.air, cx, cz, saved));
  }
}
