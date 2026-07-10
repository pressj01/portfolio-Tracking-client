import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../config'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { resizeOptionStructure } from '../utils/optionsStrategy'

const TODAY = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

const fmt = (value, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const money = (value, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
const signedMoney = value => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${Number(value) > 0 ? '+' : ''}${money(value)}`
const percent = (value, digits = 1) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${(Number(value) * 100).toFixed(digits)}%`
const formatExpiration = expiration => {
  if (!expiration) return '—'
  const value = new Date(`${expiration}T00:00:00`)
  return Number.isNaN(value.getTime())
    ? expiration
    : value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}
const daysBetween = (start, end) => {
  const a = new Date(`${start}T00:00:00`)
  const b = new Date(`${end}T00:00:00`)
  return Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) ? 0 : Math.max(0, Math.round((b - a) / 86400000))
}
const addDays = (dateString, days) => {
  const value = new Date(`${dateString}T00:00:00`)
  value.setDate(value.getDate() + Number(days || 0))
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
  return value.toISOString().slice(0, 10)
}
const uniqueId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const OPTION_CHAIN_COLUMN_PREF_KEY = 'options_chain_visible_columns_v1'
const CHAIN_COLUMNS = [
  { id: 'last', label: 'Last', name: 'Last price', tip: 'Most recent traded option price' },
  { id: 'mid', label: 'Mark', name: 'Mark / midpoint', tip: 'Midpoint of the bid and ask' },
  { id: 'delta', label: 'Delta', name: 'Delta', tip: 'Approximate option-price change for a $1 underlying move' },
  { id: 'gamma', label: 'Gamma', name: 'Gamma', tip: 'Approximate change in delta for a $1 underlying move' },
  { id: 'theta', label: 'Theta', name: 'Theta per day', tip: 'Estimated one-day time decay per share' },
  { id: 'vega', label: 'Vega', name: 'Vega per volatility point', tip: 'Approximate price change for a one-point IV move' },
  { id: 'rho', label: 'Rho', name: 'Rho per rate point', tip: 'Approximate price change for a one-point interest-rate move' },
  { id: 'prob_otm', label: 'Prob OTM', name: 'Probability OTM', tip: 'Delta-based first-order probability of expiring out of the money' },
  { id: 'iv', label: 'IV', name: 'Implied volatility', tip: 'Market-implied annualized volatility' },
  { id: 'volume', label: 'Volume', name: 'Volume', tip: 'Contracts traded today' },
  { id: 'open_interest', label: 'Open Int', name: 'Open interest', tip: 'Open contracts reported by the market' },
  { id: 'bid', label: 'Bid', name: 'Bid', tip: 'Highest displayed buyer; click to add a simulated sell' },
  { id: 'ask', label: 'Ask', name: 'Ask', tip: 'Lowest displayed seller; click to add a simulated buy' },
]
const DEFAULT_CHAIN_COLUMNS = ['last', 'delta', 'prob_otm', 'iv', 'bid', 'ask']
const CHAIN_COLUMN_PRESETS = {
  Basic: DEFAULT_CHAIN_COLUMNS,
  Greeks: ['bid', 'ask', 'iv', 'delta', 'gamma', 'theta', 'vega', 'rho'],
  Liquidity: ['bid', 'ask', 'mid', 'last', 'volume', 'open_interest', 'iv'],
  All: CHAIN_COLUMNS.map(column => column.id),
}
const modeledLegIv = (leg, globalAdjustment = 0) => Math.max(
  0.0001,
  (Number(leg.iv) || 0.2)
    + (Number(leg.iv_adjustment) || 0) / 100
    + (Number(globalAdjustment) || 0) / 100,
)

async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error(`Request failed (${response.status})`)
  }
  if (!response.ok || data?.error) throw new Error(data?.error || `Request failed (${response.status})`)
  return data
}

