import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { skyFragment, skyVertex } from './shaders/sky.glsl.ts';

/** Sky dome following the camera (sun, moon and stars arrive with the day cycle in M5). */
export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(zenith: string, horizon: string) {
    this.material = new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: { uZenith: { value: new Color(zenith) }, uHorizon: { value: new Color(horizon) } },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(10, 24, 12), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  setColors(zenith: Color, horizon: Color): void {
    (this.material.uniforms.uZenith!.value as Color).copy(zenith);
    (this.material.uniforms.uHorizon!.value as Color).copy(horizon);
  }

  follow(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
