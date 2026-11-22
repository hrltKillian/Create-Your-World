import { basePack } from '../content/packs/base/index.ts';
import { buildRegistry, type Registry } from '../content/registry.ts';
import { Column, sectionPayloads } from '../world/Column.ts';
import { createGenContext, type GenContext, generateColumn } from '../world/gen/generateColumn.ts';
import { meshSection } from '../world/mesh/greedyMesher.ts';
import type { GenJob, GenResult, Job, JobResult, MeshJob, MeshResult } from '../world/protocol.ts';

/**
 * Pure job handlers shared by the worker runtime and the synchronous Node runner. The registry is
 * rebuilt from the same pack module (cheaper than shipping the tables, and identical by construction).
 */
export class WorldJobs {
  readonly registry: Registry;
  private readonly contexts = new Map<string, GenContext>();
  private readonly now: () => number;

  constructor(registry: Registry = buildRegistry(basePack), now: () => number = () => 0) {
    this.registry = registry;
    this.now = now;
  }

  run(job: Job): JobResult {
    return job.kind === 'gen' ? this.gen(job) : this.mesh(job);
  }

  context(seed: string): GenContext {
    let ctx = this.contexts.get(seed);
    if (!ctx) {
      ctx = createGenContext(seed, this.registry);
      // A world uses one seed at a time; keep at most two contexts around.
      if (this.contexts.size > 1) this.contexts.clear();
      this.contexts.set(seed, ctx);
    }
    return ctx;
  }

  gen(job: GenJob): GenResult {
    const start = this.now();
    const column = new Column(job.cx, job.cz, this.registry.air);
    generateColumn(this.context(job.seed), column);
    const sections = sectionPayloads(column);
    return {
      kind: 'gen',
      seed: job.seed,
      cx: job.cx,
      cz: job.cz,
      sections,
      heightmap: column.heightmap,
      biomes: column.biomes,
      ms: this.now() - start,
    };
  }

  mesh(job: MeshJob): MeshResult {
    const start = this.now();
    const mesh = meshSection(
      { ids: job.ids, light: job.light, biomes: job.biomes },
      this.registry.tables,
    );
    return {
      kind: 'mesh',
      key: job.key,
      version: job.version,
      passes: mesh.passes,
      connectivity: mesh.connectivity,
      ms: this.now() - start,
      padded: { ids: job.ids, light: job.light, biomes: job.biomes },
    };
  }
}
