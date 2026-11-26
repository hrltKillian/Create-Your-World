import { describe, expect, it } from 'vitest';
import { ContactShadows, MAX_CONTACT_SHADOWS } from '../../../src/render/ContactShadows.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';

/** The flat test world's ground is stone at y 63: its top is at 64. */
const GROUND = 64;

function shadows() {
  return new ContactShadows(flatWorld(), registry.tables);
}

const shadeOf = (s: ContactShadows, i: number) =>
  (s.mesh.geometry.getAttribute('aShade').array as Float32Array)[i]!;
const heightOf = (s: ContactShadows, i: number) => s.mesh.instanceMatrix.array[i * 16 + 13]!;

describe('contact shadows (plan v4 « M41 »)', () => {
  it('lay a disc on the ground under the feet, darker the nearer', () => {
    const s = shadows();
    s.begin();
    s.add(0.5, GROUND, 0.5, 0.4);
    s.add(3.5, GROUND + 2, 0.5, 0.4);
    s.end();
    expect(s.size).toBe(2);
    expect(s.mesh.count).toBe(2);
    expect(heightOf(s, 0)).toBeCloseTo(GROUND, 1);
    expect(heightOf(s, 1)).toBeCloseTo(GROUND, 1);
    expect(shadeOf(s, 0)).toBeGreaterThan(shadeOf(s, 1));
    expect(shadeOf(s, 1)).toBeGreaterThan(0);
  });

  it('lay none without ground within reach below, nor past their number', () => {
    const s = shadows();
    s.begin();
    s.add(0.5, GROUND + 5, 0.5, 0.4);
    expect(s.size).toBe(0);
    for (let i = 0; i < MAX_CONTACT_SHADOWS + 10; i++) s.add(0.5, GROUND, 0.5, 0.4);
    s.end();
    expect(s.size).toBe(MAX_CONTACT_SHADOWS);
  });
});
