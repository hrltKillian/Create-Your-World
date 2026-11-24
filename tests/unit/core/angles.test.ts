import { describe, expect, it } from 'vitest';
import { anglesTo, lookVector, type Vec3 } from '../../../src/core/angles.ts';

describe('anglesTo', () => {
  it('gives the yaw and pitch whose lookVector points from the eye to the point', () => {
    const eye = { x: 1, y: 65.6, z: -2 };
    const points = [
      { x: 1, y: 65.6, z: -10 },
      { x: -3, y: 64, z: -2 },
      { x: 4.5, y: 70, z: 3.25 },
      { x: 1.5, y: 60, z: -2.5 },
    ];
    for (const at of points) {
      const { yaw, pitch } = anglesTo(eye, at);
      const dir = lookVector(yaw, pitch, { x: 0, y: 0, z: 0 } as Vec3);
      const length = Math.hypot(at.x - eye.x, at.y - eye.y, at.z - eye.z);
      expect(dir.x * length).toBeCloseTo(at.x - eye.x, 9);
      expect(dir.y * length).toBeCloseTo(at.y - eye.y, 9);
      expect(dir.z * length).toBeCloseTo(at.z - eye.z, 9);
    }
    // North is yaw 0, a positive yaw turns towards −x.
    expect(anglesTo(eye, { x: 1, y: 65.6, z: -5 }).yaw).toBeCloseTo(0, 12);
    expect(anglesTo(eye, { x: -5, y: 65.6, z: -2 }).yaw).toBeCloseTo(Math.PI / 2, 12);
  });
});
