import { lookVector, type Vec3 } from '../core/angles.ts';
import { reject, validInventoryCommand } from './commandRules.ts';
import type { InventoryCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { addItem, type ItemStack, moveItems, quickMove, takeFromSlot } from './inventory.ts';
import { DROPS, spawnDrop } from './itemDrops.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/** Applies an inventory command of a player (refusing what changes nothing). */
export function applyInventoryCommand(
  sim: Simulation,
  player: PlayerState,
  command: InventoryCommand,
  out: SimEvent[],
): void {
  if (!validInventoryCommand(command)) {
    reject(out, player.playerId, command.type, 'invalid');
    return;
  }
  const inventory = player.inventory;
  let changed: boolean;
  switch (command.type) {
    case 'inv.move':
      changed = moveItems(inventory, sim.registry, command.from, command.to, command.count);
      break;
    case 'inv.quickMove':
      changed = quickMove(inventory, sim.registry, command.slot);
      break;
    case 'inv.drop': {
      const stack = inventory[command.slot];
      const taken = stack
        ? takeFromSlot(inventory, command.slot, command.all ? stack.count : 1)
        : null;
      if (taken) throwStack(sim, player, taken);
      changed = taken !== null;
      break;
    }
  }
  if (changed) out.push({ type: 'inventoryChanged', playerId: player.playerId });
  else reject(out, player.playerId, command.type, 'nothing to move');
}

/** Adds items to a player's inventory; what does not fit drops at the player's feet. */
export function giveItems(
  sim: Simulation,
  player: PlayerState,
  stack: ItemStack,
  out: SimEvent[],
): void {
  const left = addItem(player.inventory, sim.registry, stack);
  if (left < stack.count) out.push({ type: 'inventoryChanged', playerId: player.playerId });
  if (left > 0) {
    const b = player.body;
    spawnDrop(sim, { ...stack, count: left }, b.x, b.y, b.z);
  }
}

const look: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Throws items forward from just below the eye: nobody can pick them up for 0.6 s, and the thrower
 * not before the drop has once been out of their reach (itemDrops.ts).
 */
function throwStack(sim: Simulation, player: PlayerState, stack: ItemStack): void {
  const b = player.body;
  lookVector(player.yaw, player.pitch, look);
  const speed = DROPS.throwSpeed;
  const drop = spawnDrop(
    sim,
    stack,
    b.x,
    b.y + eyeHeight(b) - 0.3,
    b.z,
    look.x * speed,
    look.y * speed + 1,
    look.z * speed,
    DROPS.thrownPickupDelayTicks,
  );
  drop.thrower = player.id;
}
