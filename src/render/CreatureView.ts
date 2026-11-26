import { Matrix4 } from 'three';
import type { Registry } from '../content/registry.ts';
import type { CreatureDef } from '../content/schema.ts';
import { CREATURE_EYE_SHARE, centreY, DYING_TICKS } from '../core/creatures.ts';
import { BODY_HEIGHT, CROUCH_BODY_HEIGHT } from '../core/player.ts';
import type { CreatureState } from '../sim/creatures.ts';
import type { Entity } from '../sim/Simulation.ts';
import { blockOf, skyOf } from '../world/light.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BoxBatch, BoxSkin } from './BoxBatch.ts';
import type { ContactShadows } from './ContactShadows.ts';
import {
  animateCreature,
  type CreatureMotion,
  type CreatureRig,
  createCreatureRig,
  hitCreatureRig,
} from './creatureRig.ts';
import { nthSmallest } from './nearest.ts';
import { type PreparedModel, partSkin, poseModel, prepareModel } from './rigs.ts';

/** A creature of the pack as drawn: its model, part skins and which parts glow. */
interface CreatureKind {
  readonly def: CreatureDef;
  readonly prepared: PreparedModel;
  readonly skins: readonly BoxSkin[];
  /** 1 for the emissive parts (the Prowler's eyes), else 0. */
  readonly glow: Uint8Array;
}

/** A creature's rig and where it was drawn last. */
interface Tracked {
  readonly rig: CreatureRig;
  lastX: number;
  lastZ: number;
  /** Frame it was last drawn in (rigs of creatures gone are dropped). */
  frame: number;
}

/** Share of the dying time spent falling over; it shrinks away over the second half. */
const FALL_SHARE = 0.4;
const SHRINK_FROM = 0.5;

/** The wrapped difference b − a of two angles, in [−π, π]. */
function angleDelta(a: number, b: number): number {
  const d = b - a;
  return d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
}

/**
 * Draws the creatures into the world BoxBatch as posed box models (creatureRig.ts), interpolated
 * between the last two ticks: emissive parts glow, a hit flashes red and freezes the pose for
 * 80 ms, a dead creature falls on its side and shrinks away (over DYING_TICKS). No nametags.
 * Only creatures within the render distance of the camera are drawn, and only as many as the room
 * left in the batch holds whole, the nearest first. No allocation per frame once each creature has
 * its rig (and the distance scratch has grown to the crowd).
 */
export class CreatureView {
  private readonly batch: BoxBatch;
  private readonly shadows: ContactShadows | null;
  private readonly world: VoxelWorld;
  private readonly kinds = new Map<string, CreatureKind>();
  private readonly rigs = new Map<number, Tracked>();
  private readonly root = new Matrix4();
  private readonly turn = new Matrix4();
  private readonly scratch: Matrix4[] = [];
  private entities: ReadonlyMap<number, Readonly<Entity>> = new Map();
  /** Boxes of the largest model: what one creature may take from the batch. */
  private readonly maxParts: number;
  /** Squared distances of the creatures within reach this frame, and nthSmallest's scratch. */
  private near = new Float64Array(256);
  private sorted = new Float64Array(256);
  private nearCount = 0;
  /** Squared horizontal distance up to which creatures are drawn this frame. */
  private limit2 = 0;
  /** Creatures the batch still holds this frame. */
  private budget = 0;
  private camX = 0;
  private camZ = 0;
  private frame = 0;
  private alpha = 1;
  private dt = 0;
  /** The creature being posed, read by `addBox` (no closure per creature). */
  private kind: CreatureKind | null = null;
  private sky = 1;
  private block = 0;
  private flash = 0;
  private readonly motion: { -readonly [K in keyof CreatureMotion]: CreatureMotion[K] } = {
    distance: 0,
    speed: 0,
    mode: 'idle',
    look: 0,
    turn: 0,
    dt: 0,
  };
  private readonly addBox = (i: number, box: Matrix4): void => {
    const kind = this.kind!;
    this.batch.add(box, kind.skins[i]!, this.sky, this.block, kind.glow[i]!, this.flash);
  };
  private readonly measure = (entity: Readonly<Entity>): void => {
    if (entity.kind !== 'creature' || !this.kinds.has(entity.creature)) return;
    const d = this.distance2(entity);
    if (d > this.limit2) return;
    if (this.nearCount === this.near.length) {
      const grown = new Float64Array(this.near.length * 2);
      grown.set(this.near);
      this.near = grown;
      this.sorted = new Float64Array(grown.length);
    }
    this.near[this.nearCount++] = d;
  };
  private readonly draw = (entity: Readonly<Entity>): void => {
    if (entity.kind !== 'creature' || this.budget <= 0) return;
    const kind = this.kinds.get(entity.creature);
    if (!kind || this.distance2(entity) > this.limit2) return;
    this.budget--;
    this.drawCreature(entity, kind);
  };
  private readonly sweep = (tracked: Tracked, id: number): void => {
    if (tracked.frame !== this.frame) this.rigs.delete(id);
  };

