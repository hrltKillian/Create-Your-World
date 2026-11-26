import type { SfxDef } from '../../schema.ts';
import { burst, crunch, impact, type Modes } from './sfxParts.ts';
import { sounds } from './sounds.ts';

/*
 * The interface's sounds (plan v5 « M54 »), the colony's gear handled: a switch on a metal panel,
 * a lighter tab, a stack grabbed from the canvas pack and set down in it, a throw through the air,
 * tools tapping a craft done; the pack's canvas and its buckle, the map's paper unfolding, a
 * journal's pages, a riveted panel sliding on its rail for the menus.
 */

/** A toggle switch on a small steel plate. */
const SWITCH: Modes = [
  [2150, 0.03, 0.6],
  [3480, 0.02, 0.35],
  [5230, 0.012, 0.2],
];
/** The plate behind it: its low thunk. */
const PANEL: Modes = [
  [180, 0.03, 0.5],
  [410, 0.02, 0.25],
];
/** A buckle's iron. */
const BUCKLE: Modes = [
  [3300, 0.04, 0.5],
  [5600, 0.025, 0.3],
];
/** A stack set down: wood and cloth on canvas. */
const SET_DOWN: Modes = [
  [230, 0.04, 0.6],
  [560, 0.025, 0.3],
];

const CANVAS = { type: 'lowpass', freq: 2600 } as const;
const PAPER = { type: 'bandpass', freq: 3200, q: 0.7 } as const;
const RAIL = { type: 'bandpass', freq: 1300, q: 3 } as const;

const ui = sounds.ui;

/** Every interface sound: on the interface's bus, at its level. */
export const uiSfx: readonly SfxDef[] = [
  {
    key: ui.button,
    level: 'ui',
    layers: [impact(SWITCH, 0.0004, 0.7), impact(PANEL, 0.003, 0.5, { delay: 0.004 })],
  },
  { key: ui.tab, level: 'ui', layers: [impact(SWITCH, 0.0003, 0.5, { pitch: 1.25, ring: 0.6 })] },
  {
    // A stack grabbed: fingers on canvas, the item lifted.
    key: ui.take,
    level: 'ui',
    layers: [crunch(CANVAS, 340, 0.6, 0.05), impact(SET_DOWN, 0.006, 0.3, { pitch: 1.6 })],
  },
  {
    // A stack set down in a slot: its soft knock, the canvas settling.
    key: ui.put,
    level: 'ui',
    layers: [impact(SET_DOWN, 0.004, 0.7), crunch(CANVAS, 220, 0.35, 0.04, { delay: 0.01 })],
  },
  {
    // A throw: the arm's swish.
    key: ui.throw,
    level: 'ui',
    layers: [burst('noise', { type: 'bandpass', freq: 900, q: 0.8 }, 0.6, 0.12, { attack: 0.05 })],
  },
  {
    // A craft done: two taps of a tool on the work.
    key: ui.craft,
    level: 'ui',
    layers: [
      impact(SET_DOWN, 0.002, 0.6, { pitch: 1.4 }),
      impact(SET_DOWN, 0.002, 0.5, { delay: 0.13, pitch: 1.7 }),
      impact(BUCKLE, 0.0008, 0.25, { delay: 0.13 }),
    ],
  },
  {
    // The pack opened: its flap lifted, the canvas rustling, the buckle.
    key: ui.bag.open,
    level: 'ui',
    layers: [
      impact(BUCKLE, 0.0008, 0.5),
      crunch(CANVAS, 280, 0.6, 0.22, { delay: 0.03, attack: 0.04 }),
    ],
  },
  {
    // The pack closed: the canvas folded down, the buckle fastened.
    key: ui.bag.close,
    level: 'ui',
    layers: [
      crunch(CANVAS, 280, 0.6, 0.16, { attack: 0.03 }),
      impact(BUCKLE, 0.0008, 0.55, { delay: 0.17 }),
    ],
  },
  {
    // The map unfolded: stiff paper crinkling open.
    key: ui.map.open,
    level: 'ui',
    layers: [
      crunch(PAPER, 160, 0.7, 0.3, { attack: 0.03, grain: [0.003, 0.012] }),
      burst('pink', CANVAS, 0.3, 0.2, { attack: 0.08 }),
    ],
  },
  {
    // The map folded: the crinkle, the paper patted flat.
    key: ui.map.close,
    level: 'ui',
    layers: [
      crunch(PAPER, 160, 0.6, 0.18, { grain: [0.003, 0.012] }),
      impact(SET_DOWN, 0.01, 0.4, { delay: 0.2, pitch: 0.8 }),
    ],
  },
  {
    // A journal opened: the cover's soft knock, a page turning over.
    key: ui.book.open,
    level: 'ui',
    layers: [
      impact(SET_DOWN, 0.008, 0.5, { pitch: 0.7 }),
      burst('noise', PAPER, 0.5, 0.14, { delay: 0.06, attack: 0.05 }),
      crunch(PAPER, 90, 0.35, 0.1, { delay: 0.08 }),
    ],
  },
  {
    // A journal shut: the pages slapping together.
    key: ui.book.close,
    level: 'ui',
    layers: [
      burst('noise', PAPER, 0.4, 0.06, { attack: 0.03 }),
      impact(SET_DOWN, 0.006, 0.7, { delay: 0.05, pitch: 0.75 }),
    ],
  },
  {
    // A menu: a riveted panel sliding on its rail, then its latch.
    key: ui.menu.open,
    level: 'ui',
    layers: [
      burst('noise', RAIL, 0.5, 0.06, { attack: 0.02, hold: 0.1 }),
      impact(SWITCH, 0.0005, 0.5, { delay: 0.13, pitch: 0.8 }),
    ],
  },
  {
    // A menu closed: the latch, the panel sliding back.
    key: ui.menu.close,
    level: 'ui',
    layers: [
      impact(SWITCH, 0.0005, 0.5, { pitch: 0.8 }),
      burst('noise', RAIL, 0.45, 0.05, { delay: 0.03, attack: 0.02, hold: 0.08 }),
    ],
  },
];
