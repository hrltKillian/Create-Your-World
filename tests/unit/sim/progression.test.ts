import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import { targetTemperature } from '../../../src/sim/environment.ts';
import { MAX_INVENTORY_SLOTS } from '../../../src/sim/inventory.ts';
import { breakSeconds } from '../../../src/sim/mining.ts';
import { STAMINA } from '../../../src/sim/player.ts';
import {
  levelOf,
  pointsLeft,
  SKILLS,
  type Skill,
  staminaMax,
  strengthFactor,
  xpIntoLevel,
  xpToNext,
} from '../../../src/sim/progression.ts';
import { DAY_TICKS } from '../../../src/sim/time.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * Experience, levels, skills and tasks (plan v3 « M22 »): every number comes from the pack's
 * balance (`progression`).
 */

const b = registry.pack.balance;
const p = b.progression;
type Harness = ReturnType<typeof playerTestSim>;

/** A player with the XP of `levels` levels gained, ready to spend that many points. */
function levelled(seed: string, levels: number): Harness {
  const s = playerTestSim({ seed });
  for (let level = 1; level <= levels; level++) s.player.xp += xpToNext(level, p);
  return s;
}

const spend = (s: Harness, skill: Skill) => rejections(s.send({ type: 'skill.spend', skill }));

describe('levels', () => {
  it('needs xpBase, then xpStep more for each next level', () => {
    expect(levelOf(0, p)).toBe(1);
    expect(levelOf(p.xpBase - 1, p)).toBe(1);
    expect(levelOf(p.xpBase, p)).toBe(2);
    const third = p.xpBase + p.xpBase + p.xpStep;
    expect(levelOf(third - 1, p)).toBe(2);
    expect(levelOf(third, p)).toBe(3);
    expect(xpIntoLevel(third + 7, p)).toBe(7);
    expect(xpToNext(3, p)).toBe(p.xpBase + 2 * p.xpStep);
  });

  it('pays a quest’s XP on its claim, and tells of the level reached', () => {
    const s = playerTestSim({ seed: 'xp-quest' });
    const quest = registry.pack.quests!.find((q) => q.xp && q.condition?.items && !q.requires)!;
    for (const item of quest.condition!.items!) s.give(item);
    s.step(TICKS_PER_SECOND);
    s.player.xp = p.xpBase - 1;
    const events = s.send({ type: 'quest.claim', quest: quest.key });
    expect(eventsOf(events, 'xpGained')).toEqual([
      { type: 'xpGained', playerId: 1, xp: quest.xp, level: 2 },
    ]);
    expect(eventsOf(events, 'levelUp')).toEqual([{ type: 'levelUp', playerId: 1, level: 2 }]);
    expect(pointsLeft(s.player, p)).toBe(1);
  });
});

describe('skills', () => {
  it('spends only points earned, up to the maximum of a skill', () => {
    const s = levelled('skills-cap', p.maxSkill + 1);
    expect(pointsLeft(s.player, p)).toBe(p.maxSkill + 1);
    for (let i = 0; i < p.maxSkill; i++) expect(spend(s, 'endurance')).toEqual([]);
    expect(spend(s, 'endurance')).toEqual(['invalid']);
    expect(spend(s, 'vitality')).toEqual([]);
    expect(spend(s, 'vitality')).toEqual(['invalid']);
    expect(spend(s, 'luck' as Skill)).toEqual(['invalid']);
  });

  it('vitality raises the largest health, endurance the largest stamina', () => {
    const s = levelled('skills-body', 2);
    spend(s, 'vitality');
    spend(s, 'endurance');
    expect(s.player.survival.healthMax).toBe(b.health.max + p.skills.vitality);
    s.send({ type: 'debug.setStat', stat: 'health', value: 1000 });
    expect(s.player.survival.health).toBe(b.health.max + p.skills.vitality);
    const top = STAMINA.max + p.skills.endurance;
    expect(staminaMax(s.player, b, STAMINA.max)).toBe(top);
    s.player.stamina = STAMINA.max;
    s.step(10 * TICKS_PER_SECOND);
    expect(s.player.stamina).toBe(top);
  });

  it('carrying adds bag slots, never past the largest inventory', () => {
    const s = levelled('skills-bag', 2);
    const before = s.player.inventory.length;
    expect(spend(s, 'carrying')).toEqual([]);
    expect(s.player.inventory.length).toBe(before + p.skills.carrying);
    while (s.player.inventory.length < MAX_INVENTORY_SLOTS) s.player.inventory.push(null);
    expect(spend(s, 'carrying')).toEqual(['full']);
  });

  it('metabolism slows hunger and thirst, resistance widens comfort, strength speeds blows', () => {
    // The same effort (exhaustion) costs less hunger, and the thirst drains slower.
    const drained = (points: number) => {
      const s = levelled(`skills-meta-${points}`, points);
      for (let i = 0; i < points; i++) spend(s, 'metabolism');
      const survival = s.player.survival;
      survival.saturation = 0;
      survival.exhaustion = b.hunger.exhaustionPerStep * 4;
      s.step(60 * TICKS_PER_SECOND);
      return [b.hunger.max - survival.hunger, b.thirst.max - survival.thirst];
    };
    const [hunger2, thirst2] = drained(2);
    const [hunger0, thirst0] = drained(0);
    expect(hunger2! / hunger0!).toBeCloseTo(1 - 2 * p.skills.metabolism, 2);
    expect(thirst2! / thirst0!).toBeCloseTo(1 - 2 * p.skills.metabolism, 2);
    const cold = b.climate.comfortMinC - p.skills.resistance;
    expect(targetTemperature(cold, b, 0)).toBeLessThan(0);
    expect(targetTemperature(cold, b, p.skills.resistance)).toBe(0);
    const s = levelled('skills-strength', 1);
    spend(s, 'strength');
    const factor = strengthFactor(s.player, b);
    expect(factor).toBeCloseTo(1 + p.skills.strength, 9);
    const stone = registry.defaultState('block:stone');
    expect(breakSeconds(registry, stone, -1, false, factor)).toBeCloseTo(
      breakSeconds(registry, stone, -1, false, 1) / factor,
      9,
    );
    expect(SKILLS).toHaveLength(6);
  });
});

