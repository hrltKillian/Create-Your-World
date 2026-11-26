import { describe, expect, it } from 'vitest';
import { aabb, moveAxis } from '../../../src/sim/collision.ts';
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
import type { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { emptyWorld, flatWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';

const STONE = registry.defaultState('block:stone');
const WATER = registry.defaultState('block:fresh_water');
const GATE = registry.defaultState('block:gate');
const DT = 1 / 30;

const idle: MoveInput = {
  forward: 0,
  strafe: 0,
  jump: false,
  jumpAllowed: true,
  sprint: false,
  crouch: false,
  speedFactor: 1,
  yaw: 0,
  pitch: 0,
};
const out: StepResult = { landedFrom: 0, jumped: false, sprinting: false };

function settle(world: VoxelWorld, x: number, y: number, z: number) {
  const body = createBody(x, y, z);
  for (let i = 0; i < 60; i++) stepBody(body, idle, world, registry.tables, DT, out);
  return body;
}

describe('player physics', () => {
  it('lands exactly on the ground', () => {
    const body = settle(flatWorld(), 0.5, 70, 0.5);
    expect(body.y).toBeCloseTo(64, 3);
    expect(body.onGround).toBe(true);
  });

  it('jumps to an apex of 1.26 reached at tick 9', () => {
    const world = flatWorld();
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
    const world = flatWorld();
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
    const world = flatWorld();
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
    const world = emptyWorld(1);
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) world.setBlock(x, 63, z, STONE);
    const body = settle(world, 1.5, 64, 1.5);
    for (let i = 0; i < 60; i++)
      stepBody(body, { ...idle, forward: 1, crouch: true }, world, registry.tables, DT, out);
    expect(body.y).toBeCloseTo(64, 3);
    expect(body.z).toBeGreaterThan(-0.3 + 1e-3);
  });

  it('jumps again on each landing while jump is held, never twice in the air', () => {
    const world = flatWorld();
    const body = settle(world, 0.5, 64, 0.5);
    let jumps = 0;
    let landings = 0;
    for (let i = 0; i < 90; i++) {
      const grounded = body.onGround;
      stepBody(body, { ...idle, jump: true }, world, registry.tables, DT, out);
      if (out.jumped) {
        expect(grounded).toBe(true);
        jumps++;
      }
      if (out.landedFrom > 0) landings++;
    }
    // A jump lasts 18 ticks in the air and the next one starts on the tick after its landing.
    expect(jumps).toBe(5);
    expect(landings).toBeGreaterThanOrEqual(jumps - 1);
    // Released: no jump starts once the buffer is over.
    for (let i = 0; i < 60; i++) {
      stepBody(body, idle, world, registry.tables, DT, out);
      if (i > PHYSICS.jumpBufferTicks) expect(out.jumped).toBe(false);
    }
  });

  it('under a low ceiling, a held jump waits its cooldown between two jumps', () => {
    const world = flatWorld();
    // A ceiling 2 blocks over the ground (feet at 64): the head bumps it at once.
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) world.setBlock(x, 66, z, STONE);
    const body = settle(world, 0.5, 64, 0.5);
    const starts: number[] = [];
    for (let i = 0; i < 90; i++) {
      stepBody(body, { ...idle, jump: true }, world, registry.tables, DT, out);
      if (out.jumped) starts.push(i);
    }
    expect(starts.length).toBeGreaterThan(1);
    for (let k = 1; k < starts.length; k++)
      expect(starts[k]! - starts[k - 1]!).toBeGreaterThanOrEqual(PHYSICS.jumpCooldownTicks);
  });

  it('keeps jumping for a few ticks after leaving an edge (coyote time)', () => {
    const world = emptyWorld(1);
    for (let x = -5; x < 5; x++) for (let z = 0; z < 3; z++) world.setBlock(x, 63, z, STONE);
    const body = settle(world, 0.5, 64, 0.5);
    let left = -1;
    for (let i = 0; i < 40 && left < 0; i++) {
      stepBody(body, { ...idle, forward: 1 }, world, registry.tables, DT, out);
      if (!body.onGround) left = i;
    }
    stepBody(body, { ...idle, forward: 1, jump: true }, world, registry.tables, DT, out);
    expect(out.jumped).toBe(true);
    // Held on while it falls past the edge: no second jump in the air.
    for (let i = 0; i < 30; i++) {
      stepBody(body, { ...idle, jump: true }, world, registry.tables, DT, out);
      expect(out.jumped).toBe(false);
    }
    expect(body.onGround).toBe(false);
  });

  it('swims: slower, lighter gravity, rises while jump is held', () => {
    const world = flatWorld();
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

  it('sprints wading in shallow water, as on land but slower', () => {
    const world = flatWorld();
    for (let x = -8; x < 8; x++) for (let z = -30; z < 8; z++) world.setBlock(x, 64, z, WATER);
    // The water stands in a pit: floor at 63, so the feet are in it and the head out.
    for (let x = -8; x < 8; x++) for (let z = -30; z < 8; z++) world.setBlock(x, 63, z, STONE);
    const pace = (sprint: boolean) => {
      const body = createBody(0.5, 64, 0.5);
      for (let i = 0; i < 10; i++) stepBody(body, idle, world, registry.tables, DT, out);
      const z0 = body.z;
      for (let i = 0; i < 30; i++)
        stepBody(body, { ...idle, forward: 1, sprint }, world, registry.tables, DT, out);
      expect(body.inWater && !body.headInWater).toBe(true);
      return (z0 - body.z) / 1;
    };
    const walk = pace(false);
    const run = pace(true);
    expect(out.sprinting).toBe(true);
    expect(walk).toBeCloseTo(PHYSICS.wade, 0);
    expect(run).toBeGreaterThan(walk * 1.3);
    expect(run).toBeLessThan(PHYSICS.sprint);
  });

  it('swims fast along the view when sprinting under water: dives and rises with it', () => {
    const world = flatWorld();
    for (let x = -8; x < 8; x++)
      for (let z = -40; z < 8; z++) for (let y = 64; y < 80; y++) world.setBlock(x, y, z, WATER);
    const swim = (pitch: number) => {
      const body = createBody(0.5, 70, 0.5);
      for (let i = 0; i < 5; i++) stepBody(body, idle, world, registry.tables, DT, out);
      const [y0, z0] = [body.y, body.z];
      for (let i = 0; i < 30; i++)
        stepBody(
          body,
          { ...idle, forward: 1, sprint: true, pitch },
          world,
          registry.tables,
          DT,
          out,
        );
      expect(body.headInWater).toBe(true);
      return { dy: body.y - y0, dz: z0 - body.z };
    };
    const level = swim(0);
    expect(level.dz).toBeGreaterThan(PHYSICS.swim * 1.4);
    expect(Math.abs(level.dy)).toBeLessThan(0.3);
    expect(swim(-0.8).dy).toBeLessThan(-2);
    expect(swim(0.8).dy).toBeGreaterThan(2);
  });

  /** Water `depth` deep over the stone floor (top at 64 + depth), a bank to the north rising
   * `above` blocks over the water surface; the swimmer starts in the water facing the bank. */
  function swimToBank(depth: number, above: number) {
    const world = flatWorld();
    const surface = 64 + depth;
    for (let x = -5; x < 5; x++) {
      for (let z = -2; z < 10; z++)
        for (let y = 64; y < surface; y++) world.setBlock(x, y, z, WATER);
      for (let z = -38; z < -2; z++)
        for (let y = 64; y < surface + above; y++) world.setBlock(x, y, z, STONE);
    }
    const body = createBody(0.5, surface - 1, 2.5);
    // Jump held until the swimmer stands out of the water (held on, it would jump again), then on.
    for (let i = 0; i < 300 && !(body.onGround && !body.feetInWater); i++)
      stepBody(body, { ...idle, forward: 1, jump: true }, world, registry.tables, DT, out);
    for (let i = 0; i < 30; i++)
      stepBody(body, { ...idle, forward: 1 }, world, registry.tables, DT, out);
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
      const world = flatWorld();
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
    const world = flatWorld();
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
      const world = flatWorld();
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
    const world = flatWorld();
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
    const world = flatWorld();
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
    const world = flatWorld();
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
    const world = flatWorld();
    world.setBlock(0, 65, -4, STONE);
    const hit = raycast(world, registry.tables, 0.5, 65.5, 0.5, 0, 0, -1, 10, createRayHit());
    expect(hit.hit).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([0, 65, -4]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 0, 1]);
    expect(hit.distance).toBeCloseTo(3.5, 5);
  });

  it('looks down onto the floor and misses beyond the reach', () => {
    const world = flatWorld();
    const down = raycast(world, registry.tables, 0.5, 65.5, 0.5, 0, -1, 0, 4.5, createRayHit());
    expect([down.y, down.ny]).toEqual([63, 1]);
    const far = raycast(world, registry.tables, 0.5, 70.5, 0.5, 0, 1, 0, 4.5, createRayHit());
    expect(far.hit).toBe(false);
  });

  it('ignores liquids unless asked and reports a zero normal from inside a block', () => {
    const world = flatWorld();
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

describe('collision sweep', () => {
  it('reads a bounded number of cells for a crafted speed', () => {
    const world = flatWorld();
    let reads = 0;
    const getBlock = world.getBlock.bind(world);
    world.getBlock = (x, y, z) => {
      reads++;
      return getBlock(x, y, z);
    };
    aabb.set([0.2, 64, 0.2, 0.8, 65.8, 0.8]);
    expect(moveAxis(world, registry.tables, 0, 1e5)).toBeLessThanOrEqual(16);
    expect(reads).toBeLessThan(200);
  });
});
