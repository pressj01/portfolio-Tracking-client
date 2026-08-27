import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { formatMoney } from '../utils/money'
import { NAV_BENCHMARK_CHOICES } from '../utils/navBenchmarks'

const MAX_ROWS = 80

function fmt$(v) {
  return formatMoney(v, { zeroIfInvalid: true })
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + parseFloat(v).toFixed(2) + '%'
}
function fmtRate(v) {
  return v == null ? '\u2014' : fmtPct(Number(v) * 100)
}
function fmtAbs4(v) {
  return Math.abs(parseFloat(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtAbsPct(v) {
  return Math.abs(parseFloat(v || 0)).toFixed(2) + '%'
}
function shareGapPct(deficit, amount, endPrice) {
  const breakevenShares = endPrice > 0 ? amount / endPrice : 0
  return breakevenShares ? (deficit / breakevenShares) * 100 : 0
}
function shareGapKind(deficit) {
  if (deficit > 0) return 'needed'
  if (deficit < 0) return 'extra'
  return 'at breakeven'
}
function navSeverityFromRatio(v) {
  if (v == null) return null
  return v > 0.75 ? 'High' : v > 0.25 ? 'Medium' : 'Low'
}
function navSeverityColor(severity) {
  return severity === 'High' ? '#e05555' : severity === 'Medium' ? '#ffb300' : severity === 'Low' ? '#00c853' : '#666'
}
function navSeverityText(severity, portfolio = false) {
  const scope = portfolio ? 'Portfolio Benchmark-Gated Coverage' : 'Benchmark-Gated Coverage'
  return severity === 'High' ? `High ${scope}` : severity === 'Medium' ? `Moderate ${scope}` : `Low ${scope}`
}

function overallNavMetrics(rawErosion, distributionRate, coverage, relativeDragPct) {
  if (rawErosion == null || !Number.isFinite(Number(rawErosion))) return { score: null, severity: null, rawGap: null }
  const e = Number(rawErosion)
  const d = Number(distributionRate) || 0
  if (e <= 0) return { score: 0, severity: 'Low', rawGap: d > 0 ? 0 : null }
  const rawGap = d > 0 ? e / d : null
  const components = [Math.max(0, Number(coverage) || 0), e / 0.5, Math.max(0, Number(relativeDragPct) || 0) / 50]
  if (rawGap != null) components.push(Math.max(0, rawGap))
  const score = Math.min(100, Math.max(...components) * 100)
  return { score, severity: score > 75 ? 'High' : score > 25 ? 'Medium' : 'Low', rawGap }
}

function StatTile({ label, value, color, sub, explanation }) {
  return (
    <div
      className="nep-stat-tile"
      title={explanation || undefined}
      aria-label={explanation ? `${label}: ${explanation}` : undefined}
      style={explanation ? { cursor: 'help' } : undefined}
    >
      <div className="nep-stat-val" style={{ color }}>{value}</div>
      <div className="nep-stat-lbl">{label}{explanation && <span aria-hidden="true" style={{ marginLeft: 4, opacity: 0.8 }}>ⓘ</span>}</div>
      {sub && <div className="nep-stat-sub">{sub}</div>}
    </div>
  )
}

export default function NavErosionPortfolio() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const dialog = useDialog()
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2025-12-31')
  const [gridRows, setGridRows] = useState([{ ticker: '', amount: '', reinvest_pct: '', benchmark: '' }])
  const [savedList, setSavedList] = useState([])
  const [selectedSaved, setSelectedSaved] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [savedMsg, setSavedMsg] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState(false)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  // Save backtest form
  const [btFormOpen, setBtFormOpen] = useState(false)
  const [btName, setBtName] = useState('')
  const [btOverwrite, setBtOverwrite] = useState(true)
  const [btError, setBtError] = useState(null)

  // Load saved backtests on mount/profile changes.
  const loadSavedList = useCallback(() => {
    pf('/api/nav-erosion-portfolio/saved')
      .then(r => r.json())
      .then(d => setSavedList(d.saved || []))
      .catch(() => {})
  }, [pf])

  const loadSavedEtfList = useCallback(() => {
    return pf('/api/nav-erosion-portfolio/list')
      .then(r => r.json())
      .then(d => {
        if (d.rows && d.rows.length > 0) {
          const rows = d.rows.map(r => ({
            ticker: r.ticker,
            amount: String(r.amount),
            reinvest_pct: String(r.reinvest_pct),
            benchmark: r.benchmark || '',
          }))
          setGridRows(rows)
          return rows
        }
        return null
      })
      .catch(() => null)
  }, [pf])

  useEffect(() => { loadSavedList() }, [loadSavedList, selection])

  const updateRow = (idx, field, value) => {
    setGridRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const removeRow = (idx) => {
    setGridRows(prev => prev.filter((_, i) => i !== idx))
  }

  const addRow = () => {
    if (gridRows.length >= MAX_ROWS) return
    setGridRows(prev => [...prev, { ticker: '', amount: '', reinvest_pct: '', benchmark: '' }])
  }

  const clearGrid = () => {
    setGridRows([{ ticker: '', amount: '', reinvest_pct: '', benchmark: '' }])
    // Also clear the persisted list
    pf('/api/nav-erosion-portfolio/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [] }),
    })
  }

  // Filter out empty rows (no ticker entered)
  const collectRows = (src) => src
    .map(r => ({
      ticker: r.ticker.trim().toUpperCase(),
      amount: parseFloat(r.amount) || 0,
      reinvest_pct: parseFloat(r.reinvest_pct) || 0,
      benchmark: String(r.benchmark || '').trim().toUpperCase(),
    }))
    .filter(r => r.ticker)

  const saveList = useCallback(() => {
    const rows = collectRows(gridRows)
    return pf('/api/nav-erosion-portfolio/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return false }
        setSavedMsg(true)
        setTimeout(() => setSavedMsg(false), 2500)
        return true
      })
  }, [gridRows])

  const loadSaved = async () => {
    if (!selectedSaved) return
    try {
      const r = await pf('/api/nav-erosion-portfolio/saved/' + selectedSaved)
      const d = await r.json()
      if (d.error) { await dialog.alert(d.error); return }
      if (d.start) setStartDate(d.start)
      if (d.end) setEndDate(d.end)
      const rows = (d.rows || []).map(r => ({
        ticker: r.ticker || '',
        amount: String(r.amount || ''),
        reinvest_pct: String(r.reinvest_pct || ''),
        benchmark: r.benchmark || '',
      }))
      setGridRows(rows.length > 0 ? rows : [{ ticker: '', amount: '', reinvest_pct: '', benchmark: '' }])
      setResults(null)
    } catch (err) {
      await dialog.alert('Load failed: ' + err.message)
    }
  }

  const deleteSaved = async () => {
    if (!selectedSaved) return
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    if (!await dialog.confirm('Delete saved backtest "' + (sel?.name || '') + '"?')) return
    const r = await pf('/api/nav-erosion-portfolio/saved/' + selectedSaved, { method: 'DELETE' })
    const d = await r.json()
    if (d.error) { await dialog.alert(d.error); return }
    setDeleteMsg(true)
    setTimeout(() => setDeleteMsg(false), 2000)
    setSelectedSaved('')
    loadSavedList()
  }

  const showSaveBtForm = () => {
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    setBtName(sel ? sel.name : '')
    setBtOverwrite(!!selectedSaved)
    setBtError(null)
    setBtFormOpen(true)
  }

  const confirmSaveBt = () => {
    const name = btName.trim()
    if (!name) { setBtError('Please enter a name.'); return }
    const rows = collectRows(gridRows)
    const overwrite = btOverwrite && !!selectedSaved
    const url = overwrite ? `/api/nav-erosion-portfolio/saved/${selectedSaved}` : `/api/nav-erosion-portfolio/saved`
    const method = overwrite ? 'PUT' : 'POST'

    pf(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, start: startDate, end: endDate, rows }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setBtError(d.error); return }
        const savedId = overwrite ? selectedSaved : String(d.id)
        setBtFormOpen(false)
        setBtName('')
        loadSavedList()
        setTimeout(() => setSelectedSaved(savedId), 300)
      })
      .catch(err => setBtError('Save failed: ' + err.message))
  }

  const runBacktestForRows = useCallback((rowsForRun, { persist = true } = {}) => {
    setError(null)
    setResults(null)
    setLoading(true)

    const rows = collectRows(rowsForRun)
    if (!rows.length) {
      setLoading(false)
      setError('No ETFs provided.')
      return
    }

    const savePromise = persist ? pf('/api/nav-erosion-portfolio/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    }) : Promise.resolve()

    savePromise.then(() => {
      pf('/api/nav-erosion-portfolio/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startDate, end: endDate, rows }),
      })
        .then(r => r.json())
        .then(data => {
          setLoading(false)
          if (data.error) { setError(data.error); return }
          setResults(data.results || [])
        })
        .catch(err => {
          setLoading(false)
          setError('Request failed: ' + err.message)
        })
    })
  }, [pf, startDate, endDate])

  const runBacktest = () => {
    runBacktestForRows(gridRows)
  }

  useEffect(() => {
    let cancelled = false

    // On open: silently upsert the live portfolio into a single "My Current
    // Portfolio" saved backtest and load it into the grid. We do NOT auto-run
    // the backtest — the user runs it on demand from the Saved Backtests list.
    const loadCurrentPortfolio = async () => {
      try {
        const r = await pf('/api/nav-erosion-portfolio/save-current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start: startDate, end: endDate }),
        })
        const d = await r.json()
        if (cancelled) return
        const currentRows = (d.rows || []).map(r => ({
          ticker: r.ticker || '',
          amount: String(r.amount || ''),
          reinvest_pct: String(r.reinvest_pct || ''),
          benchmark: r.benchmark || '',
        }))

        if (currentRows.length > 0) {
          setGridRows(currentRows)
          setResults(null)
          loadSavedList()
          if (d.id != null) setSelectedSaved(String(d.id))
          return
        }

        const savedRows = await loadSavedEtfList()
        if (cancelled || !savedRows || savedRows.length === 0) {
          setGridRows([{ ticker: '', amount: '', reinvest_pct: '', benchmark: '' }])
        }
      } catch (err) {
        if (!cancelled) {
          await loadSavedEtfList()
        }
      }
    }

    loadCurrentPortfolio()
    return () => { cancelled = true }
  }, [pf, selection])

  // Sorting results
  const colKeys = ['ticker', 'benchmark', 'amount', 'reinvest_pct', 'start_price', 'end_price',
    'price_delta_pct', 'benchmark_return_pct', 'total_dist', 'total_reinvested', 'cash_taken',
    'final_value', 'ending_wealth', 'gain_loss_dollar', 'gain_loss_pct', 'total_return_dollar',
    'total_return_pct', 'has_erosion', 'confirmed_erosion_months', 'final_deficit',
    'raw_nav_erosion_rate', 'distribution_rate_on_starting_nav', 'accounting_total_return_rate',
    'coverage_ratio', 'warning']

  const sortedResults = useMemo(() => {
    if (!results) return []
    const arr = [...results]
    if (sortCol !== null) {
      const key = colKeys[sortCol]
      arr.sort((a, b) => {
        let aV = a[key] ?? '', bV = b[key] ?? ''
        if (key === 'has_erosion') { aV = aV ? 1 : 0; bV = bV ? 1 : 0 }
        if (typeof aV === 'number' && typeof bV === 'number')
          return sortAsc ? aV - bV : bV - aV
        return sortAsc ? String(aV).localeCompare(String(bV)) : String(bV).localeCompare(String(aV))
      })
    }
    return arr
  }, [results, sortCol, sortAsc])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }
  const arrow = (col) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  // Summary
  const summary = useMemo(() => {
    if (!results || results.length === 0) return null
    let totAmount = 0, totDist = 0, totReinv = 0, totCash = 0, totFinal = 0, totWealth = 0, totGL = 0, totTR = 0
    let erosionCount = 0, deficitCount = 0, validCount = 0, errorCount = 0
    let benchmarkReturnWeighted = 0, relativeDragWeighted = 0, returnWeight = 0
    let rawErosionWeighted = 0, distributionRateWeighted = 0, accountingReturnWeighted = 0, accountingWeight = 0
    let best = null, worst = null
    let confirmedLossDollars = 0, distributionDollars = 0
    results.forEach(r => {
      if (r.error && !r.start_price) { errorCount++; return }
      validCount++
      totAmount += r.amount || 0
      totDist += r.total_dist || 0
      totReinv += r.total_reinvested || 0
      totCash += r.cash_taken || 0
      totFinal += r.final_value || 0
      totWealth += r.ending_wealth ?? ((r.final_value || 0) + (r.cash_taken || 0))
      totGL += r.gain_loss_dollar || 0
      totTR += r.total_return_dollar || 0
      if (r.has_erosion) erosionCount++
      if (r.has_price_deficit) deficitCount++
      if (r.benchmark_return_pct != null) {
        benchmarkReturnWeighted += r.benchmark_return_pct * (r.amount || 0)
        relativeDragWeighted += (r.relative_drag_pct || 0) * (r.amount || 0)
        returnWeight += r.amount || 0
      }
      if (r.raw_nav_erosion_rate != null) {
        const weight = r.amount || 0
        rawErosionWeighted += r.raw_nav_erosion_rate * weight
        distributionRateWeighted += (r.distribution_rate_on_starting_nav || 0) * weight
        accountingReturnWeighted += (r.accounting_total_return_rate || 0) * weight
        accountingWeight += weight
      }
      confirmedLossDollars += r.confirmed_erosion_dollar || 0
      distributionDollars += r.period_distributions_dollar || 0
      if (best === null || r.total_return_pct > best.total_return_pct) best = r
      if (worst === null || r.total_return_pct < worst.total_return_pct) worst = r
    })
    const totGLPct = totAmount > 0 ? totGL / totAmount * 100 : 0
    const aggCoverage = distributionDollars > 0 ? confirmedLossDollars / distributionDollars : null
    const aggSeverity = navSeverityFromRatio(aggCoverage)
    const benchmarkReturnPct = returnWeight > 0 ? benchmarkReturnWeighted / returnWeight : null
    const relativeDragPct = returnWeight > 0 ? relativeDragWeighted / returnWeight : null
    const aggregateRawErosionRate = accountingWeight > 0 ? rawErosionWeighted / accountingWeight : null
    const aggregateDistributionRate = accountingWeight > 0 ? distributionRateWeighted / accountingWeight : null
    const aggregateAccountingReturnRate = accountingWeight > 0 ? accountingReturnWeighted / accountingWeight : null
    const overall = overallNavMetrics(aggregateRawErosionRate, aggregateDistributionRate, aggCoverage, relativeDragPct)
    return {
      totAmount, totDist, totReinv, totCash, totFinal, totWealth, totGL, totTR, totGLPct,
      erosionCount, deficitCount, validCount, errorCount, best, worst, aggCoverage, aggSeverity,
      benchmarkReturnPct, relativeDragPct,
      aggregateRawErosionRate, aggregateDistributionRate, aggregateAccountingReturnRate,
      overallScore: overall.score, overallSeverity: overall.severity, aggregateRawGap: overall.rawGap,
    }
  }, [results])

  const headers = ['Ticker', 'Benchmark', 'Amount', 'Reinvest %', 'Start Price', 'End Price',
    'Price \u0394%', 'Benchmark Return %', 'Total Distributions', 'Total Reinvested', 'Cash Taken',
    'Ending Shares Value', 'Ending Wealth', 'Gain/Loss $', 'Gain/Loss %', 'Total Return $',
    'Total Return %', 'Confirmed Erosion', 'Months', 'Shares Needed / Extra To Breakeven',
    'Raw e / Status', 'Overall Verdict', 'Dist d', 'Total Return r', 'Confirmed Coverage', 'Note']

  return (
    <div className="nep-page">
      <h1 style={{ marginBottom: '0.3rem' }}>Benchmark-Adjusted NAV Erosion Portfolio Screener</h1>
      <p className="ne-desc">
        Compare up to {MAX_ROWS} ETFs side-by-side using the same NAV erosion calculation. Each ETF can have
        its own starting dollar amount and reinvestment percentage. Your list is saved to the database
        and will persist between sessions.
        <br />
        <span style={{ color: 'var(--neg-3)', fontWeight: 600 }}>Confirmed Erosion = Yes</span> means at least one
        month had a fund price loss while its mapped underlying benchmark was flat or rising. This isolates
        fund-specific price decay instead of treating a broad market sell-off as NAV erosion.
        It does not decide whether a fund is a NAV eroder: positive Raw e does that without a benchmark gate.
        <br />
        <span style={{ color: 'var(--neg-3)', fontWeight: 600 }}>Red needed</span> means shares still needed to breakeven.
        <span style={{ color: 'var(--pos-strong)', fontWeight: 600 }}> Green extra</span> means shares above breakeven.
        The benchmark and benchmark return are shown in the results so the comparison is auditable.
        Change a ticker&apos;s benchmark in the input grid (or in the results table) and run the backtest again.
      </p>

      {/* Collapsed-by-default help: how the numbers are computed */}
      <details className="nep-help">
        <summary>How NAV erosion &amp; total return are computed</summary>
        <div className="nep-help-body">
          <section>
            <h4>Confirmed price erosion (Yes / No)</h4>
            <p>
              The screener maps each ETF to an underlying benchmark (for example, BTCI → BTC-USD and QQQI → QQQ).
              The mapping is displayed in the Benchmark column and can be changed per ticker before you run.
              Each month is tested independently: erosion is counted only when the fund price is down and the
              benchmark is flat or up over the same interval.
            </p>
            <p>
              <strong style={{ color: 'var(--neg-3)' }}>Confirmed Erosion = Yes</strong> when at least one such
              month exists. A separate <strong>Shares Needed / Extra To Breakeven</strong> column remains as an
              end-of-period solvency diagnostic; it is not used to label benchmark-confirmed erosion.
            </p>
          </section>

          <section>
            <h4>Raw NAV accounting identity</h4>
            <p>
              Raw erosion does not use the benchmark. Over the selected window, all three values use the same
              starting share price: <strong>e = d − r = (NAV₀ − NAVₜ) ÷ NAV₀</strong>. Positive e means the fund
              is a NAV eroder over the window regardless of benchmark; zero means NAV was flat; negative e means it rose.
            </p>
            <p>
              Distribution rate d is distributions per share ÷ NAV₀. Accounting total return r is
              (NAVₜ − NAV₀ + distributions per share) ÷ NAV₀. Option-overlay P&amp;L and the holdings&apos; price
              move are already reflected in the unadjusted share-price path.
            </p>
            <ul>
              <li><strong>NAV₀</strong> — unadjusted share price at the start of the selected window.</li>
              <li><strong>NAVₜ</strong> — unadjusted share price at the end of the selected window.</li>
              <li><strong>D</strong> — cash distributions paid per share during the selected window.</li>
              <li><strong>d</strong> — D ÷ NAV₀.</li>
              <li><strong>r</strong> — (NAVₜ − NAV₀ + D) ÷ NAV₀.</li>
              <li><strong>e</strong> — d − r. Positive means NAV fell; zero means flat; negative means NAV rose.</li>
            </ul>
          </section>

          <section>
            <h4>NAV Ratio (benchmark-adjusted severity)</h4>
            <p>
              The <strong>Confirmed Erosion Ratio</strong> measures benchmark-confirmed price loss against
              distributions over the same backtest window:
            </p>
            <p className="nep-formula">
              Confirmed Erosion Ratio = confirmed price-loss dollars per share ÷ distributions per share
            </p>
            <ul>
              <li>
                A month contributes to the numerator only when the fund is down and its benchmark is{' '}
                <em>flat or up</em>. If the benchmark is down, that month is treated as market beta and contributes 0.
              </li>
              <li>The denominator is all distributions per share in the selected window, not a mismatched trailing yield.</li>
              <li>
                <strong>Lower is better.</strong> ≤ 0.25 = Low, 0.25–0.75 = Moderate, &gt; 0.75 = High.
              </li>
            </ul>
            <p>
              The <strong>Portfolio Confirmed Erosion Ratio</strong> tile is total confirmed price-loss dollars divided
              by total distributions across the holdings that have distributions. This benchmark-gated grade never
              overrides a positive Raw e / NAV ERODER status.
            </p>
          </section>

          <section>
            <h4>Overall Verdict and NAV Erosion Score</h4>
            <p>
              The Overall Verdict is the system&apos;s primary conclusion. Its supporting historical risk score applies
              to the selected window and is not a forecast probability. It uses the
              strongest warning rather than averaging severe erosion away. The components are raw NAV decline
              (a 50% decline maps to 100), raw payout gap e ÷ d, benchmark-gated coverage, and full-window relative
              drag (50 percentage points maps to 100). The score is zero when raw e is zero or negative.
            </p>
            <p className="nep-formula">
              Score = 100 × min(1, max(raw e ÷ 50%, e ÷ d, confirmed coverage, relative drag ÷ 50 points))
            </p>
            <p>
              0–25 is Low, above 25–75 is Moderate, and above 75 is High. Benchmark-gated coverage remains visible
              separately so you can see which component produced a different conclusion.
            </p>
          </section>

          <section>
            <h4>Total Return vs. Gain / Loss</h4>
            <p>
              <strong>Ending Shares Value</strong> = the shares you accumulated × the ending price.
            </p>
            <p className="nep-formula">
              Ending Wealth = Ending Shares Value + cash distributions taken
              <br />
              Total Return $ = Ending Wealth − amount invested
              <br />
              Total Return % = Total Return $ ÷ amount invested
            </p>
            <p>
              &quot;Cash distributions taken&quot; is the portion of distributions you did{' '}
              <em>not</em> reinvest. <strong>Gain / Loss $</strong> is narrower — just Final Value − amount invested — so it
              reflects only the position&apos;s value and excludes any cash you pocketed. Total Return therefore
              differs from Gain / Loss by exactly the cash distributions taken.
            </p>
          </section>

          <p className="nep-help-note">
            Prices are split-adjusted (so a reverse-split penny stock is not compared against a million-dollar
            pre-split print) with distributions applied explicitly, and the backtest steps month by month.
            If a fund has no data back to your start date, results begin from its earliest available month
            (flagged in the Note column). Names Yahoo drops in a batch download are retried one at a time.
          </p>
        </div>
      </details>

      {/* Global date inputs */}
      <div className="ne-form" style={{ marginBottom: '1rem' }}>
        <div className="ne-field">
          <label className="ne-label">Start Date</label>
          <input className="ne-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="ne-field">
          <label className="ne-label">End Date</label>
          <input className="ne-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {/* Saved Backtests panel */}
      <div className="nep-saved-panel">
        <span className="nep-saved-label">Saved Backtests:</span>
        <select className="nep-saved-select" value={selectedSaved} onChange={e => setSelectedSaved(e.target.value)}>
          <option value="">— no saved backtests —</option>
          {savedList.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}  ({s.start_date || '?'} → {s.end_date || '?'})  [{s.created_at}]
            </option>
          ))}
        </select>
        <button className="nep-btn" onClick={loadSaved}>Load</button>
        <button className="nep-btn nep-btn-del" onClick={deleteSaved}>Delete</button>
        {deleteMsg && <span style={{ color: 'var(--pos-strong)', fontSize: '0.78rem' }}>Deleted</span>}
      </div>

      {/* ETF input grid */}
      <div className="nep-grid-panel">
        <div style={{ color: 'var(--p-aaa)', fontSize: '0.78rem', marginBottom: '0.55rem', lineHeight: 1.5 }}>
          Each row is one ETF. Starting dollars, the percent of distributions to reinvest, and the
          benchmark that ticker is compared with. Leave Benchmark blank to use the mapped default.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="nep-grid-tbl" style={{ width: 'auto', minWidth: 820 }}>
            <colgroup>
              <col style={{ width: 140 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>ETF Ticker</th>
                <th style={{ textAlign: 'left' }}>Starting Value</th>
                <th style={{ textAlign: 'left' }}>Dividends Reinvested (%)</th>
                <th style={{ textAlign: 'left' }}>Benchmark</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {gridRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input
                      className="ne-input"
                      style={{ width: 90, textTransform: 'uppercase' }}
                      maxLength={10}
                      placeholder="Ticker"
                      title="ETF ticker to include in this portfolio NAV erosion backtest"
                      aria-label="ETF ticker"
                      value={r.ticker}
                      onChange={e => updateRow(i, 'ticker', e.target.value.toUpperCase())}
                    />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input
                      className="ne-input"
                      type="number"
                      min="1"
                      step="100"
                      style={{ width: 120, textAlign: 'right' }}
                      placeholder="10000"
                      title="Starting investment amount for this ETF in the backtest"
                      aria-label="Starting dollars for this ETF"
                      value={r.amount}
                      onChange={e => updateRow(i, 'amount', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input
                      className="ne-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      style={{ width: 120, textAlign: 'right' }}
                      placeholder="0-100"
                      title="Percent of this ETF's distributions to reinvest. 0 keeps distributions as cash; 100 reinvests all distributions."
                      aria-label="Percent of dividends reinvested"
                      value={r.reinvest_pct}
                      onChange={e => updateRow(i, 'reinvest_pct', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input
                      className="ne-input"
                      style={{ width: 140, textTransform: 'uppercase' }}
                      maxLength={24}
                      placeholder="Auto"
                      list="nep-benchmark-choices"
                      title="Benchmark this ticker is compared with. Leave blank to use the mapped default (SPY, QQQ, BTC-USD, …)."
                      aria-label={`Benchmark for ${r.ticker || 'this ticker'}`}
                      value={r.benchmark || ''}
                      onChange={e => updateRow(i, 'benchmark', e.target.value.toUpperCase())}
                    />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem', textAlign: 'center' }}>
                    <button className="nep-row-del" title="Remove" onClick={() => removeRow(i)}>&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="nep-benchmark-choices">
            {NAV_BENCHMARK_CHOICES.map(b => <option key={b} value={b} />)}
          </datalist>
        </div>

        {/* Action buttons */}
        <div className="nep-actions">
          <button className="nep-btn" onClick={addRow} disabled={gridRows.length >= MAX_ROWS}>+ Add ETF</button>
          <button className="nep-btn" onClick={clearGrid}>Clear</button>
          <button className="nep-btn" onClick={saveList}>Save List</button>
          <button className="nep-btn nep-btn-purple" onClick={showSaveBtForm}>Save Backtest&hellip;</button>
          <button className="ne-run-btn" onClick={runBacktest} disabled={loading}>Run Backtest</button>
          {savedMsg && <span style={{ color: 'var(--pos-strong)', fontSize: '0.82rem' }}>Saved</span>}
          <span style={{ color: 'var(--p-555)', fontSize: '0.78rem', marginLeft: 'auto' }}>
            {gridRows.length} / {MAX_ROWS} ETFs
          </span>
        </div>

        {/* Save backtest form */}
        {btFormOpen && (
          <div className="nep-bt-form">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--purple)', whiteSpace: 'nowrap' }}>Backtest name:</label>
              <input
                className="ne-input"
                style={{ flex: 1, minWidth: 220, borderColor: 'var(--purple)' }}
                maxLength={200}
                placeholder="e.g. High-yield vs SPY 2020-2025"
                value={btName}
                onChange={e => setBtName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmSaveBt()
                  if (e.key === 'Escape') setBtFormOpen(false)
                }}
                autoFocus
              />
              <button className="nep-btn nep-btn-purple" style={{ fontWeight: 600 }} onClick={confirmSaveBt}>Save</button>
              <button className="nep-btn" onClick={() => setBtFormOpen(false)}>Cancel</button>
            </div>
            {selectedSaved && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.3rem' }}>
                <input
                  type="checkbox"
                  checked={btOverwrite}
                  onChange={e => setBtOverwrite(e.target.checked)}
                  style={{ accentColor: 'var(--purple)', width: 14, height: 14, cursor: 'pointer' }}
                  id="nep-bt-overwrite"
                />
                <label htmlFor="nep-bt-overwrite" style={{ fontSize: '0.78rem', color: 'var(--p-aaa)', cursor: 'pointer' }}>
                  Overwrite selected backtest (uncheck to save as new)
                </label>
              </div>
            )}
            {btError && <span style={{ color: 'var(--neg-3)', fontSize: '0.78rem' }}>{btError}</span>}
          </div>
        )}
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

      {/* Results */}
      {results && !loading && (
        <div style={{ marginTop: '0.6rem' }}>
          <h2 style={{ marginTop: 0, marginBottom: '0.7rem', fontSize: '1rem', color: 'var(--p-ccc)' }}>Results</h2>

          {/* Summary strip */}
          {summary && (
            <div className="nep-summary">
              {summary.overallScore != null && (
                <div
                  className="nep-stat-tile"
                  title="Primary combined verdict for this selected historical window, not a forecast. It uses the strongest warning from raw NAV decline, raw payout gap e ÷ d, benchmark-gated coverage, and relative drag."
                  style={{
                    border: `3px solid ${navSeverityColor(summary.overallSeverity)}`,
                    borderRadius: 8,
                    background: summary.overallSeverity === 'High' ? 'rgba(224,85,85,0.18)' : summary.overallSeverity === 'Medium' ? 'rgba(255,179,0,0.16)' : 'rgba(0,200,83,0.14)',
                    cursor: 'help',
                    flex: '1 1 260px',
                  }}
                >
                  <div className="nep-stat-val" style={{ color: navSeverityColor(summary.overallSeverity), fontSize: '1rem', whiteSpace: 'normal' }}>
                    {`${String(summary.overallSeverity || 'Unknown').toUpperCase()} NAV EROSION RISK`}
                  </div>
                  <div className="nep-stat-lbl">Overall Verdict ⓘ</div>
                  <div className="nep-stat-sub">{`${summary.overallScore.toFixed(1)} / 100 · raw gap ${summary.aggregateRawGap != null ? summary.aggregateRawGap.toFixed(4) : '—'}`}</div>
                </div>
              )}
              <StatTile label="Total Invested" value={fmt$(summary.totAmount)} color="#7ecfff" explanation="Sum of the initial dollar amounts entered for valid rows. It is the starting capital used as the portfolio comparison basis, not a good/bad score." />
              <StatTile label="Ending Shares Value" value={fmt$(summary.totFinal)} color="#7ecfff" explanation="Market value of all ending shares, including shares bought through reinvestment. Above total invested is favorable for share capital, but this excludes cash taken." />
              <StatTile label="Ending Wealth" value={fmt$(summary.totWealth)} color="#7ecfff" sub="shares value + cash taken" explanation="Ending shares value plus distributions taken as cash. Compare it with Total Invested: higher is better; above invested capital is a gain and below it is a loss." />
              <StatTile label="Total Gain / Loss" value={fmt$(summary.totGL)} color={summary.totGL >= 0 ? '#00c853' : '#e05555'} explanation="Capital-only change in ending shares value versus the amount invested. Positive is favorable and negative is a capital loss. Cash taken is excluded." />
              <StatTile label="Portfolio Return" value={fmtPct(summary.totGLPct)} color={summary.totGLPct >= 0 ? '#00c853' : '#e05555'} explanation="Capital-only percentage change in ending shares value. Positive is favorable, 0% is break-even, and negative is a loss. Use Ending Wealth and Total Return for the distribution-inclusive result." />
              <StatTile label="Total Distributions" value={fmt$(summary.totDist)} color="#7ecfff" explanation="All distributions generated by the simulated holdings. More cash is not automatically better because high payouts can coexist with NAV erosion." />
              <StatTile label="Total Reinvested" value={fmt$(summary.totReinv)} color="#7ecfff" explanation="Distribution cash used to buy more shares. This is not a new contribution. Its effect is captured in ending shares value and ending wealth." />
              <StatTile label="Cash Taken" value={fmt$(summary.totCash)} color="#7ecfff" explanation="Distributions received as cash instead of reinvested. Higher means more spendable cash, but it is not itself a performance score; Ending Wealth includes it." />
              <StatTile
                label="Portfolio Raw NAV Erosion (e)"
                value={fmtRate(summary.aggregateRawErosionRate)}
                color={summary.aggregateRawErosionRate > 0 ? '#e05555' : '#00c853'}
                sub={summary.aggregateRawErosionRate > 0 ? 'NAV ERODER — benchmark independent' : summary.aggregateRawErosionRate < 0 ? 'NAV rose — no raw erosion' : 'NAV flat'}
                explanation="Amount-weighted raw NAV erosion with no benchmark gate. Negative is favorable because NAV rose; 0% is flat; positive is erosion because NAV fell. Positive e means distributions exceeded accounting total return."
              />
              <StatTile label="Portfolio Distribution Rate (d)" value={fmtRate(summary.aggregateDistributionRate)} color="#7ecfff" sub="distributions ÷ starting NAV" explanation="Amount-weighted distributions divided by starting NAV. Higher means more cash was paid, but is not automatically better. If d exceeds r, raw e is positive and NAV fell." />
              <StatTile
                label="Portfolio Accounting Return (r)"
                value={fmtRate(summary.aggregateAccountingReturnRate)}
                color={summary.aggregateAccountingReturnRate < 0 ? '#e05555' : '#00c853'}
                sub="e = d − r"
                explanation="Amount-weighted price change plus distributions on starting NAV. Higher is better. For payouts to be covered without NAV loss, r must be at least d, making e zero or negative."
              />
              <StatTile
                label="Confirmed Erosion"
                value={summary.erosionCount + ' of ' + summary.validCount}
                color={summary.erosionCount > 0 ? '#e05555' : '#00c853'}
                sub="funds with a qualifying month"
                explanation="Number of funds with at least one month where the fund fell while its benchmark was flat or rising. Fewer is better, but zero does not prove every fund's raw NAV rose."
              />
              <StatTile
                label="Ending Price Deficit"
                value={summary.deficitCount + ' of ' + summary.validCount}
                color={summary.deficitCount > 0 ? '#e05555' : '#00c853'}
                sub="informational only"
                explanation="Number of funds whose ending shares are below the capital-only break-even share count. Fewer is better. Cash taken is excluded, so this is not a total-return verdict."
              />
              <StatTile
                label="Portfolio Confirmed Erosion Ratio"
                value={summary.aggCoverage != null ? summary.aggCoverage.toFixed(4) : '\u2014'}
                color={navSeverityColor(summary.aggSeverity)}
                sub="confirmed loss ÷ distributions"
                explanation="Total benchmark-confirmed price-loss dollars divided by distributions. Lower is better: 0 is best, 0–0.25 Low, above 0.25–0.75 Moderate, and above 0.75 High."
              />
              {summary.aggCoverage != null && (
                <div className="nep-stat-tile" title="Benchmark-gated coverage severity. Low is favorable, Moderate deserves review, and High means qualifying price losses consumed more than 75% of distributions. Raw e remains a separate principal measure." style={{
                  border: `2px solid ${navSeverityColor(summary.aggSeverity)}`,
                  borderRadius: '8px',
                  background: summary.aggSeverity === 'High' ? 'rgba(224,85,85,0.12)' : summary.aggSeverity === 'Medium' ? 'rgba(255,179,0,0.12)' : 'rgba(0,200,83,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flex: '1 1 190px',
                }}>
                  <div className="nep-stat-val" style={{
                    color: navSeverityColor(summary.aggSeverity),
                    fontSize: '0.85rem',
                    lineHeight: 1.3,
                    textAlign: 'center',
                    whiteSpace: 'normal',
                  overflow: 'visible',
                  textOverflow: 'clip',
                  cursor: 'help',
                  }}>
                    {navSeverityText(summary.aggSeverity, true)}
                  </div>
                </div>
              )}
              {summary.benchmarkReturnPct != null && (
                <StatTile
                  label="Benchmark Return (weighted)"
                  value={fmtPct(summary.benchmarkReturnPct)}
                  color={summary.benchmarkReturnPct >= 0 ? '#00c853' : '#e05555'}
                  sub="mapped underlying benchmarks"
                  explanation="Initial-amount-weighted return of each fund's mapped benchmark. Positive means the underlying markets rose and negative means they fell. This is context, not a fund-performance score."
                />
              )}
              {summary.relativeDragPct != null && (
                <StatTile
                  label="Relative Price Drag"
                  value={fmtPct(summary.relativeDragPct)}
                  color={summary.relativeDragPct > 0 ? '#e05555' : '#00c853'}
                  sub="benchmark return − fund price return"
                  explanation="Initial-amount-weighted benchmark return minus fund price return. Lower is better; 0 means no positive lag, while a larger positive value means more fund underperformance. Distributions are excluded."
                />
              )}
              {summary.best && (
                <StatTile
                  label="Best Performer"
                  value={<span style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>{summary.best.ticker}</span>}
                  color="#00c853"
                  sub={fmtPct(summary.best.total_return_pct || 0)}
                  explanation="Ticker with the highest distribution-inclusive investor total return in this backtest. Positive is a gain; negative means it was merely the least-bad result."
                />
              )}
              {summary.worst && (
                <StatTile
                  label="Worst Performer"
                  value={<span style={{ color: 'var(--neg-3)', fontWeight: 700 }}>{summary.worst.ticker}</span>}
                  color="#e05555"
                  sub={fmtPct(summary.worst.total_return_pct || 0)}
                  explanation="Ticker with the lowest distribution-inclusive investor total return in this backtest. A negative value is a loss; compare it with the best performer and raw e."
                />
              )}
              {summary.errorCount > 0 && (
                <StatTile label="No Data" value={summary.errorCount + ' ticker' + (summary.errorCount > 1 ? 's' : '')} color="#f9a825" sub="check Note column" explanation="Number of requested tickers that could not be calculated. Zero is best. Review the Note column for missing price or benchmark history." />
              )}
            </div>
          )}

          <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: 'var(--p-666)', fontWeight: 400 }}>
            Detail &mdash; click any header to sort
          </h3>

          <div className="nep-tbl-wrap">
            <table className="sst" id="nep-tbl">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={h} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>
                      {h}{arrow(i)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r, idx) => {
                  if (r.error && !r.start_price) {
                    return (
                      <tr key={idx}>
                        <td><strong>{r.ticker}</strong></td>
                        <td>
                          <input
                            className="ne-input"
                            style={{ width: 110, textTransform: 'uppercase' }}
                            maxLength={24}
                            list="nep-benchmark-choices"
                            title="Change the benchmark, then Run Backtest"
                            aria-label={`Benchmark for ${r.ticker}`}
                            value={
                              (gridRows.find(row => row.ticker.trim().toUpperCase() === r.ticker) || {}).benchmark
                              || r.benchmark
                              || ''
                            }
                            onChange={e => {
                              const next = e.target.value.toUpperCase()
                              setGridRows(prev => {
                                const has = prev.some(row => row.ticker.trim().toUpperCase() === r.ticker)
                                if (!has) {
                                  return [...prev, {
                                    ticker: r.ticker,
                                    amount: String(r.amount || ''),
                                    reinvest_pct: String(r.reinvest_pct || ''),
                                    benchmark: next,
                                  }]
                                }
                                return prev.map(row => (
                                  row.ticker.trim().toUpperCase() === r.ticker
                                    ? { ...row, benchmark: next }
                                    : row
                                ))
                              })
                            }}
                          />
                        </td>
                        <td>{fmt$(r.amount || 0)}</td>
                        <td>{(r.reinvest_pct || 0)}%</td>
                        <td colSpan={headers.length - 4} style={{ textAlign: 'left', color: 'var(--neg-3)' }}>{r.error}</td>
                      </tr>
                    )
                  }
                  const pCls = r.price_delta_pct < 0 ? 'pct-down' : (r.price_delta_pct > 0 ? 'pct-up' : '')
                  const benchCls = (r.benchmark_return_pct || 0) < 0 ? 'pct-down' : 'pct-up'
                  const glCls = r.gain_loss_dollar < 0 ? 'pct-down' : 'pct-up'
                  const glPCls = r.gain_loss_pct < 0 ? 'pct-down' : 'pct-up'
                  const trCls = (r.total_return_dollar || 0) < 0 ? 'pct-down' : 'pct-up'
                  const trPCls = (r.total_return_pct || 0) < 0 ? 'pct-down' : 'pct-up'
                  const defCls = r.final_deficit > 0 ? 'ne-deficit' : 'ne-surplus'
                  const gapPct = shareGapPct(r.final_deficit || 0, r.amount || 0, r.end_price || 0)
                  const gapKind = shareGapKind(r.final_deficit || 0)
                  const navSeverity = r.nav_erosion_severity || navSeverityFromRatio(r.coverage_ratio)
                  return (
                    <tr key={idx}>
                      <td><strong>{r.ticker}</strong></td>
                      <td>
                        <input
                          className="ne-input"
                          style={{ width: 110, textTransform: 'uppercase' }}
                          maxLength={24}
                          list="nep-benchmark-choices"
                          title="Change the benchmark, then Run Backtest"
                          aria-label={`Benchmark for ${r.ticker}`}
                          value={
                            (gridRows.find(row => row.ticker.trim().toUpperCase() === r.ticker) || {}).benchmark
                            || r.benchmark
                            || ''
                          }
                          onChange={e => {
                            const next = e.target.value.toUpperCase()
                            setGridRows(prev => prev.map(row => (
                              row.ticker.trim().toUpperCase() === r.ticker
                                ? { ...row, benchmark: next }
                                : row
                            )))
                          }}
                        />
                      </td>
                      <td>{fmt$(r.amount)}</td>
                      <td>{r.reinvest_pct}%</td>
                      <td>{fmt$(r.start_price)}</td>
                      <td>{fmt$(r.end_price)}</td>
                      <td className={pCls}>{fmtPct(r.price_delta_pct)}</td>
                      <td className={benchCls}>{fmtPct(r.benchmark_return_pct || 0)}</td>
                      <td>{fmt$(r.total_dist)}</td>
                      <td>{fmt$(r.total_reinvested)}</td>
                      <td>{fmt$(r.cash_taken || 0)}</td>
                      <td>{fmt$(r.final_value)}</td>
                      <td>{fmt$(r.ending_wealth ?? ((r.final_value || 0) + (r.cash_taken || 0)))}</td>
                      <td className={glCls}>{fmt$(r.gain_loss_dollar)}</td>
                      <td className={glPCls}>{fmtPct(r.gain_loss_pct)}</td>
                      <td className={trCls}>{fmt$(r.total_return_dollar || 0)}</td>
                      <td className={trPCls}>{fmtPct(r.total_return_pct || 0)}</td>
                      <td>
                        {r.has_erosion
                          ? <span style={{ color: 'var(--neg-3)', fontWeight: 700 }}>Yes</span>
                          : <span style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>No</span>}
                      </td>
                      <td>{r.confirmed_erosion_months || 0}</td>
                      <td
                        className={defCls}
                        title={`Break-even shares minus total shares held: ${parseFloat(r.final_deficit || 0).toFixed(4)} (${fmtPct(gapPct)})`}
                      >
                        {fmtAbs4(r.final_deficit)} {gapKind} <span style={{ opacity: 0.8 }}>({fmtAbsPct(gapPct)})</span>
                      </td>
                      <td title="Raw e has no benchmark gate. Positive means NAV ERODER regardless of the benchmark; negative means NAV rose; 0% is flat." style={{ color: r.raw_nav_erosion_rate > 0 ? 'var(--neg-3)' : 'var(--pos-strong)', cursor: 'help' }}>
                        <div>{fmtRate(r.raw_nav_erosion_rate)}</div>
                        {r.raw_nav_erosion_rate != null && (
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {r.raw_nav_erosion_rate > 0 ? 'NAV ERODER' : r.raw_nav_erosion_rate < 0 ? 'NAV ROSE' : 'NAV FLAT'}
                          </div>
                        )}
                      </td>
                      <td
                        title={`Overall historical NAV erosion verdict. Strongest of raw decline, raw payout gap e ÷ d (${r.raw_payout_gap_ratio != null ? Number(r.raw_payout_gap_ratio).toFixed(4) : '—'}), benchmark coverage, and relative drag. Low 0–25; Moderate >25–75; High >75.`}
                        style={{ color: navSeverityColor(r.overall_nav_erosion_severity), fontWeight: 700, cursor: 'help' }}
                      >
                        {r.overall_nav_erosion_score != null ? `${String(r.overall_nav_erosion_severity || '').toUpperCase()} RISK (${Number(r.overall_nav_erosion_score).toFixed(1)})` : '—'}
                      </td>
                      <td title="Distribution rate d is cash paid divided by starting NAV. Higher means more cash, but is not automatically better when d exceeds r." style={{ cursor: 'help' }}>{fmtRate(r.distribution_rate_on_starting_nav)}</td>
                      <td title="Accounting return r includes price change and distributions. Higher is better; r at least equal to d means no raw NAV erosion." style={{ color: r.accounting_total_return_rate < 0 ? 'var(--neg-3)' : 'var(--pos-strong)', cursor: 'help' }}>{fmtRate(r.accounting_total_return_rate)}</td>
                      <td title="Benchmark-confirmed price loss divided by distributions. Lower is better: 0–0.25 Low, above 0.25–0.75 Moderate, above 0.75 High." style={{ color: r.coverage_ratio == null ? 'var(--p-666)' : navSeverityColor(navSeverity), fontWeight: r.coverage_ratio != null ? 600 : 400, cursor: 'help' }}>
                        {r.coverage_ratio != null ? r.coverage_ratio.toFixed(4) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'left', fontSize: '0.78rem', color: 'var(--p-aaa)' }}>
                        {r.warning
                          ? <span title={r.warning} style={{ cursor: 'help' }}>&#9888; {r.warning.substring(0, 40)}{r.warning.length > 40 ? '\u2026' : ''}</span>
                          : <span style={{ color: 'var(--p-555)' }}>{'\u2014'}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {summary && (
                <tfoot>
                  <tr>
                    <td><strong>TOTAL</strong></td>
                    <td></td>
                    <td>{fmt$(summary.totAmount)}</td>
                    <td></td><td></td><td></td><td></td>
                    <td></td>
                    <td>{fmt$(summary.totDist)}</td>
                    <td>{fmt$(summary.totReinv)}</td>
                    <td>{fmt$(summary.totCash)}</td>
                    <td>{fmt$(summary.totFinal)}</td>
                    <td>{fmt$(summary.totWealth)}</td>
                    <td className={summary.totGL >= 0 ? 'pct-up' : 'pct-down'}>{fmt$(summary.totGL)}</td>
                    <td></td>
                    <td className={summary.totTR >= 0 ? 'pct-up' : 'pct-down'}>{fmt$(summary.totTR)}</td>
                    <td></td><td></td><td></td><td></td>
                    <td title="Raw e: negative is favorable, zero is flat, and positive is erosion." className={summary.aggregateRawErosionRate > 0 ? 'pct-down' : 'pct-up'} style={{ cursor: 'help' }}>{fmtRate(summary.aggregateRawErosionRate)}</td>
                    <td title={`Overall historical verdict; raw payout gap e ÷ d is ${summary.aggregateRawGap != null ? summary.aggregateRawGap.toFixed(4) : '—'}.`} style={{ color: navSeverityColor(summary.overallSeverity), fontWeight: 700, cursor: 'help' }}>{summary.overallScore != null ? `${String(summary.overallSeverity).toUpperCase()} RISK (${summary.overallScore.toFixed(1)})` : '—'}</td>
                    <td title="Distribution rate d: higher cash is not automatically better; compare it with r." style={{ cursor: 'help' }}>{fmtRate(summary.aggregateDistributionRate)}</td>
                    <td title="Accounting return r: higher is better; r at least equal to d means e is zero or negative." className={summary.aggregateAccountingReturnRate < 0 ? 'pct-down' : 'pct-up'} style={{ cursor: 'help' }}>{fmtRate(summary.aggregateAccountingReturnRate)}</td>
                    <td title="Confirmed coverage is lower-is-better: 0–0.25 Low, above 0.25–0.75 Moderate, above 0.75 High." style={{ color: navSeverityColor(summary.aggSeverity), fontWeight: 600, cursor: 'help' }}>
                      {summary.aggCoverage != null ? summary.aggCoverage.toFixed(4) : '\u2014'}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
