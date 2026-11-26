import {
  type ContentPack,
  CREATURE_BRAINS,
  CREATURE_CATEGORIES,
  CREATURE_SOUNDS,
  type CreatureDef,
  type CreatureSpawn,
  GAIT_LEGS,
  HOSTILE_MAX_LIGHT,
} from './schema.ts';
import { validateSkinnedParts, validateSkins } from './validateSkins.ts';

type AddIssue = (path: string, message: string) => void;

const positive = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v > 0;
const atLeast0 = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0);
const fraction = (v: number | undefined) => v === undefined || (v >= 0 && v <= 1);
const whole = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;

/** Models (parts, gait legs) and creatures (stats, senses, traits, spawns, loot, voices). */
export function validateCreatures(
  pack: ContentPack,
  textureKeys: ReadonlySet<string>,
  lootKeys: ReadonlySet<string>,
  add: AddIssue,
): void {
  const models = validateModels(pack, textureKeys, add);
  const biomes = new Set((pack.biomes ?? []).map((b) => b.key as string));
  const sfx = new Set((pack.sfx ?? []).map((s) => s.key as string));
  const keys = new Set<string>();
  const blocks = new Set(pack.blocks.map((b) => b.key as string));
  const items = new Set((pack.items ?? []).map((item) => item.key as string));
  (pack.creatures ?? []).forEach((creature, i) => {
    const path = `creatures[${i}]`;
    if (!creature.key.startsWith('creature:'))
      add(`${path}.key`, `"${creature.key}" must start with "creature:"`);
    if (keys.has(creature.key)) add(`${path}.key`, `duplicate creature "${creature.key}"`);
    keys.add(creature.key);
    if (pack.strings[creature.nameKey] === undefined)
      add(`${path}.nameKey`, `no string for "${creature.nameKey}"`);
    if (!models.has(creature.model)) add(`${path}.model`, `unknown model "${creature.model}"`);
    if (!lootKeys.has(creature.loot)) add(`${path}.loot`, `unknown loot table "${creature.loot}"`);
    checkBody(creature, path, add);
    const a = creature.agility;
    if (!(a.groundAccel > 0 && a.airAccel > 0 && a.turnDegPerSec > 0))
      add(`${path}.agility`, 'accelerations and turn rate must be positive');
    if (!(creature.stamina.runSeconds > 0)) add(`${path}.stamina`, 'needs a positive runSeconds');
    (creature.diet.plants ?? []).forEach((key, d) => {
      if (!blocks.has(key)) add(`${path}.diet.plants[${d}]`, `unknown block "${key}"`);
    });
    (creature.diet.meat ?? []).forEach((key, d) => {
      if (!items.has(key)) add(`${path}.diet.meat[${d}]`, `unknown item "${key}"`);
    });
    creature.spawn.forEach((spawn, s) => {
      checkSpawn(creature, spawn, `${path}.spawn[${s}]`, biomes, add);
    });
    if (creature.spawn.length === 0) add(`${path}.spawn`, 'needs at least one spawn entry');
    for (const [sound, key] of Object.entries(creature.sounds)) {
      if (!(CREATURE_SOUNDS as readonly string[]).includes(sound))
        add(`${path}.sounds.${sound}`, `unknown creature sound "${sound}"`);
      else if (!sfx.has(key)) add(`${path}.sounds.${sound}`, `no recipe for "${key}"`);
    }
  });
}

/** Size, health, speeds, brain, attack, senses and traits. */
function checkBody(creature: CreatureDef, path: string, add: AddIssue): void {
  const [width, height] = creature.hitbox;
  // Paths walk single cells: a creature fits a one-block corridor.
  if (!(positive(width) && width < 1 && positive(height) && height <= 2))
    add(`${path}.hitbox`, 'must be a width in (0, 1) and a height in (0, 2] (blocks)');
  if (!positive(creature.health)) add(`${path}.health`, 'must be > 0');
  if (!positive(creature.speed.walk)) add(`${path}.speed.walk`, 'must be > 0');
  if (!(creature.speed.run >= creature.speed.walk))
    add(`${path}.speed.run`, 'must be at least the walk speed');
  if (!CREATURE_BRAINS.includes(creature.brain))
    add(`${path}.brain`, `unknown brain "${creature.brain}"`);
  if (!CREATURE_CATEGORIES.includes(creature.category))
    add(`${path}.category`, `unknown category "${creature.category}"`);
  const attack = creature.attack;
  if ((creature.category === 'passive') !== (attack === undefined))
    add(`${path}.attack`, 'a passive creature never attacks, the others need an attack');
  if (attack) {
    for (const field of ['damage', 'reach', 'cooldown'] as const)
      if (!positive(attack[field])) add(`${path}.attack.${field}`, 'must be > 0');
    for (const field of ['windup', 'knockback', 'toxicity'] as const)
      if (!atLeast0(attack[field])) add(`${path}.attack.${field}`, 'must be ≥ 0');
  }
  const senses = creature.senses;
  if (!positive(senses.sight)) add(`${path}.senses.sight`, 'must be > 0');
  if (!(positive(senses.fovDeg) && senses.fovDeg <= 360))
    add(`${path}.senses.fovDeg`, 'must be within (0, 360] degrees');
  if (!atLeast0(senses.hearing)) add(`${path}.senses.hearing`, 'must be ≥ 0');
  const traits = creature.traits ?? {};
  for (const field of ['watchedSpeedMul', 'frontArmor', 'knockbackResist'] as const)
    if (!fraction(traits[field])) add(`${path}.traits.${field}`, 'must be within 0–1');
  for (const field of ['wallStunSec', 'fleeSec', 'herdAlertRadius', 'territoryRadius'] as const)
    if (!atLeast0(traits[field])) add(`${path}.traits.${field}`, 'must be ≥ 0');
  const aversion = traits.lightAversion;
  if (aversion !== undefined && !whole(aversion, 1, 15))
    add(`${path}.traits.lightAversion`, 'must be a light level of 1–15');
  const escalation = traits.escalation;
  if (escalation && !(atLeast0(escalation.perDay) && whole(escalation.maxDays, 0, 1000)))
    add(`${path}.traits.escalation`, 'needs perDay ≥ 0 and a whole maxDays ≥ 0');
}

