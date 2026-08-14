import { useEffect, useMemo, useState } from 'react'
import RiskGraphButton from './RiskGraphButton'
import { normalCdf } from '../utils/optionProbability'
import { buildScannerTrade } from '../utils/optionTradeHandoff'

const money = value => value != null && value !== '' && Number.isFinite(Number(value))
  ? Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '—'

const number = (value, digits = 1) => value != null && value !== '' && Number.isFinite(Number(value))
  ? Number(value).toFixed(digits)
  : '—'
const percent = value => value != null && value !== '' && Number.isFinite(Number(value)) ? `${number(value, 1)}%` : '—'
const riskMoney = (value, unbounded) => unbounded ? 'Unlimited' : money(value)
const priceMoney = value => value != null && Number.isFinite(Number(value))
  ? Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '—'
const plMoney = value => value != null && Number.isFinite(Number(value))
  ? `${Number(value) > 0 ? '+' : ''}${Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
  : '—'
const MONTH_LABELS = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const ordinal = value => {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  return `${value}${value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'}`
}

function nearestZeroCrossing(values, prices, referencePrice) {
  const crossings = []
  for (let index = 1; index < values.length; index += 1) {
    const previous = Number(values[index - 1])
    const current = Number(values[index])
    const previousPrice = Number(prices[index - 1])
    const currentPrice = Number(prices[index])
    if (![previous, current, previousPrice, currentPrice].every(Number.isFinite)) continue
    if (previous === 0) crossings.push(previousPrice)
    else if (previous * current < 0) {
      const fraction = previous / (previous - current)
      crossings.push(previousPrice + (currentPrice - previousPrice) * fraction)
    }
  }
  if (values.length && Number(values[values.length - 1]) === 0) crossings.push(Number(prices[prices.length - 1]))
  return crossings.length
    ? crossings.sort((a, b) => Math.abs(a - referencePrice) - Math.abs(b - referencePrice))[0]
    : null
}

function daysTo(expiration) {
  const target = new Date(`${expiration}T12:00:00`)
  if (Number.isNaN(target.getTime())) return 0
  return Math.max(0, Math.round((target - new Date()) / 86400000))
}

function optionValue(type, spot, strike, years, iv, rate = 0.04) {
  if (years <= 0 || iv <= 0 || spot <= 0 || strike <= 0) {
    return type === 'PUT' ? Math.max(strike - spot, 0) : Math.max(spot - strike, 0)
  }
  const root = Math.sqrt(years)
  const d1 = (Math.log(spot / strike) + (rate + iv * iv / 2) * years) / (iv * root)
  const d2 = d1 - iv * root
  if (type === 'PUT') {
    return strike * Math.exp(-rate * years) * normalCdf(-d2) - spot * normalCdf(-d1)
  }
  return spot * normalCdf(d1) - strike * Math.exp(-rate * years) * normalCdf(d2)
}

function payoff(trade, scenarioSpot, dte, ivPct) {
  return trade.legs.reduce((total, leg) => {
    const sign = String(leg.side).toUpperCase() === 'SELL' ? -1 : 1
    const qty = Math.max(1, Number(leg.qty) || 1)
    const type = String(leg.opt_type).toUpperCase()
    if (type === 'STOCK') return total + sign * qty * (scenarioSpot - Number(leg.entry_price || 0))
    const multiplier = 100
    const current = dte <= 0
      ? (type === 'PUT' ? Math.max(Number(leg.strike) - scenarioSpot, 0) : Math.max(scenarioSpot - Number(leg.strike), 0))
      : optionValue(type, scenarioSpot, Number(leg.strike), dte / 365, ivPct / 100)
    return total + sign * qty * multiplier * (current - Number(leg.entry_price || 0))
  }, 0)
}

