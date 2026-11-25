import {
  type BlockDef,
  type BlockOverride,
  type BlockShape,
  type Box16,
  STATE_VALUES,
  type StateProp,
} from './schema.ts';

/*
 * How a block definition expands into block states (used by buildRegistry): every combination of
 * its state values, the text key of each state, its `whenState` overrides and its boxes turned to
 * its facing.
 */

/** Text key of a block state: the block key, then its state values in brackets. */
export function stateKey(
  block: BlockDef,
  props: Readonly<Partial<Record<StateProp, string>>>,
): string {
  const names = block.states ?? [];
  if (names.length === 0) return block.key;
  return `${block.key}[${names.map((name) => `${name}=${props[name]}`).join(',')}]`;
}

/** The block properties that `whenState` overrides can change. */
export interface Effective {
  readonly opaque: boolean;
  readonly emit: number;
  readonly filter: number;
  readonly collision: BlockDef['collision'];
  readonly textures: BlockDef['textures'];
  readonly shape: BlockShape;
  readonly heat: BlockDef['heat'];
}

/** Block properties after applying `whenState` overrides for the active state values. */
export function effective(
  block: BlockDef,
  props: Readonly<Partial<Record<StateProp, string>>>,
): Effective {
  // Hung on a wall: the wall boxes, turned to the wall's side (`boxFacing`).
  const onWall = block.wallShape !== undefined && wallSide(props) !== undefined;
  let result: Effective = {
    opaque: block.opaque,
    emit: block.light?.emit ?? 0,
    filter: block.light?.filter ?? 0,
    collision: block.collision,
    textures: block.textures,
    shape: onWall ? block.wallShape! : block.shape,
    heat: block.heat,
  };
  for (const [prop, override] of Object.entries(block.whenState ?? {}) as [
    StateProp,
    BlockOverride,
  ][]) {
    if (props[prop] !== '1') continue;
    result = {
      opaque: override.opaque ?? result.opaque,
      emit: override.emit ?? override.light?.emit ?? result.emit,
      filter: override.light?.filter ?? result.filter,
      collision: override.collision ?? result.collision,
      textures: { ...result.textures, ...override.textures },
      shape: override.shape ?? result.shape,
      heat: override.heat ?? result.heat,
    };
  }
  return result;
}

/** The side of the wall a block hangs on (`attach` n, e, s or w), undefined on the floor. */
export function wallSide(props: Readonly<Partial<Record<StateProp, string>>>): string | undefined {
  const attach = props.attach;
  return attach !== undefined && attach !== 'floor' ? attach : undefined;
}

/** The facing a state's boxes turn to: its `facing4`, or the wall it hangs on. */
export function boxFacing(props: Readonly<Partial<Record<StateProp, string>>>): string | undefined {
  return props.facing4 ?? wallSide(props);
}

/**
 * Parses a state's text key (`block:x[a=1,b=2]`) into its block key and state values; values not
 * written are left out.
 */
export function parseStateKey(key: string): {
  block: string;
  props: Partial<Record<string, string>>;
} {
  const open = key.indexOf('[');
  if (open < 0 || !key.endsWith(']')) return { block: key, props: {} };
  const props: Partial<Record<string, string>> = {};
  for (const pair of key.slice(open + 1, -1).split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) props[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return { block: key.slice(0, open), props };
}

/** Every combination of the values of `props`, in declaration order. */
export function combinations(props: readonly StateProp[]): Partial<Record<StateProp, string>>[] {
  let result: Partial<Record<StateProp, string>>[] = [{}];
  for (const prop of props) {
    const next: Partial<Record<StateProp, string>>[] = [];
    for (const partial of result) {
      for (const value of STATE_VALUES[prop]) next.push({ ...partial, [prop]: value });
    }
    result = next;
  }
  return result;
}

/** Quarter turns around +y from the default facing (north). */
function facingQuarterTurns(facing: string | undefined): number {
  switch (facing) {
    case 'e':
      return 1;
    case 's':
      return 2;
    case 'w':
      return 3;
    default:
      return 0;
  }
}

/**
 * Rotates a state's boxes to its facing and returns their index in `list`, appending them unless
 * an identical set is already there (`index` maps each set's JSON to its index).
 */
export function internBoxes(
  boxes: readonly Box16[],
  facing: string | undefined,
  list: Box16[][],
  index: Map<string, number>,
): number {
  const quarter = facingQuarterTurns(facing);
  const rotated = boxes.map((box) => rotateBoxY(box, quarter));
  const id = JSON.stringify(rotated);
  let i = index.get(id);
  if (i === undefined) {
    i = list.length;
    list.push(rotated);
    index.set(id, i);
  }
  return i;
}

/** Rotates a 1/16 box clockwise (seen from above) around the block centre, `turns` quarter turns. */
export function rotateBoxY(box: Box16, turns: number): Box16 {
  let [x0, y0, z0, x1, y1, z1] = box;
  for (let i = 0; i < (turns & 3); i++) {
    // (x, z) → (16 − z, x): north (−z) side becomes east (+x).
    const nx0 = 16 - z1;
    const nx1 = 16 - z0;
    const nz0 = x0;
    const nz1 = x1;
    [x0, x1, z0, z1] = [nx0, nx1, nz0, nz1];
  }
  return [x0, y0, z0, x1, y1, z1];
}
