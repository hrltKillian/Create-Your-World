import {
  Color,
  type DataArrayTexture,
  DoubleSide,
  FrontSide,
  type IUniform,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three';
import { voxelFragment, voxelVertex } from './shaders/voxel.glsl.ts';

export const DEBUG_VIEWS = ['none', 'quads', 'ao', 'light'] as const;
export type DebugView = (typeof DEBUG_VIEWS)[number];

/** Uniforms shared by reference between the three chunk materials (never cloned). */
export interface VoxelUniforms {
  readonly uTextures: IUniform<DataArrayTexture>;
  readonly uTintColors: IUniform<Color[]>;
  readonly uTime: IUniform<number>;
  readonly uDaylight: IUniform<number>;
  readonly uSkyTint: IUniform<Color>;
  readonly uTorchTint: IUniform<Color>;
  readonly uMinLight: IUniform<number>;
  readonly uOpacity: IUniform<number>;
  readonly uDebugView: IUniform<number>;
}

export interface VoxelMaterials {
  readonly opaque: ShaderMaterial;
  readonly cutout: ShaderMaterial;
  readonly translucent: ShaderMaterial;
  readonly uniforms: VoxelUniforms;
  setDebugView(view: DebugView): void;
  dispose(): void;
}

/** `tintColors[i]` is the colour of tint index i (0 = no tint, white). sRGB hex strings. */
export function createVoxelMaterials(
  textures: DataArrayTexture,
  tintColors: readonly string[],
): VoxelMaterials {
  const tints = Array.from({ length: 32 }, (_, i) => new Color(tintColors[i] ?? '#ffffff'));
  const uniforms: VoxelUniforms = {
    uTextures: { value: textures },
    uTintColors: { value: tints },
    uTime: { value: 0 },
    uDaylight: { value: 1 },
    uSkyTint: { value: new Color(1, 1, 1) },
    uTorchTint: { value: new Color(1, 0.78, 0.55) },
    uMinLight: { value: 0.025 },
    uOpacity: { value: 0.78 },
    uDebugView: { value: 0 },
  };
  const make = (defines: Record<string, string>, extra: Partial<ShaderMaterial>) => {
    const material = new ShaderMaterial({
      vertexShader: voxelVertex,
      fragmentShader: voxelFragment,
      // Fog uniforms are per material; everything else is shared by reference.
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...uniforms },
      defines,
      fog: true,
    });
    Object.assign(material, extra);
    material.index0AttributeName = 'aPacked';
    return material;
  };
  const opaque = make({}, { side: FrontSide });
  const cutout = make({ ALPHA_CUTOUT: '' }, { side: DoubleSide });
  const translucent = make(
    { TRANSLUCENT: '' },
    { side: DoubleSide, transparent: true, forceSinglePass: true, depthWrite: true },
  );
  return {
    opaque,
    cutout,
    translucent,
    uniforms,
    setDebugView: (view) => {
      uniforms.uDebugView.value = DEBUG_VIEWS.indexOf(view);
    },
    dispose: () => {
      opaque.dispose();
      cutout.dispose();
      translucent.dispose();
    },
  };
}
