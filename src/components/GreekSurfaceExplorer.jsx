import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThemedPlot from './ThemedPlot'
import { API_BASE } from '../config'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'

const TODAY = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

const daysBetween = (start, end) => {
  const a = new Date(`${start}T00:00:00`)
  const b = new Date(`${end}T00:00:00`)
  return Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())
    ? 0
    : Math.max(0, Math.round((b - a) / 86400000))
}

const formatExpiration = expiration => {
  if (!expiration) return '—'
  const value = new Date(`${expiration}T00:00:00`)
  return Number.isNaN(value.getTime())
    ? expiration
    : value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const money = value => Number(value).toLocaleString(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const signedMoney = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const sign = number > 0 ? '+' : number < 0 ? '−' : ''
  return `${sign}${money(Math.abs(number))}`
}

// Linear interpolation over an ascending x grid; used to read the traced spot's
// delta/gamma/value between the sampled profile points so the risk-graph tangent
// tracks the cursor smoothly rather than snapping to grid points.
const interpolateAt = (xs, ys, x) => {
  if (!xs?.length || !ys?.length) return null
  const n = xs.length
  if (x <= xs[0]) return Number(ys[0])
  if (x >= xs[n - 1]) return Number(ys[n - 1])
  let low = 0
  let high = n - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (xs[mid] <= x) low = mid
    else high = mid
  }
  const a = Number(xs[low])
  const b = Number(xs[high])
  const ya = Number(ys[low])
  const yb = Number(ys[high])
  if (!Number.isFinite(ya) || !Number.isFinite(yb)) return null
  const span = b - a || 1
  return ya + ((x - a) / span) * (yb - ya)
}

// Interpolate a full price row out of a [dteRow][spot] surface grid at an
// arbitrary days-to-expiration, so the risk graph can slice the current-value
// curve (and its delta/gamma) at any point between today and expiration.
const interpSurfaceRow = (grid, dtes, targetDte) => {
  if (!grid?.length || !dtes?.length) return null
  const n = dtes.length
  if (targetDte <= dtes[0]) return grid[0]
  if (targetDte >= dtes[n - 1]) return grid[n - 1]
  let low = 0
  let high = n - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (dtes[mid] <= targetDte) low = mid
    else high = mid
  }
  const a = Number(dtes[low])
  const b = Number(dtes[high])
  const fraction = (targetDte - a) / ((b - a) || 1)
  return grid[low].map((value, column) => {
    const lowValue = Number(value)
    const highValue = Number(grid[high][column])
    if (!Number.isFinite(lowValue)) return highValue
    if (!Number.isFinite(highValue)) return lowValue
    return lowValue + (highValue - lowValue) * fraction
  })
}

const METRIC_GROUPS = [
  {
    label: 'Primary Greeks',
    metrics: [
      ['delta', 'Delta'],
      ['gamma', 'Gamma'],
      ['theta', 'Theta'],
      ['vega', 'Vega'],
      ['rho', 'Rho'],
    ],
  },
  {
    label: 'Second-order & higher',
    metrics: [
      ['vanna', 'Vanna'],
      ['vomma', 'Vomma (Volga)'],
      ['charm', 'Charm'],
      ['speed', 'Speed'],
      ['color', 'Color'],
      ['zomma', 'Zomma'],
    ],
  },
]

const DEFAULT_METRIC_META = Object.fromEntries(
  METRIC_GROUPS.flatMap(group => group.metrics.map(([id, label]) => [id, { label, family: group.label, unit: '' }])),
)

const GREEK_RELATIONSHIPS = [
  { id: 'gamma', label: 'Gamma → Delta', driver: 'gamma', target: 'delta', shockKind: 'price', shockLabel: 'Underlying move', shockUnit: '$', defaultShock: 1, min: -100, max: 100, step: 1 },
  { id: 'vanna', label: 'Vanna → Delta', driver: 'vanna', target: 'delta', shockKind: 'volatility', shockLabel: 'IV change', shockUnit: 'points', defaultShock: 1, min: -25, max: 25, step: 0.25 },
  { id: 'charm', label: 'Charm → Delta', driver: 'charm', target: 'delta', shockKind: 'time', shockLabel: 'Time elapsed', shockUnit: 'days', defaultShock: 1, min: 0.25, max: 30, step: 0.25 },
  { id: 'vomma', label: 'Vomma → Vega', driver: 'vomma', target: 'vega', shockKind: 'volatility', shockLabel: 'IV change', shockUnit: 'points', defaultShock: 1, min: -25, max: 25, step: 0.25 },
  { id: 'speed', label: 'Speed → Gamma', driver: 'speed', target: 'gamma', shockKind: 'price', shockLabel: 'Underlying move', shockUnit: '$', defaultShock: 1, min: -100, max: 100, step: 1 },
  { id: 'color', label: 'Color → Gamma', driver: 'color', target: 'gamma', shockKind: 'time', shockLabel: 'Time elapsed', shockUnit: 'days', defaultShock: 1, min: 0.25, max: 30, step: 0.25 },
  { id: 'zomma', label: 'Zomma → Gamma', driver: 'zomma', target: 'gamma', shockKind: 'volatility', shockLabel: 'IV change', shockUnit: 'points', defaultShock: 1, min: -25, max: 25, step: 0.25 },
]

// First-order Greeks normally explain the local shape at the traced price. Vega
// is different: its natural scenario is a volatility shift, so show how a
// standard +1 IV-point shock changes the whole current-value P/L curve.
const GREEK_VALUE_TRACES = {
  theta: {
    id: 'theta-value',
    label: 'Theta 1-day P/L',
    driver: 'theta',
    target: null,
    shockKind: 'time',
    shockLabel: 'Time elapsed',
    shockUnit: 'days',
    defaultShock: 1,
    valueEffect: true,
  },
  vega: {
    id: 'vega-value',
    label: 'Vega IV-shock P/L',
    driver: 'vega',
    target: null,
    shockKind: 'volatility',
    shockLabel: 'IV change',
    shockUnit: 'points',
    defaultShock: 1,
    valueEffect: true,
  },
  rho: {
    id: 'rho-value',
    label: 'Rho rate-shock P/L',
    driver: 'rho',
    target: null,
    shockKind: 'rate',
    shockLabel: 'Rate change',
    shockUnit: 'points',
    defaultShock: 1,
    valueEffect: true,
  },
}

const GREEK_GUIDE = [
  {
    id: 'delta',
    name: 'Delta',
    measures: 'The option-price change for a $1 underlying move. It also approximates the option’s directional exposure per share.',
    behavior: 'Call delta usually rises from near 0 when far OTM toward 1 when deep ITM; put delta usually rises from about −1 toward 0. The transition is steepest near the strike and becomes more step-like near expiration because the range of plausible terminal prices narrows.',
  },
  {
    id: 'gamma',
    name: 'Gamma',
    measures: 'The change in delta for a $1 underlying move—the curvature of the option value.',
    behavior: 'Long call and put gamma is normally positive and peaks near the strike. As expiration approaches, delta changes over a tighter price interval, so the ATM gamma ridge becomes taller and narrower while the wings fall toward zero.',
  },
  {
    id: 'theta',
    name: 'Theta',
    measures: 'The modeled option-price change after one calendar day passes, with other assumptions held constant.',
    behavior: 'Long-option theta is usually negative because extrinsic value disappears with time. Decay is generally strongest near ATM and close to expiration, where the remaining time value is both meaningful and disappearing quickly; deep ITM or OTM options usually have less extrinsic value to lose.',
  },
  {
    id: 'vega',
    name: 'Vega',
    measures: 'The option-price change for a one-percentage-point increase in implied volatility.',
    behavior: 'Long-option vega is normally positive, largest near ATM, and larger with more time remaining. It fades near expiration and in the far wings because volatility has less time—or too little probability mass near the strike—to change the payoff distribution materially.',
  },
  {
    id: 'rho',
    name: 'Rho',
    measures: 'The option-price change for a one-percentage-point increase in the risk-free rate.',
    behavior: 'Call rho is generally positive and put rho negative. Its magnitude usually grows with DTE because rates have more time to change the present value of the strike; the surface contracts toward zero as expiration approaches.',
  },
  {
    id: 'vanna',
    name: 'Vanna',
    measures: 'The change in delta for a one-percentage-point increase in implied volatility.',
    behavior: 'Vanna often changes sign around the ATM region. More volatility can increase the delta of an OTM option by making a strike-crossing move more plausible, while it can reduce the certainty embedded in a deep-ITM delta. That produces opposite-signed regions around the strike.',
  },
  {
    id: 'vomma',
    name: 'Vomma (Volga)',
    measures: 'The change in vega for a one-percentage-point increase in implied volatility.',
    behavior: 'Vomma frequently forms lobes away from exact ATM because a volatility change can move wing options into a region where their vega is more responsive. It may be small or negative near the center and tends to weaken as expiration removes volatility exposure.',
  },
  {
    id: 'charm',
    name: 'Charm',
    measures: 'The change in delta after one calendar day passes—the app’s delta-decay convention.',
    behavior: 'Charm commonly changes sign near the strike. As time passes, an OTM delta tends to move toward 0 while an ITM delta tends toward its expiration limit, so the two sides move in different directions. The surface steepens near expiry as those probabilities resolve faster.',
  },
  {
    id: 'speed',
    name: 'Speed',
    measures: 'The change in gamma for a $1 underlying move.',
    behavior: 'Speed is the slope of the gamma ridge. It is typically positive on the lower-price side, near zero at gamma’s peak, and negative on the higher-price side. Its magnitudes become sharper near expiration as the gamma ridge narrows.',
  },
  {
    id: 'color',
    name: 'Color',
    measures: 'The change in gamma after one calendar day passes—the app’s gamma-decay convention.',
    behavior: 'Near ATM, gamma can increase as expiration approaches, while away from the strike it often falls as probability mass collapses toward the terminal payoff boundary. This makes color switch sign around the sharpening gamma ridge.',
  },
  {
    id: 'zomma',
    name: 'Zomma',
    measures: 'The change in gamma for a one-percentage-point increase in implied volatility.',
    behavior: 'Higher volatility usually broadens and flattens the gamma ridge: ATM gamma can decrease while wing gamma increases. Zomma therefore often shows a negative center with positive regions farther from the strike.',
  },
]

function formatGreek(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const magnitude = Math.abs(number)
  if (magnitude > 0 && magnitude < 0.0001) return number.toExponential(3)
  if (magnitude >= 100) return number.toFixed(2)
  if (magnitude >= 1) return number.toFixed(4)
  return number.toFixed(6)
}

