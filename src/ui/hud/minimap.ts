import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { type MapView, MINIMAP_SIDE } from '../map.ts';
import { MapCanvas } from '../mapCanvas.ts';

/**
 * The minimap at the top right of the HUD (plan v3 « M27 », « M31 »): the explored land around
 * the player, a pixel a block, north up, the player in the middle, the waypoints (kept on its
 * edge); under it the player's coordinates and the key of the big map.
 */
export class Minimap {
  readonly element: HTMLElement;
  private readonly canvas = new MapCanvas(MINIMAP_SIDE, 'minimap-canvas', {
    iconSize: 10,
    labels: false,
    clampToEdge: true,
  });
  private readonly hint: HTMLElement;

  constructor() {
    this.hint = h('p', { class: 'minimap-hint' });
    this.element = h(
      'div',
      { id: 'hud-map', class: 'hud-map', attrs: { 'aria-label': t('hud.map') } },
      this.canvas.element,
      this.hint,
    );
  }

  update(view: MapView, key: string): void {
    this.canvas.draw(view);
    const x = Math.floor(view.player.x);
    const z = Math.floor(view.player.z);
    const text = t('hud.mapKey', { key, x, z });
    if (this.hint.textContent !== text) this.hint.textContent = text;
  }
}
