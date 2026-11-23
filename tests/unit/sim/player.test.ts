import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../../../src/sim/commands.ts';
import { STAMINA } from '../../../src/sim/player.ts';
import type { ColumnSource } from '../../../src/sim/ports.ts';
import { stateHash } from '../../../src/sim/stateHash.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

function world(
  options: {
    serialize?: boolean;
    worldType?: 'default' | 'flat';
    seed?: string;
    allowDebug?: boolean;
  } = {},
) {
  const harness = createTestSim({
    seed: options.seed ?? 'player',
    worldType: options.worldType ?? 'flat',
    allowDebug: options.allowDebug ?? true,
    serialize: options.serialize,
  });
  const player = harness.sim.addPlayer(1, 2);
  // Load the area around the spawn and let the player settle.
  harness.host.pumpWorld({ columns: 200 }, harness.events);
  harness.tick(60);
  return { ...harness, player };
}

describe('player in the simulation', () => {
  it('spawns and stands on the flat world surface (y = 65)', () => {
    const { player } = world();
    expect(player.body.y).toBeCloseTo(65, 3);
    expect(player.body.onGround).toBe(true);
  });

  it('drains stamina while sprinting and locks sprint until 30 after running dry', () => {
    const { player, tick } = world();
    tick(30, { forward: 1, sprint: true });
    expect(player.stamina).toBeCloseTo(STAMINA.max - 10 + 10 / 30, 0);
    // 90 left at 10/s: dry after 270 ticks.
    tick(270, { forward: 1, sprint: true });
    expect(player.stamina).toBeLessThan(0.5);
    tick(3, { forward: 1, sprint: true });
    expect(player.stamina).toBe(0);
    expect(player.exhausted).toBe(true);
    // Resting: nothing during the 0.8 s delay (24 ticks), then 25/s; sprint unlocks at 30.
    tick(18);
    expect(player.stamina).toBe(0);
    expect(player.exhausted).toBe(true);
    tick(45);
    expect(player.stamina).toBeGreaterThan(30);
    expect(player.exhausted).toBe(false);
  });

  it('spends 5 stamina per jump', () => {
    const { player, tick } = world();
    const before = player.stamina;
    tick(1, { jump: true });
    expect(player.stamina).toBeCloseTo(before - STAMINA.jump, 5);
  });

  it('teleports onto the surface and refuses debug commands when disabled', () => {
    const allowed = world();
    allowed.host.send({ type: 'debug.teleport', x: 100.5, y: 'surface', z: -40.5 });
    allowed.tick(1);
    expect(allowed.player.body.x).toBeCloseTo(100.5, 5);
    expect(allowed.player.body.y).toBeCloseTo(65, 3);
    const locked = world({ allowDebug: false });
    locked.host.send({ type: 'debug.teleport', x: 100.5, y: 90, z: 0 });
    locked.tick(1);
    expect(locked.events.some((e) => e.type === 'rejected')).toBe(true);
    expect(locked.player.body.x).toBeCloseTo(0.5, 5);
  });

  it('freezes the player until its column is ready', () => {
    // A source that never delivers anything.
    const source: ColumnSource = { connect: () => {}, request: () => {} };
    const { sim, step } = createTestSim({
      seed: 'frozen',
      worldType: 'flat',
      allowDebug: true,
      source,
    });
    const player = sim.addPlayer(1, 2);
    step(60);
    expect(player.body.y).toBe(sim.spawn.y);
  });

  it('is deterministic, also when commands and events go through JSON', () => {
    const script = (tick: (n: number, input?: Partial<InputCommand>) => void) => {
      tick(40, { forward: 1, yaw: 0.3 });
      tick(10, { forward: 1, jump: true, yaw: 0.3 });
      tick(40, { forward: 1, strafe: 1, sprint: true, yaw: -1.2 });
      tick(20, { crouch: true, forward: -1, yaw: 2 });
    };
    const a = world({ worldType: 'default', seed: 'det' });
    const b = world({ worldType: 'default', seed: 'det' });
    const c = world({ worldType: 'default', seed: 'det', serialize: true });
    script(a.tick);
    script(b.tick);
    script(c.tick);
    expect(stateHash(a.sim)).toBe(stateHash(b.sim));
    expect(stateHash(c.sim)).toBe(stateHash(a.sim));
    expect(a.player.body.x).not.toBeCloseTo(a.sim.spawn.x, 1);
  });
});
