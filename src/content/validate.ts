import {
  type BlockDef,
  type ContentPack,
  CRACK_STAGES,
  STATE_VALUES,
  type TextureAlpha,
  type TextureSlot,
} from './schema.ts';
import { validateBalance } from './validateBalance.ts';
import { validateCrafting } from './validateCrafting.ts';
import { validateItems } from './validateItems.ts';
import { validateSounds } from './validateSounds.ts';
import { validateWorld } from './validateWorld.ts';

export interface ContentIssue {
  /** Exact location in the pack, e.g. `blocks[3].textures.top`. */
  readonly path: string;
  readonly message: string;
}

export const MAX_TEXTURE_LAYERS = 256;
export const MAX_STATES = 65_535;

const HEX = /^#[0-9a-fA-F]{6}$/;

type AddIssue = (path: string, message: string) => void;

/** Texture keys of a pack: all of them, and by alpha use. */
export interface TextureSets {
  readonly keys: ReadonlySet<string>;
  /** Emissive-mask textures (a tinted block may not use them). */
  readonly emissive: ReadonlySet<string>;
  /** Tint-aware textures (tintMask, tintFull): the only faces of an opaque block that take its tint. */
  readonly tintable: ReadonlySet<string>;
}

export function textureSets(pack: ContentPack): TextureSets {
  const keysWhere = (keep: (alpha: TextureAlpha | undefined) => boolean) =>
    new Set(pack.textures.filter((t) => keep(t.alpha)).map((t) => t.key as string));
  return {
    keys: keysWhere(() => true),
    emissive: keysWhere((alpha) => alpha === 'emissiveMask'),
    tintable: keysWhere((alpha) => alpha === 'tintMask' || alpha === 'tintFull'),
  };
}

/** Semantic validation of a content pack. Returns every issue found (empty = valid). */
export function validatePack(pack: ContentPack): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add: AddIssue = (path, message) => issues.push({ path, message });
  const textures = textureSets(pack);
  validateTextures(pack, add);
  const blockKeys = validateBlocks(pack, textures, add);
  validateBindings(pack, blockKeys, add);
  validateWorld(pack, blockKeys, add);
  validateModels(pack, textures.keys, add);
  validateDevScene(pack, blockKeys, add);
  validateArena(pack, blockKeys, add);
  validateCrafting(pack, validateItems(pack, blockKeys, textures.keys, add), add);
  validateSounds(pack, add);
  validateBalance(pack, add);
  checkTints(pack.tints, 'tints', add);
  (pack.biomes ?? []).forEach((b, i) => {
    checkTints(b.tints, `biomes[${i}].tints`, add);
  });
  return issues;
}

/** Texture size, keys and palettes, and the layer limit. */
function validateTextures(pack: ContentPack, add: AddIssue): void {
  const size = pack.manifest.textureSize;
  if (!Number.isInteger(size) || size < 8 || size > 64 || (size & (size - 1)) !== 0) {
    add('manifest.textureSize', `must be a power of two between 8 and 64 (got ${size})`);
  }
  const seen = new Set<string>();
  pack.textures.forEach((tex, i) => {
    const path = `textures[${i}]`;
    if (!tex.key.startsWith('tex:')) add(`${path}.key`, `"${tex.key}" must start with "tex:"`);
    if (seen.has(tex.key)) add(`${path}.key`, `duplicate texture "${tex.key}"`);
    seen.add(tex.key);
    if (tex.palette.length === 0) add(`${path}.palette`, 'palette is empty');
    tex.palette.forEach((color, c) => {
      if (!HEX.test(color)) add(`${path}.palette[${c}]`, `"${color}" is not a #rrggbb colour`);
    });
    if ((tex.pattern === 'icon') !== (tex.mask !== undefined))
      add(`${path}.mask`, 'the icon pattern, and only it, needs a mask');
    if ((tex.pattern === 'fracture') !== (tex.stage !== undefined))
      add(`${path}.stage`, 'the fracture pattern, and only it, needs a stage');
    const stage = tex.stage;
    if (stage !== undefined && !(Number.isInteger(stage) && stage >= 0 && stage < CRACK_STAGES))
      add(`${path}.stage`, `must be an integer from 0 to ${CRACK_STAGES - 1} (got ${stage})`);
    checkMask(tex.mask, tex.palette.length, `${path}.mask`, add);
  });
  if (pack.textures.length > MAX_TEXTURE_LAYERS) {
    add(
      'textures',
      `${pack.textures.length} textures exceed the ${MAX_TEXTURE_LAYERS}-layer limit`,
    );
  }
}

