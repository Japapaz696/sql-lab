import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '*.config.*', '.env', '.env.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', jsx: true },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
      'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
    },
  },
];
