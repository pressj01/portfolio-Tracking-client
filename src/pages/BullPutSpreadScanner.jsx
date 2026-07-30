import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import PriceChartModal from '../components/PriceChartModal'

const STORAGE_KEY = 'bull-put-spread-scanner-filters'

const PRESETS = {
  conservative: {
    label: 'Conservative',
    tip: 'Confirmed uptrends, lower-delta shorts, more cushion, and tighter liquidity rules',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: false,
      min_market_cap: 20e9, fund_min_aum: 2e9, min_avg_dollar_volume: 100e6,
      min_drop_pct: 4, max_drop_pct: 18, fund_min_drop_pct: 2, fund_max_drop_pct: 12,
      min_stretch_sigma: 0.5, max_stretch_sigma: 2.0, min_rsi: 38, max_rsi: 52,
      require_above_sma200: true, require_confirmed_uptrend: true, require_profitable: true,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, exclude_leveraged_funds: true,
      earnings_buffer_days: 7, lookback_days: 21, target_dte: 35,
      short_delta: 0.20, long_delta: 0.08, delta_tolerance: 0.10,
      min_width_pct: 1, max_width_pct: 10, min_credit_pct_of_width: 20,
      min_cushion_pct: 5, min_open_interest: 100, max_exec_cost_pct: 20,
    },
  },
  balanced: {
    label: 'Balanced',
    tip: 'Healthy uptrends in controlled pullbacks with conventional 25-delta short puts',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: false,
      min_market_cap: 5e9, fund_min_aum: 500e6, min_avg_dollar_volume: 25e6,
      min_drop_pct: 3, max_drop_pct: 25, fund_min_drop_pct: 1.5, fund_max_drop_pct: 18,
      min_stretch_sigma: 0.3, max_stretch_sigma: 2.5, min_rsi: 35, max_rsi: 58,
      require_above_sma200: true, require_confirmed_uptrend: false, require_profitable: true,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, exclude_leveraged_funds: true,
      earnings_buffer_days: 5, lookback_days: 21, target_dte: 35,
      short_delta: 0.25, long_delta: 0.10, delta_tolerance: 0.12,
      min_width_pct: 1, max_width_pct: 15, min_credit_pct_of_width: 20,
      min_cushion_pct: 3, min_open_interest: 50, max_exec_cost_pct: 30,
    },
  },
  aggressive: {
    label: 'Aggressive',
    tip: 'Adds mid caps, permits weaker trends, and accepts higher delta and execution cost',
    filters: {
      universe: 'large_mid', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      min_market_cap: 2e9, fund_min_aum: 200e6, min_avg_dollar_volume: 15e6,
      min_drop_pct: 0, max_drop_pct: 30, fund_min_drop_pct: 0, fund_max_drop_pct: 25,
      min_stretch_sigma: 0, max_stretch_sigma: 3, min_rsi: 30, max_rsi: 65,
      require_above_sma200: false, require_confirmed_uptrend: false, require_profitable: true,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, exclude_leveraged_funds: true,
      earnings_buffer_days: 3, lookback_days: 42, target_dte: 45,
      short_delta: 0.30, long_delta: 0.12, delta_tolerance: 0.15,
      min_width_pct: 1, max_width_pct: 20, min_credit_pct_of_width: 18,
      min_cushion_pct: 1.5, min_open_interest: 25, max_exec_cost_pct: 40,
    },
  },
}

const DEFAULT_FILTERS = { ...PRESETS.balanced.filters, custom_tickers: '' }
const FUND_UNIVERSE_IDS = new Set(['index_etf', 'sector_etf', 'etf_all', 'stocks_and_etfs'])

const usd = (value, digits = 2) => value == null
  ? '—'
  : Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: digits })
const pct = (value, digits = 1) => value == null ? '—' : `${Number(value).toFixed(digits)}%`
const num = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits)
const sigma = value => value == null ? '—' : `${Number(value).toFixed(1)}σ`

const GRADE_COLORS = {
  A: 'var(--pos-strong)', B: 'var(--pos)', C: 'var(--amber)', D: 'var(--warning)', F: 'var(--neg-strong)',
}

