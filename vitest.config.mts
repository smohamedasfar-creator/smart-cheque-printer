import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { include: ['src/shared/**', 'src/main/store.ts'], exclude: ['src/shared/types.ts'], reporter: ['text'] },
  },
});
