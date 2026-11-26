import { h } from './h.ts';
import { drawWaypointIcon, MAP_CELLS, type MapView, WAYPOINT_PALETTE } from './map.ts';

/** RGB of the land not explored yet. */
export const UNEXPLORED = 0x141210;

/** How the canvas draws its waypoints: their size, their names, kept on the edge when away. */
export interface MapStyle {
  /** Pixels high of a waypoint's symbol. */
  readonly iconSize: number;
  /** Their names beside them (the big map). */
  readonly labels: boolean;
  /** A waypoint beyond the canvas shows on its edge (the minimap). */
  readonly clampToEdge: boolean;
}

/**
 * A map on a canvas of `side` × `side` pixels, `zoom` a block (1, or more on the big map), north
 * up, centred on the view's centre (plan v3 « M27 », detailed at « M31 »): the explored land, the
 * rest dark, the waypoints with their symbol and colour (and names), the player as an arrow along
 * their facing.
 */
export class MapCanvas {
  readonly element: HTMLCanvasElement;
  /** Pixels a block side (a whole number). */
  zoom = 1;
  private readonly side: number;
  private readonly style: MapStyle;
  private image: ImageData | null = null;

  constructor(side: number, className: string, style: MapStyle) {
    this.side = side;
    this.style = style;
    this.element = h('canvas', {
      class: className,
      attrs: { width: String(side), height: String(side) },
    }) as HTMLCanvasElement;
  }

  /** The block under a canvas pixel (its column x, z) for a view. */
  blockAt(view: MapView, px: number, py: number): { x: number; z: number } {
    const half = this.side / 2;
    return {
      x: Math.floor(view.centreX + (px - half) / this.zoom),
      z: Math.floor(view.centreZ + (py - half) / this.zoom),
    };
  }

  /** Draws the view (no canvas context: nothing, as in tests). */
  draw(view: MapView): void {
    const g = this.element.getContext?.('2d');
    if (!g) return;
    const side = this.side;
    this.image ??= g.createImageData(side, side);
    const data = this.image.data;
    for (let p = 0; p < data.length; p += 4) setPixel(data, p, UNEXPLORED);
    const k = this.zoom;
    // The block at the canvas's top-left corner (fractional when zoomed in).
    const left = view.centreX - side / 2 / k;
    const top = view.centreZ - side / 2 / k;
    for (const column of view.columns) {
      // The column's top-left corner, in pixels.
      const x0 = Math.round((column.cx * MAP_CELLS - left) * k);
      const z0 = Math.round((column.cz * MAP_CELLS - top) * k);
      const span = MAP_CELLS * k;
      if (x0 >= side || z0 >= side || x0 + span <= 0 || z0 + span <= 0) continue;
      for (let py = Math.max(0, z0); py < Math.min(side, z0 + span); py++) {
        const row = py * side;
        const j = Math.floor((py - z0) / k) * MAP_CELLS;
        for (let px = Math.max(0, x0); px < Math.min(side, x0 + span); px++)
          setPixel(data, (row + px) * 4, column.colours[j + Math.floor((px - x0) / k)]!);
      }
    }
    g.putImageData(this.image, 0, 0);
    const style = this.style;
    const edge = (v: number) =>
      Math.min(side - style.iconSize / 2, Math.max(style.iconSize / 2, v));
    g.font = '600 11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const w of view.waypoints) {
      let x = (w.x + 0.5 - left) * k;
      let y = (w.z + 0.5 - top) * k;
      const inside = x >= 0 && y >= 0 && x < side && y < side;
      if (!inside && !style.clampToEdge) continue;
      x = edge(x);
      y = edge(y);
      const colour = WAYPOINT_PALETTE[w.colour] ?? WAYPOINT_PALETTE[0];
      drawWaypointIcon(g, w.icon, colour, x, y, style.iconSize);
      if (style.labels && inside) {
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(10, 10, 10, 0.8)';
        g.strokeText(w.name, x + style.iconSize * 0.7, y);
        g.fillStyle = '#f2efe6';
        g.fillText(w.name, x + style.iconSize * 0.7, y);
      }
    }
    // The player: an arrow along their facing (yaw 0 looks north, −z), kept on the edge.
    g.save();
    g.translate(edge((view.player.x - left) * k), edge((view.player.z - top) * k));
    g.rotate(-view.player.yaw);
    g.fillStyle = '#ffd27a';
    g.strokeStyle = 'rgba(10, 10, 10, 0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}

function setPixel(data: Uint8ClampedArray, p: number, rgb: number): void {
  data[p] = (rgb >> 16) & 255;
  data[p + 1] = (rgb >> 8) & 255;
  data[p + 2] = rgb & 255;
  data[p + 3] = 255;
}
