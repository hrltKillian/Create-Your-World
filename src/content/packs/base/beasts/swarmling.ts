import { type BeastPart, beast } from './build.ts';
import { coat, type Face, noise, plain, tone } from './paint.ts';

/*
 * The Swarmling: a small six-legged mite, dark green chitin in glossy plates, a swollen gland sac
 * on its back veined and bubbling toxic yellow-green, a cluster of red eyes, pale mandibles that
 * part sideways and two feelers; its legs bend at the knee, out from the body then down.
 */

const [S, X, B, E, K] = [0, 1, 2, 3, 4]; // shell, toxin, bone, eyes, coal

/** A leg of a row at depth z on each side: the thigh out from the body, the shin down. */
function legs(row: string, z: number): BeastPart[] {
  const out: BeastPart[] = [];
  for (const [side, x] of [
    ['L', -1],
    ['R', 1],
  ] as const) {
    const span = (a: number, b: number): [number, number] => (x < 0 ? [-b, -a] : [a, b]);
    out.push(
      {
        name: `leg${row}${side}`,
        from: [span(2.5, 5)[0], 3.5, z - 0.5],
        to: [span(2.5, 5)[1], 4.5, z + 0.5],
        pivot: [x * 3.75, 4.5, z],
        skin: 'thigh',
      },
      {
        name: `shin${row}${side}`,
        from: [span(4.25, 5.25)[0], 0, z - 0.5],
        to: [span(4.25, 5.25)[1], 4.5, z + 0.5],
        pivot: [x * 4.75, 4.5, z],
        parent: `leg${row}${side}`,
        skin: 'shin',
      },
    );
  }
  return out;
}

const parts: BeastPart[] = [
  ...legs('F', -2),
  ...legs('M', 0),
  ...legs('B', 2),
  { name: 'body', from: [-2.5, 2.5, -3], to: [2.5, 5.5, 2], pivot: [0, 4, 0] },
  { name: 'sac', from: [-3, 3, 1.5], to: [3, 6.5, 7], pivot: [0, 4, 1.5], parent: 'body' },
  { name: 'dome', from: [-2, 6.5, 2.5], to: [2, 7.5, 6], pivot: [0, 4, 1.5], parent: 'sac' },
  { name: 'head', from: [-2, 2.5, -6], to: [2, 5.5, -3], pivot: [0, 4, -3], parent: 'body' },
  {
    name: 'mandL',
    from: [-2, 2.5, -8],
    to: [-0.5, 3.5, -5.5],
    pivot: [-1.25, 3, -6],
    parent: 'head',
    skin: 'mand',
  },
  {
    name: 'mandR',
    from: [0.5, 2.5, -8],
    to: [2, 3.5, -5.5],
    pivot: [1.25, 3, -6],
    parent: 'head',
    skin: 'mand',
  },
  {
    name: 'antL',
    from: [-1.5, 5, -5],
    to: [-1, 9, -4.5],
    pivot: [-1.25, 5, -4.75],
    parent: 'head',
    rotation: [-35, 0, 15],
    skin: 'feeler',
  },
  {
    name: 'antR',
    from: [1, 5, -5],
    to: [1.5, 9, -4.5],
    pivot: [1.25, 5, -4.75],
    parent: 'head',
    rotation: [-35, 0, -15],
    skin: 'feeler',
  },
];

/** Glossy chitin: dark plates, a lit rim along each top. */
function chitin(w: number, h: number, seed: number): Face {
  const f = coat(w, h, S, { base: 2, top: 1, bottom: 1, grain: 'smooth', seed });
  for (let x = 0; x < w; x++) if (noise(x, 0, seed + 3) < 0.25) f.set(x, 0, tone(S, 5));
  return f;
}

/** The gland sac: bubbling toxin under dark veins, rings of chitin across it. */
function gland(w: number, h: number, seed: number): Face {
  const f = coat(w, h, X, { base: 3, top: 1, bottom: 1, grain: 'speckle', seed });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const vein = (x + Math.floor(noise(Math.floor(y / 3), 0, seed) * 4)) % 5 === 0;
      if (vein && noise(x, y, seed + 9) < 0.7) f.set(x, y, tone(X, 1));
      else if (noise(x, y, seed + 11) < 0.06) f.set(x, y, tone(X, 5));
    }
  }
  return f;
}

function sacTop(w: number, h: number): Face {
  const f = gland(w, h, 21);
  for (let y = 2; y < h; y += 4) for (let x = 0; x < w; x++) f.set(x, y, tone(S, y === 2 ? 3 : 2));
  return f;
}

function sacSide(w: number, h: number): Face {
  const f = gland(w, h, 22);
  for (let x = 2; x < w; x += 4) for (let y = 0; y < 3; y++) f.set(x, y, tone(S, 2));
  return f;
}

/** The face: a cluster of red eyes over the mouth. */
function headFront(w: number, h: number): Face {
  const f = chitin(w, h, 23).edges('lr');
  const eye = [`${tone(E, 4)}W`, tone(E, 2) + tone(E, 3)];
  f.stamp(1, 1, eye).stamp(w - 3, 1, eye);
  f.set(3, 1, tone(E, 3))
    .set(w - 4, 1, tone(E, 3))
    .set(3, 2, tone(E, 2))
    .set(w - 4, 2, tone(E, 2));
  for (let x = 2; x < w - 2; x++) f.set(x, h - 1, tone(K, 1));
  return f;
}

function headSide(w: number, h: number): Face {
  return chitin(w, h, 24).stamp(w - 2, 1, [tone(E, 3) + tone(E, 4)]);
}

function mandible(w: number, h: number): Face {
  const f = coat(w, h, B, { base: 4, top: 1, bottom: 1, grain: 'smooth', seed: 25 });
  return f.set(w - 1, 0, tone(B, 2)).set(w - 1, h - 1, tone(K, 2));
}

function shin(w: number, h: number): Face {
  const f = chitin(w, h, 26);
  return f.rect(0, h - 2, w, h, tone(B, 3)).set(0, h - 1, tone(B, 2));
}

export const swarmling = beast({
  name: 'swarmling',
  gait: 'hexapod',
  stride: 4.4,
  mats: ['fern', 'toxic', 'bone', 'red', 'coal'],
  parts,
  paint: {
    thigh: { side: (w, h) => chitin(w, h, 27) },
    shin: { side: shin, top: plain(S, 3), bottom: plain(B, 2) },
    body: {
      side: (w, h) => chitin(w, h, 28),
      top: (w, h) => {
        const f = chitin(w, h, 29);
        for (let y = 3; y < h; y += 4) for (let x = 0; x < w; x++) f.set(x, y, tone(S, 1));
        return f;
      },
      bottom: plain(S, 1),
    },
    sac: {
      side: sacSide,
      top: sacTop,
      front: plain(S, 2),
      back: (w, h) => gland(w, h, 30),
      bottom: plain(X, 2),
    },
    dome: { side: (w, h) => gland(w, h, 32), top: (w, h) => gland(w, h, 33) },
    head: {
      side: headSide,
      front: headFront,
      top: (w, h) => chitin(w, h, 31),
      bottom: plain(S, 1),
    },
    mand: { side: mandible, front: mandible, top: plain(B, 4), bottom: plain(B, 2) },
    feeler: { side: plain(S, 2), top: plain(S, 4) },
  },
});
