import {
  DataArrayTexture,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { skinMaterial, skinPixels } from '../assets/procedural/skinArt.ts';
import { type ContentPack, SKIN_SIZE } from '../content/schema.ts';

/**
 * Packs same-sized RGBA layers into one texture array: sRGB colours, or linear data (`srgb`
 * false: the material layers). Texels stay sharp up close (nearest magnification) and blend
 * smoothly far off (trilinear mipmaps, plus the anisotropy WorldView sets): no shimmer. Skin
 * atlases (`mipmaps` false) stay sharp at every distance, the reference game's: their mipmaps
 * would blend the parts packed side by side and their glowing texels.
 */
export function createTextureArray(
  layers: readonly Uint8Array[],
  size: number,
  srgb = true,
  mipmaps = true,
): DataArrayTexture {
  const layerBytes = size * size * 4;
  const data = new Uint8Array(layerBytes * layers.length);
  layers.forEach((layer, i) => {
    if (layer.length !== layerBytes) throw new Error(`Texture layer ${i} has the wrong size`);
    data.set(layer, i * layerBytes);
  });
  const texture = new DataArrayTexture(data, size, size, layers.length);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : NearestFilter;
  texture.generateMipmaps = mipmaps;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The pack's skin atlases as texture arrays (plan v5 « M52 »), in the order of `pack.skins`: their
 * colours and their material layers (relief); an empty layer when it has none (an array needs one).
 */
export function skinTextures(pack: ContentPack): {
  colours: DataArrayTexture;
  materials: DataArrayTexture;
} {
  const skins = pack.skins ?? [];
  const empty = [new Uint8Array(SKIN_SIZE * SKIN_SIZE * 4)];
  const layers = (paint: (skin: (typeof skins)[number]) => Uint8Array) =>
    skins.length > 0 ? skins.map(paint) : empty;
  return {
    colours: createTextureArray(layers(skinPixels), SKIN_SIZE, true, false),
    materials: createTextureArray(layers(skinMaterial), SKIN_SIZE, false, false),
  };
}
