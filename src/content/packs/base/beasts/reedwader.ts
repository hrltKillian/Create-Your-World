import { type BeastPart, beast, legPair } from './build.ts';
import { coat, type Face, noise, plain, tone } from './paint.ts';

/*
 * The Reedwader: a wading bird of the lakes on two long ochre legs, a round slate body under folded
 * wings with dark flight feathers, plumes for a tail, an S-shaped neck white at the throat, a head
 * with a teal crest and a red eye, and a long dagger beak that opens.
 */

const [H, W, A, K, T] = [0, 1, 2, 3, 4]; // slate feathers, white, ochre legs and bill, coal, teal

const parts: BeastPart[] = [
  ...legPair(
    '',
    { x: [-2.25, -0.75], y: [9, 13], z: [-1, 1], skin: 'thigh' },
    { x: [-2, -1], y: [0, 9.5], z: [-0.5, 0.5], skin: 'shank' },
  ),
  {
    name: 'toesL',
    from: [-2.5, 0, -2],
    to: [-0.5, 0.5, 1],
    pivot: [-1.5, 0.5, 0],
    parent: 'shinL',
    skin: 'toes',
  },
  {
    name: 'toesR',
    from: [0.5, 0, -2],
    to: [2.5, 0.5, 1],
    pivot: [1.5, 0.5, 0],
    parent: 'shinR',
    skin: 'toes',
  },
  { name: 'body', from: [-3.5, 11, -4.5], to: [3.5, 17.5, 5.5], pivot: [0, 14, 0] },
  {
    name: 'wingL',
    from: [-4, 12, -3.5],
    to: [-3.5, 17, 6.5],
    pivot: [-3.75, 16.5, -3],
    parent: 'body',
    skin: 'wing',
  },
  {
    name: 'wingR',
    from: [3.5, 12, -3.5],
    to: [4, 17, 6.5],
    pivot: [3.75, 16.5, -3],
    parent: 'body',
    skin: 'wing',
  },
  {
    name: 'tail',
    from: [-2.5, 12.5, 5.5],
    to: [2.5, 14.5, 9.5],
    pivot: [0, 14, 5.5],
    parent: 'body',
    rotation: [15, 0, 0],
  },
  {
    name: 'neck',
    from: [-1, 16, -5],
    to: [1, 21, -3],
    pivot: [0, 16.5, -4],
    parent: 'body',
    rotation: [-20, 0, 0],
  },
  {
    name: 'neck2',
    from: [-1, 20.5, -5],
    to: [1, 25.5, -3],
    pivot: [0, 21, -4],
    parent: 'neck',
    rotation: [35, 0, 0],
  },
  {
    name: 'head',
    from: [-1.5, 25, -6],
    to: [1.5, 28, -2.5],
    pivot: [0, 25.5, -4],
    parent: 'neck2',
    rotation: [-15, 0, 0],
  },
  { name: 'crest', from: [-0.5, 27.5, -3], to: [0.5, 29, 1], pivot: [0, 28, -3], parent: 'head' },
  { name: 'beak', from: [-0.5, 26, -12], to: [0.5, 27, -6], pivot: [0, 26.5, -6], parent: 'head' },
  { name: 'jaw', from: [-0.5, 25.5, -11], to: [0.5, 26, -6], pivot: [0, 26, -6], parent: 'head' },
];

/** Feathers in overlapping rows, lit at their edges. */
function feathers(w: number, h: number, seed: number, base = 3): Face {
  return coat(w, h, H, { base, top: 1, bottom: 1, grain: 'feather', seed });
}

/** A folded wing: slate coverts over dark flight feathers at its back end. */
function wingSide(w: number, h: number): Face {
  const f = feathers(w, h, 11, 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < Math.min(w, 7 + (y >> 1)); x++) f.set(x, y, tone(K, x % 2 ? 2 : 3));
  for (let x = 0; x < w; x++) f.set(x, 0, tone(H, 4));
  return f;
}

