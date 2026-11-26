import { MIN_VARIANTS, SFX_LEVELS, type SfxDef } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** What the sound board does with a click. */
export interface SoundboardActions {
  /** Plays one variant of a one-shot. */
  play(key: string, variant: number): void;
  /** Starts (true) or stops a bed. */
  loop(key: string, on: boolean): void;
}

/**
 * The sound board (plan v5 « M53 », dev only: `?soundboard=1`): every recipe of the pack by its
 * loudness class, each one-shot's variants a button apiece, each bed a toggle, to listen to them
 * all.
 */
export function soundboard(recipes: readonly SfxDef[], actions: SoundboardActions): HTMLElement {
  const groups = (Object.keys(SFX_LEVELS) as (keyof typeof SFX_LEVELS)[]).map((level) => {
    const rows = recipes
      .filter((def) => (def.level ?? 'player') === level)
      .map((def) =>
        h('li', { class: 'soundboard-row' }, h('code', null, def.key), ...buttons(def, actions)),
      );
    return rows.length > 0
      ? h('section', null, h('h3', null, t(`soundboard.level.${level}`)), h('ul', null, ...rows))
      : null;
  });
  return h(
    'aside',
    { id: 'soundboard', class: 'soundboard' },
    h('h2', null, t('soundboard.title')),
    h('p', null, t('soundboard.help')),
    ...groups,
  );
}

function buttons(def: SfxDef, actions: SoundboardActions): HTMLElement[] {
  if (def.loop) {
    let on = false;
    const toggle = h(
      'button',
      {
        attrs: { 'data-sound': def.key, 'aria-pressed': 'false' },
        on: {
          click: () => {
            on = !on;
            toggle.setAttribute('aria-pressed', String(on));
            actions.loop(def.key, on);
          },
        },
      },
      t('soundboard.bed'),
    );
    return [toggle];
  }
  return Array.from({ length: def.variants ?? MIN_VARIANTS }, (_, v) =>
    h(
      'button',
      {
        attrs: { 'data-sound': def.key, 'data-variant': String(v) },
        on: { click: () => actions.play(def.key, v) },
      },
      v + 1,
    ),
  );
}