function interpolate(values, prices, price) {
  if (!values.length || !prices.length) return null
  if (price <= prices[0]) return values[0]
  const last = prices.length - 1
  if (price >= prices[last]) return values[last]
  const position = (price - prices[0]) / (prices[last] - prices[0]) * last
  const low = Math.floor(position)
  const fraction = position - low
  return values[low] + (values[low + 1] - values[low]) * fraction
}

function formatExpiration(expiration) {
  if (!expiration) return '—'
  const parsed = new Date(`${expiration}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return expiration
  return `${MONTH_LABELS[parsed.getMonth()]} ${ordinal(parsed.getDate())} ${parsed.getFullYear()} · ${daysTo(expiration)} DTE`
}

function PayoffChart({ trade, spot, dte, rangePct, markerPct, ivPct }) {
  const [hover, setHover] = useState(null)
  const model = useMemo(() => {
    if (!trade || !spot) return null
    const low = Math.max(0.01, spot * (1 - rangePct / 100))
    const high = spot * (1 + rangePct / 100)
    const prices = Array.from({ length: 121 }, (_, index) => low + (high - low) * index / 120)
    const expiration = prices.map(price => payoff(trade, price, 0, ivPct))
    const current = prices.map(price => payoff(trade, price, dte, ivPct))
    const values = [...expiration, ...current, 0]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max(10, (max - min) * 0.12)
    return { prices, expiration, current, low, high, min: min - pad, max: max + pad }
  }, [trade, spot, dte, rangePct, ivPct])
  if (!model) return <div className="gsa-empty">{!trade ? 'The selected row does not contain a complete option structure.' : 'This trade is missing an underlying price, so the P/L graph cannot be drawn.'}</div>

  const width = 760, height = 280, left = 56, right = 14, top = 24, bottom = 48
  const x = value => left + (value - model.low) / (model.high - model.low) * (width - left - right)
  const y = value => top + (model.max - value) / (model.max - model.min) * (height - top - bottom)
  const path = values => values.map((value, index) => `${index ? 'L' : 'M'}${x(model.prices[index]).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const handleMouseMove = event => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width) return
    const svgX = Math.max(left, Math.min(width - right, (event.clientX - bounds.left) / bounds.width * width))
    const price = model.low + (svgX - left) / (width - left - right) * (model.high - model.low)
    const tagWidth = 82
    setHover({
      x: svgX,
      tagX: Math.max(left + tagWidth / 2, Math.min(width - right - tagWidth / 2, svgX)),
      price,
      current: interpolate(model.current, model.prices, price),
      expiration: interpolate(model.expiration, model.prices, price),
    })
  }
  const currentBreakeven = nearestZeroCrossing(model.current, model.prices, spot)
  const expirationBreakeven = nearestZeroCrossing(model.expiration, model.prices, spot)
  const breakevenLabels = [
    { label: 'Day step', price: currentBreakeven, color: '#f4a11a' },
    { label: 'Expiration', price: expirationBreakeven, color: '#54c8c3' },
  ].filter(item => item.price != null)
  const percentageTicks = []
  for (let value = Math.ceil(-rangePct / markerPct) * markerPct; value <= Math.floor(rangePct / markerPct) * markerPct; value += markerPct) percentageTicks.push(value)
  if (!percentageTicks.includes(0)) percentageTicks.push(0)
  percentageTicks.sort((a, b) => a - b)
  const yTicks = Array.from({ length: 5 }, (_, index) => model.min + (model.max - model.min) * index / 4)
  const hoverPanelWidth = 152
  const hoverPanelHeight = 52
  const hoverPanel = hover ? {
    x: hover.x > width / 2 ? hover.x - hoverPanelWidth - 8 : hover.x + 8,
    y: Math.max(
      top + 2,
      Math.min(
        height - bottom - hoverPanelHeight - 2,
        Math.min(y(hover.current), y(hover.expiration)) - hoverPanelHeight / 2,
      ),
    ),
  } : null
  return <div className="gsa-chart-wrap">
    <div className="gsa-chart-title"><strong>P/L Profile · range ±{rangePct}% · markers {markerPct}%</strong><span><i className="gsa-line current" /> Modeled at {dte} DTE <i className="gsa-line expiry" /> Expiration</span></div>
    <svg className="gsa-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Profit and loss profile. Move across the graph to read the underlying price and modeled P/L." onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
      {yTicks.map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="gsa-grid" /><text x={left - 8} y={y(value) + 4} textAnchor="end">{Math.round(value)}</text></g>)}
      {percentageTicks.map(changePct => {
        const price = spot * (1 + changePct / 100)
        return <g key={changePct}>
          <line x1={x(price)} x2={x(price)} y1={top} y2={height - bottom} className={changePct === 0 ? 'gsa-spot' : 'gsa-grid'} />
          <text x={x(price)} y={height - 23} textAnchor="middle" className={changePct === 0 ? 'gsa-current-tick' : ''}>
            <tspan>{changePct > 0 ? '+' : ''}{changePct}%</tspan>
            <tspan x={x(price)} dy="12">{number(price, 0)}</tspan>
          </text>
        </g>
      })}
      <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="gsa-zero" />
      <path d={path(model.current)} className="gsa-profile-current" />
      <path d={path(model.expiration)} className="gsa-profile-expiry" />
      <text x={Math.min(width - 96, x(spot) + 5)} y={top - 7} className="gsa-spot-label">Current {number(spot, 2)}</text>
      {breakevenLabels.map((item, index) => {
        const labelX = Math.max(left + 45, Math.min(width - right - 45, x(item.price)))
        const labelY = top + 5 + index * 24
        return <g key={item.label} className="gsa-breakeven-label" pointerEvents="none">
          <line x1={x(item.price)} x2={x(item.price)} y1={y(0)} y2={labelY + 17} style={{ stroke: item.color }} />
          <rect x={labelX - 45} y={labelY} width="90" height="18" rx="3" style={{ fill: item.color }} />
          <text x={labelX} y={labelY + 12} textAnchor="middle">{item.label} {priceMoney(item.price)}</text>
        </g>
      })}
      {hover && <g className="gsa-hover-readout" pointerEvents="none">
        <line x1={hover.x} x2={hover.x} y1={top} y2={height - bottom} className="gsa-hover-line" />
        <circle cx={hover.x} cy={y(hover.current)} r="4" className="gsa-hover-dot-current" />
        <circle cx={hover.x} cy={y(hover.expiration)} r="4" className="gsa-hover-dot-expiry" />
        <rect x={hoverPanel.x} y={hoverPanel.y} width={hoverPanelWidth} height={hoverPanelHeight} rx="4" className="gsa-hover-panel" />
        <rect x={hoverPanel.x + 4} y={hoverPanel.y + 4} width={hoverPanelWidth - 8} height="20" rx="2" className="gsa-hover-value-band gsa-hover-value-band-current" />
        <rect x={hoverPanel.x + 4} y={hoverPanel.y + 28} width={hoverPanelWidth - 8} height="20" rx="2" className="gsa-hover-value-band gsa-hover-value-band-expiry" />
        <text x={hoverPanel.x + 10} y={hoverPanel.y + 18} className="gsa-hover-value">Day step {plMoney(hover.current)}</text>
        <text x={hoverPanel.x + 10} y={hoverPanel.y + 42} className="gsa-hover-value">Expiration {plMoney(hover.expiration)}</text>
        <rect x={hover.tagX - 41} y={height - bottom + 3} width="82" height="18" rx="3" className="gsa-hover-tag" />
        <text x={hover.tagX} y={height - bottom + 16} textAnchor="middle" className="gsa-hover-price">{priceMoney(hover.price)}</text>
      </g>}
    </svg>
  </div>
}

