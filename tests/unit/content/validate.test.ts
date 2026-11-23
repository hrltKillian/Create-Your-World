import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry, ContentError } from '../../../src/content/registry.ts';
import type { ContentPack } from '../../../src/content/schema.ts';
import { validatePack } from '../../../src/content/validate.ts';

function broken(
  mutate: (pack: {
    blocks: Record<string, unknown>[];
    textures: Record<string, unknown>[];
  }) => void,
) {
  const pack = JSON.parse(JSON.stringify(basePack));
  mutate(pack);
  return pack as ContentPack;
}

describe('content validation', () => {
  it('accepts the base pack', () => {
    expect(validatePack(basePack)).toEqual([]);
  });

  it('reports the exact path of each problem', () => {
    const pack = broken((p) => {
      p.blocks[3]!.textures = { all: 'tex:missing' };
      p.blocks[4]!.nameKey = 'block.nope';
      p.textures[2]!.palette = ['#12345'];
      p.blocks[11]!.light = { filter: 0 };
    });
    const paths = validatePack(pack).map((i) => i.path);
    expect(paths).toContain('blocks[3].textures.all');
    expect(paths).toContain('blocks[4].nameKey');
    expect(paths).toContain('textures[2].palette[0]');
    expect(paths).toContain('blocks[11].collision');
  });

  it('requires air first and rejects tinted emissive faces', () => {
    const pack = broken((p) => {
      p.blocks.reverse();
      const grass = p.blocks.find((b) => b.key === 'block:grass')!;
      grass.textures = { all: 'tex:copper_ore' };
    });
    const issues = validatePack(pack);
    expect(issues.map((i) => i.path)).toContain('manifest.bindings.air');
    expect(issues.some((i) => i.message.includes('emissive but the block is tinted'))).toBe(true);
  });

  it('keeps one grave block (the one a death leaves), which the registry finds', () => {
    const registry = buildRegistry(basePack);
    expect(registry.blockDef(registry.grave).blockEntity).toBe('grave');
    const pack = broken((p) => {
      p.blocks.find((b) => b.key === 'block:bedroll')!.blockEntity = 'grave';
    });
    expect(validatePack(pack)).toEqual([
      { path: 'blocks', message: 'at most one block may be a grave (the one a death leaves)' },
    ]);
  });

  it('refuses to build a registry from an invalid pack', () => {
    const pack = broken((p) => {
      p.blocks[5]!.states = ['wobble'];
    });
    expect(() => buildRegistry(pack)).toThrow(ContentError);
  });
});

describe('content validation of shapes and state overrides', () => {
  it('rejects boxes outside 0–16 or with min ≥ max, with exact paths', () => {
    const pack = broken((p) => {
      const torch = p.blocks.find((b) => b.key === 'block:torch')!;
      torch.shape = { boxes: [[7, 0, 7, 9, 18, 9]] };
      const gate = p.blocks.find((b) => b.key === 'block:gate')!;
      (gate.whenState as Record<string, Record<string, unknown>>).open!.shape = {
        boxes: [[4, 0, 0, 3, 16, 16]],
      };
    });
    const paths = validatePack(pack).map((i) => i.path);
    expect(paths.some((path) => /^blocks\[\d+\]\.shape\.boxes\[0\]$/.test(path))).toBe(true);
    expect(
      paths.some((path) => /^blocks\[\d+\]\.whenState\.open\.shape\.boxes\[0\]$/.test(path)),
    ).toBe(true);
  });

  it('applies the collision ⇒ opaque-or-filter rule to state overrides', () => {
    const pack = broken((p) => {
      const gate = p.blocks.find((b) => b.key === 'block:gate')!;
      (gate.whenState as Record<string, Record<string, unknown>>).open = {
        collision: 'full',
        light: { filter: 0 },
      };
    });
    expect(validatePack(pack).some((i) => /whenState\.open\.collision$/.test(i.path))).toBe(true);
  });

  it('requires the half state on tall blocks (doors)', () => {
    const pack = broken((p) => {
      const gate = p.blocks.find((b) => b.key === 'block:gate')!;
      gate.states = ['facing4', 'open'];
    });
    const gate = basePack.blocks.findIndex((b) => b.key === 'block:gate');
    expect(validatePack(pack).map((i) => i.path)).toEqual([`blocks[${gate}].placement.tall`]);
  });

  it('requires a tint-aware texture on tinted opaque blocks', () => {
    const pack = broken((p) => {
      const grass = p.blocks.find((b) => b.key === 'block:grass')!;
      grass.textures = { all: 'tex:dirt' };
    });
    expect(validatePack(pack).some((i) => /\.tint$/.test(i.path))).toBe(true);
  });

  it('gives a crack stage to fracture textures, and only to them', () => {
    const pack = broken((p) => {
      const cracks = p.textures.filter((t) => t.pattern === 'fracture');
      cracks[0]!.stage = 8;
      delete cracks[1]!.stage;
      p.textures[1]!.stage = 2;
    });
    const at = (i: number) => `textures[${i}].stage`;
    const first = basePack.textures.findIndex((t) => t.pattern === 'fracture');
    expect(validatePack(pack).map((i) => i.path)).toEqual([at(1), at(first), at(first + 1)]);
  });
});

