import type { Registry } from '../content/registry.ts';
import type { BlockKey, CreatureDef } from '../content/schema.ts';
import { MET, STUDIED } from '../core/creatures.ts';
import { t } from '../i18n/i18n.ts';

/*
 * The Bestiary page (docs plan v2 « M17 »), pure: one row per creature of the pack, in pack order,
 * its text written from the data. A creature not met shows as « Unknown creature »; a met one
 * shows what it is, where and when it lives, what it eats and how it behaves; a studied one adds
 * its numbers.
 */

export interface BestiaryRow {
  readonly creature: string;
  /** 0 not met, 1 met, 2 studied (sim/bestiary.ts MET, STUDIED). */
  readonly level: number;
  readonly name: string;
  readonly lines: readonly string[];
}

/** A creature's name for a player who has met it at `level` (unknown before). */
export function creatureName(def: CreatureDef, level: number): string {
  return level >= MET ? t(def.nameKey) : t('bestiary.unknown');
}

/** Where and when it lives: its spawn entries' biomes (or caves) and hours. */
function whereText(registry: Registry, def: CreatureDef): string {
  const places: string[] = [];
  let when = '';
  for (const spawn of def.spawn) {
    const place =
      spawn.where === 'cave'
        ? t('bestiary.caves')
        : spawn.biomes === '*'
          ? t('bestiary.everywhere')
          : spawn.biomes
              .map((key) => {
                const biome = (registry.pack.biomes ?? []).find((b) => b.key === key);
                return t('bestiary.in', { biome: biome ? t(biome.nameKey) : key });
              })
              .join(t('bestiary.or'));
    if (!places.includes(place)) places.push(place);
    when = when === '' || when === spawn.when ? spawn.when : 'any';
  }
  return t('bestiary.where', {
    places: places.join(t('bestiary.or')),
    when: t(`bestiary.when.${when || 'any'}`),
  });
}

/** What it eats. */
function dietText(registry: Registry, def: CreatureDef): string | null {
  const names = (keys: readonly string[], name: (key: string) => string) =>
    keys.map(name).join(', ');
  if (def.diet.meat)
    return t('bestiary.diet.meat', {
      foods: names(def.diet.meat, (key) => t(registry.item(key)?.nameKey ?? key)),
    });
  if (def.diet.plants)
    return t('bestiary.diet.plants', {
      foods: names(def.diet.plants, (key) =>
        t(registry.blockDef(registry.defaultState(key as BlockKey)).nameKey),
      ),
    });
  return null;
}

/** Its numbers (studied only). */
function statLines(def: CreatureDef): string[] {
  const lines = [
    t('bestiary.stats', {
      health: def.health,
      walk: def.speed.walk,
      run: def.speed.run,
      stamina: def.stamina.runSeconds,
    }),
  ];
  const attack = def.attack;
  if (attack)
    lines.push(
      t('bestiary.blow', { damage: attack.damage, reach: attack.reach, windup: attack.windup }),
    );
  return lines;
}

/** The rows of the Bestiary for a player's entries (creature key → level). */
export function bestiaryRows(
  registry: Registry,
  bestiary: Readonly<Record<string, number>>,
): BestiaryRow[] {
  return (registry.pack.creatures ?? []).map((def) => {
    const level = bestiary[def.key] ?? 0;
    const lines: string[] = [t(`bestiary.level.${level}`)];
    if (level >= MET) {
      lines.push(
        `${t(`bestiary.category.${def.category}`)} · ${t(`bestiary.brain.${def.brain}`)}`,
        whereText(registry, def),
      );
      const diet = dietText(registry, def);
      if (diet) lines.push(diet);
      if (level >= STUDIED) lines.push(...statLines(def));
      else lines.push(t('bestiary.hidden'));
    }
    return { creature: def.key, level, name: creatureName(def, level), lines };
  });
}
