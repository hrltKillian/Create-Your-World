import { type BeastPart, beast, legPair } from './build.ts';
import { coat, type Face, noise, plain, tone } from './paint.ts';

/*
 * The Shagback: a six-legged herd beast, a barrel body under long dark locks that hang over its
 * legs, a grey-fringed hump at the shoulders, a low broad head with a beard, a fringe over small
 * eyes, a bare dark nose and horns that sweep out, up and forward; a tufted tail.
 */

const [S, F, B, P, K] = [0, 1, 2, 3, 4]; // shag, pale fur, horn, bare face, coal

const thigh = { x: [-6, -3], y: [4, 10], skin: 'thigh' } as const;
const shin = { x: [-5.75, -3.25], y: [0, 4.5], skin: 'shin' } as const;
const row = (name: string, z: number) =>
  legPair(name, { ...thigh, z: [z - 1.5, z + 1.5] }, { ...shin, z: [z - 1.25, z + 1.25] });

const parts: BeastPart[] = [
  ...row('F', -7),
  ...row('M', 0),
  ...row('B', 7),
  { name: 'body', from: [-6.5, 7, -10], to: [6.5, 19, 1], pivot: [0, 13, 0] },
  { name: 'rump', from: [-6, 7.5, 1], to: [6, 18, 10], pivot: [0, 13, 0], parent: 'body' },
  { name: 'hump', from: [-5, 19, -9], to: [5, 23, -1], pivot: [0, 19, -5], parent: 'body' },
  { name: 'head', from: [-3.5, 8, -15], to: [3.5, 15, -9], pivot: [0, 13, -10], parent: 'body' },
  { name: 'nose', from: [-2.5, 8, -17], to: [2.5, 11.5, -15], pivot: [0, 13, -10], parent: 'head' },
  { name: 'beard', from: [-2.5, 5, -15], to: [2.5, 8, -11], pivot: [0, 8, -13], parent: 'head' },
  {
    name: 'fringe',
    from: [-3.75, 12.5, -15.5],
    to: [3.75, 15.5, -11],
    pivot: [0, 13, -10],
    parent: 'head',
  },
  {
    name: 'hornL',
    from: [-7, 13, -13.5],
    to: [-3.5, 15, -11.5],
    pivot: [-3.5, 14, -12.5],
    parent: 'head',
    skin: 'horn',
  },
  {
    name: 'hornR',
    from: [3.5, 13, -13.5],
    to: [7, 15, -11.5],
    pivot: [3.5, 14, -12.5],
    parent: 'head',
    skin: 'horn',
  },
  {
    name: 'hornL2',
    from: [-8.5, 13.5, -13.5],
    to: [-6.5, 18, -11.5],
    pivot: [-7.5, 14, -12.5],
    parent: 'hornL',
    skin: 'horn2',
  },
  {
    name: 'hornR2',
    from: [6.5, 13.5, -13.5],
    to: [8.5, 18, -11.5],
    pivot: [7.5, 14, -12.5],
    parent: 'hornR',
    skin: 'horn2',
  },
  {
    name: 'hornL3',
    from: [-8.25, 16.5, -16],
    to: [-6.75, 18, -13.5],
    pivot: [-7.5, 17, -13.5],
    parent: 'hornL2',
    skin: 'horn3',
  },
  {
    name: 'hornR3',
    from: [6.75, 16.5, -16],
    to: [8.25, 18, -13.5],
    pivot: [7.5, 17, -13.5],
    parent: 'hornR2',
    skin: 'horn3',
  },
  {
    name: 'tail',
    from: [-1.5, 14, 10],
    to: [1.5, 17, 12],
    pivot: [0, 16.5, 10],
    parent: 'rump',
    rotation: [-30, 0, 0],
  },
  {
    name: 'tail2',
    from: [-1.75, 10.5, 10],
    to: [1.75, 14.5, 12.5],
    pivot: [0, 14.5, 11],
    parent: 'tail',
  },
];

/** Long locks: shaggy down to a ragged dark fringe along the bottom. */
function shag(w: number, h: number, seed: number, base = 3): Face {
  const f = coat(w, h, S, { base, top: 1, bottom: 0, grain: 'shag', seed });
  for (let x = 0; x < w; x++) {
    const ends = 1 + Math.floor(noise(x, 0, seed + 4) * 3);
    for (let y = h - ends; y < h; y++) f.set(x, y, tone(S, y === h - 1 ? 1 : 2));
  }
  return f;
}

