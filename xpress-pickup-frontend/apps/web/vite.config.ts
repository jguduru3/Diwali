import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Two installable apps share one service worker (src/sw.ts: precache, offline
      // API cache, web push). Their manifests are static files in public/; the page
      // picks one per path (public/app-shell.js), so the plugin writes none.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['icons/*-512.png', 'icons/*-maskable-*.png'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Local API (the backend's `pnpm dev`); override with API_PROXY_TARGET.
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:7071',
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // full-page renders can pass 5 s when every package's tests run at once
    testTimeout: 15_000,
  },
});
