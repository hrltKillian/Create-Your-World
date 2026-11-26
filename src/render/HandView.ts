import { Matrix4, PerspectiveCamera, Scene } from 'three';
import type { Registry } from '../content/registry.ts';
import type { PlayerState } from '../sim/player.ts';
import { BoxBatch, type BoxSkin, fullSkin, HAND_BOXES } from './BoxBatch.ts';
import { drawItem, type ItemModel } from './itemModels.ts';
import type { VoxelUniforms } from './voxelMaterial.ts';

/** One stroke of the arm (s). */
const STROKE_SECONDS = 0.28;
/**
 * The shoulder in view space (camera at the origin looking down −z), out of sight at the bottom
 * right, and the arm's angles at rest: the arm hangs from it forwards, the fist ARM_LENGTH away
 * (at about 0.36, −0.32, −0.5).
 */
const SHOULDER_X = 0.49;
const SHOULDER_Y = -0.38;
const SHOULDER_Z = 0.08;
const REST_YAW = 0.22;
const REST_PITCH = 0.1;
/**
 * At the height of a stroke the arm swings from the shoulder, forwards, down and towards the
 * screen's centre, like a blow (plan v3 « M30 »: never the elbow up), the shoulder pushed forward.
 */
const STROKE_YAW = 0.32;
const STROKE_PITCH = -0.55;
const STROKE_PUSH = -0.1;
/** Forearm box (m): it runs from the shoulder to the fist. */
/**
 * Eating or drinking (plan v3 « M35 »): the hand comes up in EAT_SECONDS, this far towards the
 * middle, up and nearer, and bobs EAT_BOBS times a second by EAT_BOB.
 */
const EAT_SECONDS = 0.15;
const EAT_IN = 0.3;
const EAT_UP = 0.16;
const EAT_NEAR = 0.12;
const EAT_BOBS = 4;
const EAT_BOB = 0.035;
const ARM_WIDTH = 0.17;
const ARM_LENGTH = 0.6;
/** Held block edge and held sprite item height (m). */
const HELD_BLOCK = 0.3;
const HELD_SPRITE = 0.36;
/**
 * A held sprite is its slot's icon in the hand (plan v3 « M30 »): facing the view as the icon
 * shows, never turned, the icon (its centre at the origin, a unit wide) moved by SPRITE_GRIP so
 * the hand holds it in its middle.
 */
const SPRITE_GRIP_X = 0.05;
const SPRITE_GRIP_Y = 0.3;
/**
 * Inertia of the hand (view-space metres): a turn of the view leaves it behind by LOOK_SWAY per
 * radian; moving shifts it against the motion by MOVE_SWAY per m/s across and along the view,
 * FALL_SWAY per m/s up and down; never more than MAX_SWAY on an axis. It eases back at SWAY_RATE
 * (1/s).
 */
const LOOK_SWAY = 0.1;
const MOVE_SWAY = 0.004;
const FALL_SWAY = 0.002;
const MAX_SWAY = 0.05;
const SWAY_RATE = 9;

function clampSway(value: number): number {
  return Math.max(-MAX_SWAY, Math.min(MAX_SWAY, value));
}

/**
 * First-person hand view: its own scene and camera (FOV 70, near 0.01), drawn after the world on a
 * cleared depth buffer, so the arm and the held item never sink into walls. A small BoxBatch in
 * view space: the camera never moves, the boxes are placed relative to it. The hand lags behind
 * the view's turns and the body's motion, then eases back to rest (`swayX`, `swayY`, `swayZ`).
 */
