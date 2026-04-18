import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE } from '../config'

const fmt = (v, digits = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(digits)

const fmtPct = (v, digits = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : (Number(v) * 100).toFixed(digits) + '%'

const fmtInt = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString()

function formatExp(exp) {
  if (!exp) return ''
  const d = new Date(exp + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return exp
  const day = d.getDate().toString().padStart(2, '0')
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const yr = d.getFullYear().toString().slice(-2)
  return `${day} ${mon} ${yr}`
}

function daysTo(exp) {
  if (!exp) return null
  const d = new Date(exp + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d - today) / 86400000)
}

export default function OptionTradingTools() {
  const [tickerInput, setTickerInput] = useState('SPY')
  const [ticker, setTicker] = useState('SPY')
  const [quote, setQuote] = useState(null)
  const [quoteErr, setQuoteErr] = useState(null)
  const [expirations, setExpirations] = useState([])
  const [selectedExp, setSelectedExp] = useState('')
  const [chain, setChain] = useState(null)
  const [loadingChain, setLoadingChain] = useState(false)
  const [chainErr, setChainErr] = useState(null)
  const [strikeFilter, setStrikeFilter] = useState('atm20') // 'all' | 'atm10' | 'atm20' | 'atm40'

  // Load quote + expirations when ticker changes
  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setQuote(null)
    setQuoteErr(null)
    setExpirations([])
    setSelectedExp('')
    setChain(null)

    fetch(`${API_BASE}/api/options/quote?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { if (d.error) setQuoteErr(d.error); else setQuote(d) } })
      .catch(e => { if (!cancelled) setQuoteErr(String(e)) })

    fetch(`${API_BASE}/api/options/expirations?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const exps = d.expirations || []
        setExpirations(exps)
        if (exps.length > 0) setSelectedExp(exps[0])
      })
      .catch(e => { if (!cancelled) setChainErr(String(e)) })

    return () => { cancelled = true }
  }, [ticker])

  // Load chain when expiration changes
  useEffect(() => {
    if (!ticker || !selectedExp) return
    let cancelled = false
    setLoadingChain(true)
    setChainErr(null)
    fetch(`${API_BASE}/api/options/chain?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(selectedExp)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) setChainErr(d.error); else setChain(d)
      })
      .catch(e => { if (!cancelled) setChainErr(String(e)) })
      .finally(() => { if (!cancelled) setLoadingChain(false) })
    return () => { cancelled = true }
  }, [ticker, selectedExp])

  const submitTicker = (e) => {
    e?.preventDefault?.()
    const t = (tickerInput || '').trim().toUpperCase()
    if (t && t !== ticker) setTicker(t)
  }

  // Merge calls + puts by strike for a single-row display
  const rows = useMemo(() => {
    if (!chain) return []
    const byStrike = new Map()
    for (const c of chain.calls) {
      byStrike.set(c.strike, { strike: c.strike, call: c, put: null })
    }
    for (const p of chain.puts) {
      const row = byStrike.get(p.strike) || { strike: p.strike, call: null, put: null }
      row.put = p
      byStrike.set(p.strike, row)
    }
    const list = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike)

    // Filter strikes around spot
    const spot = chain.spot || 0
    if (strikeFilter === 'all' || !spot) return list
    const bandPct = strikeFilter === 'atm10' ? 0.10 : strikeFilter === 'atm20' ? 0.20 : 0.40
    const low = spot * (1 - bandPct)
    const high = spot * (1 + bandPct)
    return list.filter(r => r.strike >= low && r.strike <= high)
  }, [chain, strikeFilter])

  const spot = quote?.last ?? chain?.spot ?? null
  const dte = daysTo(selectedExp)

  return (
    <div className="page">
      <h1>Option Trading Tools</h1>

      {/* Symbol bar */}
      <div className="card otp-symbol-bar">
        <form onSubmit={submitTicker} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input
            className="otp-ticker-input"
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value.toUpperCase())}
            placeholder="Ticker"
            spellCheck="false"
            autoCapitalize="characters"
          />
          <button type="submit" className="btn btn-primary">Load</button>
        </form>

        {quoteErr && <div style={{ color: '#ef5350' }}>Quote error: {quoteErr}</div>}

        {quote && (
          <div className="otp-quote-row">
            <div className="otp-quote-ticker">
              <span className="otp-sym">{quote.ticker}</span>
              {quote.name && <span className="otp-name">{quote.name}</span>}
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Last</div>
              <div className="otp-quote-val">{fmt(quote.last)}</div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Change</div>
              <div
                className="otp-quote-val"
                style={{ color: (quote.change ?? 0) >= 0 ? '#66bb6a' : '#ef5350' }}
              >
                {quote.change != null ? (quote.change >= 0 ? '+' : '') + fmt(quote.change) : '—'}
                {quote.change_pct != null && (
                  <span style={{ fontSize: '0.85em', marginLeft: '0.4rem' }}>
                    ({quote.change_pct >= 0 ? '+' : ''}{fmt(quote.change_pct)}%)
                  </span>
                )}
              </div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Bid</div>
              <div className="otp-quote-val">{fmt(quote.bid)}</div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Ask</div>
              <div className="otp-quote-val">{fmt(quote.ask)}</div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Volume</div>
              <div className="otp-quote-val">{fmtInt(quote.volume)}</div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Open</div>
              <div className="otp-quote-val">{fmt(quote.open)}</div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">High</div>
              <div className="otp-quote-val">{fmt(quote.high)}</div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Low</div>
              <div className="otp-quote-val">{fmt(quote.low)}</div>
            </div>
            <div className="otp-quote-item">
              <div className="otp-quote-label">Div Yield</div>
              <div className="otp-quote-val">{fmtPct(quote.div_yield)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Expiration + filter controls */}
      <div className="card">
        <div className="otp-controls-row">
          <label className="otp-ctrl">
            <span>Expiration</span>
            <select
              value={selectedExp}
              onChange={e => setSelectedExp(e.target.value)}
              disabled={expirations.length === 0}
            >
              {expirations.length === 0 && <option>Loading…</option>}
              {expirations.map(e => {
                const d = daysTo(e)
                return <option key={e} value={e}>{formatExp(e)} ({d}d)</option>
              })}
            </select>
          </label>
          {dte != null && <div className="otp-dte">{dte} days to expiration</div>}

          <label className="otp-ctrl">
            <span>Strikes</span>
            <select value={strikeFilter} onChange={e => setStrikeFilter(e.target.value)}>
              <option value="atm10">ATM ±10%</option>
              <option value="atm20">ATM ±20%</option>
              <option value="atm40">ATM ±40%</option>
              <option value="all">All</option>
            </select>
          </label>

          {loadingChain && <span style={{ color: '#90caf9' }}>Loading chain…</span>}
          {chainErr && <span style={{ color: '#ef5350' }}>{chainErr}</span>}
        </div>

        {/* Chain table */}
        {chain && (
          <div className="otp-chain-wrap">
            <table className="otp-chain">
              <thead>
                <tr>
                  <th colSpan={6} className="otp-side-call">CALLS</th>
                  <th className="otp-strike-head">Strike</th>
                  <th colSpan={6} className="otp-side-put">PUTS</th>
                </tr>
                <tr className="otp-col-head">
                  <th>Last</th>
                  <th>Δ</th>
                  <th>Prob.OTM</th>
                  <th>IV</th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th className="otp-strike-head"></th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th>IV</th>
                  <th>Prob.OTM</th>
                  <th>Δ</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const itmCall = spot != null && row.strike < spot
                  const itmPut = spot != null && row.strike > spot
                  const atm = spot != null && Math.abs(row.strike - spot) < 0.001
                  return (
                    <tr key={row.strike} className={atm ? 'otp-row-atm' : ''}>
                      <CallCells c={row.call} itm={itmCall} />
                      <td className="otp-strike-cell">{fmt(row.strike, row.strike >= 100 ? 0 : 1)}</td>
                      <PutCells p={row.put} itm={itmPut} />
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={13} style={{ textAlign: 'center', padding: '1.5rem', color: '#888' }}>
                    No strikes in the selected range.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function CallCells({ c, itm }) {
  const cls = itm ? 'otp-itm' : ''
  if (!c) return (<>{Array(6).fill(0).map((_, i) => <td key={i} className={cls}>—</td>)}</>)
  return (
    <>
      <td className={cls}>{fmt(c.last)}</td>
      <td className={cls}>{fmt(c.delta, 3)}</td>
      <td className={cls}>{fmtPct(c.prob_otm, 1)}</td>
      <td className={cls}>{fmtPct(c.iv, 1)}</td>
      <td className={cls}>{fmt(c.bid)}</td>
      <td className={cls}>{fmt(c.ask)}</td>
    </>
  )
}

function PutCells({ p, itm }) {
  const cls = itm ? 'otp-itm' : ''
  if (!p) return (<>{Array(6).fill(0).map((_, i) => <td key={i} className={cls}>—</td>)}</>)
  return (
    <>
      <td className={cls}>{fmt(p.bid)}</td>
      <td className={cls}>{fmt(p.ask)}</td>
      <td className={cls}>{fmtPct(p.iv, 1)}</td>
      <td className={cls}>{fmtPct(p.prob_otm, 1)}</td>
      <td className={cls}>{fmt(p.delta, 3)}</td>
      <td className={cls}>{fmt(p.last)}</td>
    </>
  )
}
