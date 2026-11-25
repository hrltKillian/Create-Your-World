import { describe, expect, it } from 'vitest';
import { armorFactor, COMBAT, strike } from '../../../src/sim/combat.ts';
import type { CreatureState } from '../../../src/sim/creatures.ts';
import { MELEE, meleeDamage, meleeKnockback } from '../../../src/sim/melee.ts';
import { eyeHeight } from '../../../src/sim/physics.ts';
import { addEffect } from '../../../src/sim/survival.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * The player's side of combat (docs « Combat »): light and charged blows, stealth, Weakened,
 * the weapon's cooldown and wear, primary's priority over mining, and the player's armour,
 * invulnerability and dodge against a creature's blow. The player stands at (0.5, 65, 0.5) looking
 * north (−z) in a flat world at noon.
 */

type Harness = ReturnType<typeof playerTestSim>;

const balance = registry.pack.balance;
const spear = registry.item('item:flint_spear')!.weapon!;
const knife = registry.item('item:flint_knife')!.weapon!;
const hand = balance.combat.hand;

function world(seed: string): Harness {
  const s = playerTestSim({ seed });
  s.send({ type: 'debug.setTime', hours: 12 }, { type: 'debug.freezeTime', frozen: true });
  return s;
}

/** Places a creature on the ground (facing the player) and returns it. */
function place(s: Harness, creature: string, x: number, z: number): CreatureState {
  const before = s.sim.nextEntityId;
  expect(rejections(s.send({ type: 'debug.spawn', creature, x, y: 'surface', z }))).toEqual([]);
  const c = s.sim.entities.get(before);
  if (c?.kind !== 'creature') throw new Error('no creature placed');
  return c;
}

/** A Trotter 2 blocks north of the player, idle; `unaware` turns its back to the player. */
function trotter(s: Harness, unaware: boolean, z = -1.5): CreatureState {
  const c = place(s, 'creature:trotter', 0.5, z);
  c.modeTicks = 600;
  if (unaware) c.yaw = 0;
  return c;
}

/** Pitch of the view from the player's eye towards the middle of a creature's body. */
function pitchAt(s: Harness, c: CreatureState): number {
  const b = s.player.body;
  const def = registry.creature(c.creature)!;
  const dy = c.body.y + def.hitbox[1] / 2 - (b.y + eyeHeight(b));
  return Math.atan2(dy, Math.hypot(c.body.x - b.x, c.body.z - b.z));
}

/** Holds primary for `hold` ticks, then releases it (the blow lands on the release). */
function click(s: Harness, pitch: number, hold = 1): void {
  s.tick(hold, { primary: true, pitch });
  s.tick(1, { pitch });
}

/** The damage of each blow on creatures since `events` was last cleared. */
const blows = (s: Harness) => eventsOf(s.events, 'creatureHurt').map((e) => e.amount);

describe('melee formulas', () => {
  it('charged blows deal ×1.8 and knock back ×1.5, stealthy ones ×1.5, Weakened ×0.8', () => {
    expect(meleeDamage(spear, false, false, 1)).toBe(6);
    expect(meleeDamage(spear, false, true, 1)).toBeCloseTo(9, 9);
    expect(meleeDamage(knife, true, false, 1)).toBeCloseTo(4 * 1.8, 9);
    expect(meleeDamage(knife, true, true, 1)).toBeCloseTo(4 * 1.8 * 1.5, 9);
    expect(meleeDamage(hand, false, false, balance.respawn.weakenedDamage)).toBeCloseTo(1.6, 9);
    expect(meleeKnockback(hand, false)).toBe(1);
    expect(meleeKnockback(hand, true)).toBe(1.5);
    expect(MELEE.chargeTicks).toBe(15);
  });

  it('armour lets 20/(20 + A) of the damage through', () => {
    expect(armorFactor(0)).toBe(1);
    expect(armorFactor(20)).toBe(0.5);
    expect(armorFactor(6)).toBeCloseTo(20 / 26, 12);
  });
});

