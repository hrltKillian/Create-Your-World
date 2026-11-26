import { Euler, MathUtils, Matrix4, Vector3 } from 'three';
import type { Registry } from '../content/registry.ts';
import { type ModelDef, type ModelPart, SKIN_TEXELS, type TexKey } from '../content/schema.ts';
import { type BoxSkin, fullSkin } from './BoxBatch.ts';

/** Texture space a model unit covers at the world's density: 2 texels at size 32 (1/16 block). */
const UNIT = 1 / 16;

/**
 * A model part's skin (plan v5 « M51 »): its sides' layer and its faces' own (`ModelPart.faces`).
 * A model at the world's density (`ModelDef.pixels`) shows on each face its own corner of the
 * texture, two texels a unit (the reference game's skins); else each face stretches the whole.
 * A model with a skin atlas (plan v5 « M52 ») unfolds each part's box from its `uv` there.
 */
export function partSkin(registry: Registry, model: ModelDef, part: ModelPart): BoxSkin {
  if (model.skin) {
    const texels = (axis: number) => Math.round((part.to[axis]! - part.from[axis]!) * SKIN_TEXELS);
    return {
      ...fullSkin(0),
      skin: Math.max(
        0,
        (registry.pack.skins ?? []).findIndex((s) => s.key === model.skin),
      ),
      ox: part.uv?.[0] ?? 0,
      oy: part.uv?.[1] ?? 0,
      sx: texels(0),
      sy: texels(1),
      sz: texels(2),
    };
  }
  const layer = (key: TexKey | undefined, fallback: number) =>
    key ? Math.max(0, registry.textureKeys.indexOf(key)) : fallback;
  const side = layer(part.texture, 0);
  const faces = part.faces;
  const whole = fullSkin(side);
  return {
    ...whole,
    top: layer(faces?.top, side),
    bottom: layer(faces?.bottom, side),
    front: layer(faces?.front, side),
    back: layer(faces?.back, side),
    ...(model.pixels
      ? {
          sx: (part.to[0] - part.from[0]) * UNIT,
          sy: (part.to[1] - part.from[1]) * UNIT,
          sz: (part.to[2] - part.from[2]) * UNIT,
        }
      : {}),
  };
}

/** Animation state of one model instance, kept on the render side. */
export interface RigState {
  /** Walk cycle phase (radians), advanced by distance travelled. */
  phase: number;
  /** Current limb swing amplitude (radians), eased towards the target. */
  amplitude: number;
  /** Seconds of breathing. */
  time: number;
  /** Last angles, exposed for tests (degrees). */
  readonly angles: Record<string, number>;
  /** Height of the drawn head pivot above the feet (blocks), from the last pose; for tests. */
  headPivotY: number;
  /** Blend (0–1) towards the strike pose, eased while the use button is held. */
  strike: number;
  /** Phase of the chopping motion (radians). */
  strikePhase: number;
}

export interface Motion {
  /** Horizontal distance moved since the last frame (blocks). */
  readonly distance: number;
  /** Horizontal speed (blocks per second). */
  readonly speed: number;
  readonly onGround: boolean;
  readonly crouching: boolean;
  readonly swimming: boolean;
  /** View pitch (radians, positive looks up). */
  readonly pitch: number;
  /** Primary held: the right arm strikes (mining, attacks). */
  readonly striking: boolean;
  readonly dt: number;
}

export function createRig(): RigState {
  return { phase: 0, amplitude: 0, time: 0, angles: {}, headPivotY: 0, strike: 0, strikePhase: 0 };
}

const STRIDE = 2.2; // radians per block walked
/** Strike pose: the right arm raised forward, chopping by ±STRIKE_CHOP at STRIKE_RATE rad/s. */
const STRIKE_RAISE = -1.3;
const STRIKE_CHOP = 0.5;
const STRIKE_RATE = 20;

/** Procedural animation: walk/run swing, crouch lean, jump/fall pose, swim strokes, breathing. */
export function animate(rig: RigState, motion: Motion): void {
  rig.time += motion.dt;
  rig.phase += motion.distance * STRIDE;
  const running = motion.speed > 5;
  let target = motion.speed > 0.2 ? Math.min(1, motion.speed / 4.3) * (running ? 0.95 : 0.65) : 0;
  if (!motion.onGround && !motion.swimming) target = 0.25;
  rig.amplitude += (target - rig.amplitude) * Math.min(1, motion.dt * 10);
  const swing = Math.sin(rig.phase) * rig.amplitude;
  const breath = Math.sin(rig.time * 2.2) * 0.03;
  const a = rig.angles;
  a.legL = swing;
  a.legR = -swing;
  a.armL = -swing * 0.8 + breath;
  a.armR = swing * 0.8 - breath;
  a.torso = motion.crouching ? 0.42 : 0;
  // Positive angles tilt a part forward (down); a positive pitch looks up.
  a.head = -motion.pitch * 0.7 - a.torso;
  if (!motion.onGround && !motion.swimming) {
    a.armL = -0.5;
    a.armR = -0.5;
  }
  if (motion.swimming) {
    const stroke = Math.sin(rig.time * 4) * 0.6;
    a.armL = -1.4 + stroke;
    a.armR = -1.4 - stroke;
    a.legL = Math.sin(rig.time * 5) * 0.35;
    a.legR = -a.legL;
  }
  rig.strike += ((motion.striking ? 1 : 0) - rig.strike) * Math.min(1, motion.dt * 14);
  if (motion.striking) rig.strikePhase += motion.dt * STRIKE_RATE;
  else rig.strikePhase = 0;
  const strikeAngle = STRIKE_RAISE + Math.sin(rig.strikePhase) * STRIKE_CHOP;
  a.armR = a.armR! + (strikeAngle - a.armR!) * rig.strike;
}

