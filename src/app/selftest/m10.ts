import { HOSTILE_MAX_LIGHT, type ItemDef, type WeaponDef } from '../../content/schema.ts';
import { DYING_TICKS } from '../../core/creatures.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { ticksOf } from '../../sim/clock.ts';
import { type CreatureState, isHostile } from '../../sim/creatures.ts';
import type { SimEvent } from '../../sim/events.ts';
import { countItem } from '../../sim/inventory.ts';
import { MELEE } from '../../sim/melee.ts';
import { eyeHeight } from '../../sim/physics.ts';
import { SPAWN } from '../../sim/spawning.ts';
import { daylightAt } from '../../sim/time.ts';
import { SECTION_SIZE } from '../../world/coords.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { effectiveLight } from '../../world/light.ts';
import type { App } from '../App.ts';
import {
  fill,
  freezeTime,
  give,
  look,
  press,
  setBlock,
  setTime,
  waitUntil,
} from '../automation.ts';
import { MOBS, mobsBenchmark } from '../benchmarks.ts';
import { census, creatureList, killCreature, placeCreature } from '../creatureAutomation.ts';
import { god, setStat } from '../survivalAutomation.ts';
import {
  assert,
  assertTiming,
  emitterOf,
  keepingClock,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
  TORCH_LIGHT,
} from './support.ts';

/**
 * M10 « Fait quand » browser checks on the flat world with fixed steps, in two setups (the
 * creature rules are fixed when the world opens):
 * - ?worldType=flat&fixedStep=1&selftest=m0,m10 (no natural spawns, the selftest default): at
 *   23:00 a Prowler placed 10 blocks in front of the player hurts them within 300 ticks; a first
 *   stealthy spear blow on a Trotter deals 9, one it sees coming 6; killed, a Trotter leaves its
 *   loot (meat and hide); benchmark('mobs') keeps a simulation tick p95 ≤ 1.5 ms.
 * - the same with &rd=4&spawns=1&grace=0: at noon no hostile spawns on the surface over 3 600
 *   ticks; at 23:00 at least 3 do, each in an effective light ≤ 4, none within Manhattan 9 of the
 *   torches placed around the player.
 * Each setup skips the other's cases. Creatures and the spear come from the pack's data (engine
 * code never names content): the stalker, the grazer, the weapon that reaches farthest. The
 * Trotters are trapped in pits (1 × 1, 2 deep) so they cannot flee out of reach; the player
 * strikes from the pit's east edge, the creature placed from the west edge (its back turned) or
 * from the east one (facing the player).
 */

const NIGHT_HOUR = 23;
const NOON = 12;
/** « Prowler placé à 10 blocs face au joueur → santé < 100 en 300 ticks ». */
const HUNT_DISTANCE = 10;
const HUNT_TICKS = 300;
/** « au moins 3 hostiles en 3 600 ticks la nuit », « à midi : 0 hostile en surface sur 3 600 ». */
const SPAWN_TICKS = 3600;
const MIN_NIGHT_HOSTILES = 3;
/** « une torche (14) protège jusqu'à une distance de Manhattan de 9 »: 14 − 9 = 5 > 4. */
const TORCH_GUARD = TORCH_LIGHT - HOSTILE_MAX_LIGHT - 1;
/** Torches on a grid around the player (block offsets on both axes), over the spawn ring. */
const TORCH_OFFSETS = [-30, -10, 10, 30];
/** « benchmark('mobs') : tick p95 ≤ 1,5 ms », over 10 s of ticks. */
const MOBS_TICK_P95_MS = 1.5;
const BENCH_SECONDS = 10;

/** Columns of the cases, flat ground no other case edits (m3 to m7 work around the spawn). */
const HUNT = { x: 24, z: 24 };
const STEALTH_PIT = { x: -24, z: 24 };
const SEEN_PIT = { x: -24, z: 30 };
const LOOT_PIT = { x: -24, z: 40 };
const BENCH = { x: 0, z: -24 };
/** Feet of a creature trapped in a pit: two blocks under the ground's top. */
const PIT_FEET = FLAT_SURFACE - 1;
/** Where the player aims on a creature: 3/4 of its height (into its pit from the edge). */
const AIM_HEIGHT = 0.75;
/** Blows the loot case may take to kill its Trotter (9 + 6; 6 + 6 even without stealth). */
const MAX_BLOWS = 3;
/** Ticks a weapon's cooldown may take before a blow (the spear's: 24). */
const COOLDOWN_LIMIT = 120;
/** The drops of a death are counted within this many blocks of its pit. */
const DROP_RADIUS = 3;

