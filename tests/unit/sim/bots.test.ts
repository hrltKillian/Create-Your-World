import { describe, expect, it } from 'vitest';
import { PITCH_LIMIT } from '../../../src/core/angles.ts';
import { HOTBAR_SLOTS } from '../../../src/core/player.ts';
import type { Command } from '../../../src/sim/commands.ts';
import { tidy } from '../../../src/sim/testing/botNeeds.ts';
import {
  BLOCK,
  BUSH,
  botSenses,
  DRINK,
  FOOD,
  kindOf,
  nearestSource,
  SCAN_RADIUS,
  sourceAt,
  TOOL,
  TOXIC,
  WATER,
  wayAhead,
} from '../../../src/sim/testing/botSenses.ts';
import { BOT_KINDS, type BotKind, createBot } from '../../../src/sim/testing/bots.ts';
import { botTick } from '../../../src/sim/testing/runBot.ts';
import { FLAT_SURFACE } from '../../../src/world/gen/flat.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * The wanderMineBuild bot (sim/testing): what it tells apart from the pack's data, its inventory
 * chores, and how it looks after itself in a flat world (grass on top at y 64, the player at
 * (0.5, 65, 0.5)).
 */

type PlayerSim = ReturnType<typeof playerTestSim>;

/** Lets a bot play `ticks` ticks (its events into `s.events`); returns the highest feet reached. */
function drive(s: PlayerSim, ticks: number, kind: BotKind = 'wanderMineBuild'): number {
  const bot = createBot(kind, 'bots', s.sim);
  const commands: Command[] = [];
  let top = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ticks; i++) {
    botTick(s.host, bot, s.player, commands, s.events);
    top = Math.max(top, s.player.body.y);
  }
  return top;
}

const consumed = (s: PlayerSim) => eventsOf(s.events, 'consumed').map((e) => e.item);
const setStat = (s: PlayerSim, stat: 'thirst' | 'hunger' | 'toxicity', value: number) =>
  s.send({ type: 'debug.setStat', stat, value });

describe('what the bot tells apart', () => {
  it('classifies items and blocks from the pack data', () => {
    const s = playerTestSim({ seed: 'senses' });
    const senses = botSenses(s.sim);
    const kind = (item: string) => kindOf(senses, { item, count: 1 });
    expect(kind('item:berries')).toBe(FOOD);
    expect(kind('item:flask_raw')).toBe(DRINK | TOXIC);
    expect(kind('item:raw_meat')).toBe(FOOD | TOXIC);
    expect(kind('item:palmthorn_fruit')).toBe(FOOD | DRINK);
    expect(kind('item:dirt') & BLOCK).toBe(BLOCK);
    expect(kind('item:flint_pickaxe')).toBe(TOOL);
    expect(kindOf(senses, null)).toBe(0);
    s.put(1, 64, 0, 'block:fresh_water');
    s.put(2, 64, 0, 'block:foul_water');
    s.put(3, 65, 0, 'block:berry_bush');
    // Fresh water quenches more than it poisons; foul water does not, and dirt is nothing.
    expect(sourceAt(senses, 1, 64, 0)).toBe(WATER);
    expect(sourceAt(senses, 2, 64, 0)).toBe(0);
    expect(sourceAt(senses, 3, 65, 0)).toBe(BUSH);
    expect(sourceAt(senses, 0, 63, 0)).toBe(0);
  });

  it('finds the nearest source within its scan, and none beyond', () => {
    const s = playerTestSim({ seed: 'scan' });
    const senses = botSenses(s.sim);
    const target = { tx: 0, ty: 0, tz: 0 };
    s.put(SCAN_RADIUS + 1, 64, 0, 'block:fresh_water');
    expect(nearestSource(senses, WATER, s.player.body, target)).toBe(false);
    s.put(6, 64, 0, 'block:fresh_water');
    s.put(3, 64, 3, 'block:fresh_water');
    expect(nearestSource(senses, WATER, s.player.body, target)).toBe(true);
    expect(target).toEqual({ tx: 3, ty: 64, tz: 3 });
    expect(nearestSource(senses, BUSH, s.player.body, target)).toBe(false);
  });

  it('sees whether the next cell ahead is free at the feet and at the head', () => {
    const s = playerTestSim({ seed: 'ahead' });
    const senses = botSenses(s.sim);
    // Yaw 0 looks north (−z): the next cell is (0, 65, −1).
    expect(wayAhead(senses, s.player.body, 0)).toBe(true);
    s.put(0, 66, -1, 'block:dirt');
    expect(wayAhead(senses, s.player.body, 0)).toBe(false);
    expect(wayAhead(senses, s.player.body, Math.PI)).toBe(true);
    s.put(0, 66, -1, 'block:air');
    s.put(0, 65, -1, 'block:dirt');
    expect(wayAhead(senses, s.player.body, 0)).toBe(false);
  });
});

