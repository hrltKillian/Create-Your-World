import { WAYPOINT_COLOURS, WAYPOINT_ICONS, type WaypointIcon } from '../../core/waypoints.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import {
  BIG_MAP_SIDE,
  drawWaypointIcon,
  type MapView,
  type MapWaypoint,
  WAYPOINT_PALETTE,
} from '../map.ts';
import { MapCanvas } from '../mapCanvas.ts';
import type { ScreenActions } from '../slotBoard.ts';
import { menuButton } from './menuParts.ts';

/** A press that moves less than this (pixels) is a click: it picks a place. */
const CLICK_SLOP = 4;
/** Pixels a block side the map is drawn at, from the whole explored area to the closest look. */
export const MAP_ZOOMS = [1, 2, 4, 8] as const;
/** Pixels of a symbol in the pickers and the list. */
const PICKER_ICON = 18;

/**
 * The big map (plan v3 « M27 », detailed at « M31 »; its key M): the explored land, a pixel a
 * block, dragged with the mouse to see all of it (« Centre on me » brings it back), zoomed in up to
 * 8 pixels a block by the wheel (about the pointer) or « + » / « − » to pick a place precisely; a
 * click picks a place, marked there. The player's coordinates, the pointed block's and the picked place's show
 * under it. Beside it the waypoints, each with its symbol, name, coordinates and distance, « Show »
 * (the map centres on it) and « Remove »; then the new one's name, symbol and colour and « Mark »
 * (at the picked place, else at the feet). Fixed size: the list scrolls. `data-action`:
 * `map-centre`, `map-zoom-in`, `map-zoom-out`, `waypoint-name`, `waypoint-add`, `waypoint-show`,
 * `waypoint-remove`; the pickers `data-icon`, `data-colour`; the rows `data-waypoint`.
 */
