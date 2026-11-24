import { type Settings, withQuality } from '../platform/settings.ts';
import { QUALITIES, type Quality } from '../render/quality.ts';
import type { App } from './App.ts';

/**
 * Applies a graphics preset now (`render.setQuality`) the way the Settings screen's Quality choice
 * does, through `Game.changeSettings`: its render distance, resolution and particles apply at once
 * and are stored (`?rd=` and `?quality=` still win, as there). Returns the settings in use; null
 * without a game (developer scenes).
 */
export function applyQuality(app: App, quality: Quality): Settings | null {
  if (!QUALITIES.includes(quality))
    throw new Error(`Unknown quality "${quality}" (${QUALITIES.join(', ')})`);
  const game = app.game;
  if (!game) return null;
  game.changeSettings(withQuality(game.settings, quality));
  return game.settings;
}
