import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import {
  type ContentPack,
  type CreatureDef,
  GAIT_LEGS,
  HOSTILE_MAX_LIGHT,
  MASK_INDEX,
  type ModelPart,
  SKIN_TEXELS,
  type SkinDef,
  skinFaces,
} from '../../../src/content/schema.ts';
import { validatePack } from '../../../src/content/validate.ts';
import { hash32 } from '../../../src/core/hash.ts';
import { rollLoot } from '../../../src/sim/loot.ts';
import { registry } from '../../helpers/registry.ts';

const creature = (key: string): CreatureDef => registry.creature(key)!;

/** A model's skin atlas. */
function skinOf(modelKey: string): SkinDef {
  const key = registry.model(modelKey)!.skin;
  return basePack.skins!.find((s) => s.key === key)!;
}

/** The palette indices of the texels of a part's face in its skin (skinFaces). */
function faceTexels(skin: SkinDef, part: ModelPart, face: 'front' | 'top'): number[] {
  const size = (a: number) => Math.round((part.to[a]! - part.from[a]!) * SKIN_TEXELS);
  const [fu, fv, w, h] = skinFaces(size(0), size(1), size(2))[face];
  const [u, v] = part.uv!;
  const out: number[] = [];
  for (let y = 0; y < h!; y++)
    for (let x = 0; x < w!; x++)
      out.push(MASK_INDEX.indexOf(skin.mask[v + fv! + y]![u + fu! + x]!));
  return out;
}

/** Orange: red over green over blue. */
function amber(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return r! > g! && g! > b!;
}
const creatures = basePack.creatures!;

/** Smallest and largest count of each item of a creature's loot over many deaths. */
function dropRanges(key: string): Record<string, [number, number]> {
  const table = registry.loot(creature(key).loot)!;
  const ranges: Record<string, [number, number]> = {};
  for (const entry of table.entries) ranges[entry.item] = [Infinity, -Infinity];
  for (let i = 0; i < 400; i++) {
    const got = new Map<string, number>();
    rollLoot(table, hash32(11, i), (item, count) => got.set(item, (got.get(item) ?? 0) + count));
    for (const [item, range] of Object.entries(ranges)) {
      const n = got.get(item) ?? 0;
      range[0] = Math.min(range[0], n);
      range[1] = Math.max(range[1], n);
    }
  }
  return ranges;
}

