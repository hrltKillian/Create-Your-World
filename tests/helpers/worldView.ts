import type { Camera, Material, Mesh, Object3D } from 'three';
import { liquidLayerMask } from '../../src/render/liquidLayers.ts';
import type { Renderer } from '../../src/render/Renderer.ts';
import { createTextureArray } from '../../src/render/textureArray.ts';
import { WorldView } from '../../src/render/WorldView.ts';
import { layers, materialLayers, TEXTURE_SIZE } from './packPixels.ts';
import { registry } from './registry.ts';

/** The materials of every mesh, line or sprite under `root`, hidden or not. */
export function sceneMaterials(root: Object3D): Set<Material> {
  const materials = new Set<Material>();
  root.traverse((object) => {
    const material = (object as Mesh).material;
    if (material) materials.add(material as Material);
  });
  return materials;
}

/**
 * A WorldView on the base pack's textures over a stand-in renderer (no WebGL under Node), which
 * records each `compileAsync` call: its camera and the materials of its scene at that moment.
 * `frame` runs (its `render` draws nothing).
 */
export function createTestWorldView(renderDistance = 2) {
  const compiled: { camera: Camera; materials: Set<Material> }[] = [];
  const renderer = {
    setResizeHandler: () => {},
    webgl: {
      compileAsync: (scene: Object3D, camera: Camera) => {
        compiled.push({ camera, materials: sceneMaterials(scene) });
        return Promise.resolve(scene);
      },
      info: { reset: () => {} },
      capabilities: { getMaxAnisotropy: () => 16 },
      render: () => {},
    },
  };
  const textures = createTextureArray(layers, TEXTURE_SIZE);
  const materials = createTextureArray(materialLayers, TEXTURE_SIZE, false);
  const view = new WorldView(
    renderer as unknown as Renderer,
    { textures, materials, liquids: liquidLayerMask(registry.tables) },
    [],
    renderDistance,
    registry.pack.sky,
  );
  return { view, compiled };
}
