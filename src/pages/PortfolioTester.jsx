import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Plot from 'react-plotly.js'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'

const PRESETS = [
  { label: '6M',  years: 0.5 },
  { label: '1Y',  years: 1 },
  { label: '3Y',  years: 3 },
  { label: '5Y',  years: 5 },
  { label: '10Y', years: 10 },
  { label: '15Y', years: 15 },
  { label: '20Y', years: 20 },
  { label: '25Y', years: 25 },
]

const MAX_TICKERS = 75

const fmtPct = (v, digits = 2) =>
  v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
const fmtNum = (v, digits = 2) =>
  v == null || !isFinite(v) ? '—' : Number(v).toFixed(digits)
const fmtMoney = (v) =>
  v == null || !isFinite(v) ? '—' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const fmtInt = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v))

function todayISO() { return new Date().toISOString().slice(0, 10) }
function subYearsISO(iso, yrs) {
  const d = new Date(iso)
  d.setFullYear(d.getFullYear() - Math.floor(yrs))
  if (yrs % 1 !== 0) d.setMonth(d.getMonth() - Math.round((yrs % 1) * 12))
  return d.toISOString().slice(0, 10)
}

function PortfolioEditor({ label, portfolio, onChange, onLoadCurrent, currentAvailable, categories, onFilterLoad, currentHoldings, onPickApply }) {
  const [input, setInput] = useState('')
  const [wt, setWt] = useState('')
  const [filter, setFilter] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())

  // Reset picker selection every time it reopens so it isn't stale
  useEffect(() => {
    if (pickerOpen) {
      setPicked(new Set(portfolio.holdings.map(h => h.ticker)))
      setPickerSearch('')
    }
  }, [pickerOpen])  // eslint-disable-line react-hooks/exhaustive-deps

  const visiblePicker = (currentHoldings || []).filter(h => {
    if (!pickerSearch.trim()) return true
    return h.ticker.toUpperCase().includes(pickerSearch.trim().toUpperCase())
  })

  const togglePick = (t) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }
  const pickAll = () => setPicked(new Set(visiblePicker.map(h => h.ticker)))
  const pickNone = () => setPicked(new Set())

  const totalWeight = portfolio.holdings.reduce((s, h) => s + (Number(h.weight) || 0), 0)
  const wtDelta = Math.abs(totalWeight - 1)
  const wtOK = wtDelta < 0.001

  const addRow = () => {
    const t = input.trim().toUpperCase()
    if (!t) return
    if (portfolio.holdings.length >= MAX_TICKERS) return
    if (portfolio.holdings.some(h => h.ticker === t)) return
    const w = wt === '' ? 0 : Number(wt) / 100
    onChange({ ...portfolio, holdings: [...portfolio.holdings, { ticker: t, weight: w }] })
    setInput(''); setWt('')
  }

  const removeRow = (t) =>
    onChange({ ...portfolio, holdings: portfolio.holdings.filter(h => h.ticker !== t) })

  const updateWeight = (t, w) =>
    onChange({
      ...portfolio,
      holdings: portfolio.holdings.map(h => h.ticker === t ? { ...h, weight: (Number(w) || 0) / 100 } : h),
    })

  const equalWeight = () => {
    const n = portfolio.holdings.length
    if (!n) return
    onChange({
      ...portfolio,
      holdings: portfolio.holdings.map(h => ({ ...h, weight: 1 / n })),
    })
  }

  const normalize = () => {
    const sum = portfolio.holdings.reduce((s, h) => s + Number(h.weight || 0), 0)
    if (sum <= 0) return
    onChange({
      ...portfolio,
      holdings: portfolio.holdings.map(h => ({ ...h, weight: (Number(h.weight) || 0) / sum })),
    })
  }

  const clearAll = () => onChange({ ...portfolio, holdings: [] })

  return (
    <div className="card" style={{ padding: '0.75rem', flex: 1, minWidth: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>{label}</span>
        <input
          value={portfolio.name}
          onChange={e => onChange({ ...portfolio, name: e.target.value })}
          style={{
            flex: 1, padding: '0.3rem 0.5rem', background: '#1a1a2e',
            border: '1px solid #3a3a5c', borderRadius: 4, color: '#e0e0e0', fontSize: '0.9rem',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') addRow() }}
          placeholder="Ticker"
          maxLength={10}
          style={{
            width: 90, textTransform: 'uppercase', padding: '0.3rem 0.5rem',
            background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 4, color: '#e0e0e0', fontSize: '0.85rem',
          }}
        />
        <input
          value={wt}
          onChange={e => setWt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addRow() }}
          placeholder="Wt %"
          style={{
            width: 70, padding: '0.3rem 0.5rem',
            background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 4, color: '#e0e0e0', fontSize: '0.85rem',
          }}
        />
        <button className="btn btn-primary" style={{ padding: '0.3rem 0.75rem' }} onClick={addRow}>Add</button>
        <button className="btn" style={{ padding: '0.3rem 0.7rem' }} onClick={equalWeight} title="Set every row to equal weight">Equal</button>
        <button className="btn" style={{ padding: '0.3rem 0.7rem' }} onClick={normalize} title="Scale weights to sum 100%">Normalize</button>
        <button className="btn" style={{ padding: '0.3rem 0.7rem', color: '#ff9090' }} onClick={clearAll}>Clear</button>
      </div>

      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          style={{ padding: '0.3rem 0.7rem', color: '#90caf9' }}
          disabled={!currentAvailable}
          onClick={() => onLoadCurrent('')}
          title="Replace with your current holdings, weighted by current value"
        >
          Load All Current
        </button>
        <button
          className="btn"
          style={{ padding: '0.3rem 0.7rem', color: '#90caf9' }}
          disabled={!currentAvailable}
          onClick={() => setPickerOpen(o => !o)}
          title="Cherry-pick individual tickers from your current holdings"
        >
          {pickerOpen ? 'Close Picker' : 'Pick Tickers…'}
        </button>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          disabled={categories.length === 0}
          title={categories.length === 0 ? 'Define categories on the Categories page to enable filtered loading' : ''}
          style={{
            padding: '0.3rem 0.5rem', background: '#1a1a2e', border: '1px solid #3a3a5c',
            borderRadius: 4, color: categories.length === 0 ? '#556677' : '#e0e0e0', fontSize: '0.82rem',
            cursor: categories.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          <option value="">
            {categories.length === 0 ? 'No categories defined' : 'Filter by category…'}
          </option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          className="btn"
          style={{ padding: '0.3rem 0.7rem' }}
          disabled={!filter || categories.length === 0}
          onClick={() => onFilterLoad(filter)}
        >
          Load Filtered
        </button>
      </div>

      {pickerOpen && (
        <div style={{
          border: '1px solid #3a3a5c', borderRadius: 4, marginBottom: '0.5rem',
          background: '#0f0f1e', padding: '0.5rem',
        }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#8899aa', fontSize: '0.78rem' }}>
              Pick tickers from your current holdings ({currentHoldings?.length || 0} total):
            </span>
            <div style={{ flex: 1 }} />
            <input
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
              placeholder="Search ticker…"
              style={{
                width: 120, padding: '0.2rem 0.4rem', background: '#1a1a2e',
                border: '1px solid #3a3a5c', borderRadius: 3, color: '#e0e0e0', fontSize: '0.78rem',
              }}
            />
            <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={pickAll}>
              Select All{pickerSearch ? ' Filtered' : ''}
            </button>
            <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={pickNone}>
              Select None
            </button>
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #2a2a44', borderRadius: 3 }}>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1a1a2e', color: '#8899aa' }}>
                  <th style={{ padding: '0.25rem 0.5rem', width: 28 }}></th>
                  <th style={{ padding: '0.25rem 0.5rem', textAlign: 'left' }}>Ticker</th>
                  <th style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>Current Wt %</th>
                  <th style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {visiblePicker.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '0.5rem', color: '#556677', textAlign: 'center' }}>
                    {currentHoldings?.length ? 'No tickers match your search' : 'No current holdings available'}
                  </td></tr>
                )}
                {visiblePicker.map(h => (
                  <tr
                    key={h.ticker}
                    style={{ borderTop: '1px solid #2a2a44', cursor: 'pointer' }}
                    onClick={() => togglePick(h.ticker)}
                  >
                    <td style={{ padding: '0.25rem 0.5rem', textAlign: 'center' }}>
                      <input type="checkbox" checked={picked.has(h.ticker)} onChange={() => togglePick(h.ticker)} onClick={e => e.stopPropagation()} />
                    </td>
                    <td style={{ padding: '0.25rem 0.5rem' }}>{h.ticker}</td>
                    <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                      {h.weight != null ? (h.weight * 100).toFixed(2) + '%' : '—'}
                    </td>
                    <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>
                      {h.current_value != null ? '$' + Number(h.current_value).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#8899aa', fontSize: '0.78rem' }}>
              {picked.size} selected
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="btn btn-primary"
              disabled={picked.size === 0}
              onClick={() => { onPickApply([...picked], 'replace'); setPickerOpen(false) }}
              style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}
              title="Replace this portfolio with the selected tickers, weighted by current value"
            >
              Replace Portfolio
            </button>
            <button
              className="btn"
              disabled={picked.size === 0}
              onClick={() => { onPickApply([...picked], 'add'); setPickerOpen(false) }}
              style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}
              title="Add selected tickers to this portfolio (existing ones keep their weights; new ones are equal-weighted into the remainder)"
            >
              Add to Portfolio
            </button>
            <button className="btn" onClick={() => setPickerOpen(false)} style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #2a2a44', borderRadius: 4 }}>
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#1a1a2e', color: '#8899aa' }}>
              <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left' }}>Ticker</th>
              <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Weight %</th>
              <th style={{ padding: '0.3rem 0.5rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '0.75rem', color: '#556677', textAlign: 'center' }}>No tickers yet</td></tr>
            )}
            {portfolio.holdings.map(h => (
              <tr key={h.ticker} style={{ borderTop: '1px solid #2a2a44' }}>
                <td style={{ padding: '0.3rem 0.5rem' }}>{h.ticker}</td>
                <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>
                  <input
                    type="number"
                    value={(Number(h.weight) * 100).toFixed(2)}
                    onChange={e => updateWeight(h.ticker, e.target.value)}
                    style={{
                      width: 70, textAlign: 'right', padding: '0.2rem 0.35rem',
                      background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 3, color: '#e0e0e0',
                    }}
                  />
                </td>
                <td style={{ padding: '0.3rem 0.5rem', width: 30 }}>
                  <button
                    onClick={() => removeRow(h.ticker)}
                    style={{
                      background: 'transparent', border: 'none', color: '#ff6b6b',
                      cursor: 'pointer', fontSize: '0.95rem',
                    }}
                    title="Remove"
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: wtOK ? '#4dff91' : '#ffb74d' }}>
        {portfolio.holdings.length} ticker{portfolio.holdings.length === 1 ? '' : 's'} · Total weight {(totalWeight * 100).toFixed(2)}%
        {!wtOK && portfolio.holdings.length > 0 && ' — click Normalize to scale to 100%'}
      </div>
    </div>
  )
}

// Key metrics shown as score cards at the top. `higherIsBetter: true` means
// the larger numeric value wins; false means the smaller (less negative) wins.
const SCORE_METRICS = [
  { key: 'cagr',            label: 'CAGR',            fmt: (v) => fmtPct(v), higherIsBetter: true  },
  { key: 'total_return',    label: 'Total Return',    fmt: (v) => fmtPct(v), higherIsBetter: true  },
  { key: 'final_value',     label: 'Final Value',     fmt: (v) => fmtMoney(v), higherIsBetter: true  },
  { key: 'std_dev',         label: 'Std Dev',         fmt: (v) => fmtPct(v), higherIsBetter: false },
  { key: 'max_drawdown',    label: 'Max Drawdown',    fmt: (v) => fmtPct(v), higherIsBetter: true  }, // max_drawdown is negative; larger (less negative) is better
  { key: 'sharpe',          label: 'Sharpe',          fmt: (v) => fmtNum(v), higherIsBetter: true  },
  { key: 'sortino',         label: 'Sortino',         fmt: (v) => fmtNum(v), higherIsBetter: true  },
  { key: 'mar',             label: 'MAR / Calmar',    fmt: (v) => fmtNum(v), higherIsBetter: true  },
]

function ScoreCards({ portfolios, colors, includeDiv }) {
  // Compare head-to-head. If only one portfolio, no winner concept.
  const [a, b] = portfolios
  const metrics = useMemo(() => {
    if (!includeDiv) return SCORE_METRICS
    return [
      ...SCORE_METRICS,
      { key: 'total_income', label: 'Total Dividends', fmt: (v) => fmtMoney(v), higherIsBetter: true },
    ]
  }, [includeDiv])
  const winnerFor = (key, higherIsBetter) => {
    if (!b) return null
    const va = a?.metrics?.[key]; const vb = b?.metrics?.[key]
    if (va == null || !isFinite(va)) return vb == null || !isFinite(vb) ? null : 'b'
    if (vb == null || !isFinite(vb)) return 'a'
    if (Math.abs(va - vb) < 1e-9) return 'tie'
    const aWins = higherIsBetter ? va > vb : va < vb
    return aWins ? 'a' : 'b'
  }
  // Overall winner = side with more metric wins
  let aWins = 0, bWins = 0
  metrics.forEach(m => {
    const w = winnerFor(m.key, m.higherIsBetter)
    if (w === 'a') aWins++; else if (w === 'b') bWins++
  })
  const overall = !b ? null : (aWins === bWins ? 'tie' : (aWins > bWins ? 'a' : 'b'))

  return (
    <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Head-to-Head Score Card</h3>
        {b && (
          <div style={{ fontSize: '0.85rem' }}>
            {overall === 'tie' ? (
              <span style={{ color: '#e0c060' }}>Tied — {aWins} / {bWins} metric wins</span>
            ) : (
              <>
                <span style={{ color: '#8899aa' }}>Overall winner: </span>
                <span style={{
                  display: 'inline-block', padding: '0.15rem 0.55rem',
                  background: '#1a3a1a', border: '1px solid #4dff91', borderRadius: 3,
                  color: '#4dff91', fontWeight: 600,
                }}>
                  <span style={{
                    display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                    background: overall === 'a' ? colors[0] : colors[1], marginRight: 6,
                  }} />
                  {overall === 'a' ? a.name : b.name} · {overall === 'a' ? aWins : bWins} / {metrics.length} metrics
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '0.6rem',
      }}>
        {metrics.map(m => {
          const win = winnerFor(m.key, m.higherIsBetter)
          const aWon = win === 'a'
          const bWon = win === 'b'
          return (
            <div key={m.key} style={{
              background: '#0f0f1e', border: '1px solid #2a2a44', borderRadius: 4,
              padding: '0.5rem 0.6rem',
            }}>
              <div style={{ color: '#8899aa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                {m.label}
              </div>
              {portfolios.map((p, i) => {
                const isWinner = (i === 0 && aWon) || (i === 1 && bWon)
                return (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.15rem 0',
                  }}>
                    <span style={{ fontSize: '0.78rem', color: '#aab', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, background: colors[i], borderRadius: 2 }} />
                      {p.name}
                    </span>
                    <span style={{
                      fontSize: '0.9rem', fontWeight: isWinner ? 700 : 500,
                      color: isWinner ? '#4dff91' : '#e0e0e0',
                    }}>
                      {m.fmt(p.metrics?.[m.key])}
                      {isWinner && <span style={{ marginLeft: 4, fontSize: '0.75rem' }}>✓</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MetricsRow({ name, color, m }) {
  return (
    <tr style={{ borderTop: '1px solid #2a2a44' }}>
      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: color, borderRadius: 2, marginRight: 6 }} />
        {name}
      </td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtPct(m.cagr)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtPct(m.total_return)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtPct(m.std_dev)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: '#ff6b6b' }}>{fmtPct(m.peak_monthly_dd)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: '#ff6b6b' }}>{fmtPct(m.max_drawdown)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtInt(m.recovery_months)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.sharpe)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.sortino)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.mar)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.ulcer_index)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.beta)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtPct(m.alpha)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.up_capture, 1)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.down_capture, 1)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtNum(m.correlation)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: '#4dff91' }}>{fmtPct(m.best_year)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: '#ff6b6b' }}>{fmtPct(m.worst_year)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{fmtPct(m.positive_months_pct)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(m.final_value)}</td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: '#90caf9' }}>{fmtMoney(m.total_income)}</td>
    </tr>
  )
}

export default function PortfolioTester() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const dialog = useDialog()

  const [portfolioA, setPortfolioA] = useState({ name: 'Portfolio A', holdings: [] })
  const [portfolioB, setPortfolioB] = useState({ name: 'Portfolio B', holdings: [] })
  const [currentHoldings, setCurrentHoldings] = useState([])
  const [categories, setCategories] = useState([])
  const [end, setEnd] = useState(todayISO())
  const [start, setStart] = useState(subYearsISO(todayISO(), 5))
  const [initial, setInitial] = useState(10000)
  const [benchmark, setBenchmark] = useState('SPY')
  const [includeBenchmark, setIncludeBenchmark] = useState(true)
  const [rebalance, setRebalance] = useState('none')
  const [includeDiv, setIncludeDiv] = useState(true)
  const [reinvestDiv, setReinvestDiv] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [invalidTickers, setInvalidTickers] = useState([])
  const [result, setResult] = useState(null)

  useEffect(() => {
    pf('/api/portfolio-tester/holdings')
      .then(r => r.json())
      .then(d => {
        setCurrentHoldings(d.holdings || [])
        setCategories(d.categories || [])
      })
      .catch(() => {})
  }, [pf, selection])

  // Apply a set of picked tickers to the target portfolio.
  // mode: 'replace' → overwrite with picked tickers, weighted by their current value.
  //       'add'     → keep existing holdings at their current weights, then merge new
  //                   picked tickers allocated proportionally to their current value
  //                   across the *remaining* weight, renormalizing to 100%.
  const applyPick = (setter) => (tickers, mode) => {
    if (!tickers || tickers.length === 0) return
    const byTicker = Object.fromEntries((currentHoldings || []).map(h => [h.ticker, h]))
    const picks = tickers.map(t => byTicker[t]).filter(Boolean)
    if (picks.length === 0) return

    setter(p => {
      if (mode === 'replace') {
        const totalVal = picks.reduce((s, h) => s + (h.current_value || 0), 0) || 1
        return {
          ...p,
          holdings: picks.slice(0, MAX_TICKERS).map(h => ({
            ticker: h.ticker,
            weight: (h.current_value || 0) / totalVal,
          })),
        }
      }
      // mode === 'add': merge. Existing tickers already in the portfolio keep their
      // current weights; only newly-picked ones are added. Then normalize to 100%.
      const existingSet = new Set(p.holdings.map(h => h.ticker))
      const newPicks = picks.filter(h => !existingSet.has(h.ticker))
      if (newPicks.length === 0) return p

      const combined = [
        ...p.holdings,
        ...newPicks.map(h => ({ ticker: h.ticker, weight: Math.max(h.current_value || 0, 1) })),
      ].slice(0, MAX_TICKERS)

      const sum = combined.reduce((s, h) => s + Number(h.weight || 0), 0) || 1
      return {
        ...p,
        holdings: combined.map(h => ({ ...h, weight: Number(h.weight || 0) / sum })),
      }
    })
  }

  const loadCurrent = (setter) => (filter) => {
    let src = currentHoldings
    if (filter) src = currentHoldings.filter(h => (h.categories || []).includes(filter))
    if (src.length === 0) return
    const totalVal = src.reduce((s, h) => s + h.current_value, 0) || 1
    setter(p => ({
      ...p,
      holdings: src.slice(0, MAX_TICKERS).map(h => ({
        ticker: h.ticker, weight: h.current_value / totalVal,
      })),
    }))
  }

  const applyPreset = (yrs) => {
    const newEnd = todayISO()
    setEnd(newEnd)
    setStart(subYearsISO(newEnd, yrs))
    setError(null)
    setInvalidTickers([])
    setResult(null)
  }

  const stripInvalidFrom = (setter, portfolio) => {
    const bad = new Set(invalidTickers.map(t => t.ticker))
    const present = portfolio.holdings.some(h => bad.has(h.ticker))
    if (!present) return 0
    const kept = portfolio.holdings.filter(h => !bad.has(h.ticker))
    const sum = kept.reduce((s, h) => s + Number(h.weight || 0), 0)
    const next = {
      ...portfolio,
      holdings: sum > 0 ? kept.map(h => ({ ...h, weight: (Number(h.weight) || 0) / sum })) : kept,
    }
    setter(next)
    return portfolio.holdings.length - kept.length
  }

  const removeInvalidFromA = () => {
    stripInvalidFrom(setPortfolioA, portfolioA)
    // Only clear the banner if neither portfolio still has a flagged ticker
    const remaining = invalidTickers.filter(t =>
      portfolioB.holdings.some(h => h.ticker === t.ticker)
    )
    setInvalidTickers(remaining)
    if (remaining.length === 0) setError(null)
  }

  const removeInvalidFromB = () => {
    stripInvalidFrom(setPortfolioB, portfolioB)
    const remaining = invalidTickers.filter(t =>
      portfolioA.holdings.some(h => h.ticker === t.ticker)
    )
    setInvalidTickers(remaining)
    if (remaining.length === 0) setError(null)
  }

  const invalidInA = useMemo(
    () => invalidTickers.filter(t => portfolioA.holdings.some(h => h.ticker === t.ticker)).length,
    [invalidTickers, portfolioA]
  )
  const invalidInB = useMemo(
    () => invalidTickers.filter(t => portfolioB.holdings.some(h => h.ticker === t.ticker)).length,
    [invalidTickers, portfolioB]
  )

  const run = async () => {
    setError(null); setResult(null); setInvalidTickers([])

    const valid = [portfolioA, portfolioB].filter(p => p.holdings.length > 0)
    if (valid.length === 0) { setError('Add tickers to at least one portfolio.'); return }

    for (const p of valid) {
      if (p.holdings.length > MAX_TICKERS) { setError(`${p.name}: max ${MAX_TICKERS} tickers.`); return }
      const sum = p.holdings.reduce((s, h) => s + Number(h.weight || 0), 0)
      if (Math.abs(sum - 1) > 0.005) {
        setError(`${p.name}: weights sum to ${(sum * 100).toFixed(2)}%. Click Normalize on the portfolio card, then run again.`)
        return
      }
    }

    const days = (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)
    if (days < 150) { setError('Minimum backtest range is 6 months.'); return }
    if (days / 365.25 > 25.1) { setError('Maximum backtest range is 25 years.'); return }

    setLoading(true)
    try {
      const resp = await pf('/api/portfolio-tester/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolios: valid,
          start, end,
          initial: Number(initial) || 10000,
          include_benchmark: includeBenchmark,
          benchmark: includeBenchmark ? (benchmark.trim().toUpperCase() || null) : null,
          include_div: includeDiv,
          reinvest_div: includeDiv ? reinvestDiv : false,
          rebalance,
        }),
      })
      const data = await resp.json()
      if (data.error) { setError(data.error); return }
      if (data.valid === false) {
        setInvalidTickers(data.missing || [])
        setError('Backtest invalid: the following tickers have no price history for the requested start date. Shorten the range or remove them.')
        return
      }
      setResult(data)
    } catch (e) {
      setError('Request failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const colors = ['#4f8dff', '#b37dff', '#4dff91']  // A, B, Bench
  const seriesList = useMemo(() => {
    if (!result) return []
    const out = result.portfolios.map((p, i) => ({ ...p, color: colors[i] }))
    if (result.benchmark_series) out.push({ ...result.benchmark_series, color: colors[2] })
    return out
  }, [result])

  // Plotly traces — Growth of $X with drawdown subplot
  const growthFigure = useMemo(() => {
    if (!result) return null
    const traces = []
    seriesList.forEach(s => {
      traces.push({
        x: s.value_dates, y: s.value_series.map(v => Number(v.toFixed(2))),
        type: 'scatter', mode: 'lines', name: s.name,
        line: { color: s.color, width: 2 }, xaxis: 'x', yaxis: 'y',
        hovertemplate: '%{x}<br>$%{y:,.2f}<extra>' + s.name + '</extra>',
      })
      traces.push({
        x: s.value_dates, y: s.drawdown_series.map(v => Number((v * 100).toFixed(2))),
        type: 'scatter', mode: 'lines', name: s.name + ' DD',
        line: { color: s.color, width: 1 }, showlegend: false,
        xaxis: 'x2', yaxis: 'y2',
        hovertemplate: '%{x}<br>%{y:.2f}%<extra>' + s.name + ' DD</extra>',
      })
    })
    return {
      data: traces,
      layout: {
        grid: { rows: 2, columns: 1, roworder: 'top to bottom' },
        height: 560,
        margin: { l: 70, r: 20, t: 40, b: 50 },
        paper_bgcolor: 'transparent', plot_bgcolor: '#0f0f1e',
        font: { color: '#e0e0e0', size: 11 },
        legend: { orientation: 'h', y: -0.14 },
        annotations: [
          {
            text: `<b>Portfolio Value — Growth of ${fmtMoney(result.initial)}</b>`,
            xref: 'paper', yref: 'paper', x: 0, xanchor: 'left',
            y: 1.02, yanchor: 'bottom', showarrow: false,
            font: { color: '#e0e0e0', size: 13 },
          },
          {
            text: '<b>Drawdown from Peak</b> — % decline from the running all-time high (0% = at peak)',
            xref: 'paper', yref: 'paper', x: 0, xanchor: 'left',
            y: 0.33, yanchor: 'bottom', showarrow: false,
            font: { color: '#ffb74d', size: 12 },
          },
        ],
        xaxis: { domain: [0, 1], anchor: 'y', gridcolor: '#2a2a44' },
        yaxis: {
          domain: [0.40, 1],
          title: { text: `Portfolio Value ($)`, font: { size: 12 } },
          gridcolor: '#2a2a44', tickprefix: '$', tickformat: ',.2f', hoverformat: ',.2f',
        },
        xaxis2: { domain: [0, 1], anchor: 'y2', gridcolor: '#2a2a44' },
        yaxis2: {
          domain: [0, 0.30],
          title: { text: 'Drawdown from Peak (%)', font: { size: 12 } },
          gridcolor: '#2a2a44', ticksuffix: '%', tickformat: '.2f', hoverformat: '.2f',
          zeroline: true, zerolinecolor: '#8899aa', zerolinewidth: 1,
        },
      },
    }
  }, [result, seriesList])

  const annualFigure = useMemo(() => {
    if (!result) return null
    // Only include calendar years fully covered by the backtest
    const fullYears = new Set()
    seriesList.forEach(s => (s.metrics.annual_returns || []).forEach(r => {
      if (!r.partial && r.return != null) fullYears.add(r.year)
    }))
    const years = [...fullYears].sort((a, b) => a - b)
    if (years.length === 0) return { empty: true }
    const traces = seriesList.map(s => {
      const byYear = Object.fromEntries(
        (s.metrics.annual_returns || []).filter(r => !r.partial).map(r => [r.year, r.return])
      )
      return {
        x: years, y: years.map(y => (byYear[y] ?? null) != null ? Number((byYear[y] * 100).toFixed(2)) : null),
        type: 'bar', name: s.name, marker: { color: s.color },
        hovertemplate: '%{x}<br>%{y:.2f}%<extra>' + s.name + '</extra>',
      }
    })
    return {
      data: traces,
      layout: {
        height: 320, barmode: 'group', margin: { l: 60, r: 20, t: 30, b: 40 },
        paper_bgcolor: 'transparent', plot_bgcolor: '#0f0f1e',
        font: { color: '#e0e0e0', size: 11 },
        xaxis: { gridcolor: '#2a2a44', title: 'Year' },
        yaxis: { gridcolor: '#2a2a44', title: 'Return', ticksuffix: '%', tickformat: '.2f', hoverformat: '.2f' },
        legend: { orientation: 'h', y: -0.15 },
      },
    }
  }, [result, seriesList])

  const rollingFigure = useMemo(() => {
    if (!result) return null
    const traces = result.portfolios.map((s, i) => ({
      x: s.rolling_cagr_dates, y: s.rolling_cagr_series.map(v => Number((v * 100).toFixed(2))),
      type: 'scatter', mode: 'lines', name: s.name, line: { color: colors[i], width: 2 },
      hovertemplate: '%{x}<br>%{y:.2f}%<extra>' + s.name + '</extra>',
    }))
    return {
      data: traces,
      layout: {
        height: 260, margin: { l: 60, r: 20, t: 30, b: 40 },
        paper_bgcolor: 'transparent', plot_bgcolor: '#0f0f1e',
        font: { color: '#e0e0e0', size: 11 },
        xaxis: { gridcolor: '#2a2a44' },
        yaxis: { gridcolor: '#2a2a44', title: '1Y rolling CAGR', ticksuffix: '%', tickformat: '.2f', hoverformat: '.2f' },
        legend: { orientation: 'h', y: -0.2 },
      },
    }
  }, [result])

  const incomeFigure = useMemo(() => {
    if (!result || !result.include_div) return null
    const traces = result.portfolios.map((s, i) => ({
      x: s.income_dates, y: s.income_series.map(v => Number(v.toFixed(2))),
      type: 'bar', name: s.name, marker: { color: colors[i], opacity: 0.75 },
      hovertemplate: '%{x|%b %Y}<br>$%{y:,.2f}<extra>' + s.name + '</extra>',
    }))
    return {
      data: traces,
      layout: {
        height: 280, barmode: 'group', margin: { l: 60, r: 20, t: 30, b: 40 },
        paper_bgcolor: 'transparent', plot_bgcolor: '#0f0f1e',
        font: { color: '#e0e0e0', size: 11 },
        xaxis: { gridcolor: '#2a2a44', tickformat: '%b %Y' },
        yaxis: { gridcolor: '#2a2a44', title: 'Monthly dividend $ paid', tickprefix: '$', tickformat: ',.2f', hoverformat: ',.2f' },
        legend: { orientation: 'h', y: -0.2 },
      },
    }
  }, [result])

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.3rem' }}>Portfolio Tester</h1>
      <p style={{ color: '#8899aa', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Backtest two portfolios head-to-head (up to 75 tickers each) against a benchmark.
        6 months to 25 years of Yahoo Finance history. Optional dividend reinvestment and rebalancing.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <PortfolioEditor
          label="Portfolio A"
          portfolio={portfolioA}
          onChange={setPortfolioA}
          onLoadCurrent={loadCurrent(setPortfolioA)}
          onFilterLoad={loadCurrent(setPortfolioA)}
          onPickApply={applyPick(setPortfolioA)}
          currentHoldings={currentHoldings}
          currentAvailable={currentHoldings.length > 0}
          categories={categories}
        />
        <PortfolioEditor
          label="Portfolio B"
          portfolio={portfolioB}
          onChange={setPortfolioB}
          onLoadCurrent={loadCurrent(setPortfolioB)}
          onFilterLoad={loadCurrent(setPortfolioB)}
          onPickApply={applyPick(setPortfolioB)}
          currentHoldings={currentHoldings}
          currentAvailable={currentHoldings.length > 0}
          categories={categories}
        />
      </div>

      {/* Shared settings */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>Start</span>
            <input type="date" value={start} onChange={e => { setStart(e.target.value); setError(null); setInvalidTickers([]) }} style={dateStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>End</span>
            <input type="date" value={end} onChange={e => { setEnd(e.target.value); setError(null); setInvalidTickers([]) }} style={dateStyle} />
          </div>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {PRESETS.map(p => (
              <button key={p.label} className="btn" style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }} onClick={() => applyPreset(p.years)}>
                {p.label}
              </button>
            ))}
          </div>

          <span style={{ color: '#556677' }}>|</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>Initial</span>
            <input type="number" value={initial} onChange={e => setInitial(e.target.value)} style={{ ...dateStyle, width: 90 }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem', color: '#8899aa' }}
              title="Uncheck to compare Portfolio A vs Portfolio B only, without a benchmark line">
              <input
                type="checkbox"
                checked={includeBenchmark}
                onChange={e => setIncludeBenchmark(e.target.checked)}
              />
              Benchmark
            </label>
            <input
              value={benchmark}
              onChange={e => setBenchmark(e.target.value.toUpperCase())}
              maxLength={6}
              disabled={!includeBenchmark}
              title={includeBenchmark ? 'Ticker to use as the benchmark (e.g., SPY, QQQ, VTI)' : 'Benchmark disabled — A vs B only'}
              style={{
                ...dateStyle, width: 70, textTransform: 'uppercase',
                opacity: includeBenchmark ? 1 : 0.4,
                cursor: includeBenchmark ? 'text' : 'not-allowed',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>Rebalance</span>
            <select value={rebalance} onChange={e => setRebalance(e.target.value)} style={dateStyle}>
              <option value="none">None</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}>
            <input type="checkbox" checked={includeDiv} onChange={e => setIncludeDiv(e.target.checked)} />
            Include dividends
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem', opacity: includeDiv ? 1 : 0.4 }}>
            <input
              type="checkbox"
              checked={reinvestDiv}
              disabled={!includeDiv}
              onChange={e => setReinvestDiv(e.target.checked)}
            />
            Reinvest dividends
          </label>

          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={run} disabled={loading} style={{ padding: '0.4rem 1.2rem' }}>
            {loading ? 'Running…' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: '#3a1a1a', border: '1px solid #ff6b6b' }}>
          <div style={{ color: '#ff9090', fontSize: '0.88rem' }}>{error}</div>
          {invalidTickers.length > 0 && (
            <>
              <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {invalidTickers.map(t => (
                  <span key={t.ticker} style={{
                    background: '#2a1414', border: '1px solid #ff6b6b', borderRadius: 3,
                    padding: '0.2rem 0.5rem', fontSize: '0.78rem', color: '#ffb4b4',
                  }} title={t.reason}>
                    <strong>{t.ticker}</strong>
                    {t.earliest && <span style={{ color: '#ff9090', marginLeft: 6 }}>first: {t.earliest}</span>}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={removeInvalidFromA}
                  disabled={invalidInA === 0}
                  style={{ padding: '0.3rem 0.8rem', fontSize: '0.82rem' }}
                  title="Remove flagged tickers from Portfolio A only and renormalize"
                >
                  Remove {invalidInA} from {portfolioA.name || 'Portfolio A'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={removeInvalidFromB}
                  disabled={invalidInB === 0}
                  style={{ padding: '0.3rem 0.8rem', fontSize: '0.82rem' }}
                  title="Remove flagged tickers from Portfolio B only and renormalize"
                >
                  Remove {invalidInB} from {portfolioB.name || 'Portfolio B'}
                </button>
                <span style={{ color: '#8899aa', fontSize: '0.78rem' }}>
                  Weights will be renormalized to 100%.
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {result && (
        <>
          {/* Score cards */}
          <ScoreCards portfolios={result.portfolios} colors={colors} includeDiv={result.include_div} />

          {/* Metrics table */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem', overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Performance Summary</h3>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ background: '#1a1a2e', color: '#8899aa' }}>
                  <th style={thL}>Name</th>
                  <th style={thR}>CAGR</th>
                  <th style={thR}>Total Return</th>
                  <th style={thR}>Std Dev</th>
                  <th style={thR}>Peak Mo. DD</th>
                  <th style={thR}>Max DD</th>
                  <th style={thR}>Recovery Mo.</th>
                  <th style={thR}>Sharpe</th>
                  <th style={thR}>Sortino</th>
                  <th style={thR}>MAR/Calmar</th>
                  <th style={thR}>Ulcer</th>
                  <th style={thR}>Beta</th>
                  <th style={thR}>Alpha</th>
                  <th style={thR}>Up Cap</th>
                  <th style={thR}>Down Cap</th>
                  <th style={thR}>Corr</th>
                  <th style={thR}>Best Yr</th>
                  <th style={thR}>Worst Yr</th>
                  <th style={thR}>+ Months %</th>
                  <th style={thR}>Final $</th>
                  <th style={thR}>Divs Paid $</th>
                </tr>
              </thead>
              <tbody>
                {result.portfolios.map((p, i) => (
                  <MetricsRow key={p.name + i} name={p.name} color={colors[i]} m={p.metrics} />
                ))}
                {result.benchmark_series && (
                  <MetricsRow name={result.benchmark_series.name + ' (benchmark)'} color={colors[2]} m={result.benchmark_series.metrics} />
                )}
              </tbody>
            </table>
            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#556677' }}>
              Backtest: {result.start} → {result.end} · Initial {fmtMoney(result.initial)} ·
              Dividends {result.include_div ? (result.reinvest_div ? 'reinvested' : 'paid as cash') : 'excluded'} ·
              Rebalance {result.rebalance}
            </div>
          </div>

          {/* Growth + Drawdown */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.2rem 0', fontSize: '1rem' }}>
              Growth &amp; Drawdown
            </h3>
            <div style={{ color: '#8899aa', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
              <strong style={{ color: '#e0e0e0' }}>Top:</strong> portfolio value over time, starting at {fmtMoney(result.initial)}.{' '}
              <strong style={{ color: '#ffb74d' }}>Bottom:</strong> drawdown — the % below the running peak.
              0% means the portfolio is at a new high; −20% means it has lost 20% from its prior peak and has not yet recovered.
            </div>
            {growthFigure && (
              <Plot data={growthFigure.data} layout={growthFigure.layout} style={{ width: '100%' }} config={{ displayModeBar: false, responsive: true }} />
            )}
          </div>

          {/* Annual returns */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1rem' }}>Annual Returns</h3>
            {annualFigure && !annualFigure.empty && (
              <Plot data={annualFigure.data} layout={annualFigure.layout} style={{ width: '100%' }} config={{ displayModeBar: false, responsive: true }} />
            )}
            {annualFigure?.empty && (
              <div style={{ padding: '1rem', color: '#8899aa', fontSize: '0.85rem', textAlign: 'center' }}>
                No complete calendar years in this backtest range — extend the range across a full Jan–Dec to see annual returns.
              </div>
            )}
          </div>

          {/* Rolling CAGR */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1rem' }}>Rolling 1-Year CAGR</h3>
            {rollingFigure && (
              <Plot data={rollingFigure.data} layout={rollingFigure.layout} style={{ width: '100%' }} config={{ displayModeBar: false, responsive: true }} />
            )}
          </div>

          {/* Dividend income */}
          {result.include_div && incomeFigure && (
            <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1rem' }}>Monthly Dividend Income</h3>
              <Plot data={incomeFigure.data} layout={incomeFigure.layout} style={{ width: '100%' }} config={{ displayModeBar: false, responsive: true }} />
              <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: '#8899aa' }}>
                {result.portfolios.map((p, i) => (
                  <span key={i} style={{ marginRight: '1rem' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: colors[i], borderRadius: 2, marginRight: 4 }} />
                    {p.name}: <strong style={{ color: '#90caf9' }}>{fmtMoney(p.metrics.total_income)}</strong> total distributions
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Coverage info */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#8899aa' }}>
            <strong style={{ color: '#e0e0e0' }}>Data coverage:</strong>{' '}
            {result.coverage && result.coverage.length > 0
              ? result.coverage.map(c => `${c.ticker} (since ${c.earliest})`).join(', ')
              : '—'}
          </div>
        </>
      )}
    </div>
  )
}

const dateStyle = {
  padding: '0.3rem 0.5rem',
  background: '#1a1a2e',
  border: '1px solid #3a3a5c',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: '0.85rem',
}

const thL = { padding: '0.4rem 0.6rem', textAlign: 'left' }
const thR = { padding: '0.4rem 0.6rem', textAlign: 'right' }
