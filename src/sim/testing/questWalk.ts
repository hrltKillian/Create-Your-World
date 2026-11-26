import { blockItemKey } from '../../content/items.ts';
import type { QuestDef } from '../../content/schema.ts';
import { findBiome } from '../../world/gen/find.ts';
import { TICKS_PER_SECOND, ticksOf } from '../clock.ts';
import type { PlayerState } from '../player.ts';
import { pointsLeft } from '../progression.ts';
import type { QuestState } from '../quests.ts';
import { DAY_TICKS } from '../time.ts';
import { type Cell, cellText, type WalkOptions, type WalkPort } from './walkPort.ts';
import { Supplies } from './walkSupplies.ts';

export type { Cell, HoldAction, Point, WalkOptions, WalkPort } from './walkPort.ts';

/*
 * The scripted walk through the pack's quests (plan v3 « M21 », after M11's objectives walk):
 * from a home pad levelled around the player, each quest in the pack's order (each after those it
 * requires) must unlock at its turn, then is done with the game's own actions (walkSupplies.ts,
 * walkHands.ts: blocks broken by holding primary with the right tool and their drops walked
 * onto, crafts queued as the Logbook does, stations placed and fed, a sip, journeys to biomes not
 * walked yet and to the biomes of the deposits, creatures struck down with a spear in a pit, a
 * cabin built block by block with secondary and a night held out in it, ripe crops picked, fish
 * caught with a rod), and the walk waits for the quest to be done, claims it and spends its
 * levels' points on carrying (the chain's items fill a bag of 32). Everything is read from the pack (engine code never names content). The
 * browser runs it through `__game`'s automation (selftest/questsWalk.ts), tests on inline
 * simulations of several seeds.
 * Debug commands stage what is not a quest's (« Retenu à l'intégration » of M11): the home pad
 * and the hunting pit are levelled and the drinking and fishing pools poured by `debug.fill`, a
 * source block or a crop is staged beside the player when none lies within the search, the materials no quest names are
 * given (`debug.give`), the hunted creatures are placed (`debug.spawn`) at night (`debug.setTime`),
 * stations open without aiming (`debug.open`) and the walk teleports between its stands.
 */

/** The room of the home cabin: 2 blocks either side of the player, its walls one further out. */
export const ROOM = 2;
const WALL = ROOM + 1;
/**
 * The pad: one block over the room's floor around the room (the cabin's walls stand on it, its
 * builder outside), this far either side of the player; the hunting pit lies by its edge.
 */
const PAD = WALL + 3;
/** Air cleared over the pad: room for the cabin's roof and for standing on it. */
const CLEAR = 5;
/** The cabin: walls on the pad, its roof two blocks over the room's floor; the door's offset. */
const ROOF = 2;
const DOOR = 1;
/** The pool's cell in the floor (off the station spots), from the middle of the room. */
const POOL = { dx: -ROOM, dz: -ROOM };
/** Stations stand on the floor 2 blocks from the middle, along the axes then the diagonals. */
const SPOTS: readonly (readonly [number, number])[] = [
  [ROOM, 0],
  [-ROOM, 0],
  [0, ROOM],
  [0, -ROOM],
  [ROOM, ROOM],
  [-ROOM, ROOM],
  [ROOM, -ROOM],
];
/** Ticks a sip is held past `water.sipSec`. */
const SIP_SLACK = 3;
/** Most sips in a row when thirsty, and the share of thirst that is enough. */
const MAX_SIPS = 12;
const FULL = 0.9;
/** The night is held out from this hour (« time.set(23) ») to the morning that counts it. */
const LATE_HOUR = 23;

/**
 * Walks the pack's quests in their order and returns the keys done (every quest). Throws when one
 * does not unlock in its turn or cannot be done.
 */
export async function walkQuests(port: WalkPort, options: WalkOptions): Promise<string[]> {
  const walk = new QuestWalk(port, options);
  await walk.run();
  const quests = walk.player.quests;
  return Object.keys(quests).filter((key) => quests[key]!.done);
}

class QuestWalk extends Supplies {
  private readonly options: WalkOptions;
  private spots = 0;

  constructor(port: WalkPort, options: WalkOptions) {
    super(port, options);
    this.options = options;
  }

  get player(): Readonly<PlayerState> {
    return this.me();
  }

  async run(): Promise<void> {
    const quests = this.registry.pack.quests ?? [];
    const done = Object.keys(this.me().quests).filter((key) => this.me().quests[key]!.done);
    if (done.length > 0) throw new Error(`the player has already done ${done.join(', ')}`);
    await this.preparePad();
    for (let i = 0; i < quests.length; i++) {
      const quest = quests[i]!;
      await this.quench();
      this.awaitQuest(quest, (state) => state !== undefined, 'unlocked');
      await this.satisfy(quest);
      this.awaitQuest(quest, (state) => state?.done === true, 'done');
      await this.goHome();
      await this.options.onDone?.(quest, i);
      // Claimed once its checks are over (a claimed quest is no longer pinned).
      this.claim(quest);
    }
  }

