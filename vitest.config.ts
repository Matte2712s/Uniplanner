import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'shared/test/**/*.test.ts'],
    environment: 'node',
    // Vite/Vitest set process.env.BASE_URL to "/" (its own client base-path
    // convention), which collides with this app's own BASE_URL env var
    // (an absolute origin) and breaks anything importing server/src/env.ts.
    // ADMIN_EMAILS is fixed here too, since server/src/env.ts reads it once
    // at import time - routes.admin.test.ts relies on this exact value.
    env: { BASE_URL: 'http://localhost:5173', ADMIN_EMAILS: 'admin@example.com' },
  },
});
