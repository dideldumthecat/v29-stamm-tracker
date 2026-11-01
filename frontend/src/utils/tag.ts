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
 * Derived tag for the next beam of a parent. `beamTags` are the current tags of all the parent's beams, removed ones excluded (their letter is free again).
 * Rule: the next beam gets the first unused letter A … Z after one unused letter (from A on) has been skipped
 * per beam that no longer carries a derived tag (it got its own plaque). Null once no letter is left.
 * Example: beams A and B, B gets plaque 345 → only A is used, B is skipped → next is C.
 * Needs only the beams in the snapshot, so every device hands out the same letter.
 */
// ponytail: assumes a renamed beam held the lowest unused letter. Wrong only if a beam in the middle was removed and
// a later one renamed (a letter is then handed out twice); the server's tag_already_taken catches the duplicate.
export function nextBeamTag(parentTag: string, beamTags: (string | null)[]): string | null {
  let skip = beamTags.filter((tag) => !tag?.startsWith(`${parentTag}-`)).length
  for (let index = 0; index < MAX_BEAMS; index++) {
    const tag = `${parentTag}-${String.fromCharCode(65 + index)}`
    if (!beamTags.includes(tag) && skip-- === 0) {
      return tag
    }
  }
  return null
}
