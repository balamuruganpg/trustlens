import type { RechartsTheme } from 'recharts'

function item(color: string) {
  return {
    fill: color,
    stroke: color,
    fillOpacity: 1,
  }
}

/** Neutrals, plus red for a negative (worse) difference. Values are CSS variables. */
export const chartTheme: RechartsTheme = {
  graphicalItems: [
    item('var(--chart-1)'),
    item('var(--chart-2)'),
    item('var(--chart-3)'),
    item('var(--chart-flag)'),
  ],
  pageBackground: 'var(--card)',
  barBackground: { fill: 'var(--panel)' },
  axis: { stroke: 'var(--muted)' },
  grid: { stroke: 'var(--line)', strokeDasharray: '3 3', fill: 'none' },
  reference: { stroke: 'var(--chart-3)', strokeWidth: 1 },
  cursor: { stroke: 'var(--line)', fill: 'var(--line)', fillOpacity: 0.35 },
  tooltip: {
    contentStyle: {
      margin: 0,
      backgroundColor: 'var(--card)',
      border: '1px solid var(--line)',
      borderRadius: 8,
      color: 'var(--fg)',
      fontSize: 12,
    },
    labelStyle: { color: 'var(--fg)', fontWeight: 600 },
    itemStyle: { color: 'var(--fg)' },
  },
  typography: { color: 'var(--fg)' },
}
