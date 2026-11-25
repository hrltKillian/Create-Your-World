import type { QuestCounter, TaskDef } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';

/** Ids of the tasks the pack strings name (`task.<id>`). */
type TaskId = PackI18nKey extends infer K ? (K extends `task.${infer Id}` ? Id : never) : never;

const task = (id: TaskId, counter: QuestCounter, xp: number): TaskDef => ({
  key: `task:${id}`,
  textKey: `task.${id}`,
  counter,
  xp,
});

/**
 * General tasks (plan v3 « M22 »): everyday deeds drawn three at a time for each player, worth a
 * little XP each, so the game levels up without the quests too.
 */
export const tasks: readonly TaskDef[] = [
  task('dig', { event: 'broken', count: 64 }, 40),
  task('build', { event: 'placed', count: 32 }, 30),
  task('hunt', { event: 'killed', count: 3 }, 40),
  task('trotters', { event: 'killed', target: 'creature:trotter', count: 2 }, 30),
  task('meals', { event: 'consumed', count: 5 }, 25),
  task('night', { event: 'night', count: 1 }, 40),
];