function checkSpawn(
  creature: CreatureDef,
  spawn: CreatureSpawn,
  path: string,
  biomes: ReadonlySet<string>,
  add: AddIssue,
): void {
  if (spawn.biomes !== '*') {
    if (spawn.biomes.length === 0) add(`${path}.biomes`, 'needs at least one biome, or "*"');
    spawn.biomes.forEach((key, b) => {
      if (!biomes.has(key)) add(`${path}.biomes[${b}]`, `unknown biome "${key}"`);
    });
  }
  if (!['day', 'night', 'any'].includes(spawn.when)) add(`${path}.when`, `unknown "${spawn.when}"`);
  if (!['surface', 'cave'].includes(spawn.where)) add(`${path}.where`, `unknown "${spawn.where}"`);
  const light = spawn.maxLight;
  if (light !== undefined && !whole(light, 0, 15))
    add(`${path}.maxLight`, 'must be a light level of 0–15');
  if (creature.category === 'hostile' && !(light !== undefined && light <= HOSTILE_MAX_LIGHT))
    add(`${path}.maxLight`, `hostiles only spawn at a light of ${HOSTILE_MAX_LIGHT} or less`);
  const [min, max] = spawn.group;
  if (!(whole(min, 1, 64) && whole(max, min, 64)))
    add(`${path}.group`, 'must be whole numbers 1 ≤ min ≤ max ≤ 64');
  if (!positive(spawn.weight)) add(`${path}.weight`, 'must be > 0');
}

/** Model keys, parts (textures, parents before children, extents) and gait legs. */
function validateModels(
  pack: ContentPack,
  textureKeys: ReadonlySet<string>,
  add: AddIssue,
): Set<string> {
  const keys = new Set<string>();
  const skins = validateSkins(pack, add);
  (pack.models ?? []).forEach((model, i) => {
    const path = `models[${i}]`;
    if (!model.key.startsWith('model:'))
      add(`${path}.key`, `"${model.key}" must start with "model:"`);
    if (keys.has(model.key)) add(`${path}.key`, `duplicate model "${model.key}"`);
    keys.add(model.key);
    if (!positive(model.stride)) add(`${path}.stride`, 'must be > 0');
    const legs = GAIT_LEGS[model.gait];
    if (!legs) add(`${path}.gait`, `unknown gait "${model.gait}"`);
    const names = new Set<string>();
    model.parts.forEach((part, k) => {
      const ppath = `${path}.parts[${k}]`;
      if (names.has(part.name)) add(`${ppath}.name`, `duplicate part "${part.name}"`);
      if (legs && part.name.startsWith('leg') && legs[part.name] === undefined)
        add(`${ppath}.name`, `a ${model.gait} has no leg "${part.name}"`);
      if (!model.skin && !(part.texture && textureKeys.has(part.texture)))
        add(`${ppath}.texture`, `unknown texture "${part.texture}"`);
      for (const [face, key] of Object.entries(part.faces ?? {}))
        if (key && !textureKeys.has(key)) add(`${ppath}.faces.${face}`, `unknown texture "${key}"`);
      if (part.parent !== undefined && !names.has(part.parent))
        add(`${ppath}.parent`, `no part "${part.parent}" before this one`);
      if (part.from.some((v, a) => !(v < part.to[a]!)))
        add(ppath, 'from must be below to on every axis');
      names.add(part.name);
    });
    for (const leg of Object.keys(legs ?? {}))
      if (!names.has(leg)) add(`${path}.parts`, `a ${model.gait} needs the leg "${leg}"`);
    if (model.skin !== undefined) {
      const skin = skins.get(model.skin);
      if (skin) validateSkinnedParts(model, skin, path, add);
      else add(`${path}.skin`, `unknown skin "${model.skin}"`);
    }
  });
  const avatar = pack.manifest.bindings.avatarModel;
  if (avatar && !keys.has(avatar))
    add('manifest.bindings.avatarModel', `unknown model "${avatar}"`);
  return keys;
}