export class HandView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.01, 10);
  readonly batch: BoxBatch;
  /** Drawn this frame (first person with a body). */
  visible = false;
  /** Progress (0…1) of the current stroke; 0 at rest. */
  swing = 0;
  /** A strong swing (the attack gauge was full) started this frame: the blow's trail starts. */
  released = false;
  /** Where inertia has left the fist from its pose (view-space metres; 0 at rest). */
  swayX = 0;
  swayY = 0;
  swayZ = 0;
  private stroking = false;
  /** How far the hand has come up to the mouth (0–1), and the seconds spent eating. */
  private eat = 0;
  private eatTime = 0;
  /** The attack gauge's ticks left last frame: a rise is a new swing. */
  private lastCooldown = 0;
  /** The view's angles from `look`, and those of the last frame drawn (NaN before any). */
  private yaw = Number.NaN;
  private pitch = Number.NaN;
  private lastYaw = Number.NaN;
  private lastPitch = Number.NaN;
  private readonly registry: Registry;
  private readonly items: readonly ItemModel[];
  private readonly armSkin: BoxSkin;
  private readonly fist = new Matrix4();
  private readonly box = new Matrix4();
  private readonly step = new Matrix4();

  constructor(shared: VoxelUniforms, registry: Registry, items: readonly ItemModel[]) {
    this.registry = registry;
    this.items = items;
    this.batch = new BoxBatch(shared, HAND_BOXES, false);
    this.scene.add(this.batch.mesh);
    const key = registry.pack.manifest.bindings.avatarModel;
    const model = (registry.pack.models ?? []).find((m) => m.key === key);
    const arm = model?.parts.find((p) => p.name === 'armR');
    this.armSkin = fullSkin(arm ? Math.max(0, registry.textureKeys.indexOf(arm.texture)) : 0);
  }

  /** Starts one stroke unless one is under way (placing a block). */
  strike(): void {
    this.stroking = true;
  }

  /** The view's angles this frame (the camera's), before `draw`: the hand lags behind its turns. */
  look(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /**
   * Animates and fills the batch for one frame: strokes repeat while the player holds primary to
   * mine; each swing (a blow, or in the air: plan v3 « M19 ») strikes once.
   * `sky` and `block` are the light at the eye (0–1). Nothing is drawn when not `visible`.
   */
  draw(
    player: Readonly<PlayerState>,
    dt: number,
    visible: boolean,
    sky: number,
    block: number,
    eating = false,
  ): void {
    this.visible = visible;
    // Eating (plan v3 « M35 »): the hand comes up to the mouth and bobs, and goes back after.
    this.eat = Math.max(0, Math.min(1, this.eat + (eating ? dt : -dt) / EAT_SECONDS));
    this.eatTime = eating ? this.eatTime + dt : 0;
    // A swing empties the gauge (melee.ts): its ticks left rise. A full gauge made it a strong one.
    const swung = player.attackCooldown > this.lastCooldown;
    this.released = swung && this.lastCooldown === 0;
    this.lastCooldown = player.attackCooldown;
    const mining = player.input.primary && !player.swinging;
    if (swung) this.swing = 0;
    if (mining || swung) this.stroking = true;
    this.settle(player, dt);
    if (this.stroking) {
      this.swing += dt / STROKE_SECONDS;
      if (this.swing >= 1) {
        this.stroking = mining;
        this.swing = this.stroking ? this.swing % 1 : 0;
      }
    }
    this.batch.begin(0, 0, 0);
    if (visible) this.drawArm(player, sky, block);
    this.batch.end();
  }

  /**
   * Eases the sway towards where the body's motion pushes the hand (view space: against the
   * motion across and along the view, up while falling), so it comes back to rest once the
   * player stands still and the view stops turning. The view's turn since the last frame is then
   * added whole, so the frame of a turn shows all of its lag: a turn to the left (yaw grows) leaves
   * the hand to the right, a look up leaves it lower.
   */
  private settle(player: Readonly<PlayerState>, dt: number): void {
    const b = player.body;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    // The body's velocity along the view's right (cos, −sin) and forward (−sin, −cos) axes.
    const across = b.vx * cos - b.vz * sin;
    const along = -b.vx * sin - b.vz * cos;
    const k = Math.min(1, dt * SWAY_RATE);
    this.swayX += (clampSway(-across * MOVE_SWAY) - this.swayX) * k;
    this.swayY += (clampSway(-b.vy * FALL_SWAY) - this.swayY) * k;
    this.swayZ += (clampSway(along * MOVE_SWAY) - this.swayZ) * k;
    // NaN before the second frame with a view: no turn yet.
    const turn = this.yaw - this.lastYaw;
    const tilt = this.pitch - this.lastPitch;
    if (!Number.isNaN(turn)) {
      this.swayX = clampSway(this.swayX + turn * LOOK_SWAY);
      this.swayY = clampSway(this.swayY - tilt * LOOK_SWAY);
    }
    this.lastYaw = this.yaw;
    this.lastPitch = this.pitch;
  }

  private drawArm(player: Readonly<PlayerState>, sky: number, block: number): void {
    const s = Math.sin(Math.PI * this.swing);
    // Eating: towards the middle and up, bobbing (the reference game's quick nibbles).
    const e = this.eat;
    const bob = Math.abs(Math.sin(this.eatTime * Math.PI * EAT_BOBS)) * EAT_BOB * e;
    // The arm turns about the shoulder; the fist is at its far end.
    const arm = this.fist.makeTranslation(
      SHOULDER_X + this.swayX - EAT_IN * e,
      SHOULDER_Y + this.swayY + EAT_UP * e + bob,
      SHOULDER_Z + STROKE_PUSH * s + this.swayZ + EAT_NEAR * e,
    );
    arm.multiply(this.step.makeRotationY(REST_YAW + STROKE_YAW * s));
    arm.multiply(this.step.makeRotationX(REST_PITCH + STROKE_PITCH * s));
    const half = ARM_WIDTH / 2;
    this.box.makeScale(ARM_WIDTH, ARM_WIDTH, ARM_LENGTH).setPosition(-half, -half, -ARM_LENGTH);
    this.batch.add(this.box.multiplyMatrices(arm, this.box), this.armSkin, sky, block);
    const stack = player.inventory[player.input.slot];
    const item = stack ? this.registry.itemId(stack.item) : -1;
    if (item < 0) return;
    const fist = arm.multiply(this.step.makeTranslation(0, 0, -ARM_LENGTH));
    const model = this.items[item]!;
    const held = this.box;
    if (model.sprite) {
      // At the fist, without the arm's turn: the icon as its slot shows it.
      const e = fist.elements;
      held.makeTranslation(e[12]!, e[13]!, e[14]!);
      held.multiply(this.step.makeScale(HELD_SPRITE, HELD_SPRITE, HELD_SPRITE));
      held.multiply(this.step.makeTranslation(SPRITE_GRIP_X, SPRITE_GRIP_Y, 0));
    } else {
      held.copy(fist);
      held.multiply(this.step.makeTranslation(0, 0.03, -0.1));
      held.multiply(this.step.makeRotationY(0.75));
      held.multiply(this.step.makeScale(HELD_BLOCK, HELD_BLOCK, HELD_BLOCK));
    }
    drawItem(this.batch, model, held, sky, block, true);
  }

  dispose(): void {
    this.batch.dispose();
  }
}
