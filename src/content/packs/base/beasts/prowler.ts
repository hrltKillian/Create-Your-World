import { type BeastPart, beast, legPair } from './build.ts';
import { coat, Face, noise, plain, tone } from './paint.ts';

/*
 * The Prowler: low and four-legged, a long body under a crest of spines, broad shoulders, a flat
 * wedge head with a jaw full of fangs that opens on the wind-up, amber eyes that glow in the dark,
 * fins swept back and a whip tail in three segments; a dusk-grey hide barred with rust.
 */

const [H, R, A, B, K] = [0, 1, 2, 3, 4]; // hide, rust, amber (glows), bone, coal

const parts: BeastPart[] = [
  ...legPair(
    'F',
    { x: [-3.25, -1.25], y: [2.5, 7], z: [-7.5, -5.5], skin: 'thighF' },
    { x: [-3, -1.5], y: [0, 3], z: [-7.25, -5.75], skin: 'paw' },
  ),
  ...legPair(
    'B',
    { x: [-3.5, -1], y: [3, 8.5], z: [3.5, 6.5], skin: 'thighB' },
    { x: [-3, -1.5], y: [0, 3.5], z: [4, 5.5], skin: 'hock' },
  ),
  { name: 'body', from: [-3, 5, -6], to: [3, 9.5, 7], pivot: [0, 7, 0] },
  {
    name: 'shoulders',
    from: [-3.5, 4.5, -9],
    to: [3.5, 10, -4],
    pivot: [0, 7, -6],
    parent: 'body',
  },
  { name: 'crest', from: [-0.75, 9.5, -8], to: [0.75, 11, 6], pivot: [0, 9.5, -1], parent: 'body' },
  {
    name: 'head',
    from: [-2.75, 5, -13],
    to: [2.75, 9, -8.5],
    pivot: [0, 7, -9],
    parent: 'shoulders',
  },
  { name: 'snout', from: [-2, 5, -15.5], to: [2, 7.5, -13], pivot: [0, 7, -9], parent: 'head' },
  { name: 'jaw', from: [-2.25, 4, -15], to: [2.25, 5, -9], pivot: [0, 5, -9], parent: 'head' },
  {
    name: 'eyeL',
    from: [-2.5, 7.5, -13.5],
    to: [-1, 8.5, -13],
    pivot: [0, 7, -9],
    parent: 'head',
    emissive: true,
    skin: 'eye',
  },
  {
    name: 'eyeR',
    from: [1, 7.5, -13.5],
    to: [2.5, 8.5, -13],
    pivot: [0, 7, -9],
    parent: 'head',
    emissive: true,
    skin: 'eye',
  },
  {
    name: 'finL',
    from: [-3, 8, -10.5],
    to: [-2, 9, -7],
    pivot: [-2.5, 8.5, -10],
    parent: 'head',
    rotation: [-15, -20, 0],
    skin: 'fin',
  },
  {
    name: 'finR',
    from: [2, 8, -10.5],
    to: [3, 9, -7],
    pivot: [2.5, 8.5, -10],
    parent: 'head',
    rotation: [-15, 20, 0],
    skin: 'fin',
  },
  { name: 'tail', from: [-0.75, 6.5, 7], to: [0.75, 8.5, 11], pivot: [0, 7.5, 7], parent: 'body' },
  {
    name: 'tail2',
    from: [-0.5, 6.75, 11],
    to: [0.5, 8.25, 15],
    pivot: [0, 7.5, 11],
    parent: 'tail',
  },
  { name: 'tail3', from: [-0.5, 7, 15], to: [0.5, 8, 19], pivot: [0, 7.5, 15], parent: 'tail2' },
];

/** Hide barred with rust: jagged stripes down from the back every five texels. */
function barred(w: number, h: number, seed: number, length = 0.65): Face {
  const f = coat(w, h, H, { base: 2, grain: 'scale', seed });
  for (let x = 0; x < w; x++) {
    if ((x + seed) % 5 !== 0) continue;
    const reach = Math.round(h * length) - (noise(x, 0, seed) < 0.5 ? 1 : 0);
    for (let y = 0; y < reach; y++) {
      const jag = y % 3 === 2 ? 1 : 0;
      f.set(x + jag, y, tone(R, y < 2 ? 3 : 2));
    }
  }
  return f;
}

function underside(w: number, h: number): Face {
  return coat(w, h, H, { base: 3, top: 0, bottom: 0, grain: 'scale', seed: 9 });
}

function thigh(w: number, h: number): Face {
  return coat(w, h, H, { base: 2, top: 1, bottom: 1, grain: 'scale', seed: 21 }).edges('lr');
}

/** A paw: dark hide, the claws at its foot. */
function paw(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 2, top: 0, bottom: 0, grain: 'scale', seed: 22 });
  for (let x = 0; x < w; x += 2) f.set(x, h - 1, tone(B, 4));
  return f.edges('lr');
}

function pawFront(w: number, h: number): Face {
  const f = paw(w, h);
  for (let x = 0; x < w; x += 2) f.set(x, h - 2, tone(B, 3)).set(x, h - 1, tone(B, 5));
  return f;
}

function headSide(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 2, grain: 'scale', seed: 31 });
  // A rust brow streak running back from the eye, and the jaw's hinge.
  for (let x = 1; x < w; x++) f.set(x, 1 + (x < 3 ? 1 : 0), tone(R, x > w - 3 ? 3 : 2));
  return f.set(0, h - 2, tone(K, 2)).set(1, h - 2, tone(K, 2));
}

