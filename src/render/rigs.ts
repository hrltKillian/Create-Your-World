import { Matrix4 } from 'three';
import type { ModelDef } from '../content/schema.ts';

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
  /** Height of the head pivot above the feet (blocks), for tests. */
  headPivotY: number;
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
  readonly dt: number;
}

export function createRig(): RigState {
  return { phase: 0, amplitude: 0, time: 0, angles: {}, headPivotY: 0 };
}

const STRIDE = 2.2; // radians per block walked

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
  a.head = motion.pitch * 0.7 - a.torso;
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
  rig.headPivotY = motion.crouching ? 22 / 16 - 0.25 : 22 / 16;
}

/** Degrees view of the rig's angles (tests and the debug hook). */
export function rigDegrees(rig: RigState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(rig.angles)) out[name] = (value * 180) / Math.PI;
  /** Current limb swing amplitude. */
  out.swing = (rig.amplitude * 180) / Math.PI;
  return out;
}

const pivotIn = new Matrix4();
const pivotOut = new Matrix4();
const rotation = new Matrix4();
const local = new Matrix4();
const size = new Matrix4();

/**
 * World matrix of every part of a model: root (feet position, yaw, crouch drop), then each part's
 * rotation about its pivot, chained through parents. `visit` receives the matrix of the unit box.
 */
export function poseModel(
  model: ModelDef,
  rig: RigState,
  root: Matrix4,
  crouchDrop: number,
  visit: (partIndex: number, unitBox: Matrix4) => void,
  scratch: Matrix4[],
): void {
  const byName = new Map<string, number>();
  model.parts.forEach((part, i) => {
    byName.set(part.name, i);
    const parentIndex = part.parent ? byName.get(part.parent) : undefined;
    const parent = parentIndex !== undefined ? scratch[parentIndex]! : root;
    const angle = rig.angles[part.name] ?? 0;
    const [px, py, pz] = part.pivot;
    pivotIn.makeTranslation(
      px / 16,
      py / 16 - (part.name.startsWith('leg') ? 0 : crouchDrop),
      pz / 16,
    );
    pivotOut.makeTranslation(-px / 16, -py / 16, -pz / 16);
    rotation.makeRotationX(-angle);
    local.multiplyMatrices(pivotIn, rotation).multiply(pivotOut);
    if (!scratch[i]) scratch[i] = new Matrix4();
    const world = scratch[i]!;
    world.multiplyMatrices(parent, local);
    const [fx, fy, fz] = part.from;
    const [tx, ty, tz] = part.to;
    size
      .makeScale((tx - fx) / 16, (ty - fy) / 16, (tz - fz) / 16)
      .setPosition(fx / 16, fy / 16, fz / 16);
    visit(i, local.multiplyMatrices(world, size));
  });
}
