import { type BeastPart, beast, legPair } from './build.ts';
import { band, coat, type Face, noise, plain, tone } from './paint.ts';

/*
 * The Glimmerback: a slender grazer of the dark woods, a mossy coat strewn with spores that glow
 * teal, a ridge of glowing nodules down its back, a dark shaggy mane, drooping ears, pale antlers
 * whose forward tines glow at their tips, and a glowing tail tip.
 */

const [M, G, B, P, F] = [0, 1, 2, 3, 4]; // moss coat, glow, antler, peat (legs, nose), fern mane

const parts: BeastPart[] = [
  ...legPair(
    'F',
    { x: [-2.75, -0.75], y: [5, 9.5], z: [-6, -4], skin: 'thighF' },
    { x: [-2.5, -1], y: [0, 5.5], z: [-5.75, -4.25], skin: 'shin' },
  ),
  ...legPair(
    'B',
    { x: [-3, -0.5], y: [5, 10.5], z: [3, 5.5], skin: 'thighB' },
    { x: [-2.5, -1], y: [0, 5.5], z: [3.5, 5], skin: 'shin' },
  ),
  { name: 'body', from: [-3.5, 8.5, -7], to: [3.5, 14, 6.5], pivot: [0, 11, 0] },
  {
    name: 'nodes',
    from: [-2.5, 14, -5.5],
    to: [2.5, 15.5, 4.5],
    pivot: [0, 14, 0],
    parent: 'body',
  },
  {
    name: 'neck',
    from: [-1.5, 12.5, -9.5],
    to: [1.5, 19, -6],
    pivot: [0, 13.5, -7.5],
    parent: 'body',
    rotation: [-20, 0, 0],
  },
  {
    name: 'mane',
    from: [-1, 13.5, -6],
    to: [1, 19.5, -4.5],
    pivot: [0, 13.5, -7.5],
    parent: 'neck',
  },
  {
    name: 'head',
    from: [-2, 18, -11.5],
    to: [2, 21.5, -6.5],
    pivot: [0, 19, -7.5],
    parent: 'neck',
    rotation: [12, 0, 0],
  },
  {
    name: 'muzzle',
    from: [-1.25, 18, -13.5],
    to: [1.25, 20.5, -11.5],
    pivot: [0, 19, -11.5],
    parent: 'head',
  },
  { name: 'jaw', from: [-1, 17, -13], to: [1, 18, -9.5], pivot: [0, 18, -9.5], parent: 'head' },
  {
    name: 'earL',
    from: [-4.5, 19.5, -8.5],
    to: [-2, 20.5, -7.5],
    pivot: [-2, 20, -8],
    parent: 'head',
    rotation: [0, 0, 25],
    skin: 'ear',
  },
  {
    name: 'earR',
    from: [2, 19.5, -8.5],
    to: [4.5, 20.5, -7.5],
    pivot: [2, 20, -8],
    parent: 'head',
    rotation: [0, 0, -25],
    skin: 'ear',
  },
  {
    name: 'antlerL',
    from: [-2, 21, -8],
    to: [-1, 25, -7],
    pivot: [-1.5, 21, -7.5],
    parent: 'head',
    rotation: [0, 0, 20],
    skin: 'antler',
  },
  {
    name: 'antlerR',
    from: [1, 21, -8],
    to: [2, 25, -7],
    pivot: [1.5, 21, -7.5],
    parent: 'head',
    rotation: [0, 0, -20],
    skin: 'antler',
  },
  {
    name: 'tineL',
    from: [-2, 23, -10.5],
    to: [-1, 24, -8],
    pivot: [-1.5, 23.5, -8],
    parent: 'antlerL',
    rotation: [-20, 0, 0],
    skin: 'tine',
  },
  {
    name: 'tineR',
    from: [1, 23, -10.5],
    to: [2, 24, -8],
    pivot: [1.5, 23.5, -8],
    parent: 'antlerR',
    rotation: [-20, 0, 0],
    skin: 'tine',
  },
  {
    name: 'tail',
    from: [-1, 10.5, 6.5],
    to: [1, 14, 8.5],
    pivot: [0, 14, 7.5],
    parent: 'body',
    rotation: [-30, 0, 0],
  },
];

/** The mossy coat with spores: specks of glow among darker tufts. */
function mossy(w: number, h: number, seed: number, base = 3, spores = 0.05): Face {
  const f = coat(w, h, M, { base, grain: 'fur', seed });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (noise(x, y, seed + 70) < spores)
        f.set(x, y, tone(G, noise(x, y, seed + 71) < 0.5 ? 4 : 3));
  return f;
}

