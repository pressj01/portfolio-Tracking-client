import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

function fmt$(v) {
  const n = Number(v || 0)
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(v) {
  return Number(v || 0).toFixed(2) + '%'
}

function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

function StatCard({ label, value, sub, tone }) {
  const color = tone === 'good' ? '#4dff91' : tone === 'bad' ? '#ff6b6b' : '#7ecfff'
  return (
    <div className="card" style={{ padding: '0.9rem 1rem', minWidth: 170 }}>
      <div style={{ color: '#8899aa', fontSize: '0.75rem', marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: '1.25rem', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: '#90a4ae', fontSize: '0.78rem', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

export default function RebalanceWizard() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const categoryHandoff = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('categoryTargetAssistantHandoff')
      if (!raw) return null
      sessionStorage.removeItem('categoryTargetAssistantHandoff')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [tradeOverrides, setTradeOverrides] = useState({})
  const [tradeEdits, setTradeEdits] = useState({})
  const [removedTradeKeys, setRemovedTradeKeys] = useState([])
  const [manualTrades, setManualTrades] = useState([])
  const [candidatePrefs, setCandidatePrefs] = useState({})
  const [selectedCandidateCategory, setSelectedCandidateCategory] = useState('')
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [savedPlans, setSavedPlans] = useState([])
  const [selectedSavedPlanId, setSelectedSavedPlanId] = useState('')
  const [planName, setPlanName] = useState('')
  const [savingPlan, setSavingPlan] = useState(false)
  const [tradeExecution, setTradeExecution] = useState({})
  const [incomeMode, setIncomeMode] = useState(categoryHandoff?.min_monthly_income ? 'custom' : 'preserve_current')
  const [rebalanceStrategy, setRebalanceStrategy] = useState(categoryHandoff?.rebalance_strategy || 'match_targets_preserve_income')
  const [minYield, setMinYield] = useState('')
  const [minMonthlyIncome, setMinMonthlyIncome] = useState(categoryHandoff?.min_monthly_income ? String(categoryHandoff.min_monthly_income) : '')
  const [newCash, setNewCash] = useState('0')
  const [allowSells, setAllowSells] = useState(true)
  const [minTradeAmount, setMinTradeAmount] = useState('100')
  const [lockedTickers, setLockedTickers] = useState('')

  const payload = useMemo(() => ({
    income_mode: incomeMode,
    rebalance_strategy: rebalanceStrategy,
    min_yield: minYield === '' ? null : Number(minYield),
    min_monthly_income: minMonthlyIncome === '' ? null : Number(minMonthlyIncome),
    new_cash: Number(newCash) || 0,
    allow_sells: allowSells,
    min_trade_amount: Number(minTradeAmount) || 0,
    locked_tickers: lockedTickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean),
  }), [incomeMode, rebalanceStrategy, minYield, minMonthlyIncome, newCash, allowSells, minTradeAmount, lockedTickers])

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await pf('/api/rebalance/category-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || 'Could not generate rebalance plan.')
      } else {
        setTradeOverrides({})
        setTradeEdits({})
        setRemovedTradeKeys([])
        setManualTrades([])
        setTradeExecution({})
        const prefs = {}
        for (const [category, candidates] of Object.entries(data.category_candidates || {})) {
          prefs[category] = candidates.filter(c => c.preferred).map(c => c.ticker)
        }
        setCandidatePrefs(prefs)
        setSelectedCandidateCategory(prev => prev || Object.keys(data.category_candidates || {})[0] || '')
        setSelectedSavedPlanId('')
        setPlanName(`Rebalance ${new Date().toLocaleDateString()}`)
        setResult(data)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [pf, payload])

  const fetchSavedPlans = useCallback(async () => {
    try {
      const res = await pf('/api/rebalance/saved-plans')
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load saved rebalance plans.')
      setSavedPlans(data.plans || [])
    } catch (e) {
      setError(e.message)
    }
  }, [pf])

  const suspiciousYieldThreshold = Number(result?.guardrails?.suspicious_yield_pct || Math.max(25, Number(result?.before?.yield || 0) * 2))
  const isSuspiciousYield = useCallback((yieldPct) => (
    Number(yieldPct || 0) >= suspiciousYieldThreshold
  ), [suspiciousYieldThreshold])

  useEffect(() => {
    generate()
    fetchSavedPlans()
    // Regenerate when the active portfolio changes; settings changes use the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  const exportCsv = () => {
    if (!effectiveTrades?.length) return
    if (incomeFloorBreached) {
      setError(`Blocked: edited trades would drop monthly income below the required floor (${fmt$(effectiveAfterMonthly)} vs ${fmt$(requiredMonthlyIncome)}).`)
      return
    }
    const headers = ['Action', 'Ticker', 'Category', 'Shares', 'Amount', 'Price', 'Yield', 'Monthly Income Delta', 'Reason']
    const rows = effectiveTrades.map(t => [
      t.action.toUpperCase(), t.ticker, t.category, t.shares ?? '', t.amount, t.price ?? '', t.yield, t.monthly_income_delta, t.reason,
    ])
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rebalance-trade-list.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const freqMult = (freq) => ({ W: 52, M: 12, Q: 4, SA: 2, A: 1 }[String(freq || '').toUpperCase()] || 4)

  const lookupCandidate = async (ticker) => {
    const res = await pf(`/api/lookup/${encodeURIComponent(ticker)}`)
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error || `Could not look up ${ticker}`)
    const price = Number(data.current_price || 0)
    const annualYield = price > 0 ? (Number(data.div || 0) * freqMult(data.div_frequency) / price) * 100 : 0
    return {
      ticker: (data.renamed_to || data.ticker || ticker).toUpperCase(),
      price,
      yield: annualYield,
      source: 'lookup',
    }
  }

  const handleTradeTickerChange = async (key, trade, ticker) => {
    if (!trade) return
    const selected = (trade.candidates || []).find(c => c.ticker === ticker)
    setError(null)
    if (selected?.price) {
      setTradeOverrides(prev => ({ ...prev, [key]: selected }))
      return
    }
    setTradeOverrides(prev => ({ ...prev, [key]: { ticker, loading: true } }))
    try {
      const lookedUp = await lookupCandidate(ticker)
      setTradeOverrides(prev => ({ ...prev, [key]: lookedUp }))
    } catch (e) {
      setError(e.message)
      setTradeOverrides(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const updateTradeEdit = (key, patch) => {
    setTradeEdits(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }))
  }

  const updateTradeExecution = (key, patch) => {
    setTradeExecution(prev => ({ ...prev, [key]: { ...(prev[key] || { status: 'pending', note: '' }), ...patch } }))
  }

  const removeTrade = (key) => {
    if (String(key).startsWith('m-')) {
      setManualTrades(prev => prev.filter(t => t._key !== key))
    } else {
      setRemovedTradeKeys(prev => prev.includes(key) ? prev : [...prev, key])
    }
  }

  const restoreRemovedTrades = () => {
    setRemovedTradeKeys([])
  }

  const markAllReviewed = () => {
    setTradeExecution(prev => {
      const next = { ...prev }
      for (const t of effectiveTrades) {
        next[t._key] = { ...(next[t._key] || {}), status: 'reviewed' }
      }
      return next
    })
  }

  const addManualTrade = () => {
    const firstCategory = result?.bucket_results?.[0]?.category || ''
    const key = `m-${Date.now()}`
    setManualTrades(prev => ([
      ...prev,
      {
        _key: key,
        action: 'buy',
        ticker: '',
        category: firstCategory,
        amount: 0,
        price: 0,
        yield: 0,
        shares: null,
        monthly_income_delta: 0,
        reason: 'Manual trade added to this scenario.',
        candidates: [],
      },
    ]))
  }

  const lookupManualTicker = async (key, ticker) => {
    if (!ticker.trim()) return
    setError(null)
    setTradeOverrides(prev => ({ ...prev, [key]: { ticker: ticker.trim().toUpperCase(), loading: true } }))
    try {
      const lookedUp = await lookupCandidate(ticker.trim())
      setTradeOverrides(prev => ({ ...prev, [key]: lookedUp }))
    } catch (e) {
      setError(e.message)
      setTradeOverrides(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const applyTradeState = (trade) => {
    const key = trade._key
    const edit = tradeEdits[key] || {}
    const override = tradeOverrides[key] || {}
    const action = edit.action || trade.action
    const ticker = (override.ticker || edit.ticker || trade.ticker || '').toUpperCase()
    const category = edit.category || trade.category
    const amount = Number(edit.amount ?? trade.amount ?? 0)
    const price = Number(edit.price ?? override.price ?? trade.price ?? 0)
    const yieldPct = Number(edit.yield ?? override.yield ?? trade.yield ?? 0)
    const sign = action === 'sell' ? -1 : 1
    return {
      ...trade,
      ...edit,
      action,
      ticker,
      category,
      amount,
      price: price || null,
      yield: yieldPct,
      shares: price > 0 ? amount / price : trade.shares,
      monthly_income_delta: sign * amount * (yieldPct / 100) / 12,
      suspicious_yield: action === 'buy' && isSuspiciousYield(yieldPct),
      nav_risk: override.nav_risk || trade.nav_risk,
      candidate_source: override.source || trade.candidate_source || trade.source,
      reason: override.source === 'lookup'
        ? `${action === 'buy' ? 'Add to' : 'Trim from'} category; user-selected ticker looked up live.`
        : trade.reason,
      loading: Boolean(override.loading),
    }
  }

  const effectiveTrades = useMemo(() => {
    if (!result?.trades) return manualTrades.map(applyTradeState)
    const generated = result.trades
      .map((trade, idx) => ({ ...trade, _key: `g-${idx}`, generatedIndex: idx }))
      .filter(trade => !removedTradeKeys.includes(trade._key))
    return [...generated, ...manualTrades]
      .map(applyTradeState)
      .filter(t => Number(t.amount || 0) > 0 || String(t._key).startsWith('m-'))
  }, [result, manualTrades, removedTradeKeys, tradeEdits, tradeOverrides])

  const tradeTotals = useMemo(() => {
    const buys = effectiveTrades.filter(t => t.action === 'buy').reduce((s, t) => s + Number(t.amount || 0), 0)
    const sells = effectiveTrades.filter(t => t.action === 'sell').reduce((s, t) => s + Number(t.amount || 0), 0)
    return { buys, sells, net: buys - sells }
  }, [effectiveTrades])

  const executionSummary = useMemo(() => {
    const counts = { pending: 0, reviewed: 0, placed: 0, filled: 0, skipped: 0 }
    for (const trade of effectiveTrades) {
      const status = tradeExecution[trade._key]?.status || 'pending'
      counts[status] = (counts[status] || 0) + 1
    }
    return counts
  }, [effectiveTrades, tradeExecution])

  const effectiveAfterMonthly = useMemo(() => {
    if (!result) return 0
    return Number(result.before.monthly_income || 0) + effectiveTrades.reduce((s, t) => s + Number(t.monthly_income_delta || 0), 0)
  }, [result, effectiveTrades])

  const effectiveAfterYield = result?.after?.value ? (effectiveAfterMonthly * 12 / Number(result.after.value)) * 100 : 0
  const requiredMonthlyIncome = Number(result?.required?.monthly_income || 0)
  const incomeFloorBreached = Boolean(result && effectiveAfterMonthly + 0.01 < requiredMonthlyIncome)
  const monthlyIncomeDelta = result ? effectiveAfterMonthly - Number(result.before.monthly_income || 0) : 0
  const suspiciousTrades = useMemo(() => effectiveTrades.filter(t => t.action === 'buy' && isSuspiciousYield(t.yield)), [effectiveTrades, isSuspiciousYield])
  const navRiskTrades = useMemo(() => (
    effectiveTrades.filter(t => t.action === 'buy' && ['Candidate', 'Test'].includes(t.nav_risk))
  ), [effectiveTrades])

  const cumulativeTradeYields = useMemo(() => {
    if (!result) return {}
    let monthly = Number(result.before.monthly_income || 0)
    const value = Number(result.after?.value || result.before?.value || 0)
    const out = {}
    for (const trade of effectiveTrades) {
      monthly += Number(trade.monthly_income_delta || 0)
      out[trade._key] = value > 0 ? (monthly * 12 / value) * 100 : 0
    }
    return out
  }, [result, effectiveTrades])

  const remainingGaps = useMemo(() => {
    const gaps = {}
    for (const b of result?.bucket_results || []) {
      gaps[b.category] = Number(b.gap_dollars || 0)
    }
    for (const t of effectiveTrades) {
      if (!t.category || gaps[t.category] == null) continue
      const amount = Number(t.amount || 0)
      gaps[t.category] += t.action === 'sell' ? amount : -amount
    }
    return gaps
  }, [result, effectiveTrades])

  const remainingAbsDrift = useMemo(() => Object.values(remainingGaps).reduce((s, v) => s + Math.abs(Number(v || 0)), 0), [remainingGaps])

  const categoryIncomeAfter = useMemo(() => {
    const income = {}
    for (const b of result?.bucket_results || []) {
      income[b.category] = Number(b.monthly_income || 0)
    }
    for (const t of effectiveTrades) {
      if (!t.category || income[t.category] == null) continue
      income[t.category] += Number(t.monthly_income_delta || 0)
    }
    return income
  }, [result, effectiveTrades])

  const savedPlanSummary = useMemo(() => {
    if (!result) return {}
    return {
      current_monthly_income: Number(result.before?.monthly_income || 0),
      projected_monthly_income: effectiveAfterMonthly,
      required_monthly_income: requiredMonthlyIncome,
      monthly_income_delta: monthlyIncomeDelta,
      projected_yield: effectiveAfterYield,
      remaining_drift: remainingAbsDrift,
      total_buys: tradeTotals.buys,
      total_sells: tradeTotals.sells,
      income_floor_met: !incomeFloorBreached,
      suspicious_trades: suspiciousTrades.map(t => t.ticker),
      nav_review_trades: navRiskTrades.map(t => t.ticker),
      trade_count: effectiveTrades.length,
      execution: executionSummary,
    }
  }, [
    result,
    effectiveAfterMonthly,
    requiredMonthlyIncome,
    monthlyIncomeDelta,
    effectiveAfterYield,
    remainingAbsDrift,
    tradeTotals,
    incomeFloorBreached,
    suspiciousTrades,
    navRiskTrades,
    effectiveTrades,
    executionSummary,
  ])

  const savedPlanSnapshot = useMemo(() => ({
    name: planName,
    settings: payload,
    result,
    trade_state: {
      trade_overrides: tradeOverrides,
      trade_edits: tradeEdits,
      removed_trade_keys: removedTradeKeys,
      manual_trades: manualTrades,
      trade_execution: tradeExecution,
    },
    effective_trades: effectiveTrades,
    summary: savedPlanSummary,
    category_income_after: categoryIncomeAfter,
    remaining_gaps: remainingGaps,
    exported_at: new Date().toISOString(),
  }), [
    planName,
    payload,
    result,
    tradeOverrides,
    tradeEdits,
    removedTradeKeys,
    manualTrades,
    tradeExecution,
    effectiveTrades,
    savedPlanSummary,
    categoryIncomeAfter,
    remainingGaps,
  ])

  const categoryOptions = result?.bucket_results?.map(b => b.category) || []

  const candidateCategories = Object.keys(result?.category_candidates || {})
  const activeCandidateCategory = selectedCandidateCategory || candidateCategories[0] || ''
  const activeCandidates = result?.category_candidates?.[activeCandidateCategory] || []
  const activePreferred = candidatePrefs[activeCandidateCategory] || []

  const candidateSummary = (c) => {
    const bits = []
    if (c.yield != null) bits.push(`${fmtPct(c.yield)} yield`)
    if (c.price != null) bits.push(fmt$(c.price))
    if (c.sample_monthly_income != null) bits.push(`+${fmt$(c.sample_monthly_income)}/mo`)
    if (c.nav_risk) bits.push(`NAV ${c.nav_risk}`)
    bits.push(c.source)
    return bits.join(' | ')
  }

  const togglePreferredCandidate = (category, ticker) => {
    setCandidatePrefs(prev => {
      const current = prev[category] || []
      const next = current.includes(ticker)
        ? current.filter(t => t !== ticker)
        : [...current, ticker]
      return { ...prev, [category]: next }
    })
  }

  const movePreferredCandidate = (category, ticker, direction) => {
    setCandidatePrefs(prev => {
      const current = [...(prev[category] || [])]
      const idx = current.indexOf(ticker)
      const nextIdx = idx + direction
      if (idx < 0 || nextIdx < 0 || nextIdx >= current.length) return prev
      const tmp = current[idx]
      current[idx] = current[nextIdx]
      current[nextIdx] = tmp
      return { ...prev, [category]: current }
    })
  }

  const saveCandidatePrefs = async () => {
    if (!activeCandidateCategory) return
    setSavingPrefs(true)
    setError(null)
    try {
      const res = await pf('/api/rebalance/candidate-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: activeCandidateCategory,
          tickers: activePreferred,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save candidate preferences.')
      await generate()
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingPrefs(false)
    }
  }

  const saveCurrentPlan = async () => {
    if (!result) return
    if (!planName.trim()) {
      setError('Name this scenario before saving it.')
      return
    }
    setSavingPlan(true)
    setError(null)
    try {
      const res = await pf('/api/rebalance/saved-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedSavedPlanId || null,
          ...savedPlanSnapshot,
          name: planName.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save rebalance plan.')
      setSelectedSavedPlanId(String(data.id))
      await fetchSavedPlans()
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingPlan(false)
    }
  }

  const loadSavedPlan = async (planId) => {
    if (!planId) return
    setLoading(true)
    setError(null)
    try {
      const res = await pf(`/api/rebalance/saved-plans/${planId}`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load rebalance plan.')
      const plan = data.plan
      const settings = plan.settings || {}
      const tradeState = plan.trade_state || {}
      setIncomeMode(settings.income_mode || 'preserve_current')
      setRebalanceStrategy(settings.rebalance_strategy || 'match_targets_preserve_income')
      setMinYield(settings.min_yield == null ? '' : String(settings.min_yield))
      setMinMonthlyIncome(settings.min_monthly_income == null ? '' : String(settings.min_monthly_income))
      setNewCash(String(settings.new_cash ?? 0))
      setAllowSells(settings.allow_sells !== false)
      setMinTradeAmount(String(settings.min_trade_amount ?? 100))
      setLockedTickers((settings.locked_tickers || []).join(', '))
      setResult(plan.result || null)
      const prefs = {}
      for (const [category, candidates] of Object.entries(plan.result?.category_candidates || {})) {
        prefs[category] = candidates.filter(c => c.preferred).map(c => c.ticker)
      }
      setCandidatePrefs(prefs)
      setSelectedCandidateCategory(Object.keys(plan.result?.category_candidates || {})[0] || '')
      setTradeOverrides(tradeState.trade_overrides || {})
      setTradeEdits(tradeState.trade_edits || {})
      setRemovedTradeKeys(tradeState.removed_trade_keys || [])
      setManualTrades(tradeState.manual_trades || [])
      setTradeExecution(tradeState.trade_execution || {})
      setPlanName(plan.name || '')
      setSelectedSavedPlanId(String(plan.id))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const deleteSavedPlan = async () => {
    if (!selectedSavedPlanId) return
    setSavingPlan(true)
    setError(null)
    try {
      const res = await pf(`/api/rebalance/saved-plans/${selectedSavedPlanId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not delete rebalance plan.')
      setSelectedSavedPlanId('')
      setPlanName(`Rebalance ${new Date().toLocaleDateString()}`)
      await fetchSavedPlans()
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingPlan(false)
    }
  }

  const exportAuditJson = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(savedPlanSnapshot, null, 2)], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(planName || 'rebalance-plan').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'rebalance-plan'}-audit.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportBrokerCsv = () => {
    if (!effectiveTrades?.length) return
    if (incomeFloorBreached) {
      setError(`Blocked: execution export would drop monthly income below the required floor (${fmt$(effectiveAfterMonthly)} vs ${fmt$(requiredMonthlyIncome)}).`)
      return
    }
    const headers = ['Action', 'Ticker', 'Shares', 'Dollar Amount', 'Limit Price', 'Status', 'Category', 'Income Impact', 'Execution Note']
    const rows = effectiveTrades.map(t => {
      const execution = tradeExecution[t._key] || {}
      return [
        t.action.toUpperCase(),
        t.ticker,
        t.shares ?? '',
        t.amount,
        t.price ?? '',
        execution.status || 'pending',
        t.category,
        t.monthly_income_delta,
        execution.note || '',
      ]
    })
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(planName || 'rebalance-orders').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'rebalance-orders'}-broker-ticket.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h1>Rebalance Wizard</h1>
          <p style={{ color: '#90a4ae', marginTop: 4 }}>
            Build a buy/sell list from category target drift while keeping the monthly income target visible and enforced.
          </p>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={loading}>
          {loading ? 'Generating...' : 'Generate Plan'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.9rem', alignItems: 'end' }}>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Income Mode</label>
            <select value={incomeMode} onChange={e => setIncomeMode(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
              <option value="preserve_current">Preserve current monthly income</option>
              <option value="custom">Use only the custom income floor</option>
            </select>
          </div>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Rebalance Priority</label>
            <select value={rebalanceStrategy} onChange={e => setRebalanceStrategy(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
              <option value="match_targets_preserve_income">Close the largest target gaps first</option>
              <option value="maximize_income_reduce_drift">Prioritize income while reducing drift</option>
            </select>
          </div>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Minimum Portfolio Yield %</label>
            <input type="number" step="0.1" value={minYield} onChange={e => setMinYield(e.target.value)} placeholder="Optional" style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Minimum Monthly Income</label>
            <input type="number" step="1" value={minMonthlyIncome} onChange={e => setMinMonthlyIncome(e.target.value)} placeholder="Optional" style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>New Cash To Invest</label>
            <input type="number" step="1" value={newCash} onChange={e => setNewCash(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Minimum Trade Size</label>
            <input type="number" step="1" value={minTradeAmount} onChange={e => setMinTradeAmount(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Do Not Trade These Tickers</label>
            <input value={lockedTickers} onChange={e => setLockedTickers(e.target.value)} placeholder="JEPI, MAIN" style={{ width: '100%', marginTop: 4 }} />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#ddd', paddingBottom: 8 }}>
            <input type="checkbox" checked={allowSells} onChange={e => setAllowSells(e.target.checked)} />
            Allow sells to fund underweight categories
          </label>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Scenario Name</label>
            <input
              value={planName}
              onChange={e => {
                setPlanName(e.target.value)
                if (selectedSavedPlanId) setSelectedSavedPlanId('')
              }}
              placeholder="Name this scenario"
              style={{ width: '100%', marginTop: 4 }}
            />
          </div>
          <div>
            <label style={{ color: '#8899aa', fontSize: '0.8rem' }}>Saved Scenarios</label>
            <select
              value={selectedSavedPlanId}
              onChange={e => setSelectedSavedPlanId(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            >
              <option value="">Select saved scenario</option>
              {savedPlans.map(plan => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} - {fmt$(plan.summary?.projected_monthly_income || 0)}/mo
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={() => loadSavedPlan(selectedSavedPlanId)} disabled={!selectedSavedPlanId || loading}>
            Load
          </button>
          <button className="btn btn-success" onClick={saveCurrentPlan} disabled={!result || savingPlan}>
            {savingPlan ? 'Saving...' : selectedSavedPlanId ? 'Update Scenario' : 'Save Scenario'}
          </button>
          <button className="btn btn-danger" onClick={deleteSavedPlan} disabled={!selectedSavedPlanId || savingPlan}>
            Delete
          </button>
        </div>
        {savedPlans.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '0.9rem' }}>
            <table className="pb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Saved Scenario</th>
                  <th>Projected Income</th>
                  <th>Income Delta</th>
                  <th>Yield</th>
                  <th>Remaining Drift</th>
                  <th>Trades</th>
                  <th>Guardrail</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {savedPlans.map(plan => {
                  const summary = plan.summary || {}
                  const incomeDelta = Number(summary.monthly_income_delta || 0)
                  const floorMet = summary.income_floor_met !== false
                  const active = String(plan.id) === String(selectedSavedPlanId)
                  return (
                    <tr key={plan.id}>
                      <td style={{ textAlign: 'left', fontWeight: 700, color: active ? '#7ecfff' : undefined }}>
                        {plan.name}
                      </td>
                      <td>{fmt$(summary.projected_monthly_income)}</td>
                      <td style={{ color: incomeDelta >= 0 ? '#4dff91' : '#ff6b6b', fontWeight: 700 }}>
                        {incomeDelta >= 0 ? '+' : '-'}{fmt$(Math.abs(incomeDelta))}
                      </td>
                      <td>{fmtPct(summary.projected_yield)}</td>
                      <td>{fmt$(summary.remaining_drift)}</td>
                      <td>{Number(summary.trade_count || 0)}</td>
                      <td style={{ color: floorMet ? '#4dff91' : '#ff6b6b', fontWeight: 700 }}>
                        {floorMet ? 'Met' : 'Blocked'}
                      </td>
                      <td>{fmtDate(plan.updated_at)}</td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          onClick={() => loadSavedPlan(plan.id)}
                          disabled={loading}
                          style={{ padding: '0.2rem 0.55rem', fontSize: '0.75rem' }}
                        >
                          Load
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
          <span>{error}</span>
          <NavLink to="/categories" className="btn btn-secondary">Go to Categories</NavLink>
        </div>
      )}

      {result && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <StatCard label="Current Monthly Income" value={fmt$(result.before.monthly_income)} sub={`Yield ${fmtPct(result.before.yield)}`} />
            <StatCard
              label="Projected Monthly Income"
              value={fmt$(effectiveAfterMonthly)}
              sub={`${monthlyIncomeDelta >= 0 ? '+' : '-'}${fmt$(Math.abs(monthlyIncomeDelta))}/mo | Yield ${fmtPct(effectiveAfterYield)}`}
              tone={incomeFloorBreached ? 'bad' : 'good'}
            />
            <StatCard label="Required Income Floor" value={fmt$(result.required.monthly_income)} sub={`Implied yield ${fmtPct(result.required.yield)}`} />
            <StatCard
              label="Income Guardrail"
              value={incomeFloorBreached ? 'Blocked' : 'Met'}
              sub={`Floor ${fmt$(requiredMonthlyIncome)}/mo`}
              tone={incomeFloorBreached ? 'bad' : 'good'}
            />
            <StatCard label="Trade Totals" value={`${fmt$(tradeTotals.buys)} buys`} sub={`${fmt$(tradeTotals.sells)} sells`} />
            <StatCard label="Remaining Drift" value={fmt$(remainingAbsDrift)} sub={`${removedTradeKeys.length} removed trade${removedTradeKeys.length === 1 ? '' : 's'}`} tone={remainingAbsDrift <= 100 ? 'good' : undefined} />
            <StatCard
              label="Execution"
              value={`${executionSummary.filled}/${effectiveTrades.length} filled`}
              sub={`${executionSummary.reviewed} reviewed | ${executionSummary.placed} placed | ${executionSummary.skipped} skipped`}
              tone={effectiveTrades.length > 0 && executionSummary.filled === effectiveTrades.length ? 'good' : undefined}
            />
          </div>

          {incomeFloorBreached && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              Income guardrail: the edited trades would reduce projected monthly income below the required floor by {fmt$(requiredMonthlyIncome - effectiveAfterMonthly)}. Trade exports stay disabled until the income gap is fixed.
            </div>
          )}

          {suspiciousTrades.length > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              High-yield review: {suspiciousTrades.map(t => `${t.ticker} (${fmtPct(t.yield)})`).join(', ')} is at or above the {fmtPct(suspiciousYieldThreshold)} review threshold. Check whether the payout is sustainable before using it as an income replacement.
            </div>
          )}

          {navRiskTrades.length > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              NAV review: {navRiskTrades.map(t => `${t.ticker} (${t.nav_risk})`).join(', ')} may need a closer look for NAV erosion before this plan is executed.
            </div>
          )}

          {result.warnings?.length > 0 && (
            <div className="alert alert-warning">
              {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Category Drift</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="pb-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Category</th>
                    <th>Target</th>
                    <th>Actual</th>
                    <th>Drift</th>
                    <th>Current Value</th>
                    <th>Target Value</th>
                    <th>$ to Target</th>
                    <th>After Edits</th>
                    <th>Income Before</th>
                    <th>Income After</th>
                    <th>Income Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {result.bucket_results.map(b => {
                    const gap = Number(b.gap_dollars || 0)
                    const remaining = Number(remainingGaps[b.category] || 0)
                    const drift = Number(b.drift_pct || 0)
                    const incomeBefore = Number(b.monthly_income || 0)
                    const incomeAfter = Number(categoryIncomeAfter[b.category] ?? incomeBefore)
                    const incomeDelta = incomeAfter - incomeBefore
                    return (
                      <tr key={b.category}>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>{b.category}</td>
                        <td>{fmtPct(b.target_pct)}</td>
                        <td>{fmtPct(b.actual_pct)}</td>
                        <td style={{ color: Math.abs(drift) <= 2 ? '#4dff91' : Math.abs(drift) <= 5 ? '#ffb74d' : '#ff6b6b', fontWeight: 700 }}>
                          {drift > 0 ? '+' : ''}{fmtPct(drift)}
                        </td>
                        <td>{fmt$(b.current_value)}</td>
                        <td>{fmt$(b.target_value)}</td>
                        <td style={{ color: gap >= 0 ? '#4dff91' : '#ff6b6b', fontWeight: 700 }}>
                          {gap >= 0 ? '+' : '-'}{fmt$(Math.abs(gap))}
                        </td>
                        <td style={{ color: Math.abs(remaining) <= 100 ? '#4dff91' : remaining > 0 ? '#ffb74d' : '#ff6b6b', fontWeight: 700 }}>
                          {remaining >= 0 ? '+' : '-'}{fmt$(Math.abs(remaining))}
                        </td>
                        <td>{fmt$(incomeBefore)}</td>
                        <td>{fmt$(incomeAfter)}</td>
                        <td style={{ color: incomeDelta >= 0 ? '#4dff91' : '#ff6b6b', fontWeight: 700 }}>
                          {incomeDelta >= 0 ? '+' : '-'}{fmt$(Math.abs(incomeDelta))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Buy Candidate Preferences</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={activeCandidateCategory}
                  onChange={e => setSelectedCandidateCategory(e.target.value)}
                  style={{ minWidth: 170 }}
                >
                  {candidateCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="btn btn-success" onClick={saveCandidatePrefs} disabled={savingPrefs || !activeCandidateCategory}>
                  {savingPrefs ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </div>
            {activeCandidates.length === 0 ? (
              <p style={{ color: '#90a4ae' }}>No buy candidates are available for this category yet. Assign more tickers to the category or add preferred candidates after lookup.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="pb-table">
                  <thead>
                    <tr>
                      <th>Preferred</th>
                      <th>Rank</th>
                      <th>Ticker</th>
                      <th style={{ textAlign: 'left' }}>Description</th>
                      <th>Price</th>
                      <th>Yield</th>
                      <th>Income Impact</th>
                      <th>NAV Risk</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCandidates.map(c => {
                      const preferred = activePreferred.includes(c.ticker)
                      const rank = activePreferred.indexOf(c.ticker)
                      return (
                        <tr key={`${activeCandidateCategory}-${c.ticker}`}>
                          <td>
                            <button
                              className={preferred ? 'btn btn-success' : 'btn btn-secondary'}
                              onClick={() => togglePreferredCandidate(activeCandidateCategory, c.ticker)}
                              style={{ padding: '0.2rem 0.55rem', fontSize: '0.75rem' }}
                            >
                              {preferred ? 'Preferred' : 'Prefer'}
                            </button>
                          </td>
                          <td>
                            {preferred ? (
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                                <button className="btn btn-secondary" onClick={() => movePreferredCandidate(activeCandidateCategory, c.ticker, -1)} disabled={rank <= 0} style={{ padding: '0.1rem 0.35rem' }}>^</button>
                                <span>{rank + 1}</span>
                                <button className="btn btn-secondary" onClick={() => movePreferredCandidate(activeCandidateCategory, c.ticker, 1)} disabled={rank === activePreferred.length - 1} style={{ padding: '0.1rem 0.35rem' }}>v</button>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ fontWeight: 700 }}>{c.ticker}</td>
                          <td style={{ textAlign: 'left', color: '#90a4ae' }}>{c.description || '-'}</td>
                          <td>{c.price != null ? fmt$(c.price) : 'Lookup on select'}</td>
                          <td style={{ color: c.suspicious_yield ? '#ffb74d' : undefined, fontWeight: c.suspicious_yield ? 700 : undefined }}>
                            {c.yield != null ? fmtPct(c.yield) : '-'} {c.suspicious_yield ? 'Review' : ''}
                          </td>
                          <td>{c.sample_monthly_income != null ? `+${fmt$(c.sample_monthly_income)}/mo` : '-'}</td>
                          <td style={{ color: c.nav_risk === 'Candidate' || c.nav_risk === 'Test' ? '#ffb74d' : '#90a4ae' }}>{c.nav_risk || '-'}</td>
                          <td>{c.source}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Trade Review & Execution</h2>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {removedTradeKeys.length > 0 && <button className="btn btn-secondary" onClick={restoreRemovedTrades}>Restore Removed</button>}
                <button className="btn btn-secondary" onClick={markAllReviewed} disabled={!effectiveTrades.length}>Mark All Reviewed</button>
                <button className="btn btn-primary" onClick={addManualTrade}>+ Manual Trade</button>
                <button className="btn btn-secondary" onClick={exportAuditJson} disabled={!result}>Export Scenario JSON</button>
                <button className="btn btn-secondary" onClick={exportBrokerCsv} disabled={!effectiveTrades.length || incomeFloorBreached}>Export Broker CSV</button>
                <button className="btn btn-secondary" onClick={exportCsv} disabled={!effectiveTrades.length || incomeFloorBreached}>Export CSV</button>
              </div>
            </div>
            {effectiveTrades.length === 0 ? (
              <p style={{ color: '#90a4ae' }}>No trades meet the current rules. Try adding cash, allowing sells, lowering the minimum trade size, or adjusting category targets.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="pb-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Ticker</th>
                      <th style={{ textAlign: 'left' }}>Category</th>
                      <th>Shares</th>
                      <th>Amount</th>
                      <th>Price</th>
                      <th>Yield</th>
                      <th>Income Impact</th>
                      <th>Yield After Trade</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'left' }}>Execution Note</th>
                      <th style={{ textAlign: 'left' }}>Reason</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveTrades.map((t, i) => {
                      const execution = tradeExecution[t._key] || { status: 'pending', note: '' }
                      return (
                      <tr key={t._key}>
                        <td style={{ color: t.action === 'buy' ? '#4dff91' : '#ff6b6b', fontWeight: 700 }}>
                          {String(t._key).startsWith('m-') ? (
                            <select
                              value={t.action}
                              onChange={e => updateTradeEdit(t._key, { action: e.target.value })}
                              style={{ minWidth: 78, fontWeight: 700 }}
                            >
                              <option value="buy">BUY</option>
                              <option value="sell">SELL</option>
                            </select>
                          ) : t.action.toUpperCase()}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {t.action === 'buy' && result.trades[t.generatedIndex]?.candidates?.length ? (
                            <select
                              value={t.ticker}
                              onChange={e => handleTradeTickerChange(t._key, result.trades[t.generatedIndex], e.target.value)}
                              style={{ minWidth: 95, fontWeight: 700 }}
                            >
                              {result.trades[t.generatedIndex].candidates.map(c => (
                                <option key={c.ticker} value={c.ticker}>
                                  {c.ticker} - {candidateSummary(c)}
                                </option>
                              ))}
                            </select>
                          ) : String(t._key).startsWith('m-') ? (
                            <input
                              value={t.ticker}
                              onChange={e => updateTradeEdit(t._key, { ticker: e.target.value.toUpperCase() })}
                              onBlur={e => lookupManualTicker(t._key, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') lookupManualTicker(t._key, e.currentTarget.value) }}
                              placeholder="Ticker"
                              style={{ width: 95, fontWeight: 700, textAlign: 'center' }}
                            />
                          ) : t.ticker}
                          {t.loading && <span style={{ color: '#8899aa', marginLeft: 6, fontSize: '0.75rem' }}>...</span>}
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          {String(t._key).startsWith('m-') ? (
                            <select value={t.category} onChange={e => updateTradeEdit(t._key, { category: e.target.value })} style={{ minWidth: 130 }}>
                              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : t.category}
                        </td>
                        <td>{t.shares != null ? Number(t.shares).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '-'}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={Number(t.amount || 0)}
                            onChange={e => updateTradeEdit(t._key, { amount: e.target.value })}
                            style={{ width: 105, textAlign: 'right' }}
                          />
                        </td>
                        <td style={{ color: t.suspicious_yield ? '#ffb74d' : undefined, fontWeight: t.suspicious_yield ? 700 : undefined }}>
                          {String(t._key).startsWith('m-') ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={Number(t.price || 0)}
                              onChange={e => updateTradeEdit(t._key, { price: e.target.value })}
                              style={{ width: 86, textAlign: 'right' }}
                            />
                          ) : t.price ? fmt$(t.price) : '-'}
                        </td>
                        <td>
                          {String(t._key).startsWith('m-') ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={Number(t.yield || 0)}
                              onChange={e => updateTradeEdit(t._key, { yield: e.target.value })}
                              style={{ width: 72, textAlign: 'right' }}
                            />
                          ) : fmtPct(t.yield)}
                          {t.suspicious_yield && <div style={{ color: '#ffb74d', fontSize: '0.7rem', marginTop: 2 }}>Review</div>}
                        </td>
                        <td style={{ color: t.monthly_income_delta >= 0 ? '#4dff91' : '#ff6b6b', fontWeight: 700 }}>
                          {t.monthly_income_delta >= 0 ? '+' : '-'}{fmt$(Math.abs(t.monthly_income_delta))}
                        </td>
                        <td style={{ color: cumulativeTradeYields[t._key] + 0.0001 >= Number(result.required.yield || 0) ? '#4dff91' : '#ff6b6b', fontWeight: 700 }}>
                          {fmtPct(cumulativeTradeYields[t._key])}
                        </td>
                        <td>
                          <select
                            value={execution.status || 'pending'}
                            onChange={e => updateTradeExecution(t._key, { status: e.target.value })}
                            style={{ minWidth: 96 }}
                          >
                            <option value="pending">Pending</option>
                            <option value="reviewed">Reviewed</option>
                            <option value="placed">Placed</option>
                            <option value="filled">Filled</option>
                            <option value="skipped">Skipped</option>
                          </select>
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          <input
                            value={execution.note || ''}
                            onChange={e => updateTradeExecution(t._key, { note: e.target.value })}
                            placeholder="Order note"
                            style={{ width: 160 }}
                          />
                        </td>
                        <td style={{ textAlign: 'left', color: '#90a4ae', fontSize: '0.82rem' }}>{t.reason}</td>
                        <td>
                          <button
                            className="btn btn-danger"
                            onClick={() => removeTrade(t._key)}
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
