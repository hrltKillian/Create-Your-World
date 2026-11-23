import type { Registry } from '../../content/registry.ts';
import type { WorldType } from '../../world/gen/generateColumn.ts';
import { stateHash } from '../stateHash.ts';
import { type BotKind, createBot } from './bots.ts';
import { createInlineSim } from './inlineSim.ts';

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
  const { sim, host, events } = createInlineSim({
    registry: options.registry,
    seed: options.seed,
    worldType: options.worldType,
    serialize: options.serialize,
  });
  const player = sim.addPlayer(1, options.viewRadius ?? 2);
  const bot = createBot(options.bot, options.seed);
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
