import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'shared/test/**/*.test.ts'],
    environment: 'node',
    // Vite/Vitest set process.env.BASE_URL to "/" (its own client base-path
    // convention), which collides with this app's own BASE_URL env var
    // (an absolute origin) and breaks anything importing server/src/env.ts.
    env: { BASE_URL: 'http://localhost:5173' },
  },
});