export class MapScreen {
  readonly element: HTMLElement;
  private readonly canvas = new MapCanvas(BIG_MAP_SIDE, 'map-canvas', {
    iconSize: 14,
    labels: true,
    clampToEdge: false,
  });
  private readonly list: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly coords: HTMLElement;
  private readonly pointerAt: HTMLElement;
  private readonly where: HTMLElement;
  private readonly icons: HTMLElement;
  private readonly colours: HTMLElement;
  private readonly closeHint: HTMLElement;
  private readonly zoomLabel: HTMLElement;
  private readonly actions: ScreenActions;
  private readonly closeKey: () => string;
  private shownList: string | null = null;
  private view: MapView | null = null;
  /** The map's centre from the player's feet (blocks): where it was dragged. */
  private panX = 0;
  private panZ = 0;
  /** The place picked by a click (null: the player's feet). */
  private picked: { x: number; z: number } | null = null;
  private icon: WaypointIcon = WAYPOINT_ICONS[0];
  private colour = 0;
  private drag: { x: number; y: number; panX: number; panZ: number; moved: boolean } | null = null;
  /** The map moved since it was last drawn: UiBridge draws it again at once. */
  stale = false;

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
    const add = menuButton('waypoint-add', t('map.mark'), () => this.mark(), 'quest-pin');
    const centre = menuButton('map-centre', t('map.centre'), () => this.centre(), 'quest-pin');
    const zoomIn = menuButton('map-zoom-in', t('map.zoomIn'), () => this.zoomBy(1), 'quest-pin');
    const zoomOut = menuButton(
      'map-zoom-out',
      t('map.zoomOut'),
      () => this.zoomBy(-1),
      'quest-pin',
    );
    this.zoomLabel = h('span', { class: 'map-zoom' });
    this.list = h('ul', { class: 'map-waypoints' });
    this.coords = h('p', { class: 'map-coords' });
    this.pointerAt = h('p', { class: 'map-coords map-pointer' });
    this.where = h('p', { class: 'map-where' });
    this.icons = h('div', { class: 'map-picker' });
    this.colours = h('div', { class: 'map-picker' });
    this.closeHint = h('p', { class: 'bag-close' });
    const map = this.canvas.element;
    map.addEventListener('pointerdown', this.onDown);
    map.addEventListener('pointermove', this.onMove);
    map.addEventListener('pointerup', this.onUp);
    map.addEventListener('pointerleave', () => {
      this.drag = null;
    });
    map.addEventListener('wheel', this.onWheel, { passive: false });
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
          h(
            'div',
            { class: 'map-view' },
            map,
            h(
              'div',
              { class: 'map-bar' },
              h('div', { class: 'map-where-now' }, this.coords, this.pointerAt),
              h('span', { class: 'map-zoom-bar' }, zoomOut, this.zoomLabel, zoomIn, centre),
            ),
          ),
          h(
            'div',
            { class: 'map-side' },
            h('p', { class: 'bag-section' }, t('map.waypoints')),
            this.list,
            h('p', { class: 'bag-section' }, t('map.new')),
            this.name,
            this.icons,
            this.colours,
            this.where,
            add,
          ),
        ),
      ),
    );
    this.element.hidden = true;
    this.drawPickers();
    this.showZoom();
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Opens on the player, nothing picked. */
  open(): void {
    if (this.isOpen()) return;
    this.closeHint.textContent = t('bag.close', { key: this.closeKey() });
    this.panX = 0;
    this.panZ = 0;
    this.picked = null;
    this.element.hidden = false;
    this.stale = true;
    this.actions.click();
  }

  close(): void {
    if (!this.isOpen()) return;
    // A clicked button keeps the focus while hidden: Space or Enter would press it during play.
    const active = document.activeElement as HTMLElement | null | undefined;
    if (active && this.element.contains(active)) active.blur();
    this.element.hidden = true;
    this.drag = null;
    this.actions.click();
  }

  /** No slots on the map. */
  hotkey(): void {}

  /** The block the map is centred on for a player at (x, z): their feet moved by the drag. */
  centreFor(x: number, z: number): { x: number; z: number } {
    return { x: Math.floor(x) + this.panX, z: Math.floor(z) + this.panZ };
  }

  update(view: MapView): void {
    this.view = view;
    this.stale = false;
    this.canvas.draw(view);
    this.showWhere();
    const key = view.waypoints
      .map((w) => `${w.name}|${w.x}|${w.z}|${w.icon}|${w.colour}|${distance(view, w)}`)
      .join('\n');
    if (key === this.shownList) return;
    this.shownList = key;
    this.list.replaceChildren(...view.waypoints.map((w, index) => this.row(view, w, index)));
    if (view.waypoints.length === 0)
      this.list.append(h('li', { class: 'map-none' }, t('map.none')));
  }

  /**
   * The player's coordinates, the pointed block's on their own line (kept when the pointer leaves,
   * so the bar never moves), and the picked place's.
   */
  private showWhere(pointer?: { x: number; z: number }): void {
    const view = this.view;
    if (!view) return;
    const me = t('map.you', { x: Math.floor(view.player.x), z: Math.floor(view.player.z) });
    if (this.coords.textContent !== me) this.coords.textContent = me;
    if (pointer) this.pointerAt.textContent = t('map.pointer', pointer);
    const where = this.picked ? t('map.at', this.picked) : t('map.atFeet');
    if (this.where.textContent !== where) this.where.textContent = where;
  }

  private row(view: MapView, w: MapWaypoint, index: number): HTMLElement {
    const show = menuButton('waypoint-show', t('map.show'), () => this.showOn(w), 'quest-pin');
    const remove = menuButton(
      'waypoint-remove',
      t('map.remove'),
      () => {
        this.actions.click();
        this.actions.send({ type: 'waypoint.remove', index });
      },
      'quest-pin',
    );
    return h(
      'li',
      { attrs: { 'data-waypoint': String(index) } },
      iconCanvas(w.icon, WAYPOINT_PALETTE[w.colour] ?? WAYPOINT_PALETTE[0]),
      h(
        'span',
        { class: 'map-waypoint-text' },
        h('strong', null, w.name),
        h(
          'span',
          { class: 'map-waypoint-coords' },
          t('map.coords', { x: w.x, z: w.z, d: distance(view, w) }),
        ),
      ),
      show,
      remove,
    );
  }

  /** The symbols and colours to choose the new waypoint's from (the chosen one pressed). */
  private drawPickers(): void {
    const colour = WAYPOINT_PALETTE[this.colour] ?? WAYPOINT_PALETTE[0];
    this.icons.replaceChildren(
      ...WAYPOINT_ICONS.map((icon) =>
        h(
          'button',
          {
            class: 'map-pick',
            attrs: {
              type: 'button',
              'data-icon': icon,
              'aria-pressed': String(icon === this.icon),
              'aria-label': t(`map.icon.${icon}`),
            },
            on: { click: () => this.choose(icon, this.colour) },
          },
          iconCanvas(icon, colour),
        ),
      ),
    );
    this.colours.replaceChildren(
      ...WAYPOINT_PALETTE.slice(0, WAYPOINT_COLOURS).map((swatch, index) =>
        h('button', {
          class: 'map-pick map-swatch',
          attrs: {
            type: 'button',
            'data-colour': String(index),
            'aria-pressed': String(index === this.colour),
            style: `--swatch: ${swatch}`,
          },
          on: { click: () => this.choose(this.icon, index) },
        }),
      ),
    );
  }

  private choose(icon: WaypointIcon, colour: number): void {
    this.icon = icon;
    this.colour = colour;
    this.actions.click();
    this.drawPickers();
  }

  /** Marks the new waypoint at the picked place, else at the feet. */
  private mark(): void {
    this.actions.click();
    const at = this.picked ?? {};
    this.actions.send({
      type: 'waypoint.add',
      name: this.name.value,
      icon: this.icon,
      colour: this.colour,
      ...at,
    });
    this.name.value = '';
    this.picked = null;
    this.showWhere();
  }

  /** Zooms in (+1) or out (−1) a level, about a canvas pixel (its middle by default). */
  private zoomBy(step: number, px = BIG_MAP_SIDE / 2, py = BIG_MAP_SIDE / 2): void {
    const view = this.view;
    const levels: readonly number[] = MAP_ZOOMS;
    const level = levels.indexOf(this.canvas.zoom) + step;
    if (!view || level < 0 || level >= levels.length) return;
    this.actions.click();
    // The point under the pixel stays under it: the centre moves towards it (whole blocks).
    const half = BIG_MAP_SIDE / 2;
    const before = this.canvas.zoom;
    const zoom = levels[level]!;
    this.canvas.zoom = zoom;
    const shift = (p: number) => (p - half) / before - (p - half) / zoom;
    this.panX += Math.round(shift(px));
    this.panZ += Math.round(shift(py));
    this.stale = true;
    this.showZoom();
  }

  private showZoom(): void {
    this.zoomLabel.textContent = t('map.zoom', { n: this.canvas.zoom });
  }

  /** Centres the map on the player again. */
  private centre(): void {
    this.actions.click();
    this.panX = 0;
    this.panZ = 0;
    this.stale = true;
  }

  /** Centres the map on a waypoint. */
  private showOn(w: MapWaypoint): void {
    const view = this.view;
    if (!view) return;
    this.actions.click();
    this.panX = w.x - Math.floor(view.player.x);
    this.panZ = w.z - Math.floor(view.player.z);
    this.stale = true;
  }

  /** Canvas pixels of a pointer event (the canvas may be drawn larger or smaller). */
  private pixel(event: MouseEvent): { x: number; y: number } {
    const box = this.canvas.element.getBoundingClientRect?.();
    const k = BIG_MAP_SIDE / (box?.width || BIG_MAP_SIDE);
    return { x: (event.clientX - (box?.left ?? 0)) * k, y: (event.clientY - (box?.top ?? 0)) * k };
  }

  private readonly onDown = (event: PointerEvent): void => {
    const p = this.pixel(event);
    this.drag = { x: p.x, y: p.y, panX: this.panX, panZ: this.panZ, moved: false };
  };

  private readonly onMove = (event: PointerEvent): void => {
    const p = this.pixel(event);
    if (this.view) this.showWhere(this.canvas.blockAt(this.view, p.x, p.y));
    const drag = this.drag;
    if (!drag) return;
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    drag.moved = true;
    // Dragging the land: the centre moves the other way, a block `zoom` pixels.
    this.panX = drag.panX - Math.round(dx / this.canvas.zoom);
    this.panZ = drag.panZ - Math.round(dy / this.canvas.zoom);
    this.stale = true;
  };

  /** The wheel zooms about the pointer: up (away) in, down out. */
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.deltaY === 0) return;
    const p = this.pixel(event);
    this.zoomBy(event.deltaY < 0 ? 1 : -1, p.x, p.y);
  };

  private readonly onUp = (event: PointerEvent): void => {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.moved || !this.view) return;
    // A click: the place is picked for the next waypoint.
    const p = this.pixel(event);
    this.picked = this.canvas.blockAt(this.view, p.x, p.y);
    this.actions.click();
    this.showWhere();
  };
}

/** Blocks from the player to a waypoint (rounded). */
function distance(view: MapView, w: MapWaypoint): number {
  return Math.round(Math.hypot(w.x + 0.5 - view.player.x, w.z + 0.5 - view.player.z));
}

/** A waypoint's symbol on a small canvas (no context, as in tests: an empty canvas). */
function iconCanvas(icon: WaypointIcon, colour: string): HTMLElement {
  const canvas = h('canvas', {
    class: 'map-icon',
    attrs: { width: String(PICKER_ICON), height: String(PICKER_ICON) },
  }) as HTMLCanvasElement;
  const g = canvas.getContext?.('2d');
  if (g) drawWaypointIcon(g, icon, colour, PICKER_ICON / 2, PICKER_ICON / 2, PICKER_ICON - 4);
  return canvas;
}
