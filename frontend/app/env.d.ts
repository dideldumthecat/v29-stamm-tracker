/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vue" />

interface ImportMetaEnv {
  /** "fake": fixtures instead of the server (src/api/client.ts). */
  readonly VITE_API?: 'fake'
}

/** Short content hash of the app files (vite.config.ts). */
declare const __APP_BUILD__: string
