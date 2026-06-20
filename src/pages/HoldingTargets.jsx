import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useCurrency } from '../context/CurrencyContext'
import { formatMoney } from '../utils/money'

const pct = value => `${Number(value || 0).toFixed(2)}%`
const shares = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })
const money = value => formatMoney(value, { zeroIfInvalid: true })
const readSettings = key => { try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} } }

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
  const autoBalance = settings.autoBalance !== false

  useEffect(() => {
    setSettings(readSettings(storageKey)); setLoading(true); setError('')
    pf('/api/categories/data')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load holdings.')))
      .then(result => { setData(result); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [pf, storageKey])
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(settings)) }, [settings, storageKey])

  const scenario = useMemo(() => {
    const baseCategories = data?.categories || []
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
      const mode = settings.modes?.[category.id] || 'custom'
      const categoryBudget = Number(category.target_pct ?? category.actual_pct ?? 0)
      const equal = equalTargets(category, categoryBudget)
      const subName = new Map((category.subcategories || []).map(sub => [sub.id, sub.name]))
      const rows = category.tickers.map(holding => {
        const currentPortfolioPct = data.total_value > 0 ? holding.current_value / data.total_value * 100 : 0
        const saved = settings.targets?.[holding.ticker]
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
  }, [data, settings, autoBalance])

  const categories = scenario.categories
  const allRows = categories.flatMap(category => category.rows)
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
      setSettings(prev => ({ ...prev, targets: { ...(prev.targets || {}), [ticker]: value } }))
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
  const revertTickerToCurrent = (category, row) => setSettings(prev => {
    const targets = { ...(prev.targets || {}) }
    // Preserve the category's currently displayed targets when leaving Equal
    // Weight mode, then reset only the requested ticker.
    category.rows.forEach(candidate => { targets[candidate.ticker] = candidate.requestedTargetPct })
    targets[row.ticker] = row.currentPortfolioPct
    return {
      ...prev,
      targets,
      modes: { ...(prev.modes || {}), [category.id]: 'custom' },
    }
  })
  const setCategoryMode = (category, mode) => setSettings(prev => {
    const next = { ...prev, modes: { ...(prev.modes || {}), [category.id]: mode } }
    if (mode === 'current') {
      next.modes[category.id] = 'custom'; next.targets = { ...(prev.targets || {}) }
      category.rows.forEach(row => { next.targets[row.ticker] = row.currentPortfolioPct })
    }
    return next
  })
  const applyGlobal = () => {
    const value = Math.max(0, Math.min(100, Number(globalTarget) || 0))
    const targets = { ...(settings.targets || {}) }; const modes = { ...(settings.modes || {}) }
    allRows.forEach(row => { targets[row.ticker] = value }); categories.forEach(category => { modes[category.id] = 'custom' })
    setSettings(prev => ({ ...prev, targets, modes }))
  }
  const normalize = () => {
    if (scenario.requestedTotal <= 0) return
    const targets = {}; allRows.forEach(row => { targets[row.ticker] = row.adjustedTargetPct })
    const modes = {}; categories.forEach(category => { modes[category.id] = 'custom' })
    setSettings(prev => ({ ...prev, targets, modes }))
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
    setSettings(prev => ({ ...prev, targets, modes, manualAllocations: {} }))
  }

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
      <button className="btn btn-secondary" onClick={normalize} disabled={!scenario.requestedTotal}>Save adjusted targets</button>
    </div>
    <div className="summary-strip">
      <div className="summary-card"><div className="summary-label">Portfolio</div><div className="summary-value">{currentProfileName}</div><div className="summary-sub">{allRows.length} allocated holdings</div></div>
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
          <div className="holding-target-mode"><button className={`btn btn-small ${category.mode === 'equal' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategoryMode(category, 'equal')}>Equal weight</button><button className="btn btn-small btn-secondary" onClick={() => setCategoryMode(category, 'current')}>Keep current</button></div>
        </div>
        {open && <div className="holding-target-table-wrap"><table className="holding-target-table">
          <thead><tr><th>Ticker</th><th>Subcategory</th><th>Shares</th><th>Price</th><th>Yield</th><th>% of category</th><th>Current %</th><th>Requested ({allocInputMode === 'dollars' ? '$ ⟂ %' : '% ⟂ $'})</th><th>Adjusted %</th><th>Buy / Sell</th><th>Shares +/-</th><th>Monthly Income Now</th><th>Monthly Income +/-</th><th>Reinvest / Alloc</th></tr></thead>
          <tbody>{category.rows.map(row => {
            const rawAmount = Number(manualAllocations[row.ticker] || 0)
            const displayAmount = rawAmount * displayRate
            const pctUsed = availableSaleCash > 0 ? rawAmount / availableSaleCash * 100 : 0
            const allocGain = rawAmount * Number(row.current_yield || 0) / 100 / 12
            const isRecipient = selectedRecipients.has(row.ticker)
            const reqDollarsDisplay = Number((row.requestedTargetPct / 100 * Number(data.total_value || 0) * displayRate).toFixed(0))
            const equalLocked = category.mode === 'equal'
            const pctReadOnly = allocInputMode === 'dollars'
            const dollarReadOnly = allocInputMode === 'percent'
            return <tr key={row.ticker}><td><strong>{row.ticker}</strong><small>{row.description}</small></td><td>{row.subcategoryName}</td><td>{shares(row.quantity)}</td><td>{money(row.price)}</td><td>{pct(Number(row.current_yield || 0))}</td><td>{pct(category.actual_value > 0 ? row.current_value / category.actual_value * 100 : 0)}</td><td>{pct(row.currentPortfolioPct)}</td><td><div className="target-input-dual"><div className="target-input"><input className={pctReadOnly && !equalLocked ? 'mode-readonly' : ''} aria-label={`${row.ticker} target percentage`} type="number" min="0" max="100" step="0.1" value={Number(row.requestedTargetPct.toFixed(4))} disabled={equalLocked} readOnly={pctReadOnly} onChange={e => updateTarget(row.ticker, e.target.value)} /><span>%</span></div><div className="target-input"><span>$</span><input className={`target-dollar ${dollarReadOnly && !equalLocked ? 'mode-readonly' : ''}`} aria-label={`${row.ticker} target dollars`} type="number" min="0" step="1" value={reqDollarsDisplay} disabled={equalLocked} readOnly={dollarReadOnly} onChange={e => updateTargetDollars(row.ticker, e.target.value)} /></div><button type="button" className="target-reset-btn" aria-label={`Reset ${row.ticker} target to current`} title={`Reset only ${row.ticker} to its current ${pct(row.currentPortfolioPct)} allocation`} onClick={() => revertTickerToCurrent(category, row)}>Current</button></div></td><td>{pct(row.adjustedTargetPct)}</td><td className={row.tradeValue > .5 ? 'trade-buy' : row.tradeValue < -.5 ? 'trade-sell' : ''}>{Math.abs(row.tradeValue) < .5 ? 'Balanced' : `${row.tradeValue > 0 ? 'Buy ' : 'Sell '}${money(Math.abs(row.tradeValue))}`}</td><td className={row.tradeShares > .001 ? 'trade-buy' : row.tradeShares < -.001 ? 'trade-sell' : ''}>{row.tradeShares >= 0 ? '+' : ''}{shares(row.tradeShares)}</td><td>{money(row.monthly_income)}</td><td className={row.monthlyDelta >= 0 ? 'trade-buy' : 'trade-sell'}>{row.monthlyDelta >= 0 ? '+' : ''}{money(row.monthlyDelta)}</td><td><div className="reinvest-inline-cell"><input aria-label={`Reinvest in ${row.ticker}`} type="checkbox" checked={isRecipient} disabled={row.rawTradeValue < -.5} onChange={() => toggleRecipient(row.ticker)} />{isRecipient && <div className="reinvest-inline-entry">{allocInputMode === 'dollars' ? <div className="reinvest-amount-field"><span>$</span><input type="number" min="0" step="1" placeholder="0" value={manualAllocations[row.ticker] === '' ? '' : rawAmount > 0 ? Number(displayAmount.toFixed(2)) : ''} onChange={e => setManualAllocationDollars(row.ticker, e.target.value)} /></div> : <div className="reinvest-amount-field"><input type="number" min="0" step="0.1" placeholder="0" value={manualAllocations[row.ticker] === '' ? '' : pctUsed > 0 ? Number(pctUsed.toFixed(1)) : ''} onChange={e => setManualAllocationPercent(row.ticker, e.target.value)} /><span>%</span></div>}{rawAmount > 0.5 && <small className="trade-buy reinvest-gain">+{money(allocGain)}/mo</small>}</div>}</div></td></tr>
          })}</tbody>
        </table></div>}
      </section>
    })}</div>
    {!categories.length && <div className="card"><p>No holdings found for this portfolio. Import or add holdings to get started.</p></div>}
  </div>
}
