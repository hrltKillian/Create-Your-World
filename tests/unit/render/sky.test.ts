import { Color, type Fog, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSkyColors,
  moonDirection,
  SKY_KEYS,
  skyPalette,
  sunDirection,
} from '../../../src/render/Sky.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

const hex = (c: Color) => c.getHexString();
const key = (i: number) => SKY_KEYS[i]!;

describe('sky palette', () => {
  it('has keyframes in ascending hours from 0 to below 24', () => {
    expect(key(0).hour).toBe(0);
    for (let i = 1; i < SKY_KEYS.length; i++) expect(key(i).hour).toBeGreaterThan(key(i - 1).hour);
    expect(key(SKY_KEYS.length - 1).hour).toBeLessThan(24);
  });

  it('gives each keyframe its own colours at its hour', () => {
    const out = createSkyColors();
    for (const k of SKY_KEYS) {
      skyPalette(k.hour, out);
      expect(hex(out.zenith), `${k.hour} zenith`).toBe(hex(new Color(k.zenith)));
      expect(hex(out.horizon), `${k.hour} horizon`).toBe(hex(new Color(k.horizon)));
      expect(hex(out.light), `${k.hour} light`).toBe(hex(new Color(k.light)));
      expect(out.stars).toBe(k.stars);
    }
  });

  it('blends linearly between two keyframes', () => {
    const out = createSkyColors();
    const a = key(4);
    const b = key(5);
    skyPalette((a.hour + b.hour) / 2, out);
    const mid = new Color(a.horizon).lerp(new Color(b.horizon), 0.5);
    expect(out.horizon.r).toBeCloseTo(mid.r, 6);
    expect(out.horizon.g).toBeCloseTo(mid.g, 6);
    expect(out.horizon.b).toBeCloseTo(mid.b, 6);
    expect(out.stars).toBeCloseTo((a.stars + b.stars) / 2, 6);
  });

  it('wraps from the last keyframe to the first at midnight, without a jump', () => {
    const late = skyPalette(23.999, createSkyColors());
    const midnight = skyPalette(0, createSkyColors());
    expect(late.zenith.r).toBeCloseTo(midnight.zenith.r, 3);
    expect(late.horizon.b).toBeCloseTo(midnight.horizon.b, 3);
    expect(late.stars).toBeCloseTo(midnight.stars, 3);
  });

  it('shows stars at night only, and a brighter sky at noon than at midnight', () => {
    const noon = skyPalette(12, createSkyColors());
    const night = skyPalette(0, createSkyColors());
    expect(noon.stars).toBe(0);
    expect(night.stars).toBe(1);
    const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(luma(noon.horizon)).toBeGreaterThan(2.5 * luma(night.horizon));
    expect(luma(noon.zenith)).toBeGreaterThan(2.5 * luma(night.zenith));
  });
});

describe('sun and moon', () => {
  const v = new Vector3();

  it('rises in the east near 05:15, culminates at noon and sets in the west near 18:45', () => {
    expect(sunDirection(12, v).y).toBeGreaterThan(0.9);
    expect(sunDirection(0, v).y).toBeLessThan(-0.5);
    expect(sunDirection(5, v).y).toBeLessThan(0);
    expect(sunDirection(5.5, v).y).toBeGreaterThan(0);
    expect(v.x).toBeGreaterThan(0.9);
    expect(sunDirection(18.5, v).y).toBeGreaterThan(0);
    expect(v.x).toBeLessThan(-0.9);
    expect(sunDirection(19, v).y).toBeLessThan(0);
    expect(sunDirection(9, v).length()).toBeCloseTo(1, 10);
  });

  it('puts the moon high at midnight and below the horizon at noon', () => {
    expect(moonDirection(0, v).y).toBeGreaterThan(0.9);
    expect(moonDirection(12, v).y).toBeLessThan(-0.5);
    expect(moonDirection(3, v).length()).toBeCloseTo(1, 10);
  });
});

describe('WorldView sky, fog and daylight', () => {
  const fogOf = (view: ReturnType<typeof createTestWorldView>['view']) => view.scene.fog as Fog;
  const skyMesh = (view: ReturnType<typeof createTestWorldView>['view']) =>
    view.scene.children.find((c) => (c as Mesh).renderOrder === -1) as Mesh;

  it('takes the fog, clear colour and sky light tint from the palette, and daylight as given', () => {
    const { view } = createTestWorldView(6);
    view.setTime(0, 0.12);
    view.frame(0);
    const night = skyPalette(0, createSkyColors());
    expect(hex(fogOf(view).color)).toBe(hex(night.horizon));
    expect(hex(view.scene.background as Color)).toBe(hex(night.horizon));
    expect(hex(view.materials.uniforms.uSkyTint.value)).toBe(hex(night.light));
    expect(view.materials.uniforms.uDaylight.value).toBe(0.12);
    expect(fogOf(view).far).toBe(6 * 32 - 8);
  });

  it('switches to a short blue fog without sky under water, and back', () => {
    const { view } = createTestWorldView(6);
    view.setTime(12, 1);
    view.setUnderwater(true);
    view.frame(0);
    const fog = fogOf(view);
    expect([fog.near, fog.far]).toEqual([1, 20]);
    expect(fog.color.b).toBeGreaterThan(fog.color.r);
    expect(skyMesh(view).visible).toBe(false);
    view.setUnderwater(false);
    view.frame(0);
    expect([fog.near, fog.far]).toEqual([6 * 32 * 0.55, 6 * 32 - 8]);
    expect(skyMesh(view).visible).toBe(true);
  });

  it('flickers torch light a little around 1', () => {
    const { view } = createTestWorldView();
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      view.frame(1 / 30);
      seen.push(view.materials.uniforms.uFlicker.value);
    }
    expect(Math.min(...seen)).toBeGreaterThan(0.92);
    expect(Math.max(...seen)).toBeLessThan(1.08);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.02);
  });
});
