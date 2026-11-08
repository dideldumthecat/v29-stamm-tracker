import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Set inside the DDEV container, e.g. https://v29-stamm-tracker.ddev.site / v29-stamm-tracker.ddev.site
const { DDEV_PRIMARY_URL, DDEV_HOSTNAME } = process.env

// https://vite.dev/config/
export default defineConfig({
  // Served below /admin/ (Apache, backend/public/admin/); the router uses the same base.
  base: '/admin/',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: DDEV_HOSTNAME ? DDEV_HOSTNAME.split(',') : [],
    origin: DDEV_PRIMARY_URL ? `${DDEV_PRIMARY_URL}:5174` : undefined,
    hmr: DDEV_HOSTNAME
      ? { host: DDEV_HOSTNAME.split(',')[0], protocol: 'wss', clientPort: 5174 }
      : undefined,
    // Symfony runs in the same container on port 80 → same origin, no CORS.
    proxy: {
      '/api': 'http://localhost',
    },
  },
})
