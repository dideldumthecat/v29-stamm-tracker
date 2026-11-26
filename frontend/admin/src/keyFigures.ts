import { formatDiameterClass } from '@/diameterClasses'
import type { KeyFigure } from '@/api/contract'

const volume = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})
const percent = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

/** Cubic metres with three decimals, German comma: 0.50234 → "0,502". The lists reuse it. */
export const formatVolume = (cubicMetres: number) => volume.format(cubicMetres)

/** A share as whole percent, without the sign: 0.6047 → "60". The lists reuse it. */
export const formatPercent = (share: number) => percent.format(share * 100)

/** "32–33 cm" for the diameter class, "0,502 fm", "0,304 m³" or "60 %", the unit set off by a no-break space; null if the figure cannot be calculated. */
export function formatFigure(figure: KeyFigure): string | null {
  if (figure.value === null) return null
  if (figure.unit === 'cm') return formatDiameterClass(figure.value)
  return figure.unit === '%'
    ? `${formatPercent(figure.value)} %`
    : `${formatVolume(figure.value)} ${figure.unit}`
}

const total = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const oneDecimal = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** Two decimals, German comma: 6.341 → "6,34". Volumes of the pile cards. */
export const formatTwoDecimals = (value: number) => total.format(value)

/** One decimal, German comma: 40.5 → "40,5". Beams per stem of the dashboard and averages of the pile cards. */
export const formatOneDecimal = (value: number) => oneDecimal.format(value)

/** "50,0 % ≈ 25,76 Rm" → the numbers ("50,0", "25,76") and the text between them, so that a card can set the numbers apart. */
export function numberParts(text: string): { text: string; number: boolean }[] {
  return text
    .split(/(\d[\d.,]*\d|\d)/)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, number: /^\d/.test(part) }))
}
