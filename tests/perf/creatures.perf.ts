import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events.ts';
import { createInlineSim } from '../../src/sim/testing/inlineSim.ts';
import { registry } from '../helpers/registry.ts';

/**
 * Creatures (docs « M10 »: 60 creatures in one tick ≤ 3 ms under Node): a flat world at night with
 * 60 creatures of every kind around a player they hunt, flee or watch, who paces in the middle of
 * a column (no streaming) and swings, the whole simulation tick measured (thoughts, sight tests,
 * A* searches, movement, blows both ways), its 95th percentile after a warm-up: busy ticks with
 * two A* searches, not a garbage collection or a compilation that a loaded machine stretches.
 * Apple M4: a median about 0.1 ms, a p95 about 0.2 ms.
 */
const TICK_MAX_MS = 3;
/** The middle of column (0, 0). */
const CENTRE = 16.5;
const KINDS = [
  ['creature:prowler', 18],
  ['creature:swarmling', 18],
  ['creature:trotter', 12],
  ['creature:shagback', 6],
  ['creature:shellback', 6],
] as const;

describe('creature performance', () => {
  it(`runs a tick of 60 creatures in ≤ ${TICK_MAX_MS} ms (p95)`, () => {
    const { sim, host, events } = createInlineSim({
      registry,
      seed: 'creatures-perf',
      worldType: 'flat',
      allowDebug: true,
    });
    sim.addPlayer(1, 3);
    host.send({ type: 'debug.teleport', x: CENTRE, y: 65, z: CENTRE });
    for (let i = 0; i < 200; i++) host.advance(1, events);
    host.send({ type: 'debug.setTime', hours: 23 });
    host.send({ type: 'debug.freezeTime', frozen: true });
    host.send({ type: 'debug.god', on: true });
    let n = 0;
    for (const [creature, count] of KINDS) {
      for (let i = 0; i < count; i++, n++) {
        // A ring 8 to 38 blocks around the player.
        const angle = n * 2.399;
        const r = 8 + (n % 7) * 5;
        const x = CENTRE + Math.cos(angle) * r;
        const z = CENTRE + Math.sin(angle) * r;
        host.send({ type: 'debug.spawn', creature, x, y: 'surface', z });
      }
    }
    host.advance(1, events);
    const creatures = () => [...sim.entities.values()].filter((e) => e.kind === 'creature').length;
    expect(creatures()).toBe(60);
    const out: SimEvent[] = [];
    const times: number[] = [];
    for (let i = 0; i < 400; i++) {
      // The player paces back and forth and swings (melee aim): creatures hear, chase and plan
      // again.
      host.send({
        type: 'input',
        forward: 1,
        strafe: 0,
        jump: false,
        sprint: false,
        crouch: false,
        yaw: Math.floor(i / 40) % 2 === 0 ? 0 : Math.PI,
        pitch: -0.3,
        primary: i % 8 < 4,
        secondary: false,
        slot: 0,
      });
      const t0 = performance.now();
      host.advance(1, out);
      if (i >= 100) times.push(performance.now() - t0);
      out.length = 0;
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    const worst = times.at(-1)!;
    console.info(
      `60 creatures: tick median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, ` +
        `worst ${worst.toFixed(3)} ms, ` +
        `${creatures()} left`,
    );
    expect(creatures()).toBeGreaterThanOrEqual(50);
    expect(p95).toBeLessThanOrEqual(TICK_MAX_MS);
  });

  it(`runs a tick of 60 hungry, thirsty, calm creatures in ≤ ${TICK_MAX_MS} ms (p95)`, () => {
    // Plant eaters by day, far from the player, with nothing to eat or drink around (docs plan v2
    // « M17 »: a creature looks for its needs once a rest, never every thought).
    const { sim, host, events } = createInlineSim({
      registry,
      seed: 'needs-perf',
      worldType: 'flat',
      allowDebug: true,
    });
    sim.addPlayer(1, 3);
    host.send({ type: 'debug.teleport', x: CENTRE, y: 65, z: CENTRE });
    for (let i = 0; i < 200; i++) host.advance(1, events);
    host.send({ type: 'debug.setTime', hours: 12 });
    host.send({ type: 'debug.freezeTime', frozen: true });
    for (let n = 0; n < 60; n++) {
      const angle = n * 2.399;
      const r = 20 + (n % 5) * 3;
      const creature = n % 2 === 0 ? 'creature:trotter' : 'creature:shagback';
      host.send({
        type: 'debug.spawn',
        creature,
        x: CENTRE + Math.cos(angle) * r,
        y: 'surface',
        z: CENTRE + Math.sin(angle) * r,
      });
    }
    host.advance(1, events);
    for (const c of sim.entities.values())
      if (c.kind === 'creature') Object.assign(c, { hunger: 0, thirst: 0 });
    const out: SimEvent[] = [];
    const times: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t0 = performance.now();
      host.advance(1, out);
      if (i >= 100) times.push(performance.now() - t0);
      out.length = 0;
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.info(`60 needy creatures: tick p95 ${p95.toFixed(3)} ms`);
    expect(p95).toBeLessThanOrEqual(TICK_MAX_MS);
  });
});
