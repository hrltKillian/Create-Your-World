import { COMPASS_POINTS, type CompassPoint } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

const TURN = Math.PI * 2;

/** Half the strip, either side of the heading (radians). */
export const COMPASS_HALF_SPAN = Math.PI / 2;

/** Bearing of each compass point: radians clockwise from north (−z), east being +x. */
export const POINT_BEARINGS: Readonly<Record<CompassPoint, number>> = {
  north: 0,
  east: Math.PI / 2,
  south: Math.PI,
  west: (3 * Math.PI) / 2,
};

/** Wraps an angle into [0, 2π). */
function wrap(angle: number): number {
  const a = angle % TURN;
  return a < 0 ? a + TURN : a;
}

/** Bearing of a direction on the ground (dx east, dz south): radians clockwise from north. */
export function bearingOf(dx: number, dz: number): number {
  return wrap(Math.atan2(dx, -dz));
}

/** The heading of a view yaw (0 looks north, a positive yaw turns towards the west). */
export function headingOf(yaw: number): number {
  return wrap(-yaw);
}

/**
 * Where a bearing shows on the strip seen from a heading: −1 at the left edge, 0 in the middle,
 * 1 at the right edge; NaN when it is behind, beyond `halfSpan`.
 */
export function compassOffset(bearing: number, heading: number, halfSpan: number): number {
  let d = wrap(bearing - heading);
  if (d > Math.PI) d -= TURN;
  return Math.abs(d) <= halfSpan ? d / halfSpan : Number.NaN;
}

/** A mark on the strip, moved through CSS variables only (`--x` position, `--o` opacity). */
class Mark {
  readonly element: HTMLElement;
  private shown = Number.NaN;

  constructor(className: string, label?: string) {
    this.element = h('span', { class: `compass-mark ${className}` }, label);
    this.element.style.setProperty('--o', '0');
  }

  /** Shows the mark at a bearing (NaN hides it) for a heading. */
  place(bearing: number, heading: number): void {
    const x = compassOffset(bearing, heading, COMPASS_HALF_SPAN);
    const rounded = Math.round(x * 500) / 500;
    if (rounded === this.shown || (Number.isNaN(rounded) && Number.isNaN(this.shown))) return;
    this.shown = rounded;
    const style = this.element.style;
    if (Number.isNaN(rounded)) {
      style.setProperty('--o', '0');
      return;
    }
    style.setProperty('--x', String(rounded));
    // Fades out towards the ends of the strip.
    style.setProperty('--o', String(Math.min(1, (1 - Math.abs(rounded)) * 4)));
  }
}

/** What the compass points at besides the cardinal points (bearings; NaN: nothing to show). */
export interface CompassTargets {
  /** The sun and the moon while above the horizon. */
  readonly sun: number;
  readonly moon: number;
  /** The direction the current objective sends the player. */
  readonly objective: number;
  /** The player's Abandoned Packs. */
  readonly graves: readonly number[];
}

/**
 * The compass strip at the top centre (docs « Interface »): N/E/S/W and the points between, the
 * sun or moon, the current objective's direction and a marker for each Abandoned Pack. Marks only
 * move through CSS variables; `update` may run every frame.
 */
export class Compass {
  readonly element: HTMLElement;
  private readonly fixed: { readonly mark: Mark; readonly bearing: number }[] = [];
  private readonly sun = new Mark('compass-sun');
  private readonly moon = new Mark('compass-moon');
  private readonly objective = new Mark('compass-objective');
  private readonly graves: Mark[] = [];
  private readonly strip: HTMLElement;

  constructor() {
    for (const point of COMPASS_POINTS) {
      const bearing = POINT_BEARINGS[point];
      const letter = new Mark('compass-point', t(`compass.${point}`));
      this.fixed.push({ mark: letter, bearing });
      this.fixed.push({ mark: new Mark('compass-tick'), bearing: bearing + Math.PI / 4 });
    }
    this.strip = h(
      'div',
      { class: 'compass-strip' },
      ...this.fixed.map((f) => f.mark.element),
      this.objective.element,
      this.sun.element,
      this.moon.element,
    );
    this.element = h(
      'div',
      { id: 'hud-compass', class: 'hud-compass', attrs: { 'aria-label': t('hud.compass') } },
      this.strip,
    );
  }

  update(heading: number, targets: CompassTargets): void {
    for (const { mark, bearing } of this.fixed) mark.place(bearing, heading);
    this.sun.place(targets.sun, heading);
    this.moon.place(targets.moon, heading);
    this.objective.place(targets.objective, heading);
    const graves = targets.graves;
    while (this.graves.length < graves.length) {
      const mark = new Mark('compass-grave');
      this.graves.push(mark);
      this.strip.append(mark.element);
    }
    for (let i = 0; i < this.graves.length; i++)
      this.graves[i]!.place(i < graves.length ? graves[i]! : Number.NaN, heading);
  }
}
