/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  define: { __DEBUG_HOOK__: JSON.stringify(mode !== 'production') },
  server: { port: 5173, strictPort: true, forwardConsole: true },
  preview: { port: 4173, strictPort: true },
  worker: { format: 'es' },
  optimizeDeps: { include: ['simplex-noise', 'idb'] },
  build: {
    sourcemap: mode !== 'production',
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
  test: {
    environment: 'node',
    fileParallelism: mode !== 'perf',
    testTimeout: mode === 'slow' ? 180_000 : 10_000,
    include:
      mode === 'perf'
        ? ['tests/perf/**/*.perf.ts']
        : mode === 'slow'
          ? ['tests/slow/**/*.slow.ts']
          : ['tests/**/*.test.ts'],
  },
}));
