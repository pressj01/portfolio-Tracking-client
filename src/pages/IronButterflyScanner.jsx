import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import OptionProbabilityCards from '../components/OptionProbabilityCards'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'iron-butterfly-scanner-filters'
const FALLBACK_DEFAULTS = {
  tickers: 'SPY,QQQ,IWM',
  target_dte: 45,
  min_dte: 1,
  max_dte: 1095,
  expiration_count: 5,
  quantity: 1,
  body_strike: null,
  put_wing_strike: null,
  call_wing_strike: null,
  min_wing_width_pct: 1,
  max_wing_width_pct: 50,
  target_wing_delta: 0.16,
  min_credit_pct_of_wing: 5,
  max_wing_skew_pct: 100,
  target_body_offset_pct: 0,
  max_abs_net_delta: 10,
  min_open_interest: 0,
  max_bid_ask_pct: 35,
  exit_dte: 21,
  max_results: 20,
}

const usd = (value, digits = 2) => value == null
  ? '—'
  : Number(value).toLocaleString(undefined, {
      style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits,
    })
const num = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits)
const pct = (value, digits = 1) => value == null ? '—' : `${Number(value).toFixed(digits)}%`
const signed = (value, digits = 2) => value == null ? '—' : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}`
const signedUsd = (value, digits = 0) => value == null ? '—' : `${Number(value) >= 0 ? '+' : ''}${usd(value, digits)}`

function readFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    const merged = { ...FALLBACK_DEFAULTS, ...(saved || {}) }
    if (String(merged.tickers || '').replace(/\s/g, '').toUpperCase() === 'SPY,QQQ,IWM,VOO') {
      merged.tickers = FALLBACK_DEFAULTS.tickers
    }
    return merged
  } catch {
    return { ...FALLBACK_DEFAULTS }
  }
}

function HelpPanel() {
  return (
    <div style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.85rem 1rem', marginBottom: '0.8rem', color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.55 }}>
      <p style={{ marginTop: 0 }}>
        An iron butterfly uses <strong>three strikes and four legs</strong>: buy a lower put,
        sell a put and call at the same body strike, and buy an upper call. The credit is
        the maximum profit; the wider wing determines the worst expiration loss.
      </p>
      <p>
        The shared body stays near the selected offset while each long wing targets the
        selected absolute delta. The target delta stays fixed, while farther expirations
        naturally use strikes farther from the body. Exact listed strikes override it.
      </p>
      <p style={{ marginBottom: 0 }}>
        Target DTE is a preference, not a fixed strategy horizon. The scanner accepts any
        DTE from 1 through 1,095 and chooses the nearest listed expirations inside the
        configured window.
      </p>
    </div>
  )
}

function Structure({ row }) {
  return (
    <div style={{ fontSize: '0.74rem', lineHeight: 1.45 }}>
      <div><span style={{ color: 'var(--pos)' }}>Buy</span> P {usd(row.put_long_strike)}</div>
      <div><span style={{ color: 'var(--neg)' }}>Sell</span> P/C {usd(row.body_strike)}</div>
      <div><span style={{ color: 'var(--pos)' }}>Buy</span> C {usd(row.call_long_strike)}</div>
    </div>
  )
}

function Metric({ label, value, detail, good = true, accent }) {
  const color = accent || (good ? 'var(--pos-strong)' : 'var(--amber)')
  return (
    <div style={{ flex: '1 1 180px', background: 'var(--surface-sunken)', borderLeft: `4px solid ${color}`, borderRadius: 4, padding: '0.65rem 0.75rem' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.63rem', textTransform: 'uppercase' }}>{label}</div>
      <strong style={{ color, fontSize: '1.14rem' }}>{value}</strong>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.67rem' }}>{detail}</div>
    </div>
  )
}

function Detail({ row, colSpan }) {
  const expiration = row.probability_schedule?.find(point => point.kind === 'expiration')
  const deltaGood = Math.abs(row.position_delta || 0) <= row.max_abs_net_delta
  const spreadGood = row.max_leg_bid_ask_pct != null && row.max_leg_bid_ask_pct <= row.max_bid_ask_pct
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--surface-sunken)', padding: 0, whiteSpace: 'normal' }}>
        <div style={{ padding: '0.85rem 1rem' }}>
          <OptionProbabilityCards
            schedule={row.probability_schedule}
            successHeadline="The complete iron butterfly has positive modeled P/L"
            failureHeadline="The complete iron butterfly has negative modeled P/L"
            methodNote={<>The four original contracts are repriced with current implied volatilities held constant. These are risk-neutral estimates before commissions and slippage, not forecasts.</>}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.85rem' }}>
            <Metric label="Entry credit" value={usd(row.entry_credit_dollars, 0)} detail={`${pct(row.credit_pct_of_min_wing)} of narrower wing`} />
            <Metric label="Maximum profit" value={usd(row.max_profit_dollars, 0)} detail={`At the ${usd(row.body_strike)} body`} />
            <Metric label="Maximum loss" value={usd(row.max_loss_dollars, 0)} detail={`Wider wing · ${pct(row.return_on_risk_pct)} ROR`} good={false} accent="var(--neg-strong)" />
            <Metric label="Breakevens" value={`${usd(row.lower_breakeven)} / ${usd(row.upper_breakeven)}`} detail="Lower / upper at expiration" accent="var(--accent-bright)" />
            <Metric label="Net delta" value={signed(row.position_delta)} detail={`Limit ±${num(row.max_abs_net_delta, 1)} share equivalents`} good={deltaGood} />
            <Metric label="Theta" value={`${signedUsd(row.theta_dollars_per_day, 2)}/day`} detail="Complete four-leg position" good={row.theta_dollars_per_day >= 0} />
            <Metric label="Widest leg market" value={pct(row.max_leg_bid_ask_pct)} detail={`Limit ${pct(row.max_bid_ask_pct)} · OI ${row.open_interest_min}`} good={spreadGood} />
            <Metric label="Body offset" value={pct(row.body_offset_pct)} detail={`Target ${pct(row.target_body_offset_pct)}`} />
          </div>

          <div className="sst-wrap" style={{ marginBottom: '0.8rem' }}>
            <table className="sst" style={{ minWidth: 760 }}>
              <thead><tr><th>Side</th><th>Action</th><th>Type</th><th style={{ textAlign: 'right' }}>Strike</th><th style={{ textAlign: 'right' }}>Mid</th><th style={{ textAlign: 'right' }}>Delta</th><th style={{ textAlign: 'right' }}>OI</th></tr></thead>
              <tbody>{row.legs?.map((leg, index) => (
                <tr key={`${leg.option_type}-${leg.strike}-${index}`}>
                  <td>{leg.qty > 0 ? 'Long' : 'Short'}</td>
                  <td style={{ color: leg.qty > 0 ? 'var(--pos)' : 'var(--neg)' }}>{leg.qty > 0 ? 'Buy' : 'Sell'} {Math.abs(leg.qty)}</td>
                  <td>{String(leg.option_type || '').toUpperCase()}</td>
                  <td style={{ textAlign: 'right' }}>{usd(leg.strike)}</td>
                  <td style={{ textAlign: 'right' }}>{usd(leg.mid)}</td>
                  <td style={{ textAlign: 'right' }}>{leg.delta == null ? '—' : Number(leg.delta).toFixed(3)}</td>
                  <td style={{ textAlign: 'right' }}>{leg.open_interest?.toLocaleString?.() ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <RiskGraphButton kind="iron-butterfly" row={row} source="Iron Butterfly Scanner" />
            <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
              {expiration ? `${pct(expiration.probability_success_pct)} modeled success by expiration` : 'Probability model unavailable'}
              {' · '}{row.quote_source === 'live_bid_ask' ? 'Live quotes' : 'Recent-trade estimate'}
            </span>
          </div>
          {!!row.flags?.length && <div className="alert alert-warning" style={{ marginTop: '0.75rem', marginBottom: 0 }}><strong>Review before entry:</strong> {row.flags.join(' · ')}</div>}
        </div>
      </td>
    </tr>
  )
}

export default function IronButterflyScanner() {
  const pf = useProfileFetch()
  const [cachedScan, saveScan] = useScanCache('iron-butterfly-v2')
  const [filters, setFilters] = useState(readFilters)
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [unavailable, setUnavailable] = useState(cachedScan?.unavailable || [])
  const [stats, setStats] = useState(cachedScan?.stats || null)
  const [asOf, setAsOf] = useState(cachedScan?.as_of || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('status')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)) }, [filters])
  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))

  const numberField = (label, key, { step = 1, min, max, suffix = '', width = 72, optional = false, tip } = {}) => (
    <label title={tip} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.73rem' }}>
      {label}
      <span>
        <input type="number" step={step} min={min} max={max} value={filters[key] == null ? '' : filters[key]} placeholder={optional ? 'any' : undefined}
          onChange={event => set(key, event.target.value === '' ? null : Number(event.target.value))}
          style={{ width, padding: '0.32rem 0.4rem', color: 'var(--text-strong)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4 }} />
        {suffix && <span style={{ marginLeft: '0.2rem' }}>{suffix}</span>}
      </span>
    </label>
  )

  const runScan = useCallback(() => {
    setLoading(true)
    setError('')
    setExpanded(null)
    pf('/api/options/iron-butterfly-scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters),
    })
      .then(async response => {
        let data
        try { data = await response.json() } catch { throw new Error(`Scan request failed (${response.status})`) }
        if (!response.ok || data?.error) throw new Error(data?.error || `Scan request failed (${response.status})`)
        return data
      })
      .then(data => {
        const snapshot = { rows: data.rows || [], unavailable: data.unavailable || [], stats: data.stats || null, as_of: data.as_of || null }
        setRows(snapshot.rows); setUnavailable(snapshot.unavailable); setStats(snapshot.stats); setAsOf(snapshot.as_of); saveScan(snapshot)
      })
      .catch(scanError => setError(scanError.message))
      .finally(() => setLoading(false))
  }, [filters, pf, saveScan])

  const sortedRows = useMemo(() => {
    const accessors = {
      status: row => row.status === 'actionable' ? 0 : 1,
      ticker: row => row.ticker,
      dte: row => row.dte,
      body: row => Math.abs(row.body_offset_pct || 0),
      credit: row => row.entry_credit_dollars,
      risk: row => row.max_loss_dollars,
      delta: row => Math.abs(row.position_delta || 0),
      fit: row => row.fit_score,
    }
    const access = accessors[sortKey] || accessors.status
    return [...rows].sort((a, b) => {
      const av = access(a); const bv = access(b)
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? (av ?? Infinity) - (bv ?? Infinity) : (bv ?? -Infinity) - (av ?? -Infinity)
    })
  }, [rows, sortAsc, sortKey])

  const heading = (label, key, style) => <th onClick={() => { if (sortKey === key) setSortAsc(value => !value); else { setSortKey(key); setSortAsc(true) } }} style={{ cursor: 'pointer', ...style }}>{label}{sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>
  const columnCount = 10

  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.3rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Iron Butterfly Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)} aria-expanded={showHelp}>{showHelp ? 'Hide help' : 'How this works'}</button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Searches any requested DTE and any listed three-strike combination for a defined-risk iron butterfly: short put/call body, long put wing, and long call wing.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="iron-butterfly" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'flex-end', padding: '0.85rem', marginBottom: '0.7rem', background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6 }}>
        <label style={{ flex: '1 1 230px', color: 'var(--text-dim)', fontSize: '0.73rem' }}>Tickers<input value={filters.tickers} onChange={event => set('tickers', event.target.value.toUpperCase())} placeholder="SPY,QQQ,IWM" style={{ display: 'block', width: '100%', marginTop: '0.2rem', padding: '0.32rem 0.4rem', color: 'var(--text-strong)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4 }} /></label>
        {numberField('Target DTE', 'target_dte', { min: 1, max: 1095, tip: 'Any target DTE from 1 to 1,095; the nearest listed expiration is selected.' })}
        {numberField('Minimum DTE', 'min_dte', { min: 1, max: 1095 })}
        {numberField('Maximum DTE', 'max_dte', { min: 1, max: 1095 })}
        {numberField('Expirations', 'expiration_count', { min: 1, max: 12, width: 70, tip: 'Number of nearest listed expirations to compare.' })}
        {numberField('Quantity', 'quantity', { min: 1, max: 100, width: 64 })}
        {numberField('Min wing width', 'min_wing_width_pct', { step: 0.5, min: 0.01, max: 100, suffix: '%', width: 72 })}
        {numberField('Max wing width', 'max_wing_width_pct', { step: 0.5, min: 0.01, max: 100, suffix: '%', width: 72 })}
        {numberField('Wing delta', 'target_wing_delta', { step: 0.01, min: 0.01, max: 0.49, suffix: 'Δ', width: 72, tip: 'Absolute delta target for both long wings. The delta stays fixed while strike distance expands with DTE.' })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'flex-end', padding: '0.85rem', marginBottom: '0.7rem', background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6 }}>
        <div style={{ flex: '1 0 100%', color: 'var(--accent-bright)', fontSize: '0.78rem', fontWeight: 700 }}>Optional exact listed strikes</div>
        {numberField('Body strike', 'body_strike', { step: 0.01, min: 0.01, optional: true, width: 86, tip: 'Leave blank to search every shared put/call body strike.' })}
        {numberField('Put wing strike', 'put_wing_strike', { step: 0.01, min: 0.01, optional: true, width: 92, tip: 'Leave blank to search all lower listed put strikes.' })}
        {numberField('Call wing strike', 'call_wing_strike', { step: 0.01, min: 0.01, optional: true, width: 92, tip: 'Leave blank to search all higher listed call strikes.' })}
        {numberField('Target body offset', 'target_body_offset_pct', { step: 0.5, min: -100, max: 100, suffix: '%', width: 82, tip: 'Ranking preference only; it does not block other body strikes.' })}
        {numberField('Min credit', 'min_credit_pct_of_wing', { step: 1, min: 0, max: 100, suffix: '%', width: 72 })}
        {numberField('Max wing skew', 'max_wing_skew_pct', { step: 5, min: 0, max: 1000, suffix: '%', width: 78 })}
        {numberField('Max |net delta|', 'max_abs_net_delta', { step: 0.5, min: 0.1, max: 100, width: 82 })}
        {numberField('Min leg OI', 'min_open_interest', { min: 0, width: 76 })}
        {numberField('Max bid/ask', 'max_bid_ask_pct', { step: 1, min: 1, max: 500, suffix: '%', width: 78 })}
        {numberField('Review DTE', 'exit_dte', { min: 1, max: 1094, suffix: 'DTE', width: 72 })}
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading}>{loading ? 'Scanning…' : 'Run scan'}</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p style={{ color: 'var(--text-dim)' }}>Searching the listed expirations and enumerating complete three-strike iron butterflies…</p>}
      {stats && !loading && <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginBottom: '0.55rem' }}>Scanned <strong>{stats.tickers}</strong> tickers · priced <strong>{stats.expirations_priced}</strong> expirations · <strong style={{ color: 'var(--pos)' }}>{stats.structures_found}</strong> structures · <strong style={{ color: stats.actionable ? 'var(--pos)' : 'var(--amber)' }}>{stats.actionable}</strong> entry ready{stats.near_matches ? ` · ${stats.near_matches} needing review` : ''}{asOf ? ` · ${new Date(asOf).toLocaleString()}` : ''}</div>}

      {!loading && sortedRows.length > 0 && <div className="sst-wrap"><table className="sst">
        <thead><tr><th />{heading('Ticker', 'ticker')}{heading('DTE', 'dte')}{heading('Three strikes', 'body')}{heading('Credit', 'credit', { textAlign: 'right' })}{heading('Max loss', 'risk', { textAlign: 'right' })}{heading('Net delta', 'delta', { textAlign: 'right' })}{heading('Fit', 'fit', { textAlign: 'right' })}<th>Status</th><th>Action</th></tr></thead>
        <tbody>{sortedRows.map(row => {
          const key = `${row.ticker}-${row.expiration}-${row.put_long_strike}-${row.body_strike}-${row.call_long_strike}`
          const open = expanded === key
          return <React.Fragment key={key}>
            <tr onClick={() => setExpanded(open ? null : key)} style={{ cursor: 'pointer' }}>
              <td>{open ? '▼' : '▸'}</td>
              <td><strong style={{ color: 'var(--accent-bright)' }}>{row.ticker}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{usd(row.price)}</div></td>
              <td><strong>{row.dte}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.expiration}</div></td>
              <td><Structure row={row} /><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(row.put_width_pct)} / {pct(row.call_width_pct)} wings</div><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>wing Δ {num(row.put_wing_delta, 2)} / {num(row.call_wing_delta, 2)} · target {num(row.target_wing_delta, 2)}</div></td>
              <td style={{ textAlign: 'right' }}><strong style={{ color: 'var(--pos)' }}>{usd(row.entry_credit_dollars, 0)}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(row.credit_pct_of_min_wing)} of wing</div></td>
              <td style={{ textAlign: 'right' }}><strong style={{ color: 'var(--neg-strong)' }}>{usd(row.max_loss_dollars, 0)}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(row.return_on_risk_pct)} ROR</div></td>
              <td style={{ textAlign: 'right' }}><strong>{signed(row.position_delta)}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>share eq.</div></td>
              <td style={{ textAlign: 'right' }}><strong>{num(row.fit_score, 0)}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.quote_source === 'live_bid_ask' ? 'live' : 'estimate'}</div></td>
              <td><strong style={{ color: row.status === 'actionable' ? 'var(--pos)' : 'var(--amber)' }}>{row.status === 'actionable' ? 'Entry ready' : 'Needs review'}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.flags?.length || 0} flags</div></td>
              <td onClick={event => event.stopPropagation()}><RiskGraphButton kind="iron-butterfly" row={row} source="Iron Butterfly Scanner" label="Risk graph" /></td>
            </tr>
            {open && <Detail row={row} colSpan={columnCount} />}
          </React.Fragment>
        })}</tbody>
      </table></div>}

      {!loading && stats && !sortedRows.length && !error && <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>No complete iron butterfly matched the selected DTE, strike, width, and liquidity settings.</p>}
      {!loading && unavailable.length > 0 && <details style={{ marginTop: '0.8rem', color: 'var(--text-muted)' }}><summary style={{ cursor: 'pointer' }}>Unavailable tickers ({unavailable.length})</summary><ul>{unavailable.map(item => <li key={item.ticker}><strong>{item.ticker}</strong>: {item.reason}</li>)}</ul></details>}
    </div>
  )
}