  /** `shadows`: the contact shadows each creature lays on the ground (plan v4 « M41 »). */
  constructor(
    batch: BoxBatch,
    world: VoxelWorld,
    registry: Registry,
    shadows: ContactShadows | null = null,
  ) {
    this.batch = batch;
    this.world = world;
    this.shadows = shadows;
    for (const def of registry.pack.creatures ?? []) {
      const model = registry.model(def.model);
      if (!model) continue;
      this.kinds.set(def.key, {
        def,
        prepared: prepareModel(model),
        skins: model.parts.map((p) => partSkin(registry, model, p)),
        glow: Uint8Array.from(model.parts, (part) => (part.emissive ? 1 : 0)),
      });
    }
    let maxParts = 1;
    for (const kind of this.kinds.values())
      maxParts = Math.max(maxParts, kind.prepared.model.parts.length);
    this.maxParts = maxParts;
  }

  /** Rig of a creature (tests and the debug hook). */
  rig(id: number): CreatureRig | null {
    return this.rigs.get(id)?.rig ?? null;
  }

  /** A blow landed on a creature: it flashes red and its pose freezes for a moment. */
  hurt(id: number): void {
    const tracked = this.rigs.get(id);
    if (tracked) hitCreatureRig(tracked.rig);
  }

  /**
   * Adds the creatures of `entities` within `reach` blocks of the camera (horizontally), as many
   * as the batch's room holds whole, the nearest first (drawn last, so they never take the room of
   * the drops and particles), interpolated between the last two ticks by `alpha`.
   */
  drawAll(
    entities: ReadonlyMap<number, Readonly<Entity>>,
    camX: number,
    camZ: number,
    reach: number,
    alpha: number,
    dt: number,
  ): void {
    this.entities = entities;
    this.camX = camX;
    this.camZ = camZ;
    this.alpha = alpha;
    this.dt = dt;
    this.frame++;
    this.limit2 = reach * reach;
    this.nearCount = 0;
    entities.forEach(this.measure);
    this.budget = Math.floor(this.batch.room / this.maxParts);
    if (this.nearCount > this.budget)
      this.limit2 =
        this.budget > 0 ? nthSmallest(this.near, this.nearCount, this.budget, this.sorted) : -1;
    entities.forEach(this.draw);
    this.rigs.forEach(this.sweep);
  }

  /** Squared horizontal distance from the camera to where the creature is drawn. */
  private distance2(c: Readonly<CreatureState>): number {
    const dx = c.prevX + (c.body.x - c.prevX) * this.alpha - this.camX;
    const dz = c.prevZ + (c.body.z - c.prevZ) * this.alpha - this.camZ;
    return dx * dx + dz * dz;
  }

