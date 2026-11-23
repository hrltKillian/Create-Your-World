import type { BlockDef, ContentPack } from './schema.ts';
import { checkWeapon } from './validateItems.ts';

type AddIssue = (path: string, message: string) => void;

/** Farthest a shelter test may reach from the head (its cells are packed in 5 bits per axis). */
export const MAX_SHELTER_DISTANCE = 15;
/** Heat sources fade over at most this many blocks (the scan around the player). */
export const MAX_HEAT_RADIUS = 8;

/**
 * The survival rules (docs « Survie »): every balance number finite and ≥ 0, hours within a day,
 * blends and factors within 0–1 where they mix, whole counts, the bare hand's melee numbers and
 * the heat of the blocks within the tables.
 */
export function validateBalance(pack: ContentPack, add: AddIssue): void {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
    } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      add(path, 'must be a finite number ≥ 0');
    }
  };
  const b = pack.balance;
  walk(b, 'balance');
  for (const hour of ['fromHour', 'toHour', 'wakeHour'] as const)
    if (!(b.sleep[hour] < 24)) add(`balance.sleep.${hour}`, 'must be an hour below 24');
  const fractions = {
    'climate.enclosedBlend': b.climate.enclosedBlend,
    'shelter.enclosedToxicity': b.shelter.enclosedToxicity,
    'shelter.coveredToxicity': b.shelter.coveredToxicity,
  };
  for (const [path, value] of Object.entries(fractions))
    if (!(value <= 1)) add(`balance.${path}`, 'must be within 0–1');
  const whole = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;
  if (!whole(b.shelter.maxDistance, 1, MAX_SHELTER_DISTANCE))
    add('balance.shelter.maxDistance', `must be a whole number of 1–${MAX_SHELTER_DISTANCE}`);
  if (!whole(b.shelter.maxCells, 1, 4096))
    add('balance.shelter.maxCells', 'must be a whole number of 1–4096');
  if (!whole(b.climate.heatSources, 1, 8))
    add('balance.climate.heatSources', 'must be a whole number of 1–8');
  if (!Number.isInteger(b.creatures.spawnGraceTicks))
    add('balance.creatures.spawnGraceTicks', 'must be a whole number of ticks');
  checkWeapon(b.combat.hand, 'balance.combat.hand', add);
  pack.blocks.forEach((block, i) => {
    checkHeat(block.heat, `blocks[${i}].heat`, add);
    for (const [prop, override] of Object.entries(block.whenState ?? {}))
      checkHeat(override?.heat, `blocks[${i}].whenState.${prop}.heat`, add);
  });
}

/**
 * A heat source: whole °C of 1–127 (the thermal model only adds the strongest sources, so a cold
 * or zero one would do nothing) over a radius the scan reaches.
 */
function checkHeat(heat: BlockDef['heat'], path: string, add: AddIssue): void {
  if (!heat) return;
  if (!Number.isInteger(heat.celsius) || heat.celsius < 1 || heat.celsius > 127)
    add(`${path}.celsius`, 'must be a whole number of °C within 1…127 (heat sources only)');
  if (!Number.isInteger(heat.radius) || heat.radius < 1 || heat.radius > MAX_HEAT_RADIUS)
    add(`${path}.radius`, `must be a whole number of 1–${MAX_HEAT_RADIUS} blocks`);
}
