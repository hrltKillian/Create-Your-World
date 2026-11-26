import {
  type Gait,
  type ModelDef,
  type ModelPart,
  SKIN_SIZE,
  SKIN_TEXELS,
  type SkinDef,
  skinFaces,
} from '../../../schema.ts';
import { type Mat, skinArt } from '../palette.ts';
import { Face } from './paint.ts';

type Vec = readonly [number, number, number];

/** A box of a creature (ModelPart without its `uv`, which the atlas gives it). */
export interface BeastPart {
  readonly name: string;
  readonly from: Vec;
  readonly to: Vec;
  readonly pivot: Vec;
  readonly parent?: string;
  readonly rotation?: Vec;
  readonly emissive?: true;
  /** Parts of one `skin` (by default their name) share a place in the atlas: same size. */
  readonly skin?: string;
}

/** A leg's segment on the left (−x): its spans on each axis; its pivot is at its top. */
export interface Segment {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z: readonly [number, number];
  readonly skin: string;
}

/**
 * A pair of legs of a row (F, M, B, or '' for a biped): the upper segments `leg<row><side>` swing
 * from their hips, the lower ones `shin<row><side>` from their knees down to the ground; the right
 * leg is the left one mirrored. Returns the upper segments, then the lower ones.
 */
export function legPair(row: string, upper: Segment, lower: Segment): BeastPart[] {
  const segment = (name: string, s: Segment, side: number, parent?: string): BeastPart => {
    const [x0, x1] = side < 0 ? s.x : ([-s.x[1], -s.x[0]] as const);
    return {
      name,
      from: [x0, s.y[0], s.z[0]],
      to: [x1, s.y[1], s.z[1]],
      pivot: [(x0 + x1) / 2, s.y[1], (s.z[0] + s.z[1]) / 2],
      skin: s.skin,
      ...(parent ? { parent } : {}),
    };
  };
  return [
    segment(`leg${row}L`, upper, -1),
    segment(`leg${row}R`, upper, 1),
    segment(`shin${row}L`, lower, -1, `leg${row}L`),
    segment(`shin${row}R`, lower, 1, `leg${row}R`),
  ];
}

/** Parts with their parents first (a model needs a parent before its children). */
export function parentsFirst(parts: readonly BeastPart[]): BeastPart[] {
  const out: BeastPart[] = [];
  const pending = [...parts];
  while (pending.length > 0) {
    const i = pending.findIndex((p) => !p.parent || out.some((q) => q.name === p.parent));
    if (i < 0) throw new Error(`no parent for ${pending[0]!.name}`);
    out.push(pending.splice(i, 1)[0]!);
  }
  return out;
}

/** Paints a face `w` × `h` texels. */
export type Painter = (w: number, h: number) => Face;

/**
 * How a box is painted: `side` paints its right side (+x) seen from outside, the front on its
 * right, and its mirror is the left side; the other faces take `side` unless named (the front
 * with the model's right on the left, the top with the front at its bottom).
 */
export interface BoxPaint {
  readonly side: Painter;
  readonly front?: Painter;
  readonly back?: Painter;
  readonly top?: Painter;
  readonly bottom?: Painter;
}

export interface BeastDef {
  /** `model:<name>` and `skin:<name>`. */
  readonly name: string;
  readonly gait: Gait;
  readonly stride: number;
  /** The materials of its letters (palette.ts LETTERS), and those that glow. */
  readonly mats: readonly Mat[];
  readonly glow?: readonly number[];
  readonly parts: readonly BeastPart[];
  /** The painters of each skin (a part's `skin` or name). */
  readonly paint: Readonly<Record<string, BoxPaint>>;
}

/** A part's box in texels: width (x), height (y), depth (z). */
function texels(part: BeastPart): [number, number, number] {
  const size = (axis: number) => Math.round((part.to[axis]! - part.from[axis]!) * SKIN_TEXELS);
  return [size(0), size(1), size(2)];
}

