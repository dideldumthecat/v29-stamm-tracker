import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import StartView from '@/views/StartView.vue'
import { isValidTagNumber } from '@/utils/tag'

// Exported so tests can build a router with memory history from the same routes.
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'start', component: StartView },
  {
    // The URL carries the plain tag number (85, not 00085): the plaque format is
    // presentation only. Tags can change (tag_assigned, latest wins) and are not
    // unique, so this will likely switch to the stable ID once the local data layer exists.
    path: '/timber-item/:tagNumber',
    name: 'timber-item',
    component: () => import('@/views/TimberItemView.vue'),
    props: true,
    // Hand-edited or stale URLs (/timber-item/abc, /timber-item/5000) go back to the start screen.
    beforeEnter: (to) => isValidTagNumber(Number(to.params.tagNumber)) || { name: 'start' },
  },
  // Unknown paths (e.g. old bookmarks) fall back to the start screen.
  { path: '/:pathMatch(.*)*', redirect: { name: 'start' } },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
