import type { WaypointIcon } from '../core/waypoints.ts';

/*
 * The map's data (plan v3 « M27 », detailed at « M31 »): the explored columns around a centre, a
 * colour for each block (one pixel a block), and the player and the waypoints, all in block
 * coordinates. Drawn by ui/mapCanvas.ts on the HUD's minimap and the big map (M).
 */

/** Blocks a column side (one pixel each). */
export const MAP_CELLS = 32;
/** Canvas sides in blocks (pixels) and the columns read around the centre to fill them. */
export const MINIMAP_SIDE = 128;
export const MINIMAP_RADIUS = 3;
export const BIG_MAP_SIDE = 512;
export const BIG_MAP_RADIUS = 9;

/** The waypoints' colours (`Waypoint.colour` indexes it). */
export const WAYPOINT_PALETTE = [
  '#f0b445',
  '#e65c5c',
  '#5cb4ec',
  '#72d06c',
  '#c784ec',
  '#f2efe6',
] as const;

export interface MapWaypoint {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly icon: WaypointIcon;
  readonly colour: number;
}

export interface MapView {
  /** The block at the view's middle (the player, or where the big map was dragged to). */
  readonly centreX: number;
  readonly centreZ: number;
  readonly columns: readonly {
    readonly cx: number;
    readonly cz: number;
    /** RGB per block, row by row from the north-west corner. */
    readonly colours: Uint32Array;
  }[];
  /** Where the player stands (blocks) and faces. */
  readonly player: { readonly x: number; readonly z: number; readonly yaw: number };
  readonly waypoints: readonly MapWaypoint[];
}

/** The part of a 2D canvas context the waypoint symbols are drawn with. */
type Pen = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'strokeRect'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
>;

/**
 * Draws a waypoint's symbol (`size` pixels high, centred on x, y) in its colour with a dark
 * outline: a flag, a house, a star, a cave mouth, a gem or a warning triangle.
 */
export function drawWaypointIcon(
  g: Pen,
  icon: WaypointIcon,
  colour: string,
  x: number,
  y: number,
  size: number,
): void {
  const s = size / 2;
  g.fillStyle = colour;
  g.strokeStyle = 'rgba(10, 10, 10, 0.85)';
  g.lineWidth = Math.max(1, size / 9);
  g.beginPath();
  if (icon === 'flag') {
    g.moveTo(x - s * 0.6, y + s);
    g.lineTo(x - s * 0.6, y - s);
    g.lineTo(x + s, y - s * 0.55);
    g.lineTo(x - s * 0.6, y - s * 0.1);
  } else if (icon === 'home') {
    g.moveTo(x - s, y);
    g.lineTo(x, y - s);
    g.lineTo(x + s, y);
    g.lineTo(x + s * 0.7, y);
    g.lineTo(x + s * 0.7, y + s);
    g.lineTo(x - s * 0.7, y + s);
    g.lineTo(x - s * 0.7, y);
  } else if (icon === 'star') {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s : s * 0.45;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      if (i === 0) g.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      else g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
  } else if (icon === 'cave') {
    g.moveTo(x - s, y + s);
    g.lineTo(x - s, y);
    g.arc(x, y, s, Math.PI, 0);
    g.lineTo(x + s, y + s);
  } else if (icon === 'gem') {
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.8, y - s * 0.2);
    g.lineTo(x, y + s);
    g.lineTo(x - s * 0.8, y - s * 0.2);
  } else {
    g.moveTo(x, y - s);
    g.lineTo(x + s, y + s * 0.85);
    g.lineTo(x - s, y + s * 0.85);
  }
  g.closePath();
  g.fill();
  g.stroke();
  // The cave's dark mouth, the warning's bar.
  if (icon === 'cave') {
    g.fillStyle = 'rgba(10, 10, 10, 0.85)';
    g.fillRect(x - s * 0.45, y + s * 0.05, s * 0.9, s * 0.95);
  } else if (icon === 'danger') {
    g.fillStyle = 'rgba(10, 10, 10, 0.85)';
    g.fillRect(x - s * 0.1, y - s * 0.35, s * 0.2, s * 0.65);
  }
}