/** The hump: pale grey-fringed fur over the shag. */
function hump(w: number, h: number): Face {
  const f = coat(w, h, F, { base: 3, top: 1, bottom: 0, grain: 'shag', seed: 21 });
  for (let x = 0; x < w; x++) if (noise(x, 1, 22) < 0.5) f.set(x, h - 1, tone(S, 3));
  return f;
}

function hoofShin(w: number, h: number): Face {
  const f = coat(w, h, S, { base: 2, top: 0, bottom: 0, grain: 'shag', seed: 23 });
  return f
    .rect(0, h - 3, w, h, tone(K, 2))
    .rect(0, h - 3, w, h - 2, tone(K, 3))
    .edges('lr');
}

/** The face's side: a small eye under the fringe, the bare cheek. */
function headSide(w: number, h: number): Face {
  const f = coat(w, h, P, { base: 2, top: 0, bottom: 0, grain: 'speckle', seed: 24 });
  f.rect(0, 0, 4, h, tone(S, 3));
  return f.stamp(w - 4, 6, [tone(K, 1) + tone(K, 1), `${tone(K, 1)}W`]);
}

function headFront(w: number, h: number): Face {
  return coat(w, h, P, { base: 2, top: 0, bottom: 0, grain: 'speckle', seed: 25 }).edges('lr');
}

/** The nose: bare and dark, two wide nostrils. */
function noseFront(w: number, h: number): Face {
  const f = coat(w, h, P, { base: 2, top: 1, bottom: 1, grain: 'smooth', seed: 26 });
  f.rect(1, 2, 3, 4, tone(K, 1)).rect(w - 3, 2, w - 1, 4, tone(K, 1));
  for (let x = 1; x < w - 1; x++) f.set(x, h - 1, tone(K, 2));
  return f;
}

function horn(w: number, h: number, seed: number): Face {
  const f = coat(w, h, B, { base: 4, top: 1, bottom: 1, grain: 'smooth', seed });
  for (let x = 0; x < w; x++) if (x % 3 === 1) for (let y = 0; y < h; y++) f.shade(x, y, -1);
  return f;
}

/** The tail's tuft: pale locks with dark ends. */
function tuft(w: number, h: number): Face {
  return coat(w, h, F, { base: 3, top: 0, grain: 'shag', seed: 27 }).rect(
    0,
    h - 2,
    w,
    h,
    tone(S, 2),
  );
}

export const shagback = beast({
  name: 'shagback',
  gait: 'hexapod',
  stride: 1.6,
  mats: ['thorn', 'fur', 'bone', 'peat', 'coal'],
  parts,
  paint: {
    thigh: { side: (w, h) => shag(w, h, 11, 2) },
    shin: { side: hoofShin, top: plain(S, 2), bottom: plain(K, 1) },
    body: {
      side: (w, h) => shag(w, h, 12),
      front: (w, h) => shag(w, h, 13, 2),
      back: plain(S, 2),
      top: (w, h) => coat(w, h, S, { base: 4, top: 0, bottom: 0, grain: 'shag', seed: 14 }),
      bottom: plain(S, 1),
    },
    rump: {
      side: (w, h) => shag(w, h, 15),
      back: (w, h) => shag(w, h, 16),
      top: (w, h) => coat(w, h, S, { base: 4, top: 0, bottom: 0, grain: 'shag', seed: 17 }),
      bottom: plain(S, 1),
    },
    hump: {
      side: hump,
      top: (w, h) => coat(w, h, F, { base: 4, top: 0, bottom: 0, grain: 'shag', seed: 18 }),
      bottom: plain(S, 2),
    },
    head: {
      side: headSide,
      front: headFront,
      top: (w, h) => shag(w, h, 19),
      back: plain(S, 2),
      bottom: plain(P, 1),
    },
    nose: {
      side: (w, h) => coat(w, h, P, { base: 2, grain: 'smooth', seed: 20 }),
      front: noseFront,
      top: plain(P, 3),
      bottom: plain(P, 1),
    },
    beard: { side: (w, h) => shag(w, h, 28, 2), top: plain(S, 2) },
    fringe: {
      side: (w, h) => shag(w, h, 29),
      front: (w, h) => shag(w, h, 30),
      top: (w, h) => shag(w, h, 31, 4),
    },
    horn: { side: (w, h) => horn(w, h, 32) },
    horn2: { side: (w, h) => horn(w, h, 33) },
    horn3: { side: (w, h) => horn(w, h, 34), front: plain(B, 5), top: plain(B, 5) },
    tail: { side: (w, h) => shag(w, h, 35, 2) },
    tail2: { side: tuft, top: plain(F, 3), bottom: plain(S, 2) },
  },
});