/** Every block and its state overrides, and the state count. Returns the block keys. */
function validateBlocks(pack: ContentPack, textures: TextureSets, add: AddIssue): Set<string> {
  const blockKeys = new Set<string>();
  let stateTotal = 0;
  pack.blocks.forEach((block, i) => {
    const path = `blocks[${i}]`;
    if (!block.key.startsWith('block:'))
      add(`${path}.key`, `"${block.key}" must start with "block:"`);
    if (blockKeys.has(block.key)) add(`${path}.key`, `duplicate block "${block.key}"`);
    blockKeys.add(block.key);
    if (pack.strings[block.nameKey] === undefined) {
      add(`${path}.nameKey`, `no string for "${block.nameKey}"`);
    }
    checkTextures(block, path, textures, add);
    checkLight(block.light?.emit, `${path}.light.emit`, add);
    checkLight(block.light?.filter, `${path}.light.filter`, add);
    if (block.hardness < 0 && block.hardness !== -1)
      add(`${path}.hardness`, 'must be ≥ 0 (or -1 for unbreakable)');
    stateTotal += checkStates(block, path, textures.keys, add);
    checkBlockRules(block, path, block, add);
    checkBoxes(block.shape, `${path}.shape`, add);
    checkBoxes(block.collision, `${path}.collision`, add);
    checkOverrides(block, path, textures.emissive, add);
    if (block.tint && block.pass === 'opaque') {
      if (!Object.values(block.textures).some((key) => textures.tintable.has(key))) {
        add(
          `${path}.tint`,
          'a tinted opaque block needs at least one tintMask or tintFull texture',
        );
      }
    }
  });
  if (stateTotal > MAX_STATES) add('blocks', `${stateTotal} block states exceed ${MAX_STATES}`);
  if (pack.blocks.filter((block) => block.blockEntity === 'grave').length > 1)
    add('blocks', 'at most one block may be a grave (the one a death leaves)');
  return blockKeys;
}

/** State properties and the references of `whenState` overrides. Returns the block's state count. */
function checkStates(
  block: BlockDef,
  path: string,
  textureKeys: ReadonlySet<string>,
  add: AddIssue,
): number {
  const seen = new Set<string>();
  let combos = 1;
  (block.states ?? []).forEach((prop, p) => {
    if (!(prop in STATE_VALUES)) add(`${path}.states[${p}]`, `unknown state "${prop}"`);
    if (seen.has(prop)) add(`${path}.states[${p}]`, `duplicate state "${prop}"`);
    seen.add(prop);
    combos *= STATE_VALUES[prop]?.length ?? 1;
  });
  if (block.placement?.tall === 2 && !seen.has('half'))
    add(`${path}.placement.tall`, 'a tall block needs the "half" state');
  for (const [prop, override] of Object.entries(block.whenState ?? {})) {
    if (!seen.has(prop)) add(`${path}.whenState.${prop}`, `block has no "${prop}" state`);
    for (const [slot, key] of Object.entries(override?.textures ?? {})) {
      if (!textureKeys.has(key))
        add(`${path}.whenState.${prop}.textures.${slot}`, `unknown texture "${key}"`);
    }
    checkLight(override?.emit, `${path}.whenState.${prop}.emit`, add);
  }
  return combos;
}

