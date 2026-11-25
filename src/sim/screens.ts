import { cellKey } from '../world/coords.ts';
import { type BlockEntity, OPEN_REACH, withinReach } from './blockEntities.ts';
import { reject, validScreenCommand } from './commandRules.ts';
import type { ScreenCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { giveItems } from './inventoryCommands.ts';
import type { PlayerScreen, PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/*
 * The slot screens on the simulation side (docs « Écrans »): which one a player has open (the
 * Bag, or a chest's or station's: PlayerState.screen, one at most) and the cursor stack that lives
 * while it is open. Whatever closes a screen (its command, opening another, walking away from a
 * chest, a death) puts the cursor stack back in the inventory, what does not fit at the feet; a
 * death takes it into the Abandoned Pack first (death.ts). The clicks are in slotClicks.ts.
 */

/** The Bag's screen (shared: a screen is plain data the simulation never changes). */
const BAG: PlayerScreen = { kind: 'bag' };

export function applyScreenCommand(
  sim: Simulation,
  player: PlayerState,
  command: ScreenCommand,
  out: SimEvent[],
): void {
  const playerId = player.playerId;
  if (!validScreenCommand(command)) reject(out, playerId, command.type, 'invalid');
  else if (command.type === 'screen.close') {
    if (player.screen) closeScreen(sim, player, out);
    else reject(out, playerId, command.type, 'nothing open');
  } else if (player.survival.dead) reject(out, playerId, command.type, 'dead');
  else if (player.screen?.kind === 'bag') reject(out, playerId, command.type, 'already open');
  else {
    if (player.screen) closeScreen(sim, player, out);
    player.screen = BAG;
  }
}

/**
 * Closes the open screen: the cursor stack goes back to the inventory (at the feet when it is
 * full); a chest's or station's says so (`blockEntityClosed`).
 */
export function closeScreen(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const screen = player.screen;
  if (!screen) return;
  stowCursor(sim, player, out);
  player.screen = null;
  if (screen.kind === 'block') out.push({ type: 'blockEntityClosed', playerId: player.playerId });
}

/** Puts the cursor stack back in the inventory; what does not fit drops at the player's feet. */
export function stowCursor(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const cursor = player.cursor;
  if (!cursor) return;
  player.cursor = null;
  giveItems(sim, player, cursor, out);
}

/** The block entity of the chest or station screen a player has open, if it is still there. */
export function openedEntity(sim: Simulation, player: PlayerState): BlockEntity | undefined {
  const screen = player.screen;
  return screen?.kind === 'block'
    ? sim.blockEntities.get(cellKey(screen.x, screen.y, screen.z))
    : undefined;
}

/** Tick step 9: closes the screen of a player who walked away or whose block entity is gone. */
export function checkOpened(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const screen = player.screen;
  if (screen?.kind !== 'block') return;
  if (!openedEntity(sim, player) || !withinReach(player, screen.x, screen.y, screen.z, OPEN_REACH))
    closeScreen(sim, player, out);
}
