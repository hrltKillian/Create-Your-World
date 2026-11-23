/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  define: {
    __DEBUG_HOOK__: JSON.stringify(mode !== 'production'),
    __BENCH__: JSON.stringify(mode === 'bench'),
  },
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
    // Perf thresholds are for plain Node: Vite's module runner turns every imported binding into a
    // getter call, which slows the meshing and generation hot loops several times over.
    experimental: { viteModuleRunner: mode !== 'perf' },
    testTimeout: mode === 'slow' ? 180_000 : 10_000,
    include:
      mode === 'perf'
        ? ['tests/perf/**/*.perf.ts']
        : mode === 'slow'
          ? ['tests/slow/**/*.slow.ts']
          : ['tests/**/*.test.ts'],
  },
}));
