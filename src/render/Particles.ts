import { Matrix4 } from 'three';
import { FACE_SOUTH, FLAG_SOLID, type RawTables } from '../content/registry.ts';
import { hashUnit } from '../core/hash.ts';
import { blockOf, skyOf } from '../world/light.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BoxBatch } from './BoxBatch.ts';

/** Particles alive at once (a pool: the oldest is reused when it is full). */
const POOL = 96;
/** Chips thrown by a broken block. */
const PER_BREAK = 10;
const GRAVITY = 16;
const SIZE = 0.1;
/** A chip shows a 2 × 2 pixel patch of the block's side texture. */
const PATCH = 2 / 16;

/** Mutable skin of one particle (rewritten before each `add`). */
const skin = {
  side: 0,
  top: 0,
  bottom: 0,
  ox: 0,
  oy: 0,
  oz: 0,
  sx: PATCH,
  sy: PATCH,
  sz: 0,
  sprite: true,
};

/**
 * Basic break particles: small boxes textured with a patch of the broken block, thrown up and out,
 * falling until they land on a solid block, shrinking at the end of their life. Struct-of-arrays
 * pool, no allocation per frame.
 */
export class Particles {
  private readonly batch: BoxBatch;
  private readonly world: VoxelWorld;
  private readonly tables: RawTables;
  private readonly pos = new Float64Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  /** Seconds left (≤ 0: free) and total lifetime. */
  private readonly life = new Float32Array(POOL);
  private readonly span = new Float32Array(POOL);
  private readonly layer = new Uint16Array(POOL);
  private readonly patch = new Float32Array(POOL * 2);
  private readonly box = new Matrix4();
  private next = 0;
  private spawned = 0;

  constructor(batch: BoxBatch, world: VoxelWorld, tables: RawTables) {
    this.batch = batch;
    this.world = world;
    this.tables = tables;
  }

  /** Particles currently alive (tests). */
  alive(): number {
    let n = 0;
    for (let i = 0; i < POOL; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  /** Throws chips of a broken block (`state`: what it was) from its cell. */
  burst(x: number, y: number, z: number, state: number): void {
    const layer = this.tables.faceLayer[state * 6 + FACE_SOUTH]!;
    for (let k = 0; k < PER_BREAK; k++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      const seed = this.spawned++;
      const r = (n: number) => hashUnit(seed, k, n, 0x9a7);
      this.pos[i * 3] = x + 0.15 + r(1) * 0.7;
      this.pos[i * 3 + 1] = y + 0.15 + r(2) * 0.7;
      this.pos[i * 3 + 2] = z + 0.15 + r(3) * 0.7;
      this.vel[i * 3] = (r(4) - 0.5) * 3;
      this.vel[i * 3 + 1] = 1.5 + r(5) * 3;
      this.vel[i * 3 + 2] = (r(6) - 0.5) * 3;
      this.span[i] = 0.5 + r(7) * 0.5;
      this.life[i] = this.span[i]!;
      this.layer[i] = layer;
      this.patch[i * 2] = Math.floor(r(8) * 14) / 16;
      this.patch[i * 2 + 1] = Math.floor(r(9) * 14) / 16;
    }
  }

  /** Moves the live particles by `dt` seconds and adds them to the batch. */
  update(dt: number): void {
    for (let i = 0; i < POOL; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      const o = i * 3;
      this.vel[o + 1] = this.vel[o + 1]! - GRAVITY * dt;
      const nx = this.pos[o]! + this.vel[o]! * dt;
      const ny = this.pos[o + 1]! + this.vel[o + 1]! * dt;
      const nz = this.pos[o + 2]! + this.vel[o + 2]! * dt;
      if (this.solid(nx, ny, nz)) {
        // Landed (or hit a wall): rest where it is and slide to a stop.
        this.vel[o] = this.vel[o]! * 0.5;
        this.vel[o + 1] = 0;
        this.vel[o + 2] = this.vel[o + 2]! * 0.5;
      } else {
        this.pos[o] = nx;
        this.pos[o + 1] = ny;
        this.pos[o + 2] = nz;
      }
      this.draw(i);
    }
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
    const size = SIZE * Math.min(1, (this.life[i]! / this.span[i]!) * 3);
    this.box.makeScale(size, size, size).setPosition(x - size / 2, y, z - size / 2);
    skin.side = this.layer[i]!;
    skin.top = skin.side;
    skin.bottom = skin.side;
    skin.ox = this.patch[i * 2]!;
    skin.oy = this.patch[i * 2 + 1]!;
    const light = this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    this.batch.add(this.box, skin, skyOf(light) / 15, blockOf(light) / 15);
  }
}