/** A box's faces painted and unfolded the reference game's way (skinFaces). */
function unfold(name: string, paint: BoxPaint, w: number, h: number, d: number): Face {
  const right = paint.side(d, h);
  const faces: Record<string, Face> = {
    top: (paint.top ?? paint.side)(w, d),
    bottom: (paint.bottom ?? paint.side)(w, d),
    right,
    front: (paint.front ?? paint.side)(w, h),
    left: right.flip(),
    back: (paint.back ?? paint.side)(w, h),
  };
  const out = new Face(2 * d + 2 * w, d + h);
  for (const [face, [u, v, fw, fh]] of Object.entries(skinFaces(w, h, d))) {
    const img = faces[face]!;
    if (img.w !== fw || img.h !== fh) throw new Error(`${name} ${face}: painted ${img.w}×${img.h}`);
    for (let y = 0; y < fh!; y++)
      for (let x = 0; x < fw!; x++) out.set(u! + x, v! + y, img.get(x, y));
  }
  return out;
}

/**
 * Packs the unfolded boxes into one atlas, the tallest first, each where it rests lowest on the
 * skyline of those before it. Returns each one's place and the atlas rows.
 */
function pack(name: string, boxes: Map<string, Face>): [Map<string, [number, number]>, string[]] {
  const skyline = new Array<number>(SKIN_SIZE).fill(0);
  const atlas = new Face(SKIN_SIZE, SKIN_SIZE);
  const places = new Map<string, [number, number]>();
  const order = [...boxes.keys()].sort((a, b) => {
    const fa = boxes.get(a)!;
    const fb = boxes.get(b)!;
    return fb.h - fa.h || fb.w - fa.w || (a < b ? -1 : 1);
  });
  for (const key of order) {
    const img = boxes.get(key)!;
    let best: [number, number] | null = null;
    for (let x = 0; x + img.w <= SKIN_SIZE; x++) {
      const y = Math.max(...skyline.slice(x, x + img.w));
      if (!best || y < best[1]) best = [x, y];
    }
    if (!best || best[1] + img.h > SKIN_SIZE)
      throw new Error(`${name}: the atlas is full at ${key}`);
    const [x, y] = best;
    for (let i = x; i < x + img.w; i++) skyline[i] = y + img.h;
    for (let ty = 0; ty < img.h; ty++)
      for (let tx = 0; tx < img.w; tx++) atlas.set(x + tx, y + ty, img.get(tx, ty));
    places.set(key, best);
  }
  const rows: string[] = [];
  for (let y = 0; y < SKIN_SIZE; y++) {
    let row = '';
    for (let x = 0; x < SKIN_SIZE; x++) row += atlas.get(x, y);
    rows.push(row.replace(/\.+$/, ''));
  }
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return [places, rows];
}

/** A creature's box model and its skin atlas, painted and packed (plan v5 « M52 »). */
export function beast(def: BeastDef): { model: ModelDef; skin: SkinDef } {
  const boxes = new Map<string, Face>();
  for (const part of def.parts) {
    const key = part.skin ?? part.name;
    if (boxes.has(key)) continue;
    const paint = def.paint[key];
    if (!paint) throw new Error(`${def.name}: no paint for ${key}`);
    boxes.set(key, unfold(`${def.name} ${key}`, paint, ...texels(part)));
  }
  const [places, rows] = pack(def.name, boxes);
  const parts = parentsFirst(def.parts).map((part): ModelPart => {
    const { skin, ...box } = part;
    return { ...box, uv: places.get(skin ?? part.name)! };
  });
  return {
    model: {
      key: `model:${def.name}`,
      gait: def.gait,
      stride: def.stride,
      skin: `skin:${def.name}`,
      parts,
    },
    skin: skinArt(`skin:${def.name}`, def.mats, rows.join('\n'), def.glow),
  };
}
