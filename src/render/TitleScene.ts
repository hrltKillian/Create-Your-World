import { Color, type Mesh, PerspectiveCamera, Scene } from 'three';
import { generateTexture, type TextureRecipe } from '../assets/procedural/textureGen.ts';
import type { Renderer } from './Renderer.ts';
import { createTestCube } from './TestCube.ts';
import { createTextureArray } from './textureArray.ts';

/** M0 test textures (replaced by the content pack's recipes in M1). */
const TEST_TEXTURES: readonly TextureRecipe[] = [
  { pattern: 'speckle', palette: ['#4b5257', '#5d666b', '#6f797c', '#838c8c'], seed: 11 },
  { pattern: 'planks', palette: ['#4a2f1c', '#6b4429', '#80553a', '#966a49', '#a87c57'], seed: 23 },
  { pattern: 'ore', palette: ['#4d5458', '#5e676b', '#727c7f', '#c9824e', '#efb27a'], seed: 37 },
];

/** Spinning texture-array cube behind the temporary title overlay. */
export class TitleScene {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(60, 1, 0.1, 100);
  private readonly cube: Mesh;
  private readonly renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.scene.background = new Color('#7fa7c6');
    this.camera.position.set(0, 0.35, 2.4);
    renderer.setResizeHandler((width, height) => {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    });
    const textures = createTextureArray(
      TEST_TEXTURES.map((recipe) => generateTexture(recipe)),
      16,
    );
    this.cube = createTestCube(textures, [0, 0, 1, 1, 2, 2]);
    this.cube.rotation.set(0.45, 0.6, 0);
    this.scene.add(this.cube);
  }

  /** Advances the animation by `dt` seconds and draws one frame. */
  frame(dt: number): void {
    this.cube.rotation.y += dt * 0.5;
    const webgl = this.renderer.webgl;
    webgl.info.reset();
    webgl.render(this.scene, this.camera);
  }
}
