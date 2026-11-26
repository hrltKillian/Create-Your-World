import { ticksOf } from './clock.ts';
import { hurtCreature } from './combat.ts';
import { isGone } from './creatures.ts';
import type { SimEvent } from './events.ts';
import { lightFire } from './fire.ts';
import type { Simulation } from './Simulation.ts';
import { hurt } from './survival.ts';

/**
 * A lightning strike (plan v5 « M47 », the reference game's): it hits the top of a column (the
 * cell above its highest block), hurts the players and creatures within `lightningRadius` blocks
 * of it, sets the players on fire, and lights a fire there (fire.ts: where it holds). The client
 * draws the bolt, flashes the sky and rolls the thunder from the `lightning` event. False when the
 * column is not loaded.
 */
export function strike(sim: Simulation, x: number, z: number, out: SimEvent[]): boolean {
  const y = sim.world.heightAt(x, z);
  if (y < 0) return false;
  const b = sim.registry.pack.balance;
  const w = b.weather;
  out.push({ type: 'lightning', x, y, z });
  const cx = x + 0.5;
  const cz = z + 0.5;
  const reach = w.lightningRadius * w.lightningRadius;
  for (const e of sim.entities.values()) {
    const body = e.body;
    const dx = body.x - cx;
    const dy = body.y - y;
    const dz = body.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > reach) continue;
    if (e.kind === 'player') {
      hurt(e.survival, w.lightningDamage, 'lightning');
      e.survival.burnTicks = Math.max(e.survival.burnTicks, ticksOf(b.fire.maxSeconds));
    } else if (e.kind === 'creature' && !isGone(e)) {
      hurtCreature(sim, e, w.lightningDamage, cx, cz, 0, -1, out);
    }
  }
  lightFire(sim, x, y, z, 0, out);
  return true;
}
