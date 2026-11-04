import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'
import checker from 'vite-plugin-checker'

// Set inside the DDEV container, e.g. https://v29-stamm-tracker.ddev.site / v29-stamm-tracker.ddev.site
const { DDEV_PRIMARY_URL, DDEV_HOSTNAME } = process.env

// Build identifier on the help page instead of a hand-maintained version number nobody bumps.
// Uncommitted changes share the last commit's hash, hence the "-dirty" marker and the build time.
function gitRevision(): string | null {
  try {
    const run = (command: string) =>
      execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const hash = run('git rev-parse --short HEAD')
    return run('git status --porcelain') ? `${hash}-dirty` : hash
  } catch {
    // No git (or no repository) where the build runs → the build time alone has to do
    return null
  }
}

// https://vite.dev/config/
export default defineConfig(() => ({
  define: {
    __APP_REVISION__: JSON.stringify(gitRevision()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
      // 'prompt' instead of 'autoUpdate': a new version must never reload the app in the middle of a data entry
      // or a sync. The new worker waits; installWhenSafe (composables/useUpdateCheck.ts) installs it in a safe state.
      registerType: 'prompt',
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
    // Symfony runs in the same container on port 80 → same origin, no CORS
    proxy: { '/api': 'http://localhost' },
  },
}))