describe("the bot's inventory chores", () => {
  /** Eight stacks in the hotbar: blocks, food, tool and materials (plant fiber last of these). */
  const HOTBAR = [
    'dirt',
    'sand',
    'berries',
    'flint',
    'stick',
    'plant_fiber',
    'gravel',
    'flint_pickaxe',
  ];

  function fullHotbar() {
    const s = playerTestSim({ seed: 'chores' });
    for (const item of HOTBAR) s.give(`item:${item}`, 1);
    return s;
  }

  it('sends the stack it needs least to the bag when the hotbar is full', () => {
    const s = fullHotbar();
    expect(s.player.inventory.slice(0, HOTBAR_SLOTS).every((stack) => stack)).toBe(true);
    const senses = botSenses(s.sim);
    expect(tidy(senses, s.player)).toEqual({ type: 'inv.quickMove', slot: 5 });
  });

  it('throws that stack when the bag is full too', () => {
    const s = fullHotbar();
    s.give('item:copper_pickaxe', s.player.inventory.length - HOTBAR_SLOTS);
    expect(tidy(botSenses(s.sim), s.player)).toEqual({ type: 'inv.drop', slot: 5, all: true });
  });

  it('brings a drink from the bag to the hotbar when thirsty, not before', () => {
    const s = playerTestSim({ seed: 'fetch' });
    s.give('item:flask_raw', 1);
    s.send({ type: 'inv.move', from: 0, to: 12 });
    const senses = botSenses(s.sim);
    expect(tidy(senses, s.player)).toBeNull();
    setStat(s, 'thirst', 30);
    expect(tidy(senses, s.player)).toEqual({ type: 'inv.quickMove', slot: 12 });
  });
});

