/** Pre-boot capability gate: checks what the game needs before creating the renderer. */

export type Capability = 'webgl2' | 'moduleWorkers' | 'pointerLock';

export interface CapabilityReport {
  readonly ok: boolean;
  readonly missing: readonly Capability[];
  readonly maxArrayTextureLayers: number;
  readonly touchOnly: boolean;
}

export interface CapabilityOptions {
  /** Test switch (?forceNoWebGL=1). */
  readonly forceNoWebGL?: boolean;
}

const REQUIRED_ARRAY_LAYERS = 256;

export function detectCapabilities(options: CapabilityOptions = {}): CapabilityReport {
  const missing: Capability[] = [];

  const layers = options.forceNoWebGL ? 0 : probeWebGL2();
  if (layers < REQUIRED_ARRAY_LAYERS) missing.push('webgl2');
  if (!supportsModuleWorkers()) missing.push('moduleWorkers');
  if (typeof HTMLElement === 'undefined' || !('requestPointerLock' in HTMLElement.prototype)) {
    missing.push('pointerLock');
  }

  const touchOnly =
    typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(any-pointer: fine)').matches;

  return { ok: missing.length === 0, missing, maxArrayTextureLayers: layers, touchOnly };
}

/** Returns MAX_ARRAY_TEXTURE_LAYERS, or 0 when WebGL 2 is unavailable. */
function probeWebGL2(): number {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return 0;
    const layers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return layers;
  } catch {
    return 0;
  }
}

/** Feature-detects `{ type: 'module' }` workers without loading any script. */
function supportsModuleWorkers(): boolean {
  if (typeof Worker === 'undefined') return false;
  let supported = false;
  const options = {
    get type(): WorkerType {
      supported = true;
      return 'module';
    },
  };
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
    new Worker(url, options).terminate();
  } catch {
    // Some browsers throw after reading the option; `supported` already tells us enough.
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
  return supported;
}
