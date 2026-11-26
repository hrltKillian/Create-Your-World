import {
  type ContentPack,
  MASK_INDEX,
  type ModelDef,
  SKIN_SIZE,
  SKIN_TEXELS,
  type SkinDef,
  skinFaces,
} from './schema.ts';

type AddIssue = (path: string, message: string) => void;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The pack's skin atlases (plan v5 « M52 »): keys, palettes, glow and masks within SKIN_SIZE. */
export function validateSkins(pack: ContentPack, add: AddIssue): Map<string, SkinDef> {
  const skins = new Map<string, SkinDef>();
  (pack.skins ?? []).forEach((skin, i) => {
    const path = `skins[${i}]`;
    if (!skin.key.startsWith('skin:')) add(`${path}.key`, `"${skin.key}" must start with "skin:"`);
    if (skins.has(skin.key)) add(`${path}.key`, `duplicate skin "${skin.key}"`);
    skins.set(skin.key, skin);
    skin.palette.forEach((colour, c) => {
      if (!HEX.test(colour)) add(`${path}.palette[${c}]`, `"${colour}" is not a #rrggbb colour`);
    });
    for (const index of skin.glow ?? [])
      if (!(index >= 0 && index < skin.palette.length))
        add(`${path}.glow`, `no palette colour ${index}`);
    if (skin.mask.length > SKIN_SIZE) add(`${path}.mask`, `more than ${SKIN_SIZE} rows`);
    skin.mask.forEach((row, y) => {
      if (row.length > SKIN_SIZE) add(`${path}.mask[${y}]`, `more than ${SKIN_SIZE} texels`);
      for (const ch of row)
        if (
          ch !== '.' &&
          !(MASK_INDEX.indexOf(ch) >= 0 && MASK_INDEX.indexOf(ch) < skin.palette.length)
        ) {
          add(`${path}.mask[${y}]`, `"${ch}" names no palette colour`);
          break;
        }
    });
  });
  return skins;
}

/**
 * A skinned model's parts: each has a `uv` and no texture of its own, and every texel of its
 * unfolded faces is painted in the atlas (a hole would show through the box).
 */
export function validateSkinnedParts(
  model: ModelDef,
  skin: SkinDef,
  path: string,
  add: AddIssue,
): void {
  model.parts.forEach((part, k) => {
    const ppath = `${path}.parts[${k}]`;
    if (part.texture !== undefined || part.faces !== undefined)
      add(ppath, 'a skinned model takes its faces from its skin');
    if (!part.uv) {
      add(`${ppath}.uv`, 'a skinned model needs where its faces start');
      return;
    }
    const [u, v] = part.uv;
    const texels = (axis: number) => Math.round((part.to[axis]! - part.from[axis]!) * SKIN_TEXELS);
    for (const [face, [fu, fv, w, h]] of Object.entries(skinFaces(texels(0), texels(1), texels(2))))
      if (!painted(skin, u + fu!, v + fv!, w!, h!)) {
        add(`${ppath}.uv`, `its ${face} is not painted in ${skin.key}`);
        return;
      }
  });
}

function painted(skin: SkinDef, u: number, v: number, w: number, h: number): boolean {
  if (u < 0 || v < 0 || u + w > SKIN_SIZE || v + h > SKIN_SIZE) return false;
  for (let y = v; y < v + h; y++) {
    const row = skin.mask[y] ?? '';
    for (let x = u; x < u + w; x++) if ((row[x] ?? '.') === '.') return false;
  }
  return true;
}
