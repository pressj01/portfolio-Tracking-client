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
  // Which reading leads in the help: 'growth' for the stock comparer,
  // 'income' for the ETF comparer. Both always appear.
  emphasis = null,
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
    const lows = built.map(e => e.yoc.visibleMin).filter(v => Number.isFinite(v) && v > 0)
    const highs = built.map(e => e.yoc.visibleMax).filter(Number.isFinite)
    const visibleLow = lows.length ? Math.min(...lows) : null
    const visibleHigh = highs.length ? Math.max(...highs) : null
    // Same 50x trigger the return chart uses. A decades-long dividend grower
    // spans three orders of magnitude against a split-adjusted cost — JNJ from
    // 1962 runs 1% to over 2000% — which on a linear axis pins sixty years flat
    // against the baseline and then spikes. Log makes constant growth a
    // straight line, so the slope really is the dividend growth rate.
    const logScale = visibleLow != null && visibleHigh != null
      && visibleHigh / visibleLow >= 50
    let yAxisRange = null
    if (logScale) {
      const lo = Math.log10(visibleLow)
      const hi = Math.log10(visibleHigh)
      const pad = Math.max((hi - lo) * 0.08, 0.04)
      yAxisRange = [lo - pad, hi + pad]
    } else if (visibleHigh != null) {
      yAxisRange = [0, visibleHigh * 1.08 || 1]
    }
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
        title: { text: logScale ? 'Yield on Cost (%) (log scale)' : 'Yield on Cost (%)' },
        type: logScale ? 'log' : 'linear',
        ticksuffix: '%',
        tickformat: logScale ? (visibleHigh >= 100 ? ',.0f' : ',.2f') : ',.2f',
        // tozero is meaningless on a log axis (log 0 is undefined).
        ...(logScale ? {} : { rangemode: 'tozero' }),
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
  const growthReading = (
    <React.Fragment key="growth">
      <p><strong>Reading it as a dividend grower</strong> (most stocks, funds like SCHD or DGRO):</p>
      <ul>
        <li>
          <strong>The slope is the dividend growth rate.</strong> Cost is fixed, so price movement
          is stripped out and what's left is purely how fast the payout compounds. A company
          raising about 8% a year draws a visibly climbing line.
        </li>
        <li>
          <strong>You want a steady climb.</strong> Flat means the payout isn't growing and the
          whole case rests on price. Over a long window the compounding is the point — this is how
          a decades-held position ends up yielding many times what it did on day one.
        </li>
        <li>
          <strong>One step a year is the right shape</strong> for a stock that raises annually.
          Sparse steps are the cadence, not a defect.
        </li>
      </ul>
    </React.Fragment>
  )
  const incomeReading = (
    <React.Fragment key="income">
      <p><strong>Reading it as a high-yield payer</strong> (option-income funds, BDCs, CEFs):</p>
      <ul>
        <li>
          <strong>Flat or gently rising is healthy.</strong> The payout is holding against your
          cost. Here growth matters less than the payout simply not decaying.
        </li>
        <li>
          <strong>Falling is the warning.</strong> Income per share is shrinking. This is exactly
          what the quoted yield hides: a fund paying a set percentage of a declining NAV keeps
          advertising the same yield while the cash you actually receive drops.
        </li>
        <li>
          <strong>Read it against the total return chart above.</strong> A rising yield on cost
          paired with a falling total return usually means distributions are being funded out of
          capital rather than earnings — the income looks better while the asset shrinks.
        </li>
      </ul>
    </React.Fragment>
  )
  const readings = emphasis === 'growth'
    ? [growthReading, incomeReading]
    : [incomeReading, growthReading]

  const help = (
    <details className="yoc-help">
      <summary>How to read this chart</summary>
      <div className="yoc-help-body">
        <p>
          <strong>What it graphs.</strong> Each ticker's current annualized distribution divided by
          its share price at the <em>start of the charted window</em> — the yield you would be
          earning today had you bought on that date and held. The line steps whenever a new
          distribution changes the run rate and is flat between payments. Because the cost is the
          window's first close, changing the period or the dates re-prices every line: on{' '}
          <strong>MAX</strong> all tickers share one start date so they compare directly, while on{' '}
          <strong>ALL</strong> each uses its own inception price.
        </p>
        {/* Both readings always show: the wrapper doesn't decide which applies.
            A stock can be a non-growing high yielder and an ETF can be a
            dividend grower, so emphasis only sets which one leads. */}
        {readings}
        <p className="yoc-help-caveat">
          <strong>One caveat.</strong> Yield on cost is not a return measure. The opportunity cost
          of the money in a position is what it is worth <em>now</em>, not what it cost at the
          start of the window — a holding showing 12% on cost while yielding 3% today is earning
          3% on the capital tied up in it. Use this chart to judge how a payout is developing, and
          the total return chart to judge the investment.
        </p>
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
