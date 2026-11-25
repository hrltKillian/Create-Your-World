import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { BIG_MAP_SIDE, type MapView } from '../map.ts';
import { MapCanvas } from '../mapCanvas.ts';
import type { ScreenActions } from '../slotBoard.ts';

/**
 * The big map (plan v3 « M27 », its key M; the HUD's minimap shows the land close by): the
 * explored land around the player, the waypoints listed with a « Remove » each
 * (`waypoint.remove`), and a name box with « Mark this place » (`waypoint.add`). Buttons carry
 * `data-action` (`waypoint-add`, `waypoint-remove`), the name box `waypoint-name`, the rows
 * `data-waypoint`. A fixed size: the list scrolls.
 */
export class MapScreen {
  readonly element: HTMLElement;
  private readonly canvas = new MapCanvas(BIG_MAP_SIDE, 'map-canvas');
  private readonly list: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly closeHint: HTMLElement;
  private readonly actions: ScreenActions;
  private readonly closeKey: () => string;
  private shownList: string | null = null;

  constructor(actions: ScreenActions, closeKey: () => string) {
    this.actions = actions;
    this.closeKey = closeKey;
    this.name = h('input', {
      class: 'map-name',
      attrs: {
        type: 'text',
        maxlength: '24',
        placeholder: t('map.name'),
        'data-action': 'waypoint-name',
      },
    }) as HTMLInputElement;
    const add = h(
      'button',
      {
        class: 'quest-pin',
        attrs: { type: 'button', 'data-action': 'waypoint-add' },
        on: {
          click: () => {
            this.actions.click();
            this.actions.send({ type: 'waypoint.add', name: this.name.value });
            this.name.value = '';
          },
        },
      },
      t('map.mark'),
    );
    this.list = h('ul', { class: 'map-waypoints' });
    this.closeHint = h('p', { class: 'bag-close' });
    this.element = h(
      'section',
      { id: 'screen-map', class: 'screen screen-map' },
      h(
        'div',
        { class: 'bag-panel map-panel' },
        h('header', { class: 'bag-header' }, h('h2', null, t('map.title')), this.closeHint),
        h(
          'div',
          { class: 'map' },
          this.canvas.element,
          h(
            'div',
            { class: 'map-side' },
            h('p', { class: 'bag-section' }, t('map.waypoints')),
            this.list,
            h('div', { class: 'map-mark' }, this.name, add),
          ),
        ),
      ),
    );
    this.element.hidden = true;
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    if (this.isOpen()) return;
    this.closeHint.textContent = t('bag.close', { key: this.closeKey() });
    this.element.hidden = false;
    this.actions.click();
  }

  close(): void {
    if (!this.isOpen()) return;
    // A clicked button keeps the focus while hidden: Space or Enter would press it during play.
    const active = document.activeElement as HTMLElement | null | undefined;
    if (active && this.element.contains(active)) active.blur();
    this.element.hidden = true;
    this.actions.click();
  }

  /** No slots on the map. */
  hotkey(): void {}

  update(view: MapView): void {
    this.canvas.draw(view);
    const key = view.waypoints.map((w) => w.name).join('\n');
    if (key === this.shownList) return;
    this.shownList = key;
    this.list.replaceChildren(
      ...view.waypoints.map((w, index) =>
        h(
          'li',
          { attrs: { 'data-waypoint': String(index) } },
          h('span', null, w.name),
          h(
            'button',
            {
              class: 'quest-pin',
              attrs: { type: 'button', 'data-action': 'waypoint-remove' },
              on: {
                click: () => {
                  this.actions.click();
                  this.actions.send({ type: 'waypoint.remove', index });
                },
              },
            },
            t('map.remove'),
          ),
        ),
      ),
    );
    if (view.waypoints.length === 0)
      this.list.append(h('li', { class: 'map-none' }, t('map.none')));
  }
}
