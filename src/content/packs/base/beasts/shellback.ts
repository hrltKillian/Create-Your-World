import { type BeastPart, beast, legPair } from './build.ts';
import { coat, Face, noise, plain, scutes, tone } from './paint.ts';

/*
 * The Shellback: an armoured rammer, a domed shell of ochre plates in two tiers over a pale belly,
 * a ridge of bone spikes, stubby clawed legs, a heavy brow plate over a hooked dark beak and a tail
 * ending in a spiked club; olive-grey scaly skin.
 */

const [H, S, O, D, B] = [0, 1, 2, 3, 4]; // shell, skin, ochre rims, dark beak and claws, bone

const parts: BeastPart[] = [
  ...legPair(
    'F',
    { x: [-6.5, -3], y: [2.5, 7], z: [-6.25, -2.75], skin: 'thigh' },
    { x: [-6.25, -3.25], y: [0, 3], z: [-6, -3], skin: 'foot' },
  ),
  ...legPair(
    'B',
    { x: [-6.5, -3], y: [2.5, 7], z: [2.75, 6.25], skin: 'thigh' },
    { x: [-6.25, -3.25], y: [0, 3], z: [3, 6], skin: 'foot' },
  ),
  { name: 'body', from: [-5, 3.5, -7], to: [5, 6.5, 7.5], pivot: [0, 5, 0] },
  { name: 'shell', from: [-7, 6, -9], to: [7, 12.5, 9], pivot: [0, 9, 0], parent: 'body' },
  { name: 'dome', from: [-5, 12.5, -6.5], to: [5, 16, 6.5], pivot: [0, 12.5, 0], parent: 'shell' },
  { name: 'ridge', from: [-0.75, 16, -5], to: [0.75, 17.5, 5], pivot: [0, 16, 0], parent: 'dome' },
  { name: 'head', from: [-3, 4, -13], to: [3, 9, -8.5], pivot: [0, 6.5, -8.5], parent: 'body' },
  { name: 'beak', from: [-2, 4, -15], to: [2, 7, -13], pivot: [0, 6.5, -8.5], parent: 'head' },
  { name: 'brow', from: [-4, 8, -14], to: [4, 11, -9.5], pivot: [0, 6.5, -8.5], parent: 'head' },
  {
    name: 'tail',
    from: [-1.25, 4, 7.5],
    to: [1.25, 6.5, 11.5],
    pivot: [0, 5.25, 7.5],
    parent: 'body',
  },
  {
    name: 'tail2',
    from: [-2, 3.5, 11.5],
    to: [2, 7, 14.5],
    pivot: [0, 5.25, 11.5],
    parent: 'tail',
  },
];

/** Shell plates: ochre in staggered rows, dark seams, a worn rim along the bottom. */
function shellSide(w: number, h: number, seed: number, rows = 6, cols = 8): Face {
  const f = scutes(new Face(w, h), H, rows, cols, seed);
  for (let x = 0; x < w; x++)
    f.set(x, h - 1, tone(O, noise(x, 1, seed) < 0.4 ? 2 : 3)).set(x, h - 2, tone(O, 4));
  return f;
}

/** The top of a shell tier: scutes, larger towards the middle. */
function shellTop(w: number, h: number, seed: number): Face {
  return scutes(new Face(w, h), H, 7, 9, seed);
}

function skin(w: number, h: number, seed: number): Face {
  return coat(w, h, S, { base: 3, top: 1, bottom: 1, grain: 'scale', seed });
}

function foot(w: number, h: number): Face {
  const f = skin(w, h, 31).edges('lr');
  for (let x = 0; x < w; x += 2) f.set(x, h - 1, tone(D, 2));
  return f;
}

function footFront(w: number, h: number): Face {
  const f = skin(w, h, 32);
  for (let x = 0; x < w; x += 2) f.set(x, h - 1, tone(D, 4)).set(x, h - 2, tone(D, 3));
  return f;
}

