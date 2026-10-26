/**
 * Finds the invite code in whatever was pasted: the bare code, the link, or a whole messenger message.
 * Only recognises; the backend normalises the code again and has the final word.
 */

// Crockford Base32 after the look-alikes O, I, L are mapped to digits (same rule as the backend).
const CODE = /^[0-9A-HJKMNP-TV-Z]{12}$/

const normalize = (text: string) =>
  text.replace(/[-\s]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')

const isCode = (text: string) => CODE.test(normalize(text))

// Messengers add invisible marks, protected spaces and their own dashes when copying.
function clean(text: string): string {
  return text
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractInviteCode(pasted: string): string | null {
  const text = clean(pasted)
  const fragment = text.match(/https?:\/\/\S*?#([A-Za-z0-9-]+)/)?.[1]
  if (fragment) {
    // A dash glued to the link ("…9RDP–danke") became a hyphen; codes never end with one.
    const printed = fragment.match(
      /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}(?![A-Za-z0-9])/,
    )?.[0]
    return printed ?? fragment.replace(/-+$/, '')
  }
  // Typed by hand, maybe with spaces between the groups.
  if (isCode(text)) {
    return text
  }
  const words = text.match(/[A-Za-z0-9-]+/g) ?? []
  // The printed form K7QM-4XHT-9RDP first, so a plain 12-letter word earlier in the message does not win.
  return (
    words.find((word) => /^[^-]{4}-[^-]{4}-[^-]{4}$/.test(word) && isCode(word)) ??
    words.find(isCode) ??
    null
  )
}
