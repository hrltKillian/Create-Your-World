import { blockItemKey } from '../../content/items.ts';
import type { ObjectiveDef } from '../../content/schema.ts';
import { TICKS_PER_SECOND, ticksOf } from '../clock.ts';
import type { PlayerState } from '../player.ts';
import { DAY_TICKS, nightsSurvived } from '../time.ts';
import { type Cell, cellText, type WalkOptions, type WalkPort } from './walkPort.ts';
import { Supplies } from './walkSupplies.ts';

export type { Cell, HoldAction, Point, WalkOptions, WalkPort } from './walkPort.ts';

/*
 * The scripted walk through the pack's objectives (docs « Objectifs jusqu'au fer », M11 « Fait
 * quand »): from a home pad levelled around the player, each objective in chain order is done with
 * the game's own actions (walkSupplies.ts, walkHands.ts: blocks broken by holding primary with the
 * right tool and their drops walked onto, crafts queued as the Logbook does, stations placed and
 * fed, a sip, a cabin built block by block with secondary, a night held out in it, journeys to the
 * biomes of the deposits, a creature struck down with a spear), then the walk waits for the
 * once-a-second check and requires the objectives done so far to be exactly the chain's first
 * ones, in order. Everything is read from the pack (engine code never names content). The browser
 * runs it through `__game`'s automation (selftest/objectivesWalk.ts), tests on an inline
 * simulation of the same seed.
 * Debug commands stage what is not an objective's (« Retenu à l'intégration » of M11): the home pad
 * and the hunting pit are levelled and the drinking pool poured by `debug.fill`, a source block is
 * staged beside the player when none lies within the search, the materials no objective names are
 * given (`debug.give`), the hunted creature is placed (`debug.spawn`) at night (`debug.setTime`),
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
 * Walks the pack's objectives in order and returns the keys done (the whole chain). Throws when
 * one cannot be done, or the check does an objective out of its turn.
 */
export async function walkObjectives(port: WalkPort, options: WalkOptions): Promise<string[]> {
  const walk = new ObjectiveWalk(port, options);
  await walk.run();
  return [...walk.player.objectives];
}

class ObjectiveWalk extends Supplies {
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
    const chain = this.registry.pack.objectives ?? [];
    if (this.me().objectives.length > 0)
      throw new Error(`the player has already done ${this.me().objectives.join(', ')}`);
    await this.preparePad();
    for (let i = 0; i < chain.length; i++) {
      const objective = chain[i]!;
      await this.quench();
      await this.satisfy(objective);
      this.awaitCheck(chain, i);
      await this.goHome();
      await this.options.onDone?.(objective, i);
    }
  }

  /** Does what an objective asks for, part by part. */
  private async satisfy(objective: ObjectiveDef): Promise<void> {
    const c = objective.condition;
    for (const item of c.items ?? []) await this.obtain(item, 1, 0);
    for (const station of c.stations ?? []) await this.station(station, 0);
    if (c.drank) await this.sip();
    if (c.enclosed) await this.buildCabin();
    if (c.nights !== undefined) this.holdOut(c.nights);
  }

  /**
   * Steps until the next checks have done the objective, then requires the objectives done to be
   * the chain's first ones, in order.
   */
  private awaitCheck(chain: readonly ObjectiveDef[], index: number): void {
    const objective = chain[index]!;
    // The shelter is sampled every `checkSec`, the objectives once a second: twice both.
    const ticks = 2 * (ticksOf(this.registry.pack.balance.shelter.checkSec) + TICKS_PER_SECOND);
    const me = this.me();
    this.stepUntil(() => me.objectives.includes(objective.key), ticks);
    const expected = chain.slice(0, index + 1).map((o) => o.key);
    const done = me.objectives.join(', ');
    if (done === expected.join(', ')) return;
    const s = me.survival;
    throw new Error(
      `after ${objective.key} the objectives done are [${done}], not [${expected.join(', ')}] ` +
        `(shelter ${s.shelter}, ${s.dead ? `dead of ${s.cause}` : 'alive'})`,
    );
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
    if (s.thirst >= balance.health.regenFedAt) return;
    for (let sip = 0; sip < MAX_SIPS && s.thirst < balance.thirst.max * FULL; sip++)
      await this.sip();
  }

  /** Holds out the night in the cabin: from LATE_HOUR, real ticks until the morning counts it. */
  private holdOut(nights: number): void {
    const time = this.view.time();
    this.port.send({ type: 'debug.freezeTime', frozen: false });
    this.port.send({ type: 'debug.setTime', hours: LATE_HOUR });
    const held = this.stepUntil(
      () => nightsSurvived(time.ticks) >= nights,
      DAY_TICKS * nights,
      TICKS_PER_SECOND,
    );
    const s = this.me().survival;
    if (!held || s.dead)
      throw new Error(
        `${nightsSurvived(time.ticks)} night(s) held out, ${s.dead ? `dead of ${s.cause}` : 'alive'}`,
      );
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