function RiskChart({ result, evaluationDate, strikeStructure, onResizeStructure }) {
  const ref = useRef(null)
  const { isDark } = useTheme()

  useEffect(() => {
    if (!ref.current || !window.Plotly || !result?.curves?.today?.length) return undefined
    const ct = chartTheme(isDark)
    const evaluation = result.curves.today
    const expiration = result.curves.expiration || []
    const daySteps = result.curves.day_steps || []
    const horizonDate = result.curves.expiration_date || result.analysis_horizon
    const horizonName = result.mixed_expirations && horizonDate
      ? `First expiration · ${formatExpiration(horizonDate)}`
      : 'At expiration'
    const displayEvaluationDate = result.eval_date || evaluationDate
    const dayStepTraces = daySteps.map((step, index) => ({
      x: step.curve.map(point => point.s),
      y: step.curve.map(point => point.pnl),
      type: 'scatter',
      mode: 'lines',
      name: index === 0 ? `${result.day_step}-day steps` : step.date,
      legendgroup: 'day-steps',
      showlegend: index === 0,
      line: { color: `rgba(126, 207, 255, ${Math.min(0.72, 0.28 + index * 0.07)})`, width: 1.4 },
      hovertemplate: `${step.date}<br>Underlying %{x:$,.2f}<br>Modeled P/L %{y:$,.2f}<extra></extra>`,
    }))
    const traces = [
      {
        x: expiration.map(point => point.s),
        y: expiration.map(point => point.pnl),
        type: 'scatter',
        mode: 'lines',
        name: horizonName,
        line: { color: '#20c7c7', width: 3 },
        hovertemplate: `${horizonName}<br>Underlying %{x:$,.2f}<br>Modeled P/L %{y:$,.2f}<extra></extra>`,
      },
      ...dayStepTraces,
      {
        x: evaluation.map(point => point.s),
        y: evaluation.map(point => point.pnl),
        type: 'scatter',
        mode: 'lines',
        name: displayEvaluationDate,
        line: { color: '#d46adf', width: 3 },
        hovertemplate: 'Underlying %{x:$,.2f}<br>Modeled P/L %{y:$,.2f}<extra></extra>',
      },
    ]
    const fixedShapes = [
      { type: 'line', x0: evaluation[0].s, x1: evaluation[evaluation.length - 1].s, y0: 0, y1: 0, line: { color: ct.zeroline, width: 1 } },
      { type: 'line', x0: result.spot, x1: result.spot, y0: 0, y1: 1, yref: 'paper', line: { color: '#f0b429', width: 1.5, dash: 'dot' } },
      ...(result.breakevens || []).map(value => ({
        type: 'line', x0: value, x1: value, y0: 0, y1: 1, yref: 'paper',
        line: { color: '#ff6b6b', width: 1, dash: 'dash' },
      })),
    ]
    const resizeHandles = strikeStructure ? [
      { edge: 'low', value: strikeStructure.low },
      { edge: 'high', value: strikeStructure.high },
    ] : []
    const handleShapeStart = fixedShapes.length
    const shapes = [
      ...fixedShapes,
      ...resizeHandles.map(handle => ({
        type: 'line', x0: handle.value, x1: handle.value, y0: 0, y1: 1, yref: 'paper',
        editable: true,
        line: { color: '#7ecfff', width: 4, dash: 'dot' },
        label: { text: `Drag ${fmt(handle.value)}`, textposition: 'top center', font: { color: '#7ecfff', size: 10 } },
      })),
    ]
    const annotations = [
      { x: result.spot, y: 1, yref: 'paper', text: `Spot ${fmt(result.spot)}`, showarrow: false, yanchor: 'bottom', font: { color: '#f0b429', size: 11 } },
      ...(result.breakevens || []).map(value => ({ x: value, y: 0, text: `B/E ${fmt(value)}`, showarrow: false, yshift: 12, font: { color: '#ff8a8a', size: 10 } })),
    ]
    const chartElement = ref.current
    let mounted = true
    const handleRelayout = update => {
      const shapeKey = Object.keys(update || {}).find(key => /^shapes\[(\d+)\](?:\.x[01])?$/.test(key))
      if (!shapeKey) return
      const match = shapeKey.match(/^shapes\[(\d+)\]/)
      const shapeIndex = Number(match?.[1])
      const handle = resizeHandles[shapeIndex - handleShapeStart]
      if (!handle) return
      const shapeUpdate = update[`shapes[${shapeIndex}]`]
      const nextValue = Number(update[`shapes[${shapeIndex}].x0`] ?? update[`shapes[${shapeIndex}].x1`] ?? shapeUpdate?.x0 ?? shapeUpdate?.x1)
      if (Number.isFinite(nextValue)) onResizeStructure?.(handle.edge, nextValue)
    }
    const plotPromise = window.Plotly.react(chartElement, traces, {
      template: ct.template,
      paper_bgcolor: ct.surface,
      plot_bgcolor: ct.plot,
      font: { color: ct.font, family: 'Inter, system-ui, sans-serif' },
      margin: { l: 70, r: 25, t: 25, b: 55 },
      height: 470,
      hovermode: 'x unified',
      legend: { orientation: 'h', x: 0, y: 1.08 },
      xaxis: { title: 'Underlying price', gridcolor: ct.grid, tickprefix: '$', zerolinecolor: ct.zeroline },
      yaxis: { title: 'Profit / Loss', gridcolor: ct.grid, tickprefix: '$', zerolinecolor: ct.zeroline },
      shapes,
      annotations,
    }, {
      responsive: true,
      displaylogo: false,
      edits: { shapePosition: true },
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    })
    Promise.resolve(plotPromise).then(() => {
      if (mounted && chartElement?.on) chartElement.on('plotly_relayout', handleRelayout)
    })
    return () => {
      mounted = false
      if (chartElement?.removeListener) chartElement.removeListener('plotly_relayout', handleRelayout)
      if (chartElement) window.Plotly.purge(chartElement)
    }
  }, [result, evaluationDate, isDark, strikeStructure, onResizeStructure])

  return <div ref={ref} className="opt-risk-chart" role="img" aria-label="Option strategy profit and loss graph with draggable strike-width handles" />
}

function QuoteMetric({ label, value, tone }) {
  return (
    <div className="opt-quote-metric">
      <span>{label}</span>
      <strong className={tone ? `opt-${tone}` : ''}>{value}</strong>
    </div>
  )
}

function SummaryMetric({ label, value, tone, helper }) {
  return (
    <div className="opt-summary-metric">
      <span>{label}</span>
      <strong className={tone ? `opt-${tone}` : ''}>{value}</strong>
      {helper && <small>{helper}</small>}
    </div>
  )
}

function ChainButton({ value, side, onClick, title }) {
  if (value == null) return <span>—</span>
  return <button type="button" className={`opt-chain-price opt-chain-${side.toLowerCase()}`} onClick={onClick} title={title}>{fmt(value)}</button>
}

function emptyCells(count, className) {
  return Array.from({ length: count }, (_, index) => <td key={index} className={className}>—</td>)
}

function formatChainValue(contract, columnId) {
  const value = contract?.[columnId]
  if (columnId === 'iv' || columnId === 'prob_otm') return percent(value)
  if (columnId === 'volume' || columnId === 'open_interest') return fmt(value, 0)
  if (columnId === 'gamma') return fmt(value, 4)
  if (['delta', 'theta', 'vega', 'rho'].includes(columnId)) return fmt(value, 3)
  return fmt(value)
}