function GradeBadge({ row }) {
  return (
    <span title={row.scored_on_partial ? 'Partial score: no live spread was priced' : 'Full 100-point score'} style={{
      color: GRADE_COLORS[row.grade] || 'var(--text-muted)',
      border: `1px ${row.scored_on_partial ? 'dashed' : 'solid'} ${GRADE_COLORS[row.grade] || 'var(--border)'}`,
      borderRadius: '4px', padding: '0.12rem 0.35rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {row.grade}{row.scored_on_partial ? '*' : ''} {num(row.score, 1)}
    </span>
  )
}

function KindBadge({ row }) {
  const label = row.is_fund
    ? row.fund_kind === 'index' ? 'Index' : row.fund_kind === 'sector' ? 'Sector' : 'Fund'
    : 'Stock'
  return <span style={{
    color: row.is_fund ? 'var(--teal)' : 'var(--text-muted)', border: `1px solid ${row.is_fund ? 'var(--teal)' : 'var(--border)'}`,
    borderRadius: '3px', padding: '0.08rem 0.3rem', fontSize: '0.68rem',
  }}>{label}</span>
}

const FLAG_SHORT = {
  'Price below the 200-day average': 'Below 200d',
  '50-day below the 200-day average': 'Weak trend',
  'Making fresh 52-week lows': 'Fresh low',
  'Not profitable on trailing earnings': 'Unprofitable',
  'Heavy debt load': 'Heavy debt',
  'Credit too small for the defined risk': 'Credit too small',
  'Two-leg slippage is high': 'Slippage',
  'Thin open interest on one leg': 'Thin OI',
  'Short strike is too close': 'Strike too close',
  'No pair met every spread filter': 'Filters missed',
  'Earnings before expiration': 'Earnings',
  'Option chain unavailable': 'No chain',
  'Not priced — outside chain limit': 'Not priced',
}

function Flags({ flags = [] }) {
  if (!flags.length) return <span style={{ color: 'var(--pos)' }}>—</span>
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
      {flags.map(flag => <span key={flag} title={flag} style={{
        color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: '3px',
        padding: '0.06rem 0.22rem', fontSize: '0.62rem', whiteSpace: 'nowrap',
      }}>{FLAG_SHORT[flag] || flag}</span>)}
    </span>
  )
}

function ScoreBar({ label, value, max }) {
  const fraction = max ? Math.max(0, Math.min(1, (value || 0) / max)) : 0
  return (
    <div style={{ marginBottom: '0.45rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
        <span>{label}</span><span>{num(value, 1)} / {max}</span>
      </div>
      <div style={{ height: '6px', borderRadius: '3px', background: 'var(--surface-inset)', overflow: 'hidden' }}>
        <div style={{ width: `${fraction * 100}%`, height: '100%', background: 'var(--accent-bright)' }} />
      </div>
    </div>
  )
}

function HelpPanel() {
  const [open, setOpen] = useState('construction')
  const section = (id, title, body) => (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button type="button" onClick={() => setOpen(open === id ? null : id)} style={{
        width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer',
        color: 'var(--text-strong)', padding: '0.6rem 0', fontWeight: 700,
      }}>{open === id ? '▾' : '▸'} {title}</button>
      {open === id && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.55, paddingBottom: '0.7rem' }}>{body}</div>}
    </div>
  )
  return (
    <div style={{
      background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: '6px',
      padding: '0.25rem 0.9rem', marginBottom: '0.8rem',
    }}>
      {section('construction', 'What the scanner is selling', <>
        <p>A bull put spread sells a higher-strike put and buys a lower-strike put in the same expiration. The net credit is the maximum profit. Maximum loss is the strike width minus that credit, and breakeven is the short strike minus the credit.</p>
        <p style={{ marginBottom: 0 }}>The underlying thesis is neutral to moderately bullish. This scanner therefore looks for a controlled pullback inside a healthy trend, not the deep dislocation or falling-knife setup used by cash-secured put selling.</p>
      </>)}
      {section('filters', 'Why these filters are hard gates', <>
        <p><strong>Credit % of width</strong> prevents taking substantial defined risk for a token premium. <strong>Breakeven cushion</strong> measures how far the stock can fall before the trade loses at expiration. <strong>Min OI</strong> applies to the thinner leg, and <strong>Max slippage</strong> measures both bid/ask spreads against the credit.</p>
        <p style={{ marginBottom: 0 }}>Only live spreads meeting every selected structure limit appear as actionable. With the earnings skip enabled, reports inside Target DTE plus the safety buffer remove the ticker entirely; relaxed pairs, missing chains, and names outside the live-pricing limit stay in Watchlist Candidates.</p>
      </>)}
      {section('management', 'Management and expiration risk', <>
        <p>The management card gives a limit debit for closing both legs after capturing 50–65% of the original credit, a risk trigger near twice the entry credit, a reassessment date, and a close-by date before expiration.</p>
        <p>Close the spread as one order. Assignment of the short put can occur before expiration, and holding near expiration creates uncertainty when the stock is close to the short strike. The long put limits the intact spread, but it does not automatically prevent temporary stock, financing, or margin exposure after assignment.</p>
        <p style={{ marginBottom: 0 }}>
          Educational references: <a href="https://www.optionseducation.org/strategies/all-strategies/bull-put-spread-credit-put-spread" target="_blank" rel="noreferrer">Options Industry Council</a>
          {' · '}<a href="https://www.finra.org/investors/insights/trading-options-understanding-assignment" target="_blank" rel="noreferrer">FINRA assignment guidance</a>
        </p>
      </>)}
      {section('score', 'How the 100-point score works', <>
        <p><strong>Setup 30:</strong> controlled pullback, RSI, price above the 200-day, and 50/200 trend structure. <strong>Quality 20:</strong> the same profitability, balance-sheet, size, diversification, and share-liquidity model used by Put Selling.</p>
        <p style={{ marginBottom: 0 }}><strong>Premium 25:</strong> IV over realized volatility, credit over realized-vol fair value, and annualized return on defined risk. <strong>Safety 25:</strong> modeled OTM probability, breakeven cushion, two-leg execution cost, open interest, and whether a natural fill remains a credit.</p>
      </>)}
    </div>
  )
}

function DetailRow({ row, colSpan }) {
  const spread = row.spread
  const plan = spread?.management
  const cell = (label, value) => (
    <div style={{ background: 'var(--surface-inset)', borderRadius: '4px', padding: '0.5rem' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{value}</div>
    </div>
  )
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '0.8rem', background: 'var(--surface-sunken)' }}>
        <p style={{ margin: '0 0 0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{row.verdict}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 0.7fr) minmax(420px, 2fr)', gap: '1rem' }}>
          <div>
            <ScoreBar label="Setup" value={row.components?.setup} max={30} />
            <ScoreBar label="Quality" value={row.components?.quality} max={20} />
            <ScoreBar label="Premium" value={row.components?.premium} max={25} />
            <ScoreBar label="Safety" value={row.components?.safety} max={25} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(110px, 1fr))', gap: '0.45rem' }}>
            {cell('52-week range', `${usd(row.week52_low)} – ${usd(row.week52_high)}`)}
            {cell('SMA 50 / 200', `${usd(row.sma_50)} / ${usd(row.sma_200)}`)}
            {cell('Market cap / AUM', row.size ? usd(row.size, 0) : '—')}
            {cell('Next earnings', row.next_earnings || 'None')}
            {cell('IV / RV', row.iv_rv_ratio == null ? '—' : `${num(row.iv_rv_ratio, 2)}×`)}
            {spread && <>
              {cell('Short put quote', `${usd(spread.short_leg?.bid)} × ${usd(spread.short_leg?.ask)} · Δ ${num(spread.short_leg?.delta, 2)}`)}
              {cell('Long put quote', `${usd(spread.long_leg?.bid)} × ${usd(spread.long_leg?.ask)} · Δ ${num(spread.long_leg?.delta, 2)}`)}
              {cell('Mid / natural credit', `${usd(spread.credit)} / ${usd(spread.natural_credit)}`)}
              {cell('Breakeven', `${usd(spread.breakeven)} · ${pct(spread.breakeven_cushion_pct)} cushion`)}
              {cell('Max profit / loss', `${usd(spread.max_profit_dollars, 0)} / ${usd(spread.max_loss_dollars, 0)}`)}
              {cell('Credit / width', `${pct(spread.credit_pct_of_width)} · ${pct(spread.return_on_risk_pct)} ROR`)}
              {cell('Annualized ROR', pct(spread.annualized_return_on_risk_pct))}
              {cell('Fair credit / edge', `${usd(spread.fair_credit)} / ${pct(spread.premium_edge_pct)}`)}
              {cell('Two-leg slippage', `${usd(spread.exec_cost)} · ${pct(spread.exec_cost_pct)}`)}
              {cell('Thinner leg OI', Number(spread.open_interest_min || 0).toLocaleString())}
            </>}
          </div>
        </div>
        {plan && <div style={{
          marginTop: '0.75rem', padding: '0.65rem', border: '1px solid var(--accent)',
          borderRadius: '5px', color: 'var(--text-muted)', lineHeight: 1.45,
        }}>
          <strong style={{ color: 'var(--accent-bright)' }}>{plan.profile}:</strong>
          {' '}buy back the complete spread near <strong>{usd(plan.target_debit)}</strong> to capture
          {' '}{pct(plan.profit_capture_pct, 0)} ({usd(plan.target_profit_dollars, 0)}).
          Treat <strong>{usd(plan.stop_debit)}</strong> as a risk trigger, reassess near
          {' '}{plan.reassess_dte} DTE, and close by {plan.close_by_dte} DTE rather than accepting expiration/pin risk.
          {' '}{plan.rationale}
        </div>}
        {row.watchlist_reason && <div style={{ marginTop: '0.6rem', color: 'var(--amber)' }}>
          <strong>Watchlist only:</strong> {row.watchlist_reason}
        </div>}
      </td>
    </tr>
  )
}

