import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'

import { setUnauthorizedHandler } from '@/api/client'
import { loadUser, user } from '@/auth'
import { itemRoute, normalizeTag } from '@/detail'
import ActivityView from '@/views/ActivityView.vue'
import LoginView from '@/views/LoginView.vue'
import TimberItemsView from '@/views/TimberItemsView.vue'
import TimberItemView from '@/views/TimberItemView.vue'
import PlaceholderView from '@/views/PlaceholderView.vue'

// History mode below /admin/; Apache serves admin/index.html for every path there (backend/public/.htaccess).
export function createAdminRouter(history: RouterHistory = createWebHistory('/admin/')) {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', redirect: { name: 'activity' } },
      { path: '/activity', name: 'activity', component: ActivityView },
      // One view for both lists; the router decides which. Another name makes another instance (App.vue keys the view by it).
      { path: '/stems', name: 'stems', component: TimberItemsView, props: { kind: 'stem' } },
      { path: '/beams', name: 'beams', component: TimberItemsView, props: { kind: 'beam' } },
      // One view for both details; the path follows the kind of the tag (see `itemRoute`, and the guard below for a tag of the other kind)
      { path: '/stems/:tag', name: 'stem', component: TimberItemView },
      { path: '/beams/:tag', name: 'beam', component: TimberItemView },
      { path: '/:pathMatch(.*)*', component: PlaceholderView },
    ],
  })

  const toLogin = (redirect: string) => ({ name: 'login', query: { redirect } })

  router.beforeEach(async (to) => {
    if (to.name === 'login') return true
    // Without a connection the sign-in page is the right place too: it reports the missing connection.
    if (!(await loadUser().catch(() => false))) return toLogin(to.fullPath)
    // A tag on the path of the other kind (/beams/104, /stems/104-A) goes to the right one. A guard redirect keeps the way the navigation was made
    // (push stays push, a pasted link replaces its entry): the wrong path never lands in the history, and no entry is added or replaced beyond that.
    const tag =
      to.name === 'stem' || to.name === 'beam' ? normalizeTag(String(to.params.tag)) : null
    if (tag && itemRoute(tag).name !== to.name) {
      return { ...itemRoute(tag), query: to.query, hash: to.hash }
    }
    return true
  })

  setUnauthorizedHandler(() => {
    user.value = null
    void router.push(toLogin(router.currentRoute.value.fullPath))
  })

  return router
}
