import type { DashboardFigure, KeyFigure } from '@v29/shared/contract'

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

const count = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })
const total = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const oneDecimal = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** One decimal, German comma: 40.5 → "40,5". Shares of the dashboard (as percent) and its beams per stem. */
export const formatOneDecimal = (value: number) => oneDecimal.format(value)

/** The number of a dashboard figure without its unit: a count "1.300", a volume "15,66", a share "40,5"; null if not calculable. */
export function formatTotal(figure: DashboardFigure): string | null {
  if (figure.value === null) return null
  if (figure.unit === null) return count.format(figure.value)
  return figure.unit === '%' ? formatOneDecimal(figure.value * 100) : total.format(figure.value)
}
