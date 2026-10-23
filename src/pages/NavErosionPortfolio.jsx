import React, { useState, useEffect, useId, useMemo, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { NavFindingLabel, NavLagNote } from '../components/NavFinding'
import '../components/NavAssessment.css'
import { formatMoney } from '../utils/money'
import { isNavLag, navPercent, navProbability, NAV_LAG_EXPLAINER } from '../utils/navAssessment'
import { NAV_BENCHMARK_CHOICES } from '../utils/navBenchmarks'

const MAX_ROWS = 80

function fmt$(v) {
  return formatMoney(v, { zeroIfInvalid: true })
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + parseFloat(v).toFixed(2) + '%'
}
function fmtAbs4(v) {
  return Math.abs(parseFloat(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtAbsPct(v) {
  return Math.abs(parseFloat(v || 0)).toFixed(2) + '%'
}
function fmtPoints(v) {
  return v == null ? '—' : `${(Math.abs(v) * 100).toFixed(1)} pts`
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

// Groups of the shared per-fund result, for the summary counts.
const FINDING_GROUPS = [
  ['erosion', 'Erosion', ['verified_erosion', 'estimated_eroder'], '#e05555',
    'Funds the NAV check flags as eroding: an estimated covered-call eroder, or a verified published-NAV erosion review.'],
  ['losing', 'Losing capital vs reference', ['losing_capital'], '#ffb300',
    'Funds that repeatedly lost capital versus their reference after paying the same cash, without meeting the covered-call eroder rule.'],
  ['lag', 'NAV lag — not erosion', ['nav_lag'], 'var(--accent-2)', NAV_LAG_EXPLAINER],
  ['none', 'No erosion signal', ['no_signal', 'declined', 'preserved', 'within_precision', 'liquidated'], '#00c853',
    'Funds the check ran on that showed no erosion signal.'],
  ['unchecked', 'Not checked', ['not_applicable', 'skipped', 'limited_evidence', 'needs_strategy', 'unconfirmed'], 'var(--text-dim)',
    'Stocks and money-market funds, skipped holdings, funds with fewer than two usable months, and funds whose strategy is not known.'],
]
const VERDICT_COLORS = { strong: '#e05555', weak: '#ffb300', none: '#00c853', insufficient: 'var(--text-dim)' }

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
  // Per-instance ids: Split View can mount this page in both panes, and a
  // label or datalist pointing at a repeated id resolves to the other pane's
  // field.
  const uid = useId()
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
  const [verdict, setVerdict] = useState(null)
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
    setVerdict(null)
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
          setVerdict(data.verdict || null)
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
  const sortValue = {
    finding: r => r.finding?.label || '',
    nav_lag: r => (r.nav_lag?.status === 'lag' || r.nav_lag?.status === 'none') ? r.nav_lag.lag_rate : null,
    has_price_deficit: r => (r.has_price_deficit ? 1 : 0),
  }
  const colKeys = ['ticker', 'benchmark', 'amount', 'reinvest_pct', 'start_price', 'end_price',
    'price_delta_pct', 'benchmark_return_pct', 'total_dist', 'total_reinvested', 'cash_taken',
    'final_value', 'ending_wealth', 'gain_loss_dollar', 'gain_loss_pct', 'total_return_dollar',
    'total_return_pct', 'finding', 'nav_lag', 'same_cash_gap_rate', 'erosion_months', 'strategy',
    'final_deficit', 'warning']

  const sortedResults = useMemo(() => {
    if (!results) return []
    const arr = [...results]
    if (sortCol !== null) {
      const key = colKeys[sortCol]
      const get = sortValue[key] || (r => r[key])
      arr.sort((a, b) => {
        const aV = get(a) ?? '', bV = get(b) ?? ''
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
  const arrow = (col) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : ''

  // Summary
  const summary = useMemo(() => {
    if (!results || results.length === 0) return null
    let totAmount = 0, totDist = 0, totReinv = 0, totCash = 0, totFinal = 0, totWealth = 0, totGL = 0, totTR = 0
    let validCount = 0, errorCount = 0
    let best = null, worst = null
    const groups = Object.fromEntries(FINDING_GROUPS.map(([key]) => [key, []]))
    results.forEach(r => {
      const group = FINDING_GROUPS.find(([, , codes]) => codes.includes(r.finding?.code))
      if (group && !groups[group[0]].includes(r.ticker)) groups[group[0]].push(r.ticker)
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
      if (best === null || r.total_return_pct > best.total_return_pct) best = r
      if (worst === null || r.total_return_pct < worst.total_return_pct) worst = r
    })
    const totGLPct = totAmount > 0 ? totGL / totAmount * 100 : 0
    return { totAmount, totDist, totReinv, totCash, totFinal, totWealth, totGL, totTR, totGLPct, validCount, errorCount, best, worst, groups }
  }, [results])

  const headers = ['Ticker', 'Reference', 'Amount', 'Reinvest %', 'Start Price', 'End Price',
    'Price Δ%', 'Reference Price Δ%', 'Total Distributions', 'Total Reinvested', 'Cash Taken',
    'Ending Shares Value', 'Ending Wealth', 'Gain/Loss $', 'Gain/Loss %', 'Total Return $',
    'Total Return %', 'NAV Result', 'NAV Lag', 'Capital vs Reference', 'Erosion Months', 'Strategy',
    'Shares Needed / Extra To Breakeven', 'Note']

  const referenceInput = r => (
    <input
      className="ne-input"
      style={{ width: 110, textTransform: 'uppercase' }}
      maxLength={20}
      list={`${uid}-nep-benchmark-choices`}
      placeholder={r.benchmark || "Dashboard's"}
      title={`Used: ${r.benchmark || 'no reference'} (${r.benchmark_source || 'automatic'}). Type a ticker to use it for the next run only, then Run Backtest.`}
      aria-label={`Reference for ${r.ticker}`}
      value={(gridRows.find(row => row.ticker.trim().toUpperCase() === r.ticker) || {}).benchmark || ''}
      onChange={e => {
        const next = e.target.value.toUpperCase()
        setGridRows(prev => {
          const has = prev.some(row => row.ticker.trim().toUpperCase() === r.ticker)
          if (!has) {
            return [...prev, { ticker: r.ticker, amount: String(r.amount || ''), reinvest_pct: String(r.reinvest_pct || ''), benchmark: next }]
          }
          return prev.map(row => (row.ticker.trim().toUpperCase() === r.ticker ? { ...row, benchmark: next } : row))
        })
      }}
    />
  )

  return (
    <div className="nep-page">
      <h1 style={{ marginBottom: '0.3rem' }}>NAV Erosion Portfolio Screener</h1>
      <p className="ne-desc">
        Compare up to {MAX_ROWS} funds side by side. Each fund gets the same NAV check the Dashboard uses, so it shows the same
        result here, on the Dashboard and on the NAV Erosion page for the same dates and reference. Each row also gets a dollar
        back-test with its own starting amount and reinvestment percentage. Your list is saved and persists between sessions.
        <br />
        <strong style={{ color: 'var(--accent-2)' }}>NAV lag — not erosion</strong> marks a covered-call fund whose price only
        trailed its underlying&apos;s price. That is expected of a fund that sells calls and pays out the income, and it never counts
        as NAV erosion.
        <br />
        <span style={{ color: 'var(--neg-3)', fontWeight: 600 }}>Red needed</span> means shares still needed to breakeven.
        <span style={{ color: 'var(--pos-strong)', fontWeight: 600 }}> Green extra</span> means shares above breakeven.
      </p>

      {/* Collapsed-by-default help: how the numbers are computed */}
      <details className="nep-help">
        <summary>How the NAV result and total return are computed</summary>
        <div className="nep-help-body">
          <section>
            <h4>One NAV check on every screen</h4>
            <p>
              The NAV Result column is the same result the Dashboard shows for the fund, calculated by the same code. For each fund
              the check uses the reference the Dashboard uses: one you saved under Reference details, the benchmark set with Include
              (manual), or the automatic one. A ticker typed in the Reference box applies to that run only and is labelled
              &quot;Your benchmark for this run&quot;.
            </p>
            <p>
              The fund is compared with a reference that pays out the same cash on the same dates. A month is an <strong>erosion
              month</strong> when the reference was flat or up but the fund&apos;s price fell and it kept less capital than the
              reference. A fund is <strong>Losing capital vs reference</strong> when that repeats (two months in a row, or two thirds
              of the flat-or-up months) and, over the whole period, its price fell at least 1% and it ended at least 0.5% behind the
              reference. It is an <strong>Estimated covered-call eroder</strong> when it also sells call options and paid out more
              than the reference earned in those months. A fund with published NAV (TappAlpha and NEOS funds) is also checked
              quarter by quarter against that NAV.
            </p>
          </section>

          <section>
            <h4>NAV lag is not NAV erosion</h4>
            <p>{NAV_LAG_EXPLAINER}</p>
            <p className="nep-formula">
              NAV Lag = reference price change − fund price change, marked when at least 1 point
            </p>
            <p>
              The NAV lag result also says how much the fund paid out and whether, counting that cash, it still kept less capital
              than the reference. Capital vs Reference shows that number for every fund.
            </p>
          </section>

          <section>
            <h4>Portfolio reading</h4>
            <p>
              The Strong / Weak / No NAV Erosion card uses the Dashboard&apos;s rules, weighting each fund by the amount entered in
              this screener. Stocks and money-market funds are not NAV-checked; they keep their dollar back-test.
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
            The back-test uses the same split-adjusted closes, distributions and dates as the NAV check, steps month by month and
            reinvests at each month&apos;s last close. If a fund has no data back to your start date, results begin from its
            earliest close (flagged in the Note column).
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
          Each row is one fund: starting dollars, the percent of distributions to reinvest, and optionally a reference
          ticker. Leave Reference blank to use the same reference the Dashboard uses for that fund.
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
                <th style={{ textAlign: 'left' }}>Reference</th>
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
                      maxLength={20}
                      placeholder="Dashboard's"
                      list={`${uid}-nep-benchmark-choices`}
                      title="Leave blank to use the same reference the Dashboard uses for this fund. A ticker typed here applies to this screener's runs only."
                      aria-label={`Reference for ${r.ticker || 'this ticker'}`}
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
          <datalist id={`${uid}-nep-benchmark-choices`}>
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
                  id={`${uid}-nep-bt-overwrite`}
                />
                <label htmlFor={`${uid}-nep-bt-overwrite`} style={{ fontSize: '0.78rem', color: 'var(--p-aaa)', cursor: 'pointer' }}>
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
              {verdict && (
                <div
                  className="nep-stat-tile"
                  title={verdict.explanation}
                  style={{
                    border: `3px solid ${VERDICT_COLORS[verdict.strength]}`,
                    borderRadius: 8,
                    cursor: 'help',
                    flex: '1 1 260px',
                  }}
                >
                  <div className="nep-stat-val" style={{ color: VERDICT_COLORS[verdict.strength], fontSize: '1rem', whiteSpace: 'normal' }}>
                    {verdict.label}
                  </div>
                  <div className="nep-stat-lbl">Funds in this screener ⓘ</div>
                  <div className="nep-stat-sub">{navProbability(verdict.probability)} evidence probability · {verdict.summary}</div>
                </div>
              )}
              {FINDING_GROUPS.map(([key, label, , color, explanation]) => {
                const tickers = summary.groups[key]
                return (
                  <StatTile
                    key={key}
                    label={label}
                    value={tickers.length}
                    color={color}
                    sub={tickers.length > 6 ? `${tickers.slice(0, 6).join(', ')} +${tickers.length - 6} more` : tickers.join(', ') || 'none'}
                    explanation={tickers.length ? `${explanation}\n\n${tickers.join(', ')}` : explanation}
                  />
                )
              })}
              <StatTile label="Total Invested" value={fmt$(summary.totAmount)} color="#7ecfff" explanation="Sum of the initial dollar amounts entered for valid rows." />
              <StatTile label="Ending Shares Value" value={fmt$(summary.totFinal)} color="#7ecfff" explanation="Market value of all ending shares, including shares bought through reinvestment. Excludes cash taken." />
              <StatTile label="Ending Wealth" value={fmt$(summary.totWealth)} color="#7ecfff" sub="shares value + cash taken" explanation="Ending shares value plus distributions taken as cash." />
              <StatTile label="Total Gain / Loss" value={fmt$(summary.totGL)} color={summary.totGL >= 0 ? '#00c853' : '#e05555'} explanation="Capital-only change in ending shares value versus the amount invested. Cash taken is excluded." />
              <StatTile label="Portfolio Return" value={fmtPct(summary.totGLPct)} color={summary.totGLPct >= 0 ? '#00c853' : '#e05555'} explanation="Capital-only percentage change in ending shares value. Use Ending Wealth and Total Return for the distribution-inclusive result." />
              <StatTile label="Total Distributions" value={fmt$(summary.totDist)} color="#7ecfff" explanation="All distributions generated by the simulated holdings. A high payout alone is not erosion." />
              <StatTile label="Total Reinvested" value={fmt$(summary.totReinv)} color="#7ecfff" explanation="Distribution cash used to buy more shares. This is not a new contribution." />
              <StatTile label="Cash Taken" value={fmt$(summary.totCash)} color="#7ecfff" explanation="Distributions received as cash instead of reinvested. Ending Wealth includes it." />
              {summary.best && (
                <StatTile
                  label="Best Performer"
                  value={<span style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>{summary.best.ticker}</span>}
                  color="#00c853"
                  sub={fmtPct(summary.best.total_return_pct || 0)}
                  explanation="Ticker with the highest distribution-inclusive investor total return in this backtest."
                />
              )}
              {summary.worst && (
                <StatTile
                  label="Worst Performer"
                  value={<span style={{ color: 'var(--neg-3)', fontWeight: 700 }}>{summary.worst.ticker}</span>}
                  color="#e05555"
                  sub={fmtPct(summary.worst.total_return_pct || 0)}
                  explanation="Ticker with the lowest distribution-inclusive investor total return in this backtest."
                />
              )}
              {summary.errorCount > 0 && (
                <StatTile label="No Data" value={summary.errorCount + ' ticker' + (summary.errorCount > 1 ? 's' : '')} color="#f9a825" sub="check Note column" explanation="Requested tickers that could not be back-tested. Review the Note column." />
              )}
            </div>
          )}
          {summary?.groups.lag.length > 0 && <NavLagNote />}

          <h3 style={{ margin: '0.4rem 0', fontSize: '0.85rem', color: 'var(--p-666)', fontWeight: 400 }}>
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
                        <td>{referenceInput(r)}</td>
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
                  const lag = r.nav_lag || {}
                  const lagged = isNavLag(r.finding)
                  return (
                    <tr key={idx}>
                      <td><strong>{r.ticker}</strong></td>
                      <td>
                        {referenceInput(r)}
                        <div style={{ fontSize: '0.68rem', color: 'var(--p-888)', whiteSpace: 'nowrap' }}>{r.benchmark || 'None'} · {r.benchmark_source}</div>
                      </td>
                      <td>{fmt$(r.amount)}</td>
                      <td>{r.reinvest_pct}%</td>
                      <td>{fmt$(r.start_price)}</td>
                      <td>{fmt$(r.end_price)}</td>
                      <td className={pCls}>{fmtPct(r.price_delta_pct)}</td>
                      <td className={r.benchmark_return_pct == null ? '' : benchCls}>{r.benchmark_return_pct == null ? '—' : fmtPct(r.benchmark_return_pct)}</td>
                      <td>{fmt$(r.total_dist)}</td>
                      <td>{fmt$(r.total_reinvested)}</td>
                      <td>{fmt$(r.cash_taken || 0)}</td>
                      <td>{fmt$(r.final_value)}</td>
                      <td>{fmt$(r.ending_wealth ?? ((r.final_value || 0) + (r.cash_taken || 0)))}</td>
                      <td className={glCls}>{fmt$(r.gain_loss_dollar)}</td>
                      <td className={glPCls}>{fmtPct(r.gain_loss_pct)}</td>
                      <td className={trCls}>{fmt$(r.total_return_dollar || 0)}</td>
                      <td className={trPCls}>{fmtPct(r.total_return_pct || 0)}</td>
                      <td style={{ textAlign: 'left', minWidth: 190 }} title={[lagged && NAV_LAG_EXPLAINER, r.finding?.reason].filter(Boolean).join('\n')}>
                        <NavFindingLabel finding={r.finding} title="" />
                        <div style={{ fontSize: '0.68rem', color: 'var(--p-888)' }}>{r.finding?.detail}</div>
                        {lagged && <NavLagNote compact />}
                      </td>
                      <td
                        title={lag.status === 'lag' || lag.status === 'none' ? `${r.ticker} price ${navPercent(lag.fund_price_change_rate)} vs ${lag.reference} price ${navPercent(lag.underlying_price_change_rate)}. ${NAV_LAG_EXPLAINER}` : 'NAV lag applies to covered-call funds with no erosion signal.'}
                        style={{ color: lagged ? 'var(--accent-2)' : 'var(--p-888)', cursor: 'help' }}
                      >
                        {lag.status === 'lag' || lag.status === 'none' ? fmtPoints(lag.lag_rate) : '—'}
                      </td>
                      <td title="Capital the fund kept versus the reference after paying the same cash. Negative means it kept less." style={{ color: r.same_cash_gap_rate < 0 ? 'var(--neg-3)' : undefined, cursor: 'help' }}>
                        {navPercent(r.same_cash_gap_rate)}
                      </td>
                      <td title="Erosion months out of the completed months when the reference was flat or up. Erosion needs this to repeat." style={{ cursor: 'help' }}>
                        {r.months_checked != null ? `${r.erosion_months} of ${r.months_checked}` : '—'}
                      </td>
                      <td style={{ textAlign: 'left', fontSize: '0.75rem', minWidth: 140 }}>{r.strategy || '—'}</td>
                      <td
                        className={defCls}
                        title={`Break-even shares minus total shares held: ${parseFloat(r.final_deficit || 0).toFixed(4)} (${fmtPct(gapPct)})`}
                      >
                        {fmtAbs4(r.final_deficit)} {gapKind} <span style={{ opacity: 0.8 }}>({fmtAbsPct(gapPct)})</span>
                      </td>
                      <td style={{ textAlign: 'left', fontSize: '0.78rem', color: 'var(--p-aaa)' }}>
                        {r.warning
                          ? <span title={r.warning} style={{ cursor: 'help' }}>&#9888; {r.warning.substring(0, 40)}{r.warning.length > 40 ? '…' : ''}</span>
                          : <span style={{ color: 'var(--p-555)' }}>{'—'}</span>}
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
                    <td></td>
                    <td style={{ textAlign: 'left' }}>{verdict ? <span style={{ color: VERDICT_COLORS[verdict.strength], fontWeight: 700 }}>{verdict.label}</span> : null}</td>
                    <td></td><td></td><td></td><td></td><td></td><td></td>
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
