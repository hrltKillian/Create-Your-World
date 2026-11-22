/** Replaced at build time by Vite: true in dev, bench and test builds, false in production. */
declare const __DEBUG_HOOK__: boolean;

/** True in the bench build (`npm run bench`): fixed drawing-buffer size for measurements. */
declare const __BENCH__: boolean;

interface Window {
  /** Dev-only automation hook, see src/app/debugHook.ts. */
  __game?: unknown;
}
