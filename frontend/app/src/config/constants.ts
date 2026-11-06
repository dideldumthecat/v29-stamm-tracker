export const TAG_MIN_NUMBER = 1
export const TAG_MAX_NUMBER = 1999
// One letter per beam, A–Z.
export const MAX_BEAMS = 26
// Photos are compressed on the device before they are stored (decided with V29 and the photo import alike).
export const PHOTO_MAX_EDGE = 4032
// Apple's JPEG encoder (every browser on iOS/iPadOS, Safari on the Mac) has its own quality scale: 0.6 there gives
// about the same visual level as 0.85 elsewhere.
export const PHOTO_QUALITY_APPLE = 0.6
export const PHOTO_QUALITY_DEFAULT = 0.85
// How long the data phase of a sync may take before it counts as "no connection".
export const SYNC_TIMEOUT_MS = 60_000

// Which build is running (help page, diagnostics, header X-App-Build).
export const APP_BUILD = __APP_BUILD__
// Diagnostics buffer on the device: whatever is still unsent after this many entries or days is dropped.
export const DIAGNOSTICS_MAX_ENTRIES = 300
export const DIAGNOSTICS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
// Send shortly after an error or warning, once more come in at once.
export const DIAGNOSTICS_DEBOUNCE_MS = 5000
