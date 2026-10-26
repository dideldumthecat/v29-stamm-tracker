/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "fake": fixtures instead of the server (src/api/client.ts). */
  readonly VITE_API?: 'fake'
}
