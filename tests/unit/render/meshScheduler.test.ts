import { describe, expect, it } from 'vitest';
import { MeshScheduler, type MeshSink } from '../../../src/render/MeshScheduler.ts';
import type { SimView } from '../../../src/sim/host.ts';
import { WorldJobs } from '../../../src/workers/worldJobs.ts';
import { sectionKey } from '../../../src/world/coords.ts';
import type { JobPriority, MeshJob, MeshResult } from '../../../src/world/protocol.ts';
import { emptyWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';

const BUDGETS = {
  maxInFlight: 64,
  dispatchPerFrame: 64,
  uploadsPerFrame: 64,
  uploadBytesPerFrame: 1 << 30,
};
const STONE = registry.defaultState('block:stone');

/** A scheduler over a stone floor (y 63) on columns (0, 0) and (1, 0), with a manual job runner. */
function setup() {
  const world = emptyWorld(3);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 32; z++) world.setBlock(x, 63, z, STONE);
  const jobs: { job: MeshJob; priority: JobPriority; resolve: (r: MeshResult) => void }[] = [];
  const runner = {
    run: (job: MeshJob, priority: JobPriority = 'normal') =>
      new Promise<MeshResult>((resolve) => jobs.push({ job, priority, resolve })),
  } as unknown as ConstructorParameters<typeof MeshScheduler>[1];
  const shown: number[] = [];
  const removed: number[] = [];
  const sink: MeshSink = {
    update: (key) => shown.push(key),
    remove: (key) => removed.push(key),
  };
  const scheduler = new MeshScheduler({ world } as unknown as SimView, runner, sink, {
    belowBlock: registry.unknownBlock,
    missingBlock: registry.unknownBlock,
    missingLight: 0,
    air: registry.air,
  });
  const mesher = new WorldJobs(registry);
  /** Answers the jobs at these indices (all when omitted), then lets the promises settle. */
  const answer = async (which?: number[]) => {
    for (const [i, j] of jobs.entries())
      if (!which || which.includes(i)) j.resolve(mesher.mesh(j.job));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const frame = () => scheduler.update(16, 64, 16, BUDGETS);
  scheduler.onEvent({ type: 'columnMeshable', cx: 0, cz: 0 });
  scheduler.onEvent({ type: 'columnMeshable', cx: 1, cz: 0 });
  return { world, scheduler, jobs, shown, removed, answer, frame };
}

/** Loads both columns' meshes and clears the records. */
async function loaded() {
  const s = setup();
  s.frame();
  await s.answer();
  s.frame();
  expect(s.scheduler.idle()).toBe(true);
  s.jobs.length = 0;
  s.shown.length = 0;
  s.removed.length = 0;
  return s;
}

/** Breaks the floor block at x = 31, on the border of the two columns' sections. */
function breakBorderBlock(s: Awaited<ReturnType<typeof loaded>>) {
  s.world.setBlock(31, 63, 5, registry.air);
  s.scheduler.onEvent({ type: 'blocksChanged', x0: 31, y0: 63, z0: 5, x1: 31, y1: 63, z1: 5 });
}

describe('mesh scheduler', () => {
  it('meshes edited sections with urgent jobs and swaps them in together', async () => {
    const s = await loaded();
    const left = sectionKey(0, 1, 0);
    const right = sectionKey(1, 1, 0);
    breakBorderBlock(s);
    expect(s.scheduler.sectionVersionLag()).toBe(1);
    s.frame();
    expect(s.jobs.map((j) => [j.job.key, j.priority])).toEqual([
      [left, 'urgent'],
      [right, 'urgent'],
    ]);
    // One mesh back: nothing is shown yet, the old meshes stay.
    await s.answer([0]);
    s.frame();
    expect(s.shown).toEqual([]);
    expect(s.scheduler.busy(left)).toBe(true);
    await s.answer([1]);
    s.frame();
    expect(s.shown.sort()).toEqual([left, right].sort());
    // The empty sections above (sy 2) are part of the batch: removed in the same frame.
    expect(s.removed.sort()).toEqual([sectionKey(0, 2, 0), sectionKey(1, 2, 0)].sort());
    expect(s.scheduler.sectionVersionLag()).toBe(0);
    expect(s.scheduler.editToMeshMs).toBeGreaterThanOrEqual(0);
    expect(s.scheduler.idle()).toBe(true);
  });

  it('drops a mesh made before an edit and meshes the section again, urgently', async () => {
    const s = setup();
    s.frame();
    const normal = s.jobs.length;
    expect(s.jobs.every((j) => j.priority === 'normal')).toBe(true);
    breakBorderBlock(s);
    s.frame();
    // Still in flight: the urgent jobs wait for those results instead of doubling them.
    expect(s.jobs).toHaveLength(normal);
    await s.answer();
    s.frame();
    expect(s.shown).toEqual([]);
    expect(s.jobs.slice(normal).map((j) => j.priority)).toEqual(['urgent', 'urgent']);
    await s.answer(s.jobs.map((_, i) => i).slice(normal));
    s.frame();
    expect(s.shown.sort()).toEqual([sectionKey(0, 1, 0), sectionKey(1, 1, 0)].sort());
    expect(s.scheduler.sectionVersionLag()).toBe(0);
  });

  it('drops the meshes of a column hidden while they were in flight, without meshing again', async () => {
    const s = setup();
    s.frame();
    s.scheduler.onEvent({ type: 'columnHidden', cx: 1, cz: 0 });
    await s.answer();
    const jobs = s.jobs.length;
    s.frame();
    expect(s.shown).toEqual([sectionKey(0, 1, 0)]);
    expect(s.jobs).toHaveLength(jobs);
    expect(s.scheduler.idle()).toBe(true);
  });

  it('forgets the batch sections of a column that goes away', async () => {
    const s = await loaded();
    breakBorderBlock(s);
    s.scheduler.onEvent({ type: 'columnHidden', cx: 1, cz: 0 });
    s.frame();
    await s.answer();
    s.frame();
    expect(s.shown).toEqual([sectionKey(0, 1, 0)]);
    expect(s.scheduler.idle()).toBe(true);
  });
});
