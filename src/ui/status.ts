import type { ProgressionBalance } from '../content/schema.ts';
import { t } from '../i18n/i18n.ts';
import type { Skill } from '../sim/progression.ts';

/*
 * The Status page (plan v3 « M22 »), pure: the level, the XP into it, the skill points left and a
 * row per skill with the exact rule of its bonus now. The app passes the numbers the simulation
 * computes and its skills in order (sim/progression.ts `SKILLS`).
 */

export interface SkillRow {
  readonly skill: Skill;
  readonly name: string;
  /** « 2/5 ». */
  readonly points: string;
  /** The bonus now and per point, in the rule's own unit. */
  readonly rule: string;
  readonly canSpend: boolean;
}

export interface StatusView {
  readonly level: string;
  readonly xp: string;
  readonly pointsLeft: string;
  readonly skills: readonly SkillRow[];
}

/** What the simulation says of a player's progress. */
export interface Progress {
  readonly level: number;
  readonly xpIntoLevel: number;
  readonly xpToNext: number;
  readonly pointsLeft: number;
  readonly skills: Readonly<Record<Skill, number>>;
  /** A carrying point still fits the largest inventory. */
  readonly bagRoom: boolean;
}

/** A per-point number as the rule shows it: shares as percents, others as they are. */
function shown(skill: Skill, value: number): number {
  const share = skill === 'metabolism' || skill === 'strength';
  return Math.round((share ? value * 100 : value) * 10) / 10;
}

export function statusView(
  progress: Progress,
  p: ProgressionBalance,
  order: readonly Skill[],
): StatusView {
  return {
    level: t('status.level', { n: progress.level }),
    xp: t('status.xp', {
      xp: progress.xpIntoLevel,
      next: progress.xpToNext,
      n: progress.level + 1,
    }),
    pointsLeft: t('status.points', { n: progress.pointsLeft }),
    skills: order.map((skill): SkillRow => {
      const points = progress.skills[skill];
      const each = shown(skill, p.skills[skill]);
      return {
        skill,
        name: t(`skill.${skill}`),
        points: `${points}/${p.maxSkill}`,
        rule: t(`skill.${skill}.rule`, { total: shown(skill, p.skills[skill] * points), each }),
        canSpend:
          progress.pointsLeft > 0 &&
          points < p.maxSkill &&
          (skill !== 'carrying' || progress.bagRoom),
      };
    }),
  };
}
