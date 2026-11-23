import { Matrix4, PerspectiveCamera, Scene } from 'three';
import type { Registry } from '../content/registry.ts';
import type { PlayerState } from '../sim/player.ts';
import { BoxBatch, type BoxSkin, fullSkin, HAND_BOXES } from './BoxBatch.ts';
import { drawItem, type ItemModel } from './itemModels.ts';
import type { VoxelUniforms } from './voxelMaterial.ts';

/** One stroke of the arm (s). */
const STROKE_SECONDS = 0.28;
/** The fist at rest in view space (camera at the origin looking down −z), and the arm's angles. */
const REST_X = 0.36;
const REST_Y = -0.32;
const REST_Z = -0.5;
const REST_YAW = 0.22;
const REST_PITCH = 0.1;
/** At the height of a stroke the fist moves forward and down and the arm tips down. */
const STROKE_DX = -0.1;
const STROKE_DY = -0.06;
const STROKE_DZ = -0.12;
const STROKE_YAW = 0.25;
const STROKE_PITCH = -1.0;
/** While an attack charges the fist is drawn back and up, the arm tipped back. */
const WINDUP_DY = 0.07;
const WINDUP_DZ = 0.1;
const WINDUP_PITCH = 0.55;
/** Forearm box (m): it runs from the fist back towards the camera. */
const ARM_WIDTH = 0.12;
const ARM_LENGTH = 0.6;
/** Held block edge and held sprite item height (m). */
const HELD_BLOCK = 0.24;
const HELD_SPRITE = 0.42;
/** A held sprite turns this much towards the screen centre (radians), mirrored. */
const SPRITE_TURN = Math.PI - 0.9;

/**
 * First-person hand view: its own scene and camera (FOV 70, near 0.01), drawn after the world on a
 * cleared depth buffer, so the arm and the held item never sink into walls. A small BoxBatch in
 * view space: the camera never moves, the boxes are placed relative to it.
 */
export class HandView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.01, 10);
  readonly batch: BoxBatch;
  /** Drawn this frame (first person with a body). */
  visible = false;
  /** Progress (0…1) of the current stroke; 0 at rest. */
  swing = 0;
  /** Blend (0…1) towards the drawn-back pose of a charging attack. */
  windup = 0;
  private stroking = false;
  private charging = false;
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

  /**
   * Animates and fills the batch for one frame: strokes repeat while the player holds primary to
   * mine; an attack draws the arm back while primary is held and strikes once on the release.
   * `sky` and `block` are the light at the eye (0–1). Nothing is drawn when not `visible`.
   */
  draw(
    player: Readonly<PlayerState>,
    dt: number,
    visible: boolean,
    sky: number,
    block: number,
  ): void {
    this.visible = visible;
    const charging = player.charge >= 0;
    const mining = player.input.primary && !charging;
    if (mining || (this.charging && !charging)) this.stroking = true;
    this.charging = charging;
    this.windup += ((charging ? 1 : 0) - this.windup) * Math.min(1, dt * 10);
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

  private drawArm(player: Readonly<PlayerState>, sky: number, block: number): void {
    const s = Math.sin(Math.PI * this.swing);
    const w = this.windup;
    const fist = this.fist.makeTranslation(
      REST_X + STROKE_DX * s,
      REST_Y + STROKE_DY * s + WINDUP_DY * w,
      REST_Z + STROKE_DZ * s + WINDUP_DZ * w,
    );
    fist.multiply(this.step.makeRotationY(REST_YAW + STROKE_YAW * s));
    fist.multiply(this.step.makeRotationX(REST_PITCH + STROKE_PITCH * s + WINDUP_PITCH * w));
    const half = ARM_WIDTH / 2;
    this.box.makeScale(ARM_WIDTH, ARM_WIDTH, ARM_LENGTH).setPosition(-half, -half, 0);
    this.batch.add(this.box.multiplyMatrices(fist, this.box), this.armSkin, sky, block);
    const stack = player.inventory[player.input.slot];
    const item = stack ? this.registry.itemId(stack.item) : -1;
    if (item < 0) return;
    const model = this.items[item]!;
    const held = this.box.copy(fist);
    if (model.sprite) {
      // Mirrored so the head leans towards the screen centre; the handle (bottom left) in the fist.
      held.multiply(this.step.makeRotationY(SPRITE_TURN));
      held.multiply(this.step.makeScale(HELD_SPRITE, HELD_SPRITE, HELD_SPRITE));
      held.multiply(this.step.makeTranslation(0.35, 0.35, 0));
    } else {
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
