import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
} from 'three';

/*
 * A lightning bolt (plan v5 « M47 », the reference game's): a jagged channel from the clouds to the
 * top of the column struck, with a few branches, drawn as crossed bright ribbons. It flickers:
 * a first stroke, a dark blink, a second stroke, then fades within LIFE seconds. One at a time:
 * a new strike replaces the last. Its shape is drawn anew at each strike (Math.random: the look
 * only, never the simulation).
 */

/** Seconds a bolt lasts, and its strokes: on until FIRST, dark until BLINK, on again until SECOND. */
const LIFE = 0.45;
const FIRST = 0.08;
const BLINK = 0.14;
const SECOND = 0.24;
/** Height of the clouds it falls from, above the struck column (blocks). */
const FROM = 90;
/** Steps of the main channel, how far each wanders across (blocks), the ribbons' width. */
const STEPS = 30;
const WANDER = 2.8;
const WIDTH = 0.32;
/** Branches off the main channel, and their steps. */
const BRANCHES = 3;
const BRANCH_STEPS = 6;
/** Most segments: the channel and its branches. */
const SEGMENTS = STEPS + BRANCHES * BRANCH_STEPS;
/** Each segment is two crossed quads: 8 vertices, 12 indices. */
const VERTS = SEGMENTS * 8;

export class Lightning {
  readonly mesh: Mesh;
  private readonly positions = new Float32Array(VERTS * 3);
  private readonly material: MeshBasicMaterial;
  private segments = 0;
  /** Seconds since the strike (≥ LIFE: none shown). */
  private age = LIFE;

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    const index = new Uint16Array(SEGMENTS * 12);
    for (let s = 0; s < SEGMENTS * 2; s++) {
      const v = s * 4;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], s * 6);
    }
    geometry.setIndex(new BufferAttribute(index, 1));
    this.material = new MeshBasicMaterial({
      color: 0xe9e4ff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** A strike at the top of a column (x, z: its block; y: the cell above its highest block). */
  strike(x: number, y: number, z: number): void {
    this.segments = 0;
    const bottom = { x: x + 0.5, y, z: z + 0.5 };
    // The main channel, drawn from the ground up so it ends on the column struck.
    let px = bottom.x;
    let py = bottom.y;
    let pz = bottom.z;
    const forks: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      const nx = px + (Math.random() - 0.5) * WANDER;
      const ny = py + FROM / STEPS;
      const nz = pz + (Math.random() - 0.5) * WANDER;
      this.segment(px, py, pz, nx, ny, nz, WIDTH);
      if (i > 3 && forks.length < BRANCHES * 3 && Math.random() < 0.25) forks.push(nx, ny, nz);
      px = nx;
      py = ny;
      pz = nz;
    }
    // Branches fall from the channel, sideways and down, thinner.
    for (let f = 0; f < forks.length; f += 3) {
      let bx = forks[f]!;
      let by = forks[f + 1]!;
      let bz = forks[f + 2]!;
      const dx = (Math.random() - 0.5) * 2;
      const dz = (Math.random() - 0.5) * 2;
      for (let i = 0; i < BRANCH_STEPS; i++) {
        const nx = bx + dx + (Math.random() - 0.5) * WANDER;
        const ny = by - (FROM / STEPS) * 0.7;
        const nz = bz + dz + (Math.random() - 0.5) * WANDER;
        this.segment(bx, by, bz, nx, ny, nz, WIDTH * 0.55);
        bx = nx;
        by = ny;
        bz = nz;
      }
    }
    const geometry = this.mesh.geometry;
    geometry.setDrawRange(0, this.segments * 12);
    (geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.age = 0;
  }

  /** One frame of `dt` seconds: the strokes' flicker, then the fade. */
  update(dt: number): void {
    this.age += dt;
    const opacity = strokeAt(this.age);
    this.mesh.visible = opacity > 0;
    this.material.opacity = opacity;
  }

  /** Whether a bolt shows now (automation). */
  showing(): boolean {
    return this.mesh.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  /** A segment as two crossed quads (one across x, one across z), `width` wide. */
  private segment(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    width: number,
  ): void {
    if (this.segments >= SEGMENTS) return;
    const p = this.positions;
    let o = this.segments * 24;
    const h = width / 2;
    for (const [ox, oz] of [
      [h, 0],
      [0, h],
    ] as const) {
      p.set(
        [ax - ox, ay, az - oz, ax + ox, ay, az + oz, bx + ox, by, bz + oz, bx - ox, by, bz - oz],
        o,
      );
      o += 12;
    }
    this.segments++;
  }
}

/** A bolt's brightness `t` seconds after its strike: two strokes and a fade (0 once gone). */
export function strokeAt(t: number): number {
  if (t < 0 || t >= LIFE) return 0;
  if (t < FIRST) return 1;
  if (t < BLINK) return 0.15;
  if (t < SECOND) return 0.95;
  return 0.6 * (1 - (t - SECOND) / (LIFE - SECOND));
}
