import {
  FLAG_OPAQUE,
  PASS_TRANSLUCENT,
  type RawTables,
  type Registry,
} from '../../content/registry.ts';

/**
 * Tables of the `xray` debug view. The terrain blocks of world generation (bedrock, stone, deep
 * stone, the biomes' surface, filler and seabed, the shore banks) turn into see-through ghosts:
 * not opaque, translucent and culled against one another. So every face of an ore shows, and only
 * the ghost faces against air, liquids or plants remain: the outline of the ground and the caves.
 */
export function xrayTables(registry: Registry): RawTables {
  const tables = registry.tables;
  const hidden = new Set(xrayBlocks(registry).map((key) => registry.defaultState(key)));
  const flags = tables.flags.slice();
  const pass = tables.pass.slice();
  const cullGroup = tables.cullGroup.slice();
  const ghost = Math.max(...tables.cullGroup) + 1;
  for (const id of hidden) {
    flags[id] = flags[id]! & ~FLAG_OPAQUE;
    pass[id] = PASS_TRANSLUCENT;
    cullGroup[id] = ghost;
  }
  return { ...tables, flags, pass, cullGroup };
}

/** Block keys of the terrain the xray view sees through (the pack's world generation blocks). */
function xrayBlocks(registry: Registry): `block:${string}`[] {
  const { worldgen, biomes } = registry.pack;
  if (!worldgen) return [];
  return [
    worldgen.bedrock,
    worldgen.stone,
    worldgen.deepStone,
    ...worldgen.banks.patches.map((p) => p.block),
    ...(biomes ?? []).flatMap((b) => [b.surface, b.filler, b.seabed]),
  ];
}