  /**
   * Claims a quest done (its rewards and XP) and spends the points of the levels reached on
   * carrying, as a player whose bag fills: the items of the whole chain fit in it.
   */
  private claim(quest: QuestDef): void {
    this.port.send({ type: 'quest.claim', quest: quest.key });
    const p = this.registry.pack.balance.progression;
    while (pointsLeft(this.me(), p) > 0 && this.me().skills.carrying < p.maxSkill)
      this.port.send({ type: 'skill.spend', skill: 'carrying' });
  }

  /** Does what a quest asks for: its condition part by part, or its counter's deeds. */
  private async satisfy(quest: QuestDef): Promise<void> {
    const c = quest.condition;
    const counter = quest.counter;
    if (c) {
      for (const item of c.items ?? []) await this.obtain(item, 1, 0);
      for (const station of c.stations ?? []) await this.station(station, 0);
      if (c.drank) await this.sip();
      if (c.biomes !== undefined) await this.explore(c.biomes);
      if (c.met !== undefined) await this.meet(c.met);
    }
    const done = () => this.me().quests[quest.key]?.done === true;
    if (counter?.event === 'night') {
      // No rule asks for a shelter: the cabin keeps the night's creatures out of the walk.
      await this.buildCabin();
      this.holdOut(counter.count, done);
    } else if (counter?.event === 'killed') {
      const creatures = this.registry.pack.creatures ?? [];
      const prey = creatures.find((def) => def.key === (counter.target ?? def.key));
      if (!prey) throw new Error(`no ${counter.target} to hunt`);
      await this.hunt(prey, await this.weapon(0), done);
    } else if (counter?.event === 'harvested') await this.pickCrops(counter.target, done);
  }

  /**
   * Steps until the next quest checks (once a second: twice that) find a quest `in` a state, or
   * throws.
   */
  private awaitQuest(
    quest: QuestDef,
    holds: (state: QuestState | undefined) => boolean,
    what: string,
  ): void {
    const me = this.me();
    if (this.stepUntil(() => holds(me.quests[quest.key]), 2 * TICKS_PER_SECOND)) return;
    const s = me.survival;
    const open = Object.keys(me.quests).join(', ');
    throw new Error(
      `${quest.key} is not ${what} (quests open: ${open}; ${s.dead ? `dead of ${s.cause}` : 'alive'})`,
    );
  }

  /** Stands in biomes not walked yet, the nearest of each found from home, until `count`. */
  private async explore(count: number): Promise<void> {
    const ctx = this.view.gen;
    const walked = () => Object.keys(this.me().biomes);
    for (const biome of ctx.biomes) {
      if (walked().length >= count) break;
      if (walked().includes(biome.def.key)) continue;
      const hit = findBiome(ctx, biome.def.key, this.home, this.searchRadius);
      if (!hit) continue;
      await this.port.travel(hit.x + 0.5, 'surface', hit.z + 0.5);
      this.stepUntil(() => walked().includes(biome.def.key), 2 * TICKS_PER_SECOND);
    }
    await this.goHome();
    if (walked().length < count) throw new Error(`only ${walked().join(', ')} walked`);
  }

  /** Strikes creatures of kinds not met yet (each hunted in the pit) until `count` are met. */
  private async meet(count: number): Promise<void> {
    const bestiary = this.me().bestiary;
    const met = () => Object.keys(bestiary).length;
    for (const creature of this.registry.pack.creatures ?? []) {
      if (met() >= count) return;
      if (bestiary[creature.key] !== undefined) continue;
      await this.hunt(creature, await this.weapon(0), () => bestiary[creature.key] !== undefined);
    }
    if (met() < count) throw new Error(`only ${Object.keys(bestiary).join(', ')} met`);
  }

