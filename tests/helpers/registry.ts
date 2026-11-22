import { basePack } from '../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../src/content/registry.ts';

/** The base pack's registry, built once per test file and shared by its tests (read-only). */
export const registry = buildRegistry(basePack);
