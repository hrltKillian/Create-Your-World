import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { lookVector, type Vec3 } from '../../../src/core/angles.ts';
import { addStrings, i18nMissing } from '../../../src/i18n/i18n.ts';
import { createSurvival, DEATH_CAUSES } from '../../../src/sim/survival.ts';
import { DAY_TICKS, HOUR_TICKS, hourOf } from '../../../src/sim/time.ts';
import { clockText } from '../../../src/ui/hud/clock.ts';
import { CombatMarks, damageBearing } from '../../../src/ui/hud/combatMarks.ts';
import {
  bearingOf,
  Compass,
  compassOffset,
  headingOf,
  POINT_BEARINGS,
} from '../../../src/ui/hud/compass.ts';
import {
  FADE_SECONDS,
  PICKUP_LINES,
  PICKUP_SECONDS,
  PickupFeed,
} from '../../../src/ui/hud/pickups.ts';
import { PinnedQuest } from '../../../src/ui/hud/pinnedQuest.ts';
import { VIGNETTES, type Vignette, vignetteLevels } from '../../../src/ui/hud/vignettes.ts';
import { BREATH_BUBBLES, Vitals } from '../../../src/ui/hud/vitals.ts';
import { questLine, questRows } from '../../../src/ui/quests.ts';
import { DeathScreen } from '../../../src/ui/screens/death.ts';
import { QuestsPanel } from '../../../src/ui/screens/questsPanel.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * The HUD's pure formatting and selection (compass bearings, clock text, quest rows,
 * vignette levels) and its views on the fake DOM. Thresholds come from the pack's balance.
 */

const b = basePack.balance;
const QUARTER = Math.PI / 2;
const fake = (element: HTMLElement) => element as unknown as FakeElement;
const levels = (): Record<Vignette, number> => ({
  health: 0,
  cold: 0,
  heat: 0,
  toxicity: 0,
  water: 0,
});

beforeEach(() => {
  installFakeDom();
  addStrings(basePack.strings);
});
afterEach(removeFakeDom);

describe('compass', () => {
  it('measures bearings clockwise from north (−z), east being +x', () => {
    expect(bearingOf(0, -1)).toBeCloseTo(POINT_BEARINGS.north);
    expect(bearingOf(1, 0)).toBeCloseTo(POINT_BEARINGS.east);
    expect(bearingOf(0, 1)).toBeCloseTo(POINT_BEARINGS.south);
    expect(bearingOf(-1, 0)).toBeCloseTo(POINT_BEARINGS.west);
    expect(bearingOf(1, -1)).toBeCloseTo(QUARTER / 2);
  });

  it('heads where the view looks, for any yaw', () => {
    const dir: Vec3 = { x: 0, y: 0, z: 0 };
    for (const yaw of [0, 0.4, QUARTER, 2, -1.3, 7]) {
      lookVector(yaw, 0, dir);
      expect(headingOf(yaw)).toBeCloseTo(bearingOf(dir.x, dir.z));
    }
    // Turning left (a positive yaw) faces west.
    expect(headingOf(QUARTER)).toBeCloseTo(POINT_BEARINGS.west);
  });

  it('places a bearing on the strip, wrapping around north, and hides what is behind', () => {
    expect(compassOffset(POINT_BEARINGS.north, 0, QUARTER)).toBe(0);
    expect(compassOffset(POINT_BEARINGS.east, 0, QUARTER)).toBeCloseTo(1);
    expect(compassOffset(QUARTER / 2, 0, QUARTER)).toBeCloseTo(0.5);
    expect(compassOffset(POINT_BEARINGS.west, 0, QUARTER)).toBeCloseTo(-1);
    // 350° seen from 10°: 20° to the left.
    const deg = Math.PI / 180;
    expect(compassOffset(350 * deg, 10 * deg, QUARTER)).toBeCloseTo(-20 / 90);
    expect(compassOffset(POINT_BEARINGS.south, 0, QUARTER)).toBeNaN();
  });

  it('moves its marks through CSS variables and hides those behind the player', () => {
    const compass = new Compass();
    const marks = fake(compass.element).findAll((e) => e.className.includes('compass-mark'));
    const north = marks.find((m) => m.textContent === 'N')!;
    const south = marks.find((m) => m.textContent === 'S')!;
    compass.update(0, {
      sun: QUARTER / 2,
      moon: Number.NaN,
      quest: Number.NaN,
      graves: [0],
      waypoints: [],
    });
    expect(north.style.getPropertyValue('--x')).toBe('0');
    expect(north.style.getPropertyValue('--o')).toBe('1');
    expect(south.style.getPropertyValue('--o')).toBe('0');
    const sun = marks.find((m) => m.className.includes('compass-sun'))!;
    expect(sun.style.getPropertyValue('--x')).toBe('0.5');
    const graves = () =>
      fake(compass.element).findAll((e) => e.className.includes('compass-grave'));
    expect(graves()).toHaveLength(1);
    compass.update(Math.PI, {
      sun: Number.NaN,
      moon: Number.NaN,
      quest: 0,
      graves: [],
      waypoints: [],
    });
    expect(south.style.getPropertyValue('--x')).toBe('0');
    expect(north.style.getPropertyValue('--o')).toBe('0');
    expect(graves()[0]!.style.getPropertyValue('--o')).toBe('0');
  });
});

