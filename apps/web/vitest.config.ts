import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      // Logic lives in lib/, hooks/ and these components. The landing's scroll scenes,
      // route files and the Firebase wiring are covered by the Playwright suite instead.
      include: [
        'src/lib/**/*.ts',
        'src/hooks/**/*.ts',
        'src/components/avatar/**/*.tsx',
        'src/components/app/**/*.tsx',
        'src/components/auth/**/*.tsx',
        'src/components/ui/**/*.tsx',
        'src/components/landing/DownloadSection.tsx',
      ],
      exclude: ['src/lib/firebase.ts', '**/*.test.*', 'src/test/**'],
      thresholds: { lines: 70, statements: 70, functions: 65, branches: 60 },
    },
  },
});