/** The block rules, boxes, light and texture tint applied to each `whenState` override. */
function checkOverrides(
  block: BlockDef,
  path: string,
  emissive: ReadonlySet<string>,
  add: AddIssue,
): void {
  for (const [prop, override] of Object.entries(block.whenState ?? {})) {
    if (!override) continue;
    const opath = `${path}.whenState.${prop}`;
    const effective = {
      opaque: override.opaque ?? block.opaque,
      shape: override.shape ?? block.shape,
      collision: override.collision ?? block.collision,
      filter: override.light?.filter ?? block.light?.filter ?? 0,
    };
    checkBlockRules(block, opath, effective, add);
    checkBoxes(override.shape, `${opath}.shape`, add);
    checkBoxes(override.collision, `${opath}.collision`, add);
    checkLight(override.light?.filter, `${opath}.light.filter`, add);
    for (const [slot, key] of Object.entries(override.textures ?? {})) {
      if (block.tint && emissive.has(key))
        add(`${opath}.textures.${slot}`, `"${key}" is emissive but the block is tinted`);
    }
  }
}

/** The air and unknown blocks, and the spawn biomes. */
function validateBindings(pack: ContentPack, blockKeys: ReadonlySet<string>, add: AddIssue): void {
  const bindings = pack.manifest.bindings;
  if (pack.blocks[0]?.key !== bindings.air) {
    add('manifest.bindings.air', `the air block "${bindings.air}" must be the first block`);
  }
  for (const name of ['air', 'unknownBlock'] as const) {
    if (!blockKeys.has(bindings[name]))
      add(`manifest.bindings.${name}`, `unknown block "${bindings[name]}"`);
  }
  const biomeKeys = new Set((pack.biomes ?? []).map((b) => b.key as string));
  (bindings.spawnBiomes ?? []).forEach((key, i) => {
    if (!biomeKeys.has(key)) add(`manifest.bindings.spawnBiomes[${i}]`, `unknown biome "${key}"`);
  });
}

/** Model parts (textures, parents, extents) and the avatar model binding. */
function validateModels(pack: ContentPack, textureKeys: ReadonlySet<string>, add: AddIssue): void {
  const modelKeys = new Set<string>();
  (pack.models ?? []).forEach((model, i) => {
    modelKeys.add(model.key);
    const names = new Set(model.parts.map((p) => p.name));
    model.parts.forEach((part, k) => {
      const path = `models[${i}].parts[${k}]`;
      if (!textureKeys.has(part.texture))
        add(`${path}.texture`, `unknown texture "${part.texture}"`);
      if (part.parent && !names.has(part.parent))
        add(`${path}.parent`, `unknown part "${part.parent}"`);
      if (part.from.some((v, a) => !(v < part.to[a]!)))
        add(path, 'from must be below to on every axis');
    });
  });
  const avatar = pack.manifest.bindings.avatarModel;
  if (avatar && !modelKeys.has(avatar)) {
    add('manifest.bindings.avatarModel', `unknown model "${avatar}"`);
  }
}

/** Blocks named by the developer test scene. */
function validateDevScene(pack: ContentPack, blockKeys: ReadonlySet<string>, add: AddIssue): void {
  const scene = pack.devScene;
  if (!scene) return;
  const refs: [string, string | undefined][] = [
    ...scene.ground.map((key, g): [string, string] => [`devScene.ground[${g}]`, key]),
    ['devScene.pond.liquid', scene.pond?.liquid],
    ['devScene.pond.shore', scene.pond?.shore],
    ['devScene.tree.log', scene.tree?.log],
    ['devScene.tree.leaves', scene.tree?.leaves],
    ['devScene.plant', scene.plant],
    ['devScene.showcaseFloor', scene.showcaseFloor],
  ];
  for (const [path, key] of refs)
    if (key !== undefined && !blockKeys.has(key)) add(path, `unknown block "${key}"`);
}

