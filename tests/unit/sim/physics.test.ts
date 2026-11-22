import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../../src/content/registry.ts';
import {
  createBody,
  type MoveInput,
  PHYSICS,
  type StepResult,
  stepBody,
} from '../../../src/sim/physics.ts';
import {
  createRayHit,
  RAY_SOLID,
  RAY_TARGET_LIQUIDS,
  raycast,
} from '../../../src/world/raycast.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';

const registry = buildRegistry(basePack);
const STONE = registry.defaultState('block:stone');
const WATER = registry.defaultState('block:fresh_water');
const GATE = registry.defaultState('block:gate');
const DT = 1 / 30;

function flat(): VoxelWorld {
  const world = new VoxelWorld(registry.air, registry.unknownBlock);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) world.ensureColumn(cx, cz);
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) world.setBlock(x, 63, z, STONE);
  return world;
}

const idle: MoveInput = {
  forward: 0,
  strafe: 0,
  jump: false,
  jumpAllowed: true,
  sprint: false,
  crouch: false,
  yaw: 0,
};
const out: StepResult = { landedFrom: 0, jumped: false, sprinting: false };

function settle(world: VoxelWorld, x: number, y: number, z: number) {
  const body = createBody(x, y, z);
  for (let i = 0; i < 60; i++) stepBody(body, idle, world, registry.tables, DT, out);
  return body;
}

