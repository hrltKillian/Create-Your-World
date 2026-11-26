import { renderPackTexture } from '../../src/assets/procedural/packTexture.ts';
import { basePack } from '../../src/content/packs/base/index.ts';

/** Texture size of the base pack. */
export const TEXTURE_SIZE = basePack.manifest.textureSize;

const rendered = basePack.textures.map((def) => renderPackTexture(def, TEXTURE_SIZE));
/** RGBA bytes of every base-pack texture, one layer after another (the texture array's data). */
export const layers = rendered.map((layer) => layer.color);
/** The material layers of the same textures (normal, roughness, cavity). */
export const materialLayers = rendered.map((layer) => layer.material);
export const packPixels = new Uint8Array(layers.length * TEXTURE_SIZE * TEXTURE_SIZE * 4);
for (let i = 0; i < layers.length; i++)
  packPixels.set(layers[i]!, i * TEXTURE_SIZE * TEXTURE_SIZE * 4);
