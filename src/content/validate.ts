import { type BlockDef, type ContentPack, STATE_VALUES, type TextureSlot } from './schema.ts';

export interface ContentIssue {
  /** Exact location in the pack, e.g. `blocks[3].textures.top`. */
  readonly path: string;
  readonly message: string;
}

export const MAX_TEXTURE_LAYERS = 256;
export const MAX_STATES = 65_535;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Semantic validation of a content pack. Returns every issue found (empty = valid). */
export function validatePack(pack: ContentPack): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const { manifest } = pack;

  const size = manifest.textureSize;
  if (!Number.isInteger(size) || size < 8 || size > 64 || (size & (size - 1)) !== 0) {
    add('manifest.textureSize', `must be a power of two between 8 and 64 (got ${size})`);
  }

  const textureKeys = new Set<string>();
  pack.textures.forEach((tex, i) => {
    const path = `textures[${i}]`;
    if (!tex.key.startsWith('tex:')) add(`${path}.key`, `"${tex.key}" must start with "tex:"`);
    if (textureKeys.has(tex.key)) add(`${path}.key`, `duplicate texture "${tex.key}"`);
    textureKeys.add(tex.key);
    if (tex.palette.length === 0) add(`${path}.palette`, 'palette is empty');
    tex.palette.forEach((color, c) => {
      if (!HEX.test(color)) add(`${path}.palette[${c}]`, `"${color}" is not a #rrggbb colour`);
    });
  });
  if (pack.textures.length > MAX_TEXTURE_LAYERS) {
    add(
      'textures',
      `${pack.textures.length} textures exceed the ${MAX_TEXTURE_LAYERS}-layer limit`,
    );
  }
  const emissiveTextures = new Set(
    pack.textures.filter((tex) => tex.alpha === 'emissiveMask').map((tex) => tex.key),
  );

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
    checkTextures(block, path, textureKeys, emissiveTextures, add);
    checkLight(block.light?.emit, `${path}.light.emit`, add);
    checkLight(block.light?.filter, `${path}.light.filter`, add);
    if (block.hardness < 0 && block.hardness !== -1)
      add(`${path}.hardness`, 'must be ≥ 0 (or -1 for unbreakable)');

    const props = block.states ?? [];
    const seen = new Set<string>();
    let combos = 1;
    props.forEach((prop, p) => {
      if (!(prop in STATE_VALUES)) add(`${path}.states[${p}]`, `unknown state "${prop}"`);
      if (seen.has(prop)) add(`${path}.states[${p}]`, `duplicate state "${prop}"`);
      seen.add(prop);
      combos *= STATE_VALUES[prop]?.length ?? 1;
    });
    stateTotal += combos;
    for (const [prop, override] of Object.entries(block.whenState ?? {})) {
      if (!seen.has(prop)) add(`${path}.whenState.${prop}`, `block has no "${prop}" state`);
      for (const [slot, key] of Object.entries(override?.textures ?? {})) {
        if (!textureKeys.has(key))
          add(`${path}.whenState.${prop}.textures.${slot}`, `unknown texture "${key}"`);
      }
      checkLight(override?.emit, `${path}.whenState.${prop}.emit`, add);
    }

    checkBlockRules(block, path, block, add);
    checkBoxes(block.shape, `${path}.shape`, add);
    checkBoxes(block.collision, `${path}.collision`, add);
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
        if (block.tint && emissiveTextures.has(key))
          add(`${opath}.textures.${slot}`, `"${key}" is emissive but the block is tinted`);
      }
    }
    if (block.tint && block.pass === 'opaque') {
      const tintAware = new Set(
        pack.textures
          .filter((t) => t.alpha === 'tintMask' || t.alpha === 'tintFull')
          .map((t) => t.key as string),
      );
      if (!Object.values(block.textures).some((key) => tintAware.has(key))) {
        add(
          `${path}.tint`,
          'a tinted opaque block needs at least one tintMask or tintFull texture',
        );
      }
    }
  });

  if (stateTotal > MAX_STATES) add('blocks', `${stateTotal} block states exceed ${MAX_STATES}`);

  const bindings = manifest.bindings;
  if (pack.blocks[0]?.key !== bindings.air) {
    add('manifest.bindings.air', `the air block "${bindings.air}" must be the first block`);
  }
  for (const [name, key] of Object.entries(bindings)) {
    if (!blockKeys.has(key)) add(`manifest.bindings.${name}`, `unknown block "${key}"`);
  }
  const scene = pack.devScene;
  if (scene) {
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
  for (const channel of ['grass', 'foliage', 'water'] as const) {
    if (!HEX.test(pack.tints[channel])) add(`tints.${channel}`, 'must be a #rrggbb colour');
  }
  return issues;
}

interface RuleView {
  readonly opaque: boolean;
  readonly shape: BlockDef['shape'];
  readonly collision: BlockDef['collision'];
  readonly filter?: number;
  readonly light?: BlockDef['light'];
}

/** Rules that must hold for a block and for each of its state overrides. */
function checkBlockRules(
  block: BlockDef,
  path: string,
  view: RuleView,
  add: (path: string, message: string) => void,
): void {
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
  add: (path: string, message: string) => void,
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

function checkTextures(
  block: BlockDef,
  path: string,
  known: ReadonlySet<string>,
  emissive: ReadonlySet<string>,
  add: (path: string, message: string) => void,
): void {
  const needsTextures = block.shape !== 'none' && block.pass !== 'invisible';
  const slots = Object.entries(block.textures) as [TextureSlot, string][];
  if (needsTextures && slots.length === 0)
    add(`${path}.textures`, 'a visible block needs textures');
  for (const [slot, key] of slots) {
    if (!known.has(key)) add(`${path}.textures.${slot}`, `unknown texture "${key}"`);
    if (block.tint && emissive.has(key)) {
      add(`${path}.textures.${slot}`, `"${key}" is emissive but the block is tinted`);
    }
  }
}

function checkLight(
  value: number | undefined,
  path: string,
  add: (path: string, message: string) => void,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > 15)
    add(path, `must be an integer 0–15 (got ${value})`);
}
