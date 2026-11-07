// Module replacements for the App tests. vi.mock stays in each spec file (it is hoisted there only);
// the factories hand out these objects, so every file of a test run shares the same refs and spies.
import { ref } from 'vue'
import { vi } from 'vitest'

export const needRefresh = ref(false)
export const updateServiceWorker = vi.fn()

export const pwaRegister = {
  useRegisterSW: () => ({ needRefresh, updateServiceWorker }),
}

export const updateCheck = {
  startUpdateCheck: vi.fn(),
  installWhenSafe: vi.fn(),
  isInstalling: ref(false),
  isLockStuck: ref(false),
  reloadFromLock: vi.fn(),
  checkForUpdateNow: vi.fn(),
}

// jsdom cannot decode images: the photos pass through as they are (the compression has its own tests).
export const photoUtils = (original: typeof import('@/utils/photo')) => ({
  ...original,
  attachPhotos: async (files: Blob[], add: (photo: Blob) => void) => {
    files.forEach(add)
    return { skipped: 0 }
  },
})