describe('how the bot looks after itself', () => {
  it('drinks what it carries when thirsty', () => {
    const s = playerTestSim({ seed: 'drink' });
    s.give('item:flask_raw', 1);
    setStat(s, 'thirst', 30);
    drive(s, 200);
    expect(consumed(s)).toContain('item:flask_raw');
    expect(s.player.survival.thirst).toBeGreaterThan(50);
  });

  it('eats poisonous food only while its toxicity is low', () => {
    const poisoned = playerTestSim({ seed: 'meat' });
    poisoned.give('item:raw_meat', 4);
    setStat(poisoned, 'hunger', 30);
    setStat(poisoned, 'toxicity', 60);
    drive(poisoned, 200);
    expect(consumed(poisoned)).not.toContain('item:raw_meat');
    const healthy = playerTestSim({ seed: 'meat' });
    healthy.give('item:raw_meat', 4);
    setStat(healthy, 'hunger', 30);
    drive(healthy, 200);
    expect(consumed(healthy)).toContain('item:raw_meat');
  });

  it('walks to water and sips with the bare hand when it carries nothing to drink', () => {
    const s = playerTestSim({ seed: 'pond' });
    s.fill(7, 64, -1, 8, 64, 1, 'block:fresh_water');
    setStat(s, 'thirst', 30);
    drive(s, 600);
    expect(consumed(s)).toContain('block:fresh_water');
    expect(s.player.survival.thirst).toBeGreaterThan(50);
  });

  it('mines a food plant, picks up its berries and eats them when hungry', () => {
    const s = playerTestSim({ seed: 'bush' });
    s.put(-5, 65, 2, 'block:berry_bush');
    setStat(s, 'hunger', 30);
    drive(s, 900);
    expect(s.block(-5, 65, 2)).not.toBe('block:berry_bush');
    expect(consumed(s)).toContain('item:berries');
  });

  /** A player at the bottom of a 4-deep pit (1 × 1) with 16 dirt. */
  function inPit(): PlayerSim {
    const s = playerTestSim({ seed: 'pit' });
    s.fill(0, FLAT_SURFACE - 3, 0, 0, FLAT_SURFACE, 0, 'block:air');
    s.send({ type: 'debug.teleport', x: 0.5, y: FLAT_SURFACE - 3, z: 0.5 });
    s.give('item:dirt', 16);
    return s;
  }

  it('climbs out of a pit with the blocks it carries', () => {
    expect(drive(inPit(), 1200)).toBeGreaterThanOrEqual(FLAT_SURFACE + 1);
  });

  it('jumps in every climb, also one that starts while a stuck walk holds jump', () => {
    const s = inPit();
    const bot = createBot('wanderMineBuild', 'bots', s.sim);
    const commands: Command[] = [];
    // Jumps per climb: a climb is a run of ticks looking straight down.
    const jumps: number[] = [];
    let climbing = false;
    for (let i = 0; i < 1200 && s.player.body.y < FLAT_SURFACE + 1; i++) {
      bot.next(s.player, s.host.view.tick(), commands);
      const input = commands.find((c) => c.type === 'input');
      for (const command of commands) s.host.send(command);
      commands.length = 0;
      s.events.length = 0;
      s.host.advance(1, s.events);
      const climb = input?.pitch === -PITCH_LIMIT;
      if (climb && !climbing) jumps.push(0);
      climbing = climb;
      if (climb) jumps[jumps.length - 1]! += eventsOf(s.events, 'playerJumped').length;
    }
    expect(s.player.body.y).toBeGreaterThanOrEqual(FLAT_SURFACE + 1);
    expect(jumps.length).toBeGreaterThan(0);
    expect(jumps).not.toContain(0);
  });

  it('digs its way out of a hole under a ceiling, with nothing to climb with', () => {
    const s = playerTestSim({ seed: 'trap' });
    s.put(0, FLAT_SURFACE, 0, 'block:air');
    s.put(0, FLAT_SURFACE + 2, 0, 'block:dirt');
    s.send({ type: 'debug.teleport', x: 0.5, y: FLAT_SURFACE, z: 0.5 });
    const bot = createBot('wanderMineBuild', 'bots', s.sim);
    const commands: Command[] = [];
    let away = 0;
    for (let i = 0; i < 900 && away < 2; i++) {
      botTick(s.host, bot, s.player, commands, s.events);
      away = Math.max(Math.abs(s.player.body.x - 0.5), Math.abs(s.player.body.z - 0.5));
    }
    expect(away).toBeGreaterThanOrEqual(2);
  });

  it('swims up from the bottom of a pool', () => {
    const s = playerTestSim({ seed: 'pool' });
    s.fill(-2, FLAT_SURFACE - 4, -2, 2, FLAT_SURFACE, 2, 'block:fresh_water');
    s.send({ type: 'debug.teleport', x: 0.5, y: FLAT_SURFACE - 4, z: 0.5 });
    expect(drive(s, 900)).toBeGreaterThan(FLAT_SURFACE - 1);
    expect(s.player.survival.dead).toBe(false);
  });

  it.each(BOT_KINDS)('asks to respawn when its player dies (%s)', (kind) => {
    const s = playerTestSim({ seed: 'respawn' });
    s.send({ type: 'debug.kill', cause: 'fall' });
    expect(s.player.survival.dead).toBe(true);
    drive(s, 2, kind);
    expect(eventsOf(s.events, 'respawned')).toHaveLength(1);
    expect(s.player.survival.dead).toBe(false);
  });
});
