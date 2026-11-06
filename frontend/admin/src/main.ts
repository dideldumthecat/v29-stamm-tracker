import './assets/main.css'

import { createApp } from 'vue'

import App from './App.vue'
import { createAdminRouter } from './router'

createApp(App).use(createAdminRouter()).mount('#app')
