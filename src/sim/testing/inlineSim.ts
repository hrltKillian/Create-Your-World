import type { Registry } from '../../content/registry.ts';
import type { WorldType } from '../../world/gen/generateColumn.ts';
import type { SimEvent } from '../events.ts';
import { createHost, type LocalSimHost } from '../host.ts';
import { InlineColumnSource } from '../InlineColumnSource.ts';
import type { ColumnSource } from '../ports.ts';
import { Simulation } from '../Simulation.ts';

export interface InlineSimOptions {
  readonly registry: Registry;
  readonly seed: string;
  readonly worldType?: WorldType;
  /** Accept debug.* commands. */
  readonly allowDebug?: boolean;
  /** Route every command and event through JSON (SerializingSimHost). */
  readonly serialize?: boolean;
  /** Replaces the InlineColumnSource (tests of delivery order or of missing columns). */
  readonly source?: ColumnSource;
  /** Creature rules (SimOptions): hostiles, natural spawns, grace period. */
  readonly hostiles?: boolean;
  readonly spawns?: boolean;
  readonly graceTicks?: number;
}

export interface InlineSim {
  readonly sim: Simulation;
  /** Host of connection 1; its player joins with `sim.addPlayer(1, viewRadius)`. */
  readonly host: LocalSimHost;
  /** Event buffer for `host.advance` and `host.pumpWorld`. */
  readonly events: SimEvent[];
}

/**
 * A simulation that generates its columns synchronously on this thread, behind a local host:
 * shared by runBot (tests, headless runner) and the sim test harness (tests/helpers/simHarness.ts).
 */
export function createInlineSim(options: InlineSimOptions): InlineSim {
  const sim = new Simulation({
    seed: options.seed,
    worldType: options.worldType,
    registry: options.registry,
    source: options.source ?? new InlineColumnSource(options.registry),
    maxInFlight: 8,
    allowDebug: options.allowDebug,
    hostiles: options.hostiles,
    spawns: options.spawns,
    graceTicks: options.graceTicks,
  });
  const host = createHost(sim, 1, options.serialize);
  return { sim, host, events: [] };
}
