import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts', 'infra/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/cdk.out/**'],
  },
});
