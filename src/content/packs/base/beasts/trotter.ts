import { type BeastPart, beast, legPair } from './build.ts';
import { band, coat, type Face, inEllipse, noise, plain, tone } from './paint.ts';

/*
 * The Trotter: a slender long-legged grazer, a tall neck with a short dark mane, a small head with
 * tall ears; a tan coat with a dark band along the flank, a pale belly, throat and rump, dark socks
 * over pale pasterns and black hooves.
 */

const [C, P, D, N, E] = [0, 1, 2, 3, 4]; // coat, pale, dark, nose, eye

const parts: BeastPart[] = [
  ...legPair(
    'F',
    { x: [-2.5, -0.5], y: [5, 10], z: [-5.5, -3.5], skin: 'thighF' },
    { x: [-2.25, -0.75], y: [0, 5.5], z: [-5.25, -3.75], skin: 'shin' },
  ),
  ...legPair(
    'B',
    { x: [-2.75, -0.25], y: [5, 11], z: [3, 5.5], skin: 'thighB' },
    { x: [-2.25, -0.75], y: [0, 5.5], z: [3.5, 5], skin: 'shin' },
  ),
  { name: 'body', from: [-3, 9, -7], to: [3, 15, 6], pivot: [0, 12, 0] },
  {
    name: 'neck',
    from: [-1.5, 13, -8.5],
    to: [1.5, 21, -5],
    pivot: [0, 14, -6.5],
    parent: 'body',
    rotation: [-25, 0, 0],
  },
  { name: 'mane', from: [-0.5, 14.5, -5], to: [0.5, 22, -4], pivot: [0, 14, -6.5], parent: 'neck' },
  {
    name: 'head',
    from: [-2.25, 20, -10],
    to: [2.25, 24.5, -5],
    pivot: [0, 21, -6.5],
    parent: 'neck',
    rotation: [15, 0, 0],
  },
  {
    name: 'muzzle',
    from: [-1.5, 20, -12.5],
    to: [1.5, 22.5, -10],
    pivot: [0, 21, -10],
    parent: 'head',
  },
  { name: 'jaw', from: [-1.25, 19, -12], to: [1.25, 20, -9], pivot: [0, 20, -9], parent: 'head' },
  {
    name: 'earL',
    from: [-3, 23.5, -6.5],
    to: [-2, 27.5, -5.5],
    pivot: [-2.5, 24, -6],
    parent: 'head',
    rotation: [0, 0, 20],
    skin: 'ear',
  },
  {
    name: 'earR',
    from: [2, 23.5, -6.5],
    to: [3, 27.5, -5.5],
    pivot: [2.5, 24, -6],
    parent: 'head',
    rotation: [0, 0, -20],
    skin: 'ear',
  },
  {
    name: 'tail',
    from: [-0.75, 11, 6],
    to: [0.75, 14.5, 7.5],
    pivot: [0, 14.5, 6.75],
    parent: 'body',
    rotation: [-25, 0, 0],
  },
  { name: 'tail2', from: [-1, 8.5, 6], to: [1, 11.5, 7.5], pivot: [0, 11.5, 6.75], parent: 'tail' },
];

function thigh(w: number, h: number): Face {
  return coat(w, h, C, { top: 0, bottom: 2, grain: 'fur', seed: 41 }).edges('lr');
}

function shin(w: number, h: number): Face {
  const f = coat(w, h, D, { top: 0, bottom: 0, grain: 'fur', seed: 42 });
  f.rect(0, h - 5, w, h - 3, tone(P, 4)).rect(0, h - 3, w, h, tone(E, 2));
  f.rect(0, h - 3, w, h - 2, tone(E, 3)).rect(0, h - 1, w, h, tone(E, 1));
  return f.edges('lr');
}

function bodySide(w: number, h: number): Face {
  const f = coat(w, h, C, { top: 2, bottom: 0, grain: 'fur', seed: 11 });
  band(f, D, 7, 9, 2, 12);
  band(f, P, 9, h, 4, 13);
  for (let x = 0; x < w; x++) f.set(x, 0, tone(D, noise(x, 0, 14) < 0.6 ? 2 : 3));
  // The shoulder's and the haunch's creases.
  for (let y = 2; y < 7; y++)
    f.shade(w - 7 + Math.floor(y / 3), y, -1).shade(6 - Math.floor(y / 3), y, -1);
  return f;
}

function bodyTop(w: number, h: number): Face {
  const f = coat(w, h, C, { base: 4, top: 0, bottom: 0, grain: 'fur', seed: 15 });
  for (let y = 0; y < h; y++)
    for (const x of [w / 2 - 1, w / 2]) f.set(x, y, tone(D, noise(x, y, 16) < 0.5 ? 2 : 3));
  return f.edges('lr');
}

function bodyFront(w: number, h: number): Face {
  return band(coat(w, h, C, { top: 2, bottom: 0, grain: 'fur', seed: 17 }), P, 5, h, 4, 18).edges(
    'lr',
  );
}

function bodyBack(w: number, h: number): Face {
  const f = coat(w, h, C, { bottom: 0, grain: 'fur', seed: 19 });
  // The pale rump patch around the tail.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (inEllipse(x, y, (w - 1) / 2, 4.5, w / 2, 5))
        f.set(x, y, tone(P, inEllipse(x, y, (w - 1) / 2, 4.5, w / 2.8, 3.5) ? 4 : 3));
  return band(f, P, 9, h, 3, 20).edges('lr');
}

