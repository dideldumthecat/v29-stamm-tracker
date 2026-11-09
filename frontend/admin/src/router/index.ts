import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'

import { setUnauthorizedHandler } from '@/api/client'
import { loadUser, user } from '@/auth'
import ActivityView from '@/views/ActivityView.vue'
import LoginView from '@/views/LoginView.vue'
import TimberItemView from '@/views/TimberItemView.vue'
import PlaceholderView from '@/views/PlaceholderView.vue'

// History mode below /admin/; Apache serves admin/index.html for every path there (backend/public/.htaccess).
export function createAdminRouter(history: RouterHistory = createWebHistory('/admin/')) {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', redirect: { name: 'activity' } },
      { path: '/aktivitaet', name: 'activity', component: ActivityView },
      { path: '/staemme/:tag', name: 'timber-item', component: TimberItemView },
      { path: '/:pathMatch(.*)*', component: PlaceholderView },
    ],
  })

  const toLogin = (redirect: string) => ({ name: 'login', query: { redirect } })

  router.beforeEach(async (to) => {
    if (to.name === 'login') return true
    // Without a connection the sign-in page is the right place too: it reports the missing connection.
    return (await loadUser().catch(() => false)) || toLogin(to.fullPath)
  })

  setUnauthorizedHandler(() => {
    user.value = null
    void router.push(toLogin(router.currentRoute.value.fullPath))
  })

  return router
}
