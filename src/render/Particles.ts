import { Matrix4 } from 'three';
import {
  FACE_SOUTH,
  FACE_UP,
  FLAG_SOLID,
  PASS_OPAQUE,
  type RawTables,
} from '../content/registry.ts';
import { hashUnit } from '../core/hash.ts';
import { blockOf, skyOf } from '../world/light.ts';
import { tintIndex } from '../world/mesh/greedyMesher.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { BOX_NO_TINT, type BoxBatch } from './BoxBatch.ts';
import { PATCH_TEXELS, type ParticleArt, palestTexel, patchCorner } from './particleArt.ts';

/** Particles alive at once (a pool: the oldest is reused when it is full). */
const POOL = 128;

/** Kinds: chips of a broken block fall and land; dust drifts up; the attack trail hangs. */
const CHIP = 0;
const DUST = 1;
const TRAIL = 2;

/** Chips thrown by a broken block, their gravity (m/s²) and edge (m). */
export const PER_BREAK = 10;
const GRAVITY = 16;
const CHIP_SIZE = 0.1;
/** Puffs per crack stage of a mined block; puffs per block fallen on a landing, at most 12. */
export const MINE_DUST = 2;
export const LAND_DUST_PER_BLOCK = 3;
export const LAND_DUST_MAX = 12;
/** Dust edge (m; it swells by half as it fades), lift (m/s²) and drag (1/s). */
const DUST_SIZE = 0.13;
const DUST_LIFT = 0.8;
const DUST_DRAG = 3;
/** Boxes of an attack trail, their edge (m), lifetime (s) and glow (0…1). */
export const TRAIL_BOXES = 16;
const TRAIL_SIZE = 0.05;
const TRAIL_LIFE = 0.2;
const TRAIL_GLOW = 0.6;
/**
 * The trail's arc in view space (m, radians): centred ahead of the eye, a little left and low,
 * from the upper right down to the bottom, the way the arm strikes (HandView).
 */
const TRAIL_AHEAD = 0.9;
const TRAIL_CX = -0.05;
const TRAIL_CY = -0.15;
const TRAIL_RADIUS = 0.45;
const TRAIL_FROM = 0.9;
const TRAIL_TO = -1.6;
const SALT = 0x9a7;

/** Mutable skin of one particle (rewritten before each `add`). */
const skin = {
  side: 0,
  top: 0,
  bottom: 0,
  sideTint: BOX_NO_TINT,
  topTint: BOX_NO_TINT,
  bottomTint: BOX_NO_TINT,
  cutout: false,
  ox: 0,
  oy: 0,
  oz: 0,
  sx: 0,
  sy: 0,
  sz: 0,
  sprite: true,
};

/**
 * Small boxes of the world batch (one draw call, no allocation per frame), from a struct-of-arrays
 * pool:
 * - chips of a broken block, textured with a patch of its side and tinted like it (biome tints),
 *   thrown up and out, falling until they land on a solid block;
 * - dust puffs of the same patches, from the face of a mined block and around the feet on a
 *   landing, drifting up and slowing down;
 * - an attack trail: an arc of pale glowing boxes where the arm strikes, fading from its start.
 * Every particle shrinks away at the end of its life. Off (`setEnabled(false)`), none is made.
 */
export class Particles {
  private readonly batch: BoxBatch;
  private readonly world: VoxelWorld;
  private readonly tables: RawTables;
  private readonly art: ParticleArt;
  private readonly pos = new Float64Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  /** Seconds left (≤ 0: free) and total lifetime. */
  private readonly life = new Float32Array(POOL);
  private readonly span = new Float32Array(POOL);
  private readonly kind = new Uint8Array(POOL);
  private readonly layer = new Uint16Array(POOL);
  private readonly tint = new Uint32Array(POOL);
  private readonly cutout = new Uint8Array(POOL);
  /** Texture-space origin of each particle's patch. */
  private readonly patch = new Float32Array(POOL * 2);
  private readonly box = new Matrix4();
  /** The trail's texel: its layer and a point inside it. */
  private readonly trailLayer: number;
  private readonly trailU: number;
  private readonly trailV: number;
  private on = true;
  private next = 0;
  private spawned = 0;

