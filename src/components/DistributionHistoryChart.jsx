import React, { useMemo } from 'react'
import Plot from './ThemedPlot'
import {
  distributionPeriodsPerYear,
  distributionYieldPeriodLabel,
} from '../utils/distributionPeriod'
import { annualDistributionEstimate } from '../utils/approxYield'
import { getCurrencyLabel } from '../utils/money'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Estimate an annual yield from the latest completed distribution cycle.
// Quarterly funds use four payments instead of multiplying one unusually high
// or low quarter by four.
export function estimateForwardYield(history, price, frequency = null) {
  const priceNum = Number(price)
  if (!Number.isFinite(priceNum) || priceNum <= 0) return null

  const estimate = annualDistributionEstimate(history, frequency)
  if (!estimate) return null
  return {
    yieldPct: (estimate.annual / priceNum) * 100,
    annual: estimate.annual,
    basis: estimate.basis,
  }
}

export function buildDistributionChart(history, ticker, price, pctMode = false, annual = false, emptyLabel = 'this symbol', theme = chartTheme(true), frequency = null) {
  const byMonth = new Map()

  ;(Array.isArray(history) ? history : []).forEach(item => {
    const amount = Number(item?.amount)
    const parts = String(item?.date || '').slice(0, 10).split('-')
    if (!Number.isFinite(amount) || amount <= 0 || parts.length < 2) return
    const year = Number(parts[0])
    const month = Number(parts[1])
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return
    const key = `${year}-${String(month).padStart(2, '0')}`
    byMonth.set(key, (byMonth.get(key) || 0) + amount)
  })

  const sortedMonths = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-36)
  const monthly = sortedMonths.map(([key, amount]) => {
    const [year, month] = key.split('-').map(Number)
    return {
      label: `${MONTH_NAMES[month - 1]} ${String(year).slice(-2)}`,
      amount: Number(amount.toFixed(4)),
    }
  })

  const priceNum = Number(price) || 0
  const dollarValues = monthly.map(item => item.amount)
  const showPct = pctMode && priceNum > 0
  const periodLabel = distributionYieldPeriodLabel(sortedMonths.map(([key]) => key), frequency)
  const periodsPerYear = distributionPeriodsPerYear(periodLabel)
  const isAnnualized = Boolean(annual && periodsPerYear)
  const annualizedDollars = isAnnualized
    ? dollarValues.map((_, idx) => {
        const window = dollarValues.slice(Math.max(0, idx - periodsPerYear + 1), idx + 1)
        const total = window.reduce((sum, value) => sum + value, 0)
        return window.length >= periodsPerYear
          ? total
          : (total / window.length) * periodsPerYear
      })
    : dollarValues
  const values = showPct ? annualizedDollars.map(v => (v / priceNum) * 100) : dollarValues
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const pctLabel = isAnnualized ? 'Trailing Annual Yield %' : `${periodLabel} Yield %`
  const titleSuffix = showPct ? ` (${pctLabel})` : ''

  return {
    hasData: values.length > 0,
    canShowPct: priceNum > 0,
    canAnnualize: periodsPerYear != null,
    isAnnualized,
    periodLabel,
    layout: {
      template: theme.template,
      paper_bgcolor: theme.surface,
      plot_bgcolor: theme.surface,
      font: { color: theme.font, size: 12 },
      title: { text: `${ticker || emptyLabel} - Distribution History${titleSuffix}`, x: 0.5, font: { size: 18, color: theme.title } },
      height: 360,
      margin: { l: 58, r: 36, t: 58, b: 72 },
      bargap: 0.18,
      yaxis: {
        ...(showPct ? { ticksuffix: '%', tickformat: '.2f' } : { tickprefix: '$' }),
        gridcolor: theme.grid,
        zerolinecolor: theme.zeroline,
        fixedrange: true,
      },
      xaxis: {
        gridcolor: theme.grid,
        tickangle: -45,
        fixedrange: true,
      },
      showlegend: false,
    },
    data: values.length ? [{
      x: monthly.map(item => item.label),
      y: values,
      type: 'bar',
      text: values.map(value => (showPct ? `${value.toFixed(1)}%` : `$${value.toFixed(3)}`)),
      textposition: 'outside',
      textangle: 0,
      cliponaxis: false,
      textfont: { size: 9, color: theme.title },
      marker: {
        color: values.map(value => value >= average ? '#62f27b' : '#82c7f5'),
        line: { color: 'rgba(255, 255, 255, 0.12)', width: 1 },
      },
      hovertemplate: showPct
        ? `<b>${ticker || emptyLabel}</b><br>%{x}<br>%{y:.3f}%<extra></extra>`
        : `<b>${ticker || emptyLabel}</b><br>%{x}<br>$%{y:.4f}<extra></extra>`,
    }] : [],
  }
}

export default function DistributionHistoryChart({
  history,
  ticker,
  price,
  frequency,
  source,
  pctMode,
  annual,
  onTogglePctMode,
  onToggleAnnual,
  emptyLabel = 'this symbol',
  emptyClassName = 'etfc-empty etfc-distribution-empty',
  sourceClassName = 'etfc-distribution-source',
  toolbarStart = null,
  showEstimatedYield = false,
}) {
  const { isDark } = useTheme()
  const theme = chartTheme(isDark)
  const chart = useMemo(
    () => buildDistributionChart(history, ticker, price, pctMode, annual, emptyLabel, theme, frequency),
    [history, ticker, price, pctMode, annual, emptyLabel, theme, frequency],
  )
  const estimate = useMemo(
    () => (showEstimatedYield ? estimateForwardYield(history, price, frequency) : null),
    [showEstimatedYield, history, price, frequency],
  )
  const hasToolbar = toolbarStart || chart.canShowPct || source || showEstimatedYield

  return (
    <>
      {hasToolbar && (
        <div className="etfc-distribution-toolbar">
          {toolbarStart}
          {showEstimatedYield && (
            <span
              className="etfc-est-yield"
              title={estimate ? `Estimated forward yield — ${estimate.basis}` : 'No distribution data'}
            >
              Est. Yield: <strong>{estimate ? `${estimate.yieldPct.toFixed(2)}%` : 'No data'}</strong>
            </span>
          )}
          {chart.canShowPct && (
            <button
              className={`btn btn-sm${pctMode ? ' btn-active' : ''}`}
              onClick={onTogglePctMode}
            >
              {pctMode ? `Amount (${getCurrencyLabel()})` : 'Yield %'}
            </button>
          )}
          {pctMode && chart.canShowPct && chart.canAnnualize && (
            <button
              className={`btn btn-sm${chart.isAnnualized ? ' btn-active' : ''}`}
              onClick={onToggleAnnual}
            >
              {chart.isAnnualized ? chart.periodLabel : 'Annual'}
            </button>
          )}
          {source && <span className={sourceClassName}>Source: {source}</span>}
        </div>
      )}
      {chart.hasData ? (
        <Plot
          data={chart.data}
          layout={chart.layout}
          config={{ responsive: true, displayModeBar: false }}
          useResizeHandler
          style={{ width: '100%', height: 360 }}
        />
      ) : (
        <div className={emptyClassName}>
          No distribution history available for {ticker || emptyLabel}.
        </div>
      )}
    </>
  )
}