function headFront(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 2, grain: 'scale', seed: 32 });
  // A rust chevron between the eyes.
  const mid = (w - 1) / 2;
  for (let x = 0; x < w; x++) {
    const d = Math.abs(x - mid);
    if (d < 3) f.set(x, Math.round(d), tone(R, 3));
  }
  return f.edges('lr');
}

function headTop(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 3, top: 0, bottom: 0, grain: 'scale', seed: 33 });
  for (let y = 0; y < h; y++)
    f.set(Math.floor(w / 2), y, tone(R, 2)).set(Math.floor(w / 2) - 2, y + 1, tone(R, 2));
  return f;
}

/** The snout: a dark nose on top of its front, fangs along its lower edge. */
function snoutFront(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 2, grain: 'scale', seed: 34 });
  f.rect(w / 2 - 1, 0, w / 2 + 1, 2, tone(K, 1)).set(w / 2 - 1, 0, tone(K, 3));
  for (let x = 0; x < w; x++) f.set(x, h - 1, tone(B, x % 2 ? 3 : 4));
  return f.set(1, h - 2, tone(B, 4)).set(w - 2, h - 2, tone(B, 4));
}

function snoutSide(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 2, grain: 'scale', seed: 35 });
  for (let x = 0; x < w; x++) f.set(x, h - 1, tone(B, x % 2 ? 3 : 4));
  return f;
}

function jawSide(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 2, top: 0, grain: 'scale', seed: 36 });
  for (let x = 0; x < w; x++) if (x % 2 === 0) f.set(x, 0, tone(B, 4));
  return f;
}

/** The inside of the mouth: a dark red gum ringed with teeth. */
function mouth(w: number, h: number): Face {
  const f = coat(w, h, R, { base: 1, top: 0, bottom: 0, grain: 'smooth', seed: 37 });
  for (let y = 0; y < h; y++) {
    f.set(0, y, tone(B, y % 2 ? 3 : 4)).set(w - 1, y, tone(B, y % 2 ? 3 : 4));
  }
  for (let x = 0; x < w; x++) f.set(x, h - 1, tone(B, 4));
  return f;
}

function eyeFront(w: number, h: number): Face {
  const f = coat(w, h, A, { base: 4, top: 1, bottom: 1, grain: 'smooth', seed: 38 });
  return f.set(w - 1, 0, tone(A, 5));
}

/** The crest: a row of spines, rust with pale tips, dark gaps between them. */
function crestSide(w: number, h: number): Face {
  const f = new Face(w, h);
  for (let x = 0; x < w; x++) {
    const peak = x % 4 === 1 || x % 4 === 2;
    for (let y = 0; y < h; y++)
      f.set(x, y, y === 0 ? (peak ? tone(B, 2) : tone(H, 1)) : tone(R, peak ? 3 - y : 2 - y));
  }
  return f;
}

function crestTop(w: number, h: number): Face {
  const f = new Face(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) f.set(x, y, y % 4 === 1 ? tone(B, x === 1 ? 2 : 1) : tone(R, 1));
  return f;
}

/** The tail: hide ringed with rust, the last segment's tip rust with a pale barb. */
function tailSide(w: number, h: number): Face {
  const f = coat(w, h, H, { base: 2, grain: 'scale', seed: 39 });
  for (let x = 0; x < w; x++) if (x % 4 === 1) for (let y = 0; y < h; y++) f.set(x, y, tone(R, 2));
  return f;
}

function tipSide(w: number, h: number): Face {
  const f = tailSide(w, h);
  return f.rect(0, 0, 3, h, tone(R, 3)).set(0, 0, tone(B, 4));
}

export const prowler = beast({
  name: 'prowler',
  gait: 'quadruped',
  stride: 2,
  mats: ['barkLantern', 'red', 'amber', 'bone', 'coal'],
  glow: [A],
  parts,
  paint: {
    thighF: { side: thigh },
    thighB: { side: thigh },
    paw: { side: paw, front: pawFront, top: plain(H, 2), bottom: plain(K, 1) },
    hock: { side: paw, front: pawFront, top: plain(H, 2), bottom: plain(K, 1) },
    body: {
      side: (w, h) => barred(w, h, 11),
      front: plain(H, 2),
      back: (w, h) => barred(w, h, 12, 0.5),
      top: (w, h) => barred(w, h, 13, 1),
      bottom: underside,
    },
    shoulders: {
      side: (w, h) => barred(w, h, 14),
      front: (w, h) => coat(w, h, H, { base: 2, grain: 'scale', seed: 15 }).edges('lr'),
      back: plain(H, 2),
      top: (w, h) => barred(w, h, 16, 1),
      bottom: underside,
    },
    crest: {
      side: crestSide,
      top: crestTop,
      front: plain(R, 2),
      back: plain(R, 2),
      bottom: plain(H, 1),
    },
    head: { side: headSide, front: headFront, top: headTop, back: plain(H, 2), bottom: underside },
    snout: {
      side: snoutSide,
      front: snoutFront,
      top: (w, h) => coat(w, h, H, { base: 3, grain: 'scale', seed: 40 }),
      bottom: plain(B, 3),
    },
    jaw: { side: jawSide, front: jawSide, top: mouth, bottom: underside },
    eye: { side: plain(A, 2), front: eyeFront, top: plain(A, 3), bottom: plain(A, 2) },
    fin: {
      side: (w, h) =>
        coat(w, h, H, { base: 2, grain: 'smooth', seed: 41 }).rect(0, 0, w, 1, tone(R, 3)),
      top: plain(R, 2),
    },
    tail: { side: tailSide },
    tail2: { side: tailSide },
    tail3: { side: tipSide, back: plain(B, 4) },
  },
});
