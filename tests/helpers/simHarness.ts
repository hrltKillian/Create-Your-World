import type { Registry } from '../../src/content/registry.ts';
import { type Command, type InputCommand, NEUTRAL_INPUT } from '../../src/sim/commands.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import {
  createInlineSim,
  type InlineSim,
  type InlineSimOptions,
} from '../../src/sim/testing/inlineSim.ts';
import type { WorldType } from '../../src/world/gen/generateColumn.ts';
import { registry } from './registry.ts';

/**
 * An inline simulation on the shared test registry (see createInlineSim), with tick helpers that
 * append to `events`. Player 1 joins with `sim.addPlayer(1, viewRadius)`.
 */
export function createTestSim(options: Omit<InlineSimOptions, 'registry'>) {
  return withTicks(createInlineSim({ registry, ...options }));
}

/** Tick helpers over an inline simulation (a new one, or one restored from a save). */
export function withTicks(inline: InlineSim) {
  const { host, events } = inline;
  return {
    ...inline,
    /** Advances `n` ticks without sending anything. */
    step: (n = 1): void => {
      for (let i = 0; i < n; i++) host.advance(1, events);
    },
    /** Sends `input` (over the neutral input) before each of `n` ticks. */
    tick: (n: number, input: Partial<InputCommand> = {}): void => {
      for (let i = 0; i < n; i++) {
        host.send({ ...NEUTRAL_INPUT, ...input });
        host.advance(1, events);
      }
    },
  };
}

/** A test simulation with tick helpers (createTestSim, withTicks, or a restored save). */
export type TestSim = ReturnType<typeof withTicks>;

/**
 * Command helpers for player 1 of a test simulation: `send` clears `events`, sends its commands
 * and applies them in one tick, returning that tick's events; `give`, `put` (one block), `fill`
 * (a box) and `block` (the state key of a cell) go through it.
 */
export function withPlayer<S extends TestSim>(harness: S) {
  const { sim, host, events } = harness;
  const send = (...commands: Command[]): SimEvent[] => {
    events.length = 0;
    for (const command of commands) host.send(command);
    harness.step(1);
    return [...events];
  };
  const player = sim.players.get(1);
  if (!player) throw new Error('Player 1 has not joined');
  return {
    ...harness,
    player,
    send,
    give: (item: string, count = 1) => send({ type: 'debug.give', item, count }),
    put: (x: number, y: number, z: number, state: string) =>
      send({ type: 'debug.fill', x0: x, y0: y, z0: z, x1: x, y1: y, z1: z, state }),
    /** Fills a box of cells with a block state. */
    fill: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: string) =>
      send({ type: 'debug.fill', x0, y0, z0, x1, y1, z1, state }),
    block: (x: number, y: number, z: number) =>
      sim.registry.states[sim.world.getBlock(x, y, z)]!.key,
  };
}

export interface PlayerTestSimOptions {
  readonly seed: string;
  /** Flat by default: grass at y 64, the player standing at (0.5, 65, 0.5) looking north. */
  readonly worldType?: WorldType;
  /** Route every command and event through JSON (SerializingSimHost). */
  readonly serialize?: boolean;
  /** Another registry than the shared test one (an extended pack). */
  readonly registry?: Registry;
  /** Accept debug.* commands (default: true; `give` and `put` need them). */
  readonly allowDebug?: boolean;
  /** Render distance of player 1 (columns; default 2). */
  readonly viewRadius?: number;
  /** Creature rules (natural spawns are off in the flat world by default). */
  readonly spawns?: boolean;
  readonly graceTicks?: number;
  readonly hostiles?: boolean;
}

/**
 * A test simulation (debug commands allowed by default) where player 1 has joined (view radius 2
 * by default) and stood for 60 ticks while its world loaded, with the command helpers of
 * `withPlayer`; `events` is empty.
 */
export function playerTestSim(options: PlayerTestSimOptions) {
  const harness = withTicks(
    createInlineSim({
      ...options,
      registry: options.registry ?? registry,
      worldType: options.worldType ?? 'flat',
      allowDebug: options.allowDebug ?? true,
    }),
  );
  harness.sim.addPlayer(1, options.viewRadius ?? 2);
  harness.step(60);
  harness.events.length = 0;
  return withPlayer(harness);
}

/** The events of one type. */
export function eventsOf<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** The reasons of the rejected commands among events. */
export function rejections(events: readonly SimEvent[]): string[] {
  return eventsOf(events, 'rejected').map((e) => e.reason);
}