describe('clock and durations', () => {
  it('writes « hh:mm · Day n » for every minute of the day, without float slips', () => {
    expect(clockText(7.5, 1)).toBe('07:30 · Day 1');
    const ticksPerMinute = HOUR_TICKS / 60;
    for (let minute = 0; minute < 24 * 60; minute++) {
      const ticks = 3 * DAY_TICKS + minute * ticksPerMinute;
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      expect(clockText(hourOf(ticks), 4)).toBe(`${hh}:${mm} · Day 4`);
    }
    expect(clockText(hourOf(DAY_TICKS - 1), 1)).toBe('23:59 · Day 1');
  });
});

describe('quests', () => {
  const quests = basePack.quests!;
  const hunt = quests.find((q) => q.counter)!;
  const open = { progress: 0, done: false, claimed: false };

  it('lists the quests unlocked: to claim first, then open, then claimed', () => {
    const states = {
      [quests[1]!.key]: { ...open, done: true, claimed: true },
      [hunt.key]: { ...open, progress: 0 },
      [quests[0]!.key]: { ...open, done: true },
    };
    const rows = questRows(registry, states, hunt.key);
    expect(rows.map((r) => [r.quest, r.status])).toEqual([
      [quests[0]!.key, 'claim'],
      [hunt.key, 'open'],
      [quests[1]!.key, 'claimed'],
    ]);
    expect(rows[1]).toMatchObject({ progress: `0/${hunt.counter!.count}`, pinned: true });
    expect(rows[0]!.rewards).toMatch(/^\d+ /);
    expect(questLine(hunt, states[hunt.key])).toBe(
      `${basePack.strings[hunt.textKey]} 0/${hunt.counter!.count}`,
    );
    expect(questLine(hunt, { ...open, done: true })).toBe(basePack.strings[hunt.textKey]);
  });

  it('claims a quest done and pins an open one by its buttons; the line shows the pinned one', () => {
    const sent: unknown[] = [];
    const panel = new QuestsPanel({ send: (c) => sent.push(c), click: () => {} });
    const el = fake(panel.element);
    panel.update([], []);
    expect(el.textContent).toBe('QuestsNo quest yet.');
    const states = { [quests[0]!.key]: { ...open, done: true }, [hunt.key]: open };
    panel.update(questRows(registry, states, null), []);
    const button = (action: string) =>
      el.findAll((e) => e.getAttribute('data-action') === action)[0]!;
    button('quest-claim').dispatch('click');
    button('quest-pin').dispatch('click');
    expect(sent).toEqual([
      { type: 'quest.claim', quest: quests[0]!.key },
      { type: 'quest.pin', quest: hunt.key },
    ]);
    panel.update(questRows(registry, states, hunt.key), []);
    expect(button('quest-pin').getAttribute('aria-pressed')).toBe('true');
    button('quest-pin').dispatch('click');
    expect(sent.at(-1)).toEqual({ type: 'quest.pin', quest: null });
    const line = new PinnedQuest();
    expect(line.element.hidden).toBe(true);
    line.update('Hunt');
    expect([line.element.hidden, line.element.textContent]).toEqual([false, 'Hunt']);
    line.update(null);
    expect(line.element.hidden).toBe(true);
    expect(i18nMissing()).toEqual([]);
  });
});

