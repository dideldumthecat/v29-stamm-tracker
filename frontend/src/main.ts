import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useTimberItemStore } from './stores/timberItems'
import { requestStoragePersistence } from './composables/useStoragePersistence'
import { startAutoRefresh } from './composables/useAutoRefresh'

// iOS Safari applies :active on touch only when a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true })

const app = createApp(App)
app.use(createPinia())

requestStoragePersistence()

// The router runs its first navigation on install, and its guards need the stored state.
useTimberItemStore()
  .load()
  .then(
    () => {
      app.use(router)
      app.mount('#app')
      startAutoRefresh()
    },
    (error) => {
      // Without device storage nothing recorded would survive: better not to start at all.
      document.getElementById('app')!.textContent =
        'Gerätespeicher nicht verfügbar – die App kann nicht starten. Privates Fenster? Dann bitte normal öffnen.'
      throw error
    },
  )
