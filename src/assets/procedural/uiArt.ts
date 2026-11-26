import { hashUnit } from '../../core/hash.ts';
import { parseHex } from './palette.ts';
import { valueNoise } from './texNoise.ts';

/*
 * The interface's pixel art (plan v5 « M48 », the « collapsed colony »): painted metal plates
 * chipped down to rust, rivets, moss creeping along an edge, a vine over a corner, worn ochre
 * hazard stripes, and the HUD's gauge symbols (a medical capsule, a ration tin, a canteen, a spore
 * cloud, an air bubble, a dial). Pure: the same sprite always gives the same pixels (RGBA, rows
 * from the top); the page turns them into data URLs (ui/uiArt.ts). Every colour is one of UI.
 */

/** The interface's colours: a few of Veyra's palette. */
export const UI = {
  outline: '#0c0f0b',
  plateDark: '#252c24',
  plate: '#2a322a',
  plateLight: '#2e372d',
  chip: '#55604c',
  metal: '#6b6e66',
  rust: '#7d4423',
  rustLight: '#a85a2b',
  ochre: '#b8763c',
  ochreDark: '#6a4020',
  moss: '#3f5a24',
  mossLight: '#6f9136',
  mossBright: '#9bbf4e',
  teal: '#57e3c6',
  tealLight: '#b8fff0',
  violet: '#b98bff',
  violetLight: '#e2d0ff',
  bone: '#ece6d3',
  boneShade: '#b9b29c',
  red: '#c8402f',
  redLight: '#ec6a4c',
  water: '#3fa7c9',
  waterLight: '#8fdcf0',
  tin: '#b8752f',
  tinLight: '#e0a35a',
  spore: '#7fbf3a',
  sporeDark: '#4d6e1f',
} as const;

export type UiColour = keyof typeof UI;

export interface Sprite {
  readonly width: number;
  readonly height: number;
  /** RGBA, rows from the top. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

function sprite(width: number, height: number): Sprite {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function put(s: Sprite, x: number, y: number, colour: UiColour): void {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
  const [r, g, b] = parseHex(UI[colour]);
  const o = (y * s.width + x) * 4;
  s.pixels[o] = r;
  s.pixels[o + 1] = g;
  s.pixels[o + 2] = b;
  s.pixels[o + 3] = 255;
}

function opaque(s: Sprite, x: number, y: number): boolean {
  return (
    x >= 0 && y >= 0 && x < s.width && y < s.height && s.pixels[(y * s.width + x) * 4 + 3]! > 0
  );
}

/** Outlines a sprite's shape: every empty pixel beside a drawn one (4-neighbours). */
function outline(s: Sprite): void {
  const edge: number[] = [];
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++)
      if (
        !opaque(s, x, y) &&
        (opaque(s, x - 1, y) || opaque(s, x + 1, y) || opaque(s, x, y - 1) || opaque(s, x, y + 1))
      )
        edge.push(x, y);
  for (let i = 0; i < edge.length; i += 2) put(s, edge[i]!, edge[i + 1]!, 'outline');
}

/**
 * A painted plate (tileable, `size` square): one paint, faintly worn lighter and grimed darker in
 * broad patches, a few small chips down to bare metal or rust. Quiet: text and
 * slots sit on it.
 */
export function plate(size = 96, seed = 11): Sprite {
  const s = sprite(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wear = valueNoise(seed, x, y, size, 2);
      put(s, x, y, wear < 0.18 ? 'plateDark' : wear > 0.82 ? 'plateLight' : 'plate');
    }
  }
  // Chips: a few, 2 to 4 pixels, their rust in the middle.
  for (let k = 0; k < 3; k++) {
    const cx = Math.floor(hashUnit(seed, k, 4) * size);
    const cy = Math.floor(hashUnit(seed, k, 5) * size);
    const n = 2 + Math.floor(hashUnit(seed, k, 6) * 3);
    for (let i = 0; i < n; i++) put(s, (cx + i) % size, cy, i === 1 ? 'rust' : 'chip');
    if (n > 2) put(s, (cx + 1) % size, (cy + 1) % size, 'chip');
  }
  return s;
}

