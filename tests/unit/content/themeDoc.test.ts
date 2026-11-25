import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strings } from '../../../src/content/packs/base/i18n.en.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';

/*
 * The theme bible (docs/theme.md) carries the ore table of the pack's data: this test rebuilds it
 * and fails with the table to paste when the two differ.
 */

const name = (key: string) => (strings as Record<string, string>)[key] ?? key;
const blockName = (key: string) => name(`block.${key.slice('block:'.length)}`);
const biomeName = (key: string) => name(`biome.${key.slice('biome:'.length)}`);

/** The ore table, built from the pack's ores. */
function oreTable(): string {
  const rows = (basePack.ores ?? []).map((ore) => {
    const biomes = ore.biomes === '*' ? 'tous' : ore.biomes.map(biomeName).join(', ');
    const layers = ore.layers
      .map(
        (l) =>
          `y ${l.y[0]}–${l.y[1]} : ${Math.round(l.chance * 100)} % × ${l.veins}, ${l.size[0]}–${l.size[1]} blocs`,
      )
      .join(' ; ');
    const where = [ore.caveWall ? 'parois de grotte' : '', ore.underLiquid ? 'sous le liquide' : '']
      .filter(Boolean)
      .join(', ');
    return `| ${blockName(ore.block)} | ${biomes} | ${layers} | ${ore.replaces.map(blockName).join(', ')}${where ? ` (${where})` : ''} |`;
  });
  return [
    '| Minerai | Biomes | Couches (chance × tentatives par section, taille) | Remplace |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** Table rows with their cells trimmed (the formatter pads them), separator dashes collapsed. */
function normalized(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim().replace(/^-+$/, '---'))
        .join('|'),
    )
    .join('\n');
}

describe('the theme bible', () => {
  it('holds the ore table of the pack', () => {
    const doc = readFileSync(new URL('../../../docs/theme.md', import.meta.url), 'utf8');
    const table = oreTable();
    expect(normalized(doc).includes(normalized(table)), `docs/theme.md needs:\n\n${table}\n`).toBe(
      true,
    );
  });
});