interface Spot {
  readonly x: number;
  readonly z: number;
}

/** The combat cases and the benchmark: the flat world, fixed steps, no natural spawns. */
function needsCombatSetup(app: App): string | null {
  const flat = needsFlatPlayer(app);
  if (flat) return flat;
  return app.params.spawns ? 'natural spawns would join in (without ?spawns=1)' : null;
}

/** The spawn cases: the flat world, fixed steps, natural spawns from the first tick. */
function needsSpawnSetup(app: App): string | null {
  const flat = needsFlatPlayer(app);
  if (flat) return flat;
  return app.params.spawns && app.params.grace === 0 ? null : 'needs ?spawns=1&grace=0';
}

/** The pack's creature with a brain: the stalker (Prowler) or the grazer (Trotter). */
function creatureWith(app: App, brain: 'stalker' | 'grazer') {
  const def = app.registry!.pack.creatures?.find((c) => c.brain === brain);
  assert(def, `the content pack has no ${brain} creature`);
  return def;
}

/** A creature's live record (fails once it is gone). */
function creatureRecord(app: App, id: number): Readonly<CreatureState> {
  const c = app.session!.host.view.entities.get(id);
  assert(c?.kind === 'creature', `creature ${id} is gone`);
  return c;
}

/** Runs `body` and returns the events the session handed its listeners meanwhile. */
function eventsDuring(app: App, body: () => void): SimEvent[] {
  const listeners = app.session!.listeners;
  const events: SimEvent[] = [];
  const listener = (event: SimEvent) => {
    events.push(event);
  };
  listeners.push(listener);
  try {
    body();
  } finally {
    listeners.splice(listeners.indexOf(listener), 1);
  }
  return events;
}

/** Kills every living hostile creature now (their loot stays on the ground). */
function killHostiles(app: App): void {
  const registry = app.registry!;
  for (const c of creatureList(app) ?? []) {
    const def = registry.creature(c.creature);
    if (def && isHostile(def)) killCreature(app, c.id);
  }
}

/** Gives the player the spear (the weapon that reaches farthest) and holds it; returns its weapon. */
function holdSpear(app: App): WeaponDef {
  const weapons = app.registry!.items.filter((item) => item.weapon !== undefined);
  const spear: ItemDef | undefined = weapons.sort((a, b) => b.weapon!.reach - a.weapon!.reach)[0];
  assert(spear?.weapon, 'no item of the pack is a weapon');
  const inventory = app.session!.player.inventory;
  if (!inventory.some((stack) => stack?.item === spear.key)) give(app, spear.key, 1);
  const slot = inventory.findIndex((stack) => stack?.item === spear.key);
  assert(slot >= 0 && slot < HOTBAR_SLOTS, `the ${spear.key} is in slot ${slot}, not the hotbar`);
  app.input!.slot = slot;
  return spear.weapon;
}

/** Steps until the held weapon may strike again. */
function cooledDown(app: App): void {
  const session = app.session!;
  for (let t = 0; t < COOLDOWN_LIMIT && session.player.attackCooldown > 0; t++) session.step(1);
  assert(session.player.attackCooldown === 0, `the weapon is still cooling down`);
}

/**
 * Digs a pit (1 × 1, 2 deep) and traps a creature in it, placed from its west edge (it faces west:
 * its back to the east edge) or from its east edge (it faces the player there). The weapon cools
 * down first, so the next blow lands while the creature settles (it stands still for 15 ticks).
 */