  /**
   * The home pad (staging): stone around the player's feet cell up to the feet, but for the room's
   * floor one block lower and the doorway; air over it all.
   */
  private async preparePad(): Promise<void> {
    const b = this.me().body;
    this.home = { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
    const { x, y, z } = this.home;
    const air = this.registry.air;
    this.fill(x - PAD, y - 2, z - PAD, x + PAD, y, z + PAD, this.wallState());
    this.fill(x - PAD, y + 1, z - PAD, x + PAD, y + CLEAR, z + PAD, air);
    this.fill(x - ROOM, y, z - ROOM, x + ROOM, y, z + ROOM, air);
    this.fill(x + WALL, y, z + DOOR, x + WALL, y, z + DOOR, air);
    await this.goHome(true);
  }

  /**
   * The cabin, built by hand: a ring of walls on the pad (the doorway left open), the pack's
   * door (its tall block) in the doorway, a roof over walls and room. A block goes in once the walk
   * stands where its eye sees a face to place it on; the others wait for the next round.
   */
  private async buildCabin(): Promise<void> {
    const { x, y, z } = this.home;
    const wall = blockItemKey(this.wallBlock());
    const doorBlock = this.registry.blocks.find((b) => b.placement?.tall === 2);
    if (!doorBlock) throw new Error('the pack has no door (a block two cells tall)');
    const door = blockItemKey(doorBlock.key);
    const walls: Cell[] = [];
    const roof: Cell[] = [];
    for (let dz = -WALL; dz <= WALL; dz++)
      for (let dx = -WALL; dx <= WALL; dx++) {
        roof.push({ x: x + dx, y: y + ROOF, z: z + dz });
        // The doorway: the door's upper half takes the wall's place.
        const doorway = dx === WALL && dz === DOOR;
        if (Math.max(Math.abs(dx), Math.abs(dz)) === WALL && !doorway)
          walls.push({ x: x + dx, y: y + 1, z: z + dz });
      }
    await this.obtain(wall, walls.length + roof.length, 0);
    await this.obtain(door, 1, 0);
    const plan = [
      ...walls.map((cell) => ({ cell, item: wall })),
      { cell: { x: x + WALL, y, z: z + DOOR }, item: door },
      ...roof.map((cell) => ({ cell, item: wall })),
    ];
    for (let left = plan; left.length > 0; ) {
      const next: typeof plan = [];
      for (const p of left) if (!(await this.placeAt(p.cell, p.item))) next.push(p);
      if (next.length === left.length)
        throw new Error(`no stand sees where ${next.map((p) => cellText(p.cell)).join(', ')} go`);
      left = next;
    }
    await this.goHome();
  }

  /**
   * A sip of fresh water from the pool dug in the home floor, the hand empty (the drink an
   * objective asks for).
   */
  private async sip(): Promise<void> {
    await this.goHome();
    const liquid = this.registry.blocks.find((b) => (b.liquid?.thirstPerSip ?? 0) > 0);
    if (!liquid?.liquid?.drinkable) throw new Error('the pack has no drinkable water');
    const pool = { x: this.home.x + POOL.dx, y: this.home.y - 1, z: this.home.z + POOL.dz };
    // On a stone bed: the cabin's air must not reach the ground under the floor through it.
    this.fill(pool.x, pool.y - 1, pool.z, pool.x, pool.y - 1, pool.z, this.wallState());
    this.fill(
      pool.x,
      pool.y,
      pool.z,
      pool.x,
      pool.y,
      pool.z,
      this.registry.defaultState(liquid.key),
    );
    const s = this.me().survival;
    const before = s.thirst;
    const ticks = ticksOf(this.registry.pack.balance.water.sipSec) + SIP_SLACK;
    await this.port.hold(
      'secondary',
      this.emptyHand(),
      { x: pool.x + 0.5, y: pool.y + 0.5, z: pool.z + 0.5 },
      ticks,
    );
    if (!this.me().drank || s.thirst <= before)
      throw new Error(`no sip from the ${liquid.key} pool at ${cellText(pool)}`);
  }

  /**
   * Drinks at the home pool while thirsty: under the level health needs to regenerate (the
   * onboarding's tip), sips until thirst is nearly full.
   */
  private async quench(): Promise<void> {
    const balance = this.registry.pack.balance;
    const s = this.me().survival;
    if (s.thirst >= balance.health.regenThirstAt) return;
    for (let sip = 0; sip < MAX_SIPS && s.thirst < balance.thirst.max * FULL; sip++)
      await this.sip();
  }

  /**
   * Holds out nights in the cabin: from LATE_HOUR, real ticks until `done` (the mornings counted).
   */
  private holdOut(nights: number, done: () => boolean): void {
    this.port.send({ type: 'debug.freezeTime', frozen: false });
    this.port.send({ type: 'debug.setTime', hours: LATE_HOUR });
    const held = this.stepUntil(done, DAY_TICKS * nights, TICKS_PER_SECOND);
    const s = this.me().survival;
    if (!held || s.dead)
      throw new Error(`the nights were not held out, ${s.dead ? `dead of ${s.cause}` : 'alive'}`);
  }

  /** The hunting pit: in the pad, a block in from its west edge (the door is east). */
  protected override pitSpot(): Cell {
    return { x: this.home.x - PAD + 1, y: this.home.y - 1, z: this.home.z };
  }

  /** The next free station spot on the home floor. */
  protected override nextSpot(): Cell {
    const spot = SPOTS[this.spots++];
    if (!spot) throw new Error(`no station spot left in the home room (${SPOTS.length} used)`);
    return { x: this.home.x + spot[0], y: this.home.y, z: this.home.z + spot[1] };
  }
}