describe('player physics', () => {
  it('lands exactly on the ground', () => {
    const body = settle(flat(), 0.5, 70, 0.5);
    expect(body.y).toBeCloseTo(64, 3);
    expect(body.onGround).toBe(true);
  });

  it('jumps to an apex of 1.26 reached at tick 9', () => {
    const world = flat();
    const body = settle(world, 0.5, 64, 0.5);
    const heights: number[] = [];
    stepBody(body, { ...idle, jump: true }, world, registry.tables, DT, out);
    heights.push(body.y - 64);
    for (let i = 0; i < 20; i++) {
      stepBody(body, idle, world, registry.tables, DT, out);
      heights.push(body.y - 64);
    }
    const apex = Math.max(...heights);
    expect(apex).toBeCloseTo(1.26, 2);
    expect(heights.indexOf(apex) + 1).toBe(9);
  });

  it('walks about 8.6 m in 2 s and sprints faster', () => {
    const world = flat();
    const walker = settle(world, 0.5, 64, 0.5);
    for (let i = 0; i < 60; i++)
      stepBody(walker, { ...idle, forward: 1 }, world, registry.tables, DT, out);
    expect(-(walker.z - 0.5)).toBeGreaterThan(7.7);
    expect(-(walker.z - 0.5)).toBeLessThan(9.5);
    const runner = settle(world, 0.5, 64, 0.5);
    for (let i = 0; i < 60; i++)
      stepBody(runner, { ...idle, forward: 1, sprint: true }, world, registry.tables, DT, out);
    expect(-(runner.z - 0.5)).toBeGreaterThan(-(walker.z - 0.5) * 1.3);
  });

  it('stops at walls and ceilings without tunnelling', () => {
    const world = flat();
    for (let y = 64; y < 68; y++) for (let x = -3; x <= 3; x++) world.setBlock(x, y, -3, STONE);
    const body = settle(world, 0.5, 64, 0.5);
    for (let i = 0; i < 90; i++)
      stepBody(body, { ...idle, forward: 1, sprint: true }, world, registry.tables, DT, out);
    expect(body.z - PHYSICS.width / 2).toBeGreaterThanOrEqual(-2 - 1e-3);
    // Ceiling right above the head.
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setBlock(x, 66, z, STONE);
    const low = settle(world, 0.5, 64, 0.5);
    stepBody(low, { ...idle, jump: true }, world, registry.tables, DT, out);
    for (let i = 0; i < 10; i++) stepBody(low, idle, world, registry.tables, DT, out);
    expect(low.y + PHYSICS.height).toBeLessThanOrEqual(66 + 1e-3);
  });

  it('does not walk off an edge while crouching', () => {
    const world = new VoxelWorld(registry.air, registry.unknownBlock);
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.ensureColumn(cx, cz);
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) world.setBlock(x, 63, z, STONE);
    const body = settle(world, 1.5, 64, 1.5);
    for (let i = 0; i < 60; i++)
      stepBody(body, { ...idle, forward: 1, crouch: true }, world, registry.tables, DT, out);
    expect(body.y).toBeCloseTo(64, 3);
    expect(body.z).toBeGreaterThan(-0.3 + 1e-3);
  });

  it('keeps jumping for a few ticks after leaving an edge (coyote time)', () => {
    const world = new VoxelWorld(registry.air, registry.unknownBlock);
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.ensureColumn(cx, cz);
    for (let x = -5; x < 5; x++) for (let z = 0; z < 3; z++) world.setBlock(x, 63, z, STONE);
    const body = settle(world, 0.5, 64, 0.5);
    let left = -1;
    for (let i = 0; i < 40 && left < 0; i++) {
      stepBody(body, { ...idle, forward: 1 }, world, registry.tables, DT, out);
      if (!body.onGround) left = i;
    }
    stepBody(body, { ...idle, forward: 1, jump: true }, world, registry.tables, DT, out);
    expect(out.jumped).toBe(true);
  });

  it('swims: slower, lighter gravity, rises while jump is held', () => {
    const world = flat();
    for (let x = -5; x < 5; x++)
      for (let z = -5; z < 5; z++) for (let y = 64; y < 70; y++) world.setBlock(x, y, z, WATER);
    const body = createBody(0.5, 66, 0.5);
    for (let i = 0; i < 10; i++) stepBody(body, idle, world, registry.tables, DT, out);
    expect(body.inWater).toBe(true);
    const y0 = body.y;
    for (let i = 0; i < 20; i++)
      stepBody(body, { ...idle, jump: true }, world, registry.tables, DT, out);
    expect(body.y).toBeGreaterThan(y0);
  });

  /** Water `depth` deep over the stone floor (top at 64 + depth), a bank to the north rising
   * `above` blocks over the water surface; the swimmer starts in the water facing the bank. */
  function swimToBank(depth: number, above: number) {
    const world = flat();
    const surface = 64 + depth;
    for (let x = -5; x < 5; x++) {
      for (let z = -2; z < 10; z++)
        for (let y = 64; y < surface; y++) world.setBlock(x, y, z, WATER);
      for (let z = -38; z < -2; z++)
        for (let y = 64; y < surface + above; y++) world.setBlock(x, y, z, STONE);
    }
    const body = createBody(0.5, surface - 1, 2.5);
    for (let i = 0; i < 300; i++)
      stepBody(body, { ...idle, forward: 1, jump: true }, world, registry.tables, DT, out);
    return { body, top: surface + above };
  }

  it.each([
    [3, 0],
    [3, 1],
    [1, 0],
    [1, 1],
  ])('climbs out of %i-deep water onto a bank %i block(s) above the surface', (depth, above) => {
    const { body, top } = swimToBank(depth, above);
    expect(body.z).toBeLessThan(-2);
    expect(body.y).toBeCloseTo(top, 3);
    expect(body.onGround).toBe(true);
    expect(body.inWater).toBe(false);
  });

  it('cannot climb a bank two blocks above the water, and does not leap against it', () => {
    const { body } = swimToBank(3, 2);
    expect(body.z).toBeGreaterThan(-2);
    expect(body.y).toBeLessThan(67 + 0.3);
  });

  it.each([
    [1, 0],
    [1, 1],
    [2, 1],
    [3, 0],
    [3, 1],
  ])(
    'climbs out from rest against the bank (%i deep, bank +%i) on the first try',
    (depth, above) => {
      const world = flat();
      const surface = 64 + depth;
      for (let x = -5; x < 5; x++) {
        for (let z = -2; z < 10; z++)
          for (let y = 64; y < surface; y++) world.setBlock(x, y, z, WATER);
        for (let z = -38; z < -2; z++)
          for (let y = 64; y < surface + above; y++) world.setBlock(x, y, z, STONE);
      }
      // Float against the bank without jumping, then hold jump.
      const body = createBody(0.5, surface - 1, -1.69);
      for (let i = 0; i < 60; i++)
        stepBody(body, { ...idle, forward: 1 }, world, registry.tables, DT, out);
      // Swim up from wherever it floats, then leap: the first leap must land on the bank.
      let ticks = 0;
      let leaps = 0;
      let rising = false;
      while (ticks < 90 && !(body.onGround && body.y >= surface + above - 1e-3)) {
        stepBody(body, { ...idle, forward: 1, jump: true }, world, registry.tables, DT, out);
        const leap = body.vy > PHYSICS.swimUp;
        if (leap && !rising) leaps++;
        rising = leap;
        ticks++;
      }
      expect(body.y).toBeCloseTo(surface + above, 3);
      expect(leaps).toBe(1);
    },
  );

  it('swims along a tall cliff without leaping out of the water', () => {
    const world = flat();
    for (let x = -5; x < 10; x++)
      for (let z = -38; z < 38; z++) for (let y = 64; y < 67; y++) world.setBlock(x, y, z, WATER);
    for (let x = -8; x < -5; x++)
      for (let z = -38; z < 38; z++) for (let y = 64; y < 75; y++) world.setBlock(x, y, z, STONE);
    const body = createBody(-4.6, 66, 30);
    let maxY = 0;
    for (let i = 0; i < 300; i++) {
      // Heading north, turned slightly west into the cliff.
      stepBody(
        body,
        { ...idle, forward: 1, jump: true, yaw: 0.15 },
        world,
        registry.tables,
        DT,
        out,
      );
      if (i > 60) maxY = Math.max(maxY, body.y);
    }
    expect(body.x).toBeLessThan(-5 + 0.31);
    expect(maxY).toBeLessThan(67 + 0.01);
  });

  it('jumps normally when standing in shallow water, tapped or held', () => {
    for (const held of [1, 3, 30]) {
      const world = flat();
      for (let x = -5; x < 5; x++) for (let z = -5; z < 5; z++) world.setBlock(x, 64, z, WATER);
      const body = settle(world, 0.5, 64, 0.5);
      expect(body.inWater && body.onGround).toBe(true);
      let apex = body.y;
      for (let i = 0; i < 30; i++) {
        stepBody(body, { ...idle, jump: i < held }, world, registry.tables, DT, out);
        apex = Math.max(apex, body.y);
      }
      expect(apex - 64).toBeCloseTo(1.26, 1);
    }
  });

  it('does not jump without stamina, on land or in shallow water, but still swims up', () => {
    const world = flat();
    for (let x = 0; x < 5; x++) for (let z = -5; z < 5; z++) world.setBlock(x, 64, z, WATER);
    // On land: no lift at all. In water the swimmer still bobs up (about 0.84), below a jump (1.26).
    for (const [x, limit] of [
      [-2.5, 0.001],
      [2.5, 0.9],
    ] as const) {
      const body = settle(world, x, 64, 0.5);
      let apex = body.y;
      const tired = { ...idle, jump: true, jumpAllowed: false };
      for (let i = 0; i < 20; i++) {
        stepBody(body, tired, world, registry.tables, DT, out);
        expect(out.jumped).toBe(false);
        apex = Math.max(apex, body.y);
      }
      expect(apex - 64).toBeLessThan(limit);
    }
  });

  it('collides with box shapes (closed gate) but not open ones', () => {
    const world = flat();
    world.setBlock(0, 64, -2, GATE);
    const body = settle(world, 0.5, 64, 0.5);
    for (let i = 0; i < 60; i++)
      stepBody(body, { ...idle, forward: 1 }, world, registry.tables, DT, out);
    // The closed gate panel sits on the north side of its cell (z −2 … −2 + 3/16).
    expect(body.z - PHYSICS.width / 2).toBeGreaterThanOrEqual(-2 + 3 / 16 - 1e-3);
    world.setBlock(0, 64, -2, registry.withState(GATE, 'open', '1'));
    for (let i = 0; i < 30; i++)
      stepBody(body, { ...idle, forward: 1 }, world, registry.tables, DT, out);
    expect(body.z).toBeLessThan(-2);
  });
});

