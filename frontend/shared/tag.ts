/** Digits of a plaque number as printed (the range 1–1999 is padded to five digits). */
export const TAG_DIGITS = 5

/**
 * Formats a tag number like the printed plaque: zero-padded to TAG_DIGITS (42 → "00042").
 * Input follows the counter principle (leading zeros are ignored), output uses the plaque format.
 */
export function formatTag(tagNumber: number): string {
  return String(tagNumber).padStart(TAG_DIGITS, '0')
}
