import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

// Im DDEV-Container gesetzt, z.B. https://v29-stamm-tracker.ddev.site / v29-stamm-tracker.ddev.site
const { DDEV_PRIMARY_URL, DDEV_HOSTNAME } = process.env

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'V29 Stammbuch',
        short_name: 'Stammbuch',
        lang: 'de',
        theme_color: '#3b2a1a',
        background_color: '#ffffff',
        display: 'standalone',
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
    hmr: DDEV_HOSTNAME ? { host: DDEV_HOSTNAME.split(',')[0], protocol: 'wss', clientPort: 5173 } : undefined,
    // Symfony läuft im selben Container auf Port 80 → gleiche Origin, kein CORS
    proxy: { '/api': 'http://localhost' },
  },
})
