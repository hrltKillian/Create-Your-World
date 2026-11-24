import type { CreatureState } from '../../src/sim/creatures.ts';
import type { playerTestSim } from './simHarness.ts';

/**
 * Four Trotters grazing on the rim of a pool whose top water cell is `top` (3 deep, dug under the
 * flat ground's feet at 65, x 30..50, z ±8), for `ticks`: how many times one swam in, and how many
 * were still in after `trappedAfter` ticks on end (tests/unit/sim/creatures.test.ts, and the long
 * run in tests/slow/pools.slow.ts).
 */
export function grazeAroundPool(
  s: ReturnType<typeof playerTestSim>,
  top: number,
  ticks: number,
  trappedAfter: number,
): { entered: number; trapped: number } {
  s.fill(30, top + 1, -8, 50, 64, 8, 'block:air');
  s.fill(30, top - 2, -8, 50, top, 8, 'block:fresh_water');
  const rim: [number, number][] = [
    [28.5, 0.5],
    [52.5, 0.5],
    [40.5, 10.5],
    [40.5, -9.5],
  ];
  const trotters = rim.map(([x, z]) => {
    const id = s.sim.nextEntityId;
    s.send({ type: 'debug.spawn', creature: 'creature:trotter', x, y: 'surface', z });
    return { c: s.sim.entities.get(id) as CreatureState, wetSince: -1 };
  });
  let entered = 0;
  for (let t = 0; t < ticks; t += 20) {
    s.step(20);
    for (const tr of trotters) {
      const b = tr.c.body;
      const inPool = b.x > 30 && b.x < 51 && Math.abs(b.z) < 9 && b.y < 64.5;
      if (!inPool) tr.wetSince = -1;
      else if (tr.wetSince < 0) {
        tr.wetSince = t;
        entered++;
      }
    }
  }
  let trapped = 0;
  for (const tr of trotters) if (tr.wetSince >= 0 && ticks - tr.wetSince > trappedAfter) trapped++;
  return { entered, trapped };
}