const COLUMNS = [
  ['ticker', 'Ticker', 'left'], ['kind', 'Type', 'left'], ['score', 'Score', 'left'],
  ['price', 'Price', 'right'], ['trend', 'Trend', 'center'], ['drawdown_pct', 'Pullback', 'right'],
  ['rsi_14', 'RSI', 'right'], ['iv_rv_ratio', 'IV/RV', 'right'],
  ['spread', 'Sell This Spread', 'center'], ['dte', 'DTE', 'right'], ['risk', 'Credit / Risk', 'right'],
  ['cushion', 'Cushion', 'right'], ['prob', 'Prob. OTM', 'right'],
  ['ror', 'Ann. ROR', 'right'], ['manage', 'Manage', 'right'], ['flags', 'Warnings', 'left'],
]

const SORT_ACCESSORS = {
  kind: row => row.is_fund ? (row.fund_kind || 'fund') : 'stock',
  trend: row => (row.price >= row.sma_200 ? 2 : 0) + (row.sma_50 >= row.sma_200 ? 1 : 0),
  spread: row => row.spread?.short_strike ?? null,
  dte: row => row.spread?.dte ?? null,
  risk: row => row.spread?.return_on_risk_pct ?? null,
  cushion: row => row.spread?.breakeven_cushion_pct ?? null,
  prob: row => row.spread?.prob_otm ?? null,
  ror: row => row.spread?.annualized_return_on_risk_pct ?? null,
  manage: row => row.spread?.management?.target_debit ?? null,
  flags: row => row.flags?.length ?? 0,
}

