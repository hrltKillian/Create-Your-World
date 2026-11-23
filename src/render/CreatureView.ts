import { Matrix4 } from 'three';
import type { Registry } from '../content/registry.ts';
import type { CreatureDef } from '../content/schema.ts';
import { DYING_TICKS } from '../core/creatures.ts';
import { EYE_HEIGHT } from '../core/player.ts';
import type { CreatureState } from '../sim/creatures.ts';
import type { Entity } from '../sim/Simulation.ts';
import { blockOf, skyOf } from '../world/light.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { type BoxBatch, type BoxSkin, fullSkin } from './BoxBatch.ts';
import {
  animateCreature,
  type CreatureMotion,
  type CreatureRig,
  createCreatureRig,
  hitCreatureRig,
} from './creatureRig.ts';
import { type PreparedModel, poseModel, prepareModel } from './rigs.ts';

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
  /** Position held while a hit freezes the pose. */
  x: number;
  y: number;
  z: number;
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
 * 80 ms, a dead creature falls on its side and shrinks away (over DYING_TICKS). No nametags. No
 * allocation per frame once each creature has its rig.
 */
export class CreatureView {
  private readonly batch: BoxBatch;
  private readonly world: VoxelWorld;
  private readonly kinds = new Map<string, CreatureKind>();
  private readonly rigs = new Map<number, Tracked>();
  private readonly root = new Matrix4();
  private readonly turn = new Matrix4();
  private readonly scratch: Matrix4[] = [];
  private entities: ReadonlyMap<number, Readonly<Entity>> = new Map();
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
    dt: 0,
  };
  private readonly addBox = (i: number, box: Matrix4): void => {
    const kind = this.kind!;
    this.batch.add(box, kind.skins[i]!, this.sky, this.block, kind.glow[i]!, this.flash);
  };
  private readonly draw = (entity: Readonly<Entity>): void => {
    if (entity.kind === 'creature') this.drawCreature(entity);
  };
  private readonly sweep = (tracked: Tracked, id: number): void => {
    if (tracked.frame !== this.frame) this.rigs.delete(id);
  };

  constructor(batch: BoxBatch, world: VoxelWorld, registry: Registry) {
    this.batch = batch;
    this.world = world;
    for (const def of registry.pack.creatures ?? []) {
      const model = registry.model(def.model);
      if (!model) continue;
      this.kinds.set(def.key, {
        def,
        prepared: prepareModel(model),
        skins: model.parts.map((p) =>
          fullSkin(Math.max(0, registry.textureKeys.indexOf(p.texture))),
        ),
        glow: Uint8Array.from(model.parts, (part) => (part.emissive ? 1 : 0)),
      });
    }
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

  /** Adds every creature of `entities`, interpolated between the last two ticks by `alpha`. */
  drawAll(entities: ReadonlyMap<number, Readonly<Entity>>, alpha: number, dt: number): void {
    this.entities = entities;
    this.alpha = alpha;
    this.dt = dt;
    this.frame++;
    entities.forEach(this.draw);
    this.rigs.forEach(this.sweep);
  }

  private drawCreature(c: Readonly<CreatureState>): void {
    const kind = this.kinds.get(c.creature);
    if (!kind) return;
    const alpha = this.alpha;
    const b = c.body;
    let tracked = this.rigs.get(c.id);
    if (!tracked) {
      tracked = {
        rig: createCreatureRig(),
        lastX: b.x,
        lastZ: b.z,
        x: b.x,
        y: b.y,
        z: b.z,
        frame: 0,
      };
      this.rigs.set(c.id, tracked);
    }
    tracked.frame = this.frame;
    const rig = tracked.rig;
    // A hit freeze holds the body where it was too.
    if (rig.freeze <= 0) {
      tracked.x = c.prevX + (b.x - c.prevX) * alpha;
      tracked.y = c.prevY + (b.y - c.prevY) * alpha;
      tracked.z = c.prevZ + (b.z - c.prevZ) * alpha;
    }
    const { x, y, z } = tracked;
    const motion = this.motion;
    motion.distance = Math.hypot(x - tracked.lastX, z - tracked.lastZ);
    motion.speed = Math.hypot(b.vx, b.vz);
    motion.mode = c.mode;
    motion.look = this.lookAt(c, kind.def);
    motion.dt = this.dt;
    tracked.lastX = x;
    tracked.lastZ = z;
    animateCreature(rig, kind.prepared.model, motion);
    const hitbox = kind.def.hitbox;
    const light = this.world.getLight(Math.floor(x), Math.floor(y + hitbox[1] / 2), Math.floor(z));
    this.sky = skyOf(light) / 15;
    this.block = blockOf(light) / 15;
    this.flash = rig.flash;
    this.kind = kind;
    const yaw = c.prevYaw + angleDelta(c.prevYaw, c.yaw) * alpha;
    this.root.makeRotationY(yaw).setPosition(x, y, z);
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

  /** Head tilt towards the eyes of the player it watches, chases or winds up at (0: none). */
  private lookAt(c: Readonly<CreatureState>, def: CreatureDef): number {
    if (c.target < 0 || c.mode === 'flee' || c.mode === 'dying') return 0;
    const target = this.entities.get(c.target);
    if (target?.kind !== 'player') return 0;
    const t = target.body;
    const rise = t.y + EYE_HEIGHT - (c.body.y + def.hitbox[1] * 0.8);
    return -Math.atan2(rise, Math.hypot(t.x - c.body.x, t.z - c.body.z));
  }
}
