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
        'biomes[0].features',
      ]),
    );
  });
});
