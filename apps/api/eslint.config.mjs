import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    // No consistent-type-imports: Nest DI needs constructor parameter types imported as values.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', 'test/**'],
    languageOptions: { globals: { ...globals.vitest } },
  },
  {
    files: ['src/migrate.ts'],
    rules: { 'no-console': 'off' },
  },
);
