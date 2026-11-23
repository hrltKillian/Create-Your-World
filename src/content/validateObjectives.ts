import { COMPASS_POINTS, type ContentPack } from './schema.ts';
import type { ItemRefs } from './validateItems.ts';

type AddIssue = (path: string, message: string) => void;

/**
 * The objectives chain: unique `objective:` keys, strings for every text and hint, a known compass
 * point, and a condition that asks for something, of items (or tags) and stations the pack has.
 */
export function validateObjectives(pack: ContentPack, refs: ItemRefs, add: AddIssue): void {
  const stations = new Set<string>((pack.stations ?? []).map((station) => station.key));
  const keys = new Set<string>();
  (pack.objectives ?? []).forEach((objective, i) => {
    const path = `objectives[${i}]`;
    if (!objective.key.startsWith('objective:'))
      add(`${path}.key`, `"${objective.key}" must start with "objective:"`);
    if (keys.has(objective.key)) add(`${path}.key`, `duplicate key "${objective.key}"`);
    keys.add(objective.key);
    for (const field of ['textKey', 'hintKey'] as const) {
      const key = objective[field];
      if (key !== undefined && pack.strings[key] === undefined)
        add(`${path}.${field}`, `no string for "${key}"`);
    }
    if (objective.compass !== undefined && !COMPASS_POINTS.includes(objective.compass))
      add(`${path}.compass`, `unknown compass point "${objective.compass}"`);
    const c = objective.condition;
    const items = c.items ?? [];
    const asked = items.length + (c.stations?.length ?? 0) + (c.nights ?? 0);
    if (asked === 0 && c.enclosed !== true) add(`${path}.condition`, 'asks for nothing');
    items.forEach((item, j) => {
      const known = item.startsWith('tag:') ? refs.tags.has(item) : refs.items.has(item);
      if (!known) add(`${path}.condition.items[${j}]`, `no item is or carries "${item}"`);
    });
    (c.stations ?? []).forEach((station, j) => {
      if (!stations.has(station))
        add(`${path}.condition.stations[${j}]`, `unknown station "${station}"`);
    });
    if (c.nights !== undefined && !(Number.isInteger(c.nights) && c.nights >= 0))
      add(`${path}.condition.nights`, 'must be an integer ≥ 0');
  });
}
