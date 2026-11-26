import { Matrix4 } from 'three';
import type { Registry } from '../content/registry.ts';
import type { PlayerState } from '../sim/player.ts';
import { blockOf, skyOf } from '../world/light.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BoxBatch, BoxSkin } from './BoxBatch.ts';
import type { ContactShadows } from './ContactShadows.ts';
import { drawItem, type ItemModel } from './itemModels.ts';
import {
  animate,
  createRig,
  type Motion,
  type PreparedModel,
  partSkin,
  poseModel,
  prepareModel,
  type RigState,
} from './rigs.ts';

/** How far the upper body sinks when crouching (blocks): standing 1.8 → crouching 1.5 box. */
const CROUCH_DROP = 0.25;
/** Edge of a held block and height of a held sprite item, in the third-person view (blocks). */
const HELD_BLOCK = 0.28;
const HELD_SPRITE = 0.55;

function skipBox(): void {}

interface Tracked {
  rig: RigState;
  lastX: number;
  lastZ: number;
}

/** Draws players as posed box models into the BoxBatch (creatures: CreatureView). */
/** The radius of the avatar's contact shadow (blocks). */
const AVATAR_SHADOW = 0.35;

export class EntityView {
  private readonly batch: BoxBatch;
  private readonly shadows: ContactShadows | null;
  private readonly world: VoxelWorld;
  private readonly registry: Registry;
  private readonly items: readonly ItemModel[];
  private readonly avatar: PreparedModel | null;
  private readonly skins: BoxSkin[];
  private readonly rigs = new Map<number, Tracked>();
  private readonly root = new Matrix4();
  private readonly held = new Matrix4();
  private readonly grip = new Matrix4();
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
    striking: false,
    dt: 0,
  };
  private readonly addBox = (i: number, box: Matrix4): void => {
    this.batch.add(box, this.skins[i]!, this.sky, this.block);
  };

  /** `shadows`: the contact shadow the avatar lays on the ground (plan v4 « M41 »). */
  constructor(
    batch: BoxBatch,
    world: VoxelWorld,
    registry: Registry,
    items: readonly ItemModel[],
    shadows: ContactShadows | null = null,
  ) {
    this.shadows = shadows;
    this.batch = batch;
    this.world = world;
    this.registry = registry;
    this.items = items;
    const key = registry.pack.manifest.bindings.avatarModel;
    const model = (registry.pack.models ?? []).find((m) => m.key === key);
    this.avatar = model ? prepareModel(model) : null;
    this.skins = model ? model.parts.map((p) => partSkin(registry, model, p)) : [];
  }

  /** Rig of a player (created on first use), for tests and the debug hook. */
  rig(id: number): RigState | null {
    return this.rigs.get(id)?.rig ?? null;
  }

  /**
   * Animates a player and, when `visible`, adds its boxes and its held item to the batch. The
   * right arm takes the strike pose while the player holds the primary button (cocked while an
   * attack charges).
   */
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
    motion.striking = player.input.primary;
    motion.dt = dt;
    animate(tracked.rig, motion);
    if (visible) {
      const light = this.world.getLight(Math.floor(x), Math.floor(y + 1), Math.floor(z));
      this.sky = skyOf(light) / 15;
      this.block = blockOf(light) / 15;
    }
    // Posed even when hidden (first person), so the rig's measurements stay current.
    this.root.makeRotationY(player.yaw).setPosition(x, y, z);
    const crouchDrop = b.crouching ? CROUCH_DROP : 0;
    const visit = visible ? this.addBox : skipBox;
    poseModel(model, tracked.rig, this.root, crouchDrop, visit, this.scratch);
    if (visible) {
      this.drawHeld(player, model);
      this.shadows?.add(x, y, z, AVATAR_SHADOW);
    }
  }

  /** The held item at the bottom of the right arm: blocks in the fist, tools pointing forward. */
  private drawHeld(player: Readonly<PlayerState>, model: PreparedModel): void {
    const stack = player.inventory[player.input.slot];
    const item = stack ? this.registry.itemId(stack.item) : -1;
    if (item < 0 || model.hand < 0) return;
    const items = this.items[item]!;
    const arm = model.model.parts[model.hand]!;
    // The fist: bottom centre of the arm box, in the arm's posed frame (model units are 1/16).
    const fx = (arm.from[0] + arm.to[0]) / 32;
    const fy = arm.from[1] / 16;
    const fz = (arm.from[2] + arm.to[2]) / 32;
    this.held.copy(this.scratch[model.hand]!).multiply(this.grip.makeTranslation(fx, fy, fz));
    if (items.sprite) {
      // The icon's handle (bottom left) in the fist, its head forward (−z) along the arm's swing.
      this.held.multiply(this.grip.makeRotationY(Math.PI / 2));
      this.held.multiply(this.grip.makeScale(HELD_SPRITE, HELD_SPRITE, HELD_SPRITE));
      this.held.multiply(this.grip.makeTranslation(0.35, 0.35, 0));
    } else {
      this.held.multiply(this.grip.makeScale(HELD_BLOCK, HELD_BLOCK, HELD_BLOCK));
      this.held.multiply(this.grip.makeTranslation(0, -0.3, -0.2));
    }
    drawItem(this.batch, items, this.held, this.sky, this.block, true);
  }
}
