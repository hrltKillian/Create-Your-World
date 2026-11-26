import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  bloomCompositeFragment,
  bloomDownFragment,
  bloomUpFragment,
  bloomVertex,
} from './shaders/bloom.glsl.ts';

/**
 * Bloom (plan v4 « M40 », decision 28: the high preset): the frame is drawn into a multisampled
 * half-float target (linear, not tone mapped: what glows can go over 1), its bright parts are
 * halved down MIPS smaller targets and blurred back up into each other, then added to the frame,
 * which is tone mapped and turned to sRGB on its way to the screen (the composite pass). Off, the
 * frame goes to the screen as before.
 */

/** Levels of the blur chain, the brightness over which things bloom, and the bloom's share. */
const MIPS = 5;
const THRESHOLD = 0.9;
const STRENGTH = 0.35;
/** Multisampling of the frame (the high preset's anti-aliasing). */
const SAMPLES = 4;

const size = new Vector2();

export class Bloom {
  private frame: WebGLRenderTarget;
  private readonly mips: WebGLRenderTarget[] = [];
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly down: ShaderMaterial;
  private readonly up: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private width = 0;
  private height = 0;

  constructor() {
    const geometry = new BufferGeometry();
    // One triangle over the whole screen.
    const corners = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
    geometry.setAttribute('position', new BufferAttribute(corners, 3));
    const make = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
      new ShaderMaterial({
        vertexShader: bloomVertex,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
      });
    const source = () => ({ uSource: { value: null }, uTexel: { value: new Vector2() } });
    this.down = make(bloomDownFragment, { ...source(), uThreshold: { value: 0 } });
    this.up = make(bloomUpFragment, source());
    this.up.blending = AdditiveBlending;
    this.composite = make(bloomCompositeFragment, {
      uFrame: { value: null },
      uBloom: { value: null },
      uStrength: { value: STRENGTH },
    });
    this.quad = new Mesh(geometry, this.down);
    this.quad.frustumCulled = false;
    this.frame = this.target(1, 1, SAMPLES);
  }

  private target(width: number, height: number, samples = 0): WebGLRenderTarget {
    return new WebGLRenderTarget(width, height, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: samples > 0,
      samples,
    });
  }

  /** The targets follow the drawing buffer's size. */
  private fit(webgl: WebGLRenderer): void {
    webgl.getDrawingBufferSize(size);
    if (size.x === this.width && size.y === this.height) return;
    this.width = size.x;
    this.height = size.y;
    this.frame.setSize(size.x, size.y);
    for (const mip of this.mips) mip.dispose();
    this.mips.length = 0;
    let w = size.x;
    let h = size.y;
    for (let i = 0; i < MIPS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this.mips.push(this.target(w, h));
    }
  }

  /** Draws the frame (`draw` renders into the current target) with its bloom, onto the screen. */
  render(webgl: WebGLRenderer, draw: () => void): void {
    this.fit(webgl);
    webgl.setRenderTarget(this.frame);
    webgl.clear();
    draw();
    // Down: the bright parts, halved level by level.
    let source = this.frame;
    for (let i = 0; i < MIPS; i++) {
      this.pass(webgl, this.down, source, this.mips[i]!, i === 0 ? THRESHOLD : 0);
      source = this.mips[i]!;
    }
    // Up: each level blurred and added onto the next larger one.
    webgl.autoClear = false;
    for (let i = MIPS - 1; i > 0; i--)
      this.pass(webgl, this.up, this.mips[i]!, this.mips[i - 1]!, 0);
    webgl.autoClear = true;
    const u = this.composite.uniforms;
    u.uFrame!.value = this.frame.texture;
    u.uBloom!.value = this.mips[0]!.texture;
    this.quad.material = this.composite;
    webgl.setRenderTarget(null);
    webgl.render(this.quad, this.camera);
  }

  private pass(
    webgl: WebGLRenderer,
    material: ShaderMaterial,
    source: WebGLRenderTarget,
    target: WebGLRenderTarget,
    threshold: number,
  ): void {
    const u = material.uniforms;
    u.uSource!.value = source.texture;
    (u.uTexel!.value as Vector2).set(1 / source.width, 1 / source.height);
    if (u.uThreshold) u.uThreshold.value = threshold;
    this.quad.material = material;
    webgl.setRenderTarget(target);
    webgl.render(this.quad, this.camera);
  }

  dispose(): void {
    this.frame.dispose();
    for (const mip of this.mips) mip.dispose();
    this.quad.geometry.dispose();
    this.down.dispose();
    this.up.dispose();
    this.composite.dispose();
  }
}
