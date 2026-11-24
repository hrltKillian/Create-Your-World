import type { VoxelUniforms } from '../../src/render/voxelMaterial.ts';

/** Stand-in shared uniforms: box batches and overlays only keep references to them (no WebGL). */
export const boxUniforms = {
  uTextures: { value: null },
  uDaylight: { value: 1 },
  uSkyTint: { value: null },
  uTorchTint: { value: null },
  uMinLight: { value: 0 },
} as unknown as VoxelUniforms;
