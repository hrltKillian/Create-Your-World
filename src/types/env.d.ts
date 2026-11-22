/** Replaced at build time by Vite: true in dev, bench and test builds, false in production. */
declare const __DEBUG_HOOK__: boolean;

interface Window {
  /** Dev-only automation hook, see src/app/debugHook.ts. */
  __game?: unknown;
}
