import type { Registry } from '../../content/registry.ts';
import { sectionKey } from '../coords.ts';
import { FULL_SKY } from '../light.ts';
import { meshSection, type SectionMesh } from '../mesh/greedyMesher.ts';
import { createPadded, fillPadded } from '../mesh/padded.ts';
import type { VoxelWorld } from '../VoxelWorld.ts';

/** Surface height of the developer test scene. */
export const TEST_SCENE_SURFACE = 64;
/** The scene covers columns −1…1 on both axes (96 × 96 blocks centred on the origin). */
export const TEST_SCENE_RADIUS = 1;

/**
 * Builds the developer test scene from the pack's `devScene` description: layered ground, a pond,
 * a tree, scattered plants and a showcase of every block state on a platform.
 */
export function buildTestScene(world: VoxelWorld, registry: Registry): void {
  const scene = registry.pack.devScene;
  if (!scene) throw new Error('The content pack has no devScene');
  const min = -32 * TEST_SCENE_RADIUS;
  const max = 32 * (TEST_SCENE_RADIUS + 1);
  for (let cx = -TEST_SCENE_RADIUS; cx <= TEST_SCENE_RADIUS; cx++) {
    for (let cz = -TEST_SCENE_RADIUS; cz <= TEST_SCENE_RADIUS; cz++) world.ensureColumn(cx, cz);
  }

  const layers = scene.ground.map((key) => registry.defaultState(key));
  const base = TEST_SCENE_SURFACE - layers.length + 1;
  for (let x = min; x < max; x++) {
    for (let z = min; z < max; z++) {
      for (let y = 0; y < base; y++) world.setBlock(x, y, z, layers[0]!);
      layers.forEach((state, i) => {
        world.setBlock(x, base + i, z, state);
      });
    }
  }

  if (scene.pond) {
    const liquid = registry.defaultState(scene.pond.liquid);
    const shore = scene.pond.shore ? registry.defaultState(scene.pond.shore) : null;
    const cx = -18;
    const cz = 14;
    for (let x = cx - 8; x <= cx + 8; x++) {
      for (let z = cz - 6; z <= cz + 6; z++) {
        const dx = (x - cx) / 8;
        const dz = (z - cz) / 6;
        const d = dx * dx + dz * dz;
        if (d <= 1) {
          world.setBlock(x, TEST_SCENE_SURFACE, z, liquid);
          if (d < 0.5) world.setBlock(x, TEST_SCENE_SURFACE - 1, z, liquid);
        } else if (d <= 1.5 && shore !== null) {
          world.setBlock(x, TEST_SCENE_SURFACE, z, shore);
        }
      }
    }
  }

  if (scene.tree) {
    const log = registry.defaultState(scene.tree.log);
    const leaves = registry.defaultState(scene.tree.leaves);
    const tx = 18;
    const tz = 18;
    const top = TEST_SCENE_SURFACE + 6;
    for (let y = TEST_SCENE_SURFACE + 1; y <= top; y++) world.setBlock(tx, y, tz, log);
    for (let x = tx - 2; x <= tx + 2; x++) {
      for (let z = tz - 2; z <= tz + 2; z++) {
        for (let y = top - 2; y <= top + 1; y++) {
          const corner = Math.abs(x - tx) === 2 && Math.abs(z - tz) === 2;
          const crown = y === top + 1 && (Math.abs(x - tx) > 1 || Math.abs(z - tz) > 1);
          if (!corner && !crown && world.getBlock(x, y, z) === registry.air)
            world.setBlock(x, y, z, leaves);
        }
      }
    }
  }

  if (scene.plant) {
    const plant = registry.defaultState(scene.plant);
    const surface = layers[layers.length - 1]!;
    for (let i = 0; i < 160; i++) {
      // Deterministic scatter (golden-ratio sequence), no RNG needed for a fixed scene.
      const x = min + Math.floor(((i * 0.618034) % 1) * (max - min));
      const z = min + Math.floor(((i * 0.414214) % 1) * (max - min));
      if (
        world.getBlock(x, TEST_SCENE_SURFACE, z) === surface &&
        world.getBlock(x, TEST_SCENE_SURFACE + 1, z) === registry.air
      ) {
        world.setBlock(x, TEST_SCENE_SURFACE + 1, z, plant);
      }
    }
  }

  // Showcase: every state of every visible block, in rows on a platform north of the origin.
  const floor = scene.showcaseFloor
    ? registry.defaultState(scene.showcaseFloor)
    : layers[layers.length - 1]!;
  const states = registry.states.filter((s) => s.id !== registry.air);
  const perRow = 16;
  const rows = Math.ceil(states.length / perRow);
  const x0 = -16;
  const z0 = -6 - rows * 3;
  for (let x = x0 - 1; x <= x0 + perRow * 2; x++) {
    for (let z = z0 - 1; z <= z0 + rows * 3; z++) world.setBlock(x, TEST_SCENE_SURFACE, z, floor);
  }
  states.forEach((state, i) => {
    const x = x0 + (i % perRow) * 2;
    const z = z0 + Math.floor(i / perRow) * 3;
    world.setBlock(x, TEST_SCENE_SURFACE + 1, z, state.id);
  });
}

/** Receives the test scene's section meshes (the renderer's chunk meshes). */
export interface SectionMeshSink {
  update(key: number, originX: number, originY: number, originZ: number, mesh: SectionMesh): void;
  remove(key: number): void;
}

/** Meshes every non-empty section of the test scene on the main thread (built once, no workers). */
export function meshTestScene(world: VoxelWorld, registry: Registry, sink: SectionMeshSink): void {
  const padded = createPadded();
  const fill = {
    belowBlock: registry.unknownBlock,
    missingBlock: registry.air,
    missingLight: FULL_SKY,
    air: registry.air,
  };
  for (const column of world.columns.values()) {
    column.sections.forEach((section, sy) => {
      const key = sectionKey(column.cx, sy, column.cz);
      if (section.isEmpty(registry.air)) {
        sink.remove(key);
        return;
      }
      fillPadded(world, column.cx, sy, column.cz, fill, padded);
      sink.update(
        key,
        column.cx * 32,
        sy * 32,
        column.cz * 32,
        meshSection(padded, registry.tables),
      );
    });
  }
}
