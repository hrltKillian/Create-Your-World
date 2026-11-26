/*
 * The HUD's layout check (plan v3 « M35 »): every HUD element shown at once, the transient ones
 * (target, hint, quest messages, biome, banner, tip, pickups) with long sample texts, must lie
 * inside the window and overlap no other one. The crosshair's rings (stamina, scan, attack gauge)
 * share its middle on purpose and are checked as the stamina ring; the full-screen washes (damage,
 * fire, sleep) are left out. The page is put back as it was. The hook's `ui.hudLayout()` (the
 * e2e at 1024×768, 1280×720 and 1920×1080) and selftest m35 run it.
 */

/** Long sample texts for the transient elements (by id: the element, or its `.flash-text`). */
const SAMPLES: Readonly<Record<string, string>> = {
  'hud-quest': 'Cold lies to the north: bring back cassiterite',
  'hud-target': 'Copper Ore',
  'hud-hint': 'Tool too weak: copper pickaxe required',
  'hud-quest-news':
    'Quest done: Gather plant fiber, sticks and flint · Unlocked: Make a flint hatchet and torches',
  'hud-biome': 'Shard Highlands',
  'hud-banner': 'You survived the night',
  'hud-tip': 'Hold right click to eat or drink what you hold, or to fill a flask at the water',
};

/** The elements checked against each other. */
export const HUD_LAYOUT_IDS = [
  'hud-compass',
  'hud-quest',
  'hud-clock',
  'hud-target',
  'hud-stamina',
  'hud-vitals',
  'hud-map',
  'hud-pickups',
  'hud-quest-news',
  'hud-biome',
  'hud-banner',
  'hotbar',
  'hud-hint',
  'hud-tip',
] as const;

export interface HudLayout {
  /** Elements reaching out of the window. */
  readonly outside: readonly string[];
  /** Pairs of elements over each other (« a × b »). */
  readonly over: readonly string[];
}

/** What shows of an element: a flash banner's text (the banner spans the width), else itself. */
function shownBox(id: string): DOMRect | null {
  const element = document.getElementById(id);
  if (!element) return null;
  return (element.querySelector('.flash-text') ?? element).getBoundingClientRect();
}

/** Shows every HUD element with its sample text, measures them, and puts the page back. */
export function hudLayout(): HudLayout {
  const undo: (() => void)[] = [];
  for (const [id, text] of Object.entries(SAMPLES)) {
    const element = document.getElementById(id);
    if (!element) continue;
    const holder = element.querySelector<HTMLElement>('.flash-text') ?? element;
    const { hidden } = element;
    const opacity = element.style.opacity;
    const before = [...holder.childNodes];
    undo.push(() => {
      element.hidden = hidden;
      element.style.opacity = opacity;
      holder.replaceChildren(...before);
    });
    element.hidden = false;
    element.style.opacity = '1';
    holder.textContent = text;
  }
  // A second line under the target: the tool it needs.
  document
    .getElementById('hud-target')
    ?.append(document.createElement('br'), 'Copper pickaxe needed');
  const pickups = document.getElementById('hud-pickups');
  const lines = [...(pickups?.childNodes ?? [])];
  for (let i = 0; i < 4; i++)
    pickups?.append(Object.assign(document.createElement('li'), { textContent: '+3 Plant Fiber' }));
  undo.push(() => pickups?.replaceChildren(...lines));
  const rects = HUD_LAYOUT_IDS.map((id) => ({ id, r: shownBox(id) })).filter(
    (e): e is { id: (typeof HUD_LAYOUT_IDS)[number]; r: DOMRect } => e.r !== null && e.r.width > 0,
  );
  const outside = rects
    .filter(({ r }) => r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)
    .map(({ id }) => id);
  const over: string[] = [];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!.r;
      const b = rects[j]!.r;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
        over.push(`${rects[i]!.id} × ${rects[j]!.id}`);
    }
  for (const step of undo.reverse()) step();
  return { outside, over };
}
