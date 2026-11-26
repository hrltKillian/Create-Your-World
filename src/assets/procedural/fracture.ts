import { hash32 } from '../../core/hash.ts';

/** The 8 neighbour steps of a crack walk, turning counter-clockwise from +x. */
const STEP_X = [1, 1, 0, -1, -1, -1, 0, 1];
const STEP_Y = [0, 1, 1, 1, 0, -1, -1, -1];
/** Crack grid: walks run on 32 cells whatever the texture size. */
const CRACK_GRID = 32;
export const CRACK_CORE = 1;
export const CRACK_RIM = 2;

/**
 * Cells of a crack overlay at a stage, on the 32-cell grid: 0 none, CRACK_CORE, CRACK_RIM (the cell
 * under a crack, lighter). Branches walk from the centre with seeded turns; later branches fork
 * off the fifth cell of earlier ones. Stage s has 2 + s branches of 6 + 2s cells, and a walk only
 * depends on (seed, branch, step), so every stage contains the cracks of the stages before it.
 */
export function fractureCells(seed: number, stage: number): Uint8Array {
  const cells = new Uint8Array(CRACK_GRID * CRACK_GRID);
  const branches = 2 + stage;
  const length = 6 + 2 * stage;
  const forkX: number[] = [];
  const forkY: number[] = [];
  const forkD: number[] = [];
  for (let b = 0; b < branches; b++) {
    let x = 15 + (hash32(seed, b, 1) % 2);
    let y = 15 + (hash32(seed, b, 2) % 2);
    let d = (b * 2 + (hash32(seed, b, 3) % 2)) & 7;
    const parent = b - 4;
    if (parent >= 0 && parent < forkX.length) {
      x = forkX[parent]!;
      y = forkY[parent]!;
      d = (forkD[parent]! + (hash32(seed, b, 4) % 2 === 0 ? 1 : 7)) & 7;
    }
    for (let k = 0; k < length; k++) {
      if (x < 0 || y < 0 || x >= CRACK_GRID || y >= CRACK_GRID) break;
      cells[y * CRACK_GRID + x] = CRACK_CORE;
      if (k === 4) {
        forkX.push(x);
        forkY.push(y);
        forkD.push(d);
      }
      const turn = hash32(seed, b, k, 5) % 5;
      if (turn === 0) d = (d + 1) & 7;
      else if (turn === 1) d = (d + 7) & 7;
      x += STEP_X[d]!;
      y += STEP_Y[d]!;
    }
  }
  for (let i = CRACK_GRID; i < cells.length; i++)
    if (cells[i] === CRACK_CORE && cells[i - CRACK_GRID] === 0) cells[i - CRACK_GRID] = CRACK_RIM;
  return cells;
}

/** The crack cell under texel (x, y) of a `size` texture. */
export function crackAt(cells: Uint8Array, x: number, y: number, size: number): number {
  return cells[
    Math.floor((y * CRACK_GRID) / size) * CRACK_GRID + Math.floor((x * CRACK_GRID) / size)
  ]!;
}
