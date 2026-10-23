import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProfileFetch } from '../context/ProfileContext'
import Plot from '../components/ThemedPlot'
import { NavLagNote } from '../components/NavFinding'
import '../components/NavAssessment.css'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'
import { isNavLag, navPercent, NAV_LAG_EXPLAINER } from '../utils/navAssessment'
import { NAV_BENCHMARK_CHOICES } from '../utils/navBenchmarks'
import { todayInputValue } from '../utils/performancePeriods'

function fmt$(v) {
  return formatMoney(v)
}
function fmt4(v) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtAbs4(v) {
  return Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtAbsPct(v) {
  return Math.abs(v).toFixed(2) + '%'
}
function fmtPoints(v) {
  return v == null ? '—' : `${(Math.abs(v) * 100).toFixed(1)} pts`
}

function shareGapPct(deficit, breakevenShares) {
  return breakevenShares ? (deficit / breakevenShares) * 100 : 0
}

function shareGapKind(deficit) {
  if (deficit > 0) return 'needed'
  if (deficit < 0) return 'extra'
  return 'at break-even'
}

function StatTile({ label, value, color, subtext, explanation }) {
  return (
    <div
      className="ne-stat-tile"
      title={explanation || undefined}
      aria-label={explanation ? `${label}: ${explanation}` : undefined}
      style={explanation ? { cursor: 'help' } : undefined}
    >
      <div className="ne-stat-val" style={{ color }}>{value}</div>
      <div className="ne-stat-lbl">
        {label}{explanation && <span aria-hidden="true" style={{ marginLeft: 4, opacity: 0.8 }}>ⓘ</span>}
      </div>
      {subtext && <div className="ne-stat-lbl" style={{ marginTop: 1 }}>{subtext}</div>}
    </div>
  )
}

const FINDING_BOX_TONES = ['neg', 'warn', 'lag']

export default function NavErosion() {
  const pf = useProfileFetch()
  // Per-instance ids: Split View can mount this page in both panes, and a
  // label or datalist pointing at a repeated id resolves to the other pane's
  // field.
  const uid = useId()
  const { isDark } = useTheme()
  const [searchParams] = useSearchParams()
  const requestedTicker = (searchParams.get('ticker') || '').trim().toUpperCase()
  const [ticker, setTicker] = useState(requestedTicker)
  const [benchmark, setBenchmark] = useState(() => (searchParams.get('benchmark') || '').trim().toUpperCase())
  const [amount, setAmount] = useState(() => searchParams.get('amount') || '10000')
  const [startDate, setStartDate] = useState(() => searchParams.get('start') || '2023-01-01')
  const [endDate, setEndDate] = useState(() => searchParams.get('end') || todayInputValue())
  const [reinvest, setReinvest] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [assessment, setAssessment] = useState(null)
  const [figData, setFigData] = useState(null)
  const [figLayout, setFigLayout] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const autoRunTickerRef = useRef('')

  const runBacktest = useCallback(() => {
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setError(null)
    setWarning(null)
    setRows([])
    setSummary(null)
    setAssessment(null)
    setFigData(null)
    setFigLayout(null)

    const params = new URLSearchParams({
      ticker: sym, amount, start: startDate, end: endDate, reinvest: String(reinvest)
    })
    if (benchmark.trim()) params.set('benchmark', benchmark.trim().toUpperCase())

    pf('/api/nav-erosion/data?' + params.toString())
      .then(r => r.json())
      .then(data => {
        setLoading(false)
        if (data.error) { setError(data.error); return }
        if (data.warning) setWarning(data.warning)
        setRows(data.rows || [])
        setSummary(data.summary || null)
        setAssessment(data.assessment || null)
        if (data.fig_json) {
          try {
            const fig = JSON.parse(data.fig_json)
            setFigData(fig.data)
            setFigLayout(fig.layout)
          } catch { /* ignore */ }
        }
      })
      .catch(err => {
        setLoading(false)
        setError('Request failed: ' + err.message)
      })
  }, [amount, benchmark, endDate, pf, reinvest, startDate, ticker])

  useEffect(() => {
    if (!requestedTicker || autoRunTickerRef.current === requestedTicker) return
    autoRunTickerRef.current = requestedTicker
    runBacktest()
  }, [requestedTicker, runBacktest])

  // Sorting
  const colKeys = ['date', 'price', 'price_delta_pct', 'benchmark_price', 'benchmark_delta_pct', 'div_per_share', 'total_dist',
    'reinvested', 'shares_bought', 'total_shares', 'portfolio_val', 'breakeven_sh', 'shares_deficit',
    'reference_return', 'same_cash_gap_rate', 'erosion_month']

  const sorted = useMemo(() => {
    const arr = [...rows]
    if (sortCol !== null) {
      const key = colKeys[sortCol]
      arr.sort((a, b) => {
        let aV = a[key] ?? '', bV = b[key] ?? ''
        if (key === 'date') { aV = a.month_end; bV = b.month_end }
        if (typeof aV === 'boolean') aV = aV ? 1 : 0
        if (typeof bV === 'boolean') bV = bV ? 1 : 0
        if (typeof aV === 'number' && typeof bV === 'number')
          return sortAsc ? aV - bV : bV - aV
        return sortAsc ? String(aV).localeCompare(String(bV)) : String(bV).localeCompare(String(aV))
      })
    }
    return arr
  }, [rows, sortCol, sortAsc])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }
  const arrow = (col) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : ''

  const s = summary || {}
  const refName = s.benchmark || 'Reference'
  const headers = ['Date', 'Price', 'Monthly Δ%', `${refName} Price`, `${refName} Δ%`, 'Div / Share', 'Total Dist',
    'Reinvested', 'Shares Bought', 'Total Shares', 'Portfolio Value', 'Break-Even Shares', 'Shares Needed / Extra To Breakeven',
    `${refName} Total Return`, `Capital vs ${refName}`, 'Erosion Month?']

  const finding = assessment?.finding
  const price = assessment?.price_screen?.status === 'available' ? assessment.price_screen : null
  const lag = price?.nav_lag
  const persistence = price?.persistence
  const refResult = price?.reference_result
  const metrics = assessment?.metrics
  const finalRow = rows.length ? rows[rows.length - 1] : null
  const finalGapPct = finalRow ? shareGapPct(s.final_deficit || 0, finalRow.breakeven_sh || 0) : 0

  return (
    <div className="ne-page">
      <h1 style={{ marginBottom: '0.3rem' }}>NAV Erosion Back-Tester</h1>
      <p className="ne-desc">
        Back-tests one fund with the same NAV check the Dashboard uses, so a fund shows the same result here, on the Dashboard and
        in the NAV Erosion Screener for the same dates and reference. The check compares the fund with a reference that pays out
        the same cash on the same dates, and looks for months when the fund&apos;s price fell while the reference was flat or up.
        A covered-call fund whose price only trailed its underlying is marked <strong>NAV lag — not erosion</strong>.
        Cash distributions that are not reinvested are included in Ending Wealth and Investor Total Return.
        <br />
        <span style={{ color: 'var(--accent-bright)' }}>Blue line</span> = fund share price &nbsp;&middot;&nbsp;
        <span style={{ color: '#ffb74d' }}>Orange dotted</span> = the reference&apos;s price, scaled to the fund&apos;s starting price &nbsp;&middot;&nbsp;
        <span style={{ color: 'var(--pos-bright)' }}>Green line</span> = portfolio value &nbsp;&middot;&nbsp;
        <span style={{ color: 'var(--p-888)' }}>Dashed gray</span> = initial investment (break-even)
        <br /><br />
        <strong style={{ color: 'var(--p-ccc)' }}>Shares Needed / Extra To Breakeven</strong> compares your shares held to break-even shares
        (Initial Investment &divide; Current Price).
        <span style={{ color: 'var(--neg-3)', fontWeight: 600 }}> Red needed</span> means you are short that many shares.
        <span style={{ color: 'var(--pos-strong)', fontWeight: 600 }}> Green extra</span> means you have that many shares above break-even.
      </p>

      {/* Input form */}
      <div className="ne-form">
        <div className="ne-field">
          <label className="ne-label">Ticker</label>
          <input
            className="ne-input"
            style={{ width: 90, textTransform: 'uppercase' }}
            placeholder="e.g. JEPI"
            maxLength={10}
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && runBacktest()}
          />
        </div>
        <div className="ne-field">
          <label className="ne-label">Initial Investment ($)</label>
          <input
            className="ne-input"
            type="number"
            min="1"
            step="100"
            style={{ width: 130 }}
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>
        <div className="ne-field">
          <label className="ne-label">Reference (optional)</label>
          <input
            className="ne-input"
            style={{ width: 130, textTransform: 'uppercase' }}
            placeholder="Dashboard's"
            maxLength={20}
            list={`${uid}-ne-benchmark-choices`}
            value={benchmark}
            onChange={e => setBenchmark(e.target.value.toUpperCase())}
            title="Leave blank to use the same reference the Dashboard uses for this fund. A ticker typed here applies to this back-test only."
          />
          <datalist id={`${uid}-ne-benchmark-choices`}>
            {NAV_BENCHMARK_CHOICES.map(b => <option key={b} value={b} />)}
          </datalist>
        </div>
        <div className="ne-field">
          <label className="ne-label">Start Date</label>
          <input
            className="ne-input"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div className="ne-field">
          <label className="ne-label">End Date</label>
          <input
            className="ne-input"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
        <div className="ne-field" style={{ minWidth: 180 }}>
          <label className="ne-label">
            Reinvest %: <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>{reinvest}%</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <input
              type="range"
              min="0"
              max="100"
              value={reinvest}
              step="1"
              style={{ flex: 1, accentColor: 'var(--accent-bright)' }}
              onChange={e => setReinvest(Number(e.target.value))}
            />
            <input
              className="ne-input"
              type="number"
              min="0"
              max="100"
              step="1"
              style={{ width: 64, textAlign: 'center' }}
              value={reinvest}
              onChange={e => setReinvest(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            />
          </div>
        </div>
        <button className="ne-run-btn" onClick={runBacktest} disabled={loading}>
          Run Backtest
        </button>
      </div>

      {/* Spinner */}
      {loading && (
        <div className="wl-spinner">
          <div className="wl-spin-circle" />
          <p>Fetching price data &amp; calculating&hellip;</p>
        </div>
      )}

      {/* Error */}
      {error && <div className="wl-error">{error}</div>}

      {/* Warning */}
      {warning && (
        <div className="ne-warning">&#9888;&nbsp;{warning}</div>
      )}

      {/* The shared NAV result for this fund */}
      {finding && !loading && (
        <div className={`nav-finding${FINDING_BOX_TONES.includes(finding.tone) ? ` nav-finding-${finding.tone}` : ''}`} role="status">
          <strong>{finding.label}</strong>
          <p>{finding.reason}</p>
          {isNavLag(finding) && <p className="nav-assessment-note">{NAV_LAG_EXPLAINER}</p>}
          <p className="nav-assessment-note">
            {metrics ? 'Checked against the fund’s published NAV and its market prices.' : 'Checked with market prices; the fund’s published NAV is not available to verify it.'}
            {price && ` Dates checked: ${price.start} to ${price.end}.`}
            {' '}The Dashboard and the NAV Erosion Screener show this same result for these dates and this reference.
          </p>
        </div>
      )}

      {/* Summary strip */}
      {summary && !loading && (
        <div className="ne-summary">
          <StatTile
            label="Reference"
            value={s.benchmark || '—'}
            color="#ffb74d"
            subtext={s.benchmark_source}
            explanation={assessment?.reference?.why || 'The fund the check compares with.'}
          />
          <StatTile
            label={`${refName} Price Change`}
            value={s.benchmark_return_pct != null ? fmtPct(s.benchmark_return_pct) : '—'}
            color={s.benchmark_return_pct < 0 ? '#e05555' : '#00c853'}
            explanation="The reference's closing-price change over these dates, without its dividends. This is context, not a score for the fund."
          />
          <StatTile
            label="Fund Price Change"
            value={fmtPct(s.price_chg_pct || 0)}
            color={s.price_chg_pct < 0 ? '#e05555' : '#00c853'}
            subtext={s.actual_start && s.actual_end ? `${s.actual_start} to ${s.actual_end}` : null}
            explanation="The fund's share-price change, with distributions not added back."
          />
          <StatTile
            label="NAV Lag"
            value={lag?.status === 'lag' || lag?.status === 'none' ? fmtPoints(lag.lag_rate) : '—'}
            color={isNavLag(finding) ? 'var(--accent-2)' : 'var(--text-dim)'}
            subtext={isNavLag(finding) ? 'behind the reference price · not erosion'
              : lag?.status === 'none' ? 'under 1 point · not marked'
                : lag?.status === 'superseded' ? 'erosion shown instead'
                  : 'covered-call funds only'}
            explanation={NAV_LAG_EXPLAINER}
          />
          <StatTile
            label={`Capital vs ${refName}`}
            value={refResult?.status === 'available' ? navPercent(refResult.capital_gap_rate) : '—'}
            color={refResult?.capital_gap_rate < 0 ? '#e05555' : '#00c853'}
            subtext="after paying the same cash"
            explanation="How much more or less capital the fund kept than the reference would have, if the reference had paid out the fund's same distributions on the same dates. Negative means the fund kept less."
          />
          <StatTile
            label="Paid Out"
            value={price ? navPercent(price.distribution_rate_on_start) : '—'}
            color="#7ecfff"
            subtext="distributions ÷ starting price"
            explanation="Cash paid per share over these dates, as a share of the starting price. A high payout alone is not erosion."
          />
          <StatTile
            label="Erosion Months"
            value={persistence ? `${persistence.qualifying_intervals} of ${persistence.supportive_intervals}` : '—'}
            color={persistence?.qualifying_intervals > 0 ? '#ffb300' : '#00c853'}
            subtext={`months ${refName} was flat or up`}
            explanation="Completed calendar months when the reference was flat or up but the fund's price fell and it kept less capital than the reference after paying the same cash. Erosion needs this to repeat."
          />
          <StatTile
            label="Strategy"
            value={price?.strategy?.label || assessment?.guidance?.screen_strategy?.label || '—'}
            color="var(--text)"
            explanation="Only funds that sell call options can be labelled covered-call eroders or show NAV lag. Correct it under Details on the Dashboard."
          />
          <StatTile
            label="Published NAV"
            value={metrics ? navPercent(metrics.capital_change_rate) : 'Not verified'}
            color={metrics ? (metrics.capital_change_rate < 0 ? '#e05555' : '#00c853') : 'var(--text-dim)'}
            subtext={metrics ? `${assessment.window_start} to ${assessment.window_end}` : null}
            explanation={metrics ? 'Change in the fund’s published NAV per share over these dates.' : (assessment?.reason || 'No published NAV source for this fund.')}
          />
          <StatTile label="Total Distributions" value={fmt$(s.total_dist || 0)} color="#7ecfff" explanation="All cash distributions generated by the simulated shares." />
          <StatTile label="Shares Purchased" value={fmt4(s.total_shares_bought || 0)} color="#7ecfff" explanation="Additional shares bought with reinvested distributions." />
          <StatTile label="Total Reinvested" value={fmt$(s.total_reinvested || 0)} color="#7ecfff" explanation="Distribution cash used to buy more shares. This is not a new contribution." />
          <StatTile label="Cash Taken" value={fmt$(s.cash_taken || 0)} color="#7ecfff" explanation="Distributions received as cash instead of reinvested. Ending wealth includes this amount." />
          <StatTile label="Ending Shares Value" value={fmt$(s.final_value || 0)} color="#00e89a" explanation="Market value of all ending shares, including shares bought through reinvestment. Excludes cash taken." />
          <StatTile label="Ending Wealth" value={fmt$(s.ending_wealth || 0)} color="#00e89a" subtext="shares value + cash taken" explanation="Ending shares value plus distributions taken as cash." />
          <StatTile label="Investor Total Return" value={fmtPct(s.total_return_pct || 0)} color={s.total_return_pct < 0 ? '#e05555' : '#00c853'} explanation="Gain or loss on the initial investment after including ending shares and cash distributions." />
          <StatTile
            label={s.final_deficit > 0 ? 'Final Shares Needed' : s.final_deficit < 0 ? 'Final Extra Shares' : 'Final Share Gap'}
            value={`${fmtAbs4(s.final_deficit || 0)} (${fmtAbsPct(finalGapPct)})`}
            color={s.final_deficit > 0 ? '#e05555' : s.final_deficit < 0 ? '#00c853' : '#7ecfff'}
            subtext={s.final_deficit > 0 ? 'capital-only gap; cash excluded' : s.final_deficit < 0 ? 'above capital break-even' : 'at capital break-even'}
            explanation="Break-even shares minus shares actually held at the ending price. This excludes cash taken, so it is not the same as total return, and it is not an erosion test."
          />
        </div>
      )}
      {isNavLag(finding) && !loading && <NavLagNote />}

      {/* Chart */}
      {figData && figLayout && !loading && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Plot
            data={figData}
            layout={themedPlotlyLayout({ ...figLayout, autosize: true }, isDark)}
            useResizeHandler
            style={{ width: '100%', height: 420 }}
            config={{ responsive: true }}
          />
        </div>
      )}

      {/* Monthly detail table */}
      {rows.length > 0 && !loading && (
        <>
          <h2 className="ne-table-title">
            Monthly Detail
            <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--p-666)' }}>&nbsp;&mdash; click any header to sort</span>
          </h2>
          <div className="ne-tbl-outer">
            <table className="sst" id="ne-tbl">
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const cls = i === 0 ? 'ne-date-col' : ([3, 5, 9, 11, 13].includes(i) ? 'grp-left' : '')
                    return (
                      <th key={h} className={cls} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>
                        {h}{arrow(i)}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const pctCls = r.price_delta_pct < 0 ? 'pct-down' : (r.price_delta_pct > 0 ? 'pct-up' : '')
                  const benchPctCls = r.benchmark_delta_pct < 0 ? 'pct-down' : (r.benchmark_delta_pct > 0 ? 'pct-up' : '')
                  const defCls = r.shares_deficit > 0 ? 'ne-deficit' : 'ne-surplus'
                  const gapPct = shareGapPct(r.shares_deficit, r.breakeven_sh)
                  const gapKind = shareGapKind(r.shares_deficit)
                  return (
                    <tr key={r.month_end}>
                      <td className="ne-date-col"><strong>{r.date}</strong></td>
                      <td>{fmt$(r.price)}</td>
                      <td className={pctCls}>{fmtPct(r.price_delta_pct)}</td>
                      <td className="grp-left">{r.benchmark_price != null ? fmt$(r.benchmark_price) : '—'}</td>
                      <td className={benchPctCls}>{r.benchmark_delta_pct != null ? fmtPct(r.benchmark_delta_pct) : '—'}</td>
                      <td className="grp-left">{r.div_per_share > 0 ? fmt$(r.div_per_share) : '—'}</td>
                      <td>{fmt$(r.total_dist)}</td>
                      <td>{fmt$(r.reinvested)}</td>
                      <td>{fmt4(r.shares_bought)}</td>
                      <td className="grp-left">{fmt4(r.total_shares)}</td>
                      <td>{fmt$(r.portfolio_val)}</td>
                      <td className="grp-left">{fmt4(r.breakeven_sh)}</td>
                      <td
                        className={defCls}
                        title={`Break-even shares minus total shares held: ${fmt4(r.shares_deficit)} (${fmtPct(gapPct)})`}
                      >
                        {fmtAbs4(r.shares_deficit)} {gapKind} <span style={{ opacity: 0.8 }}>({fmtAbsPct(gapPct)})</span>
                      </td>
                      <td className="grp-left" title="The reference's total return in this completed month, including its dividends.">{navPercent(r.reference_return)}</td>
                      <td title="Capital the fund kept versus the reference after paying the same cash in this month. Negative means it kept less." style={{ color: r.same_cash_gap_rate < 0 ? 'var(--neg-3)' : undefined }}>{navPercent(r.same_cash_gap_rate)}</td>
                      <td title="Yes when the reference was flat or up but the fund's price fell and it kept less capital than the reference. One month is not erosion; it has to repeat.">
                        {r.erosion_month == null ? <span style={{ color: 'var(--p-666)' }}>{'—'}</span>
                          : r.erosion_month ? <span style={{ color: 'var(--neg-3)', fontWeight: 700 }}>{r.paid_above_reference ? 'Yes · paid more than earned' : 'Yes'}</span>
                            : <span style={{ color: 'var(--pos-strong)' }}>No</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="nav-assessment-note">
            {'—'} in the last three columns means the month was not a complete calendar month in these dates, or the reference had no data.
          </p>
        </>
      )}
    </div>
  )
}