function formatSignedGreek(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number > 0 ? '+' : ''}${formatGreek(number)}`
}

function formatRelationshipShock(definition, value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'selected shock'
  if (definition.shockKind === 'time') {
    return `${number.toFixed(number % 1 ? 2 : 0)} calendar day${number === 1 ? '' : 's'} elapsed`
  }
  const sign = number > 0 ? '+' : number < 0 ? '−' : ''
  const magnitude = Math.abs(number)
  if (definition.shockKind === 'price') return `${sign}${money(magnitude)} underlying move`
  if (definition.shockKind === 'rate') return `${sign}${magnitude.toFixed(magnitude % 1 ? 2 : 0)} rate point${magnitude === 1 ? '' : 's'}`
  return `${sign}${magnitude.toFixed(magnitude % 1 ? 2 : 0)} IV point${magnitude === 1 ? '' : 's'}`
}

export default function GreekSurfaceExplorer({
  ticker,
  quote,
  chain,
  expirations,
  selectedExpiration,
  onSelectExpiration,
  chainLoading,
  marketLoading,
  model,
  onModelChange,
  ratePct,
  onRateChange,
  positionLegs = [],
  positionStrikeChoices = {},
  positionName = 'Active position',
  savedPositions = [],
  selectedPositionId,
  onLoadSavedPosition,
  onBuildPositionTemplate,
  onPositionStrikeChange,
  onEditPosition,
}) {
  const { isDark } = useTheme()
  const [analysisScope, setAnalysisScope] = useState(() => positionLegs.length ? 'position' : 'single')
  const [chartView, setChartView] = useState('charts')
  const [metric, setMetric] = useState('gamma')
  const [relationshipId, setRelationshipId] = useState('gamma')
  const [relationshipShock, setRelationshipShock] = useState(1)
  const [pricingScenarioPoints, setPricingScenarioPoints] = useState(0)
  const [chartOverview, setChartOverview] = useState(false)
  const [profileAxis, setProfileAxis] = useState('price')
  const [targetDte, setTargetDte] = useState(30)
  const [optionType, setOptionType] = useState('CALL')
  const [chainWindow, setChainWindow] = useState('10')
  const [selectedStrike, setSelectedStrike] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [ivPct, setIvPct] = useState(20)
  const [priceRangePct, setPriceRangePct] = useState(20)
  const [result, setResult] = useState(null)
  const [linkedSpot, setLinkedSpot] = useState(null)
  const pointerFrameRef = useRef(null)
  const pendingPointerRef = useRef(null)
  const preserveGraphsDuringScenarioUpdateRef = useRef(false)
  // Days-to-expiration at which the risk graph slices the current-value P/L.
  // null = today (the full analysis horizon); a smaller value walks time forward.
  const [analysisDte, setAnalysisDte] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [appliedRequest, setAppliedRequest] = useState(null)
  const [pendingGraphUpdate, setPendingGraphUpdate] = useState(false)
  const [initializedRequestKeys, setInitializedRequestKeys] = useState([])

  useEffect(() => () => {
    if (pointerFrameRef.current != null) cancelAnimationFrame(pointerFrameRef.current)
  }, [])

  useEffect(() => {
    if (!chartOverview) return undefined
    const closeOverview = event => {
      if (event.key === 'Escape') setChartOverview(false)
    }
    document.body.classList.add('opt-greek-overview-open')
    window.addEventListener('keydown', closeOverview)
    return () => {
      document.body.classList.remove('opt-greek-overview-open')
      window.removeEventListener('keydown', closeOverview)
    }
  }, [chartOverview])

  const activeChain = chain?.expiration === selectedExpiration ? chain : null
  const spot = Number(quote?.last || activeChain?.spot || 0)
  const actualDte = daysBetween(TODAY(), selectedExpiration)
  const positionMode = analysisScope === 'position'

  useEffect(() => {
    setPricingScenarioPoints(0)
  }, [metric, analysisScope, chartView])

  const relationshipDefinition = GREEK_RELATIONSHIPS.find(item => item.id === relationshipId) || GREEK_RELATIONSHIPS[0]
  const relationshipPriceLimit = Math.max(1, spot * 0.25)
  const relationshipShockMin = relationshipDefinition.shockKind === 'price' ? -relationshipPriceLimit : relationshipDefinition.min
  const relationshipShockMax = relationshipDefinition.shockKind === 'price' ? relationshipPriceLimit : relationshipDefinition.max
  const relationshipShockNumber = Number(relationshipShock)
  const effectiveRelationshipShock = Number.isFinite(relationshipShockNumber) && relationshipShockNumber !== 0
    ? Math.min(relationshipShockMax, Math.max(relationshipShockMin, relationshipShockNumber))
    : relationshipDefinition.defaultShock
  const positionOptionLegs = useMemo(
    () => positionLegs.filter(leg => String(leg.opt_type || '').toUpperCase() !== 'STOCK'),
    [positionLegs],
  )
  const pricingScenarioKind = metric === 'rho' ? 'rate' : 'volatility'
  const pricingScenarioLimit = pricingScenarioKind === 'rate' ? 2 : 10
  const pricingScenarioStep = pricingScenarioKind === 'rate' ? 0.1 : 0.5
  const normalizedPricingScenarioPoints = Math.min(pricingScenarioLimit, Math.max(-pricingScenarioLimit, Number(pricingScenarioPoints) || 0))
  const pricingScenarioActive = positionMode && chartView === 'charts' && Math.abs(normalizedPricingScenarioPoints) > 1e-8
  const positionScenarioLegs = useMemo(() => {
    if (!pricingScenarioActive || pricingScenarioKind !== 'volatility') return positionLegs
    return positionLegs.map(leg => {
      if (String(leg.opt_type || '').toUpperCase() === 'STOCK') return leg
      const baseIv = Number(leg.iv)
      if (!Number.isFinite(baseIv)) return leg
      return { ...leg, iv: Math.min(5, Math.max(0.01, baseIv + normalizedPricingScenarioPoints / 100)) }
    })
  }, [positionLegs, pricingScenarioActive, pricingScenarioKind, normalizedPricingScenarioPoints])
  const positionHorizonDte = useMemo(() => {
    const dtes = positionOptionLegs
      .map(leg => daysBetween(TODAY(), leg.expiration))
      .filter(value => value > 0)
    return dtes.length ? Math.min(...dtes) : 0
  }, [positionOptionLegs])
  const effectiveDte = positionMode ? positionHorizonDte : actualDte

  useEffect(() => {
    if (actualDte > 0) setTargetDte(actualDte)
  }, [actualDte])

  useEffect(() => {
    setSelectedStrike('')
    setSelectedTemplateId('')
    setResult(null)
    setError('')
    setAppliedRequest(null)
    setPendingGraphUpdate(false)
    setInitializedRequestKeys([])
  }, [ticker])

  const contracts = useMemo(() => {
    if (!activeChain || !spot) return []
    const source = optionType === 'CALL' ? activeChain.calls : activeChain.puts
    const band = chainWindow === 'all' ? null : Number(chainWindow) / 100
    return (source || [])
      .filter(contract => Number(contract.strike) > 0)
      .filter(contract => band == null || Math.abs(Number(contract.strike) / spot - 1) <= band)
      .sort((a, b) => Number(a.strike) - Number(b.strike))
  }, [activeChain, optionType, chainWindow, spot])

  useEffect(() => {
    if (!contracts.length) {
      setSelectedStrike('')
      return
    }
    if (contracts.some(contract => String(contract.strike) === String(selectedStrike))) return
    const nearest = [...contracts].sort((a, b) => (
      Math.abs(Number(a.strike) - spot) - Math.abs(Number(b.strike) - spot)
    ))[0]
    setSelectedStrike(String(nearest.strike))
  }, [contracts, selectedStrike, spot])

  const selectedContract = useMemo(
    () => contracts.find(contract => String(contract.strike) === String(selectedStrike)) || null,
    [contracts, selectedStrike],
  )

  useEffect(() => {
    const liveIv = Number(selectedContract?.iv)
    setIvPct(liveIv > 0 ? Number((liveIv * 100).toFixed(2)) : 20)
  }, [selectedContract?.strike, selectedContract?.iv, selectedExpiration, optionType])

  const requestedDte = Math.min(1095, Math.max(1, Number(targetDte) || 30))
  const nearestExpiration = useMemo(() => (expirations || [])
    .map(expiration => ({ expiration, dte: daysBetween(TODAY(), expiration) }))
    .filter(item => item.dte > 0)
    .sort((a, b) => Math.abs(a.dte - requestedDte) - Math.abs(b.dte - requestedDte) || a.dte - b.dte)[0] || null,
  [expirations, requestedDte])

  const draftRequest = useMemo(() => {
    const requestStrike = Number(selectedContract?.strike)
    const requestIv = Number(ivPct) / 100
    const singleReady = !positionMode && requestStrike && actualDte && requestIv && activeChain
    const positionReady = positionMode && positionOptionLegs.length && positionHorizonDte
    if (!ticker || !spot || (!singleReady && !positionReady)) return null

    const payload = {
      underlying: ticker,
      spot_override: spot,
      rate: ((Number(ratePct) || 0) + (pricingScenarioActive && pricingScenarioKind === 'rate' ? normalizedPricingScenarioPoints : 0)) / 100,
      div_yield: Number(quote?.div_yield || activeChain?.div_yield || 0),
      model,
      price_range_pct: Math.min(80, Math.max(2, Number(priceRangePct) || 20)),
      ...(chartView === 'relationships' ? {
        relationship: relationshipId,
        relationship_shock: effectiveRelationshipShock,
      } : {}),
      ...(positionMode
        ? { legs: positionScenarioLegs }
        : { strike: requestStrike, dte: actualDte, iv: requestIv, opt_type: optionType.toLowerCase() }),
    }
    return {
      payload,
      signature: JSON.stringify({
        ...payload,
        requested_dte: positionMode ? positionHorizonDte : requestedDte,
        scope: positionMode ? 'position' : 'single',
      }),
    }
  }, [ticker, spot, ratePct, quote?.div_yield, activeChain, model, priceRangePct, chartView, relationshipId, effectiveRelationshipShock, positionMode, positionScenarioLegs, positionOptionLegs.length, positionHorizonDte, selectedContract?.strike, ivPct, actualDte, optionType, requestedDte, pricingScenarioActive, pricingScenarioKind, normalizedPricingScenarioPoints])

  const initializationKey = `${ticker}:${positionMode ? 'position' : 'single'}`

  useEffect(() => {
    if (!draftRequest || initializedRequestKeys.includes(initializationKey)) return undefined
    const timer = setTimeout(() => {
      setResult(null)
      setError('')
      setAppliedRequest(previous => ({ ...draftRequest, revision: (previous?.revision || 0) + 1 }))
      setInitializedRequestKeys(previous => previous.includes(initializationKey) ? previous : [...previous, initializationKey])
    }, 180)
    return () => clearTimeout(timer)
  }, [draftRequest, initializedRequestKeys, initializationKey])

  useEffect(() => {
    if (!pendingGraphUpdate || !draftRequest || marketLoading || (!positionMode && chainLoading)) return undefined
    const timer = setTimeout(() => {
      if (!preserveGraphsDuringScenarioUpdateRef.current) setResult(null)
      setError('')
      setAppliedRequest(previous => ({ ...draftRequest, revision: (previous?.revision || 0) + 1 }))
      setPendingGraphUpdate(false)
    }, 180)
    return () => clearTimeout(timer)
  }, [pendingGraphUpdate, draftRequest, marketLoading, positionMode, chainLoading])

  const updateGraphs = event => {
    event.preventDefault()
    preserveGraphsDuringScenarioUpdateRef.current = false
    setError('')
    if (positionMode) {
      if (!draftRequest) return
      setResult(null)
      setAppliedRequest(previous => ({ ...draftRequest, revision: (previous?.revision || 0) + 1 }))
      return
    }
    if (!nearestExpiration) {
      setError(`No listed option expiration is available near ${requestedDte} DTE.`)
      return
    }
    setResult(null)
    setPendingGraphUpdate(true)
    setTargetDte(nearestExpiration.dte)
    if (nearestExpiration.expiration !== selectedExpiration) onSelectExpiration(nearestExpiration.expiration)
  }

  const updatePricingScenario = nextValue => {
    const normalized = Math.min(pricingScenarioLimit, Math.max(-pricingScenarioLimit, Number(nextValue) || 0))
    if (Math.abs(normalized - normalizedPricingScenarioPoints) < 1e-8) return
    preserveGraphsDuringScenarioUpdateRef.current = true
    setPricingScenarioPoints(normalized)
    setPendingGraphUpdate(true)
  }

  const changeMetric = nextMetric => {
    if (Math.abs(normalizedPricingScenarioPoints) > 1e-8) {
      preserveGraphsDuringScenarioUpdateRef.current = true
      setPricingScenarioPoints(0)
      setPendingGraphUpdate(true)
    }
    setMetric(nextMetric)
  }

  const loadSavedPosition = event => {
    const saved = savedPositions.find(item => String(item.id) === event.target.value)
    if (!saved) return
    setSelectedTemplateId('')
    preserveGraphsDuringScenarioUpdateRef.current = false
    setAnalysisScope('position')
    setResult(null)
    setError('')
    setAppliedRequest(null)
    setPendingGraphUpdate(false)
    setInitializedRequestKeys([])
    onLoadSavedPosition?.(saved)
  }

  const hasPendingChanges = Boolean(
    pendingGraphUpdate
    || (appliedRequest && (!draftRequest || appliedRequest.signature !== draftRequest.signature)),
  )
  const updateDisabled = loading || pendingGraphUpdate || marketLoading || (
    positionMode ? !positionOptionLegs.length : chainLoading || !expirations?.length || !spot
  )

  useEffect(() => {
    if (!appliedRequest) {
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    setLoading(true)
    setError('')
    if (!preserveGraphsDuringScenarioUpdateRef.current) setResult(null)
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/options/greek-surface`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(appliedRequest.payload),
      })
        .then(async response => {
          let data
          try {
            data = await response.json()
          } catch {
            throw new Error(`Greek surface request failed (${response.status})`)
          }
          if (!response.ok || data?.error) throw new Error(data?.error || `Greek surface request failed (${response.status})`)
          setResult(data)
        })
        .catch(requestError => {
          if (requestError.name !== 'AbortError') setError(requestError.message)
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            preserveGraphsDuringScenarioUpdateRef.current = false
            setLoading(false)
          }
        })
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [appliedRequest])

  const theme = chartTheme(isDark)
  const plotColors = useMemo(() => {
    if (typeof window === 'undefined') return { accent: '#7ecfff', warning: '#f0b429', positive: '#35c98b', negative: '#f45b69' }
    const styles = window.getComputedStyle(document.documentElement)
    return {
      accent: styles.getPropertyValue('--accent-bright').trim() || '#7ecfff',
      warning: styles.getPropertyValue('--warning-money').trim() || '#f0b429',
      positive: styles.getPropertyValue('--pos').trim() || '#35c98b',
      negative: styles.getPropertyValue('--neg').trim() || '#f45b69',
    }
  }, [isDark])

  const metricMeta = result?.metrics?.[metric] || DEFAULT_METRIC_META[metric]
  const greekScenarioActive = pricingScenarioActive
  const pricingScenarioUnit = pricingScenarioKind === 'rate' ? 'rate points' : 'IV points'
  const pricingScenarioLabel = `${normalizedPricingScenarioPoints > 0 ? '+' : normalizedPricingScenarioPoints < 0 ? '−' : ''}${Math.abs(normalizedPricingScenarioPoints).toFixed(pricingScenarioKind === 'rate' ? 2 : 1)} ${pricingScenarioUnit}`
  const plottedMetricLabel = positionMode ? `Net position ${metricMeta.label} (signed)` : metricMeta.label
  const plottedMetricAxisTitle = positionMode && metricMeta.unit
    ? `${plottedMetricLabel} · ${metricMeta.unit}`
    : metricMeta.unit || plottedMetricLabel
  const plottedColorbarLabel = positionMode ? `Net ${metricMeta.label}<br>(signed)` : metricMeta.label
  const rawProfileValues = result?.profile?.values?.[metric] || []
  const rawSurfaceValues = result?.surface?.values?.[metric] || []
  const rawSelectedValue = result?.selected_point?.[metric]
  const profileValues = rawProfileValues
  const surfaceValues = rawSurfaceValues
  const selectedValue = rawSelectedValue
  const greekScenarioSuffix = pricingScenarioActive
    ? `<br><span style="font-size:11px">Scenario: ${pricingScenarioLabel}</span>`
    : ''
  const greekCurrentSummary = pricingScenarioActive
    ? `${plottedMetricLabel} ${formatGreek(selectedValue)} (${pricingScenarioLabel})`
    : `${plottedMetricLabel} ${formatGreek(selectedValue)}`
  const resultMatchesScope = Boolean(result)
    && Boolean(result?.assumptions?.position_mode) === positionMode
  const strike = Number(selectedContract?.strike || 0)
  const distancePct = spot && strike ? Math.abs(strike / spot - 1) * 100 : 0
  const isAtm = distancePct <= 0.5
  const isItm = optionType === 'CALL' ? strike < spot : strike > spot
  const moneyness = isAtm ? 'ATM' : `${distancePct.toFixed(1)}% ${isItm ? 'ITM' : 'OTM'}`
  const displayedStrikes = positionMode
    ? result?.assumptions?.position_strikes || []
    : strike ? [strike] : []
  const scopeLabel = positionMode ? (positionName || 'Active position') : `${ticker} ${money(strike)} ${optionType}`
  const relationshipResult = result?.relationship
  const traceDefinition = chartView === 'relationships'
    ? relationshipDefinition
    : GREEK_RELATIONSHIPS.find(item => item.id === metric) || GREEK_VALUE_TRACES[metric] || null
  const traceShock = chartView === 'relationships'
    ? effectiveRelationshipShock
    : traceDefinition?.defaultShock ?? 1
  const traceShockText = traceDefinition ? formatRelationshipShock(traceDefinition, traceShock) : ''
  const tracedUnderlying = linkedSpot == null ? spot : Number(linkedSpot)

  // Current-value P/L curve + expiration payoff, aligned to the profile price grid
  // so a spot traced on the Greek chart maps onto the same underlying here. Delta
  // is the slope of the current-value curve and gamma its curvature, so the traced
  // readout draws a delta tangent and a gamma second-order arc at the cursor.
  const riskModel = useMemo(() => {
    if (!resultMatchesScope || !result?.profile?.spots?.length || !spot) return null
    // Choose the days-to-expiration slice. null (default) = today = the full
    // analysis horizon; a smaller value walks time toward expiration.
    const surfaceDtes = (result.surface?.dtes || []).map(Number).filter(Number.isFinite)
    const maxSliceDte = surfaceDtes.length ? surfaceDtes[surfaceDtes.length - 1] : Number(result.selected_point?.dte) || 0
    const minSliceDte = surfaceDtes.length ? surfaceDtes[0] : maxSliceDte
    const resolvedDte = analysisDte == null ? maxSliceDte : Math.min(maxSliceDte, Math.max(minSliceDte, analysisDte))
    const atToday = !surfaceDtes.length || Math.abs(resolvedDte - maxSliceDte) < 0.5

    // Full-resolution profile at today; otherwise slice the price/time surface.
    const spots = (atToday ? result.profile.spots : (result.surface?.spots || [])).map(Number).filter(Number.isFinite)
    if (spots.length < 2) return null
    const low = spots[0]
    const high = spots[spots.length - 1]
    if (!(high > low)) return null
    const valueScale = positionMode ? 1 : 100
    const greekProfiles = Object.fromEntries(Object.keys(DEFAULT_METRIC_META).map(metricId => {
      const values = atToday
        ? (result.profile.values?.[metricId] || [])
        : (interpSurfaceRow(result.surface?.values?.[metricId], surfaceDtes, resolvedDte) || [])
      return [metricId, values]
    }))
    const deltaProfile = greekProfiles.delta || []
    const gammaProfile = greekProfiles.gamma || []
    const valueProfile = atToday ? (result.profile.value || []) : (interpSurfaceRow(result.surface?.value, surfaceDtes, resolvedDte) || [])
    const hasValue = valueProfile.length === spots.length

    let baseline = 0
    let strikes = []
    let payoffExpiration

    if (positionMode) {
      const optionLegs = positionLegs.filter(leg => String(leg.opt_type || '').toUpperCase() !== 'STOCK')
      strikes = [...new Set(optionLegs.map(leg => Number(leg.strike)).filter(value => value > 0))].sort((a, b) => a - b)
      baseline = positionLegs.reduce((total, leg) => {
        const side = String(leg.side || 'BUY').toUpperCase() === 'SELL' ? -1 : 1
        const qty = Math.max(1, Number(leg.qty) || 1)
        const entry = Number(leg.entry_price) || 0
        const type = String(leg.opt_type || '').toUpperCase()
        return total + (type === 'STOCK' ? side * qty * entry : side * qty * 100 * entry)
      }, 0)
      payoffExpiration = scenarioSpot => positionLegs.reduce((total, leg) => {
        const side = String(leg.side || 'BUY').toUpperCase() === 'SELL' ? -1 : 1
        const qty = Math.max(1, Number(leg.qty) || 1)
        const entry = Number(leg.entry_price) || 0
        const type = String(leg.opt_type || '').toUpperCase()
        if (type === 'STOCK') return total + side * qty * (scenarioSpot - entry)
        const strikeValue = Number(leg.strike) || 0
        const intrinsic = type === 'PUT' ? Math.max(strikeValue - scenarioSpot, 0) : Math.max(scenarioSpot - strikeValue, 0)
        return total + side * qty * 100 * (intrinsic - entry)
      }, 0)
    } else {
      const contractStrike = Number(result.assumptions?.strike) || strike || 0
      baseline = Number(result.selected_point?.value)
      if (!Number.isFinite(baseline)) baseline = 0
      if (contractStrike > 0) strikes = [contractStrike]
      const isPut = optionType === 'PUT'
      payoffExpiration = scenarioSpot => {
        const intrinsic = isPut ? Math.max(contractStrike - scenarioSpot, 0) : Math.max(scenarioSpot - contractStrike, 0)
        return valueScale * (intrinsic - baseline)
      }
    }

    const currentPnl = hasValue
      ? spots.map((_, index) => {
          const raw = Number(valueProfile[index])
          return Number.isFinite(raw) ? valueScale * (raw - baseline) : null
        })
      : null

    const gridCount = 241
    const expSpots = Array.from({ length: gridCount }, (_, index) => low + ((high - low) * index) / (gridCount - 1))
    const expPnl = expSpots.map(payoffExpiration)

    const breakEvens = []
    for (let index = 0; index < expSpots.length - 1; index += 1) {
      const y0 = expPnl[index]
      const y1 = expPnl[index + 1]
      if (Math.abs(y0) < 1e-8) breakEvens.push(expSpots[index])
      else if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) {
        const ratio = Math.abs(y0) / (Math.abs(y0) + Math.abs(y1))
        breakEvens.push(expSpots[index] + (expSpots[index + 1] - expSpots[index]) * ratio)
      }
    }
    const minSep = Math.max(0.01, spot * 0.0005)
    const uniqueBreakEvens = breakEvens.filter((value, index, values) => (
      index === 0 || Math.abs(value - values[index - 1]) > minSep
    )).slice(0, 6)

    const optionExpirations = positionMode
      ? [...new Set(positionLegs.filter(leg => String(leg.opt_type || '').toUpperCase() !== 'STOCK').map(leg => leg.expiration).filter(Boolean))]
      : [selectedExpiration].filter(Boolean)

    return {
      spots,
      low,
      high,
      valueScale,
      hasValue,
      greekProfiles,
      deltaProfile,
      gammaProfile,
      currentPnl,
      expSpots,
      expPnl,
      strikes,
      strikePnl: strikes.map(payoffExpiration),
      breakEvens: uniqueBreakEvens,
      currentSpotExpPnl: payoffExpiration(spot),
      currentSpotValuePnl: hasValue ? interpolateAt(spots, currentPnl, spot) : null,
      dteLabel: Math.round(resolvedDte),
      minSliceDte,
      maxSliceDte,
      resolvedDte,
      atToday,
      surfaceDtes,
      expirationLabel: optionExpirations.length === 1 ? formatExpiration(optionExpirations[0]) : 'Mixed expirations · terminal reference',
    }
  }, [resultMatchesScope, result, positionMode, positionLegs, spot, optionType, strike, selectedExpiration, analysisDte])

  // Build a local risk-curve explanation at the traced price. The base tangent
  // shows Delta, the base bend shows Gamma, and the selected higher-order Greek
  // changes the slope, curvature, or volatility-value shift for its standard
  // relationship shock.
  const linkedReadout = useMemo(() => {
    if (!riskModel?.hasValue || linkedSpot == null) return null
    const x = Number(linkedSpot)
    if (!Number.isFinite(x) || x < riskModel.low || x > riskModel.high) return null
    const deltaAt = interpolateAt(riskModel.spots, riskModel.deltaProfile, x)
    const gammaAt = interpolateAt(riskModel.spots, riskModel.gammaProfile, x)
    const pnlAt = interpolateAt(riskModel.spots, riskModel.currentPnl, x)
    if (!Number.isFinite(pnlAt) || !Number.isFinite(deltaAt)) return null

    const driverId = traceDefinition?.driver || metric
    const targetId = traceDefinition?.target || null
    const driverAt = interpolateAt(riskModel.spots, riskModel.greekProfiles?.[driverId], x)
    const targetAt = targetId
      ? interpolateAt(riskModel.spots, riskModel.greekProfiles?.[targetId], x)
      : null
    const shock = Number(traceShock) || 0
    const projectedTarget = Number.isFinite(driverAt) && Number.isFinite(targetAt)
      ? targetAt + driverAt * shock
      : null

    let exactTarget = null
    const relationshipMatchesTrace = Boolean(
      traceDefinition
      && relationshipResult?.id === traceDefinition.id
      && Math.abs(Number(relationshipResult?.shock) - shock) < 1e-8,
    )
    if (relationshipMatchesTrace) {
      if (riskModel.atToday) {
        exactTarget = interpolateAt(result?.profile?.spots, relationshipResult?.profile?.exact, x)
      } else {
        const exactChange = interpSurfaceRow(
          relationshipResult?.surface?.exact_change,
          riskModel.surfaceDtes,
          riskModel.resolvedDte,
        )
        const exactChangeAt = interpolateAt(riskModel.spots, exactChange, x)
        if (Number.isFinite(targetAt) && Number.isFinite(exactChangeAt)) exactTarget = targetAt + exactChangeAt
      }
    }

    const scale = riskModel.valueScale
    const slope = scale * deltaAt
    const curvature = Number.isFinite(gammaAt) ? scale * gammaAt : 0
    const half = Math.max((riskModel.high - riskModel.low) * 0.075, x * 0.015)
    const lowX = Math.max(riskModel.low, x - half)
    const highX = Math.min(riskModel.high, x + half)
    const tangentX = [lowX, highX]
    const tangentY = tangentX.map(px => pnlAt + slope * (px - x))
    const arcCount = 41
    const arcX = Array.from({ length: arcCount }, (_, index) => lowX + ((highX - lowX) * index) / (arcCount - 1))
    const arcY = arcX.map(px => pnlAt + slope * (px - x) + 0.5 * curvature * (px - x) * (px - x))

    let scenarioX = x
    let scenarioPnl = pnlAt
    if (traceDefinition?.shockKind === 'price') {
      scenarioX = Math.min(riskModel.high, Math.max(riskModel.low, x + shock))
      const priceMove = scenarioX - x
      const speedAt = interpolateAt(riskModel.spots, riskModel.greekProfiles?.speed, x)
      scenarioPnl += scale * (
        deltaAt * priceMove
        + 0.5 * (Number(gammaAt) || 0) * priceMove * priceMove
        + (driverId === 'speed' && Number.isFinite(speedAt) ? speedAt * priceMove ** 3 / 6 : 0)
      )
    } else if (traceDefinition?.shockKind === 'volatility') {
      const vegaAt = interpolateAt(riskModel.spots, riskModel.greekProfiles?.vega, x)
      const vommaAt = interpolateAt(riskModel.spots, riskModel.greekProfiles?.vomma, x)
      scenarioPnl += scale * ((Number(vegaAt) || 0) * shock + 0.5 * (Number(vommaAt) || 0) * shock * shock)
    } else if (traceDefinition?.shockKind === 'time') {
      const thetaAt = interpolateAt(riskModel.spots, riskModel.greekProfiles?.theta, x)
      scenarioPnl += scale * (Number(thetaAt) || 0) * shock
    } else if (traceDefinition?.shockKind === 'rate') {
      const rhoAt = interpolateAt(riskModel.spots, riskModel.greekProfiles?.rho, x)
      scenarioPnl += scale * (Number(rhoAt) || 0) * shock
    }

    const effectLow = Math.max(riskModel.low, scenarioX - half)
    const effectHigh = Math.min(riskModel.high, scenarioX + half)
    let effectX = Array.from({ length: arcCount }, (_, index) => effectLow + ((effectHigh - effectLow) * index) / (arcCount - 1))
    const scenarioDelta = interpolateAt(riskModel.spots, riskModel.deltaProfile, scenarioX)
    const scenarioGamma = interpolateAt(riskModel.spots, riskModel.gammaProfile, scenarioX)
    const effectSlope = scale * (
      targetId === 'delta' && Number.isFinite(projectedTarget) ? projectedTarget : Number(scenarioDelta ?? deltaAt)
    )
    const effectCurvature = scale * (
      targetId === 'gamma' && Number.isFinite(projectedTarget) ? projectedTarget : Number(scenarioGamma ?? gammaAt ?? 0)
    )
    let effectY = effectX.map(px => (
      scenarioPnl
      + effectSlope * (px - scenarioX)
      + 0.5 * effectCurvature * (px - scenarioX) * (px - scenarioX)
    ))

    if (traceDefinition?.valueEffect) {
      const driverProfile = riskModel.greekProfiles?.[driverId] || []
      const vommaProfile = traceDefinition.shockKind === 'volatility'
        ? riskModel.greekProfiles?.vomma || []
        : []
      effectX = riskModel.spots
      effectY = riskModel.currentPnl.map((basePnl, index) => {
        const base = Number(basePnl)
        const driver = Number(driverProfile[index])
        const vomma = Number(vommaProfile[index])
        if (!Number.isFinite(base) || !Number.isFinite(driver)) return null
        const secondOrder = traceDefinition.shockKind === 'volatility' && Number.isFinite(vomma)
          ? 0.5 * vomma * shock * shock
          : 0
        return base + scale * (driver * shock + secondOrder)
      })
    }

    let exactY = null
    if (Number.isFinite(exactTarget) && (targetId === 'delta' || targetId === 'gamma')) {
      const exactSlope = scale * (targetId === 'delta' ? exactTarget : Number(scenarioDelta ?? deltaAt))
      const exactCurvature = scale * (targetId === 'gamma' ? exactTarget : Number(scenarioGamma ?? gammaAt ?? 0))
      exactY = effectX.map(px => (
        scenarioPnl
        + exactSlope * (px - scenarioX)
        + 0.5 * exactCurvature * (px - scenarioX) * (px - scenarioX)
      ))
    }

    return {
      x,
      driverId,
      targetId,
      driverAt,
      targetAt,
      projectedTarget,
      exactTarget,
      shock,
      deltaAt,
      gammaAt,
      pnlAt,
      slope,
      curvature,
      tangentX,
      tangentY,
      arcX,
      arcY,
      scenarioX,
      scenarioPnl,
      scenarioPnlChange: scenarioPnl - pnlAt,
      effectX,
      effectY,
      exactY,
    }
  }, [riskModel, linkedSpot, traceDefinition, traceShock, metric, relationshipResult, result])
  const riskElapsedDays = riskModel ? Math.max(0, riskModel.maxSliceDte - riskModel.resolvedDte) : 0
  const selectedScenarioDte = riskModel?.resolvedDte ?? Number(result?.selected_point?.dte)
  const selectedScenarioLabel = riskModel?.atToday
    ? 'Today'
    : `Day ${riskElapsedDays.toFixed(riskElapsedDays % 1 ? 1 : 0)}`
  const linkedDriverMeta = linkedReadout
    ? result?.metrics?.[linkedReadout.driverId] || DEFAULT_METRIC_META[linkedReadout.driverId]
    : null
  const linkedTargetMeta = linkedReadout?.targetId
    ? result?.metrics?.[linkedReadout.targetId] || DEFAULT_METRIC_META[linkedReadout.targetId]
    : null
  const fullValueScenarioActive = false
  const currentValueScenarioActive = Boolean(pricingScenarioActive && riskModel?.hasValue)
  const currentValueScenarioLabel = `Position value at ${pricingScenarioLabel}`
  const displayedCurrentPnl = riskModel?.currentPnl
  const displayedCurrentSpotPnl = riskModel?.currentSpotValuePnl

  const riskData = riskModel ? [
    {
      x: riskModel.expSpots,
      y: riskModel.expPnl,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Expiration P/L',
      line: { color: plotColors.accent, width: 3 },
      marker: { color: 'rgba(0,0,0,0.001)', size: 12 },
      hovertemplate: '<b>Underlying %{x:$,.2f}</b><br>Expiration P/L: %{y:$,.2f}<extra></extra>',
    },
    ...(fullValueScenarioActive ? [{
      x: riskModel.spots,
      y: riskModel.currentPnl,
      type: 'scatter',
      mode: 'lines',
      name: `Actual value at ${riskModel.dteLabel} DTE`,
      line: { color: theme.title, width: 1.5, dash: 'dot' },
      connectgaps: false,
      hovertemplate: '<b>Underlying %{x:$,.2f}</b><br>Actual current-value P/L: %{y:$,.2f}<extra></extra>',
    }] : []),
    ...(riskModel.hasValue ? [{
      x: riskModel.spots,
      y: displayedCurrentPnl,
      type: 'scatter',
      mode: 'lines+markers',
      name: currentValueScenarioActive ? `Scenario value at ${riskModel.dteLabel} DTE` : `Value at ${riskModel.dteLabel} DTE`,
      line: { color: plotColors.positive, width: currentValueScenarioActive ? 3.5 : 2.5, dash: currentValueScenarioActive ? 'solid' : 'dash' },
      marker: { color: 'rgba(0,0,0,0.001)', size: 12 },
      connectgaps: false,
      hovertemplate: currentValueScenarioActive
        ? `<b>Underlying %{x:$,.2f}</b><br>${currentValueScenarioLabel}: %{y:$,.2f}<extra></extra>`
        : '<b>Underlying %{x:$,.2f}</b><br>Current-value P/L: %{y:$,.2f}<extra></extra>',
    }] : []),
    ...(linkedReadout ? [{
      x: linkedReadout.arcX,
      y: linkedReadout.arcY,
      type: 'scatter',
      mode: 'lines',
      name: 'Current Delta / Gamma shape',
      line: { color: theme.title, width: 2, dash: 'dot' },
      hoverinfo: 'skip',
    }, {
      x: linkedReadout.tangentX,
      y: linkedReadout.tangentY,
      type: 'scatter',
      mode: 'lines',
      name: 'Delta tangent',
      line: { color: theme.title, width: 2, dash: 'dash' },
      hoverinfo: 'skip',
    }, ...(traceDefinition ? [...(!fullValueScenarioActive ? [{
      x: linkedReadout.effectX,
      y: linkedReadout.effectY,
      type: 'scatter',
      mode: 'lines',
      name: `${traceDefinition.label} estimate`,
      line: { color: plotColors.warning, width: 3 },
      hoverinfo: 'skip',
    }] : []), ...(traceDefinition.valueEffect ? [{
      x: [linkedReadout.x, linkedReadout.x],
      y: [linkedReadout.pnlAt, linkedReadout.scenarioPnl],
      type: 'scatter',
      mode: 'lines+markers',
      name: `${traceDefinition.label} at traced price`,
      line: { color: plotColors.warning, width: 4 },
      marker: {
        color: [theme.title, plotColors.warning],
        size: [7, 11],
        symbol: ['circle-open', 'diamond'],
        line: { color: theme.surface, width: 1.5 },
      },
      hovertemplate: `<b>${traceDefinition.label}</b><br>Underlying %{x:$,.2f}<br>P/L: %{y:$,.2f}<extra></extra>`,
    }] : [])] : []), ...(linkedReadout.exactY ? [{
      x: linkedReadout.effectX,
      y: linkedReadout.exactY,
      type: 'scatter',
      mode: 'lines',
      name: 'Exact repriced Greek shape',
      line: { color: plotColors.positive, width: 2.5, dash: 'dot' },
      hoverinfo: 'skip',
    }] : []), ...(traceDefinition ? [{
      x: [linkedReadout.scenarioX],
      y: [linkedReadout.scenarioPnl],
      type: 'scatter',
      mode: 'markers',
      name: 'Greek shock estimate',
      marker: { color: plotColors.warning, size: 11, symbol: 'diamond', line: { color: theme.surface, width: 2 } },
      hovertemplate: `<b>${traceDefinition.label} estimate</b><br>Underlying %{x:$,.2f}<br>Estimated P/L: %{y:$,.2f}<extra></extra>`,
    }] : [])] : []),
    {
      x: riskModel.strikes,
      y: riskModel.strikePnl,
      type: 'scatter',
      mode: 'markers',
      name: 'Strikes',
      marker: { color: theme.zeroline, size: 7, symbol: 'circle', line: { color: theme.surface, width: 1 } },
      hovertemplate: '<b>Strike %{x:$,.2f}</b><br>Expiration P/L: %{y:$,.2f}<extra></extra>',
    },
    {
      x: riskModel.breakEvens,
      y: riskModel.breakEvens.map(() => 0),
      type: 'scatter',
      mode: 'markers',
      name: 'Break-even',
      marker: { color: plotColors.warning, size: 9, symbol: 'diamond', line: { color: theme.surface, width: 1 } },
      hovertemplate: '<b>Break-even %{x:$,.2f}</b><extra></extra>',
    },
    {
      x: [spot],
      y: [riskModel.hasValue ? displayedCurrentSpotPnl : riskModel.currentSpotExpPnl],
      type: 'scatter',
      mode: 'markers',
      name: 'Current spot',
      marker: { color: plotColors.warning, size: 11, symbol: 'x', line: { color: theme.surface, width: 1 } },
      hovertemplate: `<b>Current ${ticker} %{x:$,.2f}</b><br>P/L: %{y:$,.2f}<extra></extra>`,
    },
    ...(linkedReadout ? [{
      x: [linkedReadout.x],
      y: [fullValueScenarioActive ? linkedReadout.scenarioPnl : linkedReadout.pnlAt],
      type: 'scatter',
      mode: 'markers',
      name: 'Traced spot',
      marker: { color: plotColors.warning, size: 12, symbol: 'circle', line: { color: theme.surface, width: 2 } },
      hovertemplate: currentValueScenarioActive
        ? '<b>Traced %{x:$,.2f}</b><br>Scenario current-value P/L: %{y:$,.2f}<extra></extra>'
        : '<b>Traced %{x:$,.2f}</b><br>Current-value P/L: %{y:$,.2f}<extra></extra>',
    }] : []),
  ] : []

  const riskLayout = riskModel ? {
    height: chartOverview ? 270 : 360,
    margin: { l: 78, r: 24, t: 48, b: 58 },
    title: { text: `Expiration & current-value P/L · ${scopeLabel}${greekScenarioSuffix}`, x: 0.02, xanchor: 'left' },
    xaxis: { title: 'Underlying price ($)', tickprefix: '$', gridcolor: theme.grid, range: [riskModel.low, riskModel.high], autorange: false, showspikes: true, spikemode: 'across', spikecolor: plotColors.warning, spikethickness: 1 },
    yaxis: { title: 'Profit / loss ($)', tickprefix: '$', gridcolor: theme.grid, zeroline: true, zerolinecolor: theme.zeroline },
    showlegend: false,
    hovermode: 'x unified',
    hoverdistance: -1,
    spikedistance: -1,
    uirevision: `risk-${positionMode ? 'position' : 'single'}-${riskModel.strikes.join('-')}`,
    shapes: [
      ...riskModel.strikes.map(strikeValue => ({
        type: 'line', x0: strikeValue, x1: strikeValue, y0: 0, y1: 1, yref: 'paper',
        line: { color: theme.zeroline, width: 1, dash: 'dot' },
      })),
      ...(linkedReadout ? [{
        type: 'line', x0: linkedReadout.x, x1: linkedReadout.x, y0: 0, y1: 1, yref: 'paper',
        line: { color: plotColors.warning, width: 1.5, dash: 'dash' },
      }, ...(traceDefinition && Math.abs(linkedReadout.scenarioX - linkedReadout.x) > 1e-8 ? [{
        type: 'line', x0: linkedReadout.scenarioX, x1: linkedReadout.scenarioX, y0: 0, y1: 1, yref: 'paper',
        line: { color: plotColors.warning, width: 1, dash: 'dot' },
      }] : [])] : []),
    ],
    annotations: riskModel.breakEvens.map((breakEven, index) => ({
      x: breakEven, y: 0, text: `BE ${money(breakEven)}`, showarrow: false,
      yshift: index % 2 ? -14 : 14, font: { color: theme.font, size: 10 },
    })),
  } : {}

  const timeProfile = useMemo(() => {
    if (!result?.surface?.spots?.length || !result?.surface?.dtes?.length) return []
    return result.surface.dtes
      .map((dte, rowIndex) => ({
        dte: Number(dte),
        elapsed: Math.max(0, Number(result.selected_point.dte) - Number(dte)),
        value: interpolateAt(result.surface.spots, surfaceValues[rowIndex], tracedUnderlying),
      }))
      .sort((a, b) => a.elapsed - b.elapsed)
  }, [result, surfaceValues, tracedUnderlying])

  const showingTimeProfile = profileAxis === 'time'

  // Plotly's supported hover payload is event.points. Price-mode tracing locks
  // the scenario underlying; time-mode tracing walks the risk curve forward to
  // the hovered DTE. Keep the last trace after unhover so re-rendering the linked
  // risk graph cannot immediately erase the user's selection.
  const handleProfileHover = useCallback(event => {
    const point = event?.points?.find(item => item?.x != null || item?.customdata != null)
    if (!point) return
    if (showingTimeProfile) {
      const hoveredDte = Number(point.customdata ?? (Number(result?.selected_point?.dte) - Number(point.x)))
      if (Number.isFinite(hoveredDte)) setAnalysisDte(hoveredDte)
      setLinkedSpot(previous => previous == null ? spot : previous)
      return
    }
    const value = Number(point.x)
    if (Number.isFinite(value)) {
      setLinkedSpot(previous => Number.isFinite(previous) && Math.abs(previous - value) < 1e-8 ? previous : value)
    }
  }, [showingTimeProfile, result?.selected_point?.dte, spot])

  const handleRiskHover = useCallback(event => {
    const point = event?.points?.find(item => Number.isFinite(Number(item?.x)))
    if (!point) return
    setLinkedSpot(Number(point.x))
  }, [])

  const handleSurfaceHover = useCallback(event => {
    const point = event?.points?.find(item => Number.isFinite(Number(item?.x)))
    if (!point) return
    setLinkedSpot(Number(point.x))
    const hoveredDte = Number(point.y)
    if (Number.isFinite(hoveredDte)) setAnalysisDte(hoveredDte)
  }, [])

  // Plotly hover callbacks can be interrupted when a linked chart redraws. Read
  // the active x-axis directly from the pointer location as a stable fallback so
  // the shared cursor keeps moving even while the other plot is updating.
  const applyPointerTrace = useCallback(({ container, clientX, clientY, source }) => {
    const plot = container?.querySelector?.('.js-plotly-plot')
    const fullLayout = plot?._fullLayout
    const axis = source === 'profile' && chartView === 'relationships'
      ? fullLayout?.xaxis2 || fullLayout?.xaxis
      : fullLayout?.xaxis
    if (!plot || !axis || !Array.isArray(axis.range)) return

    const bounds = plot.getBoundingClientRect()
    if (clientY < bounds.top || clientY > bounds.bottom) return
    const axisOffset = Number(axis._offset)
    const axisLength = Number(axis._length)
    const relativeX = clientX - bounds.left - axisOffset
    if (!Number.isFinite(relativeX) || !Number.isFinite(axisLength) || axisLength <= 0 || relativeX < 0 || relativeX > axisLength) return

    const rangeStart = Number(axis.range[0])
    const rangeEnd = Number(axis.range[1])
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return
    const xValue = rangeStart + (relativeX / axisLength) * (rangeEnd - rangeStart)

    if (source === 'profile' && showingTimeProfile) {
      const selectedDte = Number(result?.selected_point?.dte)
      const hoveredDte = selectedDte - xValue
      if (Number.isFinite(hoveredDte)) {
        setAnalysisDte(previous => Number.isFinite(previous) && Math.abs(previous - hoveredDte) < 0.05 ? previous : hoveredDte)
      }
      setLinkedSpot(previous => previous == null ? spot : previous)
      return
    }

    setLinkedSpot(previous => Number.isFinite(previous) && Math.abs(previous - xValue) < 0.05 ? previous : xValue)
  }, [chartView, showingTimeProfile, result?.selected_point?.dte, spot])

  const handleChartPointerMove = useCallback((event, source) => {
    pendingPointerRef.current = {
      container: event.currentTarget,
      clientX: event.clientX,
      clientY: event.clientY,
      source,
    }
    if (pointerFrameRef.current != null) return
    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null
      const pending = pendingPointerRef.current
      pendingPointerRef.current = null
      if (pending) applyPointerTrace(pending)
    })
  }, [applyPointerTrace])

  useEffect(() => {
    setLinkedSpot(null)
  }, [positionMode, ticker])

  // A freshly calculated result re-anchors the risk graph to today; the user can
  // then walk time forward again with the slider.
  useEffect(() => {
    setAnalysisDte(null)
    const calculatedSpot = Number(result?.selected_point?.spot)
    if (Number.isFinite(calculatedSpot)) setLinkedSpot(calculatedSpot)
  }, [result])

  const profileX = showingTimeProfile ? timeProfile.map(point => point.elapsed) : riskModel?.spots || result?.profile?.spots || []
  const profileY = showingTimeProfile
    ? timeProfile.map(point => point.value)
    : riskModel?.greekProfiles?.[metric] || profileValues
  const currentProfileX = showingTimeProfile ? riskElapsedDays : result?.selected_point?.spot
  const currentProfileY = interpolateAt(profileX, profileY, currentProfileX)
  const tracedProfileY = !showingTimeProfile && linkedReadout
    ? interpolateAt(profileX, profileY, linkedReadout.x)
    : null

  const profileData = result ? [
    {
      x: profileX,
      y: profileY,
      customdata: showingTimeProfile ? timeProfile.map(point => point.dte) : undefined,
      type: 'scatter',
      mode: 'lines+markers',
      name: plottedMetricLabel,
      line: { color: plotColors.accent, width: 3 },
      marker: { color: 'rgba(0,0,0,0.001)', size: 14 },
      hovertemplate: showingTimeProfile
        ? `<b>Day %{x:.1f}</b><br>%{customdata:.1f} DTE<br>${plottedMetricLabel}: %{y:.6g}<extra></extra>`
        : `<b>Underlying %{x:$,.2f}</b><br>${plottedMetricLabel}: %{y:.6g}<extra></extra>`,
    },
    {
      x: [currentProfileX],
      y: [currentProfileY],
      customdata: showingTimeProfile ? [selectedScenarioDte] : undefined,
      type: 'scatter',
      mode: 'markers',
      name: showingTimeProfile ? selectedScenarioLabel : positionMode ? 'Current position' : 'Current spot',
      marker: { color: plotColors.warning, size: 10, symbol: 'diamond', line: { color: theme.surface, width: 2 } },
      hovertemplate: showingTimeProfile
        ? `<b>${selectedScenarioLabel} · underlying ${money(tracedUnderlying)}</b><br>%{customdata:.1f} DTE<br>${plottedMetricLabel}: %{y:.6g}<extra></extra>`
        : `<b>${positionMode ? scopeLabel : `Current ${ticker}`} · %{x:$,.2f}</b><br>${plottedMetricLabel}: %{y:.6g}<extra></extra>`,
    },
    ...(!showingTimeProfile && linkedReadout && Number.isFinite(tracedProfileY) ? [{
      x: [linkedReadout.x],
      y: [tracedProfileY],
      type: 'scatter',
      mode: 'markers',
      name: 'Linked risk price',
      marker: { color: plotColors.warning, size: 12, symbol: 'circle', line: { color: theme.surface, width: 2 } },
      hovertemplate: `<b>Linked risk price %{x:$,.2f}</b><br>${plottedMetricLabel}: %{y:.6g}<extra></extra>`,
    }] : []),
  ] : []

  const profileLayout = result ? {
    height: chartOverview ? 300 : 430,
    margin: { l: 72, r: 24, t: 52, b: 62 },
    title: {
      text: showingTimeProfile
        ? positionMode ? `${plottedMetricLabel} as time passes at ${money(tracedUnderlying)}${chartOverview ? '' : ` · ${scopeLabel}`}${greekScenarioSuffix}` : `${metricMeta.label} as time passes at ${money(tracedUnderlying)}`
        : positionMode ? `${plottedMetricLabel} across underlying price · ${riskModel?.dteLabel ?? effectiveDte} DTE${chartOverview ? '' : ` · ${scopeLabel}`}${greekScenarioSuffix}` : `${metricMeta.label} across underlying price · ${riskModel?.dteLabel ?? effectiveDte} DTE`,
      x: 0.02,
      xanchor: 'left',
    },
    xaxis: showingTimeProfile
      ? { title: 'Days elapsed from today', rangemode: 'tozero', gridcolor: theme.grid, showspikes: true, spikemode: 'across', spikecolor: plotColors.warning, spikethickness: 1 }
      : { title: 'Underlying price ($)', tickprefix: '$', gridcolor: theme.grid, showspikes: true, spikemode: 'across', spikecolor: plotColors.warning, spikethickness: 1 },
    yaxis: { title: plottedMetricAxisTitle, gridcolor: theme.grid, zeroline: true },
    showlegend: false,
    hovermode: 'x unified',
    hoverdistance: -1,
    spikedistance: -1,
    shapes: showingTimeProfile ? [{
      type: 'line', x0: currentProfileX, x1: currentProfileX, y0: 0, y1: 1, yref: 'paper',
      line: { color: plotColors.warning, width: 1.5, dash: 'dash' },
    }] : [
      ...displayedStrikes.map(profileStrike => ({
        type: 'line', x0: profileStrike, x1: profileStrike, y0: 0, y1: 1, yref: 'paper',
        line: { color: theme.zeroline, width: 1, dash: 'dot' },
      })),
      ...(linkedReadout ? [{
        type: 'line', x0: linkedReadout.x, x1: linkedReadout.x, y0: 0, y1: 1, yref: 'paper',
        line: { color: plotColors.warning, width: 1.5, dash: 'dash' },
      }] : []),
    ],
    annotations: showingTimeProfile ? [] : displayedStrikes.map((profileStrike, index) => ({
        x: profileStrike, y: 1 - (index % 2) * 0.07, yref: 'paper', text: positionMode ? money(profileStrike, 0) : `Strike ${money(profileStrike)}`,
        showarrow: false, yanchor: 'bottom', font: { color: theme.font, size: 10 },
      })),
  } : {}

  const selectedMetricSurfaceRow = interpSurfaceRow(surfaceValues, result?.surface?.dtes, selectedScenarioDte)
  const selectedMetricSurfaceValue = interpolateAt(result?.surface?.spots, selectedMetricSurfaceRow, tracedUnderlying)

  const surfaceData = result ? [
    {
      x: result.surface.spots,
      y: result.surface.dtes,
      z: surfaceValues,
      type: 'surface',
      name: plottedMetricLabel,
      colorscale: 'Viridis',
      colorbar: { title: { text: plottedColorbarLabel }, thickness: 14, len: 0.75 },
      hovertemplate: `<b>Underlying %{x:$,.2f}</b><br>DTE: %{y:.1f}<br>${plottedMetricLabel}: %{z:.6g}<extra></extra>`,
      contours: { z: { show: true, usecolormap: true, highlightcolor: plotColors.accent, project: { z: true } } },
    },
    {
      x: [tracedUnderlying],
      y: [selectedScenarioDte],
      z: [selectedMetricSurfaceValue ?? selectedValue],
      type: 'scatter3d',
      mode: 'markers',
      name: riskModel?.atToday ? (positionMode ? 'Current position' : 'Current contract') : 'Selected time',
      marker: { color: plotColors.warning, size: 5, symbol: 'diamond', line: { color: theme.surface, width: 1 } },
      hovertemplate: `<b>${selectedScenarioLabel} · ${positionMode ? scopeLabel : 'scenario'}</b><br>Underlying %{x:$,.2f}<br>DTE: %{y:.1f}<br>${plottedMetricLabel}: %{z:.6g}<extra></extra>`,
    },
  ] : []

  const surfaceLayout = result ? {
    height: chartOverview ? 310 : 540,
    margin: { l: 10, r: 16, t: 52, b: 16 },
    title: { text: positionMode ? `${plottedMetricLabel} through price and time${chartOverview ? '' : ` · ${scopeLabel}`}${greekScenarioSuffix}` : `${metricMeta.label} through price and time`, x: 0.02, xanchor: 'left' },
    showlegend: false,
    uirevision: `${ticker}-${optionType}-${strike}`,
    scene: {
      bgcolor: theme.surface,
      aspectmode: 'auto',
      camera: { eye: { x: 1.45, y: 1.5, z: 0.85 } },
      xaxis: { title: { text: 'Underlying price ($)' }, tickprefix: '$', color: theme.font, gridcolor: theme.grid, backgroundcolor: theme.surface },
      yaxis: { title: { text: 'Days to expiration' }, color: theme.font, gridcolor: theme.grid, backgroundcolor: theme.surface },
      zaxis: { title: { text: plottedMetricLabel }, color: theme.font, gridcolor: theme.grid, backgroundcolor: theme.surface },
    },
  } : {}

  const relationshipResultMatches = Boolean(
    resultMatchesScope
    && relationshipResult?.id === relationshipId
    && Math.abs(Number(relationshipResult?.shock) - effectiveRelationshipShock) < 1e-8,
  )
  const relationshipDriverMeta = result?.metrics?.[relationshipDefinition.driver] || DEFAULT_METRIC_META[relationshipDefinition.driver]
  const relationshipTargetMeta = result?.metrics?.[relationshipDefinition.target] || DEFAULT_METRIC_META[relationshipDefinition.target]
  const relationshipDriverLabel = positionMode ? `Net position ${relationshipDriverMeta.label} (signed)` : relationshipDriverMeta.label
  const relationshipTargetLabel = positionMode ? `Net position ${relationshipTargetMeta.label} (signed)` : relationshipTargetMeta.label
  const relationshipSubject = positionMode ? 'position' : 'contract'
  const relationshipCurrentLabel = `Current ${relationshipSubject} ${relationshipTargetMeta.label}`
  const relationshipProjectedLabel = `Second-order estimate · ${relationshipSubject} ${relationshipTargetMeta.label}`
  const relationshipExactLabel = `Exact repricing · ${relationshipSubject} ${relationshipTargetMeta.label}`
  const relationshipShockText = formatRelationshipShock(relationshipDefinition, relationshipResult?.shock ?? effectiveRelationshipShock)

  const relationshipTimeProfile = useMemo(() => {
    if (!relationshipResultMatches || !result?.surface?.spots?.length || !result?.surface?.dtes?.length) return []
    const baseSurface = result.surface.values?.[relationshipDefinition.target] || []
    return result.surface.dtes
      .map((dte, rowIndex) => {
        const base = interpolateAt(result.surface.spots, baseSurface[rowIndex], tracedUnderlying)
        const driver = interpolateAt(result.surface.spots, relationshipResult.surface?.driver?.[rowIndex], tracedUnderlying)
        const projectedChange = interpolateAt(result.surface.spots, relationshipResult.surface?.projected_change?.[rowIndex], tracedUnderlying)
        const exactChange = interpolateAt(result.surface.spots, relationshipResult.surface?.exact_change?.[rowIndex], tracedUnderlying)
        return {
          dte: Number(dte),
          elapsed: Math.max(0, Number(result.selected_point.dte) - Number(dte)),
          driver,
          base,
          projected: Number.isFinite(base) && projectedChange != null ? base + Number(projectedChange) : null,
          exact: Number.isFinite(base) && exactChange != null ? base + Number(exactChange) : null,
          projectedChange,
          exactChange,
        }
      })
      .sort((a, b) => a.elapsed - b.elapsed)
  }, [relationshipResultMatches, relationshipResult, result, relationshipDefinition.target, tracedUnderlying])

  const relationshipPriceProfile = useMemo(() => {
    if (!relationshipResultMatches) return null
    if (!riskModel || riskModel.atToday) {
      return {
        x: result?.profile?.spots || [],
        dtes: undefined,
        base: relationshipResult?.profile?.base || [],
        projected: relationshipResult?.profile?.projected || [],
        exact: relationshipResult?.profile?.exact || [],
        driver: relationshipResult?.profile?.driver || [],
        projectedChange: relationshipResult?.profile?.projected_change || [],
        exactChange: relationshipResult?.profile?.exact_change || [],
      }
    }
    const base = riskModel.greekProfiles?.[relationshipDefinition.target] || []
    const driver = riskModel.greekProfiles?.[relationshipDefinition.driver] || []
    const projectedChange = interpSurfaceRow(
      relationshipResult?.surface?.projected_change,
      riskModel.surfaceDtes,
      riskModel.resolvedDte,
    ) || []
    const exactChange = interpSurfaceRow(
      relationshipResult?.surface?.exact_change,
      riskModel.surfaceDtes,
      riskModel.resolvedDte,
    ) || []
    return {
      x: riskModel.spots,
      dtes: undefined,
      base,
      driver,
      projectedChange,
      exactChange,
      projected: base.map((value, index) => Number.isFinite(Number(value)) && Number.isFinite(Number(projectedChange[index])) ? Number(value) + Number(projectedChange[index]) : null),
      exact: base.map((value, index) => Number.isFinite(Number(value)) && Number.isFinite(Number(exactChange[index])) ? Number(value) + Number(exactChange[index]) : null),
    }
  }, [relationshipResultMatches, relationshipResult, result, riskModel, relationshipDefinition.target, relationshipDefinition.driver])

  const relationshipProfile = showingTimeProfile
    ? {
        x: relationshipTimeProfile.map(point => point.elapsed),
        dtes: relationshipTimeProfile.map(point => point.dte),
        base: relationshipTimeProfile.map(point => point.base),
        projected: relationshipTimeProfile.map(point => point.projected),
        exact: relationshipTimeProfile.map(point => point.exact),
        driver: relationshipTimeProfile.map(point => point.driver),
        projectedChange: relationshipTimeProfile.map(point => point.projectedChange),
        exactChange: relationshipTimeProfile.map(point => point.exactChange),
      }
    : relationshipPriceProfile || { x: [], dtes: undefined, base: [], projected: [], exact: [], driver: [], projectedChange: [], exactChange: [] }

  const relationshipCurrentPointX = showingTimeProfile
    ? riskElapsedDays
    : result?.selected_point?.spot
  const relationshipCurrentPointY = interpolateAt(relationshipProfile.x, relationshipProfile.base, relationshipCurrentPointX)
  const relationshipReferenceX = showingTimeProfile
    ? riskElapsedDays
    : linkedReadout?.x ?? result?.selected_point?.spot
  const relationshipReferenceValues = {
    base: interpolateAt(relationshipProfile.x, relationshipProfile.base, relationshipReferenceX),
    projected: interpolateAt(relationshipProfile.x, relationshipProfile.projected, relationshipReferenceX),
    exact: interpolateAt(relationshipProfile.x, relationshipProfile.exact, relationshipReferenceX),
  }
  const relationshipTraceX = !showingTimeProfile && linkedReadout ? linkedReadout.x : null
  const relationshipTraceBaseY = relationshipTraceX != null
    ? interpolateAt(relationshipProfile.x, relationshipProfile.base, relationshipTraceX)
    : null
  const relationshipTraceDriverY = relationshipTraceX != null
    ? interpolateAt(relationshipProfile.x, relationshipProfile.driver, relationshipTraceX)
    : null

  const relationshipProfileData = relationshipResultMatches ? [
    {
      x: relationshipProfile.x,
      y: relationshipProfile.base,
      customdata: relationshipProfile.dtes,
      type: 'scatter',
      mode: 'lines+markers',
      name: relationshipCurrentLabel,
      line: { color: theme.title, width: 3 },
      marker: { color: 'rgba(0,0,0,0.001)', size: 14 },
      hovertemplate: showingTimeProfile
        ? `<b>Day %{x:.1f} · %{customdata:.1f} DTE</b><br>Current ${relationshipTargetLabel}: %{y:.6g}<extra></extra>`
        : `<b>Underlying %{x:$,.2f}</b><br>Current ${relationshipTargetLabel}: %{y:.6g}<extra></extra>`,
    },
    {
      x: relationshipProfile.x,
      y: relationshipProfile.projected,
      customdata: relationshipProfile.dtes,
      type: 'scatter',
      mode: 'lines',
      name: relationshipProjectedLabel,
      line: { color: plotColors.accent, width: 3.5, dash: 'dash' },
      fill: 'tonexty',
      fillcolor: isDark ? 'rgba(126,207,255,.12)' : 'rgba(37,99,235,.10)',
      hovertemplate: showingTimeProfile
        ? `<b>Day %{x:.1f} · %{customdata:.1f} DTE</b><br>Estimated ${relationshipTargetLabel}: %{y:.6g}<extra></extra>`
        : `<b>Underlying %{x:$,.2f}</b><br>Estimated ${relationshipTargetLabel}: %{y:.6g}<extra></extra>`,
    },
    {
      x: relationshipProfile.x,
      y: relationshipProfile.exact,
      customdata: relationshipProfile.dtes,
      type: 'scatter',
      mode: 'lines',
      name: relationshipExactLabel,
      line: { color: plotColors.positive, width: 3, dash: 'dot' },
      hovertemplate: showingTimeProfile
        ? `<b>Day %{x:.1f} · %{customdata:.1f} DTE</b><br>Repriced ${relationshipTargetLabel}: %{y:.6g}<extra></extra>`
        : `<b>Underlying %{x:$,.2f}</b><br>Repriced ${relationshipTargetLabel}: %{y:.6g}<extra></extra>`,
    },
    {
      x: [relationshipCurrentPointX],
      y: [relationshipCurrentPointY],
      customdata: showingTimeProfile ? [selectedScenarioDte] : undefined,
      type: 'scatter',
      mode: 'markers',
      name: showingTimeProfile ? selectedScenarioLabel : 'Current spot',
      marker: { color: plotColors.warning, size: 9, symbol: 'diamond', line: { color: theme.surface, width: 1.5 } },
      hovertemplate: showingTimeProfile
        ? `<b>${selectedScenarioLabel} · %{customdata:.1f} DTE</b><br>${relationshipCurrentLabel}: %{y:.6g}<extra></extra>`
        : `<b>Current spot</b><br>${relationshipCurrentLabel}: %{y:.6g}<extra></extra>`,
    },
    {
      x: relationshipProfile.x,
      y: relationshipProfile.projectedChange,
      customdata: relationshipProfile.dtes,
      xaxis: 'x3',
      yaxis: 'y3',
      type: 'scatter',
      mode: 'lines',
      name: `Estimated Δ${relationshipTargetMeta.label}`,
      line: { color: plotColors.accent, width: 3, dash: 'dash' },
      hovertemplate: showingTimeProfile
        ? `<b>Day %{x:.1f} · %{customdata:.1f} DTE</b><br>Estimated Δ${relationshipTargetMeta.label}: %{y:.6g}<extra></extra>`
        : `<b>Underlying %{x:$,.2f}</b><br>Estimated Δ${relationshipTargetMeta.label}: %{y:.6g}<extra></extra>`,
    },
    {
      x: relationshipProfile.x,
      y: relationshipProfile.exactChange,
      customdata: relationshipProfile.dtes,
      xaxis: 'x3',
      yaxis: 'y3',
      type: 'scatter',
      mode: 'lines+markers',
      name: `Exact Δ${relationshipTargetMeta.label}`,
      line: { color: plotColors.positive, width: 2.75, dash: 'dot' },
      marker: { color: plotColors.positive, size: 4, symbol: 'circle-open', maxdisplayed: 16 },
      hovertemplate: showingTimeProfile
        ? `<b>Day %{x:.1f} · %{customdata:.1f} DTE</b><br>Exact Δ${relationshipTargetMeta.label}: %{y:.6g}<extra></extra>`
        : `<b>Underlying %{x:$,.2f}</b><br>Exact Δ${relationshipTargetMeta.label}: %{y:.6g}<extra></extra>`,
    },
    {
      x: relationshipProfile.x,
      y: relationshipProfile.driver,
      customdata: relationshipProfile.dtes,
      xaxis: 'x2',
      yaxis: 'y2',
      type: 'scatter',
      mode: 'lines+markers',
      name: relationshipDriverLabel,
      line: { color: plotColors.warning, width: 3 },
      marker: { color: 'rgba(0,0,0,0.001)', size: 14 },
      fill: 'tozeroy',
      fillcolor: isDark ? 'rgba(240,180,41,.10)' : 'rgba(178,106,0,.10)',
      hovertemplate: showingTimeProfile
        ? `<b>Day %{x:.1f} · %{customdata:.1f} DTE</b><br>${relationshipDriverLabel}: %{y:.6g}<extra></extra>`
        : `<b>Underlying %{x:$,.2f}</b><br>${relationshipDriverLabel}: %{y:.6g}<extra></extra>`,
    },
    ...(!showingTimeProfile && relationshipTraceX != null && Number.isFinite(relationshipTraceBaseY) ? [{
      x: [relationshipTraceX],
      y: [relationshipTraceBaseY],
      type: 'scatter',
      mode: 'markers',
      name: 'Linked first-order Greek',
      marker: { color: plotColors.warning, size: 12, symbol: 'circle', line: { color: theme.surface, width: 2 } },
      hovertemplate: `<b>Linked risk price %{x:$,.2f}</b><br>${relationshipCurrentLabel}: %{y:.6g}<extra></extra>`,
    }] : []),
    ...(!showingTimeProfile && relationshipTraceX != null && Number.isFinite(relationshipTraceDriverY) ? [{
      x: [relationshipTraceX],
      y: [relationshipTraceDriverY],
      xaxis: 'x2',
      yaxis: 'y2',
      type: 'scatter',
      mode: 'markers',
      name: 'Linked second-order Greek',
      marker: { color: plotColors.warning, size: 12, symbol: 'circle', line: { color: theme.surface, width: 2 } },
      hovertemplate: `<b>Linked risk price %{x:$,.2f}</b><br>${relationshipDriverLabel}: %{y:.6g}<extra></extra>`,
    }] : []),
  ] : []

  const relationshipProfileLayout = relationshipResultMatches ? {
    height: 500,
    margin: { l: 82, r: 24, t: 18, b: 62 },
    font: { color: theme.title },
    xaxis: {
      domain: [0, 1],
      anchor: 'y',
      matches: 'x2',
      showticklabels: false,
      gridcolor: theme.grid,
    },
    yaxis: {
      domain: [0.52, 1],
      title: relationshipTargetMeta.unit || relationshipTargetLabel,
      gridcolor: theme.grid,
      zeroline: true,
      zerolinecolor: theme.zeroline,
    },
    xaxis2: showingTimeProfile
      ? { domain: [0, 1], anchor: 'y2', title: 'Days elapsed from today', rangemode: 'tozero', gridcolor: theme.grid }
      : { domain: [0, 1], anchor: 'y2', title: 'Underlying price ($)', tickprefix: '$', gridcolor: theme.grid },
    yaxis2: {
      domain: [0, 0.14],
      title: relationshipDriverMeta.label,
      gridcolor: theme.grid,
      zeroline: true,
      zerolinecolor: theme.zeroline,
    },
    xaxis3: {
      domain: [0, 1],
      anchor: 'y3',
      matches: 'x2',
      showticklabels: false,
      gridcolor: theme.grid,
    },
    yaxis3: {
      domain: [0.25, 0.4],
      title: `Δ${relationshipTargetMeta.label}`,
      gridcolor: theme.grid,
      zeroline: true,
      zerolinecolor: theme.zeroline,
    },
    showlegend: false,
    hovermode: 'x unified',
    hoverdistance: -1,
    spikedistance: -1,
    uirevision: `relationship-profile-${relationshipId}-${positionMode}-${profileAxis}`,
    annotations: [
      {
        xref: 'paper', yref: 'paper', x: 0.012, y: 0.985,
        text: `1 · ${relationshipTargetMeta.label} level · current, estimated, and exact`,
        showarrow: false, xanchor: 'left', yanchor: 'top',
        bgcolor: isDark ? 'rgba(22,33,62,.86)' : 'rgba(255,255,255,.88)',
        borderpad: 4, font: { color: theme.title, size: 11 },
      },
      {
        xref: 'paper', yref: 'paper', x: 0.012, y: 0.398,
        text: `2 · Change in ${relationshipTargetMeta.label} · estimated vs exact`,
        showarrow: false, xanchor: 'left', yanchor: 'top',
        bgcolor: isDark ? 'rgba(22,33,62,.86)' : 'rgba(255,255,255,.88)',
        borderpad: 4, font: { color: theme.title, size: 11 },
      },
      {
        xref: 'paper', yref: 'paper', x: 0.012, y: 0.138,
        text: `3 · ${relationshipDriverMeta.label} · driver Greek`,
        showarrow: false, xanchor: 'left', yanchor: 'top',
        bgcolor: isDark ? 'rgba(22,33,62,.86)' : 'rgba(255,255,255,.88)',
        borderpad: 4, font: { color: theme.title, size: 11 },
      },
    ],
    shapes: showingTimeProfile ? [{
      type: 'line', xref: 'x2', x0: relationshipCurrentPointX, x1: relationshipCurrentPointX, y0: 0, y1: 1, yref: 'paper',
      line: { color: plotColors.warning, width: 1.5, dash: 'dash' },
    }] : [
      ...displayedStrikes.map(profileStrike => ({
        type: 'line', x0: profileStrike, x1: profileStrike, y0: 0, y1: 1, yref: 'paper',
        line: { color: theme.zeroline, width: 1, dash: 'dot' },
      })),
      ...(relationshipTraceX != null ? [{
        type: 'line', xref: 'x2', x0: relationshipTraceX, x1: relationshipTraceX, y0: 0, y1: 1, yref: 'paper',
        line: { color: plotColors.warning, width: 1.5, dash: 'dash' },
      }] : []),
    ],
  } : {}

  const selectedRelationshipProjectedRow = interpSurfaceRow(
    relationshipResult?.surface?.projected_change,
    result?.surface?.dtes,
    selectedScenarioDte,
  )
  const selectedRelationshipExactRow = interpSurfaceRow(
    relationshipResult?.surface?.exact_change,
    result?.surface?.dtes,
    selectedScenarioDte,
  )
  const selectedRelationshipProjectedValue = interpolateAt(result?.surface?.spots, selectedRelationshipProjectedRow, tracedUnderlying)
  const selectedRelationshipExactValue = interpolateAt(result?.surface?.spots, selectedRelationshipExactRow, tracedUnderlying)

  const relationshipSurfaceData = relationshipResultMatches ? [
    {
      x: result.surface.spots,
      y: result.surface.dtes,
      z: relationshipResult.surface.projected_change,
      customdata: relationshipResult.surface.exact_change,
      type: 'surface',
      name: `Estimated change in ${relationshipTargetMeta.label}`,
      colorscale: [[0, plotColors.negative], [0.5, theme.zeroline], [1, plotColors.positive]],
      zmid: 0,
      lighting: { ambient: 0.82, diffuse: 0.9, fresnel: 0.08, roughness: 0.45, specular: 0.25 },
      lightposition: { x: 120, y: 180, z: 240 },
      colorbar: { title: { text: `Estimated Δ${relationshipTargetMeta.label}` }, thickness: 14, len: 0.75 },
      hovertemplate: `<b>Underlying %{x:$,.2f}</b><br>DTE: %{y:.1f}<br>Second-order estimate: %{z:.6g}<br>Exact repriced change: %{customdata:.6g}<extra></extra>`,
      contours: { z: { show: true, usecolormap: true, highlightcolor: plotColors.accent, project: { z: true } } },
    },
    {
      x: [tracedUnderlying],
      y: [selectedScenarioDte],
      z: [selectedRelationshipProjectedValue ?? relationshipResult.selected?.projected_change],
      customdata: [selectedRelationshipExactValue ?? relationshipResult.selected?.exact_change],
      type: 'scatter3d',
      mode: 'markers',
      name: riskModel?.atToday ? (positionMode ? 'Current position' : 'Current contract') : 'Selected time',
      marker: { color: plotColors.warning, size: 5, symbol: 'diamond', line: { color: theme.surface, width: 1 } },
      hovertemplate: `<b>${selectedScenarioLabel} · ${positionMode ? scopeLabel : 'scenario'}</b><br>Underlying %{x:$,.2f}<br>DTE: %{y:.1f}<br>Estimated change: %{z:.6g}<br>Exact repriced change: %{customdata:.6g}<extra></extra>`,
    },
  ] : []

  const relationshipSurfaceLayout = relationshipResultMatches ? {
    height: 540,
    margin: { l: 10, r: 16, t: 76, b: 16 },
    font: { color: theme.title },
    title: {
      text: `${relationshipDefinition.label} impact through price and time<br><span style="font-size:11px;color:${theme.font}">${relationshipShockText} · ${scopeLabel}</span>`,
      x: 0.02,
      xanchor: 'left',
    },
    showlegend: false,
    uirevision: `relationship-surface-${relationshipId}-${positionMode}-${strike}`,
    scene: {
      bgcolor: theme.surface,
      aspectmode: 'auto',
      camera: { eye: { x: 1.45, y: 1.5, z: 0.85 } },
      xaxis: { title: { text: 'Underlying price ($)' }, tickprefix: '$', color: theme.title, gridcolor: theme.zeroline, backgroundcolor: theme.surface },
      yaxis: { title: { text: 'Days to expiration' }, color: theme.title, gridcolor: theme.zeroline, backgroundcolor: theme.surface },
      zaxis: { title: { text: `Estimated Δ${relationshipTargetMeta.label}` }, color: theme.title, gridcolor: theme.zeroline, backgroundcolor: theme.surface },
    },
  } : {}

  const activeGraphsCurrent = chartView === 'relationships' ? relationshipResultMatches : resultMatchesScope
  const relationshipCurrentSummary = relationshipResultMatches
    ? `${relationshipDriverMeta.label} ${formatGreek(relationshipResult.selected?.driver)} → estimated Δ${relationshipTargetMeta.label} ${formatSignedGreek(relationshipResult.selected?.projected_change)}`
    : 'Update graphs to calculate'

  return (
    <section className={`card opt-greek-workspace ${chartOverview ? 'is-chart-overview' : ''}`}>
      <div className="opt-section-heading opt-greek-heading">
        <div><span>Greek explorer</span><h2>Option Greeks in 2D and 3D</h2></div>
        <p>{positionMode
          ? 'Graph the signed Greek exposure of every included leg as price and time change.'
          : 'Enter the underlying ticker above, then choose a DTE and strike. No option symbol is required.'}</p>
      </div>

      <div className="opt-greek-view-tabs" role="tablist" aria-label="Greek chart groups">
        <button type="button" role="tab" aria-selected={chartView === 'charts'} className={chartView === 'charts' ? 'is-active' : ''} onClick={() => setChartView('charts')}>
          <strong>Greek Charts</strong><span>Individual 1st- and 2nd-order Greeks</span>
        </button>
        <button type="button" role="tab" aria-selected={chartView === 'relationships'} className={chartView === 'relationships' ? 'is-active' : ''} onClick={() => setChartView('relationships')}>
          <strong>Greek Relationships</strong><span>How a 2nd-order Greek changes a 1st-order Greek</span>
        </button>
      </div>

      <form className="opt-greek-controls" onSubmit={updateGraphs}>
        <div className="opt-greek-scope-control">
          <span>Analyze</span>
          <div role="group" aria-label="Greek analysis scope">
            <label className={`opt-greek-scope-choice ${analysisScope === 'single' ? 'is-active' : ''}`}><input type="radio" name="greek-analysis-scope" value="single" checked={analysisScope === 'single'} onChange={() => setAnalysisScope('single')} /><span>Single option</span></label>
            <label className={`opt-greek-scope-choice ${analysisScope === 'position' ? 'is-active' : ''}`}><input type="radio" name="greek-analysis-scope" value="position" checked={analysisScope === 'position'} onChange={() => setAnalysisScope('position')} /><span>Multi-leg ({positionLegs.length})</span></label>
          </div>
        </div>
        {chartView === 'charts' ? (
          <label className="opt-greek-metric-control"><span>Greek</span><select value={metric} onChange={event => changeMetric(event.target.value)}>{METRIC_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.metrics.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup>)}</select></label>
        ) : <>
          <label className="opt-greek-control-wide"><span>Relationship</span><select value={relationshipId} aria-label="Greek relationship" onChange={event => { const next = GREEK_RELATIONSHIPS.find(item => item.id === event.target.value) || GREEK_RELATIONSHIPS[0]; setRelationshipId(next.id); setRelationshipShock(next.defaultShock) }}>{GREEK_RELATIONSHIPS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><span>{relationshipDefinition.shockLabel}</span><div className="opt-suffix-input"><input type="number" min={relationshipShockMin} max={relationshipShockMax} step={relationshipDefinition.step} value={relationshipShock} onChange={event => setRelationshipShock(event.target.value)} onBlur={event => { const value = Number(event.target.value); const normalized = Number.isFinite(value) && value !== 0 ? Math.min(relationshipShockMax, Math.max(relationshipShockMin, value)) : relationshipDefinition.defaultShock; setRelationshipShock(normalized) }} aria-label={`${relationshipDefinition.shockLabel} for Greek relationship`} /><b>{relationshipDefinition.shockUnit}</b></div></label>
        </>}
        {positionMode && chartView === 'charts' && (
          <div className="opt-greek-exposure-control opt-greek-control-wide">
            <span>{pricingScenarioKind === 'rate' ? 'Risk-free rate scenario' : 'Implied volatility scenario'}</span>
            <div className="opt-greek-exposure-adjuster">
              <button type="button" onClick={() => updatePricingScenario(normalizedPricingScenarioPoints - pricingScenarioStep)} disabled={normalizedPricingScenarioPoints <= -pricingScenarioLimit} aria-label={`Decrease ${pricingScenarioKind === 'rate' ? 'risk-free rate' : 'implied volatility'} scenario`}>−</button>
              <input type="range" min={-pricingScenarioLimit} max={pricingScenarioLimit} step={pricingScenarioStep} value={normalizedPricingScenarioPoints} onChange={event => updatePricingScenario(event.target.value)} aria-label={`${pricingScenarioKind === 'rate' ? 'Risk-free rate' : 'Implied volatility'} scenario in points`} />
              <button type="button" onClick={() => updatePricingScenario(normalizedPricingScenarioPoints + pricingScenarioStep)} disabled={normalizedPricingScenarioPoints >= pricingScenarioLimit} aria-label={`Increase ${pricingScenarioKind === 'rate' ? 'risk-free rate' : 'implied volatility'} scenario`}>+</button>
              <output>{normalizedPricingScenarioPoints > 0 ? '+' : ''}{normalizedPricingScenarioPoints.toFixed(pricingScenarioKind === 'rate' ? 2 : 1)}</output>
            </div>
            <small>{pricingScenarioUnit} · reprices all Greeks and position value</small>
          </div>
        )}
        {positionMode && chartView === 'charts' && chartOverview && (
          <div className="opt-greek-overview-control">
            <span>Chart layout</span>
            <button type="button" className="btn btn-secondary" aria-pressed="true" onClick={() => setChartOverview(false)}>Exit all charts</button>
            <small>Press Esc to close</small>
          </div>
        )}
        <label className="opt-greek-axis-control"><span>2D graph</span><select value={profileAxis} onChange={event => setProfileAxis(event.target.value)} aria-label="Two-dimensional graph axis"><option value="price">Across price</option><option value="time">Across time</option></select></label>
        {positionMode && <label className="opt-greek-control-wide"><span>Saved position</span><select value={selectedPositionId == null ? '' : String(selectedPositionId)} onChange={loadSavedPosition} aria-label="Saved Greek position"><option value="">{savedPositions.length ? 'Choose a saved position…' : 'No saved positions'}</option>{savedPositions.map(item => <option key={item.id} value={String(item.id)}>{item.name} · {item.underlying} · {(item.legs || []).length} legs</option>)}</select></label>}
        {positionMode && <label className="opt-greek-control-wide"><span>Quick strategy</span><select value={selectedTemplateId} onChange={event => { const templateId = event.target.value; setSelectedTemplateId(templateId); if (templateId) onBuildPositionTemplate?.(templateId) }} aria-label="Quick multi-leg strategy"><option value="">Choose a template…</option><option value="iron-condor">Iron condor</option><option value="bull-put-credit">Bull put credit spread</option><option value="bear-call-credit">Bear call credit spread</option><option value="bull-call">Bull call debit spread</option><option value="bear-put">Bear put debit spread</option></select></label>}
        {!positionMode && <>
          <label><span>Target DTE</span><div className="opt-greek-dte"><input type="number" min="1" max="1095" value={targetDte} onChange={event => setTargetDte(event.target.value)} aria-label="Target days to expiration" /></div></label>
          <label><span>Option type</span><select value={optionType} onChange={event => setOptionType(event.target.value)}><option value="CALL">Call</option><option value="PUT">Put</option></select></label>
          <label><span>Chain area</span><select value={chainWindow} onChange={event => setChainWindow(event.target.value)}><option value="5">ATM ±5%</option><option value="10">ATM ±10%</option><option value="20">ATM ±20%</option><option value="40">ATM ±40%</option><option value="all">All strikes</option></select></label>
          <label><span>Contract strike</span><select value={selectedStrike} onChange={event => setSelectedStrike(event.target.value)} disabled={!contracts.length}>{contracts.map(contract => <option key={contract.strike} value={String(contract.strike)}>{money(contract.strike)} · IV {Number(contract.iv || 0) > 0 ? `${(Number(contract.iv) * 100).toFixed(1)}%` : '—'}</option>)}</select></label>
          <label><span>IV assumption</span><div className="opt-suffix-input"><input type="number" min="1" max="500" step="0.25" value={ivPct} onChange={event => setIvPct(event.target.value)} onBlur={event => setIvPct(Math.min(500, Math.max(1, Number(event.target.value) || 20)))} /><b>%</b></div></label>
        </>}
        <label><span>Underlying range</span><select value={priceRangePct} onChange={event => setPriceRangePct(event.target.value)}><option value="5">Current ±5%</option><option value="10">Current ±10%</option><option value="20">Current ±20%</option><option value="30">Current ±30%</option><option value="50">Current ±50%</option></select></label>
        <label><span>Pricing model</span><select value={model} onChange={event => onModelChange(event.target.value)}><option value="black-scholes">Black–Scholes</option><option value="bjerksund-stensland">Bjerksund–Stensland</option></select></label>
        <label><span>Risk-free rate</span><div className="opt-suffix-input"><input type="number" step="0.05" value={ratePct} onChange={event => onRateChange(event.target.value)} /><b>%</b></div></label>
        <div className="opt-greek-update-control">
          <button type="button" className="btn btn-primary" onClick={updateGraphs} disabled={updateDisabled}>{loading || pendingGraphUpdate ? 'Updating…' : 'Update graphs'}</button>
          <span aria-live="polite">{hasPendingChanges ? 'Parameters changed — update required.' : result ? 'Graphs are current.' : 'Ready to calculate.'}</span>
        </div>
      </form>

      {(marketLoading || (!positionMode && chainLoading)) && <div className="opt-loading-line"><span /> {positionMode ? 'Loading underlying market data…' : 'Loading the nearest listed expiration and option chain…'}</div>}
      {!positionMode && !marketLoading && !expirations?.length && <div className="opt-error">No listed option expirations are available for {ticker}.</div>}
      {!positionMode && !chainLoading && activeChain && !contracts.length && <div className="opt-error">No {optionType.toLowerCase()} strikes are available in this chain area. Widen the chain area to continue.</div>}
      {error && <div className="opt-error">{error}</div>}
      {hasPendingChanges && !pendingGraphUpdate && <div className="opt-greek-pending">Parameters changed. Select <strong>Update graphs</strong> to recalculate the 2D and 3D views.</div>}

      {positionMode && !positionOptionLegs.length && (
        <div className="opt-greek-position-empty">
          <strong>Build or load an option position first.</strong>
          <span>Choose a saved position above, build any combination of calls, puts, quantities, expirations, and shares, or use an optional spread template.</span>
          <div><button type="button" className="btn btn-primary" onClick={onEditPosition}>Build custom position</button></div>
        </div>
      )}

      {positionMode && positionOptionLegs.length ? (
        <div className="opt-greek-contract-strip" aria-label="Active option position">
          <span><small>Active position</small><strong>{positionName || `${ticker} position`}</strong></span>
          <span><small>Included legs</small><strong>{positionLegs.length} legs · {positionOptionLegs.length} options</strong></span>
          <span><small>Analysis horizon</small><strong>{effectiveDte} days · first expiration</strong></span>
          <span><small>{chartView === 'relationships' ? 'Relationship at current spot' : greekScenarioActive ? 'Greek scenario at current spot' : 'Greek at current spot'}</small><strong>{hasPendingChanges ? 'Update graphs to recalculate' : chartView === 'relationships' ? relationshipCurrentSummary : greekCurrentSummary}</strong></span>
        </div>
      ) : selectedContract && !positionMode && (
        <div className="opt-greek-contract-strip" aria-label="Selected option contract">
          <span><small>Selected contract</small><strong>{ticker} {formatExpiration(selectedExpiration)} {money(strike)} {optionType}</strong></span>
          <span><small>Listed expiration</small><strong>{actualDte} DTE · {formatExpiration(selectedExpiration)}</strong></span>
          <span><small>Chain location</small><strong>{moneyness}</strong></span>
          <span><small>{chartView === 'relationships' ? 'Relationship at current spot' : 'Greek at current spot'}</small><strong>{hasPendingChanges ? 'Update graphs to recalculate' : chartView === 'relationships' ? relationshipCurrentSummary : `${metricMeta.label} ${formatGreek(selectedValue)}`}</strong></span>
        </div>
      )}

      {positionMode && positionOptionLegs.length > 0 && (
        <div className="opt-greek-position-strikes">
          <div className="opt-greek-position-strikes-heading">
            <span><strong>Position strikes</strong><small>Choose the contract strike for each leg, then update the graphs.</small></span>
            <button type="button" className="btn btn-secondary" onClick={onEditPosition}>Change position</button>
          </div>
          <div className="opt-greek-position-strike-grid">
            {positionOptionLegs.map((leg, index) => {
              const choices = positionStrikeChoices[leg.id] || []
              const currentStrike = Number(leg.strike)
              const strikeInChoices = choices.some(value => Number(value) === currentStrike)
              const legName = `${String(leg.side).toUpperCase() === 'BUY' ? 'Long' : 'Short'} ${String(leg.opt_type).toLowerCase()}`
              return (
                <label key={leg.id || `${legName}-${index}`}>
                  <span>{legName}</span>
                  <select value={String(currentStrike)} onChange={event => onPositionStrikeChange?.(leg.id, event.target.value)} disabled={!choices.length} aria-label={`${legName} leg ${index + 1} strike`}>
                    {!strikeInChoices && <option value={String(currentStrike)}>{money(currentStrike)} · custom</option>}
                    {choices.map(value => <option key={value} value={String(value)}>{money(value)}</option>)}
                  </select>
                  <small>{Number(leg.qty) || 1} contract{Number(leg.qty) === 1 ? '' : 's'} · {formatExpiration(leg.expiration)}</small>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {(!positionMode || positionOptionLegs.length > 0) && (
        <div className="opt-greek-surfaces-section">
          <div className="opt-greek-surfaces-heading">
            <span><strong>{chartView === 'relationships' ? 'Greek relationship charts' : 'Greek graphs'}</strong><small>{chartView === 'relationships' ? `2D ${profileAxis === 'time' ? 'time' : 'price'} comparison and 3D first-order impact surface` : `2D ${profileAxis === 'time' ? 'time profile' : 'price profile'} and 3D price/time surface`}</small></span>
            <div className="opt-greek-surfaces-actions">
              <em>{loading ? 'Updating…' : hasPendingChanges ? 'Update required' : activeGraphsCurrent ? 'Current' : 'Waiting for data'}</em>
              {positionMode && chartView === 'charts' && <button type="button" className="btn btn-secondary" onClick={() => setChartOverview(true)}>Show all charts</button>}
            </div>
          </div>
          {chartView === 'relationships' ? (
            <div className="opt-greek-definition"><strong>{relationshipDefinition.label}</strong><span>{relationshipDriverMeta.description} The dashed line applies that local rate to the selected shock; the dotted line reprices the option or every position leg at the shocked assumption.</span>{positionMode && <span>All values are the signed total across the included legs, so opposing exposures can offset.</span>}<em>{relationshipShockText}</em></div>
          ) : metricMeta?.description && <div className="opt-greek-definition"><strong>{plottedMetricLabel}</strong><span>{metricMeta.description}</span>{positionMode && <span>{metric === 'vega' ? 'Negative Vega means net short volatility exposure; positive Vega means net long volatility exposure.' : 'Position values are the signed total across every included leg.'}</span>}<em>{metricMeta.unit}</em></div>}
          {greekScenarioActive && (
            <div className="opt-greek-scenario-note" role="status">
              <strong>{pricingScenarioLabel} scenario</strong>
              <span>{pricingScenarioKind === 'rate'
                ? 'The entire position is repriced at the shifted risk-free rate, recalculating every Greek together.'
                : 'Every option leg is repriced after shifting its IV, recalculating every Greek together. For a net-short-Vega position, a negative IV shift generally raises current value and a positive shift generally lowers it.'} The 2D profile, 3D surface, and green risk-graph price curve all use the same repriced scenario.</span>
              <button type="button" onClick={() => updatePricingScenario(0)}>Reset scenario</button>
            </div>
          )}
          {loading && <div className="opt-calculating">Building price and time surfaces…</div>}
          {activeGraphsCurrent ? (
            <div className={`opt-greek-chart-state ${hasPendingChanges ? 'is-stale' : ''}`}>
              {hasPendingChanges && <div className="opt-greek-chart-stale">Showing the previous Greek calculation. Select <strong>Update graphs</strong> to apply the changed parameters.</div>}
              <div className="opt-greek-chart-grid">
                <div className="opt-greek-chart" role="img" aria-label={chartView === 'relationships' ? `${relationshipDefinition.label} two-dimensional relationship comparison` : showingTimeProfile ? `${plottedMetricLabel} two-dimensional profile as time passes` : `${plottedMetricLabel} two-dimensional profile across underlying prices`} onPointerMoveCapture={event => handleChartPointerMove(event, 'profile')} onMouseMoveCapture={event => handleChartPointerMove(event, 'profile')} onClickCapture={event => handleChartPointerMove(event, 'profile')}>
                  {chartView === 'relationships' && (
                    <div className="opt-greek-relationship-chart-header">
                      <span><strong>{relationshipDefinition.label} · {scopeLabel}</strong><small>Effect of {relationshipShockText} · {showingTimeProfile ? `underlying held at ${money(tracedUnderlying)}` : `${riskModel?.dteLabel ?? effectiveDte} DTE`}</small></span>
                      <div className="opt-greek-relationship-legend" aria-label="Relationship chart series">
                        <span><i className="is-current" aria-hidden="true" />{relationshipCurrentLabel}</span>
                        <span><i className="is-projected" aria-hidden="true" />{relationshipProjectedLabel}</span>
                        <span><i className="is-exact" aria-hidden="true" />{relationshipExactLabel}</span>
                        <span><i className="is-driver" aria-hidden="true" />{relationshipDriverLabel}</span>
                      </div>
                      <div className="opt-greek-relationship-values" aria-label="Relationship values at the current spot">
                        <strong>{showingTimeProfile ? `${selectedScenarioLabel} at ${money(tracedUnderlying)} · ${riskModel?.dteLabel ?? effectiveDte} DTE` : `${linkedReadout ? `Traced ${money(relationshipReferenceX)}` : 'Current spot'} · ${riskModel?.dteLabel ?? effectiveDte} DTE`}</strong>
                        <span>{relationshipCurrentLabel}: {formatGreek(relationshipReferenceValues.base)}</span>
                        <span>{relationshipProjectedLabel}: {formatGreek(relationshipReferenceValues.projected)}</span>
                        <span>{relationshipExactLabel}: {formatGreek(relationshipReferenceValues.exact)}</span>
                      </div>
                    </div>
                  )}
                  <ThemedPlot data={chartView === 'relationships' ? relationshipProfileData : profileData} layout={chartView === 'relationships' ? relationshipProfileLayout : profileLayout} style={{ width: '100%', height: '100%' }} config={{ responsive: true, displaylogo: false }} onHover={handleProfileHover} onClick={handleProfileHover} useResizeHandler themeSurface />
                </div>
                <div className="opt-greek-chart opt-greek-chart-3d" role="img" aria-label={chartView === 'relationships' ? `${relationshipDefinition.label} three-dimensional projected impact across price and time` : `${plottedMetricLabel} three-dimensional surface across underlying price and days to expiration`}>
                  <ThemedPlot data={chartView === 'relationships' ? relationshipSurfaceData : surfaceData} layout={chartView === 'relationships' ? relationshipSurfaceLayout : surfaceLayout} style={{ width: '100%', height: '100%' }} config={{ responsive: true, displaylogo: false }} onHover={handleSurfaceHover} onClick={handleSurfaceHover} useResizeHandler themeSurface />
                </div>
              </div>
            </div>
          ) : !loading && (
            <div className="opt-greek-graphs-placeholder"><strong>{chartView === 'relationships' ? 'Greek relationship charts are ready to calculate.' : 'Greek graphs are being prepared.'}</strong><span>The 2D and 3D views will appear here. If parameters are waiting, select Update graphs.</span></div>
          )}
        </div>
      )}

      {riskModel && (
        <div className="opt-greek-risk-preview">
          <div className="opt-greek-risk-heading">
            <span><strong>Risk graph</strong><small>{riskModel.hasValue ? `Hover or click either chart to link the same underlying price. The time slider, 2D playhead, and 3D marker share the selected day while holding the underlying at ${money(tracedUnderlying)}.` : 'Select Update graphs to draw the current-value curve and enable Greek tracing.'}</small></span>
            <em>{riskModel.expirationLabel}</em>
          </div>
          {riskModel.hasValue && riskModel.maxSliceDte > riskModel.minSliceDte + 0.5 && (
            <div className="opt-greek-time-control">
              <label>
                <span>Time elapsed</span>
                <input
                  type="range"
                  min="0"
                  max={riskModel.maxSliceDte - riskModel.minSliceDte}
                  step="0.25"
                  value={riskElapsedDays}
                  onChange={event => setAnalysisDte(riskModel.maxSliceDte - Number(event.target.value))}
                  aria-label="Elapsed days for the risk-graph time slice"
                />
              </label>
              <div className="opt-greek-time-readout">
                <strong>{riskModel.atToday ? 'Today' : `${riskElapsedDays.toFixed(riskElapsedDays % 1 ? 1 : 0)} days forward`}</strong>
                <span>{riskModel.dteLabel} DTE · underlying held at {money(tracedUnderlying)}</span>
                {!riskModel.atToday && (
                  <button type="button" className="opt-greek-time-reset" onClick={() => setAnalysisDte(null)}>Reset to today</button>
                )}
              </div>
            </div>
          )}
          {riskModel.hasValue && (
            <div className="opt-greek-risk-readout" aria-live="polite">
              <div className="opt-greek-risk-legend" aria-hidden="true">
                <span><i style={{ background: plotColors.accent }} />Expiration P/L</span>
                {fullValueScenarioActive && <span><i style={{ background: theme.title }} />Actual value at {riskModel.dteLabel} DTE</span>}
                <span><i style={{ background: plotColors.positive }} />{currentValueScenarioActive ? currentValueScenarioLabel : `Value at ${riskModel.dteLabel} DTE`}</span>
                <span><i style={{ background: theme.title }} />Current Δ / Γ shape</span>
                {traceDefinition && <span><i style={{ background: plotColors.warning }} />{fullValueScenarioActive ? `${traceDefinition.label} at traced price` : `${traceDefinition.label} estimate`}</span>}
              </div>
              {linkedReadout ? (
                <div className="opt-greek-risk-trace">
                  <strong>{linkedDriverMeta?.label || 'Greek'} at {money(linkedReadout.x)}</strong>
                  <span>{linkedDriverMeta?.label || 'Value'} {formatSignedGreek(linkedReadout.driverAt)}</span>
                  {linkedTargetMeta && <span>{linkedTargetMeta.label} {formatSignedGreek(linkedReadout.targetAt)} → estimate {formatSignedGreek(linkedReadout.projectedTarget)}{Number.isFinite(linkedReadout.exactTarget) ? ` · exact ${formatSignedGreek(linkedReadout.exactTarget)}` : ''}</span>}
                  <span>Current P/L {signedMoney(linkedReadout.pnlAt)} · {traceShockText || `${riskModel.dteLabel} DTE`} · P/L change {signedMoney(linkedReadout.scenarioPnlChange)} · estimated P/L {signedMoney(linkedReadout.scenarioPnl)}</span>
                  <button type="button" className="opt-greek-trace-clear" onClick={() => setLinkedSpot(null)}>Clear trace</button>
                </div>
              ) : (
                <span className="opt-greek-risk-hint">Move across either the Greek or risk chart to link a scenario price; click to keep that trace while switching views.</span>
              )}
            </div>
          )}
          <div className="opt-greek-risk-chart" role="img" aria-label={`Expiration and current-value profit and loss risk graph for ${scopeLabel}`} onPointerMoveCapture={event => handleChartPointerMove(event, 'risk')} onMouseMoveCapture={event => handleChartPointerMove(event, 'risk')} onClickCapture={event => handleChartPointerMove(event, 'risk')}>
            <ThemedPlot data={riskData} layout={riskLayout} style={{ width: '100%', height: '100%' }} config={{ responsive: true, displaylogo: false }} onHover={handleRiskHover} onClick={handleRiskHover} useResizeHandler themeSurface />
          </div>
        </div>
      )}

      <details className="opt-greek-guide">
        <summary>Greek definitions &amp; chart behavior <span>{GREEK_GUIDE.length} Greeks</span></summary>
        <div className="opt-greek-guide-intro">
          <p><strong>How to read the graphs:</strong> Across price holds DTE, strike, and IV constant while the underlying moves. Across time holds the underlying at its current price and follows the Greek from today toward expiration. The 3D surface shows both dimensions together.</p>
          <p>These are typical long-option shapes under the selected pricing assumptions. A multi-leg position is the signed sum of its legs, so ridges can cancel, reinforce, or change sign around each strike.</p>
          <p className="opt-greek-guide-relationship"><strong>Relationship charts:</strong> The solid line is the current first-order Greek. The dashed line is the local second-order estimate after the selected price, time, or volatility shock, while the dotted line is a full repricing at that shocked assumption. A widening gap between the dashed and dotted lines shows where the local approximation is becoming less accurate.</p>
        </div>
        <div className="opt-greek-guide-table-wrap">
          <table className="opt-greek-guide-table">
            <thead><tr><th>Greek</th><th>What it measures</th><th>Why the graph behaves this way</th></tr></thead>
            <tbody>{GREEK_GUIDE.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.measures}</td><td>{item.behavior}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
