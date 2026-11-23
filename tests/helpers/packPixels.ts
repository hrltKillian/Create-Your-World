import { generatePackTexture } from '../../src/assets/procedural/patterns.ts';
import { basePack } from '../../src/content/packs/base/index.ts';

/** Texture size of the base pack. */
export const TEXTURE_SIZE = basePack.manifest.textureSize;

/** RGBA bytes of every base-pack texture, one layer after another (the texture array's data). */
export const layers = basePack.textures.map((def) => generatePackTexture(def, TEXTURE_SIZE));
export const packPixels = new Uint8Array(layers.length * TEXTURE_SIZE * TEXTURE_SIZE * 4);
for (let i = 0; i < layers.length; i++)
  packPixels.set(layers[i]!, i * TEXTURE_SIZE * TEXTURE_SIZE * 4);