export default function BullPutSpreadScanner() {
  const pf = useProfileFetch()
  const [filters, setFilters] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      return saved ? { ...DEFAULT_FILTERS, ...saved } : DEFAULT_FILTERS
    } catch {
      return DEFAULT_FILTERS
    }
  })
  const [universes, setUniverses] = useState([])
  const [rows, setRows] = useState([])
  const [watchlistRows, setWatchlistRows] = useState([])
  const [stats, setStats] = useState(null)
  const [asOf, setAsOf] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [chartTicker, setChartTicker] = useState(null)
  const [sortCol, setSortCol] = useState('score')
  const [sortAsc, setSortAsc] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)

  useEffect(() => {
    pf('/api/options/bull-put-spread-scan/universes')
      .then(response => response.json())
      .then(data => setUniverses(data.universes || []))
      .catch(() => {})
  }, [pf])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)) }, [filters])

  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const anyFunds = !!(filters.include_index_etfs || filters.include_sector_etfs)
  const nothingSelected = !filters.include_stocks && !anyFunds

  const runScan = useCallback(() => {
    setLoading(true)
    setError(null)
    setExpanded(null)
    const body = { ...filters }
    if (body.universe === 'custom') {
      body.custom_tickers = String(filters.custom_tickers || '').split(/[\s,]+/).filter(Boolean)
    } else {
      delete body.custom_tickers
    }
    pf('/api/options/bull-put-spread-scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
      .then(response => response.json())
      .then(data => {
        if (data.error) setError(data.error)
        setRows(data.rows || [])
        setWatchlistRows(data.watchlist_rows || [])
        setStats(data.stats || null)
        setAsOf(data.as_of || null)
        setHasScanned(true)
      })
      .catch(scanError => setError(scanError.message))
      .finally(() => setLoading(false))
  }, [pf, filters])

  const sortedRows = useMemo(() => {
    const accessor = SORT_ACCESSORS[sortCol] || (row => row[sortCol])
    return [...rows].sort((a, b) => {
      const av = accessor(a), bv = accessor(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? av - bv : bv - av
    })
  }, [rows, sortCol, sortAsc])
  const toggleSort = key => {
    if (sortCol === key) setSortAsc(value => !value)
    else { setSortCol(key); setSortAsc(false) }
  }
  const arrow = key => sortCol === key ? (sortAsc ? ' ▴' : ' ▾') : ''

  const numField = (label, key, { step = 1, min = 0, max, width = 64, suffix = '', scale = 1, tip } = {}) => (
    <label title={tip} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
      {label}
      <span><input type="number" step={step} min={min} max={max}
        value={filters[key] == null ? '' : filters[key] / scale}
        onChange={event => set(key, event.target.value === '' ? null : Number(event.target.value) * scale)}
        style={{ width, padding: '0.3rem 0.4rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-strong)' }}
      />{suffix && <span style={{ marginLeft: '0.2rem' }}>{suffix}</span>}</span>
    </label>
  )
  const checkField = (label, key, tip) => <label title={tip} style={{
    display: 'flex', gap: '0.35rem', alignItems: 'center', color: 'var(--text-dim)', fontSize: '0.76rem', cursor: 'pointer',
  }}><input type="checkbox" checked={!!filters[key]} onChange={event => set(key, event.target.checked)} />{label}</label>

  const renderSpreadCells = row => {
    const spread = row.spread
    return <>
      <td style={{ textAlign: 'center' }}>{spread ? <div style={{
        display: 'inline-block', padding: '0.15rem 0.45rem', border: '1px solid var(--pos)', borderRadius: 4,
        background: 'var(--surface-inset)', lineHeight: 1.25,
      }}>
        <div style={{ color: 'var(--pos-strong)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          ${spread.short_strike} / ${spread.long_strike} P
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
          exp {spread.expiration}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
          {usd(spread.credit)} credit · {pct(spread.credit_pct_of_width, 0)} width
        </div>
      </div> : '—'}</td>
      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {spread ? `${spread.dte}d` : '—'}
      </td>
      <td style={{ textAlign: 'right' }}>{spread ? <>
        <div><span style={{ color: 'var(--pos-strong)' }}>{usd(spread.max_profit_dollars, 0)}</span>
          {' / '}<span style={{ color: 'var(--neg-strong)' }}>{usd(spread.max_loss_dollars, 0)}</span></div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(spread.return_on_risk_pct)} ROR</div>
      </> : '—'}</td>
      <td style={{ textAlign: 'right' }}>{spread ? <>
        <div>{pct(spread.breakeven_cushion_pct)}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>BE {usd(spread.breakeven)}</div>
      </> : '—'}</td>
      <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{spread ? pct(spread.prob_otm, 0) : '—'}</td>
      <td style={{ textAlign: 'right' }}>{spread ? pct(spread.annualized_return_on_risk_pct, 0) : '—'}</td>
      <td style={{ textAlign: 'right' }}>{spread?.management ? <>
        <div style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>{usd(spread.management.target_debit)}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>buy back · take {pct(spread.management.profit_capture_pct, 0)}</div>
      </> : '—'}</td>
      <td style={{ minWidth: 145, maxWidth: 190, whiteSpace: 'normal' }}><Flags flags={row.flags} /></td>
    </>
  }

  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.35rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Bull Put Spread Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)}>
          {showHelp ? 'Hide Help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Finds healthy stocks and ETFs in controlled pullbacks, then sells an out-of-the-money put spread with
        defined risk, adequate credit, a real breakeven cushion, and a two-sided market on both legs.
      </p>
      {showHelp && <HelpPanel />}

      <div style={{
        display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.6rem 0.85rem',
        background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: '0.6rem',
      }}>
        <strong style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Include:</strong>
        {[
          ['include_stocks', 'Stocks'], ['include_index_etfs', 'Index ETFs'], ['include_sector_etfs', 'Sector & commodity ETFs'],
        ].map(([key, label]) => <label key={key} style={{ color: filters[key] ? 'var(--text-strong)' : 'var(--text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!filters[key]} onChange={event => set(key, event.target.checked)} /> {label}
        </label>)}
        {nothingSelected && <span style={{ color: 'var(--neg-strong)' }}>Pick at least one.</span>}
      </div>

      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.76rem' }}>Preset:</span>
        {Object.entries(PRESETS).map(([key, preset]) => <button key={key} className="btn btn-xs btn-outline"
          title={preset.tip} onClick={() => setFilters(current => ({ ...current, ...preset.filters }))}>
          {preset.label}
        </button>)}
      </div>

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.85rem', alignItems: 'flex-end', padding: '0.85rem',
        background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: '0.7rem',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.75rem', opacity: filters.include_stocks ? 1 : 0.45 }}>
          Stock universe
          <select value={filters.universe} disabled={!filters.include_stocks} onChange={event => set('universe', event.target.value)}
            style={{ minWidth: 155, padding: '0.3rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-strong)' }}>
            {universes.filter(item => !FUND_UNIVERSE_IDS.has(item.id)).map(item =>
              <option key={item.id} value={item.id}>{item.label}{item.count ? ` (${item.count})` : ''}</option>)}
          </select>
        </label>
        {filters.include_stocks && filters.universe === 'custom' && <label style={{ flex: '1 1 230px', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
          Tickers<input value={filters.custom_tickers || ''} onChange={event => set('custom_tickers', event.target.value.toUpperCase())}
            placeholder="AAPL, MSFT, SPY..." style={{ width: '100%', display: 'block', padding: '0.3rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-strong)' }} />
        </label>}
        {filters.include_stocks && numField('Min pullback', 'min_drop_pct', { suffix: '%' })}
        {filters.include_stocks && numField('Max pullback', 'max_drop_pct', { suffix: '%' })}
        {anyFunds && numField('ETF min pullback', 'fund_min_drop_pct', { suffix: '%' })}
        {anyFunds && numField('ETF max pullback', 'fund_max_drop_pct', { suffix: '%' })}
        {numField('Min stretch', 'min_stretch_sigma', { step: 0.1, suffix: 'σ' })}
        {numField('Max stretch', 'max_stretch_sigma', { step: 0.1, suffix: 'σ' })}
        {numField('Min RSI', 'min_rsi')}
        {numField('Max RSI', 'max_rsi')}
        {filters.include_stocks && numField('Min mkt cap', 'min_market_cap', { scale: 1e9, suffix: 'B' })}
        {anyFunds && numField('ETF min AUM', 'fund_min_aum', { scale: 1e6, suffix: 'M' })}
        {numField('Min $ volume', 'min_avg_dollar_volume', { scale: 1e6, suffix: 'M' })}
        {numField('Lookback', 'lookback_days', { suffix: 'd' })}
        {numField('Target DTE', 'target_dte', { min: 1, max: 1095 })}
        {numField('Short delta', 'short_delta', { step: 0.05 })}
        {numField('Long delta', 'long_delta', { step: 0.05 })}
        {numField('Min width', 'min_width_pct', { step: 0.5, suffix: '% spot' })}
        {numField('Max width', 'max_width_pct', { step: 0.5, suffix: '% spot' })}
        {numField('Min credit', 'min_credit_pct_of_width', { suffix: '% width' })}
        {numField('Min cushion', 'min_cushion_pct', { step: 0.5, suffix: '%' })}
        {numField('Min leg OI', 'min_open_interest', { width: 72 })}
        {numField('Max slippage', 'max_exec_cost_pct', { suffix: '% credit' })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {checkField('Require price above 200-day', 'require_above_sma200', 'Keeps the long-term bullish structure intact')}
          {checkField('Require 50-day above 200-day', 'require_confirmed_uptrend', 'Stricter confirmation of the uptrend')}
          {filters.include_stocks && checkField('Profitable only', 'require_profitable', 'Avoid selling bullish spreads on unprofitable companies')}
          {checkField('Skip fresh 52-week lows', 'exclude_fresh_lows', 'Avoid falling knives')}
          {filters.include_stocks && checkField('Skip earnings inside trade', 'exclude_earnings_before_expiry', 'Exclude stocks whose next report falls within Target DTE plus the safety buffer; never substitute a very short expiration')}
          {anyFunds && checkField('Skip leveraged / inverse ETFs', 'exclude_leveraged_funds', 'Avoid path-dependent leveraged products')}
        </div>
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading || nothingSelected}>
          {loading ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p style={{ color: 'var(--text-dim)' }}>
        Screening price and quality first, then evaluating every plausible two-leg spread for the finalists.
      </p>}
      {stats && !loading && <div style={{ color: 'var(--text-dim)', fontSize: '0.77rem', marginBottom: '0.55rem' }}>
        Scanned <strong>{stats.priced}</strong> of {stats.universe}
        {' → '}<strong>{stats.passed_price}</strong> controlled pullbacks
        {' → '}<strong>{stats.passed_fundamentals}</strong> passed quality
        {' → '}<strong style={{ color: 'var(--pos-strong)' }}>{stats.actionable}</strong> actionable
        {stats.watchlist ? ` · ${stats.watchlist} watchlist` : ''}
        {stats.chains_fetched ? ` · ${stats.chains_fetched} live spreads found` : ''}
        {stats.dropped_for_earnings ? ` · ${stats.dropped_for_earnings} excluded for earnings` : ''}
        {asOf ? ` · ${new Date(asOf).toLocaleString()}` : ''}
      </div>}

      {sortedRows.length > 0 && <>
        <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0.8rem 0 0.4rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-strong)' }}>Actionable Spreads</h2>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>Live pairs meeting every enabled risk gate</span>
        </div>
        <div className="sst-wrap" style={{ maxHeight: '70vh' }}>
          <table className="sst">
            <thead><tr><th style={{ width: 24 }} />{COLUMNS.map(([key, label, align]) =>
              <th key={key} onClick={() => toggleSort(key)} style={{ cursor: 'pointer', textAlign: align }}>{label}{arrow(key)}</th>)}</tr></thead>
            <tbody>{sortedRows.map(row => {
              const open = expanded === row.ticker
              return <React.Fragment key={row.ticker}>
                <tr onClick={() => setExpanded(open ? null : row.ticker)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--text-dim)' }}>{open ? '▾' : '▸'}</td>
                  <td><a href="#" onClick={event => { event.preventDefault(); event.stopPropagation(); setChartTicker(row.ticker) }}
                    style={{ color: 'var(--accent-bright)', fontWeight: 700, textDecoration: 'none' }}>{row.ticker} 📈</a>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div></td>
                  <td><KindBadge row={row} /></td><td><GradeBadge row={row} /></td>
                  <td style={{ textAlign: 'right' }}>{usd(row.price)}</td>
                  <td style={{ textAlign: 'center' }}><span title="Price above 200-day" style={{ color: row.price >= row.sma_200 ? 'var(--pos)' : 'var(--neg)' }}>200</span>
                    {' '}<span title="50-day above 200-day" style={{ color: row.sma_50 >= row.sma_200 ? 'var(--pos)' : 'var(--text-dim)' }}>50/200</span></td>
                  <td style={{ textAlign: 'right' }}><div>{pct(-row.drawdown_pct)}</div><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{sigma(row.stretch_sigma)}</div></td>
                  <td style={{ textAlign: 'right' }}>{num(row.rsi_14, 0)}</td>
                  <td style={{ textAlign: 'right', color: row.iv_rv_ratio >= 1 ? 'var(--pos)' : 'var(--text-muted)' }}>{row.iv_rv_ratio == null ? '—' : `${num(row.iv_rv_ratio, 2)}×`}</td>
                  {renderSpreadCells(row)}
                </tr>
                {open && <DetailRow row={row} colSpan={COLUMNS.length + 1} />}
              </React.Fragment>
            })}</tbody>
          </table>
        </div>
      </>}

      {!loading && watchlistRows.length > 0 && <details open={sortedRows.length === 0} style={{
        marginTop: '1rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-sunken)', overflow: 'hidden',
      }}>
        <summary style={{ cursor: 'pointer', padding: '0.7rem 0.85rem', color: 'var(--text-strong)', fontWeight: 700 }}>
          Watchlist Candidates ({watchlistRows.length})
          <span style={{ marginLeft: '0.6rem', color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.74rem' }}>
            Underlying setup passed, but the trade is not currently actionable
          </span>
        </summary>
        <div className="sst-wrap" style={{ maxHeight: '45vh', borderLeft: 0, borderRight: 0, borderBottom: 0 }}>
          <table className="sst">
            <thead><tr><th /><th>Ticker</th><th>Type</th><th>Score</th><th>Pullback</th><th>Status</th><th>Indicative Spread</th><th style={{ textAlign: 'right' }}>DTE</th><th>Warnings</th></tr></thead>
            <tbody>{watchlistRows.map(row => {
              const open = expanded === row.ticker
              const status = {
                earnings: 'Earnings inside trade', constraints_relaxed: 'Structure limits missed',
                unavailable: 'No quotable spread', not_priced: 'Awaiting live pricing',
              }[row.chain_status] || 'Not actionable'
              return <React.Fragment key={row.ticker}>
                <tr onClick={() => setExpanded(open ? null : row.ticker)} style={{ cursor: 'pointer' }}>
                  <td>{open ? '▾' : '▸'}</td>
                  <td><strong style={{ color: 'var(--accent-bright)' }}>{row.ticker}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{row.name}</div></td>
                  <td><KindBadge row={row} /></td><td><GradeBadge row={row} /></td>
                  <td>{pct(-row.drawdown_pct)} · {sigma(row.stretch_sigma)}</td>
                  <td style={{ color: 'var(--amber)', maxWidth: 300 }}><strong>{status}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{row.watchlist_reason}</div></td>
                  <td>{row.spread ? `$${row.spread.short_strike} / $${row.spread.long_strike} · ${usd(row.spread.credit)} credit` : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.spread ? `${row.spread.dte}d` : '—'}</td>
                  <td><Flags flags={row.flags} /></td>
                </tr>
                {open && <DetailRow row={row} colSpan={9} />}
              </React.Fragment>
            })}</tbody>
          </table>
        </div>
      </details>}

      {!loading && hasScanned && !sortedRows.length && !watchlistRows.length && !error && <p style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: '2rem' }}>
        Nothing passed the underlying filters. Try the Balanced preset, widen the pullback or RSI ranges, or include index ETFs.
      </p>}
      {!loading && hasScanned && !sortedRows.length && watchlistRows.length > 0 && !error && <p style={{ textAlign: 'center', color: 'var(--amber)', marginTop: '1rem' }}>
        No currently actionable spread met every enabled risk gate. The watchlist above shows the exact reason for each candidate.
      </p>}
      {!hasScanned && !loading && <p style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: '2rem' }}>
        Pick a preset or adjust the filters, then run the scan.
      </p>}
      {chartTicker && <PriceChartModal ticker={chartTicker} onClose={() => setChartTicker(null)} />}
    </div>
  )
}