/** A rivet (`size` square): a dark ring, a lit dome. */
export function rivet(size = 6): Sprite {
  const s = sprite(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > c + 0.2) continue;
      const lit = x + y < c * 1.3;
      put(s, x, y, d > c - 0.8 ? 'outline' : lit ? 'chip' : 'metal');
    }
  }
  return s;
}

/**
 * Moss along a bottom edge (tileable across, `width` × `height`): tufts of two greens of their
 * own heights, a few glowing spores.
 */
export function moss(width = 48, height = 10, seed = 23): Sprite {
  const s = sprite(width, height);
  for (let x = 0; x < width; x++) {
    const top = Math.floor(height * (0.25 + 0.6 * valueNoise(seed, x, 0, width, 8, 1)));
    for (let y = height - 1; y >= height - top; y--) {
      const light = hashUnit(seed, x, y) < 0.35 || y === height - top;
      put(s, x, y, light ? 'mossLight' : 'moss');
    }
    if (hashUnit(seed, x, 7) < 0.06) put(s, x, height - top - 1, 'teal');
    else if (hashUnit(seed, x, 8) < 0.05) put(s, x, height - top - 1, 'mossBright');
  }
  return s;
}

/** A vine over a top-left corner (`size` square): a stem curling down and right, leaves on it. */
export function vine(size = 32, seed = 31): Sprite {
  const s = sprite(size, size);
  for (let t = 0; t < 1; t += 0.01) {
    // Along the top edge, then down the left one, wavering.
    const x = Math.round(size * 0.9 * (1 - t) * (1 - t) + 1.5 * Math.sin(t * 9));
    const y = Math.round(size * 0.9 * t * t + 1.5 * Math.sin(t * 7 + 1));
    put(s, x, y, 'moss');
    if (hashUnit(seed, Math.round(t * 100)) < 0.1) {
      put(s, x + 1, y + 1, 'mossLight');
      put(s, x + 2, y + 1, 'mossBright');
      put(s, x + 1, y + 2, 'mossLight');
    }
  }
  put(s, Math.round(size * 0.35), Math.round(size * 0.12), 'violet');
  return s;
}

/** Worn ochre hazard stripes, rusted (tileable, `size` square). */
export function hazard(size = 16, seed = 41): Sprite {
  const s = sprite(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const stripe = Math.floor((x + y) / (size / 4)) % 2 === 0;
      const worn = hashUnit(seed, x, y) < 0.12;
      put(s, x, y, stripe ? (worn ? 'ochreDark' : 'ochre') : 'plateDark');
    }
  }
  return s;
}

/** A socket's corner colour: bare metal, hovered violet, the slot in hand teal (no yellow). */
export type SocketLight = 'metal' | 'violet' | 'teal';

/**
 * A slot's socket (9 × 9, drawn as a 9-slice of 3 × 3 corners): a recessed dark floor, a thin dark
 * rim, and an L-shaped bracket bolted on each corner in `light`.
 */
export function socket(light: SocketLight = 'metal'): Sprite {
  const s = sprite(9, 9);
  const bracket: UiColour = light === 'metal' ? 'metal' : light;
  const lit: UiColour = light === 'metal' ? 'chip' : light === 'teal' ? 'tealLight' : 'violetLight';
  // A near-black floor, a little lighter under the top rim.
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 9; x++) put(s, x, y, y === 1 ? 'plateDark' : 'outline');
  // The four brackets, lit on their upper or left arm.
  for (const [cx, cy] of [
    [0, 0],
    [6, 0],
    [0, 6],
    [6, 6],
  ] as const) {
    for (let i = 0; i < 3; i++) {
      put(s, cx + i, cy === 0 ? 0 : 8, cy === 0 ? lit : bracket);
      put(s, cx === 0 ? 0 : 8, cy + i, cx === 0 ? lit : bracket);
    }
  }
  return s;
}

/** The HUD's gauge symbols (16 × 16): each drawn full, and empty (`gaugeEmpty`). */
export const GAUGE_SYMBOLS = ['health', 'hunger', 'thirst', 'toxicity', 'breath', 'dial'] as const;
export type GaugeArt = (typeof GAUGE_SYMBOLS)[number];