describe('creatures of the base pack', () => {
  it('follow the creature table: category, brain, health, speeds and attack', () => {
    const rows = creatures.map((c) => [
      c.key,
      c.category,
      c.brain,
      c.health,
      c.speed.walk,
      c.speed.run,
      c.attack?.damage ?? 0,
    ]);
    expect(rows).toEqual([
      ['creature:trotter', 'passive', 'grazer', 12, 1.6, 5.8, 0],
      ['creature:shagback', 'defensive', 'defender', 26, 1.3, 4.8, 6],
      ['creature:prowler', 'hostile', 'stalker', 22, 2.2, 5, 7],
      ['creature:swarmling', 'hostile', 'swarmer', 8, 2.5, 6, 3],
      ['creature:shellback', 'territorial', 'charger', 45, 1.2, 7, 12],
      ['creature:glimmerback', 'passive', 'grazer', 14, 1.4, 5.4, 0],
      ['creature:reedwader', 'defensive', 'defender', 16, 1.5, 5, 4],
    ]);
    expect(creatures.map((c) => basePack.strings[c.nameKey])).toEqual([
      'Trotter',
      'Shagback',
      'Prowler',
      'Swarmling',
      'Shellback',
      'Glimmerback',
      'Reedwader',
    ]);
  });

  it('carry the particulars of the table as data for their brains', () => {
    const prowler = creature('creature:prowler');
    expect(prowler.attack).toMatchObject({ windup: 0.4, cooldown: 2 });
    expect(prowler.senses).toMatchObject({ sight: 24, fovDeg: 140 });
    expect(prowler.traits).toEqual({
      watchedSpeedMul: 0.3,
      lightAversion: 10,
      burrowAtDawn: true,
      escalation: { perDay: 0.05, maxDays: 10 },
    });
    expect(creature('creature:swarmling').attack?.toxicity).toBe(8);
    const shellback = creature('creature:shellback');
    expect(shellback.attack?.windup).toBe(0.8);
    expect(shellback.traits).toMatchObject({
      frontArmor: 0.6,
      wallStunSec: 1.5,
      territoryRadius: 6,
    });
    expect(creature('creature:shagback').traits?.herdAlertRadius).toBe(12);
    expect(creature('creature:trotter').traits?.fleeSec).toBe(8);
  });

  it('spawn in their biomes, hostiles only in the dark', () => {
    const where = (key: string) =>
      creature(key).spawn.map((s) => [s.biomes, s.when, s.where, s.group]);
    expect(where('creature:trotter')).toEqual([
      [['biome:meadow', 'biome:forest'], 'day', 'surface', [2, 4]],
    ]);
    expect(where('creature:shagback')).toEqual([
      [['biome:tundra', 'biome:highlands'], 'day', 'surface', [2, 3]],
    ]);
    expect(where('creature:prowler')).toEqual([
      ['*', 'night', 'surface', [1, 1]],
      ['*', 'any', 'cave', [1, 2]],
    ]);
    expect(where('creature:swarmling')).toEqual([
      [['biome:fungal_marsh'], 'night', 'surface', [3, 5]],
      ['*', 'any', 'cave', [3, 5]],
    ]);
    expect(where('creature:shellback')).toEqual([
      [['biome:ochre_desert'], 'any', 'surface', [1, 1]],
    ]);
    for (const c of creatures.filter((c) => c.category === 'hostile'))
      for (const spawn of c.spawn) expect(spawn.maxLight).toBeLessThanOrEqual(HOSTILE_MAX_LIGHT);
  });

  it('drop the loot of the table: a Trotter always leaves meat and hide', () => {
    expect(dropRanges('creature:trotter')).toEqual({
      'item:raw_meat': [1, 2],
      'item:raw_hide': [1, 1],
    });
    expect(dropRanges('creature:shagback')).toEqual({
      'item:fur': [1, 2],
      'item:prowler_sinew': [1, 1],
    });
    expect(dropRanges('creature:prowler')).toEqual({ 'item:prowler_sinew': [1, 1] });
    expect(dropRanges('creature:swarmling')).toEqual({ 'item:toxic_gland': [0, 1] });
    expect(dropRanges('creature:shellback')).toEqual({ 'item:shell_plate': [1, 2] });
  });

  it('are box models with the legs of their gait', () => {
    const gaits = creatures.map((c) => registry.model(c.model)!.gait);
    expect(gaits).toEqual([
      'quadruped',
      'hexapod',
      'quadruped',
      'hexapod',
      'quadruped',
      'quadruped',
      'biped',
    ]);
    for (const model of basePack.models!) {
      const legs = model.parts.filter((p) => p.name.startsWith('leg')).map((p) => p.name);
      expect(legs.sort(), model.key).toEqual(Object.keys(GAIT_LEGS[model.gait]).sort());
      // Legs swing about their top, their lower segment (if any) standing on the ground.
      for (const leg of model.parts.filter((p) => p.name.startsWith('leg'))) {
        expect(leg.pivot[1], `${model.key} ${leg.name}`).toBe(leg.to[1]);
        const chain = model.parts.filter((p) => p === leg || p.parent === leg.name);
        expect(Math.min(...chain.map((p) => p.from[1])), `${model.key} ${leg.name}`).toBe(0);
      }
    }
  });

  it('keep the Prowler low and four-legged, with glowing amber eyes', () => {
    const prowler = creature('creature:prowler');
    const parts = registry.model(prowler.model)!.parts;
    const top = Math.max(...parts.map((p) => p.to[1])) / 16;
    const length =
      (Math.max(...parts.map((p) => p.to[2])) - Math.min(...parts.map((p) => p.from[2]))) / 16;
    expect(top).toBeLessThanOrEqual(prowler.hitbox[1]);
    expect(length).toBeGreaterThan(2 * top);
    const eyes = parts.filter((p) => p.emissive);
    expect(eyes.map((p) => p.name)).toEqual(['eyeL', 'eyeR']);
    // Amber and glowing: every texel of the eyes' fronts is orange (red over green over blue).
    const skin = skinOf(prowler.model);
    for (const eye of eyes)
      for (const index of faceTexels(skin, eye, 'front')) {
        expect(skin.glow).toContain(index);
        expect(amber(skin.palette[index]!), skin.palette[index]).toBe(true);
      }
    // No other creature has glowing amber eyes (the Glimmerback's spores glow teal).
    for (const model of basePack.models!.filter((m) => m.key !== prowler.model)) {
      for (const part of model.parts.filter((p) => p.emissive))
        expect(part.name.startsWith('eye'), `${model.key} ${part.name}`).toBe(false);
      const other = model.skin && basePack.skins!.find((s) => s.key === model.skin);
      for (const index of other?.glow ?? []) expect(amber(other!.palette[index]!)).toBe(false);
    }
  });

  it('have their voices and steps, an attack voice only when they attack', () => {
    for (const c of creatures) {
      const sounds = Object.keys(c.sounds).sort();
      const expected = ['alert', 'death', 'hurt', 'idle', 'step', ...(c.attack ? ['attack'] : [])];
      expect(sounds, c.key).toEqual(expected.sort());
    }
  });
});

