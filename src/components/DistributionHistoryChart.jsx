import React, { useMemo } from 'react'
import Plot from './ThemedPlot'
import { distributionYieldPeriodLabel } from '../utils/distributionPeriod'
import { getCurrencyLabel } from '../utils/money'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Infer how many times per year a fund distributes from the median gap between
// its most recent payments. Used only for the single-distribution fallback.
function inferAnnualMultiplier(distDesc) {
  if (distDesc.length < 2) return 4
  const gaps = []
  for (let i = 0; i < Math.min(distDesc.length - 1, 6); i++) {
    gaps.push(Math.abs(distDesc[i].t - distDesc[i + 1].t) / 86400000)
  }
  gaps.sort((a, b) => a - b)
  const gap = gaps[Math.floor(gaps.length / 2)]
  if (gap <= 10) return 52
  if (gap <= 45) return 12
  if (gap <= 115) return 4
  if (gap <= 240) return 2
  return 1
}

// Estimate a forward annual yield from the most current distributions: sum the
// distributions paid in the last 3 months and annualize (×4). If none fall in
// that window (insufficient recent data), fall back to the most recent single
// distribution annualized by its inferred frequency. Returns null when there is
// no usable price or no distribution data at all ("No data").
export function estimateForwardYield(history, price) {
  const priceNum = Number(price)
  if (!Number.isFinite(priceNum) || priceNum <= 0) return null

  const dist = (Array.isArray(history) ? history : [])
    .map(item => ({ amount: Number(item?.amount), t: Date.parse(String(item?.date).slice(0, 10)) }))
    .filter(d => Number.isFinite(d.amount) && d.amount > 0 && Number.isFinite(d.t))
    .sort((a, b) => b.t - a.t)

  if (!dist.length) return null

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 3)
  const cutoffMs = cutoff.getTime()
  const recent = dist.filter(d => d.t >= cutoffMs)

  if (recent.length) {
    const annual = recent.reduce((s, d) => s + d.amount, 0) * 4
    return {
      yieldPct: (annual / priceNum) * 100,
      annual,
      basis: `${recent.length} distribution${recent.length > 1 ? 's' : ''} in last 3 months × 4`,
    }
  }

  // Not enough recent data — use the most recent distribution, annualized.
  const latest = dist[0]
  const mult = inferAnnualMultiplier(dist)
  const annual = latest.amount * mult
  return {
    yieldPct: (annual / priceNum) * 100,
    annual,
    basis: `latest distribution annualized (×${mult})`,
  }
}

export function buildDistributionChart(history, ticker, price, pctMode = false, annual = false, emptyLabel = 'this symbol', theme = chartTheme(true)) {
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
  const annualMult = annual ? 12 : 1
  const values = showPct ? dollarValues.map(v => (v / priceNum) * 100 * annualMult) : dollarValues
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const pctLabel = annual ? 'Annual Yield %' : `${distributionYieldPeriodLabel(sortedMonths.map(([key]) => key))} Yield %`
  const titleSuffix = showPct ? ` (${pctLabel})` : ''

  return {
    hasData: values.length > 0,
    canShowPct: priceNum > 0,
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
    () => buildDistributionChart(history, ticker, price, pctMode, annual, emptyLabel, theme),
    [history, ticker, price, pctMode, annual, emptyLabel, theme],
  )
  const estimate = useMemo(
    () => (showEstimatedYield ? estimateForwardYield(history, price) : null),
    [showEstimatedYield, history, price],
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
          {pctMode && chart.canShowPct && (
            <button
              className={`btn btn-sm${annual ? ' btn-active' : ''}`}
              onClick={onToggleAnnual}
            >
              {annual ? 'Monthly' : 'Annual'}
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