describe('content validation of world generation', () => {
  it('checks features, ores and the decoration chances of biomes', () => {
    const pack = JSON.parse(JSON.stringify(basePack));
    pack.features[0].crown = undefined;
    pack.features[3].size = [1, 5];
    pack.ores[0].block = 'block:nope';
    pack.ores[1].biomes = ['biome:nope'];
    pack.ores[2].veinSize = [6, 3];
    pack.ores[2].yRange = [64, 70]; // bog iron forms under the liquid, below the sea level (62)
    pack.biomes[0].features = [
      { feature: 'feature:boulder', chance: 0.7 },
      { feature: 'feature:boulder', chance: 0.6 },
    ];
    const paths = validatePack(pack as ContentPack).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'features[0].crown',
        'features[3].size',
        'ores[0].block',
        'ores[1].biomes[0]',
        'ores[2].veinSize',
        'ores[2].underLiquid',
        'biomes[0].features',
      ]),
    );
  });

  it('checks the spawn rules and the structure templates', () => {
    const pack = JSON.parse(JSON.stringify(basePack));
    pack.worldgen.spawn.near = ['block:nope'];
    pack.worldgen.spawn.far = ['biome:nope'];
    const [camp, cairn] = pack.structures;
    camp.biomes = ['biome:nope'];
    camp.legend.Q = 'block:nope[axis=x]';
    camp.layers[1][2] = '.C.......';
    camp.layers[2][0] = '...........x';
    cairn.layers = new Array(11).fill(cairn.layers[0]);
    cairn.chance = 0.95;
    pack.structures.push({ ...cairn, key: 'structure:twin', chance: 0.5, layers: [['..']] });
    const paths = validatePack(pack as ContentPack).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'worldgen.spawn.near[0]',
        'worldgen.spawn.far[0]',
        'structures[0].biomes[0]',
        'structures[0].legend.Q',
        'structures[0].layers[1][2]',
        'structures[0].layers[2][0]',
        'structures[1].layers',
        'structures',
      ]),
    );
    expect(validatePack(basePack)).toEqual([]);
  });
});

describe('content validation of the balance', () => {
  it('checks the survival numbers, the bare hand and the heat of the blocks', () => {
    const pack = JSON.parse(JSON.stringify(basePack));
    pack.balance.hunger.perMin = -4;
    pack.balance.sleep.wakeHour = 24;
    pack.balance.shelter.maxDistance = 16;
    pack.balance.shelter.coveredToxicity = 1.5;
    pack.balance.climate.heatSources = 0;
    pack.balance.creatures.spawnGraceTicks = 5400.5;
    pack.balance.combat.hand.reach = 0;
    const torch = pack.blocks.find((b: { key: string }) => b.key === 'block:torch');
    torch.heat = { celsius: 3.5, radius: 9 };
    const paths = validatePack(pack).map((i) => i.path);
    expect(paths.sort()).toEqual(
      [
        'balance.hunger.perMin',
        'balance.sleep.wakeHour',
        'balance.shelter.maxDistance',
        'balance.shelter.coveredToxicity',
        'balance.climate.heatSources',
        'balance.creatures.spawnGraceTicks',
        'balance.combat.hand.reach',
        `blocks[${pack.blocks.indexOf(torch)}].heat.celsius`,
        `blocks[${pack.blocks.indexOf(torch)}].heat.radius`,
      ].sort(),
    );
  });

  it('takes heat sources only: no cold or zero heat, which the thermal model would ignore', () => {
    const pack = JSON.parse(JSON.stringify(basePack));
    const torch = pack.blocks.find((b: { key: string }) => b.key === 'block:torch');
    const magma = pack.blocks.find((b: { key: string }) => b.key === 'block:magma');
    torch.heat = { celsius: -5, radius: 2 };
    magma.heat = { celsius: 0, radius: 2 };
    expect(
      validatePack(pack)
        .map((i) => i.path)
        .sort(),
    ).toEqual(
      [
        `blocks[${pack.blocks.indexOf(torch)}].heat.celsius`,
        `blocks[${pack.blocks.indexOf(magma)}].heat.celsius`,
      ].sort(),
    );
    torch.heat = { celsius: 1, radius: 2 };
    magma.heat = { celsius: 127, radius: 2 };
    expect(validatePack(pack)).toEqual([]);
  });

  it('gives each block state its heat, lit stations only while lit', () => {
    const registry = buildRegistry(basePack);
    const heat = (key: string) => registry.tables.heat[registry.stateId(key)];
    expect(heat('block:campfire[lit=1]')).toBeGreaterThan(0);
    expect(heat('block:campfire[lit=0]')).toBe(0);
    expect(heat('block:magma')).toBeGreaterThan(0);
    const kiln = registry.stateId('block:kiln[facing4=n,lit=1]');
    const lit = registry.blockDef(kiln).whenState!.lit!.heat!;
    expect([heat('block:kiln[facing4=n,lit=1]'), registry.tables.heatRadius[kiln]]).toEqual([
      lit.celsius,
      lit.radius,
    ]);
  });
});

describe('content validation of the objectives', () => {
  it('checks keys, strings, compass points and what each condition asks for', () => {
    const pack = JSON.parse(JSON.stringify(basePack));
    const [first, second, third, fourth] = pack.objectives;
    first.key = second.key;
    second.textKey = 'objective.nope';
    second.compass = 'up';
    third.condition = { items: ['item:nope', 'tag:nope'], stations: ['station:nope'], nights: 1.5 };
    fourth.condition = { enclosed: false, drank: false };
    const issues = validatePack(pack as ContentPack).map((i) => i.path);
    expect(issues).toEqual([
      'objectives[1].key',
      'objectives[1].textKey',
      'objectives[1].compass',
      'objectives[2].condition.items[0]',
      'objectives[2].condition.items[1]',
      'objectives[2].condition.stations[0]',
      'objectives[2].condition.nights',
      'objectives[3].condition',
    ]);
  });
});
