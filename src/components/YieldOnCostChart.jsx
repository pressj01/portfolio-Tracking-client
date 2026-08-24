import React, { useMemo } from 'react'
import Plot from './ThemedPlot'
import { buildYieldOnCostSeries } from '../utils/yieldOnCost'
import { formatMoney } from '../utils/money'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, resolveCssColor, themedPlotlyLayout } from '../utils/chartTheme'

/**
 * Yield on cost for one or more funds over the window the return chart is
 * showing. Each entry is { symbol, series, color, frequency, dimmed }, where
 * `series` is an /api/etf-screen/data series entry.
 */
export default function YieldOnCostChart({
  entries = [],
  visibleStart = null,
  visibleEnd = null,
  hovermode = 'x unified',
  height = 380,
  dimmedColor = '#7c8595',
  emptyClassName = 'etfc-empty etfc-distribution-empty',
}) {
  const { isDark } = useTheme()
  const theme = chartTheme(isDark)

  const built = useMemo(() => entries
    .map(entry => ({
      ...entry,
      // Resolved here so the line, the legend entry, and the swatch in the
      // basis row below all agree on the fund's color.
      color: resolveCssColor(entry.color, isDark),
      yoc: buildYieldOnCostSeries(entry.series, {
        frequency: entry.frequency,
        visibleStart,
        visibleEnd,
      }),
    }))
    .filter(entry => entry.yoc), [entries, visibleStart, visibleEnd, isDark])

  const chart = useMemo(() => {
    // Each line now carries its full history so MAX stays pannable, but Plotly
    // autoranges y over all of it — including the off-screen years. Scale to
    // the window on screen instead, the way the return chart does.
    const highs = built.map(e => e.yoc.visibleMax).filter(Number.isFinite)
    const visibleHigh = highs.length ? Math.max(...highs) : null
    const yAxisRange = visibleHigh != null ? [0, visibleHigh * 1.08 || 1] : null
    return {
    data: built.map(({ symbol, color, dimmed, yoc }) => ({
      x: yoc.x,
      y: yoc.y,
      type: 'scatter',
      mode: 'lines',
      name: `${symbol} (${yoc.yieldPct.toFixed(2)}%)`,
      line: { color: dimmed ? dimmedColor : color, width: dimmed ? 1.6 : 2.6, shape: 'hv' },
      connectgaps: false,
      hovertemplate: `<b>${symbol}</b><br>%{x}<br>Yield on Cost: %{y:.2f}%<extra></extra>`,
    })),
    layout: {
      paper_bgcolor: theme.surface,
      plot_bgcolor: theme.surface,
      font: { color: theme.font, size: 12 },
      height,
      margin: { l: 58, r: 40, t: 30, b: 48 },
      hovermode,
      legend: { orientation: 'h', x: 0, y: 1.12, font: { size: 11 } },
      yaxis: {
        // Plotly 3 ignores a bare-string axis title; it must be an object.
        title: { text: 'Yield on Cost (%)' },
        ticksuffix: '%',
        tickformat: ',.2f',
        rangemode: 'tozero',
        gridcolor: theme.grid,
        zerolinecolor: theme.zeroline,
        // Both axes are fixed: this chart follows the window the return chart
        // above is showing. Dragging it independently would slide the line out
        // from under a y-scale that is pinned to that window.
        fixedrange: true,
        ...(yAxisRange ? { range: yAxisRange, autorange: false } : {}),
      },
      xaxis: {
        type: 'date',
        gridcolor: theme.grid,
        fixedrange: true,
        ...(visibleStart && visibleEnd ? { range: [visibleStart, visibleEnd], autorange: false } : {}),
      },
    },
    }
  }, [built, theme, height, hovermode, dimmedColor, visibleStart, visibleEnd])

  // Collapsed by default — the chart should be readable without it, and the
  // page already carries several sections.
  const help = (
    <details className="yoc-help">
      <summary>How to read this chart</summary>
      <div className="yoc-help-body">
        <p>
          <strong>What it graphs.</strong> Each fund's current annualized distribution divided by
          its share price at the <em>start of the charted window</em> — the yield you would be
          earning today had you bought on that date and held. The line steps whenever a new
          distribution changes the run rate and is flat between payments. Because the cost is the
          window's first close, changing the period or the dates re-prices every line: on{' '}
          <strong>MAX</strong> all funds share one start date so they compare directly, while on{' '}
          <strong>ALL</strong> each fund uses its own inception price.
        </p>
        <p><strong>What a strong income ETF looks like here:</strong></p>
        <ul>
          <li>
            <strong>Rising or flat.</strong> The payout is at least holding against your cost. A
            steadily climbing line is genuine distribution growth — the income keeps up without
            you adding a dollar.
          </li>
          <li>
            <strong>Falling is the warning.</strong> Income per share is shrinking. This is exactly
            what the quoted yield hides: a fund paying a set percentage of a declining NAV keeps
            advertising the same yield while the cash you actually receive drops.
          </li>
          <li>
            <strong>Steady steps, not wild swings.</strong> A predictable payout is income you can
            plan around; a jagged line is a variable distribution that can't be budgeted.
          </li>
          <li>
            <strong>Read it against the total return chart above.</strong> A rising yield on cost
            paired with a falling total return usually means distributions are being funded out of
            capital rather than earnings — the income looks better while the asset shrinks.
          </li>
        </ul>
      </div>
    </details>
  )

  if (!built.length) {
    return (
      <>
        {help}
        <div className={emptyClassName}>
          No distributions in this window, so there is no yield on cost to chart.
          Widen the date range or pick an income-paying fund.
        </div>
      </>
    )
  }

  return (
    <>
      {help}
      <Plot
        data={chart.data}
        layout={themedPlotlyLayout(chart.layout, isDark, { surface: true })}
        config={{ responsive: true, displayModeBar: false }}
        useResizeHandler
        style={{ width: '100%', height }}
      />
      <div className="yoc-basis-row">
        {built.map(({ symbol, color, yoc }) => (
          <span key={symbol} className="yoc-basis" title={`Annualized ${formatMoney(yoc.annual)}/share — ${yoc.basis}`}>
            <span className="etfc-series-swatch" style={{ background: color }} />
            {symbol} cost {formatMoney(yoc.cost)} on {yoc.costDate} → <strong>{yoc.yieldPct.toFixed(2)}%</strong>
          </span>
        ))}
      </div>
    </>
  )
}
