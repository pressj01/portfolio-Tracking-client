import React, { useEffect, useMemo, useState } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const fmt = v => v != null
  ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—'
const fmtInt = v => v != null
  ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  : '—'
const glColor = v => (v || 0) >= 0 ? '#4dff91' : '#ff6b6b'

const TREATMENT_LABEL = {
  qualified: 'Qualified',
  ordinary:  'Ordinary',
  roc:       'Return of Capital',
  split:     'Custom Split',
  default:   'Default',
}

function MetricCard({ label, value }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '—'}</div>
    </div>
  )
}

function SplitOverrideEditor({ row, disabled, onSave, onDefault }) {
  const [split, setSplit] = useState({
    qualified_pct: Number(row.qualified_pct ?? (row.treatment === 'qualified' ? 100 : 0)),
    ordinary_pct: Number(row.ordinary_pct ?? (row.treatment === 'ordinary' ? 100 : 0)),
    roc_pct: Number(row.roc_pct ?? (row.treatment === 'roc' ? 100 : 0)),
  })
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    setSplit({
      qualified_pct: Number(row.qualified_pct ?? (row.treatment === 'qualified' ? 100 : 0)),
      ordinary_pct: Number(row.ordinary_pct ?? (row.treatment === 'ordinary' ? 100 : 0)),
      roc_pct: Number(row.roc_pct ?? (row.treatment === 'roc' ? 100 : 0)),
    })
    setLocalError('')
  }, [row.ticker, row.qualified_pct, row.ordinary_pct, row.roc_pct, row.treatment])

  const setPct = (key, value) => {
    setLocalError('')
    setSplit(prev => ({ ...prev, [key]: value }))
  }

  const commit = () => {
    const next = {
      qualified_pct: Number(split.qualified_pct) || 0,
      ordinary_pct: Number(split.ordinary_pct) || 0,
      roc_pct: Number(split.roc_pct) || 0,
    }
    const total = next.qualified_pct + next.ordinary_pct + next.roc_pct
    if (Math.abs(total - 100) > 0.01) {
      setLocalError(`Sum ${total.toFixed(2)}%`)
      return
    }
    onSave(row.ticker, next)
  }

  const inputStyle = {
    width: 54,
    padding: '0.18rem 0.25rem',
    fontSize: '0.78rem',
    textAlign: 'right',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#90a4ae', fontSize: '0.74rem' }}>
        Q
        <input type="number" min="0" max="100" step="0.01" value={split.qualified_pct}
          disabled={disabled} onChange={e => setPct('qualified_pct', e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} style={inputStyle} />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#90a4ae', fontSize: '0.74rem' }}>
        O
        <input type="number" min="0" max="100" step="0.01" value={split.ordinary_pct}
          disabled={disabled} onChange={e => setPct('ordinary_pct', e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} style={inputStyle} />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#90a4ae', fontSize: '0.74rem' }}>
        ROC
        <input type="number" min="0" max="100" step="0.01" value={split.roc_pct}
          disabled={disabled} onChange={e => setPct('roc_pct', e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} style={inputStyle} />
      </label>
      <button type="button" className="btn btn-secondary" disabled={disabled}
        onClick={() => onDefault(row.ticker)}
        style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }}>
        Default
      </button>
      {localError && <span style={{ color: '#ffb300', fontSize: '0.72rem' }}>{localError}</span>}
    </div>
  )
}

