import { Matrix4 } from 'three';
import { FLAG_SOLID, type RawTables } from '../content/rawTables.ts';
import { MAX_MOTES } from '../content/validateSky.ts';
import { hashUnit } from '../core/hash.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { type BoxBatch, type BoxSkin, boxTint } from './BoxBatch.ts';

/**
 * What drifts in the air at night (plan v4 « M40 », BiomeDef.motes): fireflies and glowing spores
 * around the camera, each a tiny glowing box that wanders and blinks. They keep their place in the
 * world as the camera moves (each wraps round a box about it, fading at its edges), and show as
 * the night comes (`night` 0–1).
 */

/** The box around the camera the motes wander in (blocks). */
const SPAN = 24;
const HEIGHT = 9;
/** Below the eye: motes hover near the ground. */
const BELOW = 3;
/** A mote's size (blocks) and how far it wanders from its place (blocks). */
const SIZE = 0.07;
const WANDER = 1.6;

/** The motes of the biome around the camera: '#rrggbb', how many, how dark it is (0–1). */
export interface MoteLook {
  readonly color: string;
  readonly count: number;
  readonly night: number;
}

/** How much of the night has come at a daylight (0–1): motes show from dusk, fully by night. */
export function nightShare(daylight: number): number {
  const t = Math.min(1, Math.max(0, (0.6 - daylight) / 0.4));
  return t * t * (3 - 2 * t);
}

/** Wraps `v` into [−span/2, span/2). */
function around(v: number, span: number): number {
  return ((((v + span / 2) % span) + span) % span) - span / 2;
}

export class Motes {
  private readonly batch: BoxBatch;
  private readonly world: VoxelWorld;
  private readonly tables: RawTables;
  private readonly box = new Matrix4();
  private readonly skin: { -readonly [K in keyof BoxSkin]: BoxSkin[K] };
  private seconds = 0;
  private hex = '';
  /** Motes drawn on the last frame (tests, automation). */
  drawn = 0;

  /** `texel`: a pale texel of the texture array (its layer and coordinates), tinted per biome. */
  constructor(
    batch: BoxBatch,
    world: VoxelWorld,
    tables: RawTables,
    texel: { layer: number; u: number; v: number },
  ) {
    this.batch = batch;
    this.world = world;
    this.tables = tables;
    this.skin = {
      side: texel.layer,
      top: texel.layer,
      bottom: texel.layer,
      sideTint: 0,
      topTint: 0,
      bottomTint: 0,
      cutout: false,
      ox: texel.u,
      oy: texel.v,
      oz: 0,
      sx: 0,
      sy: 0,
      sz: 0,
      sprite: false,
    };
  }

  /** Draws the motes of `look` (null: none) around the eye at (x, y, z), `dt` seconds on. */
  draw(dt: number, x: number, y: number, z: number, look: MoteLook | null): void {
    this.seconds = (this.seconds + dt) % 3600;
    this.drawn = 0;
    if (!look || look.night <= 0 || look.count <= 0) return;
    if (look.color !== this.hex) {
      this.hex = look.color;
      const tint = boxTint(look.color);
      this.skin.sideTint = tint;
      this.skin.topTint = tint;
      this.skin.bottomTint = tint;
    }
    const t = this.seconds;
    const count = Math.min(MAX_MOTES, look.count);
    for (let i = 0; i < count; i++) {
      // Its place in the world, wandering slowly, wrapped round the eye.
      const px = hashUnit(i, 1) * SPAN + WANDER * Math.sin(t * 0.31 + i * 1.7);
      const py = hashUnit(i, 2) * HEIGHT + 0.6 * Math.sin(t * 0.53 + i * 2.3);
      const pz = hashUnit(i, 3) * SPAN + WANDER * Math.cos(t * 0.27 + i * 0.9);
      const dx = around(px - x, SPAN);
      const dz = around(pz - z, SPAN);
      const mx = x + dx;
      const mz = z + dz;
      const my = y - BELOW + around(py - y, HEIGHT) + HEIGHT / 2;
      const state = this.world.getBlock(Math.floor(mx), Math.floor(my), Math.floor(mz));
      if ((this.tables.flags[state]! & FLAG_SOLID) !== 0) continue;
      // Fading at the box's edges, blinking, and with the night.
      const edge = 1 - Math.max(Math.abs(dx), Math.abs(dz)) / (SPAN / 2);
      const blink = 0.5 + 0.5 * Math.sin(t * (1.5 + hashUnit(i, 4)) + i * 3.1);
      const size = SIZE * Math.min(1, edge * 4) * blink * look.night;
      if (size < 0.005) continue;
      this.box.makeScale(size, size, size).setPosition(mx - size / 2, my - size / 2, mz - size / 2);
      this.batch.add(this.box, this.skin, 0, 0, 1);
      this.drawn++;
    }
  }
}