/** Degrees view of the rig's angles (tests and the debug hook). */
export function rigDegrees(rig: RigState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(rig.angles)) out[name] = (value * 180) / Math.PI;
  /** Current limb swing amplitude. */
  out.swing = (rig.amplitude * 180) / Math.PI;
  return out;
}

/** Per-model data computed once: parent indices and which parts take the crouch drop. */
export interface PreparedModel {
  readonly model: ModelDef;
  /** Index of each part's parent (−1 for root parts). */
  readonly parents: Int16Array;
  /** 1 for root parts that are not legs: they carry the upper body down when crouching. */
  readonly drops: Uint8Array;
  /** Index of the part named "head" (−1 if none). */
  readonly head: number;
  /** Index of the part named "armR", which holds items (−1 if none). */
  readonly hand: number;
  /** Each part's rest rotation (`ModelPart.rotation`), null for none. */
  readonly rests: readonly (Matrix4 | null)[];
}

/** Legs follow the gait convention: part names starting with "leg" stay on the ground. */
export function prepareModel(model: ModelDef): PreparedModel {
  const index = new Map<string, number>();
  const parents = new Int16Array(model.parts.length);
  const drops = new Uint8Array(model.parts.length);
  model.parts.forEach((part, i) => {
    const parent = part.parent === undefined ? -1 : (index.get(part.parent) ?? -1);
    if (part.parent !== undefined && parent < 0)
      throw new Error(`Model ${model.key}: part ${part.name} comes before its parent`);
    parents[i] = parent;
    drops[i] = parent < 0 && !part.name.startsWith('leg') ? 1 : 0;
    index.set(part.name, i);
  });
  const rests = model.parts.map((part) => {
    const r = part.rotation;
    if (!r) return null;
    const rad = MathUtils.degToRad;
    return new Matrix4().makeRotationFromEuler(new Euler(rad(r[0]), rad(r[1]), rad(r[2])));
  });
  return {
    model,
    parents,
    drops,
    head: index.get('head') ?? -1,
    hand: index.get('armR') ?? -1,
    rests,
  };
}

const pivotIn = new Matrix4();
const pivotOut = new Matrix4();
const rotation = new Matrix4();
const turn = new Matrix4();
const local = new Matrix4();
const size = new Matrix4();
const point = new Vector3();

/**
 * What posing reads from a rig (the avatar's or a creature's): angles by part name, and turns about
 * the vertical (`yaws`, radians, positive to the left; plan v5 « M52 »: a tail's wag, a glance).
 */
export type PosedRig = Pick<RigState, 'angles' | 'headPivotY'> & {
  readonly yaws?: Readonly<Record<string, number>>;
};

/**
 * World matrix of every part of a model: root (feet position, yaw), then each part's rotation
 * about its pivot (its rest rotation, its yaw, then its angle), chained through parents; root upper-body parts are lowered by `crouchDrop`
 * (their children follow). `visit` receives the matrix of the unit box. No allocation.
 */
export function poseModel(
  prepared: PreparedModel,
  rig: PosedRig,
  root: Matrix4,
  crouchDrop: number,
  visit: (partIndex: number, unitBox: Matrix4) => void,
  scratch: Matrix4[],
): void {
  const parts = prepared.model.parts;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const parentIndex = prepared.parents[i]!;
    const parent = parentIndex >= 0 ? scratch[parentIndex]! : root;
    const angle = rig.angles[part.name] ?? 0;
    const [px, py, pz] = part.pivot;
    pivotIn.makeTranslation(px / 16, py / 16 - (prepared.drops[i] ? crouchDrop : 0), pz / 16);
    pivotOut.makeTranslation(-px / 16, -py / 16, -pz / 16);
    rotation.makeRotationX(-angle);
    const yaw = rig.yaws?.[part.name];
    if (yaw) rotation.premultiply(turn.makeRotationY(yaw));
    const rest = prepared.rests[i];
    if (rest) rotation.premultiply(rest);
    local.multiplyMatrices(pivotIn, rotation).multiply(pivotOut);
    if (!scratch[i]) scratch[i] = new Matrix4();
    const world = scratch[i]!;
    world.multiplyMatrices(parent, local);
    if (i === prepared.head) {
      point.set(px / 16, py / 16, pz / 16).applyMatrix4(world);
      rig.headPivotY = point.y - root.elements[13]!;
    }
    const [fx, fy, fz] = part.from;
    const [tx, ty, tz] = part.to;
    size
      .makeScale((tx - fx) / 16, (ty - fy) / 16, (tz - fz) / 16)
      .setPosition(fx / 16, fy / 16, fz / 16);
    visit(i, local.multiplyMatrices(world, size));
  }
}
