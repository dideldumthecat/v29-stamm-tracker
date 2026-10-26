import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import StartView from '@/views/StartView.vue'
import { isValidTag } from '@/utils/tag'
import { useTimberItemStore } from '@/stores/timberItems'

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
    // Beams use their derived tag (/timber-item/85-A) and must exist: they are created from the parent only.
    // Hand-edited or stale URLs (/timber-item/abc, /timber-item/5000) go back to the start screen.
    beforeEnter: (to) => {
      const tag = String(to.params.tagNumber)
      const isKnownOrPlain = !tag.includes('-') || useTimberItemStore().findByTag(tag) !== undefined
      return (isValidTag(tag) && isKnownOrPlain) || { name: 'start' }
    },
  },
  {
    path: '/invite/:token',
    name: 'invite',
    component: () => import('@/views/InviteView.vue'),
    props: true,
  },
  // Unknown paths (e.g. old bookmarks) fall back to the start screen.
  { path: '/:pathMatch(.*)*', redirect: { name: 'start' } },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
