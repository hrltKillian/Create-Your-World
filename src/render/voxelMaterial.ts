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

/**
 * Debug render views. `xray` also needs xray meshes (the mesh scheduler's `setXray`): terrain is
 * drawn as faint ghosts without depth writes, everything else unlit at full brightness.
 */
export const DEBUG_VIEWS = ['none', 'quads', 'ao', 'light', 'xray'] as const;
export type DebugView = (typeof DEBUG_VIEWS)[number];

/** The pack's texture arrays: colours (sRGB) and materials (linear: normal, roughness, cavity). */
export interface PackTextures {
  readonly textures: DataArrayTexture;
  readonly materials: DataArrayTexture;
}

/** Uniforms shared by reference between the three chunk materials (never cloned). */
export interface VoxelUniforms {
  readonly uTextures: IUniform<DataArrayTexture>;
  /** The material layers (plan v4 « M36 »): relief normal, roughness, cavity. */
  readonly uMaterials: IUniform<DataArrayTexture>;
  readonly uTintColors: IUniform<Color[]>;
  readonly uTime: IUniform<number>;
  readonly uDaylight: IUniform<number>;
  readonly uSkyTint: IUniform<Color>;
  readonly uTorchTint: IUniform<Color>;
  /** Torch flicker factor on block light (`torchFlicker`). */
  readonly uFlicker: IUniform<number>;
  readonly uMinLight: IUniform<number>;
  /** The player's gamma (Settings): 0 the plain light curve, 1 the brightest (LIGHT_CURVE). */
  readonly uGamma: IUniform<number>;
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

/**
 * Torch flicker at a time (s): block light × 0.93…1.07, three waves of unrelated periods, so it
 * never looks like a regular pulse.
 */
export function torchFlicker(seconds: number): number {
  return (
    1 +
    0.035 * Math.sin(seconds * 7.3) +
    0.025 * Math.sin(seconds * 12.9 + 1.3) +
    0.01 * Math.sin(seconds * 23.1 + 0.4)
  );
}

/** `tintColors[i]` is the colour of tint index i (0 = no tint, white). sRGB hex strings. */
export function createVoxelMaterials(
  textures: PackTextures,
  tintColors: readonly string[],
): VoxelMaterials {
  const tints = Array.from({ length: 32 }, (_, i) => new Color(tintColors[i] ?? '#ffffff'));
  const uniforms: VoxelUniforms = {
    uTextures: { value: textures.textures },
    uMaterials: { value: textures.materials },
    uTintColors: { value: tints },
    uTime: { value: 0 },
    uDaylight: { value: 1 },
    uSkyTint: { value: new Color(1, 1, 1) },
    uTorchTint: { value: new Color(1, 0.78, 0.55) },
    uFlicker: { value: 1 },
    uMinLight: { value: 0.025 },
    uGamma: { value: 0 },
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
      // Ghost faces must not hide the ghosts and ores behind them.
      translucent.depthWrite = view !== 'xray';
    },
    dispose: () => {
      opaque.dispose();
      cutout.dispose();
      translucent.dispose();
    },
  };
}