  private drawCreature(c: Readonly<CreatureState>, kind: CreatureKind): void {
    const alpha = this.alpha;
    const b = c.body;
    let tracked = this.rigs.get(c.id);
    if (!tracked) {
      tracked = { rig: createCreatureRig(c.id), lastX: b.x, lastZ: b.z, frame: 0 };
      this.rigs.set(c.id, tracked);
    }
    tracked.frame = this.frame;
    const rig = tracked.rig;
    // A hit freezes the pose only (animateCreature): the body keeps following the simulation's
    // knockback, so it never catches up in one jump when the freeze ends.
    const x = c.prevX + (b.x - c.prevX) * alpha;
    const y = c.prevY + (b.y - c.prevY) * alpha;
    const z = c.prevZ + (b.z - c.prevZ) * alpha;
    const motion = this.motion;
    motion.distance = Math.hypot(x - tracked.lastX, z - tracked.lastZ);
    motion.speed = Math.hypot(b.vx, b.vz);
    motion.mode = c.mode;
    motion.look = this.lookAt(c, kind.def);
    const yaw = c.prevYaw + angleDelta(c.prevYaw, c.yaw) * alpha;
    motion.turn = this.turnTo(c, yaw);
    motion.dt = this.dt;
    tracked.lastX = x;
    tracked.lastZ = z;
    animateCreature(rig, kind.prepared.model, motion);
    const hitbox = kind.def.hitbox;
    const light = this.world.getLight(
      Math.floor(x),
      Math.floor(centreY(y, hitbox[1])),
      Math.floor(z),
    );
    this.sky = skyOf(light) / 15;
    this.block = blockOf(light) / 15;
    this.flash = rig.flash;
    this.kind = kind;
    this.root.makeRotationY(yaw).setPosition(x, y, z);
    this.shadows?.add(x, y, z, hitbox[0] * 0.6);
    if (c.mode === 'dying') this.fallOver(c, hitbox[0]);
    poseModel(kind.prepared, rig, this.root, 0, this.addBox, this.scratch);
  }

  /**
   * A dead creature rolls onto its side (lifted so it lies on the ground), then shrinks away
   * before the simulation removes it.
   */
  private fallOver(c: Readonly<CreatureState>, width: number): void {
    const progress = Math.min(1, Math.max(0, 1 - (c.modeTicks - this.alpha) / DYING_TICKS));
    const fall = Math.min(1, progress / FALL_SHARE) * (Math.PI / 2);
    const size =
      progress > SHRINK_FROM ? Math.max(0.01, 1 - (progress - SHRINK_FROM) / SHRINK_FROM) : 1;
    this.root.multiply(this.turn.makeTranslation(0, (width / 2) * Math.sin(fall) * size, 0));
    this.root.multiply(this.turn.makeRotationZ(fall));
    this.root.multiply(this.turn.makeScale(size, size, size));
  }

  /** The player a creature watches, chases or winds up at, if it looks at one. */
  private targetOf(
    c: Readonly<CreatureState>,
  ): Readonly<Extract<Entity, { kind: 'player' }>> | null {
    if (c.target < 0 || c.mode === 'flee' || c.mode === 'dying') return null;
    const target = this.entities.get(c.target);
    return target?.kind === 'player' ? target : null;
  }

  /**
   * Head tilt towards the middle of the body of the player it watches, chases or winds up at (0:
   * none): it aims at the player, not at the player's eyes (plan v3 « M18 »).
   */
  private lookAt(c: Readonly<CreatureState>, def: CreatureDef): number {
    const target = this.targetOf(c);
    if (!target) return 0;
    const t = target.body;
    const middle = (t.crouching ? CROUCH_BODY_HEIGHT : BODY_HEIGHT) / 2;
    const rise = t.y + middle - (c.body.y + def.hitbox[1] * CREATURE_EYE_SHARE);
    return -Math.atan2(rise, Math.hypot(t.x - c.body.x, t.z - c.body.z));
  }

  /** Turn of the head from the creature's facing (`yaw`) to that player (0: none; plan v5 « M52 »). */
  private turnTo(c: Readonly<CreatureState>, yaw: number): number {
    const target = this.targetOf(c);
    if (!target) return 0;
    // A model faces −z at yaw 0: the yaw facing a point is atan2(−dx, −dz).
    return angleDelta(yaw, Math.atan2(c.body.x - target.body.x, c.body.z - target.body.z));
  }
}
