import { describe, expect, it } from 'vitest';
import { anglesTo } from '../../../src/core/angles.ts';
import { MET, STUDIED } from '../../../src/sim/bestiary.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { hurtCreature } from '../../../src/sim/combat.ts';
import type { CreatureState } from '../../../src/sim/creatures.ts';
import { eyeHeight } from '../../../src/sim/physics.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * The bestiary and the scanner (docs plan v2 « M17 »): met when seen or struck, studied by a worn
 * scanner after its seconds on the creature, or by a kill.
 */

type Harness = ReturnType<typeof playerTestSim>;

function scene(seed: string) {
  const s = playerTestSim({ seed });
  s.send({ type: 'debug.setTime', hours: 12 }, { type: 'debug.freezeTime', frozen: true });
  s.send({ type: 'debug.god', on: true });
  const id = s.sim.nextEntityId;
  const events = s.send({
    type: 'debug.spawn',
    creature: 'creature:shagback',
    x: 0.5,
    y: 'surface',
    z: -8.5,
  });
  expect(rejections(events)).toEqual([]);
  const c = s.sim.entities.get(id) as CreatureState;
  // Kept still: it neither wanders off nor turns on the player.
  c.modeTicks = 100_000;
  return { s, c };
}

/** The view from the player's eye to the creature's middle. */
function lookAt(s: Harness, c: CreatureState) {
  const b = s.player.body;
  return anglesTo(
    { x: b.x, y: b.y + eyeHeight(b), z: b.z },
    { x: c.body.x, y: c.body.y + 0.7, z: c.body.z },
  );
}

const wearScanner = (s: Harness) => {
  s.player.equipment[0] = { item: 'item:scanner', count: 1, durability: 600 };
};

describe('the bestiary', () => {
  it('meets a creature the player sees, and a worn scanner studies it after 2 s of looking', () => {
    const { s, c } = scene('scan');
    const view = lookAt(s, c);
    s.tick(15, { ...view });
    expect(s.player.bestiary['creature:shagback']).toBe(MET);
    wearScanner(s);
    s.events.length = 0;
    // Looking away before the end starts the scan over.
    s.tick(ticksOf(1.5), { ...view });
    s.tick(5, { yaw: view.yaw + Math.PI, pitch: 0 });
    expect(s.player.scanId).toBe(-1);
    s.tick(ticksOf(1.5), { ...view });
    expect(s.player.bestiary['creature:shagback']).toBe(MET);
    s.tick(ticksOf(0.6), { ...view });
    expect(s.player.bestiary['creature:shagback']).toBe(STUDIED);
    expect(eventsOf(s.events, 'bestiary').map((e) => e.level)).toEqual([STUDIED]);
  });

  it('a scanner does not reach past its range, nor through stone', () => {
    const { s, c } = scene('scan-far');
    wearScanner(s);
    s.fill(-2, 65, -4, 2, 68, -4, 'block:stone');
    s.tick(ticksOf(3), { ...lookAt(s, c) });
    expect(s.player.bestiary['creature:shagback'] ?? 0).toBe(0);
    s.fill(-2, 65, -4, 2, 68, -4, 'block:air');
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 25.5 });
    s.tick(ticksOf(3), { ...lookAt(s, c) });
    expect(s.player.bestiary['creature:shagback'] ?? 0).toBeLessThan(STUDIED);
  });

  it('a blow meets the creature, a kill studies it', () => {
    const { s, c } = scene('kill');
    const out = s.events;
    hurtCreature(s.sim, c, 1, s.player.body.x, s.player.body.z, 0, s.player.id, out);
    expect(s.player.bestiary['creature:shagback']).toBe(MET);
    c.invulnerable = 0;
    hurtCreature(s.sim, c, 100, s.player.body.x, s.player.body.z, 0, s.player.id, out);
    expect(s.player.bestiary['creature:shagback']).toBe(STUDIED);
  });
});
