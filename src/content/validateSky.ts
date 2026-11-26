import type { ContentPack } from './schema.ts';

type AddIssue = (path: string, message: string) => void;

const HEX = /^#[0-9a-fA-F]{6}$/;
/** The most motes a biome may ask for (render/Motes.ts draws at most as many). */
export const MAX_MOTES = 64;
const within = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;

/**
 * The sky (plan v4 « M39 »): keys by ascending hour within a day, colours, star visibility, one or
 * two moons with a positive period, sizes in degrees; the biomes' aurora strengths in 0…1 and
 * their motes (« M40 »).
 */
export function validateSky(pack: ContentPack, add: AddIssue): void {
  (pack.biomes ?? []).forEach((biome, i) => {
    if (biome.aurora !== undefined && !within(biome.aurora, 0, 1))
      add(`biomes[${i}].aurora`, `must be from 0 to 1 (got ${biome.aurora})`);
    const motes = biome.motes;
    if (motes && !HEX.test(motes.color))
      add(`biomes[${i}].motes.color`, `"${motes.color}" is not a #rrggbb colour`);
    if (motes && !(Number.isInteger(motes.count) && within(motes.count, 1, MAX_MOTES)))
      add(`biomes[${i}].motes.count`, `must be a whole number from 1 to ${MAX_MOTES}`);
  });
  const sky = pack.sky;
  if (!sky) return;
  const colour = (path: string, value: string) => {
    if (!HEX.test(value)) add(path, `"${value}" is not a #rrggbb colour`);
  };
  if (sky.keys.length === 0) add('sky.keys', 'needs at least one key');
  let last = -1;
  sky.keys.forEach((key, i) => {
    const path = `sky.keys[${i}]`;
    if (!(within(key.hour, 0, 24) && key.hour < 24) || key.hour <= last)
      add(`${path}.hour`, `hours ascend within [0, 24) (got ${key.hour})`);
    last = key.hour;
    colour(`${path}.zenith`, key.zenith);
    colour(`${path}.horizon`, key.horizon);
    colour(`${path}.light`, key.light);
    if (!within(key.stars, 0, 1)) add(`${path}.stars`, `must be from 0 to 1 (got ${key.stars})`);
  });
  colour('sky.sun.color', sky.sun.color);
  if (!within(sky.sun.size, 0.1, 20)) add('sky.sun.size', 'degrees from 0.1 to 20');
  if (sky.moons.length < 1 || sky.moons.length > 2) add('sky.moons', 'one or two moons');
  sky.moons.forEach((moon, i) => {
    const path = `sky.moons[${i}]`;
    colour(`${path}.color`, moon.color);
    if (!within(moon.size, 0.1, 20)) add(`${path}.size`, 'degrees from 0.1 to 20');
    if (!within(moon.period, 1, 1000)) add(`${path}.period`, 'days from 1 to 1000');
    if (!within(moon.tilt, -1, 1)) add(`${path}.tilt`, 'from −1 to 1');
  });
  const giant = sky.giant;
  if (giant) {
    colour('sky.giant.color', giant.color);
    colour('sky.giant.bands', giant.bands);
    colour('sky.giant.ring', giant.ring);
    if (!within(giant.size, 0.1, 30)) add('sky.giant.size', 'degrees from 0.1 to 30');
    if (!within(giant.elevation, -90, 90)) add('sky.giant.elevation', 'degrees from −90 to 90');
  }
  sky.nebula.forEach((c, i) => {
    colour(`sky.nebula[${i}]`, c);
  });
  sky.aurora.forEach((c, i) => {
    colour(`sky.aurora[${i}]`, c);
  });
}
