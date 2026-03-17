import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'

const DURATION_OPTIONS = Array.from({ length: 20 }, (_, i) => ({
  value: `${i + 1}y`,
  label: `${i + 1} Year${i > 0 ? 's' : ''}`,
}))

function fmt$(v) { return '$' + Math.round(v).toLocaleString() }
function fmtS(v) { return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtPct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }
function better(a, b, lower) { return lower ? (a < b ? 'dc-better' : '') : (a > b ? 'dc-better' : '') }

const FUND_COLORS = { a: '#7ecfff', b: '#ffc107', c: '#ff6b6b' }

const TBL_COLS_BASE = [
  { key: '_month', label: 'Month', fmt: v => v },
  { key: 'price', label: 'Price', fmt: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  { key: 'shares', label: 'Shares', fmt: v => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  { key: 'portfolio', label: 'Portfolio $', fmt: v => '$' + Math.round(v).toLocaleString() },
  { key: 'dist_per_share', label: 'Dist/Share', fmt: v => '$' + v.toFixed(4) },
  { key: 'income', label: 'Income', fmt: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  { key: 'withdrawal', label: 'Withdrawal', fmt: v => '$' + Math.round(v).toLocaleString() },
  { key: 'wedge_drawn', label: 'CW Drawn', fmt: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), wedgeOnly: true },
  { key: 'wedge_bal', label: 'CW Balance', fmt: v => '$' + Math.round(v).toLocaleString(), wedgeOnly: true },
  { key: 'cash_accumulated', label: 'Cash Accum.', fmt: v => '$' + Math.round(v).toLocaleString(), cashOnly: true },
  { key: 'excess', label: 'Excess', fmt: v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), color: true },
  { key: 'shares_delta', label: 'Shares +/-', fmt: v => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(4), color: true },
  { key: 'growth', label: 'Growth/Loss', fmt: v => (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), color: true },
  { key: 'cum_income', label: 'Cum. Income', fmt: v => '$' + Math.round(v).toLocaleString() },
  { key: 'roi_dollar', label: 'ROI ($)', fmt: v => (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), color: true },
  { key: 'roi_pct', label: 'ROI (%)', fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%', color: true },
]

/* ── Ticker Combo Input ─────────────────────────────────────────── */
function TickerCombo({ value, onChange, onLookup, info, portfolioTickers }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    if (!portfolioTickers.length) return []
    const q = value.toUpperCase()
    return portfolioTickers.filter(t =>
      t.ticker.includes(q) || (t.description || '').toUpperCase().includes(q)
    ).slice(0, 12)
  }, [value, portfolioTickers])

  return (
    <div className="dc-field">
      <label>Ticker</label>
      <div className="dc-ticker-row" ref={ref}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="text" value={value}
            onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="e.g. SCHD"
          />
          {open && filtered.length > 0 && (
            <div className="dc-ticker-dropdown">
              {filtered.map(t => (
                <div key={t.ticker} className="dc-ticker-option" onMouseDown={() => {
                  onChange(t.ticker)
                  setOpen(false)
                  setTimeout(() => onLookup(), 50)
                }}>
                  <strong>{t.ticker}</strong>
                  <span style={{ color: '#6b7b8d', marginLeft: 8 }}>{t.description || ''}</span>
                  {t.current_yield > 0 && <span style={{ color: '#00e89a', marginLeft: 8 }}>{t.current_yield.toFixed(2)}%</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="dc-lookup-btn" onClick={onLookup}>Lookup</button>
      </div>
      {info.text && <div className={`dc-info${info.warn ? ' warn' : ''}`}>{info.text}</div>}
    </div>
  )
}

/* ── Annual Distribution Estimate ──────────────────────────────── */
function DistEstimate({ lookupData, investment, yieldOverride }) {
  if (!lookupData) return null
  const effectiveYield = yieldOverride ? parseFloat(yieldOverride) : lookupData.ttmYield
  if (!effectiveYield || effectiveYield <= 0) return null
  const annualDist = investment * (effectiveYield / 100)
  const monthlyDist = annualDist / 12
  const shares = investment / lookupData.price
  const distPerShare = lookupData.price * (effectiveYield / 100) / 12
  return (
    <div className="dc-dist-estimate">
      <span>Est. Annual Distribution: <strong>${Math.round(annualDist).toLocaleString()}</strong></span>
      <span style={{ color: '#6b7b8d' }}> ({fmt$(monthlyDist)}/mo</span>
      <span style={{ color: '#6b7b8d' }}> &middot; {shares.toFixed(2)} shares @ ${distPerShare.toFixed(4)}/sh/mo)</span>
      {yieldOverride && <span style={{ color: '#ffc107', marginLeft: 6, fontSize: '0.75rem' }}>using override</span>}
    </div>
  )
}

/* ── Monthly Table ──────────────────────────────────────────────── */
function MonthlyTable({ fund, months, which }) {
  const hasCash = fund.monthly_rows.some(r => r.cash_accumulated > 0)
  const cols = TBL_COLS_BASE.filter(c => {
    if (c.wedgeOnly && !fund.has_cash_wedge) return false
    if (c.cashOnly && !hasCash) return false
    return true
  })
  const rows = fund.monthly_rows
  const roleLabel = fund.role ? ` (${fund.role})` : ''
  const titleColor = FUND_COLORS[which] || '#7ecfff'

  let totIncome = 0, totWithdrawal = 0, totExcess = 0, totSharesDelta = 0, totGrowth = 0, totWedgeDrawn = 0
  rows.forEach(r => {
    totIncome += r.income; totWithdrawal += r.withdrawal; totExcess += r.excess
    totSharesDelta += r.shares_delta; totGrowth += r.growth; totWedgeDrawn += r.wedge_drawn || 0
  })
  const last = rows.length > 0 ? rows[rows.length - 1] : null

  return (
    <div className="dc-table-wrap">
      <div className="dc-table-title" style={{ color: titleColor }}>{fund.ticker}{roleLabel}</div>
      <div className="dc-table-scroll">
        <table className="dc-tbl">
          <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const row = { ...r, _month: months[i] || `Month ${i + 1}` }
              if (row.wedge_drawn === undefined) row.wedge_drawn = 0
              if (row.wedge_bal === undefined) row.wedge_bal = 0
              if (row.cash_accumulated === undefined) row.cash_accumulated = 0
              const isShortfall = row.income < row.withdrawal && row.withdrawal > 0
              return (
                <tr key={i} className={isShortfall ? 'dc-shortfall' : ''}>
                  {cols.map(c => {
                    const v = row[c.key]
                    const cls = c.color ? (v >= 0 ? 'dc-pos' : 'dc-neg') : ''
                    return <td key={c.key} className={cls}>{c.fmt(v)}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              {cols.map(c => {
                if (c.key === '_month') return <td key={c.key} style={{ textAlign: 'left', fontWeight: 700 }}>TOTALS</td>
                if (c.key === 'price' || c.key === 'dist_per_share') return <td key={c.key}></td>
                if (c.key === 'shares') return <td key={c.key}>{last ? fmtS(last.shares) : '0'}</td>
                if (c.key === 'portfolio') return <td key={c.key}>{last ? fmt$(last.portfolio) : '$0'}</td>
                if (c.key === 'income') return <td key={c.key}>${Math.round(totIncome).toLocaleString()}</td>
                if (c.key === 'withdrawal') return <td key={c.key}>${Math.round(totWithdrawal).toLocaleString()}</td>
                if (c.key === 'wedge_drawn') return <td key={c.key}>${Math.round(totWedgeDrawn).toLocaleString()}</td>
                if (c.key === 'wedge_bal') return <td key={c.key}>{last ? fmt$(last.wedge_bal) : '$0'}</td>
                if (c.key === 'cash_accumulated') return <td key={c.key}>{last ? fmt$(last.cash_accumulated) : '$0'}</td>
                if (c.key === 'excess') return <td key={c.key} className={totExcess >= 0 ? 'dc-pos' : 'dc-neg'}>{(totExcess >= 0 ? '+' : '') + '$' + Math.abs(Math.round(totExcess)).toLocaleString()}</td>
                if (c.key === 'shares_delta') return <td key={c.key} className={totSharesDelta >= 0 ? 'dc-pos' : 'dc-neg'}>{(totSharesDelta >= 0 ? '+' : '-') + Math.abs(totSharesDelta).toFixed(2)}</td>
                if (c.key === 'growth') return <td key={c.key} className={totGrowth >= 0 ? 'dc-pos' : 'dc-neg'}>{(totGrowth >= 0 ? '+$' : '-$') + Math.abs(Math.round(totGrowth)).toLocaleString()}</td>
                if (c.key === 'cum_income') return <td key={c.key}>{last ? fmt$(last.cum_income) : '$0'}</td>
                if (c.key === 'roi_dollar') { const v = last ? last.roi_dollar : 0; return <td key={c.key} className={v >= 0 ? 'dc-pos' : 'dc-neg'}>{(v >= 0 ? '+$' : '-$') + Math.abs(Math.round(v)).toLocaleString()}</td> }
                if (c.key === 'roi_pct') { const v = last ? last.roi_pct : 0; return <td key={c.key} className={v >= 0 ? 'dc-pos' : 'dc-neg'}>{(v >= 0 ? '+' : '') + v.toFixed(2) + '%'}</td> }
                return <td key={c.key}></td>
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/* ── Main Component ─────────────────────────────────────────────── */
export default function DistributionCompare() {
  // Mode & comparison
  const [mode, setMode] = useState('historical')
  const [compareType, setCompareType] = useState('income_vs_growth')
  const [market, setMarket] = useState('neutral')
  const [duration, setDuration] = useState('1y')
  const [withdrawal, setWithdrawal] = useState(500)
  const [cashWedge, setCashWedge] = useState(10000)

  // Withdrawal strategy
  const [withdrawalStrategy, setWithdrawalStrategy] = useState('fixed')
  const [withdrawalPct, setWithdrawalPct] = useState(4)
  const [inflationAdj, setInflationAdj] = useState(false)
  const [inflationRate, setInflationRate] = useState(3)
  const [dynamicReducePct, setDynamicReducePct] = useState(25)
  const [dynamicThresholdPct, setDynamicThresholdPct] = useState(80)

  // Fund A & B
  const [tickerA, setTickerA] = useState('')
  const [tickerB, setTickerB] = useState('')
  const [investA, setInvestA] = useState(100000)
  const [investB, setInvestB] = useState(100000)
  const [yieldA, setYieldA] = useState('')
  const [yieldB, setYieldB] = useState('')
  const [infoA, setInfoA] = useState({ text: '', warn: false })
  const [infoB, setInfoB] = useState({ text: '', warn: false })
  const [lookupA, setLookupA] = useState(null)
  const [lookupB, setLookupB] = useState(null)
  const [dripA, setDripA] = useState(true)
  const [dripB, setDripB] = useState(true)

  // Fund C (benchmark)
  const [showFundC, setShowFundC] = useState(false)
  const [tickerC, setTickerC] = useState('')
  const [investC, setInvestC] = useState(100000)
  const [yieldC, setYieldC] = useState('')
  const [infoC, setInfoC] = useState({ text: '', warn: false })
  const [lookupC, setLookupC] = useState(null)
  const [dripC, setDripC] = useState(true)

  // Portfolio tickers
  const [portfolioTickers, setPortfolioTickers] = useState([])

  // Results & scenarios
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [savedScenarios, setSavedScenarios] = useState([])
  const [savedSetups, setSavedSetups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dc-saved-setups') || '[]') } catch { return [] }
  })

  const chartsRendered = useRef(false)

  // Fetch portfolio tickers on mount
  useEffect(() => {
    fetch('/api/pis/portfolio-tickers')
      .then(r => r.json())
      .then(d => setPortfolioTickers(d.tickers || []))
      .catch(() => {})
  }, [])

  // Persist saved setups
  useEffect(() => {
    localStorage.setItem('dc-saved-setups', JSON.stringify(savedSetups))
  }, [savedSetups])

  const fundTitleA = compareType === 'growth_vs_growth' ? 'Fund A \u2014 Growth' : 'Fund A \u2014 Income'
  const fundTitleB = compareType === 'income_vs_income' ? 'Fund B \u2014 Income' : 'Fund B \u2014 Growth'
  const showWedge = compareType !== 'income_vs_income'

  const funds = useMemo(() => {
    if (!results) return []
    const list = [{ key: 'fund_a', which: 'a' }, { key: 'fund_b', which: 'b' }]
    if (results.fund_c) list.push({ key: 'fund_c', which: 'c' })
    return list
  }, [results])

  // Lookup
  const lookup = useCallback((which) => {
    const tickers = { a: tickerA, b: tickerB, c: tickerC }
    const setters = { a: setInfoA, b: setInfoB, c: setInfoC }
    const lookupSetters = { a: setLookupA, b: setLookupB, c: setLookupC }
    const tickerSetters = { a: setTickerA, b: setTickerB, c: setTickerC }
    const ticker = tickers[which].trim().toUpperCase()
    const setInfo = setters[which]
    if (!ticker) { setInfo({ text: 'Enter a ticker.', warn: true }); return }
    setInfo({ text: `Looking up ${ticker}...`, warn: false })
    lookupSetters[which](null)

    fetch(`/api/distribution-compare/lookup?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setInfo({ text: d.error, warn: true }); return }
        let msg = `${ticker}  \u2014  Price: $${d.price.toFixed(2)}  |  TTM Yield: ${d.ttm_yield.toFixed(2)}%`
        if (!d.yield_found) {
          msg += '  (No dividends found \u2014 enter yield override)'
          setInfo({ text: msg, warn: true })
        } else {
          setInfo({ text: msg, warn: false })
        }
        lookupSetters[which]({ price: d.price, ttmYield: d.ttm_yield, yieldFound: d.yield_found })
        tickerSetters[which](d.ticker)
      })
      .catch(e => setInfo({ text: 'Lookup failed: ' + e.message, warn: true }))
  }, [tickerA, tickerB, tickerC])

  // Build request body
  const buildBody = useCallback(() => {
    const tA = tickerA.trim().toUpperCase()
    const tB = tickerB.trim().toUpperCase()

    const body = {
      mode, market,
      comparison_type: compareType,
      monthly_withdrawal: withdrawal,
      cash_wedge: compareType !== 'income_vs_income' ? cashWedge : 0,
      withdrawal_strategy: withdrawalStrategy,
      withdrawal_pct: withdrawalPct,
      inflation_rate: inflationAdj ? inflationRate : null,
      dynamic_reduce_pct: dynamicReducePct,
      dynamic_threshold_pct: dynamicThresholdPct,
      fund_a: { ticker: tA, investment: investA, yield_override: yieldA ? parseFloat(yieldA) : null, drip: dripA },
      fund_b: { ticker: tB, investment: investB, yield_override: yieldB ? parseFloat(yieldB) : null, drip: dripB },
    }

    if (showFundC && tickerC.trim()) {
      body.fund_c = { ticker: tickerC.trim().toUpperCase(), investment: investC, yield_override: yieldC ? parseFloat(yieldC) : null, drip: dripC }
    }

    if (mode === 'simulate') {
      body.duration_months = parseInt(duration.replace('y', '')) * 12
    } else {
      body.duration = duration
    }
    return body
  }, [mode, market, compareType, duration, withdrawal, cashWedge, withdrawalStrategy, withdrawalPct, inflationAdj, inflationRate, dynamicReducePct, dynamicThresholdPct, tickerA, tickerB, investA, investB, yieldA, yieldB, dripA, dripB, showFundC, tickerC, investC, yieldC, dripC])

  // Run comparison
  const run = useCallback(() => {
    const tA = tickerA.trim().toUpperCase()
    const tB = tickerB.trim().toUpperCase()
    if (!tA || !tB) { setError('Please enter both tickers.'); return }
    if (investA <= 0 || investB <= 0) { setError('Investment amounts must be greater than 0.'); return }

    const body = buildBody()
    setLoading(true)
    setError(null)
    setResults(null)
    chartsRendered.current = false

    fetch('/api/distribution-compare/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        setLoading(false)
        if (d.error) { setError(d.error); return }
        setResults(d)
      })
      .catch(e => { setLoading(false); setError('Request failed: ' + e.message) })
  }, [tickerA, tickerB, investA, investB, buildBody])

  // Export
  const exportExcel = useCallback(() => {
    const body = buildBody()
    fetch('/api/distribution-compare/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error || 'Export failed') })
        return r.blob()
      })
      .then(blob => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'distribution_comparison.xlsx'; a.click()
        URL.revokeObjectURL(url)
      })
      .catch(e => setError('Export failed: ' + e.message))
  }, [buildBody])

  // Save/load setups
  const saveSetup = useCallback(() => {
    const name = prompt('Name this setup:', `${tickerA} vs ${tickerB} - ${duration}`)
    if (!name) return
    setSavedSetups(prev => [...prev, {
      name, tickerA, tickerB, investA, investB, yieldA, yieldB, duration, withdrawal, cashWedge,
      mode, compareType, market, withdrawalStrategy, withdrawalPct, inflationAdj, inflationRate,
      dynamicReducePct, dynamicThresholdPct, dripA, dripB, showFundC, tickerC, investC, yieldC, dripC,
    }])
  }, [tickerA, tickerB, investA, investB, yieldA, yieldB, duration, withdrawal, cashWedge, mode, compareType, market, withdrawalStrategy, withdrawalPct, inflationAdj, inflationRate, dynamicReducePct, dynamicThresholdPct, dripA, dripB, showFundC, tickerC, investC, yieldC, dripC])

  const loadSetup = useCallback((s) => {
    setTickerA(s.tickerA || ''); setTickerB(s.tickerB || '')
    setInvestA(s.investA || 100000); setInvestB(s.investB || 100000)
    setYieldA(s.yieldA || ''); setYieldB(s.yieldB || '')
    setDuration(s.duration || '10y'); setWithdrawal(s.withdrawal || 500)
    setCashWedge(s.cashWedge || 10000); setMode(s.mode || 'historical')
    setCompareType(s.compareType || 'income_vs_growth'); setMarket(s.market || 'neutral')
    setWithdrawalStrategy(s.withdrawalStrategy || 'fixed'); setWithdrawalPct(s.withdrawalPct || 4)
    setInflationAdj(s.inflationAdj || false); setInflationRate(s.inflationRate || 3)
    setDynamicReducePct(s.dynamicReducePct || 25); setDynamicThresholdPct(s.dynamicThresholdPct || 80)
    setDripA(s.dripA !== false); setDripB(s.dripB !== false)
    setShowFundC(s.showFundC || false); setTickerC(s.tickerC || '')
    setInvestC(s.investC || 100000); setYieldC(s.yieldC || ''); setDripC(s.dripC !== false)
  }, [])

  // Save scenario
  const saveScenario = useCallback(() => {
    if (!results || savedScenarios.length >= 3) return
    const label = `${results.fund_a.ticker} vs ${results.fund_b.ticker}${results.fund_c ? ' vs ' + results.fund_c.ticker : ''}`
    setSavedScenarios(prev => [...prev, { label, results }])
  }, [results, savedScenarios.length])

  // Crossover analysis
  const crossover = useMemo(() => {
    if (!results) return null
    const fa = results.fund_a, fb = results.fund_b
    const aVals = fa.total_values, bVals = fb.total_values
    if (!aVals.length) return null
    const initSign = Math.sign(aVals[0] - bVals[0])
    for (let i = 1; i < aVals.length; i++) {
      const sign = Math.sign(aVals[i] - bVals[i])
      if (sign !== 0 && sign !== initSign) {
        const leader = sign > 0 ? fa.ticker : fb.ticker
        const other = sign > 0 ? fb.ticker : fa.ticker
        return { idx: i, month: results.months[i], leader, other }
      }
    }
    return null
  }, [results])

  // Income adequacy
  const incomeAdequacy = useMemo(() => {
    if (!results) return null
    const calc = (fund) => {
      const rows = fund.monthly_rows
      const covered = rows.filter(r => r.income >= r.withdrawal && r.withdrawal > 0).length
      const total = rows.filter(r => r.withdrawal > 0).length
      return { covered, total }
    }
    const a = calc(results.fund_a)
    const b = calc(results.fund_b)
    const c = results.fund_c ? calc(results.fund_c) : null
    return { a, b, c }
  }, [results])

  // Render charts
  useEffect(() => {
    if (!results || !window.Plotly || chartsRendered.current) return
    chartsRendered.current = true
    const Plotly = window.Plotly
    const fa = results.fund_a, fb = results.fund_b, fc = results.fund_c
    const months = results.months

    const darkLayout = {
      paper_bgcolor: '#1a1a2e', plot_bgcolor: '#0e1117',
      font: { color: '#c8d6e5', size: 12 },
      margin: { t: 70, r: 20, b: 40, l: 60 },
      hovermode: 'x unified',
      legend: { orientation: 'h', y: 1.18, x: 0.5, xanchor: 'center' },
    }
    const cfg = { responsive: true, displayModeBar: false }

    function makeTrace(x, y, name, color, dash) {
      return { x, y, name, type: 'scatter', mode: 'lines', line: { color, width: 2, dash: dash || 'solid' } }
    }

    const charts = [
      { id: 'dc-chart-portfolio', title: 'Portfolio Value Over Time', ka: 'portfolio_values', kb: 'portfolio_values' },
      { id: 'dc-chart-total', title: 'Total Value (Portfolio + Withdrawn)', ka: 'total_values', kb: 'total_values' },
      { id: 'dc-chart-distributions', title: 'Cumulative Distributions', ka: 'cumulative_distributions', kb: 'cumulative_distributions' },
      { id: 'dc-chart-shares', title: 'Share Count Over Time', ka: 'shares', kb: 'shares' },
      { id: 'dc-chart-price', title: 'Price Trend', ka: null, kb: null },
    ]

    charts.forEach(c => {
      const el = document.getElementById(c.id)
      if (!el) return
      Plotly.purge(el)
      const layout = { ...darkLayout, title: { text: c.title, font: { size: 14, color: '#e0e0e0' } } }
      if (c.id === 'dc-chart-price') layout.yaxis = { title: 'Price ($)', color: '#8899aa' }

      const traces = []
      if (c.ka) {
        traces.push(makeTrace(months, fa[c.ka], fa.ticker, FUND_COLORS.a))
        traces.push(makeTrace(months, fb[c.ka], fb.ticker, FUND_COLORS.b))
        if (fc) traces.push(makeTrace(months, fc[c.ka], fc.ticker, FUND_COLORS.c))
      } else {
        traces.push(makeTrace(months, fa.monthly_rows.map(r => r.price), fa.ticker, FUND_COLORS.a))
        traces.push(makeTrace(months, fb.monthly_rows.map(r => r.price), fb.ticker, FUND_COLORS.b))
        if (fc) traces.push(makeTrace(months, fc.monthly_rows.map(r => r.price), fc.ticker, FUND_COLORS.c))
      }

      // Overlay saved scenarios
      savedScenarios.forEach((sc, si) => {
        const dashes = ['dash', 'dot', 'dashdot']
        const sfa = sc.results.fund_a, sfb = sc.results.fund_b, sfc = sc.results.fund_c
        const sm = sc.results.months
        if (c.ka) {
          traces.push(makeTrace(sm, sfa[c.ka], `${sfa.ticker} (S${si + 1})`, FUND_COLORS.a, dashes[si]))
          traces.push(makeTrace(sm, sfb[c.ka], `${sfb.ticker} (S${si + 1})`, FUND_COLORS.b, dashes[si]))
          if (sfc) traces.push(makeTrace(sm, sfc[c.ka], `${sfc.ticker} (S${si + 1})`, FUND_COLORS.c, dashes[si]))
        } else {
          traces.push(makeTrace(sm, sfa.monthly_rows.map(r => r.price), `${sfa.ticker} (S${si + 1})`, FUND_COLORS.a, dashes[si]))
          traces.push(makeTrace(sm, sfb.monthly_rows.map(r => r.price), `${sfb.ticker} (S${si + 1})`, FUND_COLORS.b, dashes[si]))
          if (sfc) traces.push(makeTrace(sm, sfc.monthly_rows.map(r => r.price), `${sfc.ticker} (S${si + 1})`, FUND_COLORS.c, dashes[si]))
        }
      })

      // Crossover annotation on total value chart
      if (c.id === 'dc-chart-total' && crossover) {
        layout.annotations = [{
          x: crossover.month, y: fa.total_values[crossover.idx],
          text: `${crossover.leader} overtakes`, showarrow: true,
          arrowhead: 2, arrowcolor: '#ffc107', font: { color: '#ffc107', size: 11 },
          bgcolor: 'rgba(26,26,46,0.8)', bordercolor: '#ffc107',
        }]
      }

      Plotly.newPlot(el, traces, layout, cfg)
    })
  }, [results, savedScenarios, crossover])

  // ── Grade panel + summary cards ──────────────────────────────────
  let gradePanel = null
  let summaryCards = null
  if (results) {
    const fa = results.fund_a, fb = results.fund_b, fc = results.fund_c
    const hasFc = !!fc
    const aTotal = fa.final_total, bTotal = fb.final_total
    const cTotal = fc ? fc.final_total : 0

    // Determine winner
    const vals = [{ t: fa.ticker, v: aTotal, cls: 'dc-grade-a' }, { t: fb.ticker, v: bTotal, cls: 'dc-grade-b' }]
    if (fc) vals.push({ t: fc.ticker, v: cTotal, cls: 'dc-grade-c' })
    vals.sort((a, b) => b.v - a.v)

    let gradeClass, gradeLabel, verdictText
    if (vals[0].v > vals[1].v * 1.02) {
      gradeClass = vals[0].cls; gradeLabel = vals[0].t
      verdictText = `${vals[0].t} wins \u2014 higher total value by ${fmt$(vals[0].v - vals[1].v)}`
    } else {
      gradeClass = 'dc-grade-tie'; gradeLabel = 'TIE'
      verdictText = 'Essentially tied \u2014 total values within 2% of each other'
    }

    // Scores
    const calcGrade = (fund) => {
      let score = 0
      const others = [fa, fb, fc].filter(f => f && f !== fund)
      if (others.every(o => fund.final_total > o.final_total)) score++
      if (others.every(o => fund.final_portfolio > o.final_portfolio)) score++
      if (others.every(o => fund.final_distributions > o.final_distributions)) score++
      if (others.every(o => fund.total_shares_bought > o.total_shares_bought)) score++
      if (others.every(o => fund.total_shares_sold < o.total_shares_sold)) score++
      return score >= 4 ? 'A' : score >= 3 ? 'B' : score >= 2 ? 'C' : 'D'
    }
    const aGrade = calcGrade(fa), bGrade = calcGrade(fb), cGrade = fc ? calcGrade(fc) : null

    const endSharesA = fa.shares.length ? fa.shares[fa.shares.length - 1] : 0
    const endSharesB = fb.shares.length ? fb.shares[fb.shares.length - 1] : 0
    const endSharesC = fc && fc.shares.length ? fc.shares[fc.shares.length - 1] : 0
    const roiPctA = fa.investment ? (fa.final_total - fa.investment) / fa.investment * 100 : 0
    const roiPctB = fb.investment ? (fb.final_total - fb.investment) / fb.investment * 100 : 0
    const roiPctC = fc && fc.investment ? (fc.final_total - fc.investment) / fc.investment * 100 : 0

    const compRows = [
      { label: 'Investment', a: fmt$(fa.investment), b: fmt$(fb.investment), c: fc ? fmt$(fc.investment) : '' },
      { label: 'Initial Shares', a: fmtS(fa.initial_shares), b: fmtS(fb.initial_shares), c: fc ? fmtS(fc.initial_shares) : '' },
      { label: 'End Shares', a: fmtS(endSharesA), b: fmtS(endSharesB), c: fc ? fmtS(endSharesC) : '', aClass: better(endSharesA, endSharesB), bClass: better(endSharesB, endSharesA) },
      { label: 'Shares Bought', a: '+' + fmtS(fa.total_shares_bought), b: '+' + fmtS(fb.total_shares_bought), c: fc ? '+' + fmtS(fc.total_shares_bought) : '', aClass: better(fa.total_shares_bought, fb.total_shares_bought), bClass: better(fb.total_shares_bought, fa.total_shares_bought) },
      { label: 'Shares Sold', a: '-' + fmtS(fa.total_shares_sold), b: '-' + fmtS(fb.total_shares_sold), c: fc ? '-' + fmtS(fc.total_shares_sold) : '', aClass: better(fa.total_shares_sold, fb.total_shares_sold, true), bClass: better(fb.total_shares_sold, fa.total_shares_sold, true) },
      { label: 'Total Distributions', a: fmt$(fa.final_distributions), b: fmt$(fb.final_distributions), c: fc ? fmt$(fc.final_distributions) : '', aClass: better(fa.final_distributions, fb.final_distributions), bClass: better(fb.final_distributions, fa.final_distributions) },
      { label: 'Total Withdrawn', a: fmt$(fa.final_withdrawn), b: fmt$(fb.final_withdrawn), c: fc ? fmt$(fc.final_withdrawn) : '' },
      { label: 'Final Portfolio Value', a: fmt$(fa.final_portfolio), b: fmt$(fb.final_portfolio), c: fc ? fmt$(fc.final_portfolio) : '', aClass: better(fa.final_portfolio, fb.final_portfolio), bClass: better(fb.final_portfolio, fa.final_portfolio) },
      { label: 'Total Value', a: fmt$(fa.final_total), b: fmt$(fb.final_total), c: fc ? fmt$(fc.final_total) : '', aClass: better(fa.final_total, fb.final_total), bClass: better(fb.final_total, fa.final_total), bold: true },
      { label: 'Total ROI %', a: fmtPct(roiPctA), b: fmtPct(roiPctB), c: fc ? fmtPct(roiPctC) : '', aClass: better(roiPctA, roiPctB), bClass: better(roiPctB, roiPctA) },
    ]

    // Income adequacy row
    if (incomeAdequacy) {
      compRows.push({
        label: 'Income Covered Withdrawal',
        a: `${incomeAdequacy.a.covered}/${incomeAdequacy.a.total} months`,
        b: `${incomeAdequacy.b.covered}/${incomeAdequacy.b.total} months`,
        c: incomeAdequacy.c ? `${incomeAdequacy.c.covered}/${incomeAdequacy.c.total} months` : '',
        aClass: better(incomeAdequacy.a.covered, incomeAdequacy.b.covered),
        bClass: better(incomeAdequacy.b.covered, incomeAdequacy.a.covered),
      })
    }

    // Risk metrics rows
    const rm = (fund) => fund.risk_metrics || {}
    if (rm(fa).max_drawdown_pct != null) {
      compRows.push({ label: 'Max Drawdown', a: rm(fa).max_drawdown_pct.toFixed(1) + '%', b: rm(fb).max_drawdown_pct != null ? rm(fb).max_drawdown_pct.toFixed(1) + '%' : 'N/A', c: fc && rm(fc).max_drawdown_pct != null ? rm(fc).max_drawdown_pct.toFixed(1) + '%' : '', aClass: better(rm(fa).max_drawdown_pct, rm(fb).max_drawdown_pct || 0, true), bClass: better(rm(fb).max_drawdown_pct || 0, rm(fa).max_drawdown_pct, true) })
      if (rm(fa).recovery_months != null || rm(fb).recovery_months != null) {
        compRows.push({ label: 'Recovery (months)', a: rm(fa).recovery_months != null ? rm(fa).recovery_months : 'N/R', b: rm(fb).recovery_months != null ? rm(fb).recovery_months : 'N/R', c: fc ? (rm(fc).recovery_months != null ? rm(fc).recovery_months : 'N/R') : '' })
      }
      if (rm(fa).ulcer_index != null) {
        compRows.push({ label: 'Ulcer Index', a: rm(fa).ulcer_index, b: rm(fb).ulcer_index != null ? rm(fb).ulcer_index : 'N/A', c: fc && rm(fc).ulcer_index != null ? rm(fc).ulcer_index : '', aClass: better(rm(fa).ulcer_index || 999, rm(fb).ulcer_index || 999, true), bClass: better(rm(fb).ulcer_index || 999, rm(fa).ulcer_index || 999, true) })
      }
    }

    // Crossover callout
    const crossoverText = crossover ? `${crossover.leader} overtakes ${crossover.other} at ${crossover.month}` : null

    gradePanel = (
      <div className="dc-grade-panel">
        <div className="dc-grade-header">
          <div className={`dc-grade-badge ${gradeClass}`}>{gradeLabel}</div>
          <div className="dc-grade-text">
            <div className="dc-grade-winner">{verdictText}</div>
            <div>
              {fa.ticker}: <strong>{aGrade}</strong> &nbsp;|&nbsp; {fb.ticker}: <strong>{bGrade}</strong>
              {fc && <>&nbsp;|&nbsp; {fc.ticker}: <strong>{cGrade}</strong></>}
              &nbsp;(based on 5 withdrawal metrics)
            </div>
            {crossoverText && <div style={{ color: '#ffc107', fontSize: '0.85rem', marginTop: 4 }}>{crossoverText}</div>}
            {results.data_start && <div style={{ color: '#6b7b8d', fontSize: '0.82rem', marginTop: 4 }}>Historical data from {results.data_start}</div>}
          </div>
        </div>
        <table className="dc-comp-tbl">
          <thead><tr><th>Metric</th><th>{fa.ticker}</th><th>{fb.ticker}</th>{hasFc && <th>{fc.ticker}</th>}</tr></thead>
          <tbody>
            {compRows.map((r, i) => (
              <tr key={i}>
                <td>{r.bold ? <strong>{r.label}</strong> : r.label}</td>
                <td className={r.aClass || ''} style={r.bold ? { fontWeight: 700 } : undefined}>{r.a}</td>
                <td className={r.bClass || ''} style={r.bold ? { fontWeight: 700 } : undefined}>{r.b}</td>
                {hasFc && <td>{r.c}</td>}
              </tr>
            ))}
            <tr>
              <td>Depleted?</td>
              <td style={{ color: fa.depleted ? '#ff6b6b' : '#00e89a' }}>
                {fa.depleted ? (fa.depletion_month != null ? `Month ${fa.depletion_month + 1}` : 'YES') : 'No'}
              </td>
              <td style={{ color: fb.depleted ? '#ff6b6b' : '#00e89a' }}>
                {fb.depleted ? (fb.depletion_month != null ? `Month ${fb.depletion_month + 1}` : 'YES') : 'No'}
              </td>
              {hasFc && <td style={{ color: fc.depleted ? '#ff6b6b' : '#00e89a' }}>
                {fc.depleted ? (fc.depletion_month != null ? `Month ${fc.depletion_month + 1}` : 'YES') : 'No'}
              </td>}
            </tr>
            {results.cash_wedge_initial > 0 && <>
              <tr><td>Cash Wedge (initial)</td><td colSpan={hasFc ? 3 : 2}>{fmt$(results.cash_wedge_initial)}</td></tr>
              <tr>
                <td>Cash Wedge Remaining</td>
                <td>{fa.cash_wedge_remaining != null ? fmt$(fa.cash_wedge_remaining) : 'N/A'}</td>
                <td>{fb.cash_wedge_remaining != null ? fmt$(fb.cash_wedge_remaining) : 'N/A'}</td>
                {hasFc && <td>{fc.cash_wedge_remaining != null ? fmt$(fc.cash_wedge_remaining) : 'N/A'}</td>}
              </tr>
            </>}
          </tbody>
        </table>
      </div>
    )

    const cardData = [
      { label: 'Final Portfolio', a: fmt$(fa.final_portfolio), b: fmt$(fb.final_portfolio), c: fc ? fmt$(fc.final_portfolio) : null },
      { label: 'Total Withdrawn', a: fmt$(fa.final_withdrawn), b: fmt$(fb.final_withdrawn), c: fc ? fmt$(fc.final_withdrawn) : null },
      { label: 'Total Distributions', a: fmt$(fa.final_distributions), b: fmt$(fb.final_distributions), c: fc ? fmt$(fc.final_distributions) : null },
      { label: 'Total Value', a: fmt$(fa.final_total), b: fmt$(fb.final_total), c: fc ? fmt$(fc.final_total) : null },
      { label: 'Initial Shares', a: fmtS(fa.initial_shares), b: fmtS(fb.initial_shares), c: fc ? fmtS(fc.initial_shares) : null },
      { label: 'Shares Remaining', a: fmtS(endSharesA), b: fmtS(endSharesB), c: fc ? fmtS(endSharesC) : null },
    ]

    summaryCards = (
      <div className="dc-summary-cards">
        {cardData.map((card, i) => (
          <div className="dc-scard" key={i}>
            <div className="dc-scard-label">{card.label}</div>
            <div className="dc-scard-row">
              <div><div className="dc-scard-val" style={{ color: FUND_COLORS.a }}>{card.a}</div><div className="dc-scard-sub">{fa.ticker}</div></div>
              <div><div className="dc-scard-val" style={{ color: FUND_COLORS.b }}>{card.b}</div><div className="dc-scard-sub">{fb.ticker}</div></div>
              {card.c != null && <div><div className="dc-scard-val" style={{ color: FUND_COLORS.c }}>{card.c}</div><div className="dc-scard-sub">{fc.ticker}</div></div>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="page">
      <h2>Distribution Comparison</h2>

      {/* Saved Setups */}
      {savedSetups.length > 0 && (
        <div className="dc-saved-strip">
          <span style={{ color: '#8899aa', fontSize: '0.82rem', marginRight: 8 }}>Saved:</span>
          {savedSetups.map((s, i) => (
            <span key={i} className="dc-scenario-chip">
              <span style={{ cursor: 'pointer' }} onClick={() => loadSetup(s)}>{s.name}</span>
              <span style={{ cursor: 'pointer', marginLeft: 6, color: '#ff6b6b' }} onClick={() => setSavedSetups(prev => prev.filter((_, j) => j !== i))}>&times;</span>
            </span>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="dc-controls">
        {/* Mode */}
        <div className="dc-mode-row">
          <strong style={{ color: '#e0e0e0', marginRight: 8 }}>Mode:</strong>
          <label><input type="radio" name="dc-mode" value="historical" checked={mode === 'historical'} onChange={() => setMode('historical')} /> Historical</label>
          <label><input type="radio" name="dc-mode" value="simulate" checked={mode === 'simulate'} onChange={() => setMode('simulate')} /> Simulation</label>
        </div>

        {/* Compare Type */}
        <div className="dc-mode-row">
          <strong style={{ color: '#e0e0e0', marginRight: 8 }}>Compare:</strong>
          <label><input type="radio" name="dc-compare" value="income_vs_growth" checked={compareType === 'income_vs_growth'} onChange={() => setCompareType('income_vs_growth')} /> Income vs Growth</label>
          <label><input type="radio" name="dc-compare" value="income_vs_income" checked={compareType === 'income_vs_income'} onChange={() => setCompareType('income_vs_income')} /> Income vs Income</label>
          <label><input type="radio" name="dc-compare" value="growth_vs_growth" checked={compareType === 'growth_vs_growth'} onChange={() => setCompareType('growth_vs_growth')} /> Growth vs Growth</label>
        </div>

        {/* Market (sim only) */}
        {mode === 'simulate' && (
          <div className="dc-market-row" style={{ width: '100%' }}>
            <strong style={{ color: '#e0e0e0', marginRight: 8 }}>Market:</strong>
            <label><input type="radio" name="dc-market" value="neutral" checked={market === 'neutral'} onChange={() => setMarket('neutral')} /> Neutral</label>
            <label><input type="radio" name="dc-market" value="bullish" checked={market === 'bullish'} onChange={() => setMarket('bullish')} /> Bullish</label>
            <label><input type="radio" name="dc-market" value="bearish" checked={market === 'bearish'} onChange={() => setMarket('bearish')} /> Bearish</label>
          </div>
        )}

        {/* Fund Cards */}
        <div className="dc-funds">
          <div className="dc-fund-card">
            <div className="dc-fund-title">{fundTitleA}</div>
            <TickerCombo value={tickerA} onChange={setTickerA} onLookup={() => lookup('a')} info={infoA} portfolioTickers={portfolioTickers} />
            <div className="dc-field">
              <label>Investment ($)</label>
              <input type="number" value={investA} onChange={e => setInvestA(parseFloat(e.target.value) || 0)} min="1" step="1000" />
            </div>
            <div className="dc-field">
              <label>Yield Override (%) <span style={{ color: '#6b7b8d' }}>\u2014 leave blank to use detected</span></label>
              <input type="number" value={yieldA} onChange={e => setYieldA(e.target.value)} placeholder="Auto" step="0.01" min="0" />
            </div>
            <label style={{ color: '#8899aa', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={dripA} onChange={e => setDripA(e.target.checked)} style={{ marginRight: 4, accentColor: '#7ecfff' }} />
              Reinvest excess dividends (DRIP)
            </label>
            <DistEstimate lookupData={lookupA} investment={investA} yieldOverride={yieldA} />
          </div>

          <div className="dc-fund-card">
            <div className="dc-fund-title">{fundTitleB}</div>
            <TickerCombo value={tickerB} onChange={setTickerB} onLookup={() => lookup('b')} info={infoB} portfolioTickers={portfolioTickers} />
            <div className="dc-field">
              <label>Investment ($)</label>
              <input type="number" value={investB} onChange={e => setInvestB(parseFloat(e.target.value) || 0)} min="1" step="1000" />
            </div>
            <div className="dc-field">
              <label>Yield Override (%) <span style={{ color: '#6b7b8d' }}>\u2014 leave blank to use detected</span></label>
              <input type="number" value={yieldB} onChange={e => setYieldB(e.target.value)} placeholder="Auto" step="0.01" min="0" />
            </div>
            <label style={{ color: '#8899aa', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={dripB} onChange={e => setDripB(e.target.checked)} style={{ marginRight: 4, accentColor: '#7ecfff' }} />
              Reinvest excess dividends (DRIP)
            </label>
            <DistEstimate lookupData={lookupB} investment={investB} yieldOverride={yieldB} />
          </div>

          {showFundC && (
            <div className="dc-fund-card" style={{ borderColor: '#ff6b6b33' }}>
              <div className="dc-fund-title" style={{ color: FUND_COLORS.c }}>Fund C \u2014 Benchmark
                <span style={{ cursor: 'pointer', float: 'right', color: '#ff6b6b', fontSize: '0.85rem' }} onClick={() => setShowFundC(false)}>&times; Remove</span>
              </div>
              <TickerCombo value={tickerC} onChange={setTickerC} onLookup={() => lookup('c')} info={infoC} portfolioTickers={portfolioTickers} />
              <div className="dc-field">
                <label>Investment ($)</label>
                <input type="number" value={investC} onChange={e => setInvestC(parseFloat(e.target.value) || 0)} min="1" step="1000" />
              </div>
              <div className="dc-field">
                <label>Yield Override (%)</label>
                <input type="number" value={yieldC} onChange={e => setYieldC(e.target.value)} placeholder="Auto" step="0.01" min="0" />
              </div>
              <label style={{ color: '#8899aa', fontSize: '0.82rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={dripC} onChange={e => setDripC(e.target.checked)} style={{ marginRight: 4, accentColor: '#7ecfff' }} />
                Reinvest excess dividends (DRIP)
              </label>
              <DistEstimate lookupData={lookupC} investment={investC} yieldOverride={yieldC} />
            </div>
          )}
        </div>

        {!showFundC && (
          <button className="dc-lookup-btn" onClick={() => setShowFundC(true)} style={{ alignSelf: 'flex-start' }}>+ Add Benchmark (Fund C)</button>
        )}

        {/* Withdrawal Strategy */}
        <div className="dc-global-row">
          <div className="dc-field">
            <label>Withdrawal Strategy</label>
            <select value={withdrawalStrategy} onChange={e => setWithdrawalStrategy(e.target.value)}>
              <option value="fixed">Fixed Amount</option>
              <option value="percentage">Percentage-Based</option>
              <option value="dynamic">Dynamic (Reduce on Drawdown)</option>
            </select>
          </div>
          {withdrawalStrategy !== 'percentage' && (
            <div className="dc-field">
              <label>Monthly Withdrawal ($)</label>
              <input type="number" value={withdrawal} onChange={e => setWithdrawal(parseFloat(e.target.value) || 0)} min="0" step="50" />
            </div>
          )}
          {withdrawalStrategy === 'percentage' && (
            <div className="dc-field">
              <label>Annual Withdrawal (%)</label>
              <input type="number" value={withdrawalPct} onChange={e => setWithdrawalPct(parseFloat(e.target.value) || 0)} min="0.1" max="20" step="0.5" />
            </div>
          )}
          {withdrawalStrategy === 'dynamic' && <>
            <div className="dc-field">
              <label>Reduce by (%)</label>
              <input type="number" value={dynamicReducePct} onChange={e => setDynamicReducePct(parseFloat(e.target.value) || 0)} min="1" max="90" step="5" />
            </div>
            <div className="dc-field">
              <label>When portfolio below (% of initial)</label>
              <input type="number" value={dynamicThresholdPct} onChange={e => setDynamicThresholdPct(parseFloat(e.target.value) || 0)} min="10" max="100" step="5" />
            </div>
          </>}
        </div>

        {/* Inflation + Duration + Wedge + Run */}
        <div className="dc-global-row">
          <div className="dc-field">
            <label>Duration</label>
            <select value={duration} onChange={e => setDuration(e.target.value)}>
              {DURATION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {mode === 'historical' && <option value="max">Max (Historical)</option>}
            </select>
          </div>
          {showWedge && (
            <div className="dc-field">
              <label>Cash Wedge ($)</label>
              <input type="number" value={cashWedge} onChange={e => setCashWedge(parseFloat(e.target.value) || 0)} min="0" step="1000" />
            </div>
          )}
          <div className="dc-field" style={{ minWidth: 'auto' }}>
            <label style={{ visibility: 'hidden' }}>_</label>
            <label style={{ color: '#8899aa', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={inflationAdj} onChange={e => setInflationAdj(e.target.checked)} style={{ marginRight: 4, accentColor: '#7ecfff' }} />
              Inflation adjust
            </label>
          </div>
          {inflationAdj && (
            <div className="dc-field" style={{ minWidth: 80 }}>
              <label>Rate (%/yr)</label>
              <input type="number" value={inflationRate} onChange={e => setInflationRate(parseFloat(e.target.value) || 0)} min="0" max="20" step="0.5" />
            </div>
          )}
          <button className="dc-run-btn" onClick={run} disabled={loading}>Run Comparison</button>
        </div>

        {/* Action buttons */}
        <div className="dc-global-row" style={{ gap: 10 }}>
          <button className="dc-lookup-btn" onClick={saveSetup}>Save Setup</button>
          {results && <button className="dc-lookup-btn" onClick={saveScenario} disabled={savedScenarios.length >= 3}>Save Scenario ({savedScenarios.length}/3)</button>}
          {results && <button className="dc-lookup-btn" onClick={exportExcel}>Export to Excel</button>}
          {savedScenarios.length > 0 && <button className="dc-lookup-btn" style={{ borderColor: '#ff6b6b44', color: '#ff6b6b' }} onClick={() => setSavedScenarios([])}>Clear Scenarios</button>}
        </div>
      </div>

      {/* Saved Scenarios Strip */}
      {savedScenarios.length > 0 && (
        <div className="dc-saved-strip" style={{ marginTop: 8 }}>
          <span style={{ color: '#8899aa', fontSize: '0.82rem', marginRight: 8 }}>Scenarios:</span>
          {savedScenarios.map((s, i) => (
            <span key={i} className="dc-scenario-chip">
              <span style={{ borderBottom: `2px ${['dashed', 'dotted', 'dashed'][i]} ${FUND_COLORS.a}` }}>{s.label} (S{i + 1})</span>
              <span style={{ cursor: 'pointer', marginLeft: 6, color: '#ff6b6b' }} onClick={() => setSavedScenarios(prev => prev.filter((_, j) => j !== i))}>&times;</span>
            </span>
          ))}
        </div>
      )}

      {/* Spinner */}
      {loading && (
        <div className="dc-spinner show">
          <div className="dc-spin-icon"></div>
          <div style={{ color: '#7ecfff', marginTop: 10 }}>Running comparison&hellip;</div>
        </div>
      )}

      {error && <div className="dc-error" style={{ display: 'block' }}>{error}</div>}

      {/* Results */}
      {results && (
        <div className="dc-results">
          {gradePanel}
          {summaryCards}
          <div className="dc-charts">
            <div className="dc-chart-wrap"><div id="dc-chart-portfolio" style={{ height: 320 }}></div></div>
            <div className="dc-chart-wrap"><div id="dc-chart-total" style={{ height: 320 }}></div></div>
            <div className="dc-chart-wrap"><div id="dc-chart-distributions" style={{ height: 320 }}></div></div>
            <div className="dc-chart-wrap"><div id="dc-chart-shares" style={{ height: 320 }}></div></div>
            <div className="dc-chart-wrap"><div id="dc-chart-price" style={{ height: 320 }}></div></div>
          </div>
          <div className="dc-tables">
            <MonthlyTable fund={results.fund_a} months={results.months} which="a" />
            <MonthlyTable fund={results.fund_b} months={results.months} which="b" />
            {results.fund_c && <MonthlyTable fund={results.fund_c} months={results.months} which="c" />}
          </div>
        </div>
      )}
    </div>
  )
}
