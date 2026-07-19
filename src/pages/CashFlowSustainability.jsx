import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Plot from '../components/ThemedPlot'
import { useDialog } from '../components/DialogProvider'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'

const FREQUENCIES = [
  ['one_time', 'One time'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Every two weeks'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['semiannual', 'Twice a year'],
  ['annual', 'Annual'],
]

const EXPENSE_CATEGORIES = [
  'Housing', 'Utilities', 'Trash', 'HOA', 'Food', 'Transportation', 'Insurance', 'Healthcare',
  'Debt', 'Taxes', 'Personal', 'Entertainment', 'Travel', 'Giving', 'Subscriptions', 'Cell Phone',
  'Pet Care', 'Home Maintenance', 'Pest Control', 'Childcare', 'Other',
]

const INCOME_CATEGORIES = [
  'Employment', 'Pension', 'Social Security', 'Annuity', 'Rental',
  'Business', 'Other',
]

const SCENARIOS = [
  { key: 'bullish', label: 'Bull', color: '#00c853', detail: 'Distribution growth plus positive market movement' },
  { key: 'neutral', label: 'Neutral', color: '#f9a825', detail: 'Current distributions plus moderate market movement' },
  { key: 'bearish', label: 'Bear', color: '#e05555', detail: 'A larger market decline with a smaller distribution reduction' },
]

function currentMonth() {
  return localDateKey().slice(0, 7)
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftIsoDate(value, days) {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function blankItem(kind, month = currentMonth()) {
  const dueDate = `${month}-01`
  return {
    kind,
    name: '',
    amount: '',
    category: '',
    frequency: 'monthly',
    start_date: `${month}-01`,
    end_date: '',
    due_date: kind === 'expense' ? dueDate : '',
    pay_date: kind === 'expense' ? shiftIsoDate(dueDate, -2) : '',
    essential: kind === 'expense',
    tax_rate_pct: kind === 'income' ? 0 : '',
    annual_change_pct: '',
    notes: '',
    active: true,
  }
}

function money(value, digits = 0) {
  return formatMoney(value, { digits, zeroIfInvalid: true })
}

function movementCopy(value, subject) {
  const number = Number(value || 0)
  if (Math.abs(number) < 0.05) return `${subject} stay about the same`
  return `${subject} ${number > 0 ? 'rise' : 'fall'} ${Math.abs(number).toFixed(1)}%`
}

function statusCopy(status) {
  if (status === 'income_covered') return { label: 'All bills covered by income', tone: 'good' }
  if (status === 'funded_from_principal') return { label: 'Some shares must be sold', tone: 'warn' }
  return { label: 'Portfolio runs out', tone: 'bad' }
}

function SummaryTile({ label, value, sub, detail, tone = '' }) {
  return (
    <div className={`cf-summary-tile ${tone ? `cf-tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
      {detail && <small className="cf-summary-detail">{detail}</small>}
    </div>
  )
}

function ItemEditor({ kind, value, onChange, onSubmit, onCancel, saving }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const isEdit = Boolean(value.id)
  const categories = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const set = (field, next) => onChange({ ...value, [field]: next })
  const setDueDate = next => onChange({
    ...value,
    due_date: next,
    pay_date: shiftIsoDate(next, -2),
  })

  useEffect(() => {
    if (isEdit) setDetailsOpen(true)
  }, [isEdit])

  return (
    <form className="cf-item-editor" onSubmit={onSubmit}>
      <div className="cf-quick-fields">
        <label className="cf-grow">
          <span>{kind === 'expense' ? 'What do you spend money on?' : 'Income source'}</span>
          <input
            value={value.name}
            onChange={e => set('name', e.target.value)}
            placeholder={kind === 'expense' ? 'Mortgage, groceries, medication...' : 'Pension, salary, rental income...'}
            maxLength={120}
            required
          />
        </label>
        <label>
          <span>Amount</span>
          <div className="cf-money-input">
            <b>$</b>
            <input
              type="number"
              min="0"
              step="0.01"
              value={value.amount}
              onChange={e => set('amount', e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
        </label>
        <label>
          <span>Frequency</span>
          <select value={value.frequency} onChange={e => set('frequency', e.target.value)}>
            {FREQUENCIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Category <em>optional</em></span>
          <input
            list={`cf-${kind}-categories`}
            value={value.category}
            onChange={e => set('category', e.target.value)}
            placeholder="Choose or type"
          />
          <datalist id={`cf-${kind}-categories`}>
            {categories.map(category => <option key={category} value={category} />)}
          </datalist>
        </label>
        <button type="submit" className="btn btn-primary cf-save-item" disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save changes' : kind === 'expense' ? 'Add expense' : 'Add income'}
        </button>
      </div>

      <button
        type="button"
        className="cf-details-toggle"
        onClick={() => setDetailsOpen(open => !open)}
      >
        {detailsOpen ? 'Hide details' : 'Dates, taxes, inflation and notes'}
      </button>

      {detailsOpen && (
        <div className="cf-detail-fields">
          {kind === 'expense' && (
            <>
              <label>
                <span>Due date</span>
                <input type="date" value={value.due_date || ''} onInput={e => setDueDate(e.target.value)} required />
              </label>
              <label>
                <span>Pay by <em>defaults 2 days early</em></span>
                <input type="date" value={value.pay_date || ''} onInput={e => set('pay_date', e.target.value)} required />
              </label>
            </>
          )}
          <label>
            <span>{value.frequency === 'one_time' ? 'Active on' : 'Active from'}</span>
            <input type="date" value={value.start_date} onChange={e => set('start_date', e.target.value)} required />
          </label>
          {value.frequency !== 'one_time' && (
            <label>
              <span>Stop after <em>optional</em></span>
              <input type="date" value={value.end_date || ''} onChange={e => set('end_date', e.target.value)} />
            </label>
          )}
          <label>
            <span>Annual change % <em>optional</em></span>
            <input
              type="number"
              min="-100"
              max="100"
              step="0.1"
              value={value.annual_change_pct ?? ''}
              onChange={e => set('annual_change_pct', e.target.value)}
              placeholder={kind === 'expense' ? 'Use plan inflation' : '0'}
            />
          </label>
          {kind === 'income' ? (
            <label>
              <span>Estimated tax %</span>
              <input
                type="number"
                min="0"
                max="95"
                step="0.1"
                value={value.tax_rate_pct ?? ''}
                onChange={e => set('tax_rate_pct', e.target.value)}
              />
            </label>
          ) : (
            <label className="cf-check-field">
              <input type="checkbox" checked={Boolean(value.essential)} onChange={e => set('essential', e.target.checked)} />
              <span>Essential expense</span>
            </label>
          )}
          <label className="cf-notes-field">
            <span>Notes <em>optional</em></span>
            <input value={value.notes || ''} onChange={e => set('notes', e.target.value)} maxLength={1000} />
          </label>
          {isEdit && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel editing</button>
          )}
        </div>
      )}
    </form>
  )
}

function ItemTable({
  kind,
  items,
  onEdit,
  onDelete,
  onTogglePaid,
  onMove,
  onSaveOff,
  onRestore,
  saved = false,
}) {
  const frequencyLabel = Object.fromEntries(FREQUENCIES)
  if (!items.length) {
    return (
      <div className="cf-empty">
        {kind === 'expense'
          ? 'No expenses yet. Add the first bill above—the category is optional.'
          : 'No additional income added. Portfolio income is included automatically.'}
      </div>
    )
  }
  return (
    <div className="cf-table-wrap">
      <table className="cf-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Frequency</th>
            <th>Active from</th>
            {kind === 'expense' && <th>Due date</th>}
            {kind === 'expense' && <th>Pay by</th>}
            <th className="cf-num">Amount</th>
            {kind === 'income' && <th className="cf-num">Tax</th>}
            {kind === 'expense' && !saved && <th className="cf-center">Paid</th>}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            return (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  {item.notes && <small>{item.notes}</small>}
                </td>
                <td>{item.category || 'Uncategorized'}</td>
                <td>{frequencyLabel[item.frequency] || item.frequency}</td>
                <td>{item.start_date}</td>
                {kind === 'expense' && <td className="cf-date">{item.current_due_date || 'Complete'}</td>}
                {kind === 'expense' && <td className="cf-date">{item.current_pay_date || '—'}</td>}
                <td className="cf-num"><strong>{money(item.amount, 2)}</strong></td>
                {kind === 'income' && <td className="cf-num">{Number(item.tax_rate_pct || 0).toFixed(1)}%</td>}
                {kind === 'expense' && !saved && (
                  <td className="cf-center">
                    {item.current_due_date ? (
                      <input
                        type="checkbox"
                        checked={Boolean(item.paid)}
                        onChange={e => onTogglePaid(item, e.target.checked)}
                        title={`Mark the bill due ${item.current_due_date} as paid`}
                      />
                    ) : (
                      <span className="cf-muted-dash" title="No remaining occurrence">—</span>
                    )}
                  </td>
                )}
                <td className="cf-actions">
                  {!saved && <button type="button" onClick={() => onEdit(item)}>Edit</button>}
                  {onMove && <button type="button" onClick={() => onMove(item)}>Move</button>}
                  {!saved && onSaveOff && (
                    <button type="button" onClick={() => onSaveOff(item)}>Save off</button>
                  )}
                  {saved && onRestore && (
                    <button type="button" onClick={() => onRestore(item)}>Restore</button>
                  )}
                  <button type="button" className="cf-delete" onClick={() => onDelete(item)}>Delete</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MoveCashFlowItemDialog({
  item,
  profiles,
  aggregates,
  sourceName,
  targetDestination,
  onTargetChange,
  onCancel,
  onMove,
  moving,
}) {
  if (!item) return null
  const itemType = item.kind === 'income' ? 'additional income' : 'expense'
  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !moving) onCancel()
    }}>
      <div className="dialog-box cf-move-box" role="dialog" aria-modal="true" aria-labelledby="cf-move-title">
        <h3 id="cf-move-title">Move {itemType} to another account</h3>
        <p>
          <strong>{item.name}</strong> will be removed from {sourceName} and added to the destination
          account&apos;s monthly cash-flow plan. Its dates, notes, saved status, and any payment history will move with it.
        </p>
        <label>
          <span>Destination account</span>
          <select value={targetDestination} onChange={event => onTargetChange(event.target.value)} autoFocus>
            <option value="">Choose an account...</option>
            {profiles.length > 0 && (
              <optgroup label="Individual accounts">
                {profiles.map(profile => (
                  <option key={`profile:${profile.id}`} value={`profile:${profile.id}`}>{profile.name}</option>
                ))}
              </optgroup>
            )}
            {aggregates.length > 0 && (
              <optgroup label="Aggregate accounts">
                {aggregates.map(aggregate => (
                  <option key={`aggregate:${aggregate.id}`} value={`aggregate:${aggregate.id}`}>
                    {aggregate.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <small>No account is selected automatically.</small>
        </label>
        <div className="dialog-buttons">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={moving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onMove} disabled={!targetDestination || moving}>
            {moving ? 'Moving...' : `Move ${item.kind === 'income' ? 'income' : 'expense'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function ScenarioOutcome({ result, horizonYears, surplusMode }) {
  if (!result) return <div className="cf-outcome cf-outcome-empty">Run the simulation</div>
  const status = statusCopy(result.status)
  const portfolioChange = Number(result.ending_portfolio || 0) - Number(result.starting_portfolio || 0)
  const finalMonth = result.series?.[result.series.length - 1]
  const finalMonthlyDistributions = Number(finalMonth?.portfolio_income_gross || 0)
  return (
    <div className={`cf-outcome cf-tone-${status.tone}`}>
      <span className="cf-status-pill">{status.label}</span>
      <small className="cf-outcome-label">Portfolio value after {horizonYears} years</small>
      <strong>{money(result.ending_portfolio)}</strong>
      <small>{Number(result.ending_value_retained_pct || 0).toFixed(0)}% of the starting {money(result.starting_portfolio)}</small>
      <small className="cf-outcome-highlight">
        Portfolio {portfolioChange >= 0 ? 'growth' : 'decrease'}: {money(Math.abs(portfolioChange))}
      </small>
      <small className="cf-outcome-highlight">
        Final distributions: {money(finalMonthlyDistributions)}/month · {money(finalMonthlyDistributions * 12)}/year gross
      </small>
      {result.ending_cash > 0
        ? <small>Cash reserve after {horizonYears} years: {money(result.ending_cash)}</small>
        : surplusMode === 'reinvest' && <small>Unused income was reinvested in more shares</small>}
      {result.depletion_month
        ? <em>Portfolio reaches $0 in year {(result.depletion_month / 12).toFixed(1)}</em>
        : result.principal_drawn > 0
          ? <em>Shares sold to cover shortfalls: {money(result.principal_drawn)}</em>
          : <em>No shares sold to pay bills</em>}
    </div>
  )
}

export default function CashFlowSustainability() {
  const pf = useProfileFetch()
  const {
    selection,
    currentProfileName,
    isAggregate,
    profileId,
    profiles,
    aggregateId,
    aggregates,
  } = useProfile()
  const { isDark } = useTheme()
  const dialog = useDialog()
  const ct = chartTheme(isDark)

  const [plans, setPlans] = useState([])
  const [planId, setPlanId] = useState(null)
  const [items, setItems] = useState([])
  const [settings, setSettings] = useState(null)
  const [summary, setSummary] = useState(null)
  const [simulation, setSimulation] = useState(null)
  const [month, setMonth] = useState(currentMonth())
  const [expenseDraft, setExpenseDraft] = useState(blankItem('expense'))
  const [incomeDraft, setIncomeDraft] = useState(blankItem('income'))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [simLoading, setSimLoading] = useState(false)
  const [error, setError] = useState('')
  const [calendarDay, setCalendarDay] = useState(localDateKey())
  const [moveItem, setMoveItem] = useState(null)
  const [moveTargetDestination, setMoveTargetDestination] = useState('')
  const [movingItem, setMovingItem] = useState(false)

  const apiJson = useCallback(async (path, options) => {
    const response = await pf(path, options)
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error || 'Request failed')
    return data
  }, [pf])

  const loadSummary = useCallback(async (activePlanId, activeMonth = month) => {
    if (!activePlanId) return
    const data = await apiJson(`/api/cash-flow/summary?plan_id=${activePlanId}&month=${activeMonth}`)
    setSummary(data.summary)
  }, [apiJson, month])

  const loadPlanData = useCallback(async (activePlanId) => {
    if (!activePlanId) return
    setLoading(true)
    setError('')
    try {
      const [itemData, settingData] = await Promise.all([
        apiJson(`/api/cash-flow/items?plan_id=${activePlanId}`),
        apiJson(`/api/cash-flow/settings?plan_id=${activePlanId}`),
      ])
      setItems(itemData.items || [])
      setSettings(settingData.settings)
      await loadSummary(activePlanId)
      setSimulation(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiJson, loadSummary])

  useEffect(() => {
    setLoading(true)
    setError('')
    apiJson('/api/cash-flow/plans')
      .then(data => {
        const nextPlans = data.plans || []
        setPlans(nextPlans)
        setPlanId(nextPlans[0]?.id || null)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [apiJson, selection])

  useEffect(() => {
    if (planId) loadPlanData(planId)
  }, [planId, loadPlanData, calendarDay])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextDay = localDateKey()
      setCalendarDay(previous => previous === nextDay ? previous : nextDay)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (planId) {
      loadSummary(planId, month).catch(err => setError(err.message))
      setExpenseDraft(prev => {
        if (prev.id) return prev
        const dueDate = `${month}-01`
        return {
          ...prev,
          start_date: dueDate,
          due_date: dueDate,
          pay_date: shiftIsoDate(dueDate, -2),
        }
      })
      setIncomeDraft(prev => prev.id ? prev : { ...prev, start_date: `${month}-01` })
    }
  }, [month, planId, loadSummary])

  const saveItem = async (kind, event) => {
    event.preventDefault()
    const draft = kind === 'expense' ? expenseDraft : incomeDraft
    setSaving(true)
    setError('')
    try {
      const isEdit = Boolean(draft.id)
      await apiJson(
        isEdit ? `/api/cash-flow/items/${draft.id}` : '/api/cash-flow/items',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft, plan_id: planId }),
        },
      )
      if (kind === 'expense') setExpenseDraft(blankItem('expense', month))
      else setIncomeDraft(blankItem('income', month))
      await loadPlanData(planId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async item => {
    const confirmed = await dialog.confirm(
      item.kind === 'expense'
        ? `Permanently delete "${item.name}" and its payment history?\n\nUse "Save off" instead if you may need this expense again.`
        : `Permanently delete "${item.name}" from additional income?\n\nUse "Save off" instead if you may need this income again.`,
    )
    if (!confirmed) return
    setError('')
    try {
      await apiJson(`/api/cash-flow/items/${item.id}`, { method: 'DELETE' })
      await loadPlanData(planId)
    } catch (err) {
      setError(err.message)
    }
  }

  const setItemActive = async (item, active) => {
    setSaving(true)
    setError('')
    try {
      await apiJson(`/api/cash-flow/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, active, plan_id: planId }),
      })
      if (item.kind === 'expense' && expenseDraft.id === item.id) {
        setExpenseDraft(blankItem('expense', month))
      }
      if (item.kind === 'income' && incomeDraft.id === item.id) {
        setIncomeDraft(blankItem('income', month))
      }
      await loadPlanData(planId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const saveOffItem = async item => {
    const label = item.kind === 'income' ? 'additional income' : 'expense'
    const confirmed = await dialog.confirm(
      `Save off "${item.name}"?\n\nIt will be removed from ${label} totals but kept under Saved ${label} so it can be restored later.`,
    )
    if (confirmed) await setItemActive(item, false)
  }

  const restoreItem = item => setItemActive(item, true)

  const openMoveItem = item => {
    setMoveItem(item)
    setMoveTargetDestination('')
  }

  const closeMoveItem = () => {
    if (movingItem) return
    setMoveItem(null)
    setMoveTargetDestination('')
  }

  const confirmMoveItem = async () => {
    if (!moveItem || !moveTargetDestination) return
    const [targetScopeType, targetScopeId] = moveTargetDestination.split(':')
    if (!['profile', 'aggregate'].includes(targetScopeType) || !targetScopeId) return
    setMovingItem(true)
    setError('')
    try {
      await apiJson(`/api/cash-flow/items/${moveItem.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_scope_type: targetScopeType,
          target_scope_id: Number(targetScopeId),
        }),
      })
      if (moveItem.kind === 'expense' && expenseDraft.id === moveItem.id) {
        setExpenseDraft(blankItem('expense', month))
      }
      if (moveItem.kind === 'income' && incomeDraft.id === moveItem.id) {
        setIncomeDraft(blankItem('income', month))
      }
      setMoveItem(null)
      setMoveTargetDestination('')
      await loadPlanData(planId)
    } catch (err) {
      setError(err.message)
    } finally {
      setMovingItem(false)
    }
  }

  const editItem = item => {
    if (item.kind === 'expense') setExpenseDraft({ ...item })
    else setIncomeDraft({ ...item })
    window.scrollTo({ top: 300, behavior: 'smooth' })
  }

  const saveSettings = async () => {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      const data = await apiJson('/api/cash-flow/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, plan_id: planId }),
      })
      setSettings(data.settings)
      await loadSummary(planId)
      setSimulation(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const runSimulation = async () => {
    setSimLoading(true)
    setError('')
    try {
      const data = await apiJson('/api/cash-flow/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          start_month: month,
          horizon_years: settings?.horizon_years || 20,
        }),
      })
      setSimulation(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSimLoading(false)
    }
  }

  const expenses = useMemo(() => items.filter(item => item.kind === 'expense' && item.active), [items])
  const savedExpenses = useMemo(() => items.filter(item => item.kind === 'expense' && !item.active), [items])
  const incomes = useMemo(() => items.filter(item => item.kind === 'income' && item.active), [items])
  const savedIncomes = useMemo(() => items.filter(item => item.kind === 'income' && !item.active), [items])
  const moveDestinationProfiles = useMemo(
    () => profiles.filter(profile => isAggregate || Number(profile.id) !== Number(profileId)),
    [profiles, isAggregate, profileId],
  )
  const moveDestinationAggregates = useMemo(
    () => aggregates.filter(aggregate => !isAggregate || Number(aggregate.id) !== Number(aggregateId)),
    [aggregates, isAggregate, aggregateId],
  )
  const togglePaid = useCallback(async (item, paid) => {
    if (!item.current_due_date) return
    try {
      const data = await apiJson(`/api/cash-flow/items/${item.id}/payments/${item.current_due_date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid }),
      })
      setItems(current => current.map(row => row.id === item.id ? data.item : row))
    } catch (err) {
      setError(err.message)
    }
  }, [apiJson])
  const resultMap = useMemo(() => {
    const map = {}
    for (const result of simulation?.results || []) {
      map[`${result.scenario}:${result.include_additional_income ? 'with' : 'without'}`] = result
    }
    return map
  }, [simulation])
  const scenarioDetail = useCallback(scenario => {
    const assumptions = simulation?.scenario_assumptions?.[scenario.key]
    if (!assumptions) return scenario.detail
    const marketReturn = assumptions.year_one_market_return_pct ?? assumptions.year_one_total_return_pct
    return `Year 1: ${movementCopy(assumptions.year_one_income_change_pct, 'distributions')}; ${movementCopy(marketReturn, 'holding prices')}`
  }, [simulation])
  const scenarioMix = simulation?.scenario_assumptions?.neutral?.mix || []

  const chartData = useMemo(() => {
    if (!simulation?.results) return []
    const colorByScenario = Object.fromEntries(SCENARIOS.map(row => [row.key, row.color]))
    return simulation.results.map(result => {
      const yearly = result.series.filter((_, index) => index === 0 || (index + 1) % 12 === 0)
      const withIncome = result.include_additional_income
      return {
        x: yearly.map((_, index) => index),
        y: yearly.map(row => row.portfolio),
        type: 'scatter',
        mode: 'lines',
        name: `${SCENARIOS.find(s => s.key === result.scenario)?.label} - ${withIncome ? 'with other income' : 'portfolio only'}`,
        line: {
          color: colorByScenario[result.scenario],
          width: withIncome ? 3 : 2,
          dash: withIncome ? 'solid' : 'dot',
        },
        hovertemplate: 'Year %{x}<br>Portfolio: $%{y:,.0f}<extra></extra>',
      }
    })
  }, [simulation])

  const gap = summary?.surplus_shortfall || 0
  const coverageTone = summary?.covered ? 'good' : 'bad'
  const grossLeftover = (summary?.portfolio_monthly_income_gross || 0)
    + (summary?.additional_income_gross || 0)
    - (summary?.expenses || 0)
  const grossLeftoverTone = grossLeftover >= 0 ? 'good' : 'bad'
  const scheduledExpenseCount = (summary?.items || []).filter(item => item.kind === 'expense').length
  const coverageLabel = summary?.coverage_ratio == null
    ? 'No expenses entered'
    : `${(summary.coverage_ratio * 100).toFixed(0)}% of expenses covered`

  return (
    <div className="page cf-page">
      <div className="cf-page-head">
        <div>
          <span className="cf-eyebrow">Monthly planning</span>
          <h1>Cash Flow &amp; Sustainability</h1>
          <p>Save every expense once, include optional outside income, and test whether the selected portfolio can carry the plan.</p>
        </div>
        <div className="cf-head-controls">
          {plans.length > 1 && (
            <label>
              <span>Plan</span>
              <select value={planId || ''} onChange={e => setPlanId(Number(e.target.value))}>
                {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>View month</span>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="cf-source-note">
        <strong>Portfolio source:</strong> {currentProfileName}{isAggregate ? ' aggregate' : ''}. Portfolio income is loaded automatically; the entries below are only expenses and non-portfolio income.
      </div>

      {error && <div className="cf-error">{error}</div>}

      <div className="cf-summary-guide" role="note">
        <strong>How to read these totals</strong>
        <span><b>Income</b> cards are before expenses. <b>Leftover</b> cards subtract this month's expenses. Gross amounts are before tax; after-tax amounts are the estimated spendable amounts.</span>
      </div>

      <section className="cf-summary">
        <SummaryTile
          label="Expenses this month"
          value={money(summary?.expenses)}
          sub="Bills scheduled in the selected month"
          detail={`${scheduledExpenseCount} scheduled expense${scheduledExpenseCount === 1 ? '' : 's'}`}
        />
        <SummaryTile
          label="Portfolio income (gross)"
          value={money(summary?.portfolio_monthly_income_gross)}
          sub="Before tax; expenses not deducted"
          detail={summary?.portfolio_profile_count > 1 ? `${summary.portfolio_profile_count} linked accounts` : 'Portfolio income only'}
        />
        <SummaryTile
          label="Portfolio income (after tax)"
          value={money(summary?.portfolio_monthly_income_net)}
          sub={`After ${Number(settings?.portfolio_tax_pct || 0).toFixed(0)}% tax; expenses not deducted`}
          detail="Portfolio income only"
        />
        <SummaryTile
          label={grossLeftover >= 0 ? 'Gross leftover' : 'Gross shortfall'}
          value={money(Math.abs(grossLeftover))}
          sub="Before tax; after expenses"
          detail="Gross portfolio + gross other income − expenses"
          tone={grossLeftoverTone}
        />
        <SummaryTile
          label={gap >= 0 ? 'After-tax leftover' : 'After-tax shortfall'}
          value={money(Math.abs(gap))}
          sub="Spendable income after expenses"
          detail={coverageLabel}
          tone={coverageTone}
        />
        <SummaryTile
          label="Other income (after tax)"
          value={money(summary?.additional_income_net)}
          sub="Non-portfolio income only"
          detail={incomes.length ? 'After each source’s tax rate' : 'No other income entered'}
        />
      </section>

      <div className={`cf-answer cf-answer-${coverageTone}`}>
        <span>{summary?.covered ? 'YES' : 'NOT YET'}</span>
        <div>
          <strong>
            {summary?.covered
              ? `Income covers ${month}'s expenses${gap > 0 ? ` with ${money(gap)} left over.` : '.'}`
              : `Income is short by ${money(Math.abs(gap))} for ${month}.`}
          </strong>
          <small>
            Portfolio-only funding need: {money(summary?.portfolio_required)} this month.
            Twelve-month normalized need: {money(summary?.normalized_portfolio_required)}.
          </small>
        </div>
      </div>

      <section className="cf-entry-panel">
        <div className="cf-section-head">
          <div>
            <span className="cf-section-kicker">Outflows</span>
            <h2>Expenses</h2>
            <small className="cf-rollover-note">Paid checks follow each due date and advance automatically after it passes.</small>
          </div>
          <strong>{money(summary?.expenses)} in {month}</strong>
        </div>
        <ItemEditor
          kind="expense"
          value={expenseDraft}
          onChange={setExpenseDraft}
          onSubmit={event => saveItem('expense', event)}
          onCancel={() => setExpenseDraft(blankItem('expense', month))}
          saving={saving}
        />
        {loading ? <div className="cf-empty">Loading expenses...</div> : (
          <>
            <ItemTable
              kind="expense"
              items={expenses}
              onEdit={editItem}
              onDelete={deleteItem}
              onTogglePaid={togglePaid}
              onMove={openMoveItem}
              onSaveOff={saveOffItem}
            />
            {savedExpenses.length > 0 && (
              <details className="cf-saved-expenses">
                <summary>
                  <strong>Saved expenses ({savedExpenses.length})</strong>
                  <span>Not included in monthly totals. Open to restore, move, or permanently delete.</span>
                </summary>
                <ItemTable
                  kind="expense"
                  items={savedExpenses}
                  onDelete={deleteItem}
                  onMove={openMoveItem}
                  onRestore={restoreItem}
                  saved
                />
              </details>
            )}
          </>
        )}
      </section>

      <section className="cf-entry-panel cf-income-panel">
        <div className="cf-section-head">
          <div>
            <span className="cf-section-kicker">Optional inflows</span>
            <h2>Additional income</h2>
          </div>
          <strong>{money(summary?.additional_income_net)} net in {month}</strong>
        </div>
        <ItemEditor
          kind="income"
          value={incomeDraft}
          onChange={setIncomeDraft}
          onSubmit={event => saveItem('income', event)}
          onCancel={() => setIncomeDraft(blankItem('income', month))}
          saving={saving}
        />
        {loading ? <div className="cf-empty">Loading income...</div> : (
          <>
            <ItemTable
              kind="income"
              items={incomes}
              onEdit={editItem}
              onDelete={deleteItem}
              onMove={openMoveItem}
              onSaveOff={saveOffItem}
            />
            {savedIncomes.length > 0 && (
              <details className="cf-saved-expenses">
                <summary>
                  <strong>Saved additional income ({savedIncomes.length})</strong>
                  <span>Not included in income totals. Open to restore, move, or permanently delete.</span>
                </summary>
                <ItemTable
                  kind="income"
                  items={savedIncomes}
                  onDelete={deleteItem}
                  onMove={openMoveItem}
                  onRestore={restoreItem}
                  saved
                />
              </details>
            )}
          </>
        )}
      </section>

      <MoveCashFlowItemDialog
        item={moveItem}
        profiles={moveDestinationProfiles}
        aggregates={moveDestinationAggregates}
        sourceName={currentProfileName}
        targetDestination={moveTargetDestination}
        onTargetChange={setMoveTargetDestination}
        onCancel={closeMoveItem}
        onMove={confirmMoveItem}
        moving={movingItem}
      />

      <section className="cf-sim-panel">
        <div className="cf-section-head cf-sim-head">
          <div>
            <span className="cf-section-kicker">Forward stress test</span>
            <h2>Is the portfolio sustainable?</h2>
            <p>Every run compares bull, neutral, and bear markets both with and without your additional income.</p>
          </div>
          <button className="btn btn-primary" onClick={runSimulation} disabled={simLoading || !items.length}>
            {simLoading ? 'Running six projections...' : 'Run sustainability test'}
          </button>
        </div>

        {settings && (
          <div className="cf-settings">
            <label>
              <span>Horizon</span>
              <div><input type="number" min="1" max="50" value={settings.horizon_years} onChange={e => setSettings({ ...settings, horizon_years: e.target.value })} /><b>years</b></div>
            </label>
            <label>
              <span>Expense inflation</span>
              <div><input type="number" min="-10" max="30" step="0.1" value={settings.expense_inflation_pct} onChange={e => setSettings({ ...settings, expense_inflation_pct: e.target.value })} /><b>%</b></div>
            </label>
            <label>
              <span>Portfolio income tax</span>
              <div><input type="number" min="0" max="95" step="0.1" value={settings.portfolio_tax_pct} onChange={e => setSettings({ ...settings, portfolio_tax_pct: e.target.value })} /><b>%</b></div>
            </label>
            <label>
              <span>Starting cash reserve</span>
              <div><b>$</b><input type="number" min="0" step="100" value={settings.starting_cash} onChange={e => setSettings({ ...settings, starting_cash: e.target.value })} /></div>
            </label>
            <label>
              <span>Unused income after bills</span>
              <select value={settings.surplus_mode} onChange={e => setSettings({ ...settings, surplus_mode: e.target.value })}>
                <option value="reinvest">Reinvest by buying more shares</option>
                <option value="cash">Keep as cash reserve</option>
              </select>
            </label>
            <button className="btn btn-secondary" onClick={saveSettings} disabled={saving}>Save assumptions</button>
          </div>
        )}

        {simulation && (
          <div className="cf-results-guide">
            <strong>What this projection is doing</strong>
            <p>
              It starts with {currentProfileName}&apos;s {money(simulation.portfolio?.value)} portfolio,
              producing {money(simulation.portfolio?.annual_income)} per year
              ({money((simulation.portfolio?.annual_income || 0) / 12)} per month before tax) at its current
              {' '}{Number(simulation.portfolio?.distribution_yield_pct || 0).toFixed(2)}% distribution rate.
            </p>
            <p>
              Distributions are cash paid by the holdings; market value is the changing price of those holdings.
              The model changes them separately and does not subtract a distribution from the portfolio value a second time.
            </p>
            <p>
              <b>All bills covered by income</b> means distributions and the income allowed in that column paid every
              projected bill for all {simulation.horizon_years} years—no shares were sold.
              {settings?.surplus_mode === 'reinvest'
                ? ' Any income left after bills buys more shares, increasing the projected portfolio and its future distributions.'
                : ' Income left after bills is kept in the projected cash reserve under your current setting.'}
            </p>
          </div>
        )}

        <div className="cf-scenario-grid">
          <div className="cf-grid-label" />
          <div className="cf-grid-colhead">
            <strong>Portfolio + additional income</strong>
            <span>Includes distributions and your saved Social Security or other income</span>
          </div>
          <div className="cf-grid-colhead">
            <strong>Portfolio distributions only</strong>
            <span>Excludes Social Security and every other additional-income entry</span>
          </div>
          {SCENARIOS.map(scenario => (
            <React.Fragment key={scenario.key}>
              <div className="cf-scenario-label" style={{ '--scenario-color': scenario.color }}>
                <strong>{scenario.label}</strong>
                <small>{scenarioDetail(scenario)}</small>
              </div>
              <ScenarioOutcome result={resultMap[`${scenario.key}:with`]} horizonYears={simulation?.horizon_years || settings?.horizon_years} surplusMode={settings?.surplus_mode} />
              <ScenarioOutcome result={resultMap[`${scenario.key}:without`]} horizonYears={simulation?.horizon_years || settings?.horizon_years} surplusMode={settings?.surplus_mode} />
            </React.Fragment>
          ))}
        </div>

        {scenarioMix.length > 0 && (
          <div className="cf-model-note">
            <div>
              <strong>Why distributions change differently from market prices</strong>
              <span>
                Each holding is grouped by how it produces income. In a bear market, the model reduces distributions
                according to that holding type, generally by less than its market-price decline. The percentages at right
                show how much each group contributes to this portfolio&apos;s income and value.
              </span>
            </div>
            <div className="cf-model-mix">
              {scenarioMix.map(row => (
                <span key={row.key}>
                  <b>{row.label}</b>
                  {Number(row.income_pct || 0).toFixed(0)}% of income · {Number(row.value_pct || 0).toFixed(0)}% of value
                </span>
              ))}
            </div>
          </div>
        )}

        {chartData.length > 0 && (
          <div className="cf-chart">
            <Plot
              data={chartData}
              layout={{
                paper_bgcolor: ct.paper,
                plot_bgcolor: ct.plot,
                font: { color: ct.font },
                title: { text: 'Projected Portfolio Balance', font: { size: 16 } },
                xaxis: { title: 'Year', gridcolor: ct.grid },
                yaxis: { title: 'Portfolio Value ($)', tickprefix: '$', tickformat: ',.0f', gridcolor: ct.grid },
                legend: { orientation: 'h', y: -0.2 },
                margin: { l: 75, r: 25, t: 50, b: 95 },
                height: 430,
                hovermode: 'x unified',
              }}
              config={{ responsive: true, displaylogo: false }}
              style={{ width: '100%' }}
            />
          </div>
        )}
      </section>
    </div>
  )
}
