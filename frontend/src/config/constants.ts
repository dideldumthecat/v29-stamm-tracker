export const TAG_MIN_NUMBER = 1
export const TAG_MAX_NUMBER = 1999
export const TAG_DIGITS = 5
// One letter per beam, A–Z.
export const MAX_BEAMS = 26
// Photos are compressed on the device before they are stored (decided with V29 and the photo import alike).
export const PHOTO_MAX_EDGE = 4032
export const PHOTO_QUALITY = 0.7
// How long the data phase of a sync may take before it counts as "no connection".
export const SYNC_TIMEOUT_MS = 60_000

// Which build is running, for the server log (same data as the help page, but ASCII: it travels as a header).
export const APP_BUILD = [__APP_REVISION__, __APP_BUILD_TIME__.slice(0, 16)]
  .filter(Boolean)
  .join(' ')
// Diagnostics buffer on the device: whatever is still unsent after this many entries or days is dropped.
export const DIAGNOSTICS_MAX_ENTRIES = 300
export const DIAGNOSTICS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
// Send shortly after an error or warning, once more come in at once.
export const DIAGNOSTICS_DEBOUNCE_MS = 5000