function neckSide(w: number, h: number): Face {
  const f = coat(w, h, C, { top: 0, bottom: 0, grain: 'fur', seed: 22 });
  for (let y = 0; y < h; y++)
    f.set(w - 2, y, tone(P, 3))
      .set(w - 1, y, tone(P, 4))
      .set(0, y, tone(D, 2));
  return f;
}

function headSide(w: number, h: number): Face {
  const f = band(coat(w, h, C, { bottom: 0, grain: 'fur', seed: 26 }), P, h - 2, h, 4, 27);
  // The eye near the front, its lid above.
  const e = w - 4;
  return f.stamp(e, 2, [
    tone(D, 1) + tone(D, 1) + tone(D, 2),
    `${tone(E, 1)}W${tone(E, 2)}`,
    tone(E, 1) + tone(E, 1) + tone(C, 2),
  ]);
}

function headFront(w: number, h: number): Face {
  const f = coat(w, h, C, { bottom: 0, grain: 'fur', seed: 28 });
  f.rect(w / 2 - 1, 1, w / 2 + 1, h, tone(P, 4)).set(w / 2 - 1, 0, tone(P, 3));
  return f.edges('lr');
}

function headTop(w: number, h: number): Face {
  return coat(w, h, C, { base: 4, top: 0, bottom: 0, grain: 'fur', seed: 29 }).rect(
    w / 2 - 1,
    0,
    w / 2 + 1,
    4,
    tone(D, 2),
  );
}

function headBack(w: number, h: number): Face {
  return coat(w, h, C, { bottom: 0, grain: 'fur', seed: 30 }).rect(
    w / 2 - 1,
    0,
    w / 2 + 1,
    h,
    tone(D, 2),
  );
}

function muzzleSide(w: number, h: number): Face {
  const f = coat(w, h, P, { base: 4, grain: 'smooth', seed: 31 });
  for (let x = 1; x < w; x++) f.set(x, h - 1, tone(D, 2));
  return f.set(w - 1, 1, tone(N, 2));
}

function muzzleFront(w: number, h: number): Face {
  const f = coat(w, h, P, { base: 4, grain: 'smooth', seed: 32 });
  // Two dark nostrils over the mouth line.
  f.set(1, 1, tone(N, 1))
    .set(w - 2, 1, tone(N, 1))
    .set(1, 2, tone(N, 2))
    .set(w - 2, 2, tone(N, 2));
  for (let x = 0; x < w; x++) f.set(x, h - 1, tone(D, 2));
  return f;
}

function earSide(w: number, h: number): Face {
  return coat(w, h, C, { top: 0, bottom: 0, grain: 'fur', seed: 36 }).rect(0, 0, w, 2, tone(D, 2));
}

function earFront(w: number, h: number): Face {
  const f = coat(w, h, C, { top: 0, bottom: 0, grain: 'fur', seed: 37 });
  return f
    .rect(0, 2, w, h - 1, tone(N, 4))
    .set(0, 2, tone(N, 3))
    .rect(0, 0, w, 2, tone(D, 2));
}

function tuft(w: number, h: number): Face {
  return coat(w, h, P, { base: 4, top: 0, grain: 'fur', seed: 40 }).rect(
    0,
    h - 2,
    w,
    h,
    tone(D, 2),
  );
}

export const trotter = beast({
  name: 'trotter',
  gait: 'quadruped',
  stride: 2.2,
  mats: ['shrub', 'bone', 'hair', 'hide', 'coal'],
  parts,
  paint: {
    thighF: { side: thigh },
    thighB: { side: thigh },
    shin: { side: shin, top: plain(D, 2), bottom: plain(E, 1) },
    body: { side: bodySide, front: bodyFront, back: bodyBack, top: bodyTop, bottom: plain(P, 2) },
    neck: {
      side: neckSide,
      front: (w, h) =>
        coat(w, h, P, { base: 4, top: 0, bottom: 0, grain: 'fur', seed: 23 }).edges('lr'),
      back: (w, h) => coat(w, h, D, { base: 2, top: 0, bottom: 0, grain: 'fur', seed: 24 }),
      top: plain(C, 4),
      bottom: plain(P, 3),
    },
    mane: { side: (w, h) => coat(w, h, D, { base: 2, bottom: 0, grain: 'fur', seed: 25 }) },
    head: { side: headSide, front: headFront, back: headBack, top: headTop, bottom: plain(P, 3) },
    muzzle: {
      side: muzzleSide,
      front: muzzleFront,
      top: (w, h) => coat(w, h, P, { base: 4, top: 0, bottom: 0, grain: 'smooth', seed: 33 }),
      bottom: plain(P, 2),
    },
    jaw: {
      side: (w, h) => coat(w, h, P, { top: 0, grain: 'smooth', seed: 34 }),
      top: plain(N, 2),
      bottom: plain(P, 2),
    },
    ear: {
      side: earSide,
      front: earFront,
      back: earSide,
      top: plain(D, 2),
      bottom: plain(C, 2),
    },
    tail: { side: (w, h) => coat(w, h, C, { top: 0, bottom: 0, grain: 'fur', seed: 39 }) },
    tail2: { side: tuft, top: plain(C, 3), bottom: plain(D, 2) },
  },
});
