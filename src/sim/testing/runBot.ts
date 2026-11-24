import type { Registry } from '../../content/registry.ts';
import type { WorldType } from '../../world/gen/generateColumn.ts';
import type { Command } from '../commands.ts';
import { type CreatureCensus, creatureCensus } from '../creatures.ts';
import type { SimEvent } from '../events.ts';
import type { SimHost } from '../host.ts';
import type { PlayerState } from '../player.ts';
import { stateHash } from '../stateHash.ts';
import { type Bot, type BotKind, createBot } from './bots.ts';
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

export interface BotRunResult extends Readonly<BotTally> {
  readonly hash: number;
  readonly ticks: number;
  readonly columns: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Whether the bot ends alive. */
  readonly alive: boolean;
  readonly census: CreatureCensus;
}

/**
 * What a bot's player did, counted from the events: deaths and respawns, blocks broken and placed,
 * item stacks picked up, items eaten or drunk.
 */
export interface BotTally {
  deaths: number;
  respawns: number;
  broken: number;
  placed: number;
  pickedUp: number;
  consumed: number;
}

export function emptyTally(): BotTally {
  return { deaths: 0, respawns: 0, broken: 0, placed: 0, pickedUp: 0, consumed: 0 };
}

/** Counts one event of a player into a tally (other players' events and other kinds are ignored). */
export function tallyEvent(tally: BotTally, event: SimEvent, playerId: number): void {
  if (!('playerId' in event) || event.playerId !== playerId) return;
  if (event.type === 'died') tally.deaths++;
  else if (event.type === 'respawned') tally.respawns++;
  else if (event.type === 'blockBroken') tally.broken++;
  else if (event.type === 'blockPlaced') tally.placed++;
  else if (event.type === 'itemPickedUp') tally.pickedUp++;
  else if (event.type === 'consumed') tally.consumed++;
}

/** Sends a bot's commands for the next tick (`commands` is scratch space, left empty). */
export function sendBotCommands(
  host: SimHost,
  bot: Bot,
  player: Readonly<PlayerState>,
  commands: Command[],
): void {
  bot.next(player, host.view.tick(), commands);
  for (const command of commands) host.send(command);
  commands.length = 0;
}

/** Sends a bot's commands for the next tick, then advances that tick (its events into `events`). */
export function botTick(
  host: SimHost,
  bot: Bot,
  player: Readonly<PlayerState>,
  commands: Command[],
  events: SimEvent[],
): void {
  sendBotCommands(host, bot, player, commands);
  host.advance(1, events);
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
  const bot = createBot(options.bot, options.seed, sim);
  const commands: Command[] = [];
  const tally = emptyTally();
  const every = options.everyTicks ?? 0;
  for (let i = 0; i < options.ticks; i++) {
    botTick(host, bot, player, commands, events);
    for (const event of events) tallyEvent(tally, event, player.playerId);
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
    ...tally,
    alive: !player.survival.dead,
    census: creatureCensus(sim.entities, options.registry),
  };
}