describe('melee', () => {
  it('a first stealthy spear blow on a Trotter deals 9, 6 without stealth', () => {
    const run = (unaware: boolean) => {
      const s = world(`spear-${unaware}`);
      s.give('item:flint_spear');
      const c = trotter(s, unaware);
      s.events.length = 0;
      click(s, pitchAt(s, c));
      return blows(s);
    };
    expect(run(true)).toEqual([9]);
    expect(run(false)).toEqual([6]);
  });

  it('a charged blow lands on the release after 0.5 s (15 ticks held): ×1.8 damage and ×1.5 knockback', () => {
    const run = (hold: number) => {
      const s = world(`charge-${hold}`);
      s.give('item:flint_knife');
      const c = trotter(s, true);
      s.events.length = 0;
      const pitch = pitchAt(s, c);
      s.tick(hold, { primary: true, pitch });
      expect(blows(s)).toEqual([]);
      expect(s.player.charge).toBe(hold);
      s.tick(1, { pitch });
      expect(s.player.charge).toBe(-1);
      return { dealt: blows(s), speed: Math.hypot(c.body.vx, c.body.vz) };
    };
    const light = run(MELEE.chargeTicks - 1);
    const charged = run(MELEE.chargeTicks);
    expect(light.dealt[0]).toBeCloseTo(4 * 1.5, 9);
    expect(charged.dealt[0]).toBeCloseTo(4 * 1.8 * 1.5, 9);
    expect(charged.speed / light.speed).toBeCloseTo(1.5, 1);
  });

  it('a Weakened player deals 20 % less', () => {
    const s = world('weakened');
    addEffect(s.player.survival, 'weakened', 600);
    const c = trotter(s, true);
    s.events.length = 0;
    click(s, pitchAt(s, c));
    expect(blows(s)[0]).toBeCloseTo(hand.damage * 1.5 * 0.8, 9);
  });

  it("waits out the weapon's cooldown between two blows", () => {
    const s = world('cooldown');
    s.give('item:flint_spear');
    const c = trotter(s, true);
    const pitch = pitchAt(s, c);
    const { x, y, z } = c.body;
    s.events.length = 0;
    click(s, pitch);
    expect(blows(s)).toHaveLength(1);
    expect(s.player.attackCooldown).toBe(Math.round(spear.cooldown * 30) - 1);
    // Back in place, idle and hurtable again: a click during the cooldown does nothing.
    const reset = () => {
      Object.assign(c.body, { x, y, z, vx: 0, vy: 0, vz: 0 });
      Object.assign(c, { invulnerable: 0, mode: 'idle', modeTicks: 600 });
      s.sim.spatial.update(c.id, x, z);
    };
    reset();
    click(s, pitch);
    expect(blows(s)).toHaveLength(1);
    while (s.player.attackCooldown > 0) s.step(1);
    reset();
    click(s, pitch);
    expect(blows(s)).toHaveLength(2);
  });

  it('primary attacks a creature in reach before the block behind it, else mines', () => {
    const run = (withTrotter: boolean) => {
      const s = world(`priority-${withTrotter}`);
      s.put(0, 65, -3, 'block:stone');
      const pitch = Math.atan2(65.65 - (65 + eyeHeight(s.player.body)), 2.5);
      if (withTrotter) trotter(s, true);
      s.events.length = 0;
      s.tick(5, { primary: true, pitch });
      const mining = eventsOf(s.events, 'mineProgress').length > 0;
      const charging = s.player.charge >= 0;
      s.tick(1, { pitch });
      return { mining, charging, blows: blows(s).length };
    };
    expect(run(true)).toEqual({ mining: false, charging: true, blows: 1 });
    expect(run(false)).toEqual({ mining: true, charging: false, blows: 0 });
  });

  it('a charge held at death is dropped: no blow after the respawn without a click', () => {
    const s = world('charge-death');
    const c = trotter(s, true);
    const pitch = pitchAt(s, c);
    s.tick(20, { primary: true, pitch });
    expect(s.player.charge).toBeGreaterThan(0);
    s.send({ type: 'debug.kill', cause: 'fall' });
    s.tick(30, { pitch });
    expect(s.player.charge).toBe(-1);
    s.send({ type: 'player.respawn' });
    s.events.length = 0;
    s.tick(10, { pitch: pitchAt(s, c) });
    expect(blows(s)).toEqual([]);
  });

  it('attacks a creature in or behind a plant or a torch, which stays (creatures are tested first)', () => {
    const run = (block: string, creature: string, z: number) => {
      const s = world(`through-${block}-${creature}`);
      s.give('item:flint_spear');
      const c = place(s, creature, 0.5, z);
      c.modeTicks = 600;
      s.put(0, 65, -2, block);
      s.events.length = 0;
      click(s, pitchAt(s, c));
      return { blows: blows(s).length, kept: s.block(0, 65, -2) === block };
    };
    expect(run('block:tall_grass', 'creature:trotter', -1.5)).toEqual({ blows: 1, kept: true });
    expect(run('block:tall_grass', 'creature:swarmling', -1.5)).toEqual({ blows: 1, kept: true });
    expect(run('block:torch[attach=floor]', 'creature:swarmling', -3)).toEqual({
      blows: 1,
      kept: true,
    });
  });

  it('a solid block on the line shields a creature: primary mines the block', () => {
    const s = world('shield');
    s.give('item:flint_spear');
    const c = place(s, 'creature:swarmling', 0.5, -3);
    c.modeTicks = 600;
    s.put(0, 65, -2, 'block:glass');
    s.events.length = 0;
    click(s, pitchAt(s, c));
    expect(blows(s)).toEqual([]);
    expect(eventsOf(s.events, 'mineProgress').length).toBeGreaterThan(0);
  });

  it('a creature out of the weapon’s reach is not attacked', () => {
    const s = world('reach');
    const c = trotter(s, true, -3.5);
    s.events.length = 0;
    click(s, pitchAt(s, c));
    expect(blows(s)).toEqual([]);
    s.give('item:flint_spear');
    click(s, pitchAt(s, c));
    expect(blows(s)).toHaveLength(1);
  });

  it('a killed Trotter leaves meat and hide; a hatchet wears by one use a blow', () => {
    const s = world('kill');
    s.give('item:flint_hatchet');
    const c = trotter(s, true);
    c.health = 3;
    s.events.length = 0;
    click(s, pitchAt(s, c));
    expect(eventsOf(s.events, 'creatureDied')).toHaveLength(1);
    expect(eventsOf(s.events, 'sound').map((e) => e.sfx)).toContain('sfx:melee_hit');
    const uses = registry.itemTables.durability[registry.itemId('item:flint_hatchet')]!;
    expect(s.player.inventory[0]!.durability).toBe(uses - 1);
    s.step(30);
    expect(s.sim.entities.has(c.id)).toBe(false);
    const drops = [...s.sim.entities.values()].flatMap((e) =>
      e.kind === 'itemDrop' ? [e.item] : [],
    );
    expect(drops.sort()).toEqual(['item:raw_hide', 'item:raw_meat']);
  });
  it.each([
    ['item:flint_knife', 60],
    ['item:flint_spear', 60],
    ['item:copper_blade', 160],
    ['item:iron_blade', 640],
  ])('a %s has its tier’s durability and wears by one use a blow', (weapon, uses) => {
    expect(registry.itemTables.durability[registry.itemId(weapon)]).toBe(uses);
    const s = world(`wear-${weapon}`);
    s.give(weapon);
    const c = trotter(s, true);
    click(s, pitchAt(s, c));
    expect(s.player.inventory[0]!.durability).toBe(uses - 1);
  });
});

