import type { ContentPack, SfxDef } from './schema.ts';

type AddIssue = (path: string, message: string) => void;

/** Longest synthesized sound (s): recipes are short one-shots. */
export const MAX_SFX_SECONDS = 2;
const MAX_FREQ = 20_000;

/** Length of a recipe in seconds: the end of its last layer. */
export function sfxSeconds(def: SfxDef): number {
  let end = 0;
  for (const layer of def.layers)
    end = Math.max(end, (layer.delay ?? 0) + layer.attack + layer.decay);
  return end;
}

const inRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;

/** Sound recipes (keys, layers, lengths) and the bindings naming them. */
export function validateSounds(pack: ContentPack, add: AddIssue): void {
  const keys = new Set<string>();
  (pack.sfx ?? []).forEach((def, i) => {
    const path = `sfx[${i}]`;
    if (!def.key.startsWith('sfx:')) add(`${path}.key`, `"${def.key}" must start with "sfx:"`);
    if (keys.has(def.key)) add(`${path}.key`, `duplicate sound "${def.key}"`);
    keys.add(def.key);
    if (def.layers.length === 0) add(`${path}.layers`, 'needs at least one layer');
    def.layers.forEach((layer, l) => {
      const lpath = `${path}.layers[${l}]`;
      if (!inRange(layer.gain, 0.001, 1)) add(`${lpath}.gain`, 'must be in (0, 1]');
      if (!inRange(layer.attack, 0.0005, MAX_SFX_SECONDS)) add(`${lpath}.attack`, 'must be > 0');
      if (!inRange(layer.decay, 0.001, MAX_SFX_SECONDS)) add(`${lpath}.decay`, 'must be > 0');
      if (!inRange(layer.delay ?? 0, 0, MAX_SFX_SECONDS)) add(`${lpath}.delay`, 'must be ≥ 0');
      const tone = layer.source !== 'noise';
      if (tone && !layer.freq?.every((f) => inRange(f, 20, MAX_FREQ)))
        add(`${lpath}.freq`, `a tone needs two frequencies in 20–${MAX_FREQ} Hz`);
      const filter = layer.filter;
      if (filter && !inRange(filter.freq, 20, MAX_FREQ))
        add(`${lpath}.filter.freq`, `must be in 20–${MAX_FREQ} Hz`);
      if (filter?.q !== undefined && !inRange(filter.q, 0.0001, 100))
        add(`${lpath}.filter.q`, 'must be in (0, 100]');
    });
    if (sfxSeconds(def) > MAX_SFX_SECONDS)
      add(`${path}.layers`, `lasts more than ${MAX_SFX_SECONDS} s`);
  });

  const sounds = pack.sounds;
  if (!sounds) return;
  const bound: [string, string][] = [
    ['sounds.pickup', sounds.pickup],
    ['sounds.click', sounds.click],
  ];
  for (const [material, actions] of Object.entries(sounds.blocks)) {
    for (const [action, key] of Object.entries(actions))
      bound.push([`sounds.blocks.${material}.${action}`, key]);
  }
  for (const [path, key] of bound) {
    if (!key.startsWith('sfx:')) add(path, `"${key}" must start with "sfx:"`);
    else if (!keys.has(key)) add(path, `no recipe for "${key}"`);
  }
}