function LegTable({ trade }) {
  return <div className="gsa-leg-table-wrap"><table className="gsa-leg-table">
    <thead><tr><th>Type</th><th>Side</th><th>Quantity</th><th>Expiration</th><th>Strike</th><th>Entry</th><th>Delta</th><th>IV</th></tr></thead>
    <tbody>{trade?.legs.map((leg, index) => <tr key={`${leg.opt_type}-${leg.strike}-${index}`}>
      <td>{leg.opt_type}</td><td><b className={leg.side === 'BUY' ? 'buy' : 'sell'}>{leg.side}</b></td><td>{leg.qty}</td>
      <td>{formatExpiration(leg.expiration)}</td><td>{leg.opt_type === 'STOCK' ? '—' : number(leg.strike, 2)}</td>
      <td>{number(leg.entry_price, 2)}</td><td>{number(leg.delta, 2)}</td><td>{leg.iv ? `${number(Number(leg.iv) * 100, 1)}%` : '—'}</td>
    </tr>)}</tbody>
  </table></div>
}

export default function GeneralScannerAnalysis({ row, strategyLabel }) {
  const meta = row?._general || {}
  const trade = useMemo(() => row ? buildScannerTrade(meta.trade_kind, row) : null, [row, meta.trade_kind])
  const originalDte = useMemo(() => {
    const expirations = trade?.legs.map(leg => daysTo(leg.expiration)).filter(value => value > 0) || []
    return Math.max(1, ...expirations, Number(meta.dte) || 1)
  }, [trade, meta.dte])
  const baseIv = useMemo(() => {
    const values = trade?.legs.map(leg => Number(leg.iv) * 100).filter(value => value > 0) || []
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number(meta.atm_iv || 0.3) * 100
  }, [trade, meta.atm_iv])
  const structureKey = `${meta.trade_kind}:${meta.ticker}:${meta.expiration}:${meta.strikes}`
  const [tab, setTab] = useState('strategy')
  const [view, setView] = useState('controls')
  const [analysisDte, setAnalysisDte] = useState(originalDte)
  const [rangePct, setRangePct] = useState(33)
  const [markerPct, setMarkerPct] = useState(10)
  const [ivPct, setIvPct] = useState(baseIv)

  useEffect(() => {
    setTab('strategy'); setView('controls'); setAnalysisDte(originalDte); setRangePct(33); setMarkerPct(10); setIvPct(baseIv)
  }, [structureKey, originalDte, baseIv])

  if (!row) return null
  const reset = () => { setAnalysisDte(originalDte); setRangePct(33); setMarkerPct(10); setIvPct(baseIv) }
  const scores = meta.stock_scores || {}
  return <section className="gsa-card">
    <header className="gsa-header">
      <strong>Analyze — {meta.ticker}</strong>
      <nav>{['strategy', 'stock', 'options'].map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value}</button>)}</nav>
      <RiskGraphButton kind={meta.trade_kind} row={row} source="General Option Scanner" label="Detailed Risk Graph" className="btn btn-xs btn-outline" />
    </header>

    {meta.match_status === 'near_match' && <div className="gsa-near-match-explanation" role="note">
      <strong>Near match — this trade did not pass every active filter.</strong>
      <span>Rules missed:</span>
      <div>{(meta.filter_reasons || []).map(reason => <b key={reason}>{reason}</b>)}</div>
    </div>}

    <div className="gsa-probability-strip" aria-label="Probability and risk analysis">
      <article><span>Probability of success</span><strong>{percent(meta.prob_success)}</strong></article>
      <article><span>Probability of failure</span><strong>{percent(meta.prob_failure)}</strong></article>
      <article><span>Expected value</span><strong>{money(meta.expected_value)}</strong></article>
      <article><span>Max profit</span><strong>{riskMoney(meta.max_profit, meta.max_profit_unbounded)}</strong></article>
      <article><span>Max loss</span><strong>{riskMoney(meta.max_loss, meta.max_loss_unbounded)}</strong></article>
      <article><span>Profit ratio</span><strong>{percent(meta.profit_ratio)}</strong></article>
      <small>Modeled estimates based on the selected chain, entry-price assumption, implied volatility, and expiration payoff—not guarantees.</small>
    </div>

    {tab === 'strategy' && <>
      {view === 'controls' ? <div className="gsa-controls-layout">
        <div className="gsa-controls">
          <div className="gsa-controls-heading"><strong>Controls</strong><button className="btn btn-xs btn-outline" onClick={reset}>↻ Reset</button></div>
          <label><span>Analysis Date</span><input type="range" min="0" max={originalDte} value={originalDte - analysisDte} onChange={event => setAnalysisDte(originalDte - Number(event.target.value))} aria-label="Analysis Date" /><output>{analysisDte} <b>DTE</b></output></label>
          <label><span>Range</span><input type="range" min="10" max="100" value={rangePct} onChange={event => setRangePct(Number(event.target.value))} /><output>{rangePct} <b>%</b></output></label>
          <label><span>Price Markers</span><input type="range" min="1" max="25" step="1" value={markerPct} onChange={event => setMarkerPct(Number(event.target.value))} /><output>{markerPct} <b>%</b></output></label>
          <label><span>Implied Volatility</span><input type="range" min="5" max="200" step="0.1" value={ivPct} onChange={event => setIvPct(Number(event.target.value))} /><output>{number(ivPct, 1)} <b>%</b></output></label>
        </div>
        <PayoffChart trade={trade} spot={Number(meta.price) || Number(row.price)} dte={analysisDte} rangePct={rangePct} markerPct={markerPct} ivPct={ivPct} />
      </div> : <LegTable trade={trade} />}
      <div className="gsa-view-toggle"><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button><button className={view === 'controls' ? 'active' : ''} onClick={() => setView('controls')}>Controls</button></div>
    </>}

    {tab === 'stock' && <div className="gsa-detail-grid">
      <article><span>Fundamental score</span><strong>{number(scores.fundamental, 1)}</strong></article>
      <article><span>Growth score</span><strong>{number(scores.growth, 1)}</strong></article>
      <article><span>Technical score</span><strong>{number(scores.technical, 1)}</strong></article>
      <article><span>Last price</span><strong>{money(meta.price)}</strong></article>
      <p>These are transparent app scores, not Option Samurai’s proprietary grades. ETFs show no company score.</p>
    </div>}

    {tab === 'options' && <div className="gsa-options-tab"><div className="gsa-detail-grid">
      <article><span>Strategy</span><strong>{strategyLabel}</strong></article><article><span>Expiration</span><strong>{formatExpiration(meta.expiration)}</strong></article>
      <article><span>IV Rank</span><strong>{meta.iv_rank == null ? 'Warming up' : `${number(meta.iv_rank, 1)}%`}</strong></article>
      <article><span>RV (1m)</span><strong>{meta.rv == null ? '—' : `${number(meta.rv, 1)}%`}</strong></article>
      <article><span>IV − RV</span><strong>{meta.iv_rv == null ? '—' : `${Number(meta.iv_rv) > 0 ? '+' : ''}${number(meta.iv_rv, 1)}`}</strong></article>
      <article><span>IV − RV Rank</span><strong>{meta.iv_rv_rank == null ? 'Warming up' : `${number(meta.iv_rv_rank, 1)}%`}</strong></article>
      <article><span>RV Rank</span><strong>{meta.rv_rank == null ? '—' : `${number(meta.rv_rank, 1)}%`}</strong></article>
      <article><span>Volatility score</span><strong>{meta.volatility_score == null ? '—' : number(meta.volatility_score, 1)}</strong></article>
      <article><span>Max loss</span><strong>{riskMoney(meta.max_loss, meta.max_loss_unbounded)}</strong></article>
    </div><LegTable trade={trade} /></div>}
  </section>
}
