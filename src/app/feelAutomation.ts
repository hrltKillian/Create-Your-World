import type { App } from './App.ts';

/**
 * The view's feel (M11) as automation reads it, shared by the debug hook and the selftests: the
 * camera rig's sprint field of view, bob, landing dip and hurt roll, the hand view's inertia and
 * the particles; with the two switches the Settings screen drives (particles, view bob).
 */

export interface FeelView {
  /** The world camera's vertical field of view now (degrees): the setting plus `fovOffset`. */
  readonly fov: number;
  /** Degrees the sprint adds (eased towards +8 while sprinting in first person). */
  readonly fovOffset: number;
  /** The camera's height over the eye (m; negative below): the view bob and the landing dip. */
  readonly bob: number;
  /** The camera's roll (radians; positive leans left): a blow taken. */
  readonly roll: number;
  readonly viewBob: boolean;
  /** Where inertia has left the first-person hand from its pose (view-space metres). */
  readonly sway: { readonly x: number; readonly y: number; readonly z: number };
  /** Particles alive, and whether particles are on. */
  readonly particles: number;
  readonly particlesOn: boolean;
}

export function feelView(app: App): FeelView | null {
  const session = app.session;
  const camera = app.view?.camera;
  if (!session || !camera) return null;
  const { rig, play } = session;
  const hand = play.hand;
  return {
    fov: camera.fov,
    fovOffset: rig.fovOffset,
    bob: rig.pose.y - rig.eye.y,
    roll: rig.pose.roll ?? 0,
    viewBob: rig.viewBob,
    sway: { x: hand.swayX, y: hand.swayY, z: hand.swayZ },
    particles: play.particles.alive(),
    particlesOn: play.particles.enabled,
  };
}

/** Turns particles on or off for the open world (off clears the live ones). */
export function setParticles(app: App, on: boolean): void {
  app.session?.play.particles.setEnabled(on);
}

/** Turns the view bob on or off for the open world. */
export function setViewBob(app: App, on: boolean): void {
  const rig = app.session?.rig;
  if (rig) rig.viewBob = on;
}