function ChainCells({ contract, itm, onAdd, optType, columns }) {
  const className = itm ? `opt-itm opt-itm-${optType.toLowerCase()}` : ''
  if (!contract) return <>{emptyCells(columns.length, className)}</>
  return (
    <>
      {columns.map(column => (
        <td key={column.id} className={className} title={column.tip}>
          {column.id === 'bid'
            ? <ChainButton value={contract.bid} side="SELL" onClick={() => onAdd(contract, optType, 'SELL')} title={`Sell this ${optType.toLowerCase()} at the bid`} />
            : column.id === 'ask'
              ? <ChainButton value={contract.ask} side="BUY" onClick={() => onAdd(contract, optType, 'BUY')} title={`Buy this ${optType.toLowerCase()} at the ask`} />
              : formatChainValue(contract, column.id)}
        </td>
      ))}
    </>
  )
}

export default function OptionTradingTools() {
  const [workspace, setWorkspace] = useState('chain')
  const [tickerInput, setTickerInput] = useState('SPY')
  const [ticker, setTicker] = useState('SPY')
  const [marketRefresh, setMarketRefresh] = useState(0)
  const [quote, setQuote] = useState(null)
  const [expirations, setExpirations] = useState([])
  const [selectedExpiration, setSelectedExpiration] = useState('')
  const [chain, setChain] = useState(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [chainLoading, setChainLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [strikeRange, setStrikeRange] = useState('20')
  const [chainColumnIds, setChainColumnIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPTION_CHAIN_COLUMN_PREF_KEY) || 'null')
      const validIds = new Set(CHAIN_COLUMNS.map(column => column.id))
      const selected = Array.isArray(saved) ? saved.filter(id => validIds.has(id)) : []
      return selected.length ? selected : DEFAULT_CHAIN_COLUMNS
    } catch {
      return DEFAULT_CHAIN_COLUMNS
    }
  })

  const [legs, setLegs] = useState([])
  const [strategyId, setStrategyId] = useState(null)
  const [strategyName, setStrategyName] = useState('Untitled strategy')
  const [notes, setNotes] = useState('')
  const [savedStrategies, setSavedStrategies] = useState([])
  const [saveStatus, setSaveStatus] = useState('')

  const [model, setModel] = useState('black-scholes')
  const [ratePct, setRatePct] = useState(3.75)
  const [evaluationDate, setEvaluationDate] = useState(TODAY)
  const [volatilityShift, setVolatilityShift] = useState(0)
  const [priceRangePct, setPriceRangePct] = useState(35)
  const [dayStep, setDayStep] = useState(5)
  const [sliceOffsets, setSliceOffsets] = useState([-15, 0, 15])
  const [risk, setRisk] = useState(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [riskError, setRiskError] = useState('')
  const riskRequestId = useRef(0)

  const loadSavedStrategies = useCallback(() => {
    fetchJson('/api/options/strategies')
      .then(setSavedStrategies)
      .catch(error => setSaveStatus(error.message))
  }, [])

  useEffect(() => { loadSavedStrategies() }, [loadSavedStrategies])
  useEffect(() => {
    try { localStorage.setItem(OPTION_CHAIN_COLUMN_PREF_KEY, JSON.stringify(chainColumnIds)) } catch { /* optional preference */ }
  }, [chainColumnIds])

  const visibleChainColumns = useMemo(
    () => CHAIN_COLUMNS.filter(column => chainColumnIds.includes(column.id)),
    [chainColumnIds],
  )
  const mirroredPutColumns = useMemo(() => [...visibleChainColumns].reverse(), [visibleChainColumns])
  const toggleChainColumn = id => setChainColumnIds(previous => {
    if (previous.includes(id)) {
      const next = previous.filter(value => value !== id)
      return next.length ? next : previous
    }
    return [...previous, id]
  })

  useEffect(() => {
    if (!ticker) return undefined
    let cancelled = false
    setMarketLoading(true)
    setMarketError('')
    setQuote(null)
    setExpirations([])
    setSelectedExpiration('')
    setChain(null)
    Promise.all([
      fetchJson(`/api/options/quote?ticker=${encodeURIComponent(ticker)}`),
      fetchJson(`/api/options/expirations?ticker=${encodeURIComponent(ticker)}`),
    ])
      .then(([quoteData, expirationData]) => {
        if (cancelled) return
        setQuote(quoteData)
        const values = expirationData.expirations || []
        setExpirations(values)
        const learningExpiration = values.find(expiration => daysBetween(TODAY(), expiration) >= 21)
          || values.find(expiration => expiration > TODAY())
          || values[0]
        setSelectedExpiration(learningExpiration || '')
      })
      .catch(error => { if (!cancelled) setMarketError(error.message) })
      .finally(() => { if (!cancelled) setMarketLoading(false) })
    return () => { cancelled = true }
  }, [ticker, marketRefresh])

  useEffect(() => {
    if (!ticker || !selectedExpiration) return undefined
    let cancelled = false
    setChainLoading(true)
    setMarketError('')
    fetchJson(`/api/options/chain?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(selectedExpiration)}`)
      .then(data => { if (!cancelled) setChain(data) })
      .catch(error => { if (!cancelled) setMarketError(error.message) })
      .finally(() => { if (!cancelled) setChainLoading(false) })
    return () => { cancelled = true }
  }, [ticker, selectedExpiration, marketRefresh])

  const chainRows = useMemo(() => {
    if (!chain) return []
    const byStrike = new Map()
    ;(chain.calls || []).forEach(call => byStrike.set(call.strike, { strike: call.strike, call, put: null }))
    ;(chain.puts || []).forEach(put => {
      const row = byStrike.get(put.strike) || { strike: put.strike, call: null, put: null }
      row.put = put
      byStrike.set(put.strike, row)
    })
    const rows = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike)
    if (strikeRange === 'all' || !chain.spot) return rows
    const band = Number(strikeRange) / 100
    return rows.filter(row => row.strike >= chain.spot * (1 - band) && row.strike <= chain.spot * (1 + band))
  }, [chain, strikeRange])

  const spot = Number(quote?.last || chain?.spot || 0)
  const activeLegs = useMemo(() => legs.filter(leg => leg.included && leg.expiration && Number(leg.strike) > 0), [legs])
  const strikeStructure = useMemo(() => {
    const strikes = [...new Set(activeLegs.map(leg => Number(leg.strike)).filter(Number.isFinite))].sort((a, b) => a - b)
    if (strikes.length < 2) return null
    const low = strikes[0]
    const high = strikes.at(-1)
    return { low, high, center: (low + high) / 2 }
  }, [activeLegs])
  const activeExpirations = useMemo(
    () => [...new Set(activeLegs.map(leg => leg.expiration).filter(Boolean))].sort(),
    [activeLegs],
  )
  const analysisHorizon = useMemo(() => {
    const earliest = activeExpirations[0] || selectedExpiration || TODAY()
    return earliest < TODAY() ? TODAY() : earliest
  }, [activeExpirations, selectedExpiration])
  const hasMixedExpirations = activeExpirations.length > 1
  const evolutionDays = daysBetween(TODAY(), analysisHorizon)
  const evaluationOffset = Math.min(evolutionDays, daysBetween(TODAY(), evaluationDate))

  useEffect(() => {
    if (evaluationDate > analysisHorizon) setEvaluationDate(analysisHorizon)
    else if (evaluationDate < TODAY()) setEvaluationDate(TODAY())
  }, [analysisHorizon, evaluationDate])

  const setBoundedEvaluationDate = value => {
    if (!value) return
    setEvaluationDate(value > analysisHorizon ? analysisHorizon : value < TODAY() ? TODAY() : value)
  }

  useEffect(() => {
    const requestId = ++riskRequestId.current
    if (!activeLegs.length || !spot) {
      setRisk(null)
      setRiskError('')
      setRiskLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setRisk(null)
    setRiskLoading(true)
    setRiskError('')
    const timer = setTimeout(() => {
      const range = Math.max(5, Number(priceRangePct) || 35) / 100
      fetchJson('/api/options/risk-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          underlying: ticker,
          model,
          rate: (Number(ratePct) || 0) / 100,
          div_yield: Number(quote?.div_yield || 0),
          spot_override: spot,
          eval_date: evaluationDate,
          day_step: Number(dayStep) || 0,
          price_range: { low: spot * (1 - range), high: spot * (1 + range), steps: 181 },
          price_slices: sliceOffsets.map(offset => ({ s: spot * (1 + Number(offset) / 100) })),
          legs: activeLegs.map(leg => ({
            side: leg.side,
            qty: Math.max(1, Number(leg.qty) || 1),
            opt_type: leg.opt_type,
            strike: Number(leg.strike),
            expiration: leg.expiration,
            entry_price: Number(leg.entry_price) || 0,
            iv: modeledLegIv(leg, volatilityShift),
          })),
        }),
      })
        .then(data => {
          if (requestId === riskRequestId.current) setRisk(data)
        })
        .catch(error => {
          if (error.name !== 'AbortError' && requestId === riskRequestId.current) setRiskError(error.message)
        })
        .finally(() => {
          if (requestId === riskRequestId.current) setRiskLoading(false)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [activeLegs, spot, ticker, model, ratePct, quote?.div_yield, evaluationDate, priceRangePct, dayStep, sliceOffsets, volatilityShift])

  const submitTicker = event => {
    event.preventDefault()
    const next = tickerInput.trim().toUpperCase()
    if (!next) return
    if (next === ticker) setMarketRefresh(value => value + 1)
    else setTicker(next)
  }

  const makeLeg = useCallback((contract, optType, side, qty = 1) => ({
    local_id: uniqueId(),
    included: true,
    side,
    qty,
    opt_type: optType,
    strike: Number(contract?.strike || spot || 0),
    expiration: selectedExpiration,
    entry_price: Number((side === 'BUY' ? contract?.ask : contract?.bid) || contract?.mid || contract?.last || 0),
    iv: Number(contract?.iv || 0.2),
    iv_adjustment: 0,
    delta: contract?.delta ?? null,
  }), [selectedExpiration, spot])

  const addLeg = useCallback((contract, optType, side) => {
    setLegs(previous => [...previous, makeLeg(contract, optType, side)])
  }, [makeLeg])

  const updateLeg = (id, field, value) => setLegs(previous => previous.map(leg => leg.local_id === id ? { ...leg, [field]: value } : leg))
  const setLegIncluded = (id, included) => updateLeg(id, 'included', included)
  const removeLeg = id => setLegs(previous => previous.filter(leg => leg.local_id !== id))
  const resizeLegStructure = useCallback((edge, proposedStrike) => {
    setLegs(previous => resizeOptionStructure(previous, { edge, proposedStrike, chain, selectedExpiration }))
  }, [chain, selectedExpiration])

  const nearestContract = useCallback((type, target, offset = 0) => {
    const contracts = [...(type === 'CALL' ? chain?.calls || [] : chain?.puts || [])].sort((a, b) => a.strike - b.strike)
    if (!contracts.length) return null
    let index = contracts.reduce((best, contract, current) => Math.abs(contract.strike - target) < Math.abs(contracts[best].strike - target) ? current : best, 0)
    index = Math.max(0, Math.min(contracts.length - 1, index + offset))
    return contracts[index]
  }, [chain])

  const applyTemplate = type => {
    if (!chain || !spot) return
    const atmCall = nearestContract('CALL', spot)
    const atmPut = nearestContract('PUT', spot)
    let next = []
    let name = strategyName
    if (type === 'long-call' && atmCall) {
      next = [makeLeg(atmCall, 'CALL', 'BUY')]
      name = `${ticker} long call`
    } else if (type === 'bull-call' && atmCall) {
      const shortCall = nearestContract('CALL', atmCall.strike, 2)
      next = [makeLeg(atmCall, 'CALL', 'BUY'), makeLeg(shortCall, 'CALL', 'SELL')]
      name = `${ticker} bull call spread`
    } else if (type === 'bear-put' && atmPut) {
      const shortPut = nearestContract('PUT', atmPut.strike, -2)
      next = [makeLeg(atmPut, 'PUT', 'BUY'), makeLeg(shortPut, 'PUT', 'SELL')]
      name = `${ticker} bear put spread`
    } else if (type === 'straddle' && atmCall && atmPut) {
      next = [makeLeg(atmCall, 'CALL', 'BUY'), makeLeg(atmPut, 'PUT', 'BUY')]
      name = `${ticker} long straddle`
    } else if (type === 'iron-condor' && atmCall && atmPut) {
      const shortPut = nearestContract('PUT', spot, -2)
      const longPut = nearestContract('PUT', spot, -4)
      const shortCall = nearestContract('CALL', spot, 2)
      const longCall = nearestContract('CALL', spot, 4)
      next = [
        makeLeg(longPut, 'PUT', 'BUY'), makeLeg(shortPut, 'PUT', 'SELL'),
        makeLeg(shortCall, 'CALL', 'SELL'), makeLeg(longCall, 'CALL', 'BUY'),
      ]
      name = `${ticker} iron condor`
    }
    setLegs(next.filter(Boolean))
    setStrategyName(name)
    setStrategyId(null)
    setWorkspace('risk')
  }

  const netDebit = useMemo(() => activeLegs.reduce((total, leg) => {
    const direction = leg.side === 'BUY' ? 1 : -1
    return total + direction * Math.max(1, Number(leg.qty) || 1) * Number(leg.entry_price || 0) * 100
  }, 0), [activeLegs])

  const saveStrategy = async () => {
    if (!strategyName.trim() || !legs.length) {
      setSaveStatus('Add at least one leg and name the strategy before saving.')
      return
    }
    setSaveStatus('Saving…')
    const payload = {
      name: strategyName.trim(), underlying: ticker, model, rate: (Number(ratePct) || 0) / 100, notes,
      legs: legs.map((leg, index) => ({
        group_id: 0, included: leg.included, side: leg.side, qty: Number(leg.qty) || 1,
        opt_type: leg.opt_type, strike: Number(leg.strike), expiration: leg.expiration,
        entry_price: Number(leg.entry_price) || 0, iv_override: modeledLegIv(leg), sort_order: index,
      })),
    }
    try {
      if (strategyId) {
        await fetchJson(`/api/options/strategies/${strategyId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      } else {
        const created = await fetchJson('/api/options/strategies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        setStrategyId(created.id)
      }
      setSaveStatus('Saved')
      loadSavedStrategies()
    } catch (error) {
      setSaveStatus(error.message)
    }
  }

  const loadStrategy = strategy => {
    setStrategyId(strategy.id)
    setStrategyName(strategy.name)
    setTicker(strategy.underlying)
    setTickerInput(strategy.underlying)
    setModel(strategy.model || 'black-scholes')
    setRatePct(Number(strategy.rate ?? 0.0375) * 100)
    setNotes(strategy.notes || '')
    setLegs((strategy.legs || []).map(leg => ({
      local_id: uniqueId(), included: Boolean(leg.included), side: leg.side, qty: leg.qty,
      opt_type: leg.opt_type, strike: leg.strike, expiration: leg.expiration,
      entry_price: leg.entry_price ?? 0, iv: leg.iv_override ?? 0.2, iv_adjustment: 0, delta: null,
    })))
    setEvaluationDate(TODAY())
    setVolatilityShift(0)
    setWorkspace('risk')
    setSaveStatus(`Loaded ${strategy.name}`)
  }

  const deleteStrategy = async strategy => {
    if (!window.confirm(`Delete “${strategy.name}”?`)) return
    try {
      await fetchJson(`/api/options/strategies/${strategy.id}`, { method: 'DELETE' })
      if (strategy.id === strategyId) setStrategyId(null)
      loadSavedStrategies()
    } catch (error) {
      setSaveStatus(error.message)
    }
  }

  const newStrategy = () => {
    setStrategyId(null)
    setStrategyName('Untitled strategy')
    setNotes('')
    setLegs([])
    setEvaluationDate(TODAY())
    setVolatilityShift(0)
    setSaveStatus('New strategy')
    setWorkspace('chain')
  }

  const changeTone = Number(quote?.change || 0) >= 0 ? 'positive' : 'negative'

  return (
    <div className="page opt-page">
      <div className="opt-page-header">
        <div>
          <div className="opt-eyebrow">Strategy laboratory</div>
          <h1>Options</h1>
          <p>Build multi-leg simulated trades, study their risk profile, and move the analysis date forward to see how time and volatility reshape the position.</p>
        </div>
        <div className="opt-learning-badge"><strong>Learning mode</strong><span>Modeled results — no orders are placed</span></div>
      </div>

      <section className="opt-market-bar card">
        <form onSubmit={submitTicker} className="opt-symbol-form">
          <label><span>Underlying</span><input value={tickerInput} onChange={event => setTickerInput(event.target.value.toUpperCase())} aria-label="Options underlying symbol" /></label>
          <button type="submit" className="btn btn-primary">Load chain</button>
          <button type="button" className="btn btn-secondary" onClick={() => setMarketRefresh(value => value + 1)}>Refresh</button>
        </form>
        {quote && (
          <div className="opt-quote-strip">
            <div className="opt-symbol-name"><strong>{quote.ticker}</strong><span>{quote.name || 'Underlying'}</span></div>
            <QuoteMetric label="Last" value={money(quote.last)} />
            <QuoteMetric label="Change" value={`${Number(quote.change || 0) >= 0 ? '+' : ''}${fmt(quote.change)} (${Number(quote.change_pct || 0) >= 0 ? '+' : ''}${fmt(quote.change_pct)}%)`} tone={changeTone} />
            <QuoteMetric label="Bid / Ask" value={`${fmt(quote.bid)} / ${fmt(quote.ask)}`} />
            <QuoteMetric label="Open" value={money(quote.open)} />
            <QuoteMetric label="Day range" value={`${fmt(quote.low)} – ${fmt(quote.high)}`} />
            <QuoteMetric label="Volume" value={fmt(quote.volume, 0)} />
          </div>
        )}
        {(marketLoading || chainLoading) && <div className="opt-loading-line"><span /> Loading live market data…</div>}
        {marketError && <div className="opt-error">{marketError}</div>}
      </section>

      <div className="opt-command-row">
        <div className="opt-workspace-tabs" role="tablist" aria-label="Options workspace">
          <button type="button" className={workspace === 'chain' ? 'active' : ''} onClick={() => setWorkspace('chain')}>Option Chain &amp; Trades</button>
          <button type="button" className={workspace === 'risk' ? 'active' : ''} onClick={() => setWorkspace('risk')}>Risk Profile</button>
        </div>
        <div className="opt-save-actions">
          <button type="button" className="btn btn-secondary" onClick={newStrategy}>New</button>
          <button type="button" className="btn btn-primary" onClick={saveStrategy} disabled={!legs.length}>Save strategy</button>
          {saveStatus && <span>{saveStatus}</span>}
        </div>
      </div>

      <section className="opt-strategy-meta card">
        <label className="opt-name-field"><span>Strategy name</span><input value={strategyName} onChange={event => setStrategyName(event.target.value)} /></label>
        <label><span>Pricing model</span><select value={model} onChange={event => setModel(event.target.value)}><option value="black-scholes">Black–Scholes</option><option value="bjerksund-stensland">Bjerksund–Stensland</option></select></label>
        <label><span>Rate</span><div className="opt-suffix-input"><input type="number" step="0.05" value={ratePct} onChange={event => setRatePct(event.target.value)} /><b>%</b></div></label>
        <label className="opt-notes-field"><span>Learning notes</span><input value={notes} onChange={event => setNotes(event.target.value)} placeholder="What are you testing?" /></label>
        <label><span>Saved scenarios</span><select value="" onChange={event => { const saved = savedStrategies.find(item => String(item.id) === event.target.value); if (saved) loadStrategy(saved) }}><option value="">Load a strategy…</option>{savedStrategies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.underlying}</option>)}</select></label>
        {strategyId && <button type="button" className="opt-delete-saved" onClick={() => { const saved = savedStrategies.find(item => item.id === strategyId); if (saved) deleteStrategy(saved) }}>Delete saved</button>}
      </section>

      {workspace === 'chain' ? (
        <>
          <section className="card opt-chain-card">
            <div className="opt-section-heading">
              <div><span>Live chain</span><h2>{selectedExpiration ? formatExpiration(selectedExpiration) : 'Choose an expiration'}</h2></div>
              <div className="opt-chain-controls">
                <label><span>Expiration</span><select value={selectedExpiration} onChange={event => setSelectedExpiration(event.target.value)}>{expirations.map(expiration => <option key={expiration} value={expiration}>{formatExpiration(expiration)} · {daysBetween(TODAY(), expiration)} DTE</option>)}</select></label>
                <label><span>Strikes</span><select value={strikeRange} onChange={event => setStrikeRange(event.target.value)}><option value="10">ATM ±10%</option><option value="20">ATM ±20%</option><option value="40">ATM ±40%</option><option value="all">All strikes</option></select></label>
                <details className="opt-chain-column-picker">
                  <summary>Columns <span>{visibleChainColumns.length}</span></summary>
                  <div className="opt-chain-column-panel">
                    <div className="opt-chain-column-presets">
                      {Object.entries(CHAIN_COLUMN_PRESETS).map(([name, ids]) => <button key={name} type="button" onClick={() => setChainColumnIds(ids)}>{name}</button>)}
                    </div>
                    <div className="opt-chain-column-options">
                      {CHAIN_COLUMNS.map(column => (
                        <label key={column.id} title={column.tip}>
                          <input type="checkbox" checked={chainColumnIds.includes(column.id)} onChange={() => toggleChainColumn(column.id)} />
                          <span><strong>{column.label}</strong><small>{column.name}</small></span>
                        </label>
                      ))}
                    </div>
                    <small className="opt-chain-columns-saved">Selections save automatically on this device.</small>
                  </div>
                </details>
              </div>
            </div>
            <div className="opt-chain-help"><span className="opt-buy-dot" /> Click an ask to buy <span className="opt-sell-dot" /> Click a bid to sell</div>
            <div className="opt-chain-wrap">
              <table className="opt-chain-table">
                <thead><tr><th colSpan={visibleChainColumns.length} className="opt-call-head">Calls</th><th className="opt-strike-head">Strike</th><th colSpan={visibleChainColumns.length} className="opt-put-head">Puts</th></tr><tr>{visibleChainColumns.map(column => <th key={`call-${column.id}`} title={column.tip}>{column.label}</th>)}<th className="opt-strike-head">Price</th>{mirroredPutColumns.map(column => <th key={`put-${column.id}`} title={column.tip}>{column.label}</th>)}</tr></thead>
                <tbody>
                  {chainRows.map(row => <tr key={row.strike} className={Math.abs(row.strike - spot) === Math.min(...chainRows.map(item => Math.abs(item.strike - spot))) ? 'opt-atm-row' : ''}><ChainCells contract={row.call} itm={row.strike < spot} onAdd={addLeg} optType="CALL" columns={visibleChainColumns} /><td className="opt-strike-cell">{fmt(row.strike, row.strike >= 100 ? 0 : 1)}</td><ChainCells contract={row.put} itm={row.strike > spot} onAdd={addLeg} optType="PUT" columns={mirroredPutColumns} /></tr>)}
                  {!chainRows.length && !chainLoading && <tr><td colSpan={visibleChainColumns.length * 2 + 1} className="opt-empty-row">No option contracts are available in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card opt-templates">
            <div><span>Quick learning templates</span><small>Templates replace the simulated legs below using contracts near the current price.</small></div>
            <div><button onClick={() => applyTemplate('long-call')}>Long call</button><button onClick={() => applyTemplate('bull-call')}>Bull call spread</button><button onClick={() => applyTemplate('bear-put')}>Bear put spread</button><button onClick={() => applyTemplate('straddle')}>Long straddle</button><button onClick={() => applyTemplate('iron-condor')}>Iron condor</button></div>
          </section>
        </>
      ) : (
        <section className="card opt-risk-workspace">
          <div className="opt-risk-controls">
            <label><span>Analysis date</span><input type="date" min={TODAY()} max={analysisHorizon} value={evaluationDate} onInput={event => setBoundedEvaluationDate(event.target.value)} onChange={event => setBoundedEvaluationDate(event.target.value)} /></label>
            <label className="opt-time-slider"><span>Move through time · day {evaluationOffset} of {evolutionDays}</span><input type="range" min="0" max={evolutionDays} value={evaluationOffset} onInput={event => setBoundedEvaluationDate(addDays(TODAY(), event.target.value))} onChange={event => setBoundedEvaluationDate(addDays(TODAY(), event.target.value))} /></label>
            <label><span>Global vol adjustment</span><div className="opt-suffix-input"><input type="number" step="0.5" value={volatilityShift} onChange={event => setVolatilityShift(event.target.value)} title="Add or subtract volatility points from every leg" /><b>pts</b></div></label>
            <label><span>Price range</span><div className="opt-suffix-input"><input type="number" min="5" max="100" value={priceRangePct} onChange={event => setPriceRangePct(event.target.value)} /><b>±%</b></div></label>
            <label><span>Day-step lines</span><select value={dayStep} onChange={event => setDayStep(Number(event.target.value))}><option value="0">Off</option><option value="1">Every day</option><option value="3">Every 3 days</option><option value="5">Every 5 days</option><option value="7">Every 7 days</option><option value="14">Every 14 days</option></select></label>
          </div>
          {hasMixedExpirations && <div className="opt-horizon-note"><strong>Mixed expirations:</strong> analysis ends at the first expiration, {formatExpiration(analysisHorizon)}. Later-dated legs retain their remaining modeled time value.</div>}
          {riskLoading && <div className="opt-calculating">Repricing every leg…</div>}
          {riskError && <div className="opt-error">{riskError}</div>}
          {!activeLegs.length ? <div className="opt-risk-empty"><strong>{legs.length ? 'No legs are included in the risk graph.' : 'Add simulated trades to build a risk profile.'}</strong><span>{legs.length ? 'Check Use for each leg you want included in the graph and risk totals.' : 'Use the option chain or a learning template, then return here.'}</span>{!legs.length && <button className="btn btn-primary" onClick={() => setWorkspace('chain')}>Open option chain</button>}</div> : risk && (
            <>
              <div className="opt-summary-grid">
                <SummaryMetric label="Entry" value={netDebit >= 0 ? `${money(netDebit)} debit` : `${money(Math.abs(netDebit))} credit`} />
                <SummaryMetric label="Range max profit" value={money(risk.max_profit)} tone="positive" helper="Within displayed prices" />
                <SummaryMetric label="Range max loss" value={money(risk.max_loss)} tone="negative" helper="Within displayed prices" />
                <SummaryMetric label="Breakeven" value={(risk.breakevens || []).length ? risk.breakevens.map(value => fmt(value)).join(' · ') : 'None in range'} />
                <SummaryMetric label="Delta" value={fmt(risk.portfolio_greeks?.delta, 2)} />
                <SummaryMetric label="Theta / day" value={fmt(risk.portfolio_greeks?.theta, 2)} tone={Number(risk.portfolio_greeks?.theta) >= 0 ? 'positive' : 'negative'} />
                <SummaryMetric label="Vega / point" value={fmt(risk.portfolio_greeks?.vega, 2)} />
              </div>
              {strikeStructure && <div className="opt-structure-drag-hint"><span aria-hidden="true">↔</span><span>Drag either blue strike handle to widen or narrow the entire structure around <strong>{money(strikeStructure.center)}</strong>.</span></div>}
              <RiskChart result={risk} evaluationDate={evaluationDate} strikeStructure={strikeStructure} onResizeStructure={resizeLegStructure} />
              <div className="opt-slice-heading"><div><span>Price slices</span><h3>Greeks and modeled P/L at selected prices</h3></div><div className="opt-slice-inputs">{sliceOffsets.map((offset, index) => <label key={index}><input type="number" value={offset} onChange={event => setSliceOffsets(values => values.map((value, current) => current === index ? Number(event.target.value) : value))} /><span>%</span></label>)}</div></div>
              <div className="opt-table-wrap"><table className="opt-slices-table"><thead><tr><th>Underlying</th><th>Move</th><th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th><th>P/L open</th><th>1-day theta</th></tr></thead><tbody>{(risk.price_slices || []).map((slice, index) => <tr key={`${slice.s}-${index}`}><td>{money(slice.s)}</td><td>{Number(sliceOffsets[index]) > 0 ? '+' : ''}{sliceOffsets[index]}%</td><td>{fmt(slice.delta, 3)}</td><td>{fmt(slice.gamma, 4)}</td><td>{fmt(slice.theta, 2)}</td><td>{fmt(slice.vega, 2)}</td><td className={Number(slice.pnl_open) >= 0 ? 'opt-positive' : 'opt-negative'}>{signedMoney(slice.pnl_open)}</td><td className={Number(slice.pnl_day) >= 0 ? 'opt-positive' : 'opt-negative'}>{signedMoney(slice.pnl_day)}</td></tr>)}</tbody></table></div>
            </>
          )}
        </section>
      )}

      <section className="card opt-legs-card">
        <div className="opt-section-heading">
          <div><span>Positions and simulated trades</span><h2>{legs.length ? `${activeLegs.length} of ${legs.length} active · ${ticker}` : 'No simulated trades'}</h2></div>
          <div className="opt-leg-actions"><button type="button" onClick={() => { const contract = nearestContract('CALL', spot); if (contract) addLeg(contract, 'CALL', 'BUY') }}>+ Add ATM call</button><button type="button" onClick={() => setWorkspace('risk')} disabled={!legs.length}>Analyze risk</button></div>
        </div>
        <div className="opt-table-wrap">
          <table className="opt-legs-table"><thead><tr><th>Use</th><th>Side</th><th>Qty</th><th>Symbol</th><th>Expiration</th><th>Strike</th><th>Type</th><th>Entry</th><th>Market IV</th><th>Vol Adj</th><th>Modeled IV</th><th>Delta</th><th /></tr></thead><tbody>
            {legs.map(leg => <tr key={leg.local_id} className={`${leg.side === 'BUY' ? 'opt-buy-leg' : 'opt-sell-leg'}${leg.included ? '' : ' opt-leg-disabled'}`}><td><input type="checkbox" checked={leg.included} onChange={event => setLegIncluded(leg.local_id, event.target.checked)} aria-label={`${leg.included ? 'Exclude' : 'Include'} ${ticker} ${leg.strike} ${leg.opt_type} from risk graph`} title="Include this leg in the risk graph" /></td><td><select value={leg.side} onChange={event => updateLeg(leg.local_id, 'side', event.target.value)}><option>BUY</option><option>SELL</option></select></td><td><input type="number" min="1" value={leg.qty} onChange={event => updateLeg(leg.local_id, 'qty', event.target.value)} /></td><td><strong>{ticker}</strong></td><td><select value={leg.expiration} onChange={event => updateLeg(leg.local_id, 'expiration', event.target.value)}>{!expirations.includes(leg.expiration) && <option value={leg.expiration}>{formatExpiration(leg.expiration)}</option>}{expirations.map(expiration => <option key={expiration} value={expiration}>{formatExpiration(expiration)}</option>)}</select></td><td><input type="number" step="0.5" value={leg.strike} onChange={event => updateLeg(leg.local_id, 'strike', event.target.value)} /></td><td><select value={leg.opt_type} onChange={event => updateLeg(leg.local_id, 'opt_type', event.target.value)}><option>CALL</option><option>PUT</option></select></td><td><input type="number" step="0.01" value={leg.entry_price} onChange={event => updateLeg(leg.local_id, 'entry_price', event.target.value)} /></td><td>{percent(leg.iv)}</td><td><div className="opt-inline-suffix"><input type="number" step="0.5" value={leg.iv_adjustment ?? 0} onChange={event => updateLeg(leg.local_id, 'iv_adjustment', event.target.value)} aria-label={`${ticker} ${leg.strike} ${leg.opt_type} volatility adjustment`} title="Manual volatility-point adjustment for this leg" /><span>pts</span></div></td><td title="Market IV plus the leg and global volatility adjustments">{percent(modeledLegIv(leg, volatilityShift))}</td><td>{fmt(leg.delta, 3)}</td><td><button className="opt-remove-leg" type="button" onClick={() => removeLeg(leg.local_id)} aria-label="Remove leg">×</button></td></tr>)}
            {!legs.length && <tr><td colSpan="13" className="opt-empty-row">Click a bid or ask in the chain, or start with a learning template.</td></tr>}
          </tbody><tfoot><tr><td colSpan="7">Net entry</td><td className={netDebit <= 0 ? 'opt-positive' : ''}>{netDebit >= 0 ? `${money(netDebit)} debit` : `${money(Math.abs(netDebit))} credit`}</td><td colSpan="5" /></tr></tfoot></table>
        </div>
      </section>

      <div className="opt-disclaimer"><strong>Educational modeling only.</strong> Quotes can be delayed or incomplete. Greeks and theoretical values are estimates, exclude commissions and assignment effects, and are not investment advice.</div>
    </div>
  )
}