const ICON = 16;

/** Pixels within `r` of the segment (ax, ay)–(bx, by), with their place along it (0–1). */
function capsule(s: Sprite, ax: number, ay: number, bx: number, by: number, r: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d > r) continue;
      // Lit along the upper side of the capsule.
      const side = ((x - ax) * dy - (y - ay) * dx) / Math.sqrt(len2);
      const lower = t < 0.5;
      const lit = side < -r * 0.35;
      put(s, x, y, lower ? (lit ? 'redLight' : 'red') : lit ? 'bone' : 'boneShade');
    }
  }
}

function disc(s: Sprite, cx: number, cy: number, r: number, colour: UiColour, lit?: UiColour) {
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const highlight = lit && x - cx + (y - cy) < -r * 0.6;
      put(s, x, y, highlight ? lit : colour);
    }
  }
}

function box(s: Sprite, x0: number, y0: number, x1: number, y1: number, colour: UiColour) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(s, x, y, colour);
}

/** A gauge symbol drawn full. */
export function gaugeFull(kind: GaugeArt): Sprite {
  const s = sprite(ICON, ICON);
  if (kind === 'health') {
    // A medical capsule, red and bone, across the cell.
    capsule(s, 3.5, 11.5, 11.5, 3.5, 2.9);
  } else if (kind === 'hunger') {
    // A ration tin: its rim, its ochre body, a dark label band.
    box(s, 3, 5, 12, 13, 'tin');
    box(s, 3, 5, 5, 13, 'tinLight');
    box(s, 3, 8, 12, 10, 'plateDark');
    box(s, 2, 4, 13, 4, 'metal');
    box(s, 2, 14, 13, 14, 'metal');
  } else if (kind === 'thirst') {
    // A canteen: round body of water, a neck and its cap.
    disc(s, 7.5, 9.5, 5, 'water', 'waterLight');
    box(s, 6, 2, 9, 4, 'metal');
    box(s, 6, 1, 9, 1, 'chip');
  } else if (kind === 'toxicity') {
    // A cloud of spores.
    disc(s, 5.5, 9, 3.4, 'sporeDark', 'spore');
    disc(s, 10, 8, 3.6, 'sporeDark', 'spore');
    disc(s, 7.5, 5, 3.2, 'spore', 'mossBright');
    put(s, 7, 10, 'violet');
    put(s, 11, 6, 'violet');
  } else if (kind === 'breath') {
    // An air bubble: a teal ring, a highlight.
    for (let y = 0; y < ICON; y++)
      for (let x = 0; x < ICON; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d <= 5.5 && d > 4.2) put(s, x, y, 'water');
        else if (d <= 4.2) put(s, x, y, 'waterLight');
      }
    box(s, 5, 4, 6, 5, 'bone');
  } else {
    // The dial's face (its needle is the HUD's own): bone, with ticks round the top.
    disc(s, 7.5, 8.5, 6.4, 'boneShade', 'bone');
    for (const [x, y] of [
      [3, 6],
      [5, 4],
      [8, 3],
      [10, 4],
      [12, 6],
    ] as const)
      put(s, x, y, 'plateDark');
    put(s, 4, 9, 'water');
    put(s, 11, 9, 'red');
  }
  outline(s);
  return s;
}

/** A gauge symbol drawn empty: its shape in the dark plate, outlined. */
export function gaugeEmpty(kind: GaugeArt): Sprite {
  const full = gaugeFull(kind);
  const s = sprite(ICON, ICON);
  const [or, og, ob] = parseHex(UI.outline);
  for (let i = 0; i < full.pixels.length; i += 4) {
    if (full.pixels[i + 3] === 0) continue;
    const p = full.pixels;
    const edge = p[i] === or && p[i + 1] === og && p[i + 2] === ob;
    const [r, g, b] = parseHex(edge ? UI.outline : UI.plateDark);
    s.pixels[i] = r;
    s.pixels[i + 1] = g;
    s.pixels[i + 2] = b;
    s.pixels[i + 3] = 230;
  }
  return s;
}
