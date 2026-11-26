import { h } from './h.ts';
import { MAP_CELLS, type MapView } from './map.ts';

/** RGB of a column not explored yet. */
export const UNEXPLORED = 0x141210;

/**
 * A map drawn on a canvas of `side` × `side` cells, north up, centred on the player (an arrow
 * along their facing): the explored columns, the rest dark, the waypoints as diamonds (kept on
 * the edge when farther). The HUD's minimap and the big map (M) draw with it.
 */
export class MapCanvas {
  readonly element: HTMLCanvasElement;
  private readonly side: number;
  private image: ImageData | null = null;

  constructor(side: number, className: string) {
    this.side = side;
    this.element = h('canvas', {
      class: className,
      attrs: { width: String(side), height: String(side) },
    }) as HTMLCanvasElement;
  }

  /** Draws the view (no canvas context: nothing, as in tests). */
  draw(view: MapView): void {
    const g = this.element.getContext?.('2d');
    if (!g) return;
    const side = this.side;
    this.image ??= g.createImageData(side, side);
    const data = this.image.data;
    for (let p = 0; p < data.length; p += 4) setPixel(data, p, UNEXPLORED);
    const half = side / 2;
    // A point in column units from the player's column → its canvas cell.
    const at = (v: number, of: number) => (v - of) * MAP_CELLS + half;
    for (const column of view.columns) {
      const x0 = Math.round(at(column.dx, view.player.x));
      const z0 = Math.round(at(column.dz, view.player.z));
      for (let j = 0; j < MAP_CELLS; j++) {
        const z = z0 + j;
        if (z < 0 || z >= side) continue;
        for (let i = 0; i < MAP_CELLS; i++) {
          const x = x0 + i;
          if (x >= 0 && x < side)
            setPixel(data, (z * side + x) * 4, column.colours[i + j * MAP_CELLS]!);
        }
      }
    }
    g.putImageData(this.image, 0, 0);
    const edge = (v: number) => Math.min(side - 3, Math.max(3, v));
    g.fillStyle = '#7fd0e0';
    for (const w of view.waypoints) {
      g.save();
      g.translate(edge(at(w.x, view.player.x)), edge(at(w.z, view.player.z)));
      g.rotate(Math.PI / 4);
      g.fillRect(-2.5, -2.5, 5, 5);
      g.restore();
    }
    // The player: an arrow along their facing (yaw 0 looks north, −z).
    g.save();
    g.translate(half, half);
    g.rotate(-view.player.yaw);
    g.fillStyle = '#ffd27a';
    g.beginPath();
    g.moveTo(0, -5);
    g.lineTo(3.5, 4);
    g.lineTo(-3.5, 4);
    g.closePath();
    g.fill();
    g.restore();
  }
}

function setPixel(data: Uint8ClampedArray, p: number, rgb: number): void {
  data[p] = (rgb >> 16) & 255;
  data[p + 1] = (rgb >> 8) & 255;
  data[p + 2] = rgb & 255;
  data[p + 3] = 255;
}