describe('vitals and vignettes', () => {
  it('fills the vials, sounds the alarm under the thresholds and shows toxicity and breath when needed', () => {
    const vitals = new Vitals(b);
    const el = fake(vitals.element);
    const s = createSurvival(b);
    vitals.update(s, 0);
    const health = el.querySelector('.vial-health')!;
    expect(health.style.getPropertyValue('--fill')).toBe('1');
    expect(health.getAttribute('aria-label')).toBe(`Health ${b.health.max}`);
    expect(el.querySelector('.vial-toxicity')!.hidden).toBe(true);
    expect(el.querySelector('.breath')!.hidden).toBe(true);
    s.health = b.health.lowAt - 1;
    s.toxicity = b.toxicity.harmAt;
    s.breath = b.breath.seconds / 2;
    vitals.update(s, 0);
    expect(health.classList.contains('alarm')).toBe(true);
    expect(el.querySelector('.vial-value')!.textContent).toBe(String(b.health.lowAt - 1));
    const toxicity = el.querySelector('.vial-toxicity')!;
    expect(toxicity.hidden).toBe(false);
    expect(toxicity.classList.contains('alarm')).toBe(true);
    const bubbles = el.findAll((e) => e.className === 'breath-bubble');
    expect(bubbles).toHaveLength(BREATH_BUBBLES);
    expect(bubbles.map((bubble) => bubble.style.getPropertyValue('--fill'))).toEqual([
      '1',
      '1',
      '0.5',
      '0',
      '0',
    ]);
  });

  it('hides the breath again at full air, also after a last refill too small to redraw', () => {
    const vitals = new Vitals(b);
    const breath = fake(vitals.element).querySelector('.breath')!;
    const s = createSurvival(b);
    const max = b.breath.seconds;
    for (const [air, hidden] of [
      [(max * 2) / 3, false],
      [max - 0.1, false],
      [max, true],
    ] as const) {
      s.breath = air;
      vitals.update(s, 0);
      expect(breath.hidden).toBe(hidden);
    }
  });

  it('shows the thermometer with its trend and status', () => {
    const vitals = new Vitals(b);
    const thermo = fake(vitals.element).querySelector('.thermo')!;
    const s = createSurvival(b);
    s.temperature = -b.temperature.severeAt;
    s.target = -b.temperature.limit;
    s.ambient = -16;
    vitals.update(s, -2);
    expect(thermo.classList.contains('falling')).toBe(true);
    expect(thermo.classList.contains('cold')).toBe(true);
    expect(thermo.classList.contains('severe')).toBe(true);
    expect(thermo.textContent).toBe('-16°');
    s.target = s.temperature;
    vitals.update(s, -2);
    expect(thermo.classList.contains('falling')).toBe(false);
  });

  it('sets each vignette from the gauges past their thresholds', () => {
    const s = createSurvival(b);
    expect(vignetteLevels(s, b, false, levels())).toEqual(levels());
    s.health = 0;
    s.temperature = -b.temperature.mildAt;
    s.toxicity = b.toxicity.harmAt;
    const out = vignetteLevels(s, b, true, levels());
    expect(out.health).toBe(1);
    expect(out.cold).toBeCloseTo(b.temperature.mildAt / b.temperature.limit);
    expect(out.heat).toBe(0);
    expect(out.toxicity).toBeCloseTo(b.toxicity.harmAt / b.toxicity.max);
    expect(out.water).toBe(1);
    s.health = b.health.lowAt - 0.01;
    expect(vignetteLevels(s, b, false, levels()).health).toBeGreaterThanOrEqual(0.3);
    expect(Object.keys(out)).toEqual([...VIGNETTES]);
  });
});

