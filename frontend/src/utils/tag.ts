import { MAX_BEAMS, TAG_DIGITS, TAG_MIN_NUMBER, TAG_MAX_NUMBER } from '@/config/constants'

/**
 * Formats a tag number like the printed plaque: zero-padded to TAG_DIGITS (42 → "00042").
 * Input follows the counter principle (leading zeros are ignored), output uses the plaque format.
 */
export function formatTag(tagNumber: number): string {
  return String(tagNumber).padStart(TAG_DIGITS, '0')
}

/** True for whole numbers within the plaque range. */
export function isValidTagNumber(tagNumber: number): boolean {
  return Number.isInteger(tagNumber) && tagNumber >= TAG_MIN_NUMBER && tagNumber <= TAG_MAX_NUMBER
}

/** True for a tag as it appears in URLs and the contract: "85" or a beam tag like "85-A". */
export function isValidTag(tag: string): boolean {
  const match = /^(\d+)(-[A-Z])?$/.exec(tag)
  return match !== null && isValidTagNumber(Number(match[1]))
}

/**
 * Derived tag for the next beam of a parent: "123-A" … "123-Z", null once all 26 letters are used.
 * `beamCount` counts every beam ever created on the parent, so a letter is never handed out twice.
 */
export function nextBeamTag(parentTag: string, beamCount: number): string | null {
  return beamCount < MAX_BEAMS ? `${parentTag}-${String.fromCharCode(65 + beamCount)}` : null
}
