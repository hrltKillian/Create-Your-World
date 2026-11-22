import type { Registry } from '../../content/registry.ts';
import type { WorldType } from '../../world/gen/generateColumn.ts';
import type { SimEvent } from '../events.ts';
import { LocalSimHost, SerializingSimHost } from '../host.ts';
import { InlineColumnSource } from '../InlineColumnSource.ts';
import { Simulation } from '../Simulation.ts';
import { stateHash } from '../stateHash.ts';
import { type BotKind, createBot } from './bots.ts';

export interface BotRunOptions {
  readonly registry: Registry;
  readonly seed: string;
  readonly ticks: number;
  readonly bot: BotKind;
  readonly worldType?: WorldType;
  /** Render distance of the bot's player (columns); small keeps runs fast. */
  readonly viewRadius?: number;
  /** Route every command and event through JSON (SerializingSimHost). */
  readonly serialize?: boolean;
  /** Called every `everyTicks` ticks with the current hash (determinism checks). */
  readonly onCheckpoint?: (tick: number, hash: number) => void;
  readonly everyTicks?: number;
}

export interface BotRunResult {
  readonly hash: number;
  readonly ticks: number;
  readonly columns: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Runs a bot-driven simulation synchronously (Node tests, headless runner). */
export function runBot(options: BotRunOptions): BotRunResult {
  const source = new InlineColumnSource(options.registry);
  const sim = new Simulation({
    seed: options.seed,
    worldType: options.worldType ?? 'default',
    registry: options.registry,
    source,
    maxInFlight: 8,
  });
  source.connect((result) => sim.deliver(result));
  const player = sim.addPlayer(1, options.viewRadius ?? 2);
  const host = options.serialize ? new SerializingSimHost(sim, 1) : new LocalSimHost(sim, 1);
  const bot = createBot(options.bot, options.seed);
  const events: SimEvent[] = [];
  const every = options.everyTicks ?? 0;
  for (let i = 0; i < options.ticks; i++) {
    host.send(bot.next(player, sim.tick));
    host.advance(1, events);
    events.length = 0;
    if (every > 0 && sim.tick % every === 0) options.onCheckpoint?.(sim.tick, stateHash(sim));
  }
  return {
    hash: stateHash(sim),
    ticks: sim.tick,
    columns: sim.world.columns.size,
    x: player.body.x,
    y: player.body.y,
    z: player.body.z,
  };
}
