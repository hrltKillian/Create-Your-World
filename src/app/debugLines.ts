import { fmtBytes, fmtNumber } from '../i18n/fmt.ts';
import { t } from '../i18n/i18n.ts';
import type { DebugLine } from '../ui/debug/DebugOverlay.ts';
import { columnIndex, toColumn, toLocal } from '../world/coords.ts';
import type { App } from './App.ts';

/**
 * Lines of the debug overlay: frame and render statistics and the camera, then (in a generated
 * world) seed, biome and streaming. Null while no scene is shown.
 */
export function debugLines(app: App): DebugLine[] | null {
  const { view, world, renderer } = app;
  const pose = app.freecam?.pose ?? app.session?.rig.pose;
  if (!view || !pose || !world || !renderer) return null;
  const info = renderer.webgl.info;
  const snap = app.frames.snapshot();
  const chunks = view.chunks.stats();
  const yawDeg = ((((-pose.yaw * 180) / Math.PI) % 360) + 360) % 360;
  return [
    { label: 'debug.fps', value: fmtNumber(snap.fps) },
    { label: 'debug.frame', value: `${fmtNumber(snap.workP95, 2)} ms` },
    { label: 'debug.draws', value: fmtNumber(info.render.calls) },
    { label: 'debug.triangles', value: fmtNumber(info.render.triangles) },
    { label: 'debug.sections', value: fmtNumber(chunks.sections) },
    { label: 'debug.quads', value: fmtNumber(chunks.quads) },
    { label: 'debug.geometry', value: fmtBytes(chunks.geometryBytes) },
    { label: 'debug.voxels', value: fmtBytes(world.voxelBytes()) },
    {
      label: 'debug.position',
      value: `${fmtNumber(pose.x, 1)} ${fmtNumber(pose.y, 1)} ${fmtNumber(pose.z, 1)}`,
    },
    { label: 'debug.facing', value: `${fmtNumber(yawDeg)}°` },
    { label: 'debug.view', value: app.debugView },
    ...worldLines(app, pose.x, pose.z),
  ];
}

function worldLines(app: App, x: number, z: number): DebugLine[] {
  const { session, world } = app;
  if (!session || !world) return [];
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const column = world.getColumn(toColumn(bx), toColumn(bz));
  const biome = column
    ? session.host.view.gen.biomes[column.biomes[columnIndex(toLocal(bx), toLocal(bz))]!]
    : undefined;
  const mesh = session.scheduler.stats();
  const pool = app.workers?.stats();
  return [
    { label: 'debug.seed', value: session.seed },
    { label: 'debug.biome', value: biome ? t(biome.def.nameKey) : '—' },
    { label: 'debug.columns', value: fmtNumber(world.columns.size) },
    { label: 'debug.meshQueue', value: `${mesh.pending} / ${mesh.inFlight}` },
    {
      label: 'debug.workerTimes',
      value: pool ? `${fmtNumber(pool.meanMs.gen, 1)} / ${fmtNumber(pool.meanMs.mesh, 1)} ms` : '—',
    },
  ];
}
