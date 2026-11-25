import type { DebugStat } from '../../sim/commands.ts';
import { serializeInventory } from '../../sim/inventory.ts';
import type { Skill } from '../../sim/progression.ts';
import type { DeathCause } from '../../sim/survival.ts';
import { BOT_KINDS, type BotKind } from '../../sim/testing/bots.ts';
import type { App } from '../App.ts';
import {
  blockEntityContents,
  craft,
  craftQueue,
  give,
  sendAndStep,
  teleport,
} from '../automation.ts';
import { driveBot } from '../botDriver.ts';
import {
  census,
  creatureList,
  killCreature,
  placeCreature,
  spawnLog,
} from '../creatureAutomation.ts';
import { progressOf } from '../progressModel.ts';
import { equip, god, kill, playerStats, setStat } from '../survivalAutomation.ts';
import { walkQuestsHere } from '../walkAutomation.ts';

/** `__game.player`: the local player's body, gauges, inventory and debug commands. */
export function playerHook(app: App) {
  return {
    get: () => {
      const p = app.session?.player;
      if (!p) return null;
      const b = p.body;
      return {
        x: b.x,
        y: b.y,
        z: b.z,
        vx: b.vx,
        vy: b.vy,
        vz: b.vz,
        onGround: b.onGround,
        inWater: b.inWater,
        crouching: b.crouching,
        stamina: p.stamina,
        exhausted: p.exhausted,
        yaw: p.yaw,
        pitch: p.pitch,
      };
    },
    teleport: (x: number, y: number | 'surface', z: number) => teleport(app, x, y, z),
    /** Sets a gauge now, clamped: health, hunger, thirst, stamina, temperature, toxicity, breath. */
    setStat: (stat: DebugStat, value: number) => setStat(app, stat, value),
    /** Gauges, exhaustion, felt °C, death, bedroll, packs, quests, worn items. */
    stats: () => playerStats(app),
    /** Takes all health for a cause (the death screen shows `death.cause.<cause>`). */
    kill: (cause: DeathCause = 'fall') => kill(app, cause),
    /** No damage while on (the gauges still move); kept across a respawn and saved. */
    god: (on = true) => god(app, on),
    /** Shift+click of a slot in the Bag: puts a wearable on, takes a worn one (32–36) off. */
    equip: (slot: number) => equip(app, slot),
    /** A copy of the 32 slots (0–7 hotbar, 8–31 bag): null or { item, count, durability? }. */
    inventory: () => {
      const p = app.session?.player;
      return p ? serializeInventory(p.inventory) : null;
    },
    /** Adds items by key (e.g. a flint tool); what does not fit drops at the player's feet. */
    give: (item: string, count = 1) => give(app, item, count),
  };
}

/** `__game.entities`: placing, listing and killing creatures. */
export function entitiesHook(app: App) {
  return {
    /** Places a creature (key; feet, or 'surface'), facing the player, now; its id or null. */
    spawn: (creature: string, x: number, y: number | 'surface', z: number) =>
      placeCreature(app, creature, x, y, z),
    /** Every creature: id, key, feet, yaw, health, mode, target, sees, watched, herd, cave. */
    list: () => creatureList(app),
    /** Kills a creature now (its loot drops; removed after its fall); false: none living. */
    kill: (id: number) => killCreature(app, id),
    /** Living creatures: total, hostiles on the surface and in caves, per creature key. */
    census: () => census(app),
    /** The last hostile spawns: tick, creature, feet, effective light, cave. */
    spawnLog: () => spawnLog(app),
  };
}

/** `__game.craft` and `__game.container`: the craft queue and block entities. */
export function craftHooks(app: App) {
  return {
    craft: {
      /**
       * Queues `count` crafts of a recipe (its key) like the Logbook's buttons; checked by the sim
       * (a workbench recipe needs its workbench open: `ui.open(x, y, z)`).
       */
      enqueue: (recipe: string, count = 1) => craft(app, recipe, count),
      /** The craft queue: { recipe, count, progress 0–1 } per entry, the craft under way first. */
      queue: () => craftQueue(app),
    },
    container: {
      /**
       * A cell's chest, station or workbench: { kind, slots } (a station adds station, flame,
       * progress, process; a workbench station and its queue).
       */
      contents: (x: number, y: number, z: number) => blockEntityContents(app, x, y, z),
    },
  };
}

/** `__game.quests`: quests, tasks and skills, their commands and the scripted walk (M11, M21, M22). */
export function questsHook(app: App) {
  return {
    /** The quests unlocked, by key: `{ progress, done, claimed }`, and the one pinned. */
    list: () => {
      const player = app.session?.player;
      return player ? { quests: structuredClone(player.quests), pinned: player.pinned } : null;
    },
    /** Claims a quest done (its rewards), applied at once in fixed steps. */
    claim: (quest: string) => sendAndStep(app, { type: 'quest.claim', quest }),
    /** Pins a quest to the compass (null unpins), applied at once in fixed steps. */
    pin: (quest: string | null) => sendAndStep(app, { type: 'quest.pin', quest }),
    /**
     * Does every quest in the pack's order from where the player stands (a player who has done
     * none, the generated world, ?fixedStep=1; biomes searched within `maxRadius`); the keys done.
     */
    walk: (maxRadius = 3000) => walkQuestsHere(app, maxRadius),
    /** The tasks held (`{ key, progress }`); claims one done, or redraws one (once a day). */
    tasks: () => structuredClone(app.session?.player.tasks ?? []),
    claimTask: (index: number) => sendAndStep(app, { type: 'task.claim', index }),
    rerollTask: (index: number) => sendAndStep(app, { type: 'task.reroll', index }),
    /** Level, XP into it and to the next one, points left and skills (plan v3 « M22 »). */
    progress: () => {
      const session = app.session;
      return session ? progressOf(session.player, session.host.view.registry.pack.balance) : null;
    },
    /** Spends a skill point, applied at once in fixed steps. */
    spend: (skill: Skill) => sendAndStep(app, { type: 'skill.spend', skill }),
  };
}

/** `__game.bot`: a bot of sim/testing playing the player in the browser (M11). */
export function botHook(app: App) {
  return {
    kinds: () => [...BOT_KINDS],
    /**
     * Plays `seconds` of game time (fixed steps: 8 ticks a frame; else real time), the camera
     * following; what it did and the errors captured meanwhile.
     */
    run: (kind: BotKind = 'wanderMineBuild', seconds = 300) => driveBot(app, kind, seconds),
  };
}
