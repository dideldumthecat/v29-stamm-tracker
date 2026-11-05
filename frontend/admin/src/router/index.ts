import { createRouter, createWebHistory } from 'vue-router'

import PlaceholderView from '@/views/PlaceholderView.vue'

// History mode below /admin/; Apache serves admin/index.html for every path there (backend/public/.htaccess).
export default createRouter({
  history: createWebHistory('/admin/'),
  routes: [{ path: '/:pathMatch(.*)*', component: PlaceholderView }],
})
