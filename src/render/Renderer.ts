import { NoToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';

export interface RendererOptions {
  /** Upper bound for devicePixelRatio (quality presets: 1, 1.5, 2). */
  readonly maxPixelRatio: number;
}

/** Owns the WebGL renderer and keeps the canvas sized to its container. */
export class Renderer {
  readonly webgl: WebGLRenderer;
  private readonly observer: ResizeObserver;
  private onResize: ((width: number, height: number) => void) | null = null;

  constructor(container: HTMLElement, options: RendererOptions) {
    this.webgl = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.webgl.outputColorSpace = SRGBColorSpace;
    this.webgl.toneMapping = NoToneMapping;
    this.webgl.info.autoReset = false;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio));
    const canvas = this.webgl.domElement;
    canvas.className = 'game-canvas';
    container.appendChild(canvas);
    this.observer = new ResizeObserver(() => this.resize(container));
    this.observer.observe(container);
    this.resize(container);
  }

  setResizeHandler(handler: (width: number, height: number) => void): void {
    this.onResize = handler;
    const size = this.webgl.domElement.getBoundingClientRect();
    handler(Math.max(1, size.width), Math.max(1, size.height));
  }

  dispose(): void {
    this.observer.disconnect();
    this.webgl.setAnimationLoop(null);
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }

  private resize(container: HTMLElement): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.webgl.setSize(width, height, false);
    this.onResize?.(width, height);
  }
}
