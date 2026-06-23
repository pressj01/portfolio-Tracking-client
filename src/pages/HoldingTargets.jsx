import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useCurrency } from '../context/CurrencyContext'
import { formatMoney } from '../utils/money'

const pct = value => `${Number(value || 0).toFixed(2)}%`
const shares = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })
const money = value => formatMoney(value, { zeroIfInvalid: true })
const readSettings = key => { try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} } }
// Record when each target was last set, so the screen can show "set 3 days ago"
// on a plan holding. Returns an updated targetUpdatedAt map (does not mutate).
const stampTargets = (prev, tickers) => {
  const at = { ...(prev.targetUpdatedAt || {}) }
  const now = Date.now()
  tickers.forEach(ticker => { at[ticker] = now })
  return at
}
const formatWhen = ms => {
  if (!ms) return null
  const absolute = new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const diff = Date.now() - ms
  const day = 86400000
  let relative
  if (diff < 60000) relative = 'just now'
  else if (diff < 3600000) relative = `${Math.floor(diff / 60000)} min ago`
  else if (diff < day) relative = `${Math.floor(diff / 3600000)} hr ago`
  else relative = `${Math.floor(diff / day)} day${Math.floor(diff / day) === 1 ? '' : 's'} ago`
  return `${absolute} (${relative})`
}

function equalTargets(category, categoryBudget) {
  const result = {}
  const subcategories = category.subcategories || []
  const targetedSubs = subcategories.filter(sub => sub.target_pct != null)
  if (!targetedSubs.length) {
    const each = category.tickers.length ? categoryBudget / category.tickers.length : 0
    category.tickers.forEach(row => { result[row.ticker] = each })
    return result
  }
  let usedSubPct = 0
  targetedSubs.forEach(sub => {
    const members = category.tickers.filter(row => row.subcategory_id === sub.id)
    const subPct = Math.max(0, Number(sub.target_pct || 0))
    usedSubPct += subPct
    const each = members.length ? categoryBudget * subPct / 100 / members.length : 0
    members.forEach(row => { result[row.ticker] = each })
  })
  const untargetedIds = new Set(subcategories.filter(sub => sub.target_pct == null).map(sub => sub.id))
  const remainderMembers = category.tickers.filter(row => row.subcategory_id == null || untargetedIds.has(row.subcategory_id))
  const remaining = categoryBudget * Math.max(0, 100 - usedSubPct) / 100
  const each = remainderMembers.length ? remaining / remainderMembers.length : 0
  remainderMembers.forEach(row => { result[row.ticker] = each })
  return result
}

function coverageLabel(coverage) {
  if (coverage == null) return 'New allocation'
  const difference = coverage - 100
  if (Math.abs(difference) < 0.01) return '100.00% · on target'
  return `${pct(coverage)} · ${pct(Math.abs(difference))} ${difference > 0 ? 'over' : 'under'}`
}

// Number inputs whose displayed value is recomputed from stored state (the
// percent ↔ dollar conversions) snap back on every keystroke, which erases a
// decimal point before the user can type the fraction (e.g. "3000." becomes
// "3000"). Buffer the raw text locally while the field is focused so typing —
// including "." and trailing digits — is never reformatted mid-entry, then
// resync to the canonical value on blur. Uses type="text"+inputMode="decimal"
// so the intermediate "3000." string is never rejected by a number input.
function DraftNumberInput({ value, onValueChange, ...rest }) {
  const [draft, setDraft] = useState(null)
  const display = draft == null ? (value ?? '') : draft
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={e => {
        const next = e.target.value
        if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
        setDraft(next)
        onValueChange(next)
      }}
      onBlur={e => { setDraft(null); rest.onBlur && rest.onBlur(e) }}
    />
  )
}

