import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The rendering and virtual-printer tests take a few seconds; shared CI machines can be twice as slow.
    testTimeout: 30_000,
    coverage: { include: ['src/shared/**', 'src/main/store.ts'], exclude: ['src/shared/types.ts'], reporter: ['text'] },
  },
});
