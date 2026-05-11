import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'

function CategoryModal({ category, onSave, onCancel }) {
  const [name, setName] = useState(category?.name || '')
  const [target, setTarget] = useState(category?.target_pct ?? '')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), target_pct: target !== '' ? parseFloat(target) : null })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onCancel}>&times;</button>
        <h2>{category ? 'Edit Category' : 'New Category'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required maxLength={100} style={{ width: '100%' }} autoFocus />
          </div>
          <div className="form-group">
            <label>Target Allocation %</label>
            <input type="number" step="0.1" min="0" max="100" value={target} onChange={e => setTarget(e.target.value)} placeholder="Optional" style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-success">{category ? 'Update' : 'Create'}</button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function QualityDetailsModal({ row, onClose, fmt, fmtPct }) {
  if (!row) return null
  const tickers = row.quality?.tickers || []
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 820 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2 style={{ marginBottom: '0.35rem' }}>{row.name} Quality Details</h2>
        <p style={{ color: '#90a4ae', marginBottom: '1rem' }}>
          Score {row.quality.score} {row.quality.label} based on the suggested {fmtPct(row.suggested_pct)} allocation.
        </p>
        <p style={{ color: '#b0bec5', marginBottom: '1rem', fontSize: '0.86rem' }}>
          Confirmed NAV risk means the ticker has a high benchmark-adjusted NAV ratio. NAV-monitor tickers are products the app keeps an eye on for NAV erosion, but they are not scored as high NAV risk unless that ratio is above the high-risk threshold.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
          {(row.quality.reasons || []).map(reason => (
            <span key={reason} style={{ border: '1px solid #0f3460', background: '#1a1a2e', color: '#b0bec5', borderRadius: 4, padding: '0.25rem 0.45rem', fontSize: '0.78rem', fontWeight: 700 }}>
              {reason}
            </span>
          ))}
        </div>
        {tickers.length === 0 ? (
          <p style={{ color: '#b0bec5' }}>No individual ticker is driving a quality flag at this suggested allocation.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Ticker</th>
                  <th style={{ textAlign: 'left' }}>Drivers</th>
                  <th>Portfolio</th>
                  <th>Category</th>
                  <th>Income Share</th>
                  <th>Yield</th>
                  <th>Gain/Loss</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map(ticker => (
                  <tr key={ticker.ticker}>
                    <td style={{ textAlign: 'left', fontWeight: 700, color: '#7ecfff' }}>{ticker.ticker}</td>
                    <td style={{ textAlign: 'left', color: '#b0bec5' }}>{ticker.drivers.join('; ')}</td>
                    <td>{fmtPct(ticker.portfolio_pct)}</td>
                    <td>{fmtPct(ticker.category_pct)}</td>
                    <td>{fmtPct(ticker.income_share_pct)}</td>
                    <td>{fmtPct(ticker.yield_pct)}</td>
                    <td style={{ color: ticker.gain_loss_pct < -10 ? '#ff6b6b' : '#b0bec5' }}>{fmtPct(ticker.gain_loss_pct)}</td>
                    <td>{fmt(ticker.current_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function AllocationBar({ categories, totalValue }) {
  if (!totalValue) return null
  const colors = ['#7ecfff', '#00e89a', '#ffc107', '#ff6b6b', '#bb86fc', '#ff8a65', '#4dd0e1', '#aed581', '#f48fb1', '#90a4ae']
  const allocated = categories.reduce((s, c) => s + c.actual_value, 0)
  const unPct = ((totalValue - allocated) / totalValue * 100)
  return (
    <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', background: '#1a1a2e', border: '1px solid #0f3460', marginBottom: '1rem' }}>
      {categories.map((c, i) => {
        const pct = c.actual_pct
        if (pct <= 0) return null
        return (
          <div key={c.id} title={`${c.name}: ${pct.toFixed(1)}%`} style={{
            width: `${pct}%`, background: colors[i % colors.length],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.65rem', fontWeight: 700, color: '#1a1a2e', overflow: 'hidden', whiteSpace: 'nowrap',
          }}>
            {pct > 5 ? `${c.name} ${pct.toFixed(1)}%` : ''}
          </div>
        )
      })}
      {unPct > 0 && (
        <div title={`Unallocated: ${unPct.toFixed(1)}%`} style={{
          width: `${unPct}%`, background: '#455a64',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.65rem', color: '#ccc', overflow: 'hidden',
        }}>
          {unPct > 5 ? `Unallocated ${unPct.toFixed(1)}%` : ''}
        </div>
      )}
    </div>
  )
}

function ConstraintSlider({ label, value, min, max, step = 1, unit = '%', prefix = '', onChange, help, numeric = false }) {
  const display = `${prefix}${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: step < 1 ? 1 : 0 })}${unit}`
  const handleChange = (e) => onChange(Number(e.target.value))
  const handleNumberChange = (e) => {
    const next = Math.max(min, Number(e.target.value || 0))
    onChange(next)
  }
  return (
    <label className="cat-constraint">
      <span className="cat-constraint-top">
        <span>{label}</span>
        {numeric ? (
          <span className="cat-constraint-number-wrap">
            {prefix && <span>{prefix}</span>}
            <input
              type="number"
              min={min}
              step={step}
              value={value}
              onChange={handleNumberChange}
              onClick={e => e.stopPropagation()}
            />
            {unit && <span>{unit}</span>}
          </span>
        ) : (
          <strong>{display}</strong>
        )}
      </span>
      <input
        type="range"
        min={min}
        max={Math.max(max, Number(value || 0))}
        step={step}
        value={Math.min(Number(value || 0), Math.max(max, Number(value || 0)))}
        onInput={handleChange}
        onChange={handleChange}
      />
      {help && <span className="cat-constraint-help">{help}</span>}
    </label>
  )
}

function enrichCategoryData(categoryData, holdings = [], navCoverage = null) {
  const activeHoldings = holdings.filter(h => Number(h.quantity || 0) > 0)
  const holdingMap = Object.fromEntries(activeHoldings.map(h => [String(h.ticker || '').toUpperCase(), h]))
  const navCoverageMap = Object.fromEntries((navCoverage?.results || []).map(row => [
    String(row.ticker || '').toUpperCase(),
    row,
  ]))
  const totalValue = Number(categoryData.total_value || 0) || activeHoldings.reduce((s, h) => s + Number(h.current_value || 0), 0)
  const totalMonthlyIncome = activeHoldings.reduce((s, h) => s + Number(h.approx_monthly_income || 0), 0)
  const totalAnnualIncome = activeHoldings.reduce((s, h) => s + Number(h.estim_payment_per_year || 0), 0) || totalMonthlyIncome * 12
  const isWeekly = (freq) => ['W', '52', 'WEEKLY'].includes(String(freq || '').trim().toUpperCase())
  const weeklyValue = activeHoldings.reduce((s, h) => s + (isWeekly(h.div_frequency) ? Number(h.current_value || 0) : 0), 0)
  const weeklyIncome = activeHoldings.reduce((s, h) => s + (isWeekly(h.div_frequency) ? Number(h.approx_monthly_income || 0) : 0), 0)

  const enrichTicker = (tickerRow) => {
    const key = String(tickerRow.ticker || '').toUpperCase()
    const holding = holdingMap[key] || {}
    const value = Number(tickerRow.current_value ?? holding.current_value ?? 0)
    const monthlyIncome = Number(tickerRow.monthly_income ?? holding.approx_monthly_income ?? 0)
    const freq = tickerRow.div_frequency ?? holding.div_frequency
    const navMeta = navCoverageMap[key] || {}
    const navCoverageRatio = Number(navMeta.coverage_ratio)
    const hasNavCoverageRatio = Number.isFinite(navCoverageRatio)
    const navScope = String(tickerRow.nav_erosion_scope ?? holding.nav_erosion_scope ?? 'auto').trim().toLowerCase()
    const navCandidate = Boolean(tickerRow.nav_risk) || navScope === 'test' || Boolean(navMeta.nav_tested)
    return {
      ...tickerRow,
      classification_type: tickerRow.classification_type ?? holding.classification_type,
      current_value: value,
      monthly_income: monthlyIncome,
      current_yield: value > 0 ? monthlyIncome * 12 / value * 100 : 0,
      div_frequency: freq,
      weekly: tickerRow.weekly ?? isWeekly(freq),
      nav_erosion_scope: tickerRow.nav_erosion_scope ?? holding.nav_erosion_scope,
      nav_candidate: navCandidate,
      nav_coverage_ratio: hasNavCoverageRatio ? navCoverageRatio : null,
      nav_tested: Boolean(navMeta.nav_tested),
      nav_benchmark: navMeta.benchmark,
      nav_risk: hasNavCoverageRatio && navCoverageRatio > 0.75,
      gain_or_loss_percentage: Number(tickerRow.gain_or_loss_percentage ?? holding.gain_or_loss_percentage ?? 0),
    }
  }

  const categories = (categoryData.categories || []).map(cat => {
    const tickers = (cat.tickers || []).map(enrichTicker)
    const catValue = tickers.reduce((s, t) => s + Number(t.current_value || 0), 0)
    const catMonthlyIncome = tickers.reduce((s, t) => s + Number(t.monthly_income || 0), 0)
    const catWeeklyValue = tickers.reduce((s, t) => s + (t.weekly ? Number(t.current_value || 0) : 0), 0)
    const catWeeklyIncome = tickers.reduce((s, t) => s + (t.weekly ? Number(t.monthly_income || 0) : 0), 0)
    const catNavRiskValue = tickers.reduce((s, t) => s + (t.nav_risk ? Number(t.current_value || 0) : 0), 0)
    const largestHoldingPct = catValue > 0 ? Math.max(0, ...tickers.map(t => Number(t.current_value || 0))) / catValue * 100 : 0
    const incomeConcentrationPct = catMonthlyIncome > 0 ? Math.max(0, ...tickers.map(t => Number(t.monthly_income || 0))) / catMonthlyIncome * 100 : 0
    const weightedGainLoss = catValue > 0
      ? tickers.reduce((s, t) => s + Number(t.gain_or_loss_percentage || 0) * Number(t.current_value || 0), 0) / catValue
      : 0
    return {
      ...cat,
      tickers,
      actual_value: catValue || Number(cat.actual_value || 0),
      actual_pct: totalValue ? (catValue || Number(cat.actual_value || 0)) / totalValue * 100 : 0,
      monthly_income: catMonthlyIncome,
      current_yield: catValue > 0 ? catMonthlyIncome * 12 / catValue * 100 : 0,
      weekly_value: catWeeklyValue,
      weekly_income: catWeeklyIncome,
      weekly_value_pct: catValue > 0 ? catWeeklyValue / catValue * 100 : 0,
      nav_risk_value_pct: catValue > 0 ? catNavRiskValue / catValue * 100 : 0,
      nav_risk_count: tickers.filter(t => t.nav_risk).length,
      largest_holding_pct: largestHoldingPct,
      income_concentration_pct: incomeConcentrationPct,
      weighted_gain_loss_pct: weightedGainLoss,
    }
  })

  const assigned = new Set(categories.flatMap(cat => cat.tickers.map(t => String(t.ticker || '').toUpperCase())))
  const unallocatedFromHoldings = activeHoldings
    .filter(h => !assigned.has(String(h.ticker || '').toUpperCase()))
    .map(h => enrichTicker({ ticker: h.ticker, description: h.description, current_value: h.current_value }))
  const unallocated = (categoryData.unallocated || []).length
    ? categoryData.unallocated.map(enrichTicker)
    : unallocatedFromHoldings

  return {
    ...categoryData,
    categories,
    unallocated,
    total_value: totalValue,
    monthly_income: totalMonthlyIncome,
    portfolio_yield: totalValue > 0 ? totalAnnualIncome / totalValue * 100 : 0,
    weekly_value: weeklyValue,
    weekly_income: weeklyIncome,
    weekly_value_pct: totalValue > 0 ? weeklyValue / totalValue * 100 : 0,
  }
}

export default function Categories() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const dialog = useDialog()
  const navigate = useNavigate()
  const [data, setData] = useState({ categories: [], unallocated: [], total_value: 0 })
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editCat, setEditCat] = useState(null)
  const [selectedUnalloc, setSelectedUnalloc] = useState(new Set())
  const [error, setError] = useState(null)
  const [assistantMode, setAssistantMode] = useState('balanced')
  const [qualityDetail, setQualityDetail] = useState(null)
  const [constraints, setConstraints] = useState({
    minimumMonthlyIncome: 0,
    maxCategoryPct: 35,
    maxHighYieldCategoryPct: 18,
    maxAllowedDrift: 8,
    minimumAnchorAllocation: 30,
    incomeGrowthPriority: 50,
  })
  const [constraintsSeeded, setConstraintsSeeded] = useState(false)
  const [incomeFloorTouched, setIncomeFloorTouched] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [catRes, holdingsRes, navCoverageRes] = await Promise.all([
        pf('/api/categories/data'),
        pf('/api/holdings').catch(() => null),
        pf('/api/portfolio-coverage').catch(() => null),
      ])
      const d = await catRes.json()
      const holdings = holdingsRes ? await holdingsRes.json() : []
      const navCoverage = navCoverageRes ? await navCoverageRes.json() : null
      setData({
        ...enrichCategoryData(d, Array.isArray(holdings) ? holdings : [], navCoverage),
        _selection: selection,
      })
    } catch (e) {
      setError('Failed to load categories')
    } finally {
      setLoading(false)
    }
  }, [pf, selection])

  useEffect(() => { reload() }, [reload, selection])

  useEffect(() => {
    setConstraintsSeeded(false)
    setIncomeFloorTouched(false)
  }, [selection])

  useEffect(() => {
    if (data._selection !== selection || constraintsSeeded || incomeFloorTouched || !data.monthly_income) return
    setConstraints(prev => ({
      ...prev,
      minimumMonthlyIncome: Math.floor(Number(data.monthly_income || 0)),
    }))
    setConstraintsSeeded(true)
  }, [constraintsSeeded, incomeFloorTouched, data.monthly_income, data._selection, selection])

  const fmt = (v) => v != null ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'
  const fmtPct = (v) => Number(v || 0).toFixed(1) + '%'
  const setConstraint = (key, value) => {
    if (key === 'minimumMonthlyIncome') {
      setIncomeFloorTouched(true)
      setConstraintsSeeded(true)
    }
    setConstraints(prev => ({ ...prev, [key]: value }))
  }
  const incomeSliderMax = Math.max(
    500,
    Math.ceil(Number(data.monthly_income || 0) * 2 / 50) * 50,
    Math.ceil(Number(constraints.minimumMonthlyIncome || 0) * 1.5 / 50) * 50,
  )

  const handleCreate = () => { setEditCat(null); setShowModal(true) }
  const handleEdit = (cat) => { setEditCat(cat); setShowModal(true) }

  const handleSave = async ({ name, target_pct }) => {
    setError(null)
    if (target_pct != null) {
      const otherTotal = data.categories
        .filter(c => !editCat || c.id !== editCat.id)
        .reduce((s, c) => s + (Number(c.target_pct) || 0), 0)
      if (otherTotal + target_pct > 100) {
        setError(`Target allocation would total ${(otherTotal + target_pct).toFixed(1)}% — cannot exceed 100%. Available: ${(100 - otherTotal).toFixed(1)}%`)
        return
      }
    }
    try {
      if (editCat) {
        await pf(`/api/categories/${editCat.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct }),
        })
      } else {
        await pf('/api/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct }),
        })
      }
      setShowModal(false)
      reload()
    } catch (e) { setError(e.message) }
  }

  const handleDelete = async (cat) => {
    if (!await dialog.confirm(`Delete category "${cat.name}"? Tickers will become unallocated.`)) return
    await pf(`/api/categories/${cat.id}`, { method: 'DELETE' })
    if (expandedId === cat.id) setExpandedId(null)
    reload()
  }

  const handleAssign = async (tickers, categoryId) => {
    await pf('/api/categories/assign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId, tickers }),
    })
    setSelectedUnalloc(new Set())
    reload()
  }

  const handleUnassign = async (tickers) => {
    await pf('/api/categories/unassign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    })
    reload()
  }

  const toggleUnalloc = (ticker) => {
    setSelectedUnalloc(prev => {
      const next = new Set(prev)
      next.has(ticker) ? next.delete(ticker) : next.add(ticker)
      return next
    })
  }

  const handleUnallocClick = (ticker) => {
    if (expandedId) {
      handleAssign([ticker], expandedId)
    } else {
      toggleUnalloc(ticker)
    }
  }

  const applySuggestedTargets = async (openWizard = false) => {
    if (!targetAssistant?.rows?.length) return
    const ok = await dialog.confirm(openWizard
      ? 'Save these suggested category targets, then open Rebalance Wizard to build the trade list?'
      : 'Save these suggested percentages as your category targets?')
    if (!ok) return
    setError(null)
    try {
      for (const row of targetAssistant.rows) {
        await pf(`/api/categories/${row.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_pct: Number(row.suggested_pct.toFixed(1)) }),
        })
      }
      await reload()
      if (openWizard) {
        try {
          sessionStorage.setItem('categoryTargetAssistantHandoff', JSON.stringify({
            min_monthly_income: Number(constraints.minimumMonthlyIncome || 0),
            rebalance_strategy: assistantMode === 'preserve_income'
              ? 'match_targets_preserve_income'
              : 'maximize_income_reduce_drift',
          }))
        } catch {
          // Non-critical: navigation still works if session storage is unavailable.
        }
        navigate('/rebalance-wizard')
      }
    } catch (e) {
      setError(e.message || 'Could not save the suggested category targets.')
    }
  }

  const allocatedCount = data.categories.reduce((s, c) => s + c.tickers.length, 0)
  const totalCount = allocatedCount + data.unallocated.length
  const allocatedValue = data.categories.reduce((s, c) => s + c.actual_value, 0)
  const allocatedPct = data.total_value ? (allocatedValue / data.total_value * 100) : 0
  const totalTargetPct = data.categories.reduce((s, c) => s + (Number(c.target_pct) || 0), 0)

  const targetAssistant = useMemo(() => {
    const cats = data.categories.filter(c => Number(c.actual_value || 0) > 0)
    if (!cats.length || !data.total_value) return null

    const existingTargetsValid = Math.abs(totalTargetPct - 100) <= 0.2
    const hasPortfolioIncomeData = data.monthly_income != null || data.portfolio_yield != null
    const currentMonthly = hasPortfolioIncomeData ? Number(data.monthly_income || 0) : null
    const portfolioYield = hasPortfolioIncomeData
      ? Number(data.portfolio_yield || 0) || (data.total_value ? Number(currentMonthly || 0) * 12 / data.total_value * 100 : 0)
      : null
    const hasPortfolioWeeklyData = data.weekly_value_pct != null || data.weekly_value != null
    const avgWeekly = hasPortfolioWeeklyData
      ? Number(data.weekly_value_pct ?? (data.total_value ? Number(data.weekly_value || 0) / data.total_value * 100 : 0))
      : null
    const suspiciousYield = Math.max(25, Number(portfolioYield || 0) * 2)
    const incomeFloor = Math.max(0, Number(constraints.minimumMonthlyIncome || 0))
    const maxCategoryPct = Math.max(1, Number(constraints.maxCategoryPct || 100))
    const maxHighYieldCategoryPct = Math.max(1, Number(constraints.maxHighYieldCategoryPct || 100))
    const maxAllowedDrift = Math.max(0, Number(constraints.maxAllowedDrift || 0))
    const minimumAnchorAllocation = Math.max(0, Number(constraints.minimumAnchorAllocation || 0))
    const incomeGrowthPriority = Math.max(0, Math.min(100, Number(constraints.incomeGrowthPriority || 0)))
    const modeConfigs = {
      balanced: { label: 'Balanced', income: 0.22, weekly: -0.04, current: 0.45 },
      preserve_income: { label: 'Preserve income', income: 0.42, weekly: -0.02, current: 0.25 },
      reduce_drift: { label: 'Reduce target drift', income: 0.08, weekly: -0.02, current: 0.75 },
    }
    const isAnchor = (cat) => /anchor/i.test(cat.name || '')
    const categoryMonthlyIncome = (cat) => {
      const direct = Number(cat.monthly_income)
      if (Number.isFinite(direct) && direct > 0) return direct
      return (cat.tickers || []).reduce((sum, ticker) => (
        sum + Number(ticker.monthly_income ?? ticker.approx_monthly_income ?? 0)
      ), 0)
    }
    const categoryYield = (cat) => {
      const direct = Number(cat.current_yield)
      if (Number.isFinite(direct) && direct > 0) return direct
      const value = Number(cat.actual_value || 0)
      const monthly = categoryMonthlyIncome(cat)
      return value > 0 && monthly > 0 ? monthly * 12 / value * 100 : 0
    }
    const isHighYield = (cat) => /juicer|high.?yield|yield/i.test(cat.name || '') || categoryYield(cat) > suspiciousYield

    const normalizeWithCaps = (items) => {
      const rows = items.map(item => {
        const actual = Number(item.actual_pct || 0)
        const highYieldCap = isHighYield(item) ? maxHighYieldCategoryPct : maxCategoryPct
        const cap = Math.min(maxCategoryPct, highYieldCap, actual + maxAllowedDrift || 100)
        const floor = Math.max(0, actual - maxAllowedDrift)
        return {
          ...item,
          suggested_pct_raw: Math.max(floor, Math.min(cap, item.suggested_pct_raw)),
          cap,
          floor,
        }
      })

      for (let pass = 0; pass < 8; pass += 1) {
        const total = rows.reduce((s, r) => s + r.suggested_pct_raw, 0)
        const delta = 100 - total
        if (Math.abs(delta) < 0.01) break
        const adjustable = rows.filter(r => delta > 0 ? r.suggested_pct_raw < r.cap - 0.01 : r.suggested_pct_raw > r.floor + 0.01)
        if (!adjustable.length) break
        const room = adjustable.reduce((s, r) => s + (delta > 0 ? r.cap - r.suggested_pct_raw : r.suggested_pct_raw - r.floor), 0) || 1
        adjustable.forEach(row => {
          const capacity = delta > 0 ? row.cap - row.suggested_pct_raw : row.suggested_pct_raw - row.floor
          const move = Math.min(Math.abs(delta) * capacity / room, capacity)
          row.suggested_pct_raw += delta > 0 ? move : -move
        })
      }
      return rows
    }

    const qualityTickerRows = (cat, allocationPct = Number(cat.actual_pct || 0)) => {
      const categoryValue = Number(cat.actual_value || 0)
      return (cat.tickers || []).map(ticker => {
        const currentValue = Number(ticker.current_value || 0)
        const categoryPct = categoryValue > 0 ? currentValue / categoryValue * 100 : 0
        const portfolioPct = allocationPct * categoryPct / 100
        const monthlyIncome = Number(ticker.monthly_income ?? ticker.approx_monthly_income ?? 0)
        const incomeSharePct = currentMonthly > 0 ? monthlyIncome / currentMonthly * 100 : 0
        const yieldPct = currentValue > 0 ? monthlyIncome * 12 / currentValue * 100 : Number(ticker.current_yield || 0)
        const gainLossPct = Number(ticker.gain_or_loss_percentage || 0)
        const navCoverageRatio = Number(ticker.nav_coverage_ratio)
        const drivers = []
        if (ticker.nav_risk) drivers.push(Number.isFinite(navCoverageRatio) ? `${ticker.ticker} high NAV ratio ${navCoverageRatio.toFixed(2)}` : `${ticker.ticker} high NAV erosion`)
        else if (ticker.nav_candidate) drivers.push(Number.isFinite(navCoverageRatio) ? `${ticker.ticker} NAV monitor, ratio ${navCoverageRatio.toFixed(2)}` : `${ticker.ticker} NAV monitor, ratio unavailable`)
        if (ticker.weekly) drivers.push('weekly payer')
        if (portfolioPct > 12) drivers.push('large portfolio position')
        if (incomeSharePct > 12) drivers.push('large income source')
        if (yieldPct > suspiciousYield) drivers.push('high-yield reliance')
        if (gainLossPct < -10) drivers.push('weak recent return')
        return {
          ticker: ticker.ticker,
          current_value: currentValue,
          category_pct: categoryPct,
          portfolio_pct: portfolioPct,
          income_share_pct: incomeSharePct,
          yield_pct: yieldPct,
          gain_loss_pct: gainLossPct,
          nav_coverage_ratio: Number.isFinite(navCoverageRatio) ? navCoverageRatio : null,
          drivers,
        }
      })
        .filter(ticker => ticker.drivers.length)
        .sort((a, b) => b.drivers.length - a.drivers.length || b.portfolio_pct - a.portfolio_pct)
    }

    const qualityFor = (cat, allocationPct = Number(cat.actual_pct || 0)) => {
      const y = categoryYield(cat)
      const nav = Number(cat.nav_risk_value_pct || 0)
      const largest = Number(cat.largest_holding_pct || 0)
      const incomeConc = Number(cat.income_concentration_pct || 0)
      const weekly = Number(cat.weekly_value_pct || 0)
      const gain = Number(cat.weighted_gain_loss_pct || 0)
      const portfolioNav = allocationPct * nav / 100
      const portfolioLargest = allocationPct * largest / 100
      const categoryIncomeShare = currentMonthly > 0 ? categoryMonthlyIncome(cat) / currentMonthly * 100 : 0
      const portfolioIncomeConcentration = categoryIncomeShare * incomeConc / 100
      const portfolioWeekly = allocationPct * weekly / 100
      let score = 82
      if (portfolioYield != null && y >= portfolioYield * 0.8 && y <= suspiciousYield) score += 6
      if (y > suspiciousYield) score -= 12
      if (portfolioNav > 15) score -= 14
      else if (portfolioNav > 8) score -= 8
      else if (portfolioNav > 4) score -= 4
      if (portfolioLargest > 20) score -= 10
      else if (portfolioLargest > 12) score -= 5
      if (portfolioIncomeConcentration > 20) score -= 10
      else if (portfolioIncomeConcentration > 12) score -= 5
      if (portfolioWeekly > 20) score -= 8
      else if (portfolioWeekly > 12) score -= 4
      if (gain > 10) score += 5
      else if (gain < -10) score -= 5
      score = Math.max(0, Math.min(100, Math.round(score)))
      const reasons = []
      if (y > suspiciousYield) reasons.push('high-yield reliance')
      if (portfolioNav > 4) reasons.push(`NAV-risk ${portfolioNav.toFixed(1)}% of portfolio`)
      if (portfolioLargest > 12) reasons.push(`largest holding ${portfolioLargest.toFixed(1)}% of portfolio`)
      if (portfolioIncomeConcentration > 12) reasons.push(`largest income source ${portfolioIncomeConcentration.toFixed(1)}% of income`)
      if (portfolioWeekly > 12) reasons.push(`weekly payers ${portfolioWeekly.toFixed(1)}% of portfolio`)
      if (gain < -10) reasons.push('weak recent return')
      if (!reasons.length) reasons.push('balanced portfolio impact')
      return {
        score,
        label: score >= 78 ? 'Strong' : score >= 60 ? 'Watch' : 'Risky',
        reasons,
        tickers: qualityTickerRows(cat, allocationPct),
      }
    }

    const buildPlan = (modeKey) => {
      const mode = modeConfigs[modeKey] || modeConfigs.balanced
      const raw = cats.map(cat => {
      const actual = Number(cat.actual_pct || 0)
      const existing = Number(cat.target_pct ?? actual)
      const base = existingTargetsValid ? (existing * (1 - mode.current) + actual * mode.current) : actual
      const incomeEdge = portfolioYield == null ? 0 : categoryYield(cat) - portfolioYield
      const weeklyEdge = avgWeekly == null ? 0 : Number(cat.weekly_value_pct || 0) - avgWeekly
      const incomeTilt = mode.income * (0.5 + incomeGrowthPriority / 50)
      const riskTrim = Number(cat.nav_risk_value_pct || 0) > 25 || Number(cat.income_concentration_pct || 0) > 35 ? (100 - incomeGrowthPriority) / 50 : 0
      const adjustment = Math.max(-6, Math.min(6, incomeEdge * incomeTilt + weeklyEdge * mode.weekly - riskTrim))
      return { ...cat, suggested_pct_raw: Math.max(0, base + adjustment) }
      })

      let constrained = normalizeWithCaps(raw)
      const anchorRows = constrained.filter(isAnchor)
      const anchorTotal = anchorRows.reduce((s, r) => s + r.suggested_pct_raw, 0)
      if (anchorRows.length && anchorTotal < minimumAnchorAllocation) {
        const need = minimumAnchorAllocation - anchorTotal
        const donors = constrained.filter(r => !isAnchor(r) && r.suggested_pct_raw > r.floor + 0.01)
        const donorRoom = donors.reduce((s, r) => s + r.suggested_pct_raw - r.floor, 0) || 1
        donors.forEach(row => {
          const move = Math.min(need * (row.suggested_pct_raw - row.floor) / donorRoom, row.suggested_pct_raw - row.floor)
          row.suggested_pct_raw -= move
        })
        const anchorRoom = anchorRows.reduce((s, r) => s + r.cap - r.suggested_pct_raw, 0) || 1
        anchorRows.forEach(row => {
          const move = Math.min(need * (row.cap - row.suggested_pct_raw) / anchorRoom, row.cap - row.suggested_pct_raw)
          row.suggested_pct_raw += move
        })
        constrained = normalizeWithCaps(constrained)
      }

      const rows = constrained.map(cat => {
      const suggested = cat.suggested_pct_raw
      const projectedValue = data.total_value * suggested / 100
      const yieldForProjection = categoryYield(cat)
      const hasIncomeProjection = yieldForProjection > 0
      const projectedMonthly = hasIncomeProjection ? projectedValue * yieldForProjection / 100 / 12 : null
      const hasWeeklyProjection = Number.isFinite(Number(cat.weekly_value_pct))
      const projectedWeeklyPct = hasWeeklyProjection ? suggested * Number(cat.weekly_value_pct || 0) / 100 : null
      const currentOrTarget = Number(cat.target_pct ?? cat.actual_pct ?? 0)
      const delta = suggested - currentOrTarget
      const reasons = []
      if (isAnchor(cat) && suggested > currentOrTarget + 0.2) reasons.push('improves income stability and supports the minimum anchor allocation')
      if (isHighYield(cat) && suggested < currentOrTarget - 0.2) reasons.push('reduces high-yield concentration and NAV risk')
      if (Number(cat.income_concentration_pct || 0) > 35) reasons.push('lowers income concentration')
      if (Number(cat.nav_risk_value_pct || 0) > 25) reasons.push('contains NAV-risk exposure')
      if (Math.abs(suggested - Number(cat.actual_pct || 0)) >= maxAllowedDrift - 0.05) reasons.push('respects the allowed drift limit')
      if (suggested >= maxCategoryPct - 0.05) reasons.push('held at the max category limit')
      if (isHighYield(cat) && suggested >= maxHighYieldCategoryPct - 0.05) reasons.push('held at the high-yield category limit')
      if (!reasons.length && delta > 0.2) reasons.push('adds to better income-adjusted category balance')
      if (!reasons.length && delta < -0.2) reasons.push('trims category drift while preserving income targets')
      if (!reasons.length) reasons.push('keeps allocation steady within the current constraints')
      return {
        ...cat,
        current_yield: yieldForProjection,
        suggested_pct: suggested,
        drift_dollars: (suggested - Number(cat.actual_pct || 0)) / 100 * data.total_value,
        projected_monthly_income: projectedMonthly,
        has_income_projection: hasIncomeProjection,
        has_weekly_projection: hasWeeklyProjection,
        projected_weekly_pct: projectedWeeklyPct,
        quality: qualityFor(cat, suggested),
        rationale: reasons.slice(0, 2).join('; ') + '.',
      }
      })

      const hasIncomeProjectionData = rows.some(r => r.has_income_projection)
      const projectedMonthly = hasIncomeProjectionData
        ? rows.reduce((s, r) => s + Number(r.projected_monthly_income || 0), 0)
        : null
      const hasWeeklyProjectionData = rows.some(r => r.has_weekly_projection)
      const projectedWeeklyPct = hasWeeklyProjectionData
        ? rows.reduce((s, r) => s + Number(r.projected_weekly_pct || 0), 0)
        : null
      const incomeShortfall = projectedMonthly == null ? 0 : Math.max(0, incomeFloor - projectedMonthly)
      const incomeFloorBreached = projectedMonthly != null && incomeShortfall > 0.01
      const requiredYield = data.total_value ? incomeFloor * 12 / data.total_value * 100 : 0
      const replacementAmount = rows.reduce((s, r) => s + Math.abs(r.drift_dollars), 0) || data.total_value
      const yieldNeededOnReplacements = replacementAmount > 0 ? incomeShortfall * 12 / replacementAmount * 100 : 0
      const avgQuality = rows.length ? rows.reduce((s, r) => s + Number(r.quality?.score || 0), 0) / rows.length : 0
      const totalMove = rows.reduce((s, r) => s + Math.abs(r.drift_dollars), 0)
      return {
        mode: modeKey,
        label: mode.label,
      rows,
      currentMonthly,
      projectedMonthly,
      incomeDelta: projectedMonthly == null || currentMonthly == null ? null : projectedMonthly - currentMonthly,
      incomeFloor,
      incomeShortfall,
      incomeFloorBreached,
      hasIncomeProjectionData,
      hasWeeklyProjectionData,
      requiredYield,
      suspiciousYield,
      yieldNeededOnReplacements,
      needsHighYieldReplacement: incomeFloorBreached && requiredYield > projectedMonthly * 12 / data.total_value * 100,
      currentYield: portfolioYield,
      projectedYield: data.total_value && projectedMonthly != null ? projectedMonthly * 12 / data.total_value * 100 : null,
      currentWeeklyPct: avgWeekly,
      projectedWeeklyPct,
        avgQuality,
        totalMove,
      constraintsApplied: {
        maxCategoryPct,
        maxHighYieldCategoryPct,
        maxAllowedDrift,
        minimumAnchorAllocation,
        incomeGrowthPriority,
      },
    }
    }

    const mixes = Object.keys(modeConfigs).map(buildPlan)
    const selected = mixes.find(mix => mix.mode === assistantMode) || mixes[0]
    return { ...selected, mixes }
  }, [data, assistantMode, totalTargetPct, constraints])

  const assistantRowsById = useMemo(() => {
    const rows = targetAssistant?.rows || []
    return Object.fromEntries(rows.map(row => [row.id, row]))
  }, [targetAssistant])

  const barColor = (cat) => {
    if (cat.target_pct == null) return '#7ecfff'
    const diff = Math.abs(cat.actual_pct - cat.target_pct)
    if (diff <= 3) return '#00e89a'
    if (diff <= 8) return '#ffc107'
    return '#ff6b6b'
  }

  if (loading) return <div className="page" style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Categories</h1>
        <button className="btn btn-success" onClick={handleCreate}>+ New Category</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Summary strip */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Allocated</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>{allocatedCount} / {totalCount} holdings</div>
          </div>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Allocated Value</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>{fmt(allocatedValue)} ({allocatedPct.toFixed(1)}%)</div>
          </div>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Total Value</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>{fmt(data.total_value)}</div>
          </div>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Monthly Income</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>
              {data.monthly_income == null ? 'Unavailable' : fmt(data.monthly_income)}
              {' '}
              ({data.portfolio_yield == null ? 'yield unavailable' : `${fmtPct(data.portfolio_yield)} yield`})
            </div>
          </div>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Weekly Exposure</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>
              {data.weekly_value_pct == null ? 'Unavailable' : `${fmtPct(data.weekly_value_pct)} value`}
            </div>
          </div>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Target Allocation</span>
            <div style={{ fontWeight: 700, color: totalTargetPct > 100 ? '#ff6b6b' : totalTargetPct === 100 ? '#00e89a' : '#ffc107' }}>
              {totalTargetPct.toFixed(1)}% / 100%
            </div>
          </div>
        </div>
        <AllocationBar categories={data.categories} totalValue={data.total_value} />
      </div>

      {targetAssistant && (
        <div className="card" style={{ padding: '1rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Target Assistant</h2>
              <p style={{ color: '#90a4ae', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                Use this to set target weights before rebalancing. Suggestions start with your current allocation, then adjust for income, concentration, weekly-payer exposure, NAV-risk flags, and the limits you set.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={assistantMode} onChange={e => setAssistantMode(e.target.value)}>
                <option value="balanced">Balanced</option>
                <option value="preserve_income">Preserve income</option>
                <option value="reduce_drift">Reduce target drift</option>
              </select>
              <button className="btn btn-success" onClick={() => applySuggestedTargets(false)}>Save Targets</button>
              <button className="btn btn-primary" onClick={() => applySuggestedTargets(true)}>Save & Build Trades</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.65rem', marginBottom: '0.85rem' }}>
            {targetAssistant.mixes.map(mix => (
              <button
                key={mix.mode}
                onClick={() => setAssistantMode(mix.mode)}
                className={assistantMode === mix.mode ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ textAlign: 'left', padding: '0.7rem 0.8rem', height: 'auto' }}
              >
                <div style={{ fontWeight: 800, marginBottom: 4 }}>{mix.label}</div>
                <div style={{ color: '#cfd8dc', fontSize: '0.78rem' }}>
                  Income: {mix.projectedMonthly == null ? 'Unavailable' : fmt(mix.projectedMonthly)}
                </div>
                <div style={{ color: mix.incomeFloorBreached ? '#ffb74d' : '#cfd8dc', fontSize: '0.78rem' }}>
                  Income floor: {mix.incomeFloorBreached ? `Short ${fmt(mix.incomeShortfall)}` : 'Met'}
                </div>
                <div style={{ color: '#cfd8dc', fontSize: '0.78rem' }}>
                  Quality: {mix.avgQuality.toFixed(0)} | Moves: {fmt(mix.totalMove)}
                </div>
              </button>
            ))}
          </div>

          <div className="cat-assistant-grid">
            <div className="cat-suggestion-panel">
              <div className="cat-panel-title">Suggested Targets</div>
              <div className="cat-suggestion-list">
                {targetAssistant.rows.map(row => (
                  <div key={row.id} className="cat-suggestion-row">
                    <div className="cat-suggestion-main">
                      <strong>{row.name}: {fmtPct(row.target_pct ?? row.actual_pct)} {'->'} {fmtPct(row.suggested_pct)}</strong>
                      <span style={{ color: row.suggested_pct >= Number(row.target_pct ?? row.actual_pct ?? 0) ? '#00e89a' : '#ff6b6b' }}>
                        {row.suggested_pct >= Number(row.target_pct ?? row.actual_pct ?? 0) ? '+' : ''}{(row.suggested_pct - Number(row.target_pct ?? row.actual_pct ?? 0)).toFixed(1)} pts
                      </span>
                    </div>
                    <p>{row.rationale}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="cat-constraints-panel">
              <div className="cat-panel-title">Limits Used For Suggestions</div>
              <ConstraintSlider
                label="Minimum acceptable monthly income"
                value={constraints.minimumMonthlyIncome}
                min={0}
                max={incomeSliderMax}
                step={1}
                prefix="$"
                unit=""
                onChange={v => setConstraint('minimumMonthlyIncome', v)}
                help="The assistant tries to keep projected income at or above this amount. Lower it only if you are comfortable giving up monthly income to improve allocation balance."
                numeric
              />
              <ConstraintSlider
                label="Max category"
                value={constraints.maxCategoryPct}
                min={5}
                max={60}
                onChange={v => setConstraint('maxCategoryPct', v)}
                help="Prevents any one category from becoming too large in the suggested target mix."
              />
              <ConstraintSlider
                label="Max high-yield category"
                value={constraints.maxHighYieldCategoryPct}
                min={5}
                max={40}
                onChange={v => setConstraint('maxHighYieldCategoryPct', v)}
                help="Applies a tighter cap to categories that are yield-heavy or behave like high-yield buckets."
              />
              <ConstraintSlider
                label="Max allowed drift"
                value={constraints.maxAllowedDrift}
                min={1}
                max={20}
                onChange={v => setConstraint('maxAllowedDrift', v)}
                help="Controls how far the assistant can move a category away from where it is today."
              />
              <ConstraintSlider
                label="Minimum anchor allocation"
                value={constraints.minimumAnchorAllocation}
                min={0}
                max={70}
                onChange={v => setConstraint('minimumAnchorAllocation', v)}
                help="Keeps a minimum allocation in categories with Anchor in the name, when those categories exist."
              />
              <ConstraintSlider
                label="Income growth priority"
                value={constraints.incomeGrowthPriority}
                min={0}
                max={100}
                onChange={v => setConstraint('incomeGrowthPriority', v)}
                help="Higher values favor income-producing categories; lower values favor balance and risk control."
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Projected Income</span>
              <div style={{ fontWeight: 700, color: targetAssistant.projectedMonthly == null ? '#ffc107' : targetAssistant.incomeDelta >= -0.01 ? '#00e89a' : '#ff6b6b' }}>
                {targetAssistant.projectedMonthly == null
                  ? 'Unavailable'
                  : `${fmt(targetAssistant.projectedMonthly)} / mo (${targetAssistant.incomeDelta == null ? 'current income unavailable' : `${targetAssistant.incomeDelta >= 0 ? '+' : '-'}${fmt(Math.abs(targetAssistant.incomeDelta))}`})`}
              </div>
            </div>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Minimum Income Target</span>
              <div style={{ fontWeight: 700, color: targetAssistant.incomeFloorBreached ? '#ff6b6b' : '#00e89a' }}>
                {fmt(targetAssistant.incomeFloor)} / mo
              </div>
            </div>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Projected Yield</span>
              <div style={{ fontWeight: 700, color: '#7ecfff' }}>
                {targetAssistant.currentYield == null ? 'Unavailable' : fmtPct(targetAssistant.currentYield)} {'->'} {targetAssistant.projectedYield == null ? 'Unavailable' : fmtPct(targetAssistant.projectedYield)}
              </div>
            </div>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Weekly Exposure</span>
              <div style={{ fontWeight: 700, color: '#7ecfff' }}>
                {targetAssistant.currentWeeklyPct == null ? 'Unavailable' : fmtPct(targetAssistant.currentWeeklyPct)}
                {' -> '}
                {targetAssistant.projectedWeeklyPct == null ? 'Unavailable' : fmtPct(targetAssistant.projectedWeeklyPct)}
              </div>
            </div>
          </div>

          {targetAssistant.incomeFloorBreached && (
            <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
              This target mix is projected to miss your monthly income target by {fmt(targetAssistant.incomeShortfall)}.
              You can lower the income target, choose a more income-focused mix, or let Rebalance Wizard look for higher-yield replacement buys. Required portfolio yield is {fmtPct(targetAssistant.requiredYield)}
              {targetAssistant.yieldNeededOnReplacements > 0 ? `, and the dollars being moved would need roughly +${fmtPct(targetAssistant.yieldNeededOnReplacements)} of extra yield.` : '.'}
            </div>
          )}

          {!targetAssistant.hasIncomeProjectionData && targetAssistant.incomeFloor > 0 && (
            <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
              Income check unavailable: this view does not have enough category yield or ticker income data to test the {fmt(targetAssistant.incomeFloor)} monthly target. The Rebalance Wizard will run the stricter income check before exports.
            </div>
          )}

          {!targetAssistant.hasWeeklyProjectionData && (
            <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
              Weekly-payer check unavailable: this view does not have enough payout-frequency data to estimate projected weekly exposure.
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table className="pb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Category</th>
                  <th>Current</th>
                  <th>Target</th>
                  <th>Suggested</th>
                  <th>Yield</th>
                  <th>Weekly</th>
                  <th>Quality</th>
                  <th>$ To Suggested</th>
                  <th style={{ textAlign: 'left' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {targetAssistant.rows.map(row => (
                  <tr key={row.id}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>{row.name}</td>
                    <td>{fmtPct(row.actual_pct)}</td>
                    <td>{row.target_pct == null ? '-' : fmtPct(row.target_pct)}</td>
                    <td style={{ color: '#00e89a', fontWeight: 700 }}>{fmtPct(row.suggested_pct)}</td>
                    <td>{fmtPct(row.current_yield)}</td>
                    <td>{fmtPct(row.weekly_value_pct)}</td>
                    <td title={row.quality.reasons.join(', ')} style={{ color: row.quality.score >= 78 ? '#00e89a' : row.quality.score >= 60 ? '#ffc107' : '#ff6b6b', fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', minWidth: 340, maxWidth: 380 }}>
                      <button
                        type="button"
                        onClick={() => setQualityDetail(row)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: 'inherit',
                          cursor: 'pointer',
                          font: 'inherit',
                          fontWeight: 700,
                          textAlign: 'center',
                          width: '100%',
                        }}
                      >
                        <div>{row.quality.score} {row.quality.label}</div>
                        <div style={{ color: '#8899aa', fontSize: '0.68rem', fontWeight: 600, marginTop: 2, lineHeight: 1.3, whiteSpace: 'normal' }}>
                          {row.quality.reasons.slice(0, 2).join('; ')}
                        </div>
                      </button>
                    </td>
                    <td style={{ color: row.drift_dollars >= 0 ? '#00e89a' : '#ff6b6b', fontWeight: 700 }}>
                      {row.drift_dollars >= 0 ? '+' : '-'}{fmt(Math.abs(row.drift_dollars))}
                    </td>
                    <td style={{ textAlign: 'left', color: '#b0bec5', whiteSpace: 'normal', minWidth: 240 }}>{row.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginTop: '1.5rem' }}>

        {/* Left: Category cards */}
        <div style={{ flex: '1 1 70%', minWidth: 0 }}>
          {data.categories.length === 0 && (
            <div className="card"><p style={{ color: '#90a4ae' }}>No categories yet. Create one or import holdings to auto-generate.</p></div>
          )}
          {data.categories.map(cat => {
            const expanded = expandedId === cat.id
            const assistantRow = assistantRowsById[cat.id]
            return (
              <div key={cat.id} className="card" style={{ marginBottom: '0.75rem', border: expanded ? '1px solid #1976d2' : undefined }}>
                {/* Header */}
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  onClick={() => setExpandedId(expanded ? null : cat.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                    <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{expanded ? '\u25BC' : '\u25B6'}</span>
                    <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{cat.name}</h2>
                    <span style={{ background: '#0f3460', padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.75rem', color: '#7ecfff' }}>
                      {cat.tickers.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    {cat.target_pct != null && (
                      <span style={{ fontSize: '0.8rem', color: '#8899aa' }}>Target: {cat.target_pct.toFixed(1)}%</span>
                    )}
                    {assistantRow?.quality && (
                      <button
                        type="button"
                        title={assistantRow.quality.reasons.join(', ')}
                        onClick={(e) => { e.stopPropagation(); setQualityDetail(assistantRow) }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: '0.8rem',
                          color: assistantRow.quality.score >= 78 ? '#00e89a' : assistantRow.quality.score >= 60 ? '#ffc107' : '#ff6b6b',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Quality: {assistantRow.quality.score}
                      </button>
                    )}
                    <span style={{ fontWeight: 700, color: barColor(cat), fontSize: '0.95rem' }}>
                      {cat.actual_pct.toFixed(1)}%
                    </span>
                    <span style={{ fontSize: '0.85rem', color: '#90a4ae' }}>{fmt(cat.actual_value)}</span>
                  </div>
                </div>

                {/* Allocation bar */}
                <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e', marginTop: '0.5rem', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(cat.actual_pct, 100)}%`, background: barColor(cat), borderRadius: 3, transition: 'width 0.3s' }} />
                </div>

                {/* Expanded: ticker list */}
                {expanded && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <button className="btn btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleEdit(cat) }}>Edit</button>
                      <button className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleDelete(cat) }}>Delete</button>
                      {cat.tickers.length > 0 && (
                        <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={(e) => { e.stopPropagation(); handleUnassign(cat.tickers.map(t => t.ticker)) }}>
                          Unassign All
                        </button>
                      )}
                    </div>
                    {cat.tickers.length === 0 ? (
                      <p style={{ color: '#8899aa', fontSize: '0.85rem', fontStyle: 'italic' }}>
                        {expandedId === cat.id ? 'Click a ticker on the right to assign it here' : 'No tickers assigned'}
                      </p>
                    ) : (
                      <table style={{ width: '100%', fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Ticker</th>
                            <th>Description</th>
                            <th style={{ textAlign: 'right' }}>Value</th>
                            <th style={{ textAlign: 'right' }}>Freq</th>
                            <th style={{ textAlign: 'right' }}>% of Category</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.tickers.map(t => (
                            <tr key={t.ticker}>
                              <td style={{ fontWeight: 600, color: '#64b5f6' }}>{t.ticker}</td>
                              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '-'}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(t.current_value)}</td>
                              <td style={{ textAlign: 'right', color: t.weekly ? '#00e89a' : '#90a4ae' }}>{t.weekly ? 'Weekly' : (t.div_frequency || '-')}</td>
                              <td style={{ textAlign: 'right' }}>{cat.actual_value ? (t.current_value / cat.actual_value * 100).toFixed(1) + '%' : '-'}</td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  style={{ background: 'none', border: 'none', color: '#ef9a9a', cursor: 'pointer', fontSize: '1rem', padding: '0 0.3rem' }}
                                  title="Unassign"
                                  onClick={(e) => { e.stopPropagation(); handleUnassign([t.ticker]) }}
                                >&times;</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Right: Unallocated assets */}
        <div style={{ flex: '0 0 28%', position: 'sticky', top: '1rem' }}>
          <div className="card">
            <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
              Unallocated Assets
              <span style={{ fontSize: '0.8rem', color: '#8899aa', marginLeft: '0.5rem' }}>({data.unallocated.length})</span>
            </h2>

            {expandedId && (
              <p style={{ fontSize: '0.78rem', color: '#00e89a', marginBottom: '0.5rem' }}>
                Click a ticker to assign to the selected category
              </p>
            )}

            {data.unallocated.length === 0 ? (
              <p style={{ color: '#8899aa', fontSize: '0.85rem' }}>All tickers are allocated!</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#64b5f6', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelectedUnalloc(new Set(data.unallocated.map(t => t.ticker)))}
                  >Select all</button>
                  <span style={{ color: '#455a64' }}>|</span>
                  <button
                    style={{ background: 'none', border: 'none', color: '#64b5f6', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelectedUnalloc(new Set())}
                  >Deselect</button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '55vh', overflow: 'auto' }}>
                  {data.unallocated.map(t => {
                    const selected = selectedUnalloc.has(t.ticker)
                    return (
                      <button
                        key={t.ticker}
                        onClick={() => handleUnallocClick(t.ticker)}
                        title={`${t.description || t.ticker} — ${fmt(t.current_value)}`}
                        style={{
                          padding: '0.25rem 0.6rem',
                          borderRadius: 14,
                          border: selected ? '1px solid #1976d2' : '1px solid #0f3460',
                          background: selected ? 'rgba(25, 118, 210, 0.2)' : '#1a1a2e',
                          color: selected ? '#90caf9' : '#7ecfff',
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                          transition: 'all 0.15s',
                        }}
                      >
                        {t.ticker}
                      </button>
                    )
                  })}
                </div>

                {!expandedId && selectedUnalloc.size > 0 && data.categories.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontSize: '0.8rem', color: '#90a4ae', display: 'block', marginBottom: '0.3rem' }}>
                      Assign {selectedUnalloc.size} selected to:
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {data.categories.map(cat => (
                        <button
                          key={cat.id}
                          className="btn btn-primary"
                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => handleAssign([...selectedUnalloc], cat.id)}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <CategoryModal
          category={editCat}
          onSave={handleSave}
          onCancel={() => setShowModal(false)}
        />
      )}

      {qualityDetail && (
        <QualityDetailsModal
          row={qualityDetail}
          onClose={() => setQualityDetail(null)}
          fmt={fmt}
          fmtPct={fmtPct}
        />
      )}
    </div>
  )
}
