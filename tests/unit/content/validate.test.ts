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
