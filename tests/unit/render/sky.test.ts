import { Color, type Fog, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { WATER_VIEW } from '../../../src/render/Atmosphere.ts';
import {
  createSkyColors,
  moonBearing,
  moonDirection,
  moonLit,
  skyPalette as paletteAt,
  skyPaletteOf,
  sunDirection,
} from '../../../src/render/Sky.ts';
import { createSunLight, sunLightAt } from '../../../src/render/sunLight.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

const SKY = basePack.sky!;
const SKY_KEYS = SKY.keys;
const PALETTE = skyPaletteOf(SKY);
const skyPalette = (hour: number, out: ReturnType<typeof createSkyColors>) =>
  paletteAt(PALETTE, hour, out);
const MOON = SKY.moons[0]!;
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

  it('puts the full moon of day 0 high at midnight and below the horizon at noon', () => {
    expect(moonDirection(0, 0, MOON, v).y).toBeGreaterThan(0.85);
    expect(moonDirection(12, 0, MOON, v).y).toBeLessThan(-0.5);
    expect(moonDirection(3, 0, MOON, v).length()).toBeCloseTo(1, 10);
  });

  it('walks the moons through their phases: full at day 0, new half a period later', () => {
    const sun = new Vector3();
    sunDirection(0, sun);
    expect(moonLit(sun, moonDirection(0, 0, MOON, v))).toBeGreaterThan(0.95);
    // New: a thin crescent (their circles pass apart, north and south).
    expect(moonLit(sun, moonDirection(0, MOON.period / 2, MOON, v))).toBeLessThan(0.2);
    expect(moonLit(sun, moonDirection(0, MOON.period, MOON, v))).toBeGreaterThan(0.95);
    // Two moons of their own periods drift apart.
    const other = SKY.moons[1]!;
    const a = moonDirection(0, 3, MOON, new Vector3());
    const b = moonDirection(0, 3, other, new Vector3());
    expect(a.angleTo(b)).toBeGreaterThan(0.3);
  });

  it('shows the moon on the compass while it is up, and nothing below the horizon', () => {
    expect(Number.isNaN(moonBearing(12, 0, MOON))).toBe(true);
    const bearing = moonBearing(0, 0, MOON);
    expect(Number.isFinite(bearing)).toBe(true);
  });
});

describe('WorldView sky, fog and daylight', () => {
  const fogOf = (view: ReturnType<typeof createTestWorldView>['view']) => view.scene.fog as Fog;
  const skyMesh = (view: ReturnType<typeof createTestWorldView>['view']) =>
    view.scene.children.find((c) => (c as Mesh).renderOrder === -1) as Mesh;

  it('takes the fog, clear colour and sky light from the palette, and daylight as given', () => {
    const { view } = createTestWorldView(6);
    view.setTime(0, 0.12);
    view.frame(0);
    const night = skyPalette(0, createSkyColors());
    expect(hex(fogOf(view).color)).toBe(hex(night.horizon));
    expect(hex(view.scene.background as Color)).toBe(hex(night.horizon));
    const sun = sunDirection(0, new Vector3());
    const moon = moonDirection(0, 0, MOON, new Vector3());
    const light = sunLightAt(sun, moon, night.light, 0, createSunLight());
    expect(hex(view.materials.uniforms.uSkyLight.value)).toBe(hex(light.sky));
    expect(hex(view.materials.uniforms.uSunLight.value)).toBe(hex(light.direct));
    expect(view.materials.uniforms.uDaylight.value).toBe(0.12);
    expect(fogOf(view).far).toBe(6 * 32 - 8);
  });

  it("tints the horizon and the fog towards the biome's air, easing in", () => {
    const { view } = createTestWorldView(6);
    view.setTime(12, 1);
    view.frame(0);
    const plain = fogOf(view).color.clone();
    view.setAir('#ff2000', 0);
    view.frame(1);
    const partway = fogOf(view).color.clone();
    for (let i = 0; i < 5; i++) view.frame(1);
    const tinted = fogOf(view).color;
    const redness = (c: Color) => c.r / c.b;
    expect(redness(partway)).toBeGreaterThan(redness(plain));
    expect(redness(tinted)).toBeGreaterThan(redness(partway));
    view.setAir(null, 0);
    for (let i = 0; i < 5; i++) view.frame(1);
    expect(hex(fogOf(view).color)).toBe(hex(plain));
  });

  it('switches to a short teal fog without sky under water, and back', () => {
    const { view } = createTestWorldView(6);
    view.setTime(12, 1);
    view.setUnderwater(WATER_VIEW);
    view.frame(0);
    const fog = fogOf(view);
    expect([fog.near, fog.far]).toEqual([1, 20]);
    expect(fog.color.b).toBeGreaterThan(fog.color.r);
    expect(skyMesh(view).visible).toBe(false);
    view.setUnderwater(null);
    view.frame(0);
    expect([fog.near, fog.far]).toEqual([6 * 32 * 0.55, 6 * 32 - 8]);
    expect(skyMesh(view).visible).toBe(true);
  });

  it('sees almost nothing in lava: its own opaque glowing fog, as in the reference game', () => {
    const { view } = createTestWorldView(6);
    const lava = basePack.blocks.find((b) => b.liquid?.swim === false)!.liquid!.fog!;
    view.setTime(0, 0.05);
    view.setUnderwater({ ...lava, glows: true });
    view.frame(0);
    const fog = fogOf(view);
    expect(fog.far).toBeLessThanOrEqual(2);
    // Glowing: as bright at midnight as its colour, never dimmed like water.
    expect(hex(fog.color)).toBe(lava.color.slice(1));
    expect(fog.color.r).toBeGreaterThan(fog.color.b);
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
