import { useTheme } from '../../context/ThemeContext'

/**
 * Chart colors, per mode. Recharts writes colors into SVG attributes, where
 * CSS variables don't resolve, so they're picked here from the theme.
 *
 * Data colors follow the validated reference palette (dataviz skill,
 * references/palette.md): categorical slots in fixed order, a one-hue blue
 * ramp for ordered stages, reserved status colors. Chrome (the filter
 * sidebar, headings) takes the navy of the chosen dashboard template.
 */
export interface ChartTheme {
  surface: string
  grid: string
  axis: string
  textPrimary: string
  textSecondary: string
  /** Categorical slots — fixed order, never cycled. */
  series: [string, string, string, string]
  /** Ordinal blue ramp for ordered stages (lightest still clears 2:1 on the surface). */
  ordinal: string[]
  /** De-emphasised hue for sparklines' history. */
  muted: string
  status: { good: string; warning: string; serious: string; critical: string }
}

const light: ChartTheme = {
  surface: '#ffffff',
  grid: '#ebeae6',
  axis: '#8c8b86',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
  ordinal: ['#0d366b', '#184f95', '#256abf', '#3987e5', '#5598e7', '#86b6ef'],
  muted: '#b3b2ad',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

const dark: ChartTheme = {
  surface: '#0f172a',
  grid: '#1f2937',
  axis: '#8b93a3',
  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
  ordinal: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'],
  muted: '#4b5563',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

export function useChartTheme(): ChartTheme {
  return useTheme().theme === 'dark' ? dark : light
}

const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

/** 1.284 / 12,9 N / 4,2 Tr — for tiles and axes. */
export const fmtCompact = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : full.format(n))
export const fmtNumber = (n: number) => full.format(n)
export const fmtPercent = (n: number) => `${full.format(n)}%`

/** Hours → "5 giờ" / "2,3 ngày". */
export function fmtDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} phút`
  if (hours < 48) return `${full.format(hours)} giờ`
  return `${full.format(hours / 24)} ngày`
}
