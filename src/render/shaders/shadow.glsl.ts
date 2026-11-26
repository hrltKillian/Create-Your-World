import { CUTOUT_ALPHA, VOXEL_DECODE } from './voxel.glsl.ts';

/**
 * The sun's shadow pass (plan v4 « M37 », SunShadow.ts): chunk meshes drawn from the sun into a
 * depth texture. Cutout meshes (leaves, plants) cut their holes, so foliage casts dappled shade.
 */
export const shadowVertex = /* glsl */ `
${VOXEL_DECODE}
out vec2 vUv;
flat out float vLayer;

void main() {
  vec3 base = voxelBase();
  vUv = voxelUv(base);
  vLayer = voxelLayer();
  gl_Position = projectionMatrix * modelViewMatrix * vec4(voxelSway(base), 1.0);
}
`;

export const shadowFragment = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
in vec2 vUv;
flat in float vLayer;

void main() {
  #ifdef ALPHA_CUTOUT
  if (texture(uTextures, vec3(vUv, vLayer)).a < ${CUTOUT_ALPHA}) discard;
  #endif
  gl_FragColor = vec4(1.0);
}
`;
