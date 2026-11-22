import {
  BoxGeometry,
  type DataArrayTexture,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { testCubeFragment, testCubeVertex } from './shaders/testCube.glsl.ts';

/** Box textured from a texture array: `faceLayers` gives the layer of +x, −x, +y, −y, +z, −z. */
export function createTestCube(
  textures: DataArrayTexture,
  faceLayers: readonly [number, number, number, number, number, number],
): Mesh {
  const geometry = new BoxGeometry(1, 1, 1);
  const layers = new Float32Array(geometry.attributes.position!.count);
  for (let face = 0; face < 6; face++) layers.fill(faceLayers[face]!, face * 4, face * 4 + 4);
  geometry.setAttribute('aLayer', new Float32BufferAttribute(layers, 1));
  const material = new ShaderMaterial({
    vertexShader: testCubeVertex,
    fragmentShader: testCubeFragment,
    uniforms: {
      uTextures: { value: textures },
      uLightDir: { value: new Vector3(0.45, 0.8, 0.4).normalize() },
    },
  });
  return new Mesh(geometry, material);
}
