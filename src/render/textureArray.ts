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

/**
 * Packs same-sized RGBA layers into one texture array: sRGB colours, or linear data (`srgb`
 * false: the material layers). Texels stay sharp up close (nearest magnification) and blend
 * smoothly far off (trilinear mipmaps, plus the anisotropy WorldView sets): no shimmer.
 */
export function createTextureArray(
  layers: readonly Uint8Array[],
  size: number,
  srgb = true,
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
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
