import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { menuButton, menuPanel } from './menuParts.ts';

/** What the New world screen asks for (the app fills the blanks: name, random seed). */
export interface NewWorldForm {
  readonly name: string;
  /** Empty: a random seed. */
  readonly seed: string;
  readonly hostiles: boolean;
}

export interface NewWorldActions {
  create(form: NewWorldForm): void;
  back(): void;
}

/** Longest world name typed (the app trims it again). */
export const WORLD_NAME_MAX = 40;

/** The New world screen: name, seed and hostile creatures; Enter creates the world. */
export class NewWorldScreen {
  readonly element: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly seed: HTMLInputElement;
  private readonly hostiles: HTMLInputElement;

  constructor(actions: NewWorldActions) {
    this.name = h('input', {
      attrs: { type: 'text', name: 'name', maxlength: String(WORLD_NAME_MAX), autocomplete: 'off' },
    });
    this.seed = h('input', {
      attrs: {
        type: 'text',
        name: 'seed',
        maxlength: '64',
        autocomplete: 'off',
        placeholder: t('newWorld.seedHint'),
      },
    });
    this.hostiles = h('input', { attrs: { type: 'checkbox', name: 'hostiles' } });
    const back = menuButton('back', t('menu.back'), () => actions.back());
    const form = h(
      'form',
      { class: 'menu-form', attrs: { novalidate: '' } },
      field(t('newWorld.name'), this.name),
      field(t('newWorld.seed'), this.seed),
      h(
        'label',
        { class: 'setting setting-check' },
        this.hostiles,
        h('span', { class: 'setting-label' }, t('newWorld.hostiles')),
      ),
      h(
        'div',
        { class: 'menu-row' },
        h(
          'button',
          { class: 'button', attrs: { type: 'submit', 'data-action': 'create' } },
          t('newWorld.create'),
        ),
        back,
      ),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      actions.create({
        name: this.name.value,
        seed: this.seed.value,
        hostiles: this.hostiles.checked,
      });
    });
    this.element = menuPanel('screen-new-world', 'newWorld.title', form);
  }

  /** Clears the form before it shows: the suggested name, the seed (dev `?seed=`), hostiles on. */
  reset(name: string, seed: string): void {
    this.name.value = name;
    this.seed.value = seed;
    this.hostiles.checked = true;
  }
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  return h(
    'label',
    { class: 'setting setting-field' },
    h('span', { class: 'setting-label' }, label),
    input,
  );
}
