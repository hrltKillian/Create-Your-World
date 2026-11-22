import { Matrix4 } from 'three';
import type { Registry } from '../content/registry.ts';
import type { PlayerState } from '../sim/player.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BoxBatch } from './BoxBatch.ts';
import {
  animate,
  createRig,
  type Motion,
  type PreparedModel,
  poseModel,
  prepareModel,
  type RigState,
} from './rigs.ts';

/** How far the upper body sinks when crouching (blocks): standing 1.8 → crouching 1.5 box. */
const CROUCH_DROP = 0.25;

function skipBox(): void {}

interface Tracked {
  rig: RigState;
  lastX: number;
  lastZ: number;
}

/** Draws entities as posed box models into the BoxBatch (players for now, creatures from M10). */
export class EntityView {
  private readonly batch: BoxBatch;
  private readonly world: VoxelWorld;
  private readonly avatar: PreparedModel | null;
  private readonly layers: number[];
  private readonly rigs = new Map<number, Tracked>();
  private readonly root = new Matrix4();
  private readonly scratch: Matrix4[] = [];
  /** Light of the entity being drawn, read by `addBox` (avoids a closure per entity). */
  private sky = 1;
  private block = 0;
  private readonly motion: { -readonly [K in keyof Motion]: Motion[K] } = {
    distance: 0,
    speed: 0,
    onGround: true,
    crouching: false,
    swimming: false,
    pitch: 0,
    dt: 0,
  };
  private readonly addBox = (i: number, box: Matrix4): void => {
    this.batch.add(box, this.layers[i]!, this.sky, this.block);
  };

  constructor(batch: BoxBatch, world: VoxelWorld, registry: Registry) {
    this.batch = batch;
    this.world = world;
    const key = registry.pack.manifest.bindings.avatarModel;
    const model = (registry.pack.models ?? []).find((m) => m.key === key);
    this.avatar = model ? prepareModel(model) : null;
    this.layers = (model?.parts ?? []).map((p) =>
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
    const motion = this.motion;
    motion.distance = distance;
    motion.speed = Math.hypot(b.vx, b.vz);
    motion.onGround = b.onGround;
    motion.crouching = b.crouching;
    motion.swimming = b.inWater;
    motion.pitch = player.pitch;
    motion.dt = dt;
    animate(tracked.rig, motion);
    if (visible) {
      const light = this.world.getLight(Math.floor(x), Math.floor(y + 1), Math.floor(z));
      this.sky = (light >> 4) / 15;
      this.block = (light & 15) / 15;
    }
    // Posed even when hidden (first person), so the rig's measurements stay current.
    this.root.makeRotationY(player.yaw).setPosition(x, y, z);
    const crouchDrop = b.crouching ? CROUCH_DROP : 0;
    const visit = visible ? this.addBox : skipBox;
    poseModel(model, tracked.rig, this.root, crouchDrop, visit, this.scratch);
  }
}
