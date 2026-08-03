import { useCallback, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { stageTrackedTrade } from '../utils/optionTradeHandoff'

const PURPOSES = ['Income', 'Directional', 'Hedge', 'Adjustment', 'Other']
const CUSTOM_STRATEGY = '__custom_strategy__'
const STRATEGIES = [
  'Covered Call', 'Cash-Secured Put', 'Short Call', 'Short Put',
  'Bull Put Spread', 'Bear Call Spread', 'Bull Call Spread', 'Bear Put Spread',
  'Iron Condor', 'Unbalanced Iron Condor', 'Unbalanced Put Condor',
  'Iron Butterfly', 'Butterfly', 'Unbalanced Butterfly', 'Double-Hedge Put Butterfly',
  'Road Trip Butterfly', '60/40/20 Butterfly', 'Calendar', 'Diagonal',
  'Long Call', 'Long Put', 'Long Straddle', 'Long Strangle',
  'Short Straddle', 'Short Strangle', 'Collar', 'Protective Put',
]

const money = (value, fallback = '—') => {
  if (value == null || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return number.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

const percent = (value) => {
  if (value == null || value === '') return '—'
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '—'
}

const shortDate = (value) => {
  if (!value) return '—'
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const blankLeg = () => ({
  position_side: 'SHORT', option_type: 'PUT', expiration: '', strike: '', contracts: 1,
  price: '', fees: 0, multiplier: 100, occ_symbol: '',
})

const blankTrade = () => ({
  underlying: '', strategy_type: 'Cash-Secured Put', purpose: 'Income',
  opened_at: todayIso(), max_risk: '', notes: '', legs: [blankLeg()],
})

async function jsonOrError(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

function MetricCard({ label, value, detail, tone = '' }) {
  return (
    <div className={`ot-metric ${tone ? `ot-metric-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function StrategyField({ value, onChange }) {
  const usesCustomName = !STRATEGIES.includes(value)
  return (
    <label className="ot-strategy-field">
      <span>Strategy</span>
      <select
        value={usesCustomName ? CUSTOM_STRATEGY : value}
        onChange={event => onChange(event.target.value === CUSTOM_STRATEGY ? '' : event.target.value)}
      >
        {STRATEGIES.map(item => <option key={item} value={item}>{item}</option>)}
        <option value={CUSTOM_STRATEGY}>Custom name…</option>
      </select>
      {usesCustomName && <input aria-label="Custom strategy name" value={value} onChange={event => onChange(event.target.value)} placeholder="Enter your strategy name" required />}
    </label>
  )
}

function AddTradeForm({ onCancel, onSaved }) {
  const pf = useProfileFetch()
  const [form, setForm] = useState(blankTrade)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const changeLeg = (index, field, value) => {
    setForm(current => ({
      ...current,
      legs: current.legs.map((leg, legIndex) => legIndex === index ? { ...leg, [field]: value } : leg),
    }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await jsonOrError(await pf('/api/option-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }))
      onSaved()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ot-editor card" onSubmit={submit}>
      <div className="ot-section-heading">
        <div>
          <span className="ot-eyebrow">Actual fills</span>
          <h2>Add option trade</h2>
          <p>Enter one row per contract leg. Premiums are quoted per share; the 100× contract multiplier is applied automatically.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>

      <div className="ot-form-grid">
        <label><span>Underlying</span><input value={form.underlying} onChange={event => setForm({ ...form, underlying: event.target.value.toUpperCase() })} placeholder="SPY" required /></label>
        <StrategyField value={form.strategy_type} onChange={strategyType => setForm({ ...form, strategy_type: strategyType })} />
        <label><span>Purpose</span><select value={form.purpose} onChange={event => setForm({ ...form, purpose: event.target.value })}>{PURPOSES.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Open date</span><input type="date" value={form.opened_at} onChange={event => setForm({ ...form, opened_at: event.target.value })} required /></label>
        <label><span>Maximum risk (optional)</span><input type="number" min="0" step="0.01" value={form.max_risk} onChange={event => setForm({ ...form, max_risk: event.target.value })} placeholder="Derived for defined-risk spreads" /></label>
        <label className="ot-form-wide"><span>Notes</span><input value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Trade thesis, adjustment plan, target…" /></label>
      </div>

      <div className="ot-legs-editor">
        <div className="ot-leg-labels" aria-hidden="true">
          <span>Side</span><span>Type</span><span>Expiration</span><span>Strike</span><span>Contracts</span><span>Open price</span><span>Fees</span><span>OCC symbol</span><span />
        </div>
        {form.legs.map((leg, index) => (
          <div className="ot-leg-inputs" key={index}>
            <select aria-label={`Leg ${index + 1} side`} value={leg.position_side} onChange={event => changeLeg(index, 'position_side', event.target.value)}><option>LONG</option><option>SHORT</option></select>
            <select aria-label={`Leg ${index + 1} type`} value={leg.option_type} onChange={event => changeLeg(index, 'option_type', event.target.value)}><option>CALL</option><option>PUT</option></select>
            <input aria-label={`Leg ${index + 1} expiration`} type="date" value={leg.expiration} onChange={event => changeLeg(index, 'expiration', event.target.value)} required />
            <input aria-label={`Leg ${index + 1} strike`} type="number" min="0.01" step="0.01" value={leg.strike} onChange={event => changeLeg(index, 'strike', event.target.value)} required />
            <input aria-label={`Leg ${index + 1} contracts`} type="number" min="1" step="1" value={leg.contracts} onChange={event => changeLeg(index, 'contracts', event.target.value)} required />
            <input aria-label={`Leg ${index + 1} open price`} type="number" min="0" step="0.01" value={leg.price} onChange={event => changeLeg(index, 'price', event.target.value)} required />
            <input aria-label={`Leg ${index + 1} fees`} type="number" min="0" step="0.01" value={leg.fees} onChange={event => changeLeg(index, 'fees', event.target.value)} />
            <input aria-label={`Leg ${index + 1} OCC symbol`} value={leg.occ_symbol} onChange={event => changeLeg(index, 'occ_symbol', event.target.value.toUpperCase())} placeholder="Optional" />
            <button type="button" className="ot-icon-button" aria-label={`Remove leg ${index + 1}`} disabled={form.legs.length === 1} onClick={() => setForm({ ...form, legs: form.legs.filter((_, legIndex) => legIndex !== index) })}>×</button>
          </div>
        ))}
      </div>

      <div className="ot-form-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setForm({ ...form, legs: [...form.legs, blankLeg()] })}>+ Add leg</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save trade'}</button>
      </div>
      {error && <div className="ot-alert ot-alert-error">{error}</div>}
    </form>
  )
}

function CloseTradeForm({ trade, onCancel, onSaved }) {
  const pf = useProfileFetch()
  const openLegs = trade.legs.filter(leg => Number(leg.open_contracts) > 0)
  const [closedAt, setClosedAt] = useState(todayIso)
  const [rows, setRows] = useState(() => openLegs.map(leg => ({
    leg_id: leg.id,
    action: String(leg.expiration).slice(0, 10) <= todayIso() ? 'EXPIRE' : leg.position_side === 'LONG' ? 'STC' : 'BTC',
    contracts: leg.open_contracts,
    price: '',
    fees: 0,
  })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const change = (index, field, value) => setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await jsonOrError(await pf(`/api/option-trades/${trade.id}/close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed_at: closedAt, executions: rows }),
      }))
      onSaved()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ot-close-panel" onSubmit={submit}>
      <div className="ot-close-heading"><strong>Record close or expiration</strong><label><span>Date</span><input type="date" value={closedAt} onChange={event => setClosedAt(event.target.value)} required /></label></div>
      {rows.map((row, index) => {
        const leg = openLegs[index]
        const zeroPrice = ['EXPIRE', 'ASSIGN', 'EXERCISE'].includes(row.action)
        return (
          <div className="ot-close-row" key={row.leg_id}>
            <span>{leg.position_side} {leg.contracts}× {leg.expiration} {leg.strike} {leg.option_type}</span>
            <select value={row.action} onChange={event => change(index, 'action', event.target.value)}>
              <option value={leg.position_side === 'LONG' ? 'STC' : 'BTC'}>{leg.position_side === 'LONG' ? 'Sell to close' : 'Buy to close'}</option>
              <option value="EXPIRE">Expired</option>
              <option value="ASSIGN">Assigned</option>
              <option value="EXERCISE">Exercised</option>
            </select>
            <label><span>Contracts</span><input type="number" min="1" max={leg.open_contracts} value={row.contracts} onChange={event => change(index, 'contracts', event.target.value)} /></label>
            <label><span>Price</span><input type="number" min="0" step="0.01" value={zeroPrice ? 0 : row.price} disabled={zeroPrice} onChange={event => change(index, 'price', event.target.value)} required={!zeroPrice} /></label>
            <label><span>Fees</span><input type="number" min="0" step="0.01" value={row.fees} onChange={event => change(index, 'fees', event.target.value)} /></label>
          </div>
        )
      })}
      <div className="ot-form-actions"><button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record executions'}</button></div>
      {error && <div className="ot-alert ot-alert-error">{error}</div>}
    </form>
  )
}

function ClassificationForm({ trade, onCancel, onSaved }) {
  const pf = useProfileFetch()
  const [strategyType, setStrategyType] = useState(trade.strategy_type || 'Custom')
  const [purpose, setPurpose] = useState(trade.purpose || 'Other')
  const [maxRisk, setMaxRisk] = useState(trade.max_risk ?? '')
  const [notes, setNotes] = useState(trade.notes || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await jsonOrError(await pf(`/api/option-trades/${trade.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_type: strategyType, purpose, max_risk: maxRisk, notes }),
      }))
      onSaved()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ot-classify-panel" onSubmit={submit}>
      <div>
        <span className="ot-eyebrow">Trade classification</span>
        <strong>Tell the ledger what this {trade.underlying} trade is</strong>
        <p>Strategy describes the leg structure. Purpose controls whether realized P/L can be included in the income total.</p>
      </div>
      <StrategyField value={strategyType} onChange={setStrategyType} />
      <label><span>Purpose</span><select value={purpose} onChange={event => setPurpose(event.target.value)}>{PURPOSES.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span>Maximum risk</span><input type="number" min="0" step="0.01" value={maxRisk} onChange={event => setMaxRisk(event.target.value)} placeholder="Optional" /></label>
      <label className="ot-classify-notes"><span>Notes</span><input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Why this classification applies" /></label>
      <div className="ot-form-actions"><button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save classification'}</button></div>
      {error && <div className="ot-alert ot-alert-error">{error}</div>}
    </form>
  )
}

function TradeDetails({ trade }) {
  const stock = trade.stock_position
  return (
    <div className="ot-trade-detail">
      <div className="ot-detail-summary">
        <span><small>Source</small>{trade.source_format || trade.source}</span>
        <span><small>Total fees</small>{money(trade.total_fees)}</span>
        <span><small>Net cash flow</small>{money(trade.net_cash_flow)}</span>
        <span><small>Risk method</small>{trade.max_risk_source || 'Not available'}</span>
        {stock && <span><small>Stock coverage</small>{stock.portfolio_shares} held / {stock.required_shares} required ({percent(stock.coverage_pct)})</span>}
        {trade.notes && <span className="ot-detail-notes"><small>Notes</small>{trade.notes}</span>}
      </div>
      <div className="table-scroll">
        <table className="ot-detail-table">
          <thead><tr><th>Leg</th><th>Expiration</th><th>Strike</th><th>Contracts</th><th>Open</th><th>Net cash</th><th>Executions</th></tr></thead>
          <tbody>
            {stock && <tr className={stock.covered ? 'ot-stock-covered' : 'ot-stock-shortfall'}>
              <td><strong>LONG STOCK</strong></td>
              <td>—</td>
              <td>—</td>
              <td>{stock.shares} shares linked</td>
              <td>{stock.portfolio_shares} held</td>
              <td>{money(stock.cost_basis)} basis</td>
              <td><div className="ot-executions"><span><b>{stock.covered ? 'COVERED' : 'SHORTFALL'}</b> {stock.required_shares} shares required{stock.shortfall_shares ? ` · ${stock.shortfall_shares} missing` : ''}</span><span>Read from this account’s current holdings; the holding itself is unchanged.</span></div></td>
            </tr>}
            {trade.legs.map(leg => (
              <tr key={leg.id}>
                <td><strong>{leg.position_side} {leg.option_type}</strong></td>
                <td>{shortDate(leg.expiration)}</td>
                <td>{Number(leg.strike).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                <td>{leg.contracts}</td>
                <td>{leg.open_contracts}</td>
                <td className={leg.net_cash_flow >= 0 ? 'ot-positive' : 'ot-negative'}>{money(leg.net_cash_flow)}</td>
                <td><div className="ot-executions">{leg.executions.map(execution => <span key={execution.id}><b>{execution.action}</b> {execution.contracts} @ {money(execution.price)} · {shortDate(execution.executed_at)} · cash {money(execution.cash_effect)}</span>)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function OptionTrades() {
  const navigate = useNavigate()
  const pf = useProfileFetch()
  const { currentProfileName, isAggregate } = useProfile()
  const [data, setData] = useState({ trades: [], metrics: {} })
  const [income, setIncome] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('ALL')
  const [purpose, setPurpose] = useState('ALL')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState(new Set())
  const [closingId, setClosingId] = useState(null)
  const [classifyingId, setClassifyingId] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [expireConfirmId, setExpireConfirmId] = useState(null)
  const [includeOptionsIncome, setIncludeOptionsIncome] = useState(() => localStorage.getItem('option_income_combined') === 'true')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const query = new URLSearchParams({ status, purpose })
    if (search.trim()) query.set('underlying', search.trim())
    try {
      const [tradeData, incomeData] = await Promise.all([
        pf(`/api/option-trades?${query}`).then(jsonOrError),
        pf(`/api/income-summary?include_options=${includeOptionsIncome}`).then(jsonOrError).catch(() => null),
      ])
      setData(tradeData)
      setIncome(incomeData)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [pf, status, purpose, search, includeOptionsIncome])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => { localStorage.setItem('option_income_combined', String(includeOptionsIncome)) }, [includeOptionsIncome])

  const metrics = data.metrics || {}
  const filteredTrades = data.trades || []
  const incomeTotal = includeOptionsIncome ? income?.combined_ytd_income : income?.fund_ytd_income
  const toggleExpanded = id => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const deleteTrade = async (tradeId) => {
    if (deleteConfirmId !== tradeId) {
      setDeleteConfirmId(tradeId)
      return
    }
    try {
      await jsonOrError(await pf(`/api/option-trades/${tradeId}`, { method: 'DELETE' }))
      setDeleteConfirmId(null)
      await load()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const openRiskGraph = trade => {
    if (!stageTrackedTrade(trade, '/option-trades')) {
      setError('Could not prepare this trade for the risk graph.')
      return
    }
    navigate('/options')
  }

  const expireTrade = async trade => {
    if (expireConfirmId !== trade.id) {
      setExpireConfirmId(trade.id)
      return
    }
    const expiredOpenLegs = trade.legs.filter(
      leg => Number(leg.open_contracts) > 0 && String(leg.expiration).slice(0, 10) <= todayIso(),
    )
    if (!expiredOpenLegs.length) {
      setError('This trade has no expired open legs.')
      return
    }
    try {
      await jsonOrError(await pf(`/api/option-trades/${trade.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closed_at: todayIso(),
          executions: expiredOpenLegs.map(leg => ({
            leg_id: leg.id, action: 'EXPIRE', contracts: leg.open_contracts, price: 0, fees: 0,
          })),
        }),
      }))
      setExpireConfirmId(null)
      await load()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return (
    <main className="ot-page">
      <header className="ot-hero">
        <div>
          <span className="ot-eyebrow">Options · {currentProfileName}</span>
          <h1>Option Trades</h1>
          <p>Track actual multi-leg positions, broker executions, realized results, and income classification without changing portfolio holdings.</p>
        </div>
        <div className="ot-hero-actions">
          <NavLink className="btn btn-secondary" to="/option-trades/import">Import option transactions</NavLink>
          <button className="btn btn-primary" disabled={isAggregate} onClick={() => setShowAdd(true)}>+ Add trade</button>
        </div>
      </header>

      {isAggregate && <div className="ot-alert">Aggregate view is read-only. Select an individual portfolio to add, close, import, or delete option trades.</div>}
      {error && <div className="ot-alert ot-alert-error">{error}</div>}

      <section className="ot-metrics" aria-label="Option trade summary">
        <MetricCard label="Open trades" value={metrics.open_trades ?? 0} detail={`${metrics.open_risk_coverage ?? 0} with known risk`} />
        <MetricCard label="Known open risk" value={money(metrics.known_open_risk, '$0.00')} detail="Entered or derived defined risk" />
        <MetricCard label="Realized MTD" value={money(metrics.realized_mtd, '$0.00')} tone={Number(metrics.realized_mtd) >= 0 ? 'positive' : 'negative'} />
        <MetricCard label="Realized YTD" value={money(metrics.realized_ytd, '$0.00')} tone={Number(metrics.realized_ytd) >= 0 ? 'positive' : 'negative'} />
        <MetricCard label="Win rate" value={percent(metrics.win_rate_pct)} detail={`${metrics.closed_trades ?? 0} closed trades`} />
        <MetricCard label="Profit factor" value={metrics.profit_factor == null ? '—' : Number(metrics.profit_factor).toFixed(2)} detail="Gross wins ÷ gross losses" />
      </section>

      <section className="ot-income card">
        <div>
          <span className="ot-eyebrow">Income view</span>
          <h2>{includeOptionsIncome ? 'Fund income + realized income option P/L' : 'Fund income only'}</h2>
          <p>Only net realized P/L from trades classified as <strong>Income</strong> is combined. Opening premium and unrealized P/L are excluded.</p>
        </div>
        <label className="ot-toggle">
          <input type="checkbox" checked={includeOptionsIncome} onChange={event => setIncludeOptionsIncome(event.target.checked)} />
          <span>Include realized options</span>
        </label>
        <div className="ot-income-values">
          <span><small>Fund YTD</small><strong>{money(income?.fund_ytd_income, '$0.00')}</strong></span>
          <span><small>Income options YTD</small><strong className={Number(income?.realized_option_pnl_ytd) >= 0 ? 'ot-positive' : 'ot-negative'}>{money(income?.realized_option_pnl_ytd, '$0.00')}</strong></span>
          <span><small>Selected YTD total</small><strong>{money(incomeTotal, '$0.00')}</strong></span>
        </div>
      </section>

      {showAdd && <AddTradeForm onCancel={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}

      <section className="card ot-ledger">
        <div className="ot-section-heading ot-ledger-heading">
          <div><span className="ot-eyebrow">Execution ledger</span><h2>Trades</h2><p>Expand a row to audit every contract and fill.</p></div>
          <div className="ot-filters">
            <input aria-label="Filter by underlying" value={search} onChange={event => setSearch(event.target.value.toUpperCase())} placeholder="Ticker" />
            <select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select>
            <select aria-label="Filter by purpose" value={purpose} onChange={event => setPurpose(event.target.value)}><option value="ALL">All purposes</option>{PURPOSES.map(item => <option key={item}>{item}</option>)}</select>
          </div>
        </div>

        {loading ? <div className="ot-empty"><span className="spinner" /> Loading option trades…</div> : filteredTrades.length === 0 ? (
          <div className="ot-empty"><strong>No option trades match this view.</strong><span>Add a trade manually or import broker option transactions to begin.</span></div>
        ) : (
          <div className="table-scroll">
            <table className="ot-trade-table">
              <thead><tr><th /><th>Underlying</th><th>Strategy / purpose</th><th>Opened</th><th>Expiration / DTE</th><th>Entry</th><th>Max risk</th><th>Realized P/L</th><th>Return on risk</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{filteredTrades.map(trade => {
                const openExpirations = trade.legs.filter(leg => leg.open_contracts > 0).map(leg => leg.expiration).sort()
                const expiration = openExpirations[0] || trade.legs.map(leg => leg.expiration).sort().at(-1)
                const expiredOpenLegCount = trade.status === 'OPEN' ? openExpirations.filter(value => String(value).slice(0, 10) <= todayIso()).length : 0
                const needsClassification = !trade.strategy_type || trade.strategy_type === 'Custom' || trade.purpose === 'Other'
                const displayedLegs = trade.legs.length + (trade.stock_position?.shares > 0 ? 1 : 0)
                return [
                  <tr key={`trade-${trade.id}`} className="ot-trade-row">
                    <td><button className="ot-expand" aria-label={`${expanded.has(trade.id) ? 'Collapse' : 'Expand'} ${trade.underlying} trade`} onClick={() => toggleExpanded(trade.id)}>{expanded.has(trade.id) ? '−' : '+'}</button></td>
                    <td><strong className="ot-symbol">{trade.underlying}</strong><small>{displayedLegs} leg{displayedLegs === 1 ? '' : 's'}{trade.stock_position ? ' incl. stock' : ''}</small></td>
                    <td><strong>{trade.strategy_type}</strong><span className={`ot-purpose ot-purpose-${trade.purpose.toLowerCase()}`}>{trade.purpose}</span>{needsClassification && <span className="ot-needs-classification">Needs classification</span>}</td>
                    <td>{shortDate(trade.opened_at)}</td>
                    <td>{shortDate(expiration)}<small>{trade.status === 'OPEN' && trade.dte != null ? `${trade.dte} DTE` : trade.closed_at ? `Closed ${shortDate(trade.closed_at)}` : ''}</small></td>
                    <td><span className={trade.entry_type === 'CREDIT' ? 'ot-positive' : 'ot-negative'}>{trade.entry_type} {money(Math.abs(trade.entry_net_amount))}</span></td>
                    <td>{money(trade.max_risk)}<small>{trade.max_risk_source || ''}</small></td>
                    <td className={trade.realized_pnl >= 0 ? 'ot-positive' : 'ot-negative'}>{trade.status === 'CLOSED' || trade.realized_pnl ? money(trade.realized_pnl) : '—'}{trade.outcome && <small>{trade.outcome}</small>}</td>
                    <td>{percent(trade.return_on_risk_pct)}</td>
                    <td><span className={`ot-status ot-status-${trade.status.toLowerCase()}`}>{trade.status}</span></td>
                    <td><div className="ot-row-actions"><button className="btn btn-secondary" onClick={() => openRiskGraph(trade)}>Risk graph</button>{!isAggregate && <button className={needsClassification ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setClassifyingId(classifyingId === trade.id ? null : trade.id)}>{needsClassification ? 'Classify' : 'Edit class'}</button>}{expiredOpenLegCount > 0 && !isAggregate && <button className={`btn ${expireConfirmId === trade.id ? 'btn-danger' : 'btn-secondary'}`} onClick={() => expireTrade(trade)} onBlur={() => setExpireConfirmId(null)}>{expireConfirmId === trade.id ? 'Confirm expire' : expiredOpenLegCount === 1 ? 'Mark expired' : `Expire ${expiredOpenLegCount} legs`}</button>}{trade.status === 'OPEN' && !isAggregate && <button className="btn btn-secondary" onClick={() => setClosingId(closingId === trade.id ? null : trade.id)}>Close</button>} {!isAggregate && <button className={`btn ${deleteConfirmId === trade.id ? 'btn-danger' : 'btn-secondary'}`} onClick={() => deleteTrade(trade.id)} onBlur={() => setDeleteConfirmId(null)}>{deleteConfirmId === trade.id ? 'Confirm delete' : 'Delete'}</button>}</div></td>
                  </tr>,
                  classifyingId === trade.id ? <tr key={`classify-${trade.id}`}><td colSpan="11"><ClassificationForm trade={trade} onCancel={() => setClassifyingId(null)} onSaved={() => { setClassifyingId(null); load() }} /></td></tr> : null,
                  closingId === trade.id ? <tr key={`close-${trade.id}`}><td colSpan="11"><CloseTradeForm trade={trade} onCancel={() => setClosingId(null)} onSaved={() => { setClosingId(null); load() }} /></td></tr> : null,
                  expanded.has(trade.id) ? <tr key={`detail-${trade.id}`}><td colSpan="11"><TradeDetails trade={trade} /></td></tr> : null,
                ]
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
