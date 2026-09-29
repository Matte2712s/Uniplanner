import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Register SW from main.tsx instead - an injected inline script would
      // violate the server's CSP (no unsafe-inline for scripts).
      injectRegister: null,
      manifest: {
        name: 'Uniplanner',
        short_name: 'Uniplanner',
        description:
          'A free personal calendar that merges public university timetables into a single view.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f6f8',
        theme_color: '#7a1f2b',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // index.html gets a fresh per-request CSP nonce from the server
        // (server/src/index.ts) that FullCalendar's inline styles need -
        // never precache or SW-cache HTML, only hashed build assets.
        globPatterns: ['**/*.{js,css,svg,png,ico,woff,woff2}'],
        // Plugin defaults this to 'index.html' for SPA offline support,
        // which would serve a stale, nonce-less shell on navigation.
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
