import {
  GAUGE_SYMBOLS,
  gaugeEmpty,
  gaugeFull,
  hazard,
  moss,
  plate,
  rivet,
  type Sprite,
  socket,
  vine,
} from '../assets/procedural/uiArt.ts';

/**
 * The interface's pixel art (plan v5 « M48 », assets/procedural/uiArt.ts) as CSS custom properties
 * on `root`, data URLs the stylesheets draw with `image-rendering: pixelated`: `--art-plate`,
 * `--art-rivet`, `--art-moss`, `--art-vine`, `--art-hazard`, the slots' sockets (`--art-socket`,
 * `-hover`, `-lit`), and each gauge symbol full and empty
 * (`--icon-health`, `--icon-health-empty`…). Drawn once, at once (browser only).
 */
export function applyUiArt(root: HTMLElement): void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const url = (s: Sprite): string => {
    canvas.width = s.width;
    canvas.height = s.height;
    ctx.putImageData(new ImageData(s.pixels, s.width, s.height), 0, 0);
    return `url(${canvas.toDataURL()})`;
  };
  const set = (name: string, s: Sprite) => root.style.setProperty(name, url(s));
  set('--art-plate', plate());
  set('--art-rivet', rivet());
  set('--art-moss', moss());
  set('--art-vine', vine());
  set('--art-hazard', hazard());
  set('--art-socket', socket('metal'));
  set('--art-socket-hover', socket('violet'));
  set('--art-socket-lit', socket('teal'));
  for (const kind of GAUGE_SYMBOLS) {
    set(`--icon-${kind}`, gaugeFull(kind));
    set(`--icon-${kind}-empty`, gaugeEmpty(kind));
  }
}
