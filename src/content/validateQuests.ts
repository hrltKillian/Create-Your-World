import {
  COMPASS_POINTS,
  type ContentPack,
  QUEST_EVENTS,
  type QuestDef,
  type QuestEvent,
} from './schema.ts';
import type { ItemRefs } from './validateItems.ts';

type AddIssue = (path: string, message: string) => void;

/**
 * The quest graph (plan v3 « M21 »): unique `quest:` keys, strings for every text and hint, a known
 * compass point, requirements on earlier quests only (so the graph has no cycle) and at least one
 * quest open from the start, exactly one of a condition that asks for something (items or tags,
 * stations the pack has) and a counter of a known event and target, and rewards of known items.
 */
export function validateQuests(pack: ContentPack, refs: ItemRefs, add: AddIssue): void {
  const quests = pack.quests ?? [];
  const stations = new Set<string>((pack.stations ?? []).map((station) => station.key));
  const targets: Readonly<Record<QuestEvent, ReadonlySet<string>>> = {
    killed: new Set((pack.creatures ?? []).map((creature) => creature.key)),
    night: new Set(),
  };
  const earlier = new Set<string>();
  quests.forEach((quest, i) => {
    const path = `quests[${i}]`;
    if (!quest.key.startsWith('quest:'))
      add(`${path}.key`, `"${quest.key}" must start with "quest:"`);
    if (earlier.has(quest.key)) add(`${path}.key`, `duplicate key "${quest.key}"`);
    for (const field of ['textKey', 'hintKey'] as const) {
      const key = quest[field];
      if (key !== undefined && pack.strings[key] === undefined)
        add(`${path}.${field}`, `no string for "${key}"`);
    }
    if (quest.compass !== undefined && !COMPASS_POINTS.includes(quest.compass))
      add(`${path}.compass`, `unknown compass point "${quest.compass}"`);
    (quest.requires ?? []).forEach((key, j) => {
      if (!earlier.has(key)) add(`${path}.requires[${j}]`, `"${key}" is no earlier quest`);
    });
    checkGoal(quest, path, stations, targets, refs, add);
    (quest.rewards ?? []).forEach((reward, j) => {
      if (!refs.items.has(reward.item))
        add(`${path}.rewards[${j}]`, `unknown item "${reward.item}"`);
      if (!(Number.isInteger(reward.count) && reward.count >= 1))
        add(`${path}.rewards[${j}].count`, 'must be an integer ≥ 1');
    });
    earlier.add(quest.key);
  });
  if (quests.length > 0 && !quests.some((quest) => (quest.requires ?? []).length === 0))
    add('quests', 'no quest is open from the start');
}

/** Exactly one of a condition asking for something and a counter of a known event. */
function checkGoal(
  quest: QuestDef,
  path: string,
  stations: ReadonlySet<string>,
  targets: Readonly<Record<QuestEvent, ReadonlySet<string>>>,
  refs: ItemRefs,
  add: AddIssue,
): void {
  const { condition: c, counter } = quest;
  if ((c === undefined) === (counter === undefined))
    add(path, 'needs exactly one of a condition and a counter');
  if (counter) {
    if (!QUEST_EVENTS.includes(counter.event))
      add(`${path}.counter.event`, `unknown event "${counter.event}"`);
    else if (counter.target !== undefined && !targets[counter.event].has(counter.target))
      add(`${path}.counter.target`, `no ${counter.event} target "${counter.target}"`);
    if (!(Number.isInteger(counter.count) && counter.count >= 1))
      add(`${path}.counter.count`, 'must be an integer ≥ 1');
  }
  if (!c) return;
  const items = c.items ?? [];
  const asked = items.length + (c.stations?.length ?? 0) + (c.biomes ?? 0) + (c.met ?? 0);
  if (asked === 0 && c.drank !== true) add(`${path}.condition`, 'asks for nothing');
  items.forEach((item, j) => {
    const known = item.startsWith('tag:') ? refs.tags.has(item) : refs.items.has(item);
    if (!known) add(`${path}.condition.items[${j}]`, `no item is or carries "${item}"`);
  });
  (c.stations ?? []).forEach((station, j) => {
    if (!stations.has(station))
      add(`${path}.condition.stations[${j}]`, `unknown station "${station}"`);
  });
  for (const field of ['biomes', 'met'] as const) {
    const value = c[field];
    if (value !== undefined && !(Number.isInteger(value) && value >= 1))
      add(`${path}.condition.${field}`, 'must be an integer ≥ 1');
  }
}
