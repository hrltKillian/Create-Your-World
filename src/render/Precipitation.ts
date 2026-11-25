import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';

/*
 * Rain and snow around the camera (plan v3 « M34 »): a fixed pool of drops in a column of air
 * RADIUS blocks around it, from TOP blocks above; each falls to the first block under it (a roof
 * keeps it off: `floorAt`, read when it starts) or BOTTOM below the camera, then starts again
 * above. As many fall as the amount (0–1) asks; rain falls in streaks, snow in drifting flakes.
 */

/** Drops in the pool, and the air they fall through around the camera (blocks). */
const DROPS = 900;
const RADIUS = 14;
const TOP = 14;
const BOTTOM = 10;
/** Fall speeds (m/s), a rain streak's length (m), a flake's sway (m/s) and size (px). */
const RAIN_SPEED = 16;
const SNOW_SPEED = 2.2;
const STREAK = 0.6;
const SWAY = 0.6;
const FLAKE = 3;

/** The y a drop stops at in a block column (the top of its highest block), −1 when unknown. */
export type FloorAt = (x: number, z: number) => number;

export class Precipitation {
  readonly rain: LineSegments;
  readonly snow: Points;
  private readonly x = new Float32Array(DROPS);
  private readonly y = new Float32Array(DROPS);
  private readonly z = new Float32Array(DROPS);
  /** Where each drop stops falling. */
  private readonly floor = new Float32Array(DROPS);
  private readonly speed = new Float32Array(DROPS);
  private readonly rainPositions = new Float32Array(DROPS * 6);
  private readonly snowPositions = new Float32Array(DROPS * 3);
  /** Drops drawn on the last frame. */
  drawn = 0;
  private started = false;
  private time = 0;

  constructor() {
    const rain = new BufferGeometry();
    rain.setAttribute('position', new BufferAttribute(this.rainPositions, 3));
    this.rain = new LineSegments(
      rain,
      new LineBasicMaterial({ color: 0xa8c0dc, transparent: true, opacity: 0.45 }),
    );
    const snow = new BufferGeometry();
    snow.setAttribute('position', new BufferAttribute(this.snowPositions, 3));
    this.snow = new Points(
      snow,
      new PointsMaterial({ color: 0xf4f8ff, size: FLAKE, sizeAttenuation: false }),
    );
    for (const object of [this.rain, this.snow]) {
      object.frustumCulled = false;
      object.visible = false;
    }
  }

  /** One frame of `dt` seconds around the camera, `rain` and `snow` 0–1 (one of them at a time). */
  update(
    dt: number,
    cx: number,
    cy: number,
    cz: number,
    rain: number,
    snow: number,
    floorAt: FloorAt,
  ): void {
    const amount = Math.max(rain, snow);
    const snowing = snow > rain;
    this.rain.visible = amount > 0 && !snowing;
    this.snow.visible = amount > 0 && snowing;
    if (amount <= 0) {
      this.started = false;
      this.drawn = 0;
      return;
    }
    this.time += dt;
    const count = Math.round(DROPS * Math.min(1, amount));
    if (!this.started) this.scatter(cx, cy, cz, floorAt, snowing);
    this.started = true;
    const fall = snowing ? SNOW_SPEED : RAIN_SPEED;
    for (let i = 0; i < count; i++) {
      let y = this.y[i]! - fall * this.speed[i]! * dt;
      const far = Math.abs(this.x[i]! - cx) > RADIUS || Math.abs(this.z[i]! - cz) > RADIUS;
      if (y < this.floor[i]! || far) {
        this.place(i, cx, cy, cz, floorAt, cy + TOP * (0.6 + 0.4 * Math.random()));
        y = this.y[i]!;
      }
      this.y[i] = y;
      if (snowing) this.x[i] = this.x[i]! + Math.sin(this.time * 1.3 + i) * SWAY * dt;
    }
    if (snowing) this.writeSnow(count);
    else this.writeRain(count);
    this.drawn = count;
  }

  dispose(): void {
    for (const object of [this.rain, this.snow]) {
      object.geometry.dispose();
      (object.material as LineBasicMaterial | PointsMaterial).dispose();
    }
  }

  /** The pool spread through the whole column of air (rain or snow just starting, a teleport). */
  private scatter(cx: number, cy: number, cz: number, floorAt: FloorAt, snowing: boolean): void {
    for (let i = 0; i < DROPS; i++) {
      this.place(i, cx, cy, cz, floorAt, cy - BOTTOM + (TOP + BOTTOM) * Math.random());
      this.speed[i] = snowing ? 0.7 + 0.6 * Math.random() : 0.85 + 0.3 * Math.random();
    }
  }

  /** Starts drop `i` at height `y` over a random spot around the camera. */
  private place(i: number, cx: number, cy: number, cz: number, floorAt: FloorAt, y: number): void {
    const x = cx + (Math.random() * 2 - 1) * RADIUS;
    const z = cz + (Math.random() * 2 - 1) * RADIUS;
    this.x[i] = x;
    this.z[i] = z;
    const top = floorAt(Math.floor(x), Math.floor(z));
    this.floor[i] = Math.max(top < 0 ? -Infinity : top, cy - BOTTOM);
    // Under a roof the drop starts already stopped: it shows nothing until it starts again.
    this.y[i] = Math.max(y, this.floor[i]!);
  }

  private writeRain(count: number): void {
    const p = this.rainPositions;
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      p[o] = p[o + 3] = this.x[i]!;
      p[o + 2] = p[o + 5] = this.z[i]!;
      p[o + 1] = this.y[i]!;
      p[o + 4] = this.y[i]! + STREAK;
    }
    const geometry = this.rain.geometry;
    geometry.setDrawRange(0, count * 2);
    geometry.getAttribute('position').needsUpdate = true;
  }

  private writeSnow(count: number): void {
    const p = this.snowPositions;
    for (let i = 0; i < count; i++) {
      p[i * 3] = this.x[i]!;
      p[i * 3 + 1] = this.y[i]!;
      p[i * 3 + 2] = this.z[i]!;
    }
    const geometry = this.snow.geometry;
    geometry.setDrawRange(0, count);
    geometry.getAttribute('position').needsUpdate = true;
  }
}