function headSide(w: number, h: number): Face {
  const f = skin(w, h, 33);
  // A small amber-dark eye under the brow, a fold of skin behind it.
  f.stamp(w - 4, 2, [tone(D, 1) + tone(O, 3), tone(D, 1) + tone(D, 1)]);
  for (let y = 1; y < h - 1; y++) f.shade(2, y, -1);
  return f;
}

/** The hooked beak: dark horn, lit along its ridge, its hook at the bottom of the front. */
function beak(w: number, h: number, seed: number): Face {
  const f = coat(w, h, D, { base: 3, top: 1, bottom: 1, grain: 'smooth', seed });
  return f;
}

function beakFront(w: number, h: number): Face {
  const f = beak(w, h, 34);
  f.rect(1, h - 2, w - 1, h, tone(D, 2))
    .set(w / 2 - 1, h - 1, tone(D, 4))
    .set(w / 2, h - 1, tone(D, 4));
  for (let x = 1; x < w - 1; x++) f.set(x, 2, tone(D, 1));
  return f;
}

/** The brow plate: a thick ochre shield, studded. */
function brow(w: number, h: number, seed: number): Face {
  const f = coat(w, h, H, { base: 3, top: 1, bottom: 1, grain: 'speckle', seed });
  for (let x = 1; x < w - 1; x += 4) f.set(x, 1, tone(B, 4)).set(x, 2, tone(B, 3));
  return f.edges('lrb');
}

/** The ridge: bone spikes on a dark root. */
function ridgeSide(w: number, h: number): Face {
  const f = new Face(w, h);
  for (let x = 0; x < w; x++) {
    const spike = x % 5 >= 1 && x % 5 <= 3;
    for (let y = 0; y < h; y++) {
      const top = x % 5 === 2 ? 0 : 1;
      f.set(x, y, spike && y >= top ? tone(B, y === top ? 5 : 4 - y) : tone(H, 1));
    }
  }
  return f;
}

/** The club: spiked bone knobs on shell. */
function club(w: number, h: number): Face {
  const f = scutes(new Face(w, h), H, 4, 5, 35);
  for (let x = 1; x < w; x += 3) f.set(x, 1, tone(B, 5)).set(x, 2, tone(B, 3));
  return f;
}

export const shellback = beast({
  name: 'shellback',
  gait: 'quadruped',
  stride: 2.6,
  mats: ['shell', 'silt', 'ochre', 'darkstone', 'bone'],
  parts,
  paint: {
    thigh: { side: (w, h) => skin(w, h, 11).edges('lr') },
    foot: { side: foot, front: footFront, top: plain(S, 3), bottom: plain(D, 1) },
    body: {
      side: (w, h) => skin(w, h, 12),
      top: plain(S, 2),
      bottom: (w, h) => {
        const f = coat(w, h, S, { base: 4, top: 0, bottom: 0, grain: 'scale', seed: 13 });
        for (let y = 3; y < h; y += 4) for (let x = 0; x < w; x++) f.set(x, y, tone(S, 2));
        return f;
      },
    },
    shell: {
      side: (w, h) => shellSide(w, h, 14),
      top: (w, h) => shellTop(w, h, 15),
      bottom: plain(H, 1),
    },
    dome: {
      side: (w, h) => shellSide(w, h, 16, 3, 5),
      top: (w, h) => shellTop(w, h, 17),
      bottom: plain(H, 1),
    },
    ridge: { side: ridgeSide, top: plain(B, 4), front: plain(B, 3), back: plain(B, 3) },
    head: {
      side: headSide,
      front: (w, h) => skin(w, h, 18).edges('lr'),
      top: plain(S, 3),
      bottom: plain(S, 2),
    },
    beak: {
      side: (w, h) => beak(w, h, 19),
      front: beakFront,
      top: plain(D, 4),
      bottom: plain(D, 2),
    },
    brow: {
      side: (w, h) => brow(w, h, 20),
      front: (w, h) => brow(w, h, 21),
      top: (w, h) => scutes(new Face(w, h), H, 5, 6, 22),
      bottom: plain(H, 1),
    },
    tail: { side: (w, h) => skin(w, h, 23) },
    tail2: { side: club, top: club, front: club, back: club },
  },
});
