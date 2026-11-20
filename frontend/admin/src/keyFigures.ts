import type { KeyFigure } from '@v29/shared/contract'

const volume = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})
const percent = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

/** Cubic metres with three decimals, German comma: 0.50234 → "0,502". The lists reuse it. */
export const formatVolume = (cubicMetres: number) => volume.format(cubicMetres)

/** A share as whole percent, without the sign: 0.6047 → "60". The lists reuse it. */
export const formatPercent = (share: number) => percent.format(share * 100)

/** "0,502 fm", "0,304 m³" or "60 %", the unit set off by a no-break space; null if the figure cannot be calculated. */
export function formatFigure(figure: KeyFigure): string | null {
  if (figure.value === null) return null
  return figure.unit === '%'
    ? `${formatPercent(figure.value)} %`
    : `${formatVolume(figure.value)} ${figure.unit}`
}
