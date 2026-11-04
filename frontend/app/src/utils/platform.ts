export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

// Started from the home screen icon instead of a browser tab.
export const isInstalledApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