  constructor(batch: BoxBatch, world: VoxelWorld, tables: RawTables, art: ParticleArt) {
    this.batch = batch;
    this.world = world;
    this.tables = tables;
    this.art = art;
    const pale = palestTexel(art.texels, art.size);
    this.trailLayer = pale.layer;
    this.trailU = (pale.x + 0.25) / art.size;
    this.trailV = (pale.y + 0.25) / art.size;
  }

  /** Particles on or off (Settings); turning them off clears the live ones. */
  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.life.fill(0);
  }

  /** Whether particles are on (`setEnabled`). */
  get enabled(): boolean {
    return this.on;
  }

  /** Particles currently alive (tests, automation). */
  alive(): number {
    let n = 0;
    for (let i = 0; i < POOL; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  /** Throws chips of a broken block (`state`: what it was) from its cell. */
  burst(x: number, y: number, z: number, state: number): void {
    if (!this.on) return;
    for (let k = 0; k < PER_BREAK; k++) {
      const seed = this.spawned++;
      const i = this.spawn(
        CHIP,
        x + 0.15 + this.rand(seed, 1) * 0.7,
        y + 0.15 + this.rand(seed, 2) * 0.7,
        z + 0.15 + this.rand(seed, 3) * 0.7,
        0.5 + this.rand(seed, 7) * 0.5,
      );
      this.setVelocity(
        i,
        (this.rand(seed, 4) - 0.5) * 3,
        1.5 + this.rand(seed, 5) * 3,
        (this.rand(seed, 6) - 0.5) * 3,
      );
      this.paint(i, seed, state, FACE_SOUTH, x, z);
    }
  }

  /**
   * Puffs of dust from a block being mined (cell x, y, z; `state`): from the point of the cell
   * nearest the eye (ex, ey, ez), just outside it, drifting towards the eye.
   */
  mineDust(
    x: number,
    y: number,
    z: number,
    state: number,
    ex: number,
    ey: number,
    ez: number,
  ): void {
    if (!this.on) return;
    const px = Math.min(x + 1, Math.max(x, ex));
    const py = Math.min(y + 1, Math.max(y, ey));
    const pz = Math.min(z + 1, Math.max(z, ez));
    // `out`: 8 cm towards the eye, as a factor of the offset to it.
    const out = 0.08 / (Math.hypot(ex - px, ey - py, ez - pz) || 1);
    const ox = (ex - px) * out;
    const oy = (ey - py) * out;
    const oz = (ez - pz) * out;
    for (let k = 0; k < MINE_DUST; k++) {
      const seed = this.spawned++;
      const i = this.spawn(
        DUST,
        px + ox + (this.rand(seed, 1) - 0.5) * 0.3,
        py + oy + (this.rand(seed, 2) - 0.5) * 0.3,
        pz + oz + (this.rand(seed, 3) - 0.5) * 0.3,
        0.4 + this.rand(seed, 7) * 0.3,
      );
      this.setVelocity(
        i,
        ox * 4 + (this.rand(seed, 4) - 0.5) * 0.6,
        oy * 4 + 0.2 + this.rand(seed, 5) * 0.3,
        oz * 4 + (this.rand(seed, 6) - 0.5) * 0.6,
      );
      this.paint(i, seed, state, FACE_SOUTH, x, z);
    }
  }

  /**
   * Dust thrown out around the feet (x, y, z) when the player lands after falling `fall` blocks:
   * 3 puffs a block, at most 12, of the top of the solid block under the feet (`state`).
   */
  landDust(x: number, y: number, z: number, state: number, fall: number): void {
    if (!this.on || (this.tables.flags[state]! & FLAG_SOLID) === 0) return;
    const count = Math.min(LAND_DUST_MAX, Math.round(LAND_DUST_PER_BLOCK * fall));
    for (let k = 0; k < count; k++) {
      const seed = this.spawned++;
      // Evenly round the feet, jittered, thrown outwards along the ground.
      const angle = ((k + this.rand(seed, 1) * 0.5) / count) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const life = 0.45 + this.rand(seed, 7) * 0.3;
      const i = this.spawn(DUST, x + dx * 0.3, y + 0.05, z + dz * 0.3, life);
      const speed = 1 + this.rand(seed, 2);
      this.setVelocity(i, dx * speed, 0.15 + this.rand(seed, 3) * 0.3, dz * speed);
      this.paint(i, seed, state, FACE_UP, x, z);
    }
  }

  /**
   * The trail of a blow: an arc of boxes ahead of the eye (ex, ey, ez) looking along (yaw, pitch),
   * from the upper right to the bottom; its start fades first, as if the blade had just passed.
   */
  trail(ex: number, ey: number, ez: number, yaw: number, pitch: number): void {
    if (!this.on) return;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    // View axes: forward (lookVector), right (horizontal) and up = right × forward.
    const fx = -sy * cp;
    const fz = -cy * cp;
    const rx = cy;
    const rz = -sy;
    const ux = sy * sp;
    const uz = cy * sp;
    for (let k = 0; k < TRAIL_BOXES; k++) {
      const t = k / (TRAIL_BOXES - 1);
      const a = TRAIL_FROM + (TRAIL_TO - TRAIL_FROM) * t;
      const right = TRAIL_CX + Math.cos(a) * TRAIL_RADIUS;
      const up = TRAIL_CY + Math.sin(a) * TRAIL_RADIUS;
      const i = this.spawn(
        TRAIL,
        ex + fx * TRAIL_AHEAD + rx * right + ux * up,
        ey + sp * TRAIL_AHEAD + cp * up,
        ez + fz * TRAIL_AHEAD + rz * right + uz * up,
        TRAIL_LIFE * (0.4 + 0.6 * t),
      );
      this.setVelocity(i, 0, 0, 0);
      this.layer[i] = this.trailLayer;
      this.tint[i] = BOX_NO_TINT;
      this.cutout[i] = 0;
      this.patch[i * 2] = this.trailU;
      this.patch[i * 2 + 1] = this.trailV;
    }
  }

  /** Moves the live particles by `dt` seconds and adds them to the batch. */
  update(dt: number): void {
    const drag = Math.exp(-DUST_DRAG * dt);
    for (let i = 0; i < POOL; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) continue;
      const kind = this.kind[i]!;
      if (kind === CHIP) this.fall(i, dt);
      else if (kind === DUST) this.drift(i, dt, drag);
      // A trail stays where the blow passed.
      this.draw(i);
    }
  }

  /** Takes the next pool slot for a particle of `kind` at (x, y, z) living `life` seconds. */
  private spawn(kind: number, x: number, y: number, z: number, life: number): number {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    this.kind[i] = kind;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.span[i] = life;
    this.life[i] = life;
    return i;
  }

  private setVelocity(i: number, vx: number, vy: number, vz: number): void {
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
  }

  /** Deterministic noise in [0, 1) for a particle's `seed` and its `n`th draw. */
  private rand(seed: number, n: number): number {
    return hashUnit(seed, n, 0, SALT);
  }

  /**
   * Skins particle `i` with a patch of `face` of a block state, tinted as the chunks tint it in
   * column (x, z) (its biome). A cutout block's patch is one without holes when one is found.
   */
  private paint(i: number, seed: number, state: number, face: number, x: number, z: number) {
    const tables = this.tables;
    const f = state * 6 + face;
    const layer = tables.faceLayer[f]!;
    const cutout = tables.pass[state] !== PASS_OPAQUE;
    const biome = Math.max(0, this.world.biomeAt(Math.floor(x), Math.floor(z)));
    this.layer[i] = layer;
    this.tint[i] = this.art.tints[tintIndex(tables.faceTint[f]!, biome)] ?? BOX_NO_TINT;
    this.cutout[i] = cutout ? 1 : 0;
    const size = this.art.size;
    const corner = patchCorner(this.art, layer, cutout, this.rand(seed, 8));
    this.patch[i * 2] = (corner % size) / size;
    this.patch[i * 2 + 1] = Math.floor(corner / size) / size;
  }

  /** A chip falls until it meets a solid block (landed, or hit a wall), then slides to a stop. */
  private fall(i: number, dt: number): void {
    const o = i * 3;
    this.vel[o + 1] = this.vel[o + 1]! - GRAVITY * dt;
    const nx = this.pos[o]! + this.vel[o]! * dt;
    const ny = this.pos[o + 1]! + this.vel[o + 1]! * dt;
    const nz = this.pos[o + 2]! + this.vel[o + 2]! * dt;
    if (this.solid(nx, ny, nz)) {
      this.vel[o] = this.vel[o]! * 0.5;
      this.vel[o + 1] = 0;
      this.vel[o + 2] = this.vel[o + 2]! * 0.5;
    } else {
      this.pos[o] = nx;
      this.pos[o + 1] = ny;
      this.pos[o + 2] = nz;
    }
  }

  /** Dust slows down (`drag`: the factor over `dt`) and rises. */
  private drift(i: number, dt: number, drag: number): void {
    const o = i * 3;
    this.vel[o] = this.vel[o]! * drag;
    this.vel[o + 1] = this.vel[o + 1]! * drag + DUST_LIFT * dt;
    this.vel[o + 2] = this.vel[o + 2]! * drag;
    this.pos[o] = this.pos[o]! + this.vel[o]! * dt;
    this.pos[o + 1] = this.pos[o + 1]! + this.vel[o + 1]! * dt;
    this.pos[o + 2] = this.pos[o + 2]! + this.vel[o + 2]! * dt;
  }

  private solid(x: number, y: number, z: number): boolean {
    const state = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return (this.tables.flags[state]! & FLAG_SOLID) !== 0;
  }

  private draw(i: number): void {
    const o = i * 3;
    const x = this.pos[o]!;
    const y = this.pos[o + 1]!;
    const z = this.pos[o + 2]!;
    const kind = this.kind[i]!;
    const left = this.life[i]! / this.span[i]!;
    // Chips and dust shrink away over their last third (dust swells first); a trail fades whole.
    const end = Math.min(1, left * 3);
    const size =
      kind === CHIP
        ? CHIP_SIZE * end
        : kind === DUST
          ? DUST_SIZE * (1.5 - 0.5 * left) * end
          : TRAIL_SIZE * left;
    // A chip stands on its position (it rests on the ground); dust and trails are centred on it.
    const bottom = kind === CHIP ? y : y - size / 2;
    this.box.makeScale(size, size, size).setPosition(x - size / 2, bottom, z - size / 2);
    const layer = this.layer[i]!;
    const tint = this.tint[i]!;
    skin.side = layer;
    skin.top = layer;
    skin.bottom = layer;
    skin.sideTint = tint;
    skin.topTint = tint;
    skin.bottomTint = tint;
    skin.cutout = this.cutout[i] === 1;
    skin.ox = this.patch[i * 2]!;
    skin.oy = this.patch[i * 2 + 1]!;
    // A trail samples inside one texel (a flat colour), the others their 2 × 2 patch.
    const patch = (kind === TRAIL ? 0.5 : PATCH_TEXELS) / this.art.size;
    skin.sx = patch;
    skin.sy = patch;
    const light = this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    const glow = kind === TRAIL ? TRAIL_GLOW : 0;
    this.batch.add(this.box, skin, skyOf(light) / 15, blockOf(light) / 15, glow);
  }
}