/** Blocks named by the arena test world. */
function validateArena(pack: ContentPack, blockKeys: ReadonlySet<string>, add: AddIssue): void {
  const arena = pack.arena;
  if (!arena) return;
  const refs: [string, string][] = [
    ...Object.entries(arena.cabin).map(([k, key]): [string, string] => [`arena.cabin.${k}`, key]),
    ['arena.pond.liquid', arena.pond.liquid],
    ['arena.pond.shore', arena.pond.shore],
    ['arena.gravel', arena.gravel],
    ['arena.tree.log', arena.tree.log],
    ['arena.tree.leaves', arena.tree.leaves],
    ...arena.oreWall.map((key, i): [string, string] => [`arena.oreWall[${i}]`, key]),
    ...arena.workshop.map((key, i): [string, string] => [`arena.workshop[${i}]`, key]),
  ];
  for (const [path, key] of refs) if (!blockKeys.has(key)) add(path, `unknown block "${key}"`);
}

/** Icon masks: rows of equal length, `.` or a digit naming a palette colour. */
function checkMask(
  mask: readonly string[] | undefined,
  colors: number,
  path: string,
  add: AddIssue,
): void {
  if (!mask) return;
  if (mask.length === 0) add(path, 'mask is empty');
  mask.forEach((row, r) => {
    if (row.length !== mask[0]!.length) add(`${path}[${r}]`, 'rows must have the same length');
    for (const ch of row) {
      if (ch !== '.' && !(ch >= '0' && ch <= '9' && Number(ch) < colors))
        add(`${path}[${r}]`, `"${ch}" is neither "." nor a palette index`);
    }
  });
}

interface RuleView {
  readonly opaque: boolean;
  readonly shape: BlockDef['shape'];
  readonly collision: BlockDef['collision'];
  readonly filter?: number;
  readonly light?: BlockDef['light'];
}

/** Rules that must hold for a block and for each of its state overrides. */
function checkBlockRules(block: BlockDef, path: string, view: RuleView, add: AddIssue): void {
  const filter = view.filter ?? view.light?.filter ?? 0;
  const collides = view.collision !== 'none' && view.collision !== 'liquid';
  if (collides && !view.opaque && filter < 1) {
    add(`${path}.collision`, 'a block with collision must be opaque or have light.filter ≥ 1');
  }
  if (view.opaque && block.pass !== 'opaque')
    add(`${path}.pass`, 'an opaque block must use the opaque pass');
  if (view.opaque && view.shape !== 'cube') add(`${path}.shape`, 'an opaque block must be a cube');
}

/** Boxes must be 6 integers in 1/16 with 0 ≤ min < max ≤ 16 on every axis. */
function checkBoxes(
  value: BlockDef['shape'] | BlockDef['collision'] | undefined,
  path: string,
  add: AddIssue,
): void {
  if (typeof value !== 'object' || value === null) return;
  value.boxes.forEach((box, b) => {
    const ok =
      box.length === 6 &&
      box.every((v) => Number.isInteger(v) && v >= 0 && v <= 16) &&
      box[0] < box[3] &&
      box[1] < box[4] &&
      box[2] < box[5];
    if (!ok)
      add(`${path}.boxes[${b}]`, `invalid box [${box.join(', ')}] (integers 0–16, min < max)`);
  });
}

function checkTextures(block: BlockDef, path: string, textures: TextureSets, add: AddIssue): void {
  const needsTextures = block.shape !== 'none' && block.pass !== 'invisible';
  const slots = Object.entries(block.textures) as [TextureSlot, string][];
  if (needsTextures && slots.length === 0)
    add(`${path}.textures`, 'a visible block needs textures');
  for (const [slot, key] of slots) {
    if (!textures.keys.has(key)) add(`${path}.textures.${slot}`, `unknown texture "${key}"`);
    if (block.tint && textures.emissive.has(key)) {
      add(`${path}.textures.${slot}`, `"${key}" is emissive but the block is tinted`);
    }
  }
}

function checkLight(value: number | undefined, path: string, add: AddIssue): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > 15)
    add(path, `must be an integer 0–15 (got ${value})`);
}

function checkTints(
  tints: Readonly<Record<'grass' | 'foliage' | 'water', string>>,
  path: string,
  add: AddIssue,
): void {
  for (const channel of ['grass', 'foliage', 'water'] as const) {
    if (!HEX.test(tints[channel])) add(`${path}.${channel}`, 'must be a #rrggbb colour');
  }
}
