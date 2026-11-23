import type { Registry } from '../content/registry.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import type { ClientTarget } from '../sim/commands.ts';
import { usesAimedBlock } from '../sim/interaction.ts';
import { type Placement, planPlacement } from '../sim/placement.ts';
import type { PlayerState } from '../sim/player.ts';
import { REACH } from '../sim/targeting.ts';
import { createRayHit, faceOfNormal, raycast } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';

const dir: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Client-side targeting, every frame: the block under the crosshair from the interpolated eye
 * (outline, and the target sent with the next input command) and where secondary would place the
 * held block (the ghost), planned with the simulation's own placement rules.
 */
export class ClientAim {
  readonly hit = createRayHit();
  /**
   * The planned placement; `state` −1 when secondary would place nothing, `upper` −1 unless it is
   * a tall block (door) whose upper half goes in the cell above.
   */
  readonly ghost: Placement = { x: 0, y: 0, z: 0, state: -1, upper: -1 };
  private readonly world: VoxelWorld;
  private readonly registry: Registry;
  /** The local player alone: the only body a local placement can be blocked by in v1. */
  private readonly players: readonly PlayerState[];
  private readonly player: Readonly<PlayerState>;

  constructor(world: VoxelWorld, registry: Registry, player: Readonly<PlayerState>) {
    this.world = world;
    this.registry = registry;
    this.player = player;
    this.players = [player as PlayerState];
  }

  /** Casts the aim ray from `eye` along the view; `slot` and `crouch` are the client's input. */
  update(eye: Readonly<Vec3>, yaw: number, pitch: number, slot: number, crouch: boolean): void {
    const tables = this.registry.tables;
    lookVector(yaw, pitch, dir);
    raycast(this.world, tables, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, REACH, this.hit);
    this.ghost.state = -1;
    this.ghost.upper = -1;
    const hit = this.hit;
    if (!hit.hit || usesAimedBlock(this.registry, hit.state, crouch)) return;
    const stack = this.player.inventory[slot];
    const item = stack ? this.registry.itemId(stack.item) : -1;
    const state = item < 0 ? -1 : this.registry.itemTables.places[item]!;
    if (state < 0) return;
    const player = this.players[0]!;
    // A refusal leaves the ghost as reset above.
    planPlacement(this.world, this.registry, this.players, player, hit, state, this.ghost);
  }

  /** The target for the next input command (none when the ray hits nothing or starts inside). */
  target(): ClientTarget | undefined {
    const hit = this.hit;
    const face = faceOfNormal(hit.nx, hit.ny, hit.nz);
    if (!hit.hit || face < 0) return undefined;
    return { x: hit.x, y: hit.y, z: hit.z, face };
  }
}