describe('the death screen', () => {
  it('names the cause and where the player wakes, and respawns on its button', () => {
    let respawns = 0;
    const death = new DeathScreen(() => respawns++);
    const el = fake(death.element);
    expect(death.isOpen()).toBe(false);
    death.show('cold', true, true);
    expect(death.isOpen()).toBe(true);
    expect(el.id).toBe('screen-death');
    expect(el.querySelector('.death-cause')!.textContent).toBe('Froze to death');
    expect(el.textContent).toContain('bedroll');
    const pack = el.querySelector('.death-pack')!;
    expect(pack.textContent).toContain('Abandoned Pack');
    expect(pack.hidden).toBe(false);
    // No pack left (nothing carried, or no room for one): no line about it.
    death.show('', false, false);
    expect(pack.hidden).toBe(true);
    expect(el.querySelector('.death-cause')!.textContent).toBe('Your journey ended');
    for (const cause of DEATH_CAUSES) death.show(cause, false, true);
    expect(pack.hidden).toBe(false);
    el.findAction('respawn')!.dispatch('click');
    expect(respawns).toBe(1);
    death.hide();
    expect(death.isOpen()).toBe(false);
    expect(i18nMissing()).toEqual([]);
  });
});

describe('pickup messages', () => {
  const rows = (feed: PickupFeed) =>
    fake(feed.element).childNodes.map((row) => (row as FakeElement).textContent);

  it('adds a line per item, merges repeats while it shows, then fades it out', () => {
    const feed = new PickupFeed();
    feed.add('item:stick', 'Stick', 2);
    feed.add('item:flint', 'Flint', 1);
    feed.frame(1);
    feed.add('item:stick', 'Stick', 3);
    expect(rows(feed)).toEqual(['+5 Stick', '+1 Flint']);
    const flint = fake(feed.element).childNodes[1] as FakeElement;
    feed.frame(PICKUP_SECONDS - 1 - FADE_SECONDS / 2);
    expect(flint.classList.contains('fading')).toBe(true);
    // The stick line was picked up again later: still up, not fading.
    const stick = fake(feed.element).childNodes[0] as FakeElement;
    expect(stick.classList.contains('fading')).toBe(false);
    feed.frame(FADE_SECONDS);
    expect(rows(feed)).toEqual(['+5 Stick']);
    feed.frame(PICKUP_SECONDS);
    expect(rows(feed)).toEqual([]);
    // Gone: the next pickup starts a new count.
    feed.add('item:stick', 'Stick', 1);
    expect(rows(feed)).toEqual(['+1 Stick']);
    expect(feed.element.getAttribute('aria-label')).toBe('Picked up');
    expect(i18nMissing()).toEqual([]);
  });

  it('keeps the newest lines when many items come at once', () => {
    const feed = new PickupFeed();
    for (let i = 0; i < PICKUP_LINES + 2; i++) feed.add(`item:i${i}`, `I${i}`, 1);
    expect(rows(feed)).toHaveLength(PICKUP_LINES);
    expect(rows(feed)[0]).toBe('+1 I2');
    expect(rows(feed).at(-1)).toBe(`+1 I${PICKUP_LINES + 1}`);
  });
});

describe('combat marks', () => {
  it('turns a damage arc towards where the blow came from, relative to the view', () => {
    // Looking north (yaw 0): ahead, on the right (east), behind.
    expect(damageBearing(0, 0, 0, 0, -3)).toBeCloseTo(0);
    expect(damageBearing(0, 0, 0, 3, 0)).toBeCloseTo(QUARTER);
    expect(Math.abs(damageBearing(0, 0, 0, 0, 3))).toBeCloseTo(2 * QUARTER);
    expect(damageBearing(0, 0, 0, -3, 0)).toBeCloseTo(-QUARTER);
    // Looking west (yaw π/2), a blow from the north comes from the right.
    expect(damageBearing(5, 5, QUARTER, 5, 1)).toBeCloseTo(QUARTER);
  });

  it('plays the hit marker, and one arc per blow (the oldest reused)', () => {
    const marks = new CombatMarks();
    const el = fake(marks.element);
    const arcs = el.findAll((e) => e.className.split(' ').includes('damage-arc'));
    expect(arcs).toHaveLength(4);
    const marker = el.querySelector('.hit-marker')!;
    expect(marker.classList.contains('play')).toBe(false);
    marks.hit();
    expect(marker.classList.contains('play')).toBe(true);
    for (let i = 0; i < 5; i++) marks.hurt(i);
    expect(arcs.map((arc) => arc.style.getPropertyValue('--a'))).toEqual([
      '4rad',
      '1rad',
      '2rad',
      '3rad',
    ]);
    expect(arcs.every((arc) => arc.classList.contains('play'))).toBe(true);
  });
});