describe('tasks', () => {
  it('holds distinct tasks drawn from the seed, the same in every run', () => {
    const drawn = (seed: string) => {
      const s = playerTestSim({ seed });
      s.step(TICKS_PER_SECOND);
      return s.player.tasks.map((task) => task.key);
    };
    const first = drawn('tasks-a');
    expect(first).toHaveLength(p.tasks);
    expect(new Set(first).size).toBe(p.tasks);
    expect(drawn('tasks-a')).toEqual(first);
  });

  it('counts the player’s deeds, pays the XP once done and draws another', () => {
    const s = playerTestSim({ seed: 'tasks-dig' });
    s.step(TICKS_PER_SECOND);
    const dig = registry.pack.tasks!.find((task) => task.counter.event === 'placed')!;
    s.player.tasks[0] = { key: dig.key, progress: dig.counter.count - 1 };
    expect(rejections(s.send({ type: 'task.claim', index: 0 }))).toEqual(['not done']);
    s.give('item:dirt');
    s.player.input = {
      ...s.player.input,
      slot: s.player.inventory.findIndex((st) => st?.item === 'item:dirt'),
    };
    s.tick(1, {
      secondary: true,
      target: { x: 2, y: 64, z: 0, face: 2 },
      slot: s.player.input.slot,
    });
    s.tick(1);
    expect(s.player.tasks[0]!.progress).toBe(dig.counter.count);
    const events = s.send({ type: 'task.claim', index: 0 });
    expect(eventsOf(events, 'xpGained')[0]!.xp).toBe(dig.xp);
    expect(s.player.tasks[0]!.key).not.toBe(dig.key);
    expect(s.player.tasks[0]!.progress).toBe(0);
  });

  it('redraws a task once a game day, never one done', () => {
    const s = playerTestSim({ seed: 'tasks-reroll' });
    s.step(TICKS_PER_SECOND);
    const before = s.player.tasks[1]!.key;
    expect(rejections(s.send({ type: 'task.reroll', index: 1 }))).toEqual([]);
    expect(s.player.tasks[1]!.key).not.toBe(before);
    expect(rejections(s.send({ type: 'task.reroll', index: 2 }))).toEqual(['tomorrow']);
    s.sim.time.ticks += DAY_TICKS;
    expect(rejections(s.send({ type: 'task.reroll', index: 2 }))).toEqual([]);
    expect(rejections(s.send({ type: 'task.reroll', index: 7 }))).toEqual(['invalid']);
  });
});

describe('level rewards', () => {
  it('a backpack frame adds its slots once used, refused on a full-size bag', () => {
    const s = playerTestSim({ seed: 'frame' });
    const frame = registry.items.find((item) => (item.consume?.bagSlots ?? 0) > 0)!;
    s.give(frame.key, 2);
    const slot = s.player.inventory.findIndex((stack) => stack?.item === frame.key);
    const hold = Math.ceil(frame.consume!.seconds * TICKS_PER_SECOND) + 2;
    const before = s.player.inventory.length;
    s.tick(hold, { secondary: true, slot });
    s.tick(1, { slot });
    expect(s.player.inventory.length).toBe(before + frame.consume!.bagSlots!);
    while (s.player.inventory.length < MAX_INVENTORY_SLOTS) s.player.inventory.push(null);
    s.events.length = 0;
    s.tick(hold, { secondary: true, slot });
    expect(eventsOf(s.events, 'hint').map((e) => e.key)).toContain('hint.bagFull');
    expect(s.player.inventory[slot]?.item).toBe(frame.key);
  });

  it('a recipe of a level is refused below it', () => {
    const s = playerTestSim({ seed: 'level-recipe' });
    const levelled = registry.crafting.recipes.filter((r) => r.level !== undefined);
    expect(levelled.length).toBeGreaterThanOrEqual(2);
    const recipe = levelled[0]!;
    for (const input of recipe.inputs) s.give(input.item, input.count);
    s.step(1);
    const enqueue = () =>
      rejections(s.send({ type: 'craft.enqueue', recipe: recipe.key, count: 1 }));
    expect(enqueue()).toEqual(['level']);
    for (let level = 1; level < recipe.level!; level++) s.player.xp += xpToNext(level, p);
    // At its level: past that rule (here to the workbench's own).
    expect(enqueue()).toEqual(['station']);
  });
});
