const NUMBER = String.raw`\d+(?:[.,]\d+)?`
const MINUTE_MARK = String.raw`['′’]`
const SECOND_MARK = String.raw`(?:["″”]|''|′′|’’)`
// [-] degrees [°] [minutes mark [seconds mark]], blanks anywhere between the parts
const PATTERN = new RegExp(
  String.raw`^\s*(-)?\s*(${NUMBER})\s*°?\s*(?:(${NUMBER})\s*${MINUTE_MARK}\s*(?:(${NUMBER})\s*${SECOND_MARK}\s*)?)?$`,
)

/**
 * Reads a coordinate as decimal degrees ("51.4132", "51,4132", "-51,4°") or as degrees, minutes and seconds like in the handover record
 * (`51°24'47"`, `51° 24′ 47,5″`, `51°24'`; typographic marks and blanks are fine). Only the last part may have decimals, minutes and seconds
 * are below 60. Rounded to six decimals (about 0.1 m). Null for anything else; the range of latitude and longitude is the server's rule.
 */
export function parseCoordinate(text: string): number | null {
  const match = PATTERN.exec(text)
  if (!match) return null
  const [, minus, degrees, minutes, seconds] = match
  const parts = [degrees, minutes, seconds].filter((part) => part !== undefined).map(toNumber)
  // Decimals only in the last part, minutes and seconds below 60
  if (parts.slice(0, -1).some((part) => !Number.isInteger(part))) return null
  if (parts.slice(1).some((part) => part >= 60)) return null
  const [d, m = 0, s = 0] = parts
  const value = Math.round((d + m / 60 + s / 3600) * 1e6) / 1e6
  return minus ? -value : value
}

const toNumber = (part: string) => Number(part.replace(',', '.'))
