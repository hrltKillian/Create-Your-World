import { Matrix4 } from 'three';
import type { Registry } from '../content/registry.ts';
import type { ModelDef } from '../content/schema.ts';
import type { PlayerState } from '../sim/player.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BoxBatch } from './BoxBatch.ts';
import { animate, createRig, poseModel, type RigState } from './rigs.ts';

interface Tracked {
  rig: RigState;
  lastX: number;
  lastZ: number;
}

/** Draws entities as posed box models into the BoxBatch (players for now, creatures from M10). */
export class EntityView {
  private readonly batch: BoxBatch;
  private readonly world: VoxelWorld;
  private readonly avatar: ModelDef | null;
  private readonly layers: number[];
  private readonly rigs = new Map<number, Tracked>();
  private readonly root = new Matrix4();
  private readonly scratch: Matrix4[] = [];

  constructor(batch: BoxBatch, world: VoxelWorld, registry: Registry) {
    this.batch = batch;
    this.world = world;
    const key = registry.pack.manifest.bindings.avatarModel;
    this.avatar = (registry.pack.models ?? []).find((m) => m.key === key) ?? null;
    this.layers = (this.avatar?.parts ?? []).map((p) =>
      Math.max(0, registry.textureKeys.indexOf(p.texture)),
    );
  }

  /** Rig of a player (created on first use), for tests and the debug hook. */
  rig(id: number): RigState | null {
    return this.rigs.get(id)?.rig ?? null;
  }

  /** Animates a player and, when `visible`, adds its boxes to the batch. */
  drawPlayer(player: Readonly<PlayerState>, alpha: number, dt: number, visible: boolean): void {
    const model = this.avatar;
    if (!model) return;
    const b = player.body;
    const x = player.prevX + (b.x - player.prevX) * alpha;
    const y = player.prevY + (b.y - player.prevY) * alpha;
    const z = player.prevZ + (b.z - player.prevZ) * alpha;
    let tracked = this.rigs.get(player.id);
    if (!tracked) {
      tracked = { rig: createRig(), lastX: x, lastZ: z };
      this.rigs.set(player.id, tracked);
    }
    const distance = Math.hypot(x - tracked.lastX, z - tracked.lastZ);
    tracked.lastX = x;
    tracked.lastZ = z;
    animate(tracked.rig, {
      distance,
      speed: Math.hypot(b.vx, b.vz),
      onGround: b.onGround,
      crouching: b.crouching,
      swimming: b.inWater,
      pitch: player.pitch,
      dt,
    });
    if (!visible) return;
    const light = this.world.getLight(Math.floor(x), Math.floor(y + 1), Math.floor(z));
    const sky = (light >> 4) / 15;
    const block = (light & 15) / 15;
    this.root.makeRotationY(player.yaw).setPosition(x, y, z);
    const crouchDrop = b.crouching ? 0.25 : 0;
    poseModel(
      model,
      tracked.rig,
      this.root,
      crouchDrop,
      (i, box) => this.batch.add(box, this.layers[i]!, sky, block),
      this.scratch,
    );
  }
}
