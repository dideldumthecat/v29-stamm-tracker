// Crockford Base32 after the look-alikes O, I, L are mapped to digits (same rule as the backend).
const CODE = /^[0-9A-HJKMNP-TV-Z]{12}$/

// The backend normalises the code again and has the final word.
export const isInviteCode = (text: string) =>
  CODE.test(text.replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1'))

// Grouping only once the next group starts, so backspace can remove the hyphen.
export const formatInviteInput = (text: string) =>
  text
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12)
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join('-') ?? ''