export default function HoldingTargets() {
  const pf = useProfileFetch()
  const { selection, currentProfileName, isAggregate } = useProfile()
  const { displayCurrency, usdToCadRate } = useCurrency()
  const storageKey = `portfolio_holdingTargets_${selection}`
  const [data, setData] = useState(null)
  const [settings, setSettings] = useState(() => readSettings(storageKey))
  const [globalTarget, setGlobalTarget] = useState('5')
  const [expanded, setExpanded] = useState({})
  const [cashPoolOpen, setCashPoolOpen] = useState(true)
  const [allocInputMode, setAllocInputMode] = useState('percent')
  const cashPoolRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Inline "add a comparison ETF" form state. Only one category's form is open
  // at a time, keyed by categoryId.
  const [addPanel, setAddPanel] = useState({ categoryId: null, ticker: '', subcategoryId: '', loading: false, error: '' })
  // Saved plans (per-ticker targets / equal-weight modes) persist in localStorage
  // but are NOT auto-applied. The screen opens showing live current weights —
  // no recommended trades — until the plan is explicitly loaded or the user
  // starts editing. planActive is session-only (resets on remount / portfolio
  // switch) so every visit starts from a clean current-weight baseline.
  const [planActive, setPlanActive] = useState(false)
  const autoBalance = settings.autoBalance !== false

  useEffect(() => {
    setSettings(readSettings(storageKey)); setLoading(true); setError(''); setPlanActive(false)
    pf('/api/categories/data')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load holdings.')))
      .then(result => { setData(result); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [pf, storageKey])
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(settings)) }, [settings, storageKey])

  const scenario = useMemo(() => {
    // Comparison ("hypothetical") holdings aren't owned, so they live only in
    // local settings. Inject them into their chosen category as zero-share /
    // zero-value rows shaped exactly like a real holding; the rest of the
    // scenario math, cash pool, and tables then treat them identically. Their
    // current_value is 0, so category actuals and portfolio totals are unchanged.
    const hypotheticals = settings.hypotheticals || []
    const baseCategories = (data?.categories || []).map(cat => {
      const extras = hypotheticals.filter(h => h.categoryId === cat.id).map(h => ({
        ticker: h.ticker,
        description: h.description,
        classification_type: 'HYPOTHETICAL',
        quantity: 0,
        current_price: Number(h.price) || 0,
        current_value: 0,
        monthly_income: 0,
        current_yield: Number(h.current_yield) || 0,
        div_frequency: h.div_frequency,
        subcategory_id: h.subcategoryId ?? null,
        hypothetical: true,
      }))
      return extras.length ? { ...cat, tickers: [...(cat.tickers || []), ...extras] } : cat
    })
    const unassigned = data?.unallocated || []
    // Fallback: surface every unassigned holding in a synthetic "Uncategorized"
    // group so users can set targets and use the cash pool without configuring
    // Categories first. Shaped exactly like a real category so the rest of the
    // scenario math, cash pool, and tables treat it identically.
    const uncategorizedValue = unassigned.reduce((sum, h) => sum + Number(h.current_value || 0), 0)
    const uncategorizedIncome = unassigned.reduce((sum, h) => sum + Number(h.monthly_income || 0), 0)
    const uncategorized = unassigned.length ? [{
      id: '__uncategorized__',
      name: 'Uncategorized',
      target_pct: null,
      sort_order: Number.MAX_SAFE_INTEGER,
      subcategories: [],
      tickers: unassigned.map(h => ({ ...h, subcategory_id: null })),
      actual_value: uncategorizedValue,
      actual_pct: data?.total_value > 0 ? uncategorizedValue / data.total_value * 100 : 0,
      monthly_income: uncategorizedIncome,
      current_yield: uncategorizedValue > 0 ? uncategorizedIncome * 12 / uncategorizedValue * 100 : 0,
    }] : []
    const drafts = [...baseCategories, ...uncategorized].filter(category => category.tickers?.length).map(category => {
      // When no plan is loaded, ignore saved modes/targets so every holding
      // resolves to its current weight (a clean, trade-free baseline).
      const mode = (planActive && settings.modes?.[category.id]) || 'custom'
      const categoryBudget = Number(category.target_pct ?? category.actual_pct ?? 0)
      const equal = equalTargets(category, categoryBudget)
      const subName = new Map((category.subcategories || []).map(sub => [sub.id, sub.name]))
      const rows = category.tickers.map(holding => {
        const currentPortfolioPct = data.total_value > 0 ? holding.current_value / data.total_value * 100 : 0
        const saved = planActive ? settings.targets?.[holding.ticker] : undefined
        const requestedTargetPct = mode === 'equal'
          ? Number(equal[holding.ticker] || 0)
          : (saved == null ? currentPortfolioPct : Number(saved))
        const price = Number(holding.current_price || (holding.quantity ? holding.current_value / holding.quantity : 0))
        return { ...holding, subcategoryName: subName.get(holding.subcategory_id) || 'Unclassified', currentPortfolioPct, requestedTargetPct, price }
      })
      return { ...category, categoryBudget, mode, rows }
    })

    const requestedTotal = drafts.flatMap(category => category.rows).reduce((sum, row) => sum + row.requestedTargetPct, 0)
    const balanceFactor = autoBalance && requestedTotal > 0 ? 100 / requestedTotal : 1
    const rollup = groupRows => ({
      currentValue: groupRows.reduce((sum, row) => sum + row.current_value, 0),
      targetValue: groupRows.reduce((sum, row) => sum + row.targetValue, 0),
      currentPct: groupRows.reduce((sum, row) => sum + row.currentPortfolioPct, 0),
      requestedTargetPct: groupRows.reduce((sum, row) => sum + row.requestedTargetPct, 0),
      adjustedTargetPct: groupRows.reduce((sum, row) => sum + row.adjustedTargetPct, 0),
      income: groupRows.reduce((sum, row) => sum + row.monthly_income, 0),
      incomeDelta: groupRows.reduce((sum, row) => sum + row.monthlyDelta, 0),
      count: groupRows.length,
    })

    const categories = drafts.map(category => {
      const rows = category.rows.map(row => {
        const rawTargetValue = Number(data.total_value || 0) * row.requestedTargetPct / 100
        const rawTradeValue = rawTargetValue - row.current_value
        const adjustedTargetPct = row.requestedTargetPct * balanceFactor
        const targetValue = Number(data.total_value || 0) * adjustedTargetPct / 100
        const tradeValue = targetValue - row.current_value
        const targetShares = row.price > 0 ? targetValue / row.price : row.quantity
        const tradeShares = targetShares - Number(row.quantity || 0)
        const monthlyDelta = tradeValue * Number(row.current_yield || 0) / 100 / 12
        return { ...row, rawTargetValue, rawTradeValue, adjustedTargetPct, targetValue, tradeValue, targetShares, tradeShares, monthlyDelta }
      })
      const subRows = (category.subcategories || []).map(sub => ({
        id: sub.id, name: sub.name, statedTarget: sub.target_pct,
        ...rollup(rows.filter(row => row.subcategory_id === sub.id)),
      })).filter(sub => sub.count > 0 || sub.statedTarget != null)
      const unclassified = rows.filter(row => row.subcategory_id == null)
      if (unclassified.length) subRows.push({ id: 'unclassified', name: 'Unclassified', statedTarget: null, ...rollup(unclassified) })
      const totals = rollup(rows)
      const coverage = category.categoryBudget > 0 ? totals.requestedTargetPct / category.categoryBudget * 100 : null
      return { ...category, rows, subRows, coverage, ...totals }
    })
    return { categories, requestedTotal, balanceFactor }
  }, [data, settings, autoBalance, planActive])

  const categories = scenario.categories
  const allRows = categories.flatMap(category => category.rows)
  const hypoCount = allRows.filter(row => row.hypothetical).length
  const ownedCount = allRows.length - hypoCount
  // Detect whether a saved plan exists and which holdings it actually moves off
  // their current weight. currentPortfolioPct is independent of planActive, so
  // this is a stable comparison regardless of whether the plan is applied.
  const currentPctByTicker = useMemo(() => {
    const map = {}
    allRows.forEach(row => { map[row.ticker] = row.currentPortfolioPct })
    return map
  }, [allRows])
  const planTickers = useMemo(() => {
    const targets = settings.targets || {}
    return Object.keys(targets).filter(ticker => {
      const value = targets[ticker]
      if (value === '' || value == null) return false
      const current = currentPctByTicker[ticker]
      if (current == null) return false
      return Math.abs(Number(value) - current) > 0.01
    }).sort()
  }, [settings.targets, currentPctByTicker])
  const equalModeCount = useMemo(() => Object.values(settings.modes || {}).filter(mode => mode === 'equal').length, [settings.modes])
  const hasSavedPlan = planTickers.length > 0 || equalModeCount > 0
  const planLastUpdated = useMemo(() => {
    const stamps = settings.targetUpdatedAt || {}
    const times = planTickers.map(ticker => stamps[ticker]).filter(Boolean)
    return times.length ? Math.max(...times) : null
  }, [planTickers, settings.targetUpdatedAt])
  const adjustedTotal = allRows.reduce((sum, row) => sum + row.adjustedTargetPct, 0)
  const tradeTotal = allRows.reduce((sum, row) => sum + row.tradeValue, 0)
  const incomeDelta = allRows.reduce((sum, row) => sum + row.monthlyDelta, 0)
  const selectedRecipients = new Set(settings.reallocationTickers || [])
  const saleProceeds = allRows.reduce((sum, row) => sum + Math.max(0, -row.rawTradeValue), 0)
  const plannedBuys = allRows.reduce((sum, row) => sum + Math.max(0, row.rawTradeValue), 0)
  const adjustedSaleProceeds = allRows.reduce((sum, row) => sum + Math.max(0, -row.tradeValue), 0)
  const adjustedPlannedBuys = allRows.reduce((sum, row) => sum + Math.max(0, row.tradeValue), 0)
  const availableSaleCash = Math.max(0, saleProceeds - plannedBuys)
  const recipientRows = allRows.filter(row => selectedRecipients.has(row.ticker) && row.rawTradeValue > -0.5)
  const manualAllocations = settings.manualAllocations || {}
  const displayRate = displayCurrency === 'CAD' ? Number(usdToCadRate || 1) : 1
  const allocationDollars = recipientRows.map(row => Math.max(0, Number(manualAllocations[row.ticker] || 0)))
  const allocationTotal = allocationDollars.reduce((sum, amount) => sum + amount, 0)
  const allocationRemaining = availableSaleCash - allocationTotal
  const allocationOver = allocationTotal > availableSaleCash + .005
  // The pool is only meaningful once targets actually free up cash. When
  // requested targets ~= current allocation, saleProceeds/plannedBuys are
  // sub-cent floating-point residuals; their ratio yields junk percentages
  // (e.g. 382%). Treat a negligible pool as inactive so the summary reads 0.
  const poolActive = saleProceeds > 0.5
  const totalCashAllocated = plannedBuys + allocationTotal
  const totalCashRemaining = saleProceeds - totalCashAllocated
  const usedPct = poolActive ? totalCashAllocated / saleProceeds * 100 : 0
  const poolMonthlyIncomeGain = recipientRows.reduce((sum, row, index) => (
    sum + allocationDollars[index] * Number(row.current_yield || 0) / 100 / 12
  ), 0)

  const updateTarget = (ticker, value) => {
    if (value === '' || (Number(value) >= 0 && Number(value) <= 100)) {
      setPlanActive(true)
      setSettings(prev => ({ ...prev, targets: { ...(prev.targets || {}), [ticker]: value }, targetUpdatedAt: stampTargets(prev, [ticker]) }))
    }
  }
  // Dollar-mode entry for the Requested target column. The stored target is
  // always a percent of the portfolio, so we convert the typed dollar amount
  // back to a percent before saving.
  const updateTargetDollars = (ticker, displayDollars) => {
    if (displayDollars === '') { updateTarget(ticker, ''); return }
    const usd = Math.max(0, Number(displayDollars) || 0) / displayRate
    const pctVal = Number(data?.total_value) > 0 ? usd / Number(data.total_value) * 100 : 0
    updateTarget(ticker, pctVal)
  }
  const revertTickerToCurrent = (category, row) => { setPlanActive(true); setSettings(prev => {
    const targets = { ...(prev.targets || {}) }
    // Preserve the category's currently displayed targets when leaving Equal
    // Weight mode, then reset only the requested ticker.
    category.rows.forEach(candidate => { targets[candidate.ticker] = candidate.requestedTargetPct })
    targets[row.ticker] = row.currentPortfolioPct
    return {
      ...prev,
      targets,
      targetUpdatedAt: stampTargets(prev, category.rows.map(candidate => candidate.ticker)),
      modes: { ...(prev.modes || {}), [category.id]: 'custom' },
    }
  }) }
  const setCategoryMode = (category, mode) => { setPlanActive(true); setSettings(prev => {
    const next = { ...prev, modes: { ...(prev.modes || {}), [category.id]: mode } }
    if (mode === 'current') {
      next.modes[category.id] = 'custom'; next.targets = { ...(prev.targets || {}) }
      category.rows.forEach(row => { next.targets[row.ticker] = row.currentPortfolioPct })
      next.targetUpdatedAt = stampTargets(prev, category.rows.map(row => row.ticker))
    }
    return next
  }) }
  const applyGlobal = () => {
    const value = Math.max(0, Math.min(100, Number(globalTarget) || 0))
    const targets = { ...(settings.targets || {}) }; const modes = { ...(settings.modes || {}) }
    allRows.forEach(row => { targets[row.ticker] = value }); categories.forEach(category => { modes[category.id] = 'custom' })
    setPlanActive(true)
    setSettings(prev => ({ ...prev, targets, modes, targetUpdatedAt: stampTargets(prev, allRows.map(row => row.ticker)) }))
  }
  const normalize = () => {
    if (scenario.requestedTotal <= 0) return
    const targets = {}; allRows.forEach(row => { targets[row.ticker] = row.adjustedTargetPct })
    const modes = {}; categories.forEach(category => { modes[category.id] = 'custom' })
    setPlanActive(true)
    setSettings(prev => ({ ...prev, targets, modes, targetUpdatedAt: stampTargets(prev, allRows.map(row => row.ticker)) }))
  }
  // Plan controls. A saved plan persists in localStorage but is only applied
  // while planActive is true.
  //  • loadSavedPlan   — apply the saved targets/modes (shows recommended trades).
  //  • showCurrentWeights — stop applying the plan (non-destructive: the plan is
  //    kept, the screen returns to a clean current-weight view, cash pool zeroes).
  //  • discardSavedPlan — permanently delete the saved targets/modes.
  const loadSavedPlan = () => setPlanActive(true)
  const showCurrentWeights = () => { setPlanActive(false); setSettings(prev => ({ ...prev, reallocationTickers: [], manualAllocations: {} })) }
  const discardSavedPlan = () => {
    if (!window.confirm('Discard the saved plan and return every holding to its current weight? This cannot be undone.')) return
    setPlanActive(false)
    setSettings(prev => ({ ...prev, targets: {}, modes: {}, targetUpdatedAt: {}, reallocationTickers: [], manualAllocations: {} }))
  }
  const toggleRecipient = ticker => setSettings(prev => {
    const selected = new Set(prev.reallocationTickers || [])
    if (selected.has(ticker)) selected.delete(ticker); else selected.add(ticker)
    return { ...prev, reallocationTickers: [...selected] }
  })
  const applyAutoFill = (method) => {
    if (!recipientRows.length || availableSaleCash <= 0) return
    const scores = recipientRows.map(row => {
      if (method === 'income') return Math.max(0, Number(row.current_yield || 0))
      if (method === 'category_gap') {
        const cat = categories.find(c => c.rows.some(r => r.ticker === row.ticker))
        const gap = Math.max(0, Number(cat?.categoryBudget || 0) - Number(cat?.requestedTargetPct || 0))
        const inCat = recipientRows.filter(r => cat?.rows.some(item => item.ticker === r.ticker)).length || 1
        return gap / inCat
      }
      return 1
    })
    const totalScore = scores.reduce((s, v) => s + v, 0)
    const newAllocations = {}
    recipientRows.forEach((row, i) => {
      newAllocations[row.ticker] = totalScore > 0
        ? availableSaleCash * scores[i] / totalScore
        : availableSaleCash / Math.max(1, recipientRows.length)
    })
    setSettings(prev => ({ ...prev, manualAllocations: newAllocations }))
  }
  const setManualAllocationDollars = (ticker, displayAmount) => {
    const rawAmount = displayAmount === '' ? '' : Math.max(0, Number(displayAmount) || 0) / displayRate
    setSettings(prev => ({ ...prev, manualAllocations: { ...(prev.manualAllocations || {}), [ticker]: rawAmount } }))
  }
  const setManualAllocationPercent = (ticker, percent) => {
    const rawAmount = percent === '' ? '' : availableSaleCash * Math.max(0, Number(percent) || 0) / 100
    setSettings(prev => ({ ...prev, manualAllocations: { ...(prev.manualAllocations || {}), [ticker]: rawAmount } }))
  }
  const distributeSaleCash = () => {
    if (availableSaleCash <= 0 || !recipientRows.length || allocationTotal <= 0 || allocationOver) return
    const targets = { ...(settings.targets || {}) }
    const modes = { ...(settings.modes || {}) }
    recipientRows.forEach((row, index) => {
      targets[row.ticker] = row.requestedTargetPct + (allocationDollars[index] / Number(data.total_value || 1) * 100)
      const category = categories.find(item => item.rows.some(candidate => candidate.ticker === row.ticker))
      if (category) modes[category.id] = 'custom'
    })
    setPlanActive(true)
    setSettings(prev => ({ ...prev, targets, modes, targetUpdatedAt: stampTargets(prev, recipientRows.map(row => row.ticker)), manualAllocations: {} }))
  }

  // Tickers already owned anywhere in the portfolio (or already added as a
  // comparison) can't be added again — comparison holdings are for tickers NOT
  // currently held.
  const ownedTickers = useMemo(() => new Set([
    ...(data?.categories || []).flatMap(c => (c.tickers || []).map(t => t.ticker)),
    ...(data?.unallocated || []).map(h => h.ticker),
  ]), [data])
  const hypoTickers = useMemo(() => new Set((settings.hypotheticals || []).map(h => h.ticker)), [settings.hypotheticals])

  const openAddPanel = categoryId => setAddPanel({ categoryId, ticker: '', subcategoryId: '', loading: false, error: '' })
  const closeAddPanel = () => setAddPanel({ categoryId: null, ticker: '', subcategoryId: '', loading: false, error: '' })
  const addHypothetical = async category => {
    const ticker = (addPanel.ticker || '').trim().toUpperCase()
    if (!ticker) { setAddPanel(p => ({ ...p, error: 'Enter a ticker.' })); return }
    if (ownedTickers.has(ticker)) { setAddPanel(p => ({ ...p, error: `${ticker} is already in your portfolio.` })); return }
    if (hypoTickers.has(ticker)) { setAddPanel(p => ({ ...p, error: `${ticker} is already added as a comparison.` })); return }
    setAddPanel(p => ({ ...p, loading: true, error: '' }))
    try {
      const r = await pf(`/api/dividend-calc/lookup/${encodeURIComponent(ticker)}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Could not look up ${ticker}.`)
      const subId = addPanel.subcategoryId ? Number(addPanel.subcategoryId) : null
      const hypo = {
        ticker: j.ticker || ticker,
        description: j.name || ticker,
        price: Number(j.price) || 0,
        current_yield: Number(j.yield_pct) || 0,
        div_frequency: j.frequency_code || null,
        categoryId: category.id,
        subcategoryId: subId,
      }
      setSettings(prev => ({ ...prev, hypotheticals: [...(prev.hypotheticals || []), hypo] }))
      setExpanded(prev => ({ ...prev, [category.id]: true }))
      closeAddPanel()
    } catch (e) {
      setAddPanel(p => ({ ...p, loading: false, error: e.message }))
    }
  }
  const removeHypothetical = ticker => setSettings(prev => {
    const next = { ...prev, hypotheticals: (prev.hypotheticals || []).filter(h => h.ticker !== ticker) }
    if (next.targets) { next.targets = { ...next.targets }; delete next.targets[ticker] }
    if (next.manualAllocations) { next.manualAllocations = { ...next.manualAllocations }; delete next.manualAllocations[ticker] }
    if (next.reallocationTickers) next.reallocationTickers = next.reallocationTickers.filter(t => t !== ticker)
    return next
  })

  if (loading) return <div className="page"><p>Loading holding targets...</p></div>
  if (error) return <div className="page"><div className="error">{error}</div></div>
  return <div className="page holding-targets-page">
    <div className="page-header holding-targets-header">
      <div><h1>Holding Targets</h1><p>Set ticker weights and preview how category weights, trades, and portfolio income change together.</p></div>
      <div className="holding-targets-links"><NavLink className="btn btn-secondary" to="/categories">Category & Subcategory Targets</NavLink><NavLink className="btn btn-secondary" to="/rebalance-wizard">Rebalance Wizard</NavLink></div>
    </div>
    {isAggregate && <div className="info-banner">Targets are saved for this aggregate view. Category assignments come from its primary portfolio.</div>}
    <div className="card holding-target-controls">
      <div><label>Set every holding to</label><div className="holding-target-inline"><input type="number" min="0" max="100" step="0.1" value={globalTarget} onChange={e => setGlobalTarget(e.target.value)} /><span>% of portfolio</span><button className="btn btn-primary" onClick={applyGlobal}>Apply</button></div></div>
      <div className="holding-target-entrymode"><label>Enter amounts as</label><div className="entrymode-btns"><button className={`btn btn-small ${allocInputMode === 'percent' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAllocInputMode('percent')}>%</button><button className={`btn btn-small ${allocInputMode === 'dollars' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAllocInputMode('dollars')}>$</button></div><small>Switches every Requested &amp; Reinvest box between percent and dollar entry. The other unit stays visible, read-only.</small></div>
      <label className="holding-target-balance-toggle"><input type="checkbox" checked={autoBalance} onChange={e => setSettings(prev => ({ ...prev, autoBalance: e.target.checked }))} /><span><strong>Adjust all categories to a 100% portfolio</strong><small>Requested targets remain visible; the adjusted scenario proportionally changes every category.</small></span></label>
      <div className="holding-target-control-actions">
        {planActive && <button className="btn btn-secondary" onClick={showCurrentWeights} title="Stop applying the plan and show live current weights. Your saved plan is kept.">Show current weights</button>}
        <button className="btn btn-secondary" onClick={normalize} disabled={!planActive || !scenario.requestedTotal}>Save adjusted targets</button>
      </div>
    </div>
    <div className={`holding-target-plan-banner ${planActive ? 'plan-on' : hasSavedPlan ? 'plan-available' : 'plan-clean'}`}>
      {planActive ? <>
        <div className="plan-banner-text"><strong>Plan loaded.</strong>{' '}
          {planTickers.length > 0
            ? <>Showing your saved targets — {planTickers.length} holding{planTickers.length === 1 ? '' : 's'} differ from current weight: {planTickers.slice(0, 10).join(', ')}{planTickers.length > 10 ? ` +${planTickers.length - 10} more` : ''}.</>
            : <>Showing your saved plan ({equalModeCount} equal-weight categor{equalModeCount === 1 ? 'y' : 'ies'}).</>}
          {planLastUpdated && <span className="plan-banner-when"> Last edited {formatWhen(planLastUpdated)}.</span>}
        </div>
        <div className="plan-banner-actions">
          <button className="btn btn-small btn-secondary" onClick={showCurrentWeights}>Show current weights</button>
          <button className="btn btn-small btn-secondary" onClick={discardSavedPlan}>Discard plan</button>
        </div>
      </> : hasSavedPlan ? <>
        <div className="plan-banner-text"><strong>Showing current weights — no trades recommended.</strong>{' '}
          A saved plan exists ({planTickers.length} custom target{planTickers.length === 1 ? '' : 's'}{equalModeCount ? ` + ${equalModeCount} equal-weight categor${equalModeCount === 1 ? 'y' : 'ies'}` : ''}{planTickers.length > 0 ? `: ${planTickers.slice(0, 10).join(', ')}${planTickers.length > 10 ? ` +${planTickers.length - 10} more` : ''}` : ''}). Load it to preview those trades.
          {planLastUpdated && <span className="plan-banner-when"> Last edited {formatWhen(planLastUpdated)}.</span>}
        </div>
        <div className="plan-banner-actions">
          <button className="btn btn-small btn-primary" onClick={loadSavedPlan}>Load plan</button>
          <button className="btn btn-small btn-secondary" onClick={discardSavedPlan}>Discard plan</button>
        </div>
      </> : <div className="plan-banner-text"><strong>Showing current weights.</strong> No saved plan yet — type any Requested target (or use Apply / Equal weight) to start planning.</div>}
    </div>
    <div className="summary-strip">
      <div className="summary-card"><div className="summary-label">Portfolio</div><div className="summary-value">{currentProfileName}</div><div className="summary-sub">{ownedCount} allocated holdings{hypoCount ? ` · ${hypoCount} comparison` : ''}</div></div>
      <div className="summary-card"><div className="summary-label">Requested total</div><div className="summary-value" style={{ color: Math.abs(scenario.requestedTotal - 100) < .01 ? 'var(--pos)' : 'var(--amber)' }}>{pct(scenario.requestedTotal)}</div><div className="summary-sub">{scenario.requestedTotal > 100 ? `${pct(scenario.requestedTotal - 100)} over` : `${pct(100 - scenario.requestedTotal)} under`}</div></div>
      <div className="summary-card"><div className="summary-label">Adjusted scenario</div><div className="summary-value" style={{ color: Math.abs(adjustedTotal - 100) < .01 ? 'var(--pos)' : 'var(--amber)' }}>{pct(adjustedTotal)}</div><div className="summary-sub">Every requested target × {scenario.balanceFactor.toFixed(4)}</div></div>
      <div className="summary-card"><div className="summary-label">Net trade</div><div className="summary-value" style={{ color: tradeTotal > .5 ? 'var(--pos)' : tradeTotal < -.5 ? 'var(--neg)' : 'var(--accent-bright)' }}>{tradeTotal >= 0 ? '+' : ''}{money(tradeTotal)}</div><div className="summary-sub">{autoBalance ? 'Cash-neutral adjusted scenario' : 'Positive requires new cash'}</div></div>
      <div className="summary-card"><div className="summary-label">Monthly income after</div><div className="summary-value">{money(Number(data.monthly_income || 0) + incomeDelta)}</div><div className="summary-sub" style={{ color: incomeDelta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>Monthly change: {incomeDelta >= 0 ? '+' : ''}{money(incomeDelta)}<br />Annual change: {incomeDelta >= 0 ? '+' : ''}{money(incomeDelta * 12)}</div></div>
    </div>
    {(data.unallocated || []).length > 0 && <div className="info-banner"><strong>{data.unallocated.length} unassigned holding{data.unallocated.length === 1 ? '' : 's'}</strong> {data.unallocated.length === 1 ? 'is' : 'are'} grouped under <strong>Uncategorized</strong> below so you can set targets and use the cash pool now. <NavLink to="/categories">Organize {data.unallocated.length === 1 ? 'it' : 'them'} on Categories</NavLink> to track by category.</div>}

    <section className="card reallocation-pool" ref={cashPoolRef}>
      <button className="reallocation-pool-title" onClick={() => setCashPoolOpen(open => !open)}>{cashPoolOpen ? '▾' : '▸'} Reallocation Cash Pool</button>
      {cashPoolOpen && <div className="reallocation-pool-body">
        <div className="reallocation-pool-metrics">
          <div><small>Requested sales before auto-adjust</small><strong>{money(saleProceeds)}</strong></div>
          <div><small>Adjusted sales shown in table</small><strong>{money(adjustedSaleProceeds)}</strong></div>
          <div><small>Requested buys before auto-adjust</small><strong>{money(plannedBuys)}</strong></div>
          <div><small>Adjusted buys shown in table</small><strong>{money(adjustedPlannedBuys)}</strong></div>
          <div><small>Manual pool cash available</small><strong className={availableSaleCash > 0 ? 'trade-buy' : ''}>{money(availableSaleCash)}</strong></div>
          <div><small>Allocation entered</small><strong className={allocationOver ? 'trade-sell' : ''}>{money(allocationTotal)}</strong></div>
          <div><small>Cash remaining</small><strong className={allocationRemaining < -.005 ? 'trade-sell' : allocationRemaining > .005 ? 'trade-buy' : ''}>{money(allocationRemaining)}</strong></div>
          <div><small>Selected recipients</small><strong>{recipientRows.length}</strong></div>
          <div><small>Projected monthly income gain</small><strong className="trade-buy">+{money(poolMonthlyIncomeGain)}</strong></div>
          <div><small>Projected annual income gain</small><strong className="trade-buy">+{money(poolMonthlyIncomeGain * 12)}</strong></div>
        </div>
        {autoBalance && availableSaleCash > .005 && <div className="reallocation-auto-warning">
          <div><strong>Two scenarios are currently shown.</strong> The cash pool uses your requested targets before automatic adjustment. The holding table uses adjusted targets that proportionally reinvest this cash across the portfolio.</div>
          <button className="btn btn-secondary" onClick={() => setSettings(prev => ({ ...prev, autoBalance: false }))}>Use Manual Cash Pool</button>
        </div>}
        <div className="reallocation-pool-actions">
          <div className="reallocation-autofill">
            <span>Auto-fill:</span>
            <button className="btn btn-small btn-secondary" onClick={() => applyAutoFill('equal')} disabled={!recipientRows.length || availableSaleCash <= 0}>Equal</button>
            <button className="btn btn-small btn-secondary" onClick={() => applyAutoFill('category_gap')} disabled={!recipientRows.length || availableSaleCash <= 0}>By Gap</button>
            <button className="btn btn-small btn-secondary" onClick={() => applyAutoFill('income')} disabled={!recipientRows.length || availableSaleCash <= 0}>By Yield</button>
          </div>
          <button className="btn btn-primary" onClick={distributeSaleCash} disabled={availableSaleCash <= .005 || !recipientRows.length || allocationTotal <= .005 || allocationOver}>Apply Allocation</button>
          <button className="btn btn-secondary" onClick={() => setSettings(prev => ({ ...prev, reallocationTickers: [], manualAllocations: {} }))} disabled={!selectedRecipients.size}>Clear Selections</button>
        </div>
        {allocationOver && <p style={{ color: 'var(--neg)', fontSize: '.78rem', fontWeight: 700, textAlign: 'right', margin: '.35rem 0 0' }}>Allocation exceeds available cash by {money(Math.abs(allocationRemaining))}.</p>}
        <p className="reallocation-pool-help">Lower one or more requested targets to create proceeds, then check <strong>Reinvest</strong> on each recipient row below and type the amount directly on that row. Use <strong>Auto-fill</strong> to distribute the pool automatically. Click <strong>Apply Allocation</strong> to update targets and income projections.</p>
      </div>}
    </section>

    <div className="reallocation-sticky-summary">
      <div><small>Total Sale Cash</small><strong>{money(poolActive ? saleProceeds : 0)}</strong></div>
      <div><small>Total Allocated</small><strong>{money(poolActive ? totalCashAllocated : 0)}</strong></div>
      <div><small>Cash Remaining</small><strong className={poolActive && totalCashRemaining < -.005 ? 'trade-sell' : poolActive && totalCashRemaining > .005 ? 'trade-buy' : ''}>{money(poolActive ? totalCashRemaining : 0)}</strong></div>
      <div><small>Used</small><strong>{pct(usedPct)}</strong></div>
      <button className="btn btn-secondary" onClick={() => { setCashPoolOpen(true); cashPoolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Cash Pool ↑</button>
    </div>

    <section className="card pillar-breakdown">
      <h2>Category / Pillar Breakdown</h2>
      <div className="holding-target-table-wrap"><table className="holding-target-table pillar-table">
        <thead><tr><th>Category / Subcategory</th><th>#</th><th>Category Plan</th><th>Requested</th><th>Coverage</th><th>Adjusted</th><th>Current</th><th>Monthly Income Now</th><th>Monthly Income After</th><th>Current Value</th><th>Target Value</th><th>To Target</th></tr></thead>
        <tbody>{categories.map(category => <React.Fragment key={category.id}>
          <tr className="pillar-parent"><td>{category.name}</td><td>{category.count}</td><td>{pct(category.categoryBudget)}</td><td>{pct(category.requestedTargetPct)}</td><td className={category.coverage != null && category.coverage > 100.01 ? 'trade-sell' : category.coverage != null && category.coverage < 99.99 ? 'trade-buy' : ''}>{coverageLabel(category.coverage)}</td><td>{pct(category.adjustedTargetPct)}</td><td>{pct(category.currentPct)}</td><td>{money(category.income)}</td><td>{money(category.income + category.incomeDelta)}</td><td>{money(category.currentValue)}</td><td>{money(category.targetValue)}</td><td className={category.targetValue - category.currentValue >= 0 ? 'trade-buy' : 'trade-sell'}>{category.targetValue - category.currentValue >= 0 ? '+' : ''}{money(category.targetValue - category.currentValue)}</td></tr>
          {category.subRows.map(sub => <tr className="pillar-sub" key={`${category.id}-${sub.id}`}><td>↳ {sub.name}{sub.statedTarget != null ? ` (${pct(sub.statedTarget)} of category)` : ''}</td><td>{sub.count}</td><td>—</td><td>{pct(sub.requestedTargetPct)}</td><td>—</td><td>{pct(sub.adjustedTargetPct)}</td><td>{pct(sub.currentPct)}</td><td>{money(sub.income)}</td><td>{money(sub.income + sub.incomeDelta)}</td><td>{money(sub.currentValue)}</td><td>{money(sub.targetValue)}</td><td className={sub.targetValue - sub.currentValue >= 0 ? 'trade-buy' : 'trade-sell'}>{sub.targetValue - sub.currentValue >= 0 ? '+' : ''}{money(sub.targetValue - sub.currentValue)}</td></tr>)}
        </React.Fragment>)}</tbody>
        <tfoot><tr><td>Totals</td><td>{allRows.length}</td><td>{pct(categories.reduce((sum, category) => sum + category.categoryBudget, 0))}</td><td>{pct(scenario.requestedTotal)}</td><td>{coverageLabel(scenario.requestedTotal)}</td><td>{pct(adjustedTotal)}</td><td>{pct(categories.reduce((sum, category) => sum + category.currentPct, 0))}</td><td>{money(data.monthly_income)}</td><td>{money(Number(data.monthly_income || 0) + incomeDelta)}</td><td>{money(data.total_value)}</td><td>{money(Number(data.total_value || 0) * adjustedTotal / 100)}</td><td className={tradeTotal >= 0 ? 'trade-buy' : 'trade-sell'}>{tradeTotal >= 0 ? '+' : ''}{money(tradeTotal)}</td></tr></tfoot>
      </table></div>
    </section>

    <div className="holding-target-category-list">{categories.map(category => {
      const open = expanded[category.id] !== false
      return <section className="card holding-target-category" key={category.id}>
        <div className="holding-target-category-head">
          <button className="holding-target-disclosure" onClick={() => setExpanded(prev => ({ ...prev, [category.id]: !open }))}>{open ? '▾' : '▸'} {category.name}</button>
          <div className="holding-target-category-stats"><span>Plan {pct(category.categoryBudget)}</span><span>Requested {pct(category.requestedTargetPct)}</span><span className={category.coverage != null && category.coverage > 100.01 ? 'trade-sell' : category.coverage != null && category.coverage < 99.99 ? 'trade-buy' : ''}>{coverageLabel(category.coverage)}</span><span>Adjusted {pct(category.adjustedTargetPct)}</span><span style={{ color: category.incomeDelta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>Monthly income change {category.incomeDelta >= 0 ? '+' : ''}{money(category.incomeDelta)}</span></div>
          <div className="holding-target-mode"><button className={`btn btn-small ${category.mode === 'equal' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategoryMode(category, 'equal')}>Equal weight</button><button className="btn btn-small btn-secondary" onClick={() => setCategoryMode(category, 'current')}>Keep current</button><button className="btn btn-small btn-secondary" onClick={() => addPanel.categoryId === category.id ? closeAddPanel() : openAddPanel(category.id)}>{addPanel.categoryId === category.id ? '✕ Cancel' : '+ Add ETF to compare'}</button></div>
        </div>
        {addPanel.categoryId === category.id && <div className="hypo-add-form">
          <span className="hypo-add-label">Add a holding you don't own to <strong>{category.name}</strong> (display only):</span>
          <input className="hypo-add-ticker" placeholder="Ticker (e.g. SCHD)" value={addPanel.ticker} autoFocus disabled={addPanel.loading} onChange={e => setAddPanel(p => ({ ...p, ticker: e.target.value, error: '' }))} onKeyDown={e => { if (e.key === 'Enter') addHypothetical(category) }} />
          {(category.subcategories || []).length > 0 && <select className="hypo-add-sub" value={addPanel.subcategoryId} disabled={addPanel.loading} onChange={e => setAddPanel(p => ({ ...p, subcategoryId: e.target.value }))}>
            <option value="">No subcategory</option>
            {(category.subcategories || []).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
          </select>}
          <button className="btn btn-small btn-primary" onClick={() => addHypothetical(category)} disabled={addPanel.loading || !addPanel.ticker.trim()}>{addPanel.loading ? 'Looking up…' : 'Add'}</button>
          {addPanel.error && <span className="hypo-add-error">{addPanel.error}</span>}
        </div>}
        {open && <div className="holding-target-table-wrap"><table className="holding-target-table">
          <thead><tr><th>Ticker</th><th>Subcategory</th><th>Shares</th><th>Price</th><th>Yield</th><th>% of category</th><th>Current %</th><th>Requested ({allocInputMode === 'dollars' ? '$ ⟂ %' : '% ⟂ $'})</th><th>Adjusted %</th><th>Buy / Sell</th><th>Shares +/-</th><th>Monthly Income Now</th><th>Monthly Income +/-</th><th>Reinvest / Alloc</th></tr></thead>
          <tbody>{category.rows.map(row => {
            const rawAmount = Number(manualAllocations[row.ticker] || 0)
            const displayAmount = rawAmount * displayRate
            const pctUsed = availableSaleCash > 0 ? rawAmount / availableSaleCash * 100 : 0
            const allocGain = rawAmount * Number(row.current_yield || 0) / 100 / 12
            const isRecipient = selectedRecipients.has(row.ticker)
            const reqDollarsDisplay = Number((row.requestedTargetPct / 100 * Number(data.total_value || 0) * displayRate).toFixed(2))
            const equalLocked = category.mode === 'equal'
            const pctReadOnly = allocInputMode === 'dollars'
            const dollarReadOnly = allocInputMode === 'percent'
            return <tr key={row.ticker} className={row.hypothetical ? 'hypo-row' : ''}><td><div className="hypo-ticker-cell"><strong>{row.ticker}</strong>{row.hypothetical && <span className="hypo-badge">compare</span>}{planActive && !row.hypothetical && Math.abs(row.requestedTargetPct - row.currentPortfolioPct) > 0.01 && <span className="plan-badge" title={`Custom plan target ${pct(row.requestedTargetPct)} vs current ${pct(row.currentPortfolioPct)}${settings.targetUpdatedAt?.[row.ticker] ? ` · set ${formatWhen(settings.targetUpdatedAt[row.ticker])}` : ''}`}>plan</span>}{row.hypothetical && <button type="button" className="hypo-remove" title={`Remove ${row.ticker} from comparison`} aria-label={`Remove ${row.ticker} from comparison`} onClick={() => removeHypothetical(row.ticker)}>✕</button>}</div><small>{row.description}</small></td><td>{row.subcategoryName}</td><td>{shares(row.quantity)}</td><td>{money(row.price)}</td><td>{pct(Number(row.current_yield || 0))}</td><td>{pct(category.actual_value > 0 ? row.current_value / category.actual_value * 100 : 0)}</td><td>{pct(row.currentPortfolioPct)}</td><td><div className="target-input-dual"><div className="target-input"><DraftNumberInput className={pctReadOnly && !equalLocked ? 'mode-readonly' : ''} aria-label={`${row.ticker} target percentage`} value={Number(row.requestedTargetPct.toFixed(4))} disabled={equalLocked} readOnly={pctReadOnly} onValueChange={v => updateTarget(row.ticker, v)} /><span>%</span></div><div className="target-input"><span>$</span><DraftNumberInput className={`target-dollar ${dollarReadOnly && !equalLocked ? 'mode-readonly' : ''}`} aria-label={`${row.ticker} target dollars`} value={reqDollarsDisplay} disabled={equalLocked} readOnly={dollarReadOnly} onValueChange={v => updateTargetDollars(row.ticker, v)} /></div><button type="button" className="target-reset-btn" aria-label={`Reset ${row.ticker} target to current`} title={`Reset only ${row.ticker} to its current ${pct(row.currentPortfolioPct)} allocation`} onClick={() => revertTickerToCurrent(category, row)}>Current</button></div></td><td>{pct(row.adjustedTargetPct)}</td><td className={row.tradeValue > .5 ? 'trade-buy' : row.tradeValue < -.5 ? 'trade-sell' : ''}>{Math.abs(row.tradeValue) < .5 ? 'Balanced' : `${row.tradeValue > 0 ? 'Buy ' : 'Sell '}${money(Math.abs(row.tradeValue))}`}</td><td className={row.tradeShares > .001 ? 'trade-buy' : row.tradeShares < -.001 ? 'trade-sell' : ''}>{row.tradeShares >= 0 ? '+' : ''}{shares(row.tradeShares)}</td><td>{money(row.monthly_income)}</td><td className={row.monthlyDelta >= 0 ? 'trade-buy' : 'trade-sell'}>{row.monthlyDelta >= 0 ? '+' : ''}{money(row.monthlyDelta)}</td><td><div className="reinvest-inline-cell"><input aria-label={`Reinvest in ${row.ticker}`} type="checkbox" checked={isRecipient} disabled={row.rawTradeValue < -.5} onChange={() => toggleRecipient(row.ticker)} />{isRecipient && <div className="reinvest-inline-entry">{allocInputMode === 'dollars' ? <div className="reinvest-amount-field"><span>$</span><DraftNumberInput placeholder="0" value={manualAllocations[row.ticker] === '' ? '' : rawAmount > 0 ? Number(displayAmount.toFixed(2)) : ''} onValueChange={v => setManualAllocationDollars(row.ticker, v)} /></div> : <div className="reinvest-amount-field"><DraftNumberInput placeholder="0" value={manualAllocations[row.ticker] === '' ? '' : pctUsed > 0 ? Number(pctUsed.toFixed(1)) : ''} onValueChange={v => setManualAllocationPercent(row.ticker, v)} /><span>%</span></div>}{rawAmount > 0.5 && <small className="trade-buy reinvest-gain">+{money(allocGain)}/mo</small>}</div>}</div></td></tr>
          })}</tbody>
        </table></div>}
      </section>
    })}</div>
    {!categories.length && <div className="card"><p>No holdings found for this portfolio. Import or add holdings to get started.</p></div>}
  </div>
}
