import {
  DataArrayTexture,
  NearestFilter,
  NearestMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

/** Packs same-sized RGBA layers into one sRGB texture array (pixel-art filtering, mipmapped). */
export function createTextureArray(layers: readonly Uint8Array[], size: number): DataArrayTexture {
  const layerBytes = size * size * 4;
  const data = new Uint8Array(layerBytes * layers.length);
  layers.forEach((layer, i) => {
    if (layer.length !== layerBytes) throw new Error(`Texture layer ${i} has the wrong size`);
    data.set(layer, i * layerBytes);
  });
  const texture = new DataArrayTexture(data, size, size, layers.length);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
