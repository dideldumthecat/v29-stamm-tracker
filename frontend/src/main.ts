import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// iOS Safari applies :active on touch only when a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true })

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
