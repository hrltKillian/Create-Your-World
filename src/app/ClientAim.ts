import type { Registry } from '../content/registry.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import type { ClientTarget } from '../sim/commands.ts';
import type { CreatureState } from '../sim/creatures.ts';
import { usesAimedBlock } from '../sim/interaction.ts';
import { blowReach, creatureOnRay, weaponOf } from '../sim/melee.ts';
import { type Placement, planPlacement } from '../sim/placement.ts';
import type { PlayerState } from '../sim/player.ts';
import type { Entity } from '../sim/Simulation.ts';
import { REACH } from '../sim/targeting.ts';
import { createRayHit, faceOfNormal, raycast } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';

const dir: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Client-side targeting, every frame, from the interpolated eye: the creature a blow would hit
 * (creatures are tested first, as the simulation does), else the block under the crosshair
 * (outline, and the target sent with the next input command) and where secondary would place the
 * held block (the ghost), planned with the simulation's own placement rules.
 */
export class ClientAim {
  /** The block under the crosshair (`hit` false: none, or a creature is aimed at). */
  readonly hit = createRayHit();
  /** The creature in the held weapon's reach under the crosshair (its name shows on the HUD). */
  creature: Readonly<CreatureState> | undefined;
  /**
   * The planned placement; `state` −1 when secondary would place nothing, `upper` −1 unless it is
   * a tall block (door) whose upper half goes in the cell above.
   */
  readonly ghost: Placement = { x: 0, y: 0, z: 0, state: -1, upper: -1 };
  private readonly world: VoxelWorld;
  private readonly registry: Registry;
  private readonly player: Readonly<PlayerState>;
  /** Every entity of the view (creatures to aim at; bodies a placement is blocked by). */
  private readonly entities: ReadonlyMap<number, Readonly<Entity>>;

  constructor(
    world: VoxelWorld,
    registry: Registry,
    player: Readonly<PlayerState>,
    entities: ReadonlyMap<number, Readonly<Entity>>,
  ) {
    this.world = world;
    this.registry = registry;
    this.player = player;
    this.entities = entities;
  }

  /** Casts the aim ray from `eye` along the view; `slot` and `crouch` are the client's input. */
  update(eye: Readonly<Vec3>, yaw: number, pitch: number, slot: number, crouch: boolean): void {
    const tables = this.registry.tables;
    lookVector(yaw, pitch, dir);
    const hit = this.hit;
    this.ghost.state = -1;
    this.ghost.upper = -1;
    this.creature = this.aimedCreature(eye, slot);
    if (this.creature) {
      hit.hit = false;
      return;
    }
    raycast(this.world, tables, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, REACH, hit);
    if (!hit.hit || usesAimedBlock(this.registry, hit.state, crouch)) return;
    const stack = this.player.inventory[slot];
    const item = stack ? this.registry.itemId(stack.item) : -1;
    const state = item < 0 ? -1 : this.registry.itemTables.places[item]!;
    if (state < 0) return;
    const player = this.player as PlayerState;
    // A refusal leaves the ghost as reset above.
    planPlacement(this.world, this.registry, this.entities, player, hit, state, this.ghost);
  }

  /** The target for the next input command (none when the ray hits nothing or starts inside). */
  target(): ClientTarget | undefined {
    const hit = this.hit;
    const face = faceOfNormal(hit.nx, hit.ny, hit.nz);
    if (!hit.hit || face < 0) return undefined;
    return { x: hit.x, y: hit.y, z: hit.z, face };
  }

  /** The creature the view ray enters first within the reach of the weapon in `slot`. */
  private aimedCreature(eye: Readonly<Vec3>, slot: number): Readonly<CreatureState> | undefined {
    const registry = this.registry;
    const reach = weaponOf(registry, this.player.inventory[slot]).reach;
    let bestT = blowReach(this.world, registry.tables, eye.x, eye.y, eye.z, dir, reach);
    let best: Readonly<CreatureState> | undefined;
    for (const e of this.entities.values()) {
      const t = creatureOnRay(registry, e, eye.x, eye.y, eye.z, dir, bestT);
      if (t < 0) continue;
      best = e as Readonly<CreatureState>;
      bestT = t;
    }
    return best;
  }
}