describe('raycast', () => {
  it('solid mode passes through plants and water and stops at collision blocks', () => {
    const world = flat();
    world.setBlock(0, 64, -1, registry.defaultState('block:tall_grass'));
    world.setBlock(0, 64, -2, WATER);
    world.setBlock(0, 64, -3, GATE);
    const hit = raycast(
      world,
      registry.tables,
      0.5,
      64.5,
      0.5,
      0,
      0,
      -1,
      10,
      createRayHit(),
      RAY_SOLID,
    );
    expect(hit.hit).toBe(true);
    expect(hit.z).toBe(-3);
    // Unloaded columns count as solid for probes.
    const edge = raycast(
      world,
      registry.tables,
      0.5,
      64.5,
      0.5,
      1,
      0,
      0,
      200,
      createRayHit(),
      RAY_SOLID,
    );
    expect(edge.hit).toBe(true);
    expect(edge.x).toBe(96);
  });

  it('hits the first targetable block with the entry face normal', () => {
    const world = flat();
    world.setBlock(0, 65, -4, STONE);
    const hit = raycast(world, registry.tables, 0.5, 65.5, 0.5, 0, 0, -1, 10, createRayHit());
    expect(hit.hit).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([0, 65, -4]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 0, 1]);
    expect(hit.distance).toBeCloseTo(3.5, 5);
  });

  it('looks down onto the floor and misses beyond the reach', () => {
    const world = flat();
    const down = raycast(world, registry.tables, 0.5, 65.5, 0.5, 0, -1, 0, 4.5, createRayHit());
    expect([down.y, down.ny]).toEqual([63, 1]);
    const far = raycast(world, registry.tables, 0.5, 70.5, 0.5, 0, 1, 0, 4.5, createRayHit());
    expect(far.hit).toBe(false);
  });

  it('ignores liquids unless asked and reports a zero normal from inside a block', () => {
    const world = flat();
    world.setBlock(0, 64, -2, WATER);
    const dry = raycast(world, registry.tables, 0.5, 64.5, 0.5, 0, 0, -1, 4, createRayHit());
    expect(dry.hit).toBe(false);
    const wet = raycast(
      world,
      registry.tables,
      0.5,
      64.5,
      0.5,
      0,
      0,
      -1,
      4,
      createRayHit(),
      RAY_TARGET_LIQUIDS,
    );
    expect(wet.z).toBe(-2);
    const inside = raycast(world, registry.tables, 0.5, 63.5, 0.5, 0, -1, 0, 4, createRayHit());
    expect([inside.nx, inside.ny, inside.nz]).toEqual([0, 0, 0]);
  });
});
