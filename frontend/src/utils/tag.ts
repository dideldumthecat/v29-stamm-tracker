import { TAG_DIGITS, TAG_MIN_NUMBER, TAG_MAX_NUMBER } from '@/config/constants'

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
  const match = /^(\d+)(-[A-Z]+)?$/.exec(tag)
  return match !== null && isValidTagNumber(Number(match[1]))
}

/** Spreadsheet-style column letters: 0 → "A", 25 → "Z", 26 → "AA". */
function beamLetters(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26))
  return index < 26 ? letter : beamLetters(Math.floor(index / 26) - 1) + letter
}

/**
 * Derived tag for the next beam of a parent: "123-A", "123-B", …, the first one not taken by a sibling.
 * A letter freed by removing an unsynced beam is reused.
 */
export function nextBeamTag(parentTag: string, siblingTags: (string | null)[]): string {
  for (let index = 0; ; index++) {
    const tag = `${parentTag}-${beamLetters(index)}`
    if (!siblingTags.includes(tag)) {
      return tag
    }
  }
}