async function trap(app: App, creature: string, pit: Spot, back: boolean): Promise<number> {
  cooledDown(app);
  fill(app, pit.x, PIT_FEET, pit.z, pit.x, FLAT_SURFACE, pit.z, stateKey(app, app.registry!.air));
  await standAt(app, { x: pit.x + (back ? -1 : 1), z: pit.z });
  const id = placeCreature(app, creature, pit.x + 0.5, PIT_FEET, pit.z + 0.5);
  assert(id !== null, `the ${creature} could not be placed in the pit at (${pit.x}, ${pit.z})`);
  return id;
}

/**
 * From the east edge of a creature's pit, turns to the creature (from the simulation's eye) and
 * strikes: primary pressed one tick, the blow landing on the release. Returns those ticks' events.
 */
async function strike(app: App, id: number, pit: Spot): Promise<SimEvent[]> {
  const session = app.session!;
  cooledDown(app);
  await standAt(app, { x: pit.x + 1, z: pit.z });
  const c = creatureRecord(app, id);
  const height = app.registry!.creature(c.creature)!.hitbox[1];
  const b = session.player.body;
  const dx = c.body.x - b.x;
  const dy = c.body.y + height * AIM_HEIGHT - (b.y + eyeHeight(b));
  const dz = c.body.z - b.z;
  // lookVector: yaw 0 looks along −z, positive yaw turns towards −x.
  look(app, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  return eventsDuring(app, () => {
    press(app, 'primary', 1);
    session.step(1);
  });
}

/** Damage a creature took in a list of events. */
function damageTo(events: readonly SimEvent[], id: number): number {
  let total = 0;
  for (const e of events) if (e.type === 'creatureHurt' && e.id === id) total += e.amount;
  return total;
}

/** Items of a kind held by the player or lying within DROP_RADIUS of a pit. */
function itemsAround(app: App, item: string, pit: Spot): number {
  const session = app.session!;
  let n = countItem(session.player.inventory, item);
  for (const e of session.host.view.entities.values()) {
    if (e.kind !== 'itemDrop' || e.item !== item) continue;
    const dx = e.body.x - (pit.x + 0.5);
    const dz = e.body.z - (pit.z + 0.5);
    if (dx * dx + dz * dz <= DROP_RADIUS * DROP_RADIUS) n += e.count;
  }
  return n;
}

/** Waits until the render distance is meshed around the player: the whole spawn ring is lit. */
async function ringLoaded(app: App): Promise<void> {
  const session = app.session!;
  const rd = session.renderDistance;
  assert(rd * SECTION_SIZE >= SPAWN.ringMax, `render distance ${rd} is short of the spawn ring`);
  await waitUntil(() => session.chunksReady(rd), {
    timeoutMs: 50_000,
    label: `render distance ${rd} not meshed`,
    pump: () => session.pumpOnce(false),
    pollMs: 50,
  });
}

export const M10_SUITE: readonly SelftestCase[] = [
  {
    name: `at ${NIGHT_HOUR}:00 a Prowler placed ${HUNT_DISTANCE} blocks in front of the player hurts them within ${HUNT_TICKS} ticks`,
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsCombatSetup,
    run: async (app) => {
      const session = await playerSession(app);
      const full = app.registry!.pack.balance.health.max;
      const prowler = creatureWith(app, 'stalker');
      await standAt(app, HUNT);
      // North, along −z: « face au joueur ».
      look(app, 0, 0);
      setStat(app, 'health', full);
      await keepingClock(app, () => {
        setTime(app, NIGHT_HOUR);
        freezeTime(app, true);
        const { x, y, z } = session.player.body;
        const id = placeCreature(app, prowler.key, x, y, z - HUNT_DISTANCE);
        assert(id !== null, `the ${prowler.key} could not be placed`);
        try {
          const survival = session.player.survival;
          const events = eventsDuring(app, () => {
            for (let t = 0; t < HUNT_TICKS && survival.health >= full; t++) session.step(1);
          });
          const c = creatureRecord(app, id);
          const gap = Math.hypot(c.body.x - x, c.body.z - z).toFixed(1);
          assert(
            survival.health < full,
            `health is still ${survival.health} after ${HUNT_TICKS} ticks (the Prowler is in mode ${c.mode}, ${gap} blocks from where the player stands)`,
          );
          const blow = events.find((e) => e.type === 'playerHurt');
          const source = blow?.type === 'playerHurt' ? blow.source : null;
          assert(source === id, `the first blow came from entity ${source}, not the Prowler ${id}`);
        } finally {
          killCreature(app, id);
          setStat(app, 'health', full);
        }
      });
    },
  },
  {
    name: 'a first stealthy spear blow on a Trotter deals 9, one it sees coming 6',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsCombatSetup,
    run: async (app) => {
      await playerSession(app);
      const trotter = creatureWith(app, 'grazer');
      const spear = holdSpear(app);
      const ids: number[] = [];
      try {
        // Its back turned to the player and calm: ×1.5.
        const unaware = await trap(app, trotter.key, STEALTH_PIT, true);
        ids.push(unaware);
        const stealthy = damageTo(await strike(app, unaware, STEALTH_PIT), unaware);
        const expected = spear.damage * MELEE.stealthDamage;
        assert(stealthy === expected, `the stealthy blow dealt ${stealthy}, not ${expected}`);
        // Facing the player: the plain blow.
        const facing = await trap(app, trotter.key, SEEN_PIT, false);
        ids.push(facing);
        const seen = damageTo(await strike(app, facing, SEEN_PIT), facing);
        assert(seen === spear.damage, `the blow it saw coming dealt ${seen}, not ${spear.damage}`);
      } finally {
        for (const id of ids) killCreature(app, id);
      }
    },
  },
  {
    name: 'a Trotter killed by spear blows leaves its loot: meat and hide',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsCombatSetup,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const trotter = creatureWith(app, 'grazer');
      const loot = registry.loot(trotter.loot);
      assert(loot && loot.entries.length > 0, `the ${trotter.key} has no loot`);
      holdSpear(app);
      const before = loot.entries.map((entry) => itemsAround(app, entry.item, LOOT_PIT));
      const id = await trap(app, trotter.key, LOOT_PIT, true);
      try {
        let died: SimEvent | undefined;
        for (let blow = 0; blow < MAX_BLOWS && !died; blow++)
          died = (await strike(app, id, LOOT_PIT)).find(
            (e) => e.type === 'creatureDied' && e.id === id,
          );
        assert(died?.type === 'creatureDied', `the Trotter still stands after ${MAX_BLOWS} blows`);
        const by = session.player.id;
        assert(died.attacker === by, `it was killed by entity ${died.attacker}, not the player`);
        session.step(DYING_TICKS + 1);
        assert(!session.host.view.entities.has(id), 'the dead Trotter is still there');
        loot.entries.forEach((entry, i) => {
          const gained = itemsAround(app, entry.item, LOOT_PIT) - before[i]!;
          assert(
            gained >= entry.count[0],
            `it left ${gained} ${entry.item} (on the ground or picked up), not ${entry.count[0]}–${entry.count[1]}`,
          );
        });
      } finally {
        killCreature(app, id);
      }
    },
  },
  {
    name: `at noon no hostile spawns on the surface over ${SPAWN_TICKS} ticks`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsSpawnSetup,
    run: async (app) => {
      const session = await playerSession(app);
      const view = session.host.view;
      await ringLoaded(app);
      await keepingClock(app, () => {
        setTime(app, NOON);
        freezeTime(app, true);
        killHostiles(app);
        const from = view.tick();
        for (let t = SPAWN.everyTicks; t <= SPAWN_TICKS; t += SPAWN.everyTicks) {
          session.step(SPAWN.everyTicks);
          const surface = census(app)!.surfaceHostiles;
          assert(surface === 0, `${surface} hostiles on the surface after ${t} ticks at noon`);
        }
        const spawned = view.spawnLog.filter((e) => e.tick > from && !e.cave);
        const list = spawned.map((e) => `${e.creature} (light ${e.light})`).join(', ');
        assert(spawned.length === 0, `hostiles spawned on the surface at noon: ${list}`);
      });
    },
  },
  {
    name: `at ${NIGHT_HOUR}:00 at least ${MIN_NIGHT_HOSTILES} hostiles spawn in ${SPAWN_TICKS} ticks, each in an effective light ≤ ${HOSTILE_MAX_LIGHT} and beyond Manhattan ${TORCH_GUARD} of every torch`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsSpawnSetup,
    run: async (app) => {
      const session = await playerSession(app);
      const view = session.host.view;
      const world = app.world!;
      await ringLoaded(app);
      const torch = emitterOf(app, TORCH_LIGHT);
      const air = stateKey(app, app.registry!.air);
      const p = session.player.body;
      const y = Math.floor(p.y);
      const torches = TORCH_OFFSETS.flatMap((dx) =>
        TORCH_OFFSETS.map((dz) => ({ x: Math.floor(p.x) + dx, y, z: Math.floor(p.z) + dz })),
      );
      const immune = session.player.survival.god;
      // The hunters hit hard: a dead player gets no spawns around them.
      god(app, true);
      try {
        await keepingClock(app, () => {
          // The torches by day, when no hostile may spawn yet; then the night.
          setTime(app, NOON);
          freezeTime(app, true);
          try {
            for (const t of torches) {
              setBlock(app, t.x, t.y, t.z, stateKey(app, torch));
              assert(world.getBlock(t.x, t.y, t.z) === torch, `no torch at (${t.x}, ${y}, ${t.z})`);
            }
            killHostiles(app);
            const from = view.tick();
            setTime(app, NIGHT_HOUR);
            for (let t = 0; t < SPAWN_TICKS; t += SPAWN.everyTicks) session.step(SPAWN.everyTicks);
            const spawned = view.spawnLog.filter((e) => e.tick > from);
            assert(
              spawned.length >= MIN_NIGHT_HOSTILES,
              `${spawned.length} hostiles spawned in ${SPAWN_TICKS} ticks at night (< ${MIN_NIGHT_HOSTILES})`,
            );
            const daylight = daylightAt(NIGHT_HOUR);
            for (const e of spawned) {
              const cell = { x: Math.floor(e.x), y: e.y, z: Math.floor(e.z) };
              const where = `${e.creature} spawned at (${cell.x}, ${cell.y}, ${cell.z}) on tick ${e.tick}`;
              const now = effectiveLight(world.getLight(cell.x, cell.y, cell.z), daylight);
              assert(
                e.light <= HOSTILE_MAX_LIGHT && now <= HOSTILE_MAX_LIGHT,
                `${where} in an effective light of ${e.light} (${now} now), over ${HOSTILE_MAX_LIGHT}`,
              );
              for (const t of torches) {
                const d = Math.abs(cell.x - t.x) + Math.abs(cell.y - t.y) + Math.abs(cell.z - t.z);
                assert(
                  d > TORCH_GUARD,
                  `${where}, ${d} blocks (Manhattan) from the torch at (${t.x}, ${t.y}, ${t.z})`,
                );
              }
            }
          } finally {
            setTime(app, NOON);
            for (const t of torches) setBlock(app, t.x, t.y, t.z, air);
            killHostiles(app);
          }
        });
      } finally {
        god(app, immune);
      }
    },
  },
  {
    name: `benchmark('mobs'): ${MOBS.creatures} creatures by night keep a simulation tick p95 ≤ ${MOBS_TICK_P95_MS} ms`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsCombatSetup,
    run: async (app) => {
      await playerSession(app);
      await standAt(app, BENCH);
      const living = census(app)!.total;
      const result = await mobsBenchmark(app, BENCH_SECONDS);
      assert(result.creatures === MOBS.creatures, `${result.creatures} creatures placed`);
      assert(result.ticks === ticksOf(BENCH_SECONDS), `${result.ticks} ticks measured`);
      const after = census(app)!.total;
      assert(after === living, `${after} creatures live after the benchmark, ${living} before`);
      const ms = (v: number) => v.toFixed(3);
      assertTiming(
        app,
        result.tickP95 <= MOBS_TICK_P95_MS,
        `tick p95 ${ms(result.tickP95)} ms > ${MOBS_TICK_P95_MS} (median ${ms(result.tickMedian)}, max ${ms(result.tickMax)})`,
      );
    },
  },
  noErrorsCase('no errors and no missing strings after the m10 checks'),
];