function bodySide(w: number, h: number): Face {
  const f = mossy(w, h, 11, 3, 0.04);
  band(f, P, h - 3, h, 3, 12);
  // A row of glowing spots along the flank.
  for (let x = 3; x < w - 2; x += 4)
    f.set(x, 3, tone(G, 4))
      .set(x + 1, 3, tone(G, 3))
      .set(x, 4, tone(G, 3));
  return f;
}

/** The nodules down the back: glowing knobs on the moss. */
function nodes(w: number, h: number): Face {
  const f = coat(w, h, F, { base: 2, top: 0, bottom: 0, grain: 'fur', seed: 13 });
  for (let y = 1; y < h; y += 3)
    for (let x = (y % 2) + 1; x < w - 1; x += 3)
      f.set(x, y, tone(G, 5))
        .set(x + 1, y, tone(G, 3))
        .set(x, y + 1, tone(G, 3));
  return f;
}

function nodesSide(w: number, h: number): Face {
  const f = coat(w, h, F, { base: 2, top: 0, bottom: 0, grain: 'fur', seed: 14 });
  for (let x = 1; x < w; x += 3) f.set(x, 0, tone(G, 4)).set(x + 1, 0, tone(G, 3));
  return f;
}

function shin(w: number, h: number): Face {
  const f = coat(w, h, P, { base: 3, top: 0, bottom: 0, grain: 'fur', seed: 15 });
  return f.rect(0, h - 2, w, h, tone(P, 1)).edges('lr');
}

function headSide(w: number, h: number): Face {
  const f = mossy(w, h, 16, 3, 0.03);
  // A large dark eye with a teal glint, near the front.
  return f.stamp(w - 4, 2, [tone(P, 1) + tone(P, 1), tone(P, 1) + tone(G, 4)]);
}

function muzzleFront(w: number, h: number): Face {
  const f = coat(w, h, P, { base: 3, grain: 'smooth', seed: 17 });
  return f
    .set(1, 1, tone(P, 1))
    .set(w - 2, 1, tone(P, 1))
    .rect(0, h - 1, w, h, tone(P, 1));
}

function antler(w: number, h: number): Face {
  return coat(w, h, B, { base: 4, top: 0, bottom: 0, grain: 'smooth', seed: 18 }).set(
    0,
    0,
    tone(G, 4),
  );
}

/** A tine: pale horn, its tip glowing. */
function tine(w: number, h: number): Face {
  return coat(w, h, B, { base: 4, top: 0, bottom: 0, grain: 'smooth', seed: 19 }).rect(
    0,
    0,
    2,
    h,
    tone(G, 5),
  );
}

export const glimmerback = beast({
  name: 'glimmerback',
  gait: 'quadruped',
  stride: 2.1,
  mats: ['moss', 'glow', 'bone', 'peat', 'fern'],
  glow: [G],
  parts,
  paint: {
    thighF: { side: (w, h) => mossy(w, h, 21).edges('lr') },
    thighB: { side: (w, h) => mossy(w, h, 22).edges('lr') },
    shin: { side: shin, top: plain(P, 3), bottom: plain(P, 1) },
    body: {
      side: bodySide,
      front: (w, h) => mossy(w, h, 23).edges('lr'),
      back: (w, h) => mossy(w, h, 24).edges('lr'),
      top: (w, h) => mossy(w, h, 25, 4, 0.08),
      bottom: plain(P, 2),
    },
    nodes: { side: nodesSide, top: nodes, front: nodesSide, back: nodesSide },
    neck: {
      side: (w, h) => mossy(w, h, 26),
      front: (w, h) => coat(w, h, M, { base: 4, grain: 'fur', seed: 27 }),
      back: plain(F, 2),
    },
    mane: { side: (w, h) => coat(w, h, F, { base: 2, grain: 'shag', seed: 28 }) },
    head: {
      side: headSide,
      front: (w, h) => mossy(w, h, 29).edges('lr'),
      top: (w, h) => mossy(w, h, 30, 4),
      bottom: plain(M, 2),
    },
    muzzle: {
      side: (w, h) => coat(w, h, P, { base: 3, grain: 'smooth', seed: 31 }),
      front: muzzleFront,
      top: plain(P, 4),
      bottom: plain(P, 2),
    },
    jaw: { side: plain(P, 3), top: plain(P, 1), bottom: plain(P, 2) },
    ear: { side: (w, h) => mossy(w, h, 32), front: plain(F, 3), bottom: plain(F, 3) },
    antler: { side: antler, top: plain(G, 5) },
    tine: { side: tine, front: plain(G, 5) },
    tail: {
      side: (w, h) => mossy(w, h, 33).rect(0, h - 3, w, h, tone(G, 4)),
      bottom: plain(G, 5),
    },
  },
});
