import type { Registry } from '../content/registry.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import { MET, STUDIED } from '../core/creatures.ts';
import { createRayHit, RAY_OPAQUE, raycast } from '../world/raycast.ts';
import { ticksOf } from './clock.ts';
import type { CreatureState } from './creatures.ts';
import type { SimEvent } from './events.ts';
import { creatureAlong } from './melee.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/*
 * The bestiary (docs plan v2 « M17 »): a creature is met once the player sees or strikes it,
 * studied once a worn scanner has looked at it long enough or the player killed it. A scanner
 * (`WearDef.scanner`, head slot) studies the creature on the view within its range and in sight
 * after its seconds; looking away starts over. Tick step 8, after combat. Zero allocation.
 */

export { MET, STUDIED } from '../core/creatures.ts';

/** Raises a creature's entry in a player's bestiary to `level` (never lowers it). */
export function noteCreature(
  player: PlayerState,
  creature: string,
  level: number,
  out: SimEvent[],
): void {
  if ((player.bestiary[creature] ?? 0) >= level) return;
  player.bestiary[creature] = level;
  out.push({ type: 'bestiary', playerId: player.playerId, creature, level });
}

/** The scanner a player wears, if any. */
export function scannerOf(registry: Registry, player: Readonly<PlayerState>) {
  const head = player.equipment[0];
  return head ? registry.item(head.item)?.wear?.scanner : undefined;
}

const dir: Vec3 = { x: 0, y: 0, z: -1 };
const sight = createRayHit();
const at = { distance: 0 };

/** The living creature on a player's view within `range` blocks and in sight, if any. */
export function creatureInView(
  sim: Simulation,
  player: Readonly<PlayerState>,
  range: number,
): CreatureState | undefined {
  const b = player.body;
  const ey = b.y + eyeHeight(b);
  lookVector(player.yaw, player.pitch, dir);
  raycast(
    sim.world,
    sim.registry.tables,
    b.x,
    ey,
    b.z,
    dir.x,
    dir.y,
    dir.z,
    range,
    sight,
    RAY_OPAQUE,
  );
  return creatureAlong(sim, player, sight.hit ? sight.distance : range, at);
}

/** Scanners at work: each player's worn scanner counts the ticks on one creature. */
export function stepScanners(sim: Simulation, out: SimEvent[]): void {
  for (const player of sim.players.values()) {
    const scanner = player.survival.health > 0 ? scannerOf(sim.registry, player) : undefined;
    const c = scanner ? creatureInView(sim, player, scanner.range) : undefined;
    if (!scanner || !c) {
      player.scanId = -1;
      player.scanTicks = 0;
      continue;
    }
    if (c.id !== player.scanId) {
      player.scanId = c.id;
      player.scanTicks = 0;
    }
    noteCreature(player, c.creature, MET, out);
    if (player.scanTicks < ticksOf(scanner.seconds)) player.scanTicks++;
    if (player.scanTicks >= ticksOf(scanner.seconds))
      noteCreature(player, c.creature, STUDIED, out);
  }
}