describe("a creature's blow", () => {
  /** An idle Shagback 2 blocks north of the player, within its reach. */
  function shagback(s: Harness): CreatureState {
    const c = place(s, 'creature:shagback', 0.5, -1.5);
    c.modeTicks = 600;
    return c;
  }
  const def = registry.creature('creature:shagback')!;

  it('the player is invulnerable for 15 ticks after a hit', () => {
    const s = world('invulnerable');
    const c = shagback(s);
    expect(strike(s.sim, c, def, s.player, [])).toBe(true);
    expect(s.player.survival.health).toBeCloseTo(100 - def.attack!.damage, 9);
    expect(strike(s.sim, c, def, s.player, [])).toBe(false);
    // The blow knocked the player back: back in reach for the last tick of invulnerability.
    s.step(COMBAT.playerInvulnerableTicks - 2);
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
    expect(s.player.invulnerable).toBe(1);
    expect(strike(s.sim, c, def, s.player, [])).toBe(false);
    s.step(1);
    expect(strike(s.sim, c, def, s.player, [])).toBe(true);
  });

  it('worn armour takes its share and the hurt sound plays', () => {
    const s = world('armour');
    s.player.equipment[2] = { item: 'item:bronze_cuirass', count: 1 };
    const out: Parameters<typeof strike>[4] = [];
    expect(strike(s.sim, shagback(s), def, s.player, out)).toBe(true);
    expect(100 - s.player.survival.health).toBeCloseTo(def.attack!.damage * armorFactor(6), 9);
    expect(eventsOf(out, 'sound').map((e) => e.sfx)).toEqual(['sfx:player_hurt']);
  });

  it('every worn piece but a filter loses a use a hit landed; a worn-out one is gone', () => {
    const s = world('gear-wear');
    const cuirass = registry.itemTables.durability[registry.itemId('item:bronze_cuirass')]!;
    s.player.equipment[0] = { item: 'item:fur_hood', count: 1, durability: 1 };
    s.player.equipment[1] = { item: 'item:filter_mask', count: 1 };
    s.player.equipment[2] = { item: 'item:bronze_cuirass', count: 1 };
    const out: Parameters<typeof strike>[4] = [];
    expect(strike(s.sim, shagback(s), def, s.player, out)).toBe(true);
    expect(s.player.equipment[0]).toBeNull();
    expect(s.player.equipment[1]!.durability).toBeUndefined();
    expect(s.player.equipment[2]!.durability).toBe(cuirass - 1);
    expect(eventsOf(out, 'inventoryChanged')).toHaveLength(1);
    // A dodged blow wears nothing.
    s.player.invulnerable = 0;
    s.fill(0, 65, -1, 0, 67, -1, 'block:stone');
    expect(strike(s.sim, shagback(s), def, s.player, [])).toBe(false);
    expect(s.player.equipment[2]!.durability).toBe(cuirass - 1);
  });

  it('lands on a player standing in its own block column (both eyes in one cell)', () => {
    const s = world('point-blank');
    const c = place(s, 'creature:shagback', 0.3, 0.3);
    expect(Math.floor(c.body.x)).toBe(Math.floor(s.player.body.x));
    expect(strike(s.sim, c, def, s.player, [])).toBe(true);
    expect(s.player.survival.health).toBeCloseTo(100 - def.attack!.damage, 9);
  });

  it('a wall between them at the impact dodges the blow', () => {
    const s = world('wall');
    const c = shagback(s);
    s.fill(0, 65, -1, 0, 67, -1, 'block:stone');
    expect(strike(s.sim, c, def, s.player, [])).toBe(false);
    expect(s.player.survival.health).toBe(100);
  });

  it.each([
    ['glass', 'block:glass', 'block:glass'],
    ['foliage', 'block:foliage', 'block:foliage'],
    ['gate', 'block:gate[facing4=s,open=0,half=lower]', 'block:gate[facing4=s,open=0,half=upper]'],
  ])('a wall of %s (solid, not opaque) dodges the blow', (name, lower, upper) => {
    const s = world(`see-through-${name}`);
    const c = shagback(s);
    s.put(0, 65, -1, lower);
    s.put(0, 66, -1, upper);
    expect(strike(s.sim, c, def, s.player, [])).toBe(false);
    expect(s.player.survival.health).toBe(100);
  });

  it.each([
    ['block:campfire[lit=1]', false],
    ['block:chest[facing4=n]', false],
    ['block:glowbloom_lantern', false],
    ['block:campfire[lit=1]', true],
    ['block:chest[facing4=n]', true],
  ])('a low %s lets a Prowler’s blow over it land (crouching: %s)', (state, crouching) => {
    const s = world(`low-block-${state}-${crouching}`);
    const prowler = registry.creature('creature:prowler')!;
    const c = place(s, 'creature:prowler', 0.5, -1.6);
    c.modeTicks = 600;
    s.put(0, 65, -1, state);
    s.player.body.crouching = crouching;
    for (const pz of [0.2375, 0.35, 0.5])
      for (const cz of [-1.52, -1.6, -1.7, -1.88]) {
        s.player.body.z = pz;
        c.body.z = cz;
        s.player.invulnerable = 0;
        s.player.survival.health = 100;
        expect(strike(s.sim, c, prowler, s.player, []), `player ${pz}, Prowler ${cz}`).toBe(true);
        expect(s.player.survival.health).toBeLessThan(100);
      }
  });

  it('a creature is invulnerable for 8 ticks after a blow', () => {
    const s = world('creature-invulnerable');
    const c = trotter(s, true);
    s.events.length = 0;
    click(s, pitchAt(s, c));
    expect(c.invulnerable).toBe(COMBAT.creatureInvulnerableTicks - 1);
    expect(blows(s)).toHaveLength(1);
  });
});
