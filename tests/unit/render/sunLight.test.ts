import { Color, OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { moonDirection, sunDirection } from '../../../src/render/Sky.ts';
import { shadowExtent, shadowFocus } from '../../../src/render/SunShadow.ts';
import { createSunLight, sunLightAt as lightWith, mistAt } from '../../../src/render/sunLight.ts';

const WHITE = new Color(1, 1, 1);
const MOON = basePack.sky!.moons[0]!;

/** The sky's light at an hour of day 0 (a full moon), as the sky places the sun and the moon. */
function sunLightAt(hour: number, tint: Color, cloud: number, out = createSunLight()) {
  const sun = sunDirection(hour, new Vector3());
  return lightWith(sun, moonDirection(hour, 0, MOON, new Vector3()), tint, cloud, out);
}

describe('the sky light (plan v4 « M37 »)', () => {
  it('casts from the sun by day and the moon by night, weaker', () => {
    const noon = sunLightAt(12, WHITE, 0);
    expect(noon.direction.y).toBeGreaterThan(0.9);
    const day = noon.direct.r;
    const night = sunLightAt(0, WHITE, 0);
    expect(night.direction.y).toBeGreaterThan(0.5);
    expect(night.direct.r).toBeGreaterThan(0);
    expect(night.direct.r).toBeLessThan(day);
    expect(noon.shadow).toBe(1);
    expect(night.shadow).toBeLessThan(1);
  });

  it('fades the direct light out at the horizon, without a jump', () => {
    let last = sunLightAt(4, WHITE, 0).direct.r;
    for (let hour = 4; hour <= 8; hour += 0.05) {
      const now = sunLightAt(hour, WHITE, 0).direct.r;
      expect(Math.abs(now - last)).toBeLessThan(0.05);
      last = now;
    }
  });

  it('takes the palette tint, and clouds soften the direct light and its shadows', () => {
    const tint = new Color(1, 0.5, 0.25);
    const clear = sunLightAt(12, tint, 0);
    expect(clear.direct.g / clear.direct.r).toBeCloseTo(0.5, 6);
    const cloudy = sunLightAt(12, tint, 1);
    expect(cloudy.direct.r).toBeLessThan(clear.direct.r * 0.2);
    expect(cloudy.sky.r).toBeGreaterThan(clear.sky.r);
    expect(cloudy.shadow).toBe(0);
  });

  it('lights the night less under a thin moon, and hazes the horizon at dawn', () => {
    const full = sunLightAt(0, WHITE, 0).direct.r;
    const sun = sunDirection(0, new Vector3());
    const thin = lightWith(
      sun,
      moonDirection(0, MOON.period / 2, MOON, new Vector3()),
      WHITE,
      0,
      createSunLight(),
    );
    expect(thin.direct.r).toBeLessThan(full);
    expect(sunLightAt(6, WHITE, 0).haze.r).toBeGreaterThan(sunLightAt(12, WHITE, 0).haze.r * 4);
  });

  it('lays the mist thickest around dawn', () => {
    expect(mistAt(6.5)).toBeGreaterThan(mistAt(12) * 3);
    expect(mistAt(12)).toBe(mistAt(20));
    expect(mistAt(6.5)).toBeLessThanOrEqual(1);
  });
});

describe("the sun's shadow map", () => {
  it('covers 48 blocks a side per 1024 texels', () => {
    expect(shadowExtent(1024)).toBe(48);
    expect(shadowExtent(2048)).toBe(96);
  });

  it('looks down the light at the focus, moved in whole texels', () => {
    const camera = new OrthographicCamera(-24, 24, 24, -24, 1, 256);
    const dir = new Vector3(0.4, 0.85, 0.3).normalize();
    const texel = 48 / 1024;
    const a = shadowFocus(camera, new Vector3(10.3, 70, -5.7), dir, texel, new Vector3());
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    expect(forward.dot(dir)).toBeCloseTo(-1, 6);
    // The target stays within half a texel of the focus across the light's view.
    expect(a.distanceTo(new Vector3(10.3, 70, -5.7))).toBeLessThan(texel);
    // A step smaller than a texel moves the map by whole texels only: the same world point stays
    // on the same texel.
    const p = new Vector3(3.21, 64.5, 2.7);
    const at = () => p.clone().applyMatrix4(camera.matrixWorldInverse);
    const first = at();
    shadowFocus(camera, new Vector3(10.31, 70, -5.71), dir, texel, new Vector3());
    const second = at();
    const step = (u: number, v: number) => Math.abs(u - v) / texel;
    expect(step(first.x, second.x) % 1).toBeCloseTo(0, 4);
    expect(step(first.y, second.y) % 1).toBeCloseTo(0, 4);
  });

  it('picks another up for a light straight overhead', () => {
    const camera = new OrthographicCamera(-24, 24, 24, -24, 1, 256);
    const out = shadowFocus(
      camera,
      new Vector3(0, 64, 0),
      new Vector3(0, 1, 0),
      0.05,
      new Vector3(),
    );
    expect(Number.isFinite(out.x) && Number.isFinite(camera.position.y)).toBe(true);
  });
});
