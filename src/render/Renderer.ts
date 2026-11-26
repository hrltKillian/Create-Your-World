import { ACESFilmicToneMapping, SRGBColorSpace, setConsoleFunction, WebGLRenderer } from 'three';
import { createLogger } from '../core/log.ts';

const log = createLogger('three');

/** Exposure of the tone mapping: the world as bright as before it, sunlit tops a little brighter. */
const EXPOSURE = 0.9;

/** Routes three.js warnings and errors (shader compile/link failures…) into the app logger. */
setConsoleFunction((type, message, ...params) => {
  if (type === 'error') log.error(message, params.length ? params : undefined);
  else if (type === 'warn') log.warn(message, params.length ? params : undefined);
});

export interface RendererOptions {
  /** Upper bound for devicePixelRatio (quality presets: 1, 1.5, 2). */
  readonly maxPixelRatio: number;
  /** Benchmarks: render at this exact drawing-buffer size whatever the pane size. */
  readonly fixedBuffer?: readonly [number, number];
  /** Share of the pixel ratio drawn (`?renderScale`, tests in software rendering); 1 by default. */
  readonly scale?: number;
}

/** Owns the WebGL renderer and keeps the canvas sized to its container. */
export class Renderer {
  readonly webgl: WebGLRenderer;
  private readonly observer: ResizeObserver;
  private readonly container: HTMLElement;
  private maxPixelRatio: number;
  private readonly fixedBuffer: readonly [number, number] | undefined;
  private readonly scale: number;
  private dprQuery: MediaQueryList | null = null;
  private onResize: ((width: number, height: number) => void) | null = null;

  constructor(container: HTMLElement, options: RendererOptions) {
    this.webgl = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.webgl.outputColorSpace = SRGBColorSpace;
    // Filmic tone mapping (plan v4 « M37 »): sunlit faces roll off instead of clipping. The sky's
    // shader leaves it out (its palette is already what the screen shows).
    this.webgl.toneMapping = ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = EXPOSURE;
    this.webgl.info.autoReset = false;
    this.container = container;
    this.maxPixelRatio = options.maxPixelRatio;
    this.fixedBuffer = options.fixedBuffer;
    this.scale = options.scale ?? 1;
    this.webgl.setPixelRatio(this.targetPixelRatio());
    const canvas = this.webgl.domElement;
    canvas.className = 'game-canvas';
    container.appendChild(canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.watchPixelRatio();
    this.resize();
  }

  /** Caps the pixel ratio (a quality preset's 1, 1.5 or 2) and resizes the drawing buffer. */
  setMaxPixelRatio(ratio: number): void {
    this.maxPixelRatio = ratio;
    this.resize();
  }

  setResizeHandler(handler: (width: number, height: number) => void): void {
    this.onResize = handler;
    const size = this.webgl.domElement.getBoundingClientRect();
    handler(Math.max(1, size.width), Math.max(1, size.height));
  }

  dispose(): void {
    this.observer.disconnect();
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.webgl.setAnimationLoop(null);
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }

  private targetPixelRatio(): number {
    if (this.fixedBuffer) return 1;
    return Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) * this.scale;
  }

  /** Re-arms a resolution media query so zoom or a monitor change updates the drawing buffer. */
  private watchPixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private readonly onPixelRatioChange = (): void => {
    this.watchPixelRatio();
    this.resize();
  };

  private resize(): void {
    const ratio = this.targetPixelRatio();
    if (ratio !== this.webgl.getPixelRatio()) this.webgl.setPixelRatio(ratio);
    const width = this.fixedBuffer?.[0] ?? Math.max(1, this.container.clientWidth);
    const height = this.fixedBuffer?.[1] ?? Math.max(1, this.container.clientHeight);
    this.webgl.setSize(width, height, false);
    this.onResize?.(width, height);
  }
}
