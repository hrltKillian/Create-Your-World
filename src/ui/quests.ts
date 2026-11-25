import type { Registry } from '../content/registry.ts';
import type { QuestDef } from '../content/schema.ts';
import { t } from '../i18n/i18n.ts';
import type { TaskState } from '../sim/progression.ts';
import type { QuestState } from '../sim/quests.ts';
import { ingredientName } from './itemSlot.ts';

/*
 * The Quests page and the pinned line (plan v3 « M21 »), pure: one row per quest unlocked, done
 * ones still to claim first, then those open (in the pack's order), then those claimed; a locked
 * quest never shows. Texts come from the pack's strings.
 */

export type QuestStatus = 'claim' | 'open' | 'claimed';

export interface QuestRow {
  readonly quest: string;
  readonly status: QuestStatus;
  readonly name: string;
  readonly hint: string;
  /** « 1/3 » for a counter, else empty. */
  readonly progress: string;
  /** « 20 XP, 4 Torch », or empty. */
  readonly rewards: string;
  readonly pinned: boolean;
}

const ORDER: Readonly<Record<QuestStatus, number>> = { claim: 0, open: 1, claimed: 2 };

/** A quest's name with its counter's progress (« Hunt a Trotter 0/1 »): the HUD's lines. */
export function questLine(quest: QuestDef, state: Readonly<QuestState> | undefined): string {
  const name = t(quest.textKey);
  const counter = quest.counter;
  return counter && !state?.done
    ? t('quests.line', { name, progress: state?.progress ?? 0, count: counter.count })
    : name;
}

/** The rows of the Quests page for a player's quests. */
export function questRows(
  registry: Registry,
  quests: Readonly<Record<string, Readonly<QuestState>>>,
  pinned: string | null,
): QuestRow[] {
  const rows: QuestRow[] = [];
  for (const quest of registry.pack.quests ?? []) {
    const state = quests[quest.key];
    if (!state) continue;
    const status: QuestStatus = state.claimed ? 'claimed' : state.done ? 'claim' : 'open';
    const counter = quest.counter;
    rows.push({
      quest: quest.key,
      status,
      name: t(quest.textKey),
      hint: quest.hintKey ? t(quest.hintKey) : '',
      progress: counter && !state.done ? `${state.progress}/${counter.count}` : '',
      rewards: [
        ...(quest.xp ? [t('quests.xp', { xp: quest.xp })] : []),
        ...(quest.rewards ?? []).map((r) =>
          t('quests.reward', { count: r.count, item: ingredientName(registry, r.item) }),
        ),
      ].join(', '),
      pinned: pinned === quest.key,
    });
  }
  // A stable sort: the pack's order within each status.
  return rows.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

export interface TaskRow {
  /** Its place among the player's tasks (the commands' `index`). */
  readonly index: number;
  readonly task: string;
  readonly name: string;
  /** « 12/64 ». */
  readonly progress: string;
  readonly xp: string;
  readonly done: boolean;
  /** Not done, and no task redrawn today. */
  readonly canReroll: boolean;
}

/** The rows of the player's tasks (`reroll`: no task was redrawn today). */
export function taskRows(
  registry: Registry,
  tasks: readonly Readonly<TaskState>[],
  reroll: boolean,
): TaskRow[] {
  const rows: TaskRow[] = [];
  tasks.forEach((held, index) => {
    const def = registry.pack.tasks?.find((task) => task.key === held.key);
    if (!def) return;
    const done = held.progress >= def.counter.count;
    rows.push({
      index,
      task: def.key,
      name: t(def.textKey),
      progress: `${Math.min(held.progress, def.counter.count)}/${def.counter.count}`,
      xp: t('quests.xp', { xp: def.xp }),
      done,
      canReroll: reroll && !done,
    });
  });
  return rows;
}