describe('combat data', () => {
  it('follows the weapon table, the bare hand in the balance', () => {
    const row = (key: string) => {
      const w = registry.item(key)!.weapon!;
      return [w.damage, w.cooldown, w.reach];
    };
    const hand = basePack.balance.combat.hand;
    expect([hand.damage, hand.cooldown, hand.reach]).toEqual([2, 0.4, 3]);
    expect(row('item:flint_knife')).toEqual([4, 0.4, 3]);
    expect(row('item:flint_spear')).toEqual([6, 0.8, 4]);
    const metals = ['flint', 'copper', 'bronze', 'iron'];
    expect(metals.map((m) => row(`item:${m}_hatchet`))).toEqual([
      [4, 0.6, 3],
      [5, 0.6, 3],
      [6, 0.6, 3],
      [8, 0.6, 3],
    ]);
    expect(metals.slice(1).map((m) => row(`item:${m}_blade`))).toEqual([
      [7, 0.5, 3],
      [9, 0.5, 3],
      [12, 0.5, 3],
    ]);
    expect(registry.item('item:flint_pickaxe')!.weapon).toBeUndefined();
  });

  it('keeps hostiles away for the first 3 real minutes of a world', () => {
    expect(basePack.balance.creatures.spawnGraceTicks).toBe(3 * 60 * 30);
  });
});

describe('creature validation', () => {
  it('accepts the base pack', () => {
    expect(validatePack(basePack)).toEqual([]);
  });

  it('reports bad creatures, models and creature loot with exact paths', () => {
    const pack = JSON.parse(JSON.stringify(basePack));
    const [trotter, shagback, prowler, swarmling, shellback] = pack.creatures;
    trotter.attack = { damage: 1, reach: 1, windup: 0, cooldown: 1, knockback: 0 };
    trotter.hitbox = [1.2, 1.3];
    shagback.brain = 'sleeper';
    shagback.speed.run = 1;
    prowler.spawn[0].maxLight = 7;
    prowler.traits.watchedSpeedMul = 1.5;
    prowler.traits.lightAversion = 16;
    swarmling.sounds.idle = 'sfx:nope';
    swarmling.spawn[0].biomes = ['biome:nope'];
    swarmling.senses.fovDeg = 400;
    shellback.model = 'model:nope';
    shellback.spawn[0].group = [2, 1];
    shellback.attack.damage = 0;
    const model = (key: string) => pack.models.findIndex((m: { key: string }) => m.key === key);
    const models = pack.models;
    const prowlerModel = models[model('model:prowler')];
    prowlerModel.parts = prowlerModel.parts.filter(
      (p: { name: string }) => p.name !== 'legBR' && p.name !== 'shinBR',
    );
    // A part whose faces fall outside its skin's painted texels, a glow of no colour.
    const glimmer = model('model:glimmerback');
    models[glimmer].parts[0].uv = [250, 250];
    pack.skins[0].glow = [99];
    const shagbackTail = models[model('model:shagback')].parts.length - 1;
    models[model('model:shagback')].parts[shagbackTail].name = 'legTail';
    models[model('model:swarmling')].parts[7].parent = 'nope';
    models[model('model:shellback')].stride = 0;
    models[model('model:trotter')].gait = 'octopod';
    // Draws never repeat an entry, so a table cannot draw more often than it has entries.
    const meat = pack.loot.findIndex((t: { key: string }) => t.key === 'loot:trotter');
    pack.loot[meat].rolls = [3, 3];
    const issues = validatePack(pack as ContentPack);
    expect(issues.map((i) => i.path).sort()).toEqual(
      [
        'creatures[0].attack',
        'creatures[0].hitbox',
        'creatures[1].brain',
        'creatures[1].speed.run',
        'creatures[2].spawn[0].maxLight',
        'creatures[2].traits.watchedSpeedMul',
        'creatures[2].traits.lightAversion',
        'creatures[3].sounds.idle',
        'creatures[3].spawn[0].biomes[0]',
        'creatures[3].senses.fovDeg',
        'creatures[4].model',
        'creatures[4].spawn[0].group',
        'creatures[4].attack.damage',
        `models[${model('model:prowler')}].parts`,
        `models[${model('model:shagback')}].parts[${shagbackTail}].name`,
        `models[${model('model:swarmling')}].parts[7].parent`,
        `models[${model('model:shellback')}].stride`,
        `models[${model('model:trotter')}].gait`,
        `models[${glimmer}].parts[0].uv`,
        'skins[0].glow',
        `loot[${meat}].rolls`,
      ].sort(),
    );
  });
});
