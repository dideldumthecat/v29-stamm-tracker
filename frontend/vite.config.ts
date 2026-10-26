import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'
import checker from 'vite-plugin-checker'

// Im DDEV-Container gesetzt, z.B. https://v29-stamm-tracker.ddev.site / v29-stamm-tracker.ddev.site
const { DDEV_PRIMARY_URL, DDEV_HOSTNAME } = process.env

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    tailwindcss(),
    vueDevTools(),
    // Type and lint errors while the dev server runs: in the terminal and as browser overlay.
    // Dev only – `npm run build` already type-checks via vue-tsc, lint runs separately.
    // Not under Vitest: the test run doesn't need it, and it would type-check the whole project on every run.
    !process.env.VITEST &&
      checker({
        enableBuild: false,
        vueTsc: { tsconfigPath: 'tsconfig.app.json' },
        eslint: {
          lintCommand: 'eslint "./src/**/*.{ts,vue}"',
          watchPath: './src',
        },
      }),
    VitePWA({
      // 'prompt' instead of 'autoUpdate': a new version must never reload the app in the middle
      // of a data entry. The user confirms the update (UpdatePrompt.vue).
      // `--mode share` (phone testing via `ddev share`) skips the waiting state instead.
      registerType: mode === 'share' ? 'autoUpdate' : 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'V29 Stamm-Tracker',
        short_name: 'Stamm-Tracker',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        // Placeholder icons – replace once the design is settled
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // SPA routing: unknown paths get index.html from the cache – except API and administration,
        // which are served by Symfony on the same origin
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/admin(\/|$)/],
      },
      // Service worker also in the dev server, so offline behaviour can be tested without a build
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: DDEV_HOSTNAME ? DDEV_HOSTNAME.split(',') : [],
    origin: DDEV_PRIMARY_URL ? `${DDEV_PRIMARY_URL}:5173` : undefined,
    hmr: DDEV_HOSTNAME
      ? { host: DDEV_HOSTNAME.split(',')[0], protocol: 'wss', clientPort: 5173 }
      : undefined,
    // Symfony läuft im selben Container auf Port 80 → gleiche Origin, kein CORS
    proxy: { '/api': 'http://localhost' },
  },
}))