export default function AnnualTaxReport() {
  const pf = useProfileFetch()
  const { selection } = useProfile()

  const [years, setYears] = useState([])
  const [year, setYear] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('summary')
  const [savingTicker, setSavingTicker] = useState(null)
  const [taxAdvantaged, setTaxAdvantaged] = useState(null)

  // Sort state
  const [divSort, setDivSort] = useState({ col: 'total', asc: false })
  const [lotSort, setLotSort] = useState({ col: 'sell_date', asc: false })

  // Load available years
  useEffect(() => {
    pf('/api/tax-report/years')
      .then(async r => {
        if (!r.ok) {
          const body = await r.text()
          throw new Error(`tax-report endpoint returned ${r.status} — backend may need restart. ${body.slice(0, 120)}`)
        }
        return r.json()
      })
      .then(d => {
        if (d.error) throw new Error(d.error)
        if (d.tax_advantaged) {
          setTaxAdvantaged(d.profile_name || 'this account')
          setYears([])
          setYear(null)
          setData(null)
          setLoading(false)
          return
        }
        setTaxAdvantaged(null)
        const ys = d.years || []
        setYears(ys)
        if (ys.length && (year == null || !ys.includes(year))) {
          setYear(ys[0])
        } else if (!ys.length) {
          setYear(null)
          setData(null)
          setLoading(false)
        }
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [selection])

  // Load summary for selected year
  useEffect(() => {
    if (!year) return
    setLoading(true)
    setError(null)
    pf(`/api/tax-report/summary?year=${year}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        if (d.tax_advantaged) {
          setData(null)
          setTaxAdvantaged(d.profile_name || 'this account')
          return
        }
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [year, selection])

  const setOverride = (ticker, treatment) => {
    setSavingTicker(ticker)
    pf('/api/tax-report/overrides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, year, treatment }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        // Reload summary so totals reflect the new override
        return pf(`/api/tax-report/summary?year=${year}`).then(r => r.json())
      })
      .then(d => { if (d && !d.error) setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setSavingTicker(null))
  }

  const setOverrideSplit = (ticker, split) => {
    setSavingTicker(ticker)
    pf('/api/tax-report/overrides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, year, treatment: 'split', ...split }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        return pf(`/api/tax-report/summary?year=${year}`).then(r => r.json())
      })
      .then(d => { if (d && !d.error) setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setSavingTicker(null))
  }

  const downloadCsv = (format) => {
    const url = `/api/tax-report/export?year=${year}&format=${format}`
    pf(url)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        const u = URL.createObjectURL(blob)
        a.href = u
        a.download = `tax-${format}-${year}.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(u)
      })
      .catch(e => setError(e.message))
  }

  const sortedDivs = useMemo(() => {
    const rows = data?.dividends?.by_ticker || []
    const { col, asc } = divSort
    const sorted = [...rows]
    sorted.sort((a, b) => {
      const av = a[col] ?? 0, bv = b[col] ?? 0
      if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return sorted
  }, [data, divSort])

  const sortedLots = useMemo(() => {
    const rows = data?.realized?.lots || []
    const { col, asc } = lotSort
    const sorted = [...rows]
    sorted.sort((a, b) => {
      const av = a[col] ?? 0, bv = b[col] ?? 0
      if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return sorted
  }, [data, lotSort])

  const onDivSort = (col) => setDivSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: false })
  const onLotSort = (col) => setLotSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: false })
  const sortIcon = (state, col) => state.col !== col ? ' ⇅' : (state.asc ? ' ▲' : ' ▼')

  const dt = data?.dividends?.totals || {}
  const rt = data?.realized?.totals || {}
  const f1099 = data?.form_1099_div_preview || {}
  const f8949 = data?.form_8949_preview || {}

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '0.5rem' }}>Annual Tax Report</h1>

      <div className="alert" style={{
        background: 'rgba(255,184,108,0.1)', border: '1px solid rgba(255,184,108,0.4)',
        color: '#ffb86c', padding: '0.6rem 0.9rem', borderRadius: 4, marginBottom: '1rem',
        fontSize: '0.85rem',
      }}>
        <strong>Estimates only.</strong> Verify against your 1099-DIV and brokerage statements before
        filing. Wash-sale rules are not applied. The 60-day qualified-dividend holding test is not
        enforced — treatment is based on asset-class defaults with optional per-ticker overrides.
        Return-of-capital amounts come from manual overrides only.
      </div>

      {/* Year + actions row */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <label style={{ marginRight: '0.5rem', color: '#c0cdd8' }}>Tax year</label>
          <select value={year || ''} onChange={e => setYear(Number(e.target.value))}
                  disabled={!years.length}
                  style={{ padding: '0.35rem 0.6rem', minWidth: '110px' }}>
            {years.length === 0 && <option value="">No data</option>}
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {year && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => downloadCsv('1099div')}
                    style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}>
              1099-DIV CSV
            </button>
            <button className="btn btn-secondary" onClick={() => downloadCsv('8949')}
                    style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}>
              Form 8949 CSV
            </button>
            <button className="btn btn-secondary" onClick={() => downloadCsv('dividends')}
                    style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}>
              Dividends CSV
            </button>
            <button className="btn btn-secondary" onClick={() => downloadCsv('lots')}
                    style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}>
              Realized Lots CSV
            </button>
          </div>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && taxAdvantaged && (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: '#c0cdd8' }}>
          <h3 style={{ marginTop: 0 }}>Tax-advantaged account</h3>
          <p style={{ marginBottom: 0 }}>
            <strong>{taxAdvantaged}</strong> is excluded from the Annual Tax Report. Dividends and
            realized gains in IRAs, Roth IRAs, 401(k)s, HSAs, and 529s are not reportable on
            Form 1099-DIV or Form 8949 in the year they occur. Switch to a taxable account or
            the <strong>Owner</strong> view to see your taxable activity.
          </p>
        </div>
      )}
      {!loading && !error && !taxAdvantaged && !years.length && (
        <p style={{ color: '#556677', fontStyle: 'italic', padding: '2rem 0', textAlign: 'center' }}>
          No taxable activity recorded yet. Add SELL transactions or import dividend payments to begin.
        </p>
      )}

      {data && !loading && (
        <>
          <div className="summary-strip" style={{ marginBottom: '0.5rem' }}>
            <MetricCard label="Qualified Dividends" value={fmtInt(dt.qualified)} />
            <MetricCard label="Ordinary Dividends" value={fmtInt(dt.ordinary)} />
            <MetricCard label="Return of Capital" value={fmtInt(dt.roc)} />
            <MetricCard label="Total Dividends" value={fmtInt(dt.total)} />
          </div>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <MetricCard label="Short-Term G/L" value={
              <span style={{ color: glColor(rt.short_term) }}>{fmtInt(rt.short_term)}</span>} />
            <MetricCard label="Long-Term G/L" value={
              <span style={{ color: glColor(rt.long_term) }}>{fmtInt(rt.long_term)}</span>} />
            <MetricCard label="Total Realized G/L" value={
              <span style={{ color: glColor(rt.total) }}>{fmtInt(rt.total)}</span>} />
            <MetricCard label="Lots Sold" value={(data.realized?.lots || []).length} />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
            {[
              { key: 'summary',   label: 'Form Previews' },
              { key: 'dividends', label: `Dividends (${(data.dividends?.by_ticker || []).length})` },
              { key: 'realized',  label: `Realized Lots (${(data.realized?.lots || []).length})` },
            ].map(t => (
              <button key={t.key}
                className={`tr-pbtn${tab === t.key ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}
                onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'summary' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1rem' }}>
              <div className="card" style={{ padding: '1rem' }}>
                <h3 style={{ marginTop: 0 }}>Form 1099-DIV preview</h3>
                <table style={{ width: '100%' }}>
                  <tbody>
                    <tr><td>Box 1a — Total Ordinary Dividends</td>
                        <td style={{ textAlign: 'right' }}>{fmt(f1099.box_1a_total_ordinary)}</td></tr>
                    <tr><td>Box 1b — Qualified Dividends</td>
                        <td style={{ textAlign: 'right' }}>{fmt(f1099.box_1b_qualified)}</td></tr>
                    <tr><td>Box 3 — Nondividend Distributions (ROC)</td>
                        <td style={{ textAlign: 'right' }}>{fmt(f1099.box_3_nondividend_distributions)}</td></tr>
                  </tbody>
                </table>
                <p style={{ fontSize: '0.78rem', color: '#8899aa', marginTop: '0.5rem' }}>
                  Box 1a includes both qualified and ordinary; Box 1b is the qualified subset.
                </p>
              </div>

              <div className="card" style={{ padding: '1rem' }}>
                <h3 style={{ marginTop: 0 }}>Form 8949 preview</h3>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th></th>
                      <th style={{ textAlign: 'right' }}>Proceeds</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                      <th style={{ textAlign: 'right' }}>Gain/Loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Short-Term</td>
                      <td style={{ textAlign: 'right' }}>{fmt(f8949.short_term_proceeds)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(f8949.short_term_cost)}</td>
                      <td style={{ textAlign: 'right', color: glColor(f8949.short_term_gain) }}>
                        {fmt(f8949.short_term_gain)}
                      </td>
                    </tr>
                    <tr>
                      <td>Long-Term</td>
                      <td style={{ textAlign: 'right' }}>{fmt(f8949.long_term_proceeds)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(f8949.long_term_cost)}</td>
                      <td style={{ textAlign: 'right', color: glColor(f8949.long_term_gain) }}>
                        {fmt(f8949.long_term_gain)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ fontSize: '0.78rem', color: '#8899aa', marginTop: '0.5rem' }}>
                  Long-term = held more than 365 days. Cost basis comes from explicit lot
                  allocations on each sell, falling back to FIFO.
                </p>
              </div>
            </div>
          )}

          {tab === 'dividends' && (
            <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
              <table>
                <thead>
                  <tr>
                    {[
                      { k: 'ticker',              l: 'Ticker' },
                      { k: 'classification_type', l: 'Class' },
                      { k: 'treatment',           l: 'Treatment' },
                      { k: 'qualified',           l: 'Qualified',  num: true },
                      { k: 'ordinary',            l: 'Ordinary',   num: true },
                      { k: 'roc',                 l: 'ROC',        num: true },
                      { k: 'total',               l: 'Total',      num: true },
                      { k: 'count',               l: 'Payments',   num: true },
                    ].map(c => (
                      <th key={c.k} onClick={() => onDivSort(c.k)}
                          style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                                   textAlign: c.num ? 'right' : undefined }}>
                        {c.l}
                        <span style={{ fontSize: '0.7em', marginLeft: 4,
                                       color: divSort.col === c.k ? '#7ecfff' : '#8899aa' }}>
                          {sortIcon(divSort, c.k)}
                        </span>
                      </th>
                    ))}
                    <th style={{ whiteSpace: 'nowrap' }}>Override Split (this year)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDivs.map((row, i) => (
                    <tr key={`${row.ticker}-${i}`}>
                      <td><strong>{row.ticker}</strong></td>
                      <td style={{ color: '#8899aa' }}>{row.classification_type || '—'}</td>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 3,
                          fontSize: '0.78rem',
                          background: row.is_override ? 'rgba(126,207,255,0.15)' : 'rgba(255,255,255,0.05)',
                          color: row.is_override ? '#7ecfff' : '#c0cdd8',
                        }} title={row.is_override ? 'Manual override applied' : 'Default by classification'}>
                          {TREATMENT_LABEL[row.treatment] || row.treatment}
                          {row.is_override ? ' ★' : ''}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmt(row.qualified)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row.ordinary)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row.roc)}</td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(row.total)}</strong></td>
                      <td style={{ textAlign: 'right', color: '#8899aa' }}>{row.count}</td>
                      <td>
                        <SplitOverrideEditor
                          row={row}
                          disabled={savingTicker === row.ticker}
                          onSave={setOverrideSplit}
                          onDefault={(ticker) => setOverride(ticker, 'default')}
                        />
                      </td>
                    </tr>
                  ))}
                  {!sortedDivs.length && (
                    <tr><td colSpan={9} style={{ color: '#556677', fontStyle: 'italic',
                      padding: '2rem 0', textAlign: 'center' }}>
                      No dividends recorded for {year}.
                    </td></tr>
                  )}
                </tbody>
                {sortedDivs.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #0f3460', background: '#16213e' }}>
                      <td colSpan={3}><strong>Totals</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(dt.qualified)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(dt.ordinary)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(dt.roc)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(dt.total)}</strong></td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {tab === 'realized' && (
            <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
              <table>
                <thead>
                  <tr>
                    {[
                      { k: 'ticker',       l: 'Ticker' },
                      { k: 'sell_date',    l: 'Sell Date' },
                      { k: 'buy_date',     l: 'Buy Date' },
                      { k: 'shares',       l: 'Shares',    num: true },
                      { k: 'buy_price',    l: 'Buy Price', num: true },
                      { k: 'sell_price',   l: 'Sell Price',num: true },
                      { k: 'cost',         l: 'Cost',      num: true },
                      { k: 'proceeds',     l: 'Proceeds',  num: true },
                      { k: 'gain',         l: 'Gain/Loss', num: true },
                      { k: 'holding_days', l: 'Days',      num: true },
                      { k: 'term',         l: 'Term' },
                    ].map(c => (
                      <th key={c.k} onClick={() => onLotSort(c.k)}
                          style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                                   textAlign: c.num ? 'right' : undefined }}>
                        {c.l}
                        <span style={{ fontSize: '0.7em', marginLeft: 4,
                                       color: lotSort.col === c.k ? '#7ecfff' : '#8899aa' }}>
                          {sortIcon(lotSort, c.k)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedLots.map((row, i) => (
                    <tr key={i}>
                      <td><strong>{row.ticker}</strong></td>
                      <td>{row.sell_date || '—'}</td>
                      <td>{row.buy_date || <span style={{ color: '#ff6b6b' }}>unmatched</span>}</td>
                      <td style={{ textAlign: 'right' }}>{Number(row.shares).toFixed(3)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row.buy_price)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row.sell_price)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row.cost)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row.proceeds)}</td>
                      <td style={{ textAlign: 'right', color: glColor(row.gain) }}>
                        <strong>{fmt(row.gain)}</strong>
                      </td>
                      <td style={{ textAlign: 'right', color: '#8899aa' }}>
                        {row.holding_days != null ? row.holding_days : '—'}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 3,
                          fontSize: '0.78rem',
                          background: row.term === 'LT' ? 'rgba(46,253,181,0.15)' : 'rgba(255,184,108,0.15)',
                          color: row.term === 'LT' ? '#2EFDB5' : '#FFB86C',
                        }}>
                          {row.term === 'LT' ? 'Long-Term' : 'Short-Term'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!sortedLots.length && (
                    <tr><td colSpan={11} style={{ color: '#556677', fontStyle: 'italic',
                      padding: '2rem 0', textAlign: 'center' }}>
                      No realized sales for {year}. Record sells in the Manage Holdings page.
                    </td></tr>
                  )}
                </tbody>
                {sortedLots.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #0f3460', background: '#16213e' }}>
                      <td colSpan={6}><strong>Totals</strong></td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{fmt(rt.st_cost + rt.lt_cost)}</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{fmt(rt.st_proceeds + rt.lt_proceeds)}</strong>
                      </td>
                      <td style={{ textAlign: 'right', color: glColor(rt.total) }}>
                        <strong>{fmt(rt.total)}</strong>
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
