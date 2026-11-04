/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vue" />

interface ImportMetaEnv {
  /** "fake": fixtures instead of the server (src/api/client.ts). */
  readonly VITE_API?: 'fake'
}

/** Short commit hash at build time, "-dirty" with uncommitted changes; null without git (vite.config.ts). */
declare const __APP_REVISION__: string | null
/** Build time as ISO timestamp (vite.config.ts). */
declare const __APP_BUILD_TIME__: string
