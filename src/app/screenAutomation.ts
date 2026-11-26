/**
 * Clicks on the screens as the mouse does (the debug hook and the selftests): their buttons, their
 * slots (a press, a right press, Shift) and beside their panel.
 */

/** Clicks the first element a selector matches; returns false when none does or it is disabled. */
export function click(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element || (element instanceof HTMLButtonElement && element.disabled)) return false;
  element.click();
  return true;
}

/** The middle of an element in the viewport (scrolled into view first). */
function middleOf(element: Element): { clientX: number; clientY: number } {
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const box = element.getBoundingClientRect();
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
}

/** The open slot screen (Bag, Container, Station, Workbench), if one shows. */
function slotScreen(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.screen-slots:not([hidden])');
}

/** The view of a slot on the open slot screen, if it shows (not on a hidden page of the Bag). */
function slotView(slot: number): Element | null {
  const view = slotScreen()?.querySelector(`[data-slot="${slot}"]`);
  return view && view.getClientRects().length > 0 ? view : null;
}

/** A mouse button (0 left, 1 right) pressed on an element at a point, as the mouse does. */
function pressOn(
  target: Element,
  button: 0 | 1,
  shift: boolean,
  at: { clientX: number; clientY: number },
): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: button === 1 ? 2 : 0,
      buttons: button === 1 ? 2 : 1,
      shiftKey: shift,
      ...at,
    }),
  );
}

/**
 * Clicks a slot of the open slot screen as the mouse does: a left (0) or right (1) button press on
 * its view, with Shift or not; the screen sends the simulation's `slot.click`. Slots are numbered
 * as in `[data-slot]` (the inventory from 0; the open chest, station or workbench, or the Bag's
 * worn items, from 64). Returns false when the slot does not show.
 */
export function clickSlot(slot: number, button: 0 | 1 = 0, shift = false): boolean {
  const view = slotView(slot);
  if (!view) return false;
  pressOn(view, button, shift, middleOf(view));
  return true;
}

/**
 * Clicks beside the open slot screen's panel, on its backdrop (its top left corner), as the mouse
 * does: the screen sends `slot.click` on slot −1, which throws the cursor stack (left, 0) or one of
 * its items (right, 1). Returns false when no slot screen is open.
 */
export function clickOutside(button: 0 | 1 = 0): boolean {
  const screen = slotScreen();
  if (!screen) return false;
  const box = screen.getBoundingClientRect();
  pressOn(screen, button, false, { clientX: box.left + 1, clientY: box.top + 1 });
  return true;
}

/**
 * Moves the stack of one slot to an empty one as the mouse does: a left click on each (taken onto
 * the cursor, put down). Returns false, clicking nothing, when either slot does not show.
 */
export function moveSlot(from: number, to: number): boolean {
  if (!slotView(from) || !slotView(to)) return false;
  return clickSlot(from) && clickSlot(to);
}