/** The neck: slate with a white throat at the front, a dark stripe down the back. */
function neckSide(w: number, h: number): Face {
  const f = feathers(w, h, 12, 3);
  for (let y = 0; y < h; y++) f.set(w - 1, y, tone(W, 4)).set(0, y, tone(K, 3));
  return f;
}

function headSide(w: number, h: number): Face {
  const f = feathers(w, h, 13, 3);
  f.rect(w - 3, h - 2, w, h, tone(W, 4));
  // A red eye ringed in teal near the front.
  return f.stamp(w - 3, 1, [tone(T, 3) + tone(T, 4), tone(K, 1) + `W`]);
}

function crestSide(w: number, h: number): Face {
  const f = coat(w, h, T, { base: 3, top: 1, bottom: 0, grain: 'feather', seed: 14 });
  for (let x = 0; x < w; x++) if (noise(x, 0, 15) < 0.4) f.set(x, 0, tone(T, 5));
  return f;
}

function bill(w: number, h: number): Face {
  const f = coat(w, h, A, { base: 2, top: 1, bottom: 0, grain: 'smooth', seed: 16 });
  return f.rect(0, 0, 3, h, tone(K, 2));
}

function shank(w: number, h: number): Face {
  const f = coat(w, h, A, { base: 3, top: 0, bottom: 0, grain: 'scale', seed: 17 });
  return f.rect(0, h - 4, w, h - 3, tone(A, 2)).edges('l');
}

function bodySide(w: number, h: number): Face {
  const f = feathers(w, h, 18, 3);
  // The white breast at the front, under the wing.
  for (let y = 3; y < h; y++)
    for (let x = w - 4 + (y < 6 ? 2 : 0); x < w; x++) f.set(x, y, tone(W, y === h - 1 ? 3 : 4));
  return f;
}

export const reedwader = beast({
  name: 'reedwader',
  gait: 'biped',
  stride: 1.8,
  mats: ['hull', 'cloth', 'amber', 'coal', 'teal'],
  parts,
  paint: {
    thigh: { side: (w, h) => feathers(w, h, 21, 3).edges('lr') },
    shank: { side: shank, top: plain(A, 3), bottom: plain(A, 2) },
    toes: {
      side: plain(A, 3),
      top: (w, h) => coat(w, h, A, { base: 3, top: 0, bottom: 0, grain: 'scale', seed: 22 }),
    },
    body: {
      side: bodySide,
      front: (w, h) => coat(w, h, W, { base: 4, top: 1, bottom: 1, grain: 'feather', seed: 23 }),
      back: (w, h) => feathers(w, h, 24, 2),
      top: (w, h) => feathers(w, h, 25, 4),
      bottom: plain(W, 3),
    },
    wing: {
      side: wingSide,
      top: plain(H, 4),
      front: plain(H, 3),
      back: plain(K, 2),
      bottom: plain(H, 2),
    },
    tail: {
      side: (w, h) => coat(w, h, K, { base: 2, top: 1, bottom: 0, grain: 'feather', seed: 26 }),
      top: (w, h) => coat(w, h, H, { base: 2, grain: 'feather', seed: 27 }),
    },
    neck: { side: neckSide, front: plain(W, 4), back: plain(K, 3), top: plain(H, 4) },
    neck2: { side: neckSide, front: plain(W, 4), back: plain(K, 3), top: plain(H, 4) },
    head: {
      side: headSide,
      front: (w, h) => feathers(w, h, 28).rect(0, h - 2, w, h, tone(W, 4)),
      top: plain(H, 4),
      bottom: plain(W, 3),
    },
    crest: { side: crestSide, top: plain(T, 4), front: plain(T, 3), back: plain(T, 5) },
    beak: {
      side: bill,
      top: plain(A, 3),
      front: plain(K, 2),
      back: plain(A, 2),
      bottom: plain(A, 1),
    },
    jaw: {
      side: bill,
      top: plain(K, 1),
      front: plain(K, 2),
      back: plain(A, 2),
      bottom: plain(A, 2),
    },
  },
});
