import type { SoundBindings, SoundMaterial } from '../../schema.ts';

const material = (m: SoundMaterial) =>
  ({ break: `sfx:break_${m}`, hit: `sfx:hit_${m}`, place: `sfx:place_${m}` }) as const;

/** One break, hit and place sound per sound material, the pickup sound and the UI click. */
export const sounds: SoundBindings = {
  blocks: {
    stone: material('stone'),
    soil: material('soil'),
    sand: material('sand'),
    gravel: material('gravel'),
    wood: material('wood'),
    leaves: material('leaves'),
    glass: material('glass'),
    water: material('water'),
    metal: material('metal'),
    cloth: material('cloth'),
  },
  pickup: 'sfx:pickup',
  click: 'sfx:click',
};
