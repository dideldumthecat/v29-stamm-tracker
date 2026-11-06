import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useToast } from './composables/useToast'
import { useTimberItemStore } from './stores/timberItems'
import { requestStoragePersistence } from './composables/useStoragePersistence'
import { startAutoRefresh } from './composables/useAutoRefresh'
import { captureErrors, recordBuildChange } from './diagnostics/record'
import { reportWithoutBuffer, startDiagnosticsSending } from './diagnostics/send'

// iOS Safari applies :active on touch only when a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true })

const app = createApp(App)
app.use(createPinia())

captureErrors(app)
const isUpdated = recordBuildChange()
requestStoragePersistence()

// The router runs its first navigation on install, and its guards need the stored state.
useTimberItemStore()
  .load()
  .then(
    () => {
      app.use(router)
      app.mount('#app')
      if (isUpdated) {
        useToast().show({ before: 'App aktualisiert' })
      }
      startAutoRefresh()
      startDiagnosticsSending()
    },
    (error) => {
      // Without device storage nothing recorded would survive: better not to start at all.
      document.getElementById('app')!.textContent =
        'Gerätespeicher nicht verfügbar – die App kann nicht starten. Privates Fenster? Dann bitte normal öffnen.'
      // The buffer lives in the same storage, so this one goes out directly.
      void reportWithoutBuffer('storage_unavailable', 'App cannot start without device storage', {
        error_name: error instanceof Error ? error.name : undefined,
      })
      throw error
    },
  )
