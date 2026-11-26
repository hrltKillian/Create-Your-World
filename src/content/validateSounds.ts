import type { ContentPack, SfxDef, SfxLayer, SoundBindings } from './schema.ts';

type AddIssue = (path: string, message: string) => void;

/** Longest synthesized one-shot (s). */
export const MAX_SFX_SECONDS = 2;
/** Longest ambience loop (s): rendered on first use, so its length costs nothing at startup. */
export const MAX_LOOP_SECONDS = 8;
const MAX_FREQ = 20_000;

/** Length of a recipe in seconds: the end of its last layer. */
export function sfxSeconds(def: SfxDef): number {
  let end = 0;
  for (const layer of def.layers)
    end = Math.max(end, (layer.delay ?? 0) + layer.attack + (layer.hold ?? 0) + layer.decay);
  return end;
}

/** Every sound key the bindings name, with its path (`sounds.player.jump`…). */
export function boundSounds(sounds: SoundBindings): [path: string, key: string][] {
  const out: [string, string][] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') out.push([path, value]);
    else if (value && typeof value === 'object')
      for (const [name, inner] of Object.entries(value)) walk(inner, `${path}.${name}`);
  };
  walk(sounds, 'sounds');
  return out;
}

/** The bound keys that name loop recipes (the ambience); every other one names a one-shot. */
const isLoopPath = (path: string) => path.startsWith('sounds.ambience.');

const inRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;

/** Sound recipes (keys, layers, lengths) and the bindings naming them. */
export function validateSounds(pack: ContentPack, add: AddIssue): void {
  const recipes = new Map<string, SfxDef>();
  (pack.sfx ?? []).forEach((def, i) => {
    const path = `sfx[${i}]`;
    if (!def.key.startsWith('sfx:')) add(`${path}.key`, `"${def.key}" must start with "sfx:"`);
    if (recipes.has(def.key)) add(`${path}.key`, `duplicate sound "${def.key}"`);
    recipes.set(def.key, def);
    validateLayers(def, path, add);
  });

  const sounds = pack.sounds;
  if (!sounds) return;
  for (const [path, key] of boundSounds(sounds)) {
    const def = recipes.get(key);
    const loop = isLoopPath(path);
    if (!key.startsWith('sfx:')) add(path, `"${key}" must start with "sfx:"`);
    else if (!def) add(path, `no recipe for "${key}"`);
    else if (loop !== (def.loop === true))
      add(path, `"${key}" must be ${loop ? 'a loop' : 'a one-shot'} recipe`);
  }
  const stations = new Set<string>((pack.stations ?? []).map((s) => s.key));
  for (const station of Object.keys(sounds.lit))
    if (!stations.has(station)) add(`sounds.lit.${station}`, 'unknown station');
  const biomes = new Set<string>((pack.biomes ?? []).map((b) => b.key));
  for (const biome of Object.keys(sounds.ambience.biomes))
    if (!biomes.has(biome)) add(`sounds.ambience.biomes.${biome}`, 'unknown biome');
}

/** What each source needs (plan v4 « M44 »): a tone its glide, modes and grains their fields. */
function checkSource(layer: SfxLayer, lpath: string, add: AddIssue): void {
  const source = layer.source;
  if (source === 'noise') return;
  if (source === 'modal') {
    const modes = layer.modes ?? [];
    if (modes.length === 0) add(`${lpath}.modes`, 'a modal layer needs modes');
    modes.forEach(([freq, ring, gain], m) => {
      if (!inRange(freq, 20, MAX_FREQ) || !inRange(ring, 0.001, 10) || !inRange(gain, 0, 1))
        add(
          `${lpath}.modes[${m}]`,
          `frequency in 20–${MAX_FREQ} Hz, ring in (0, 10] s, gain in 0–1`,
        );
    });
    return;
  }
  if (source === 'grains') {
    const g = layer.grains;
    const ok =
      g &&
      inRange(g.rate, 0.1, 2000) &&
      inRange(g.seconds[0], 0.0005, 1) &&
      inRange(g.seconds[1], g.seconds[0], 1) &&
      (!g.tone || (inRange(g.tone[0], 20, MAX_FREQ) && inRange(g.tone[1], g.tone[0], MAX_FREQ)));
    if (!ok) add(`${lpath}.grains`, 'a grain layer needs a rate, grain lengths and (tone) pitches');
    return;
  }
  if (!layer.freq?.every((f) => inRange(f, 20, MAX_FREQ)))
    add(`${lpath}.freq`, `a tone needs two frequencies in 20–${MAX_FREQ} Hz`);
  const v = layer.vibrato;
  if (v && !(inRange(v.rate, 0.1, 40) && inRange(v.depth, 0, 12)))
    add(`${lpath}.vibrato`, 'a rate in 0.1–40 Hz and a depth in 0–12 semitones');
}

/** Gains, envelope times, frequencies and the length of one recipe. */
function validateLayers(def: SfxDef, path: string, add: AddIssue): void {
  const max = def.loop ? MAX_LOOP_SECONDS : MAX_SFX_SECONDS;
  if (def.layers.length === 0) add(`${path}.layers`, 'needs at least one layer');
  def.layers.forEach((layer, l) => {
    const lpath = `${path}.layers[${l}]`;
    if (!inRange(layer.gain, 0.001, 1)) add(`${lpath}.gain`, 'must be in (0, 1]');
    if (!inRange(layer.attack, 0.0005, max)) add(`${lpath}.attack`, 'must be > 0');
    if (!inRange(layer.decay, 0.001, max)) add(`${lpath}.decay`, 'must be > 0');
    if (!inRange(layer.delay ?? 0, 0, max)) add(`${lpath}.delay`, 'must be ≥ 0');
    if (!inRange(layer.hold ?? 0, 0, max)) add(`${lpath}.hold`, 'must be ≥ 0');
    checkSource(layer, lpath, add);
    const filter = layer.filter;
    if (filter && !inRange(filter.freq, 20, MAX_FREQ))
      add(`${lpath}.filter.freq`, `must be in 20–${MAX_FREQ} Hz`);
    if (filter?.q !== undefined && !inRange(filter.q, 0.0001, 100))
      add(`${lpath}.filter.q`, 'must be in (0, 100]');
  });
  if (sfxSeconds(def) > max) add(`${path}.layers`, `lasts more than ${max} s`);
}
