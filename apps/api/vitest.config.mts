import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC instead of esbuild: Nest's DI needs emitDecoratorMetadata.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    setupFiles: ['src/testing/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.spec.{ts,tsx}',
        'src/testing/**',
        'src/main.ts',
        'src/worker.ts',
        'src/migrate.ts',
        'src/bootstrap.ts',
        'src/**/*.module.ts',
        'src/db/schema.ts',
      ],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
      reporter: ['text-summary', 'text', 'lcov'],
    },
  },
});
