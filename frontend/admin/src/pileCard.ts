import type { PileCardSection } from '@v29/shared/contract'

import { formatOneDecimal } from '@/keyFigures'

export type PileWeek = PileCardSection['weeks'][number]

const DAY = 24 * 60 * 60 * 1000
/** A date of the server (Monday of a week, YYYY-MM-DD) as UTC midnight: no time zone can shift the calendar day. */
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`)

/** The ISO calendar week of a Monday (YYYY-MM-DD): the Thursday of the week decides the year, so 28 Dec 2026 is week 53 and 4 Jan 2027 week 1. */
export function isoWeek(weekStart: string): number {
  const thursday = new Date(dateOf(weekStart).getTime() + 3 * DAY)
  const dayOfYear = (thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / DAY
  return Math.floor(dayOfYear / 7) + 1
}

/** "2.–8.11.", across a month "26.10.–1.11.", across a year "28.12.–3.1." (Monday to Sunday). */
export function weekRange(weekStart: string): string {
  const first = dateOf(weekStart)
  const last = new Date(first.getTime() + 6 * DAY)
  const [d1, m1, d2, m2] = [first, last].flatMap((day) => [day.getUTCDate(), day.getUTCMonth() + 1])
  return m1 === m2 ? `${d1}.–${d2}.${m2}.` : `${d1}.${m1}.–${d2}.${m2}.`
}

/** The label under a column: "KW 45" and the period; the current week (the last one) says "bis heute" instead. */
export const weekLabel = (weekStart: string, current: boolean) => ({
  title: `KW ${isoWeek(weekStart)}`,
  period: current ? 'bis heute' : weekRange(weekStart),
})

/**
 * The grid lines of the axis in round steps (1, 2, 5, 10, 20, 50 …), at most four steps, so that the top is the first step at or above the
 * highest column: 24 gives 0, 10, 20, 30.
 */
export function axisSteps(max: number): { step: number; top: number; ticks: number[] } {
  const steps = [1, 2, 5]
    .flatMap((m) => [1, 10, 100, 1000].map((magnitude) => m * magnitude))
    .sort((a, b) => a - b)
  const step =
    steps.find((candidate) => Math.ceil(max / candidate) <= 4) ?? steps[steps.length - 1]!
  const count = Math.max(1, Math.ceil(max / step))
  return { step, top: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) }
}

/** "130 Stämme", "1 Stamm". */
export const stemsText = (stems: number) => `${stems} ${stems === 1 ? 'Stamm' : 'Stämme'}`

/** The share of processed stems (sawn or unsawable) as "95,5 %"; a pile with none says "0 %". */
export function progressText({ progress, stems }: Pick<PileCardSection, 'progress' | 'stems'>) {
  const processed = progress.sawn + progress.not_sawable
  return processed === 0 ? '0 %' : `${formatOneDecimal((processed / stems) * 100)} %`
}

/** The sum of beams of a week. */
export const weekTotal = (week: PileWeek) => week.large + week.small

/** The sawn beams of all weeks by size: the two figures of "Ausbeute". */
export const beamTotals = ({ weeks }: Pick<PileCardSection, 'weeks'>) => ({
  large: weeks.reduce((sum, week) => sum + week.large, 0),
  small: weeks.reduce((sum, week) => sum + week.small, 0),
})

/** Everything the chart shows, for screen readers: "KW 45 (2.–8.11.): 5 insgesamt, 3 Balken 14×14 (groß), 2 Balken 10×14 (klein); …; Durchschnitt 15,5 pro Woche". */
export function chartDescription(section: PileCardSection): string {
  const { weeks, size_labels: sizes, average_per_week: average } = section
  const rows = weeks.map((week, index) => {
    const label = weekLabel(week.week_start, index === weeks.length - 1)
    return `${label.title} (${label.period}): ${weekTotal(week)} insgesamt, ${week.large} Balken ${sizes.large}, ${week.small} Balken ${sizes.small}`
  })
  return `Gesägte Balken pro Woche. ${rows.join('; ')}${average === null ? '' : `. Durchschnitt ${formatOneDecimal(average)} pro Woche`}`
}
