import {
  Color,
  type DataArrayTexture,
  type DepthTexture,
  DoubleSide,
  FrontSide,
  type IUniform,
  Matrix4,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { voxelFragment, voxelVertex } from './shaders/voxel.glsl.ts';

/**
 * Debug render views. `xray` also needs xray meshes (the mesh scheduler's `setXray`): terrain is
 * drawn as faint ghosts without depth writes, everything else unlit at full brightness.
 */
export const DEBUG_VIEWS = ['none', 'quads', 'ao', 'light', 'xray'] as const;
export type DebugView = (typeof DEBUG_VIEWS)[number];

/**
 * The pack's texture arrays: colours (sRGB) and materials (linear: normal, roughness, cavity), and
 * the layers of liquid faces (`liquidLayerMask`).
 */
export interface PackTextures {
  readonly textures: DataArrayTexture;
  readonly materials: DataArrayTexture;
  /** The models' skin atlases and their relief (plan v5 « M52 »; `skinTextures`), box shader only. */
  readonly skins: DataArrayTexture;
  readonly skinMaterials: DataArrayTexture;
  readonly liquids: Int32Array;
}

/** Uniforms shared by reference between the three chunk materials (never cloned). */
export interface VoxelUniforms {
  readonly uTextures: IUniform<DataArrayTexture>;
  /** The material layers (plan v4 « M36 »): relief normal, roughness, cavity. */
  readonly uMaterials: IUniform<DataArrayTexture>;
  readonly uSkins: IUniform<DataArrayTexture>;
  readonly uSkinMaterials: IUniform<DataArrayTexture>;
  readonly uTintColors: IUniform<Color[]>;
  readonly uTime: IUniform<number>;
  /** Wind (plan v4 « M40 »): 1 calm, more in a storm; plants sway further. */
  readonly uWind: IUniform<number>;
  /** The plants' sway phase (render/wind.ts). */
  readonly uWindPhase: IUniform<number>;
  readonly uDaylight: IUniform<number>;
  /** The sky's light (plan v4 « M37 », `sunLight.ts`): direction, direct, sky and ground light. */
  readonly uSunDir: IUniform<Vector3>;
  readonly uSunLight: IUniform<Color>;
  readonly uSkyLight: IUniform<Color>;
  readonly uGroundLight: IUniform<Color>;
  /** The sun's shadow map (`SunShadow`): none (null) when shadows are off, strength 0. */
  readonly uShadowMap: IUniform<DepthTexture | null>;
  readonly uShadowMatrix: IUniform<Matrix4>;
  readonly uShadowTexel: IUniform<number>;
  readonly uShadowStrength: IUniform<number>;
  /** Rain on the open ground, 0–1: darker and glossy. */
  readonly uWetness: IUniform<number>;
  /** Liquids (plan v4 « M38 »): their layers, and 1 while the camera is in one (caustics). */
  readonly uLiquidLayers: IUniform<Int32Array>;
  readonly uUnderwater: IUniform<number>;
  /** The sky's gradient (`SKY_GRADIENT`), the water's reflection: copied from the sky each frame. */
  readonly uZenith: IUniform<Color>;
  readonly uHorizon: IUniform<Color>;
  /** The sun's haze along the horizon, in the sky and the fog (plan v4 « M39 »). */
  readonly uHaze: IUniform<Color>;
  /** The low ground's mist (`MIST`): strength 0–1 and the height it lies under. */
  readonly uMist: IUniform<number>;
  readonly uMistLine: IUniform<number>;
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
    uSkins: { value: textures.skins },
    uSkinMaterials: { value: textures.skinMaterials },
    uTintColors: { value: tints },
    uTime: { value: 0 },
    uWind: { value: 1 },
    uWindPhase: { value: 0 },
    uDaylight: { value: 1 },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunLight: { value: new Color(0.6, 0.6, 0.6) },
    uSkyLight: { value: new Color(0.62, 0.62, 0.62) },
    uGroundLight: { value: new Color(0.4, 0.4, 0.4) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new Matrix4() },
    uShadowTexel: { value: 0 },
    uShadowStrength: { value: 0 },
    uWetness: { value: 0 },
    uLiquidLayers: { value: textures.liquids },
    uUnderwater: { value: 0 },
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uHaze: { value: new Color() },
    uMist: { value: 0 },
    uMistLine: { value: 0 },
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
