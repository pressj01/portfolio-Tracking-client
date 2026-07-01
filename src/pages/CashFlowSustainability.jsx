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
  'Housing', 'Utilities', 'Food', 'Transportation', 'Insurance', 'Healthcare',
  'Debt', 'Taxes', 'Personal', 'Entertainment', 'Travel', 'Giving', 'Other',
]

const INCOME_CATEGORIES = [
  'Employment', 'Pension', 'Social Security', 'Annuity', 'Rental',
  'Business', 'Other',
]

const SCENARIOS = [
  { key: 'bullish', label: 'Bull', color: '#00c853', detail: '4% income growth / 8% price growth' },
  { key: 'neutral', label: 'Neutral', color: '#f9a825', detail: '1% income growth / 3% price growth' },
  { key: 'bearish', label: 'Bear', color: '#e05555', detail: 'Year-one income and price shock, then recovery' },
]

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function blankItem(kind, month = currentMonth()) {
  return {
    kind,
    name: '',
    amount: '',
    category: '',
    frequency: 'monthly',
    start_date: `${month}-01`,
    end_date: '',
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

function statusCopy(status) {
  if (status === 'income_covered') return { label: 'Income covered', tone: 'good' }
  if (status === 'funded_from_principal') return { label: 'Uses principal', tone: 'warn' }
  return { label: 'Not sustainable', tone: 'bad' }
}

function SummaryTile({ label, value, sub, tone = '' }) {
  return (
    <div className={`cf-summary-tile ${tone ? `cf-tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function ItemEditor({ kind, value, onChange, onSubmit, onCancel, saving }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const isEdit = Boolean(value.id)
  const categories = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const set = (field, next) => onChange({ ...value, [field]: next })

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
          <label>
            <span>{value.frequency === 'one_time' ? 'Occurs on' : 'Starts'}</span>
            <input type="date" value={value.start_date} onChange={e => set('start_date', e.target.value)} required />
          </label>
          {value.frequency !== 'one_time' && (
            <label>
              <span>Ends <em>optional</em></span>
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

function ItemTable({ kind, items, onEdit, onDelete }) {
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
            <th>Starts</th>
            <th className="cf-num">Amount</th>
            {kind === 'income' && <th className="cf-num">Tax</th>}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id}>
              <td>
                <strong>{item.name}</strong>
                {item.notes && <small>{item.notes}</small>}
              </td>
              <td>{item.category || 'Uncategorized'}</td>
              <td>{frequencyLabel[item.frequency] || item.frequency}</td>
              <td>{item.start_date}</td>
              <td className="cf-num"><strong>{money(item.amount, 2)}</strong></td>
              {kind === 'income' && <td className="cf-num">{Number(item.tax_rate_pct || 0).toFixed(1)}%</td>}
              <td className="cf-actions">
                <button type="button" onClick={() => onEdit(item)}>Edit</button>
                <button type="button" className="cf-delete" onClick={() => onDelete(item)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScenarioOutcome({ result }) {
  if (!result) return <div className="cf-outcome cf-outcome-empty">Run the simulation</div>
  const status = statusCopy(result.status)
  return (
    <div className={`cf-outcome cf-tone-${status.tone}`}>
      <span className="cf-status-pill">{status.label}</span>
      <strong>{money(result.ending_portfolio)}</strong>
      <small>Ending portfolio</small>
      {result.depletion_month
        ? <em>Depletes in year {(result.depletion_month / 12).toFixed(1)}</em>
        : result.principal_drawn > 0
          ? <em>{money(result.principal_drawn)} principal used</em>
          : <em>No principal needed</em>}
    </div>
  )
}

export default function CashFlowSustainability() {
  const pf = useProfileFetch()
  const { selection, currentProfileName, isAggregate } = useProfile()
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
  }, [planId, loadPlanData])

  useEffect(() => {
    if (planId) {
      loadSummary(planId, month).catch(err => setError(err.message))
      setExpenseDraft(prev => prev.id ? prev : { ...prev, start_date: `${month}-01` })
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
    const confirmed = await dialog.confirm(`Delete "${item.name}" from this cash-flow plan?`)
    if (!confirmed) return
    setError('')
    try {
      await apiJson(`/api/cash-flow/items/${item.id}`, { method: 'DELETE' })
      await loadPlanData(planId)
    } catch (err) {
      setError(err.message)
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
  const incomes = useMemo(() => items.filter(item => item.kind === 'income' && item.active), [items])
  const resultMap = useMemo(() => {
    const map = {}
    for (const result of simulation?.results || []) {
      map[`${result.scenario}:${result.include_additional_income ? 'with' : 'without'}`] = result
    }
    return map
  }, [simulation])

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

      <section className="cf-summary">
        <SummaryTile label="Expenses this month" value={money(summary?.expenses)} sub={`${expenses.length} saved expense${expenses.length === 1 ? '' : 's'}`} />
        <SummaryTile
          label="Portfolio income (gross)"
          value={money(summary?.portfolio_monthly_income_gross)}
          sub={`${summary?.portfolio_profile_count > 1 ? `${summary.portfolio_profile_count} linked accounts · ` : ''}${money(summary?.portfolio_monthly_income_net)} spendable after ${Number(settings?.portfolio_tax_pct || 0).toFixed(0)}% tax`}
        />
        <SummaryTile label="Additional income" value={money(summary?.additional_income_net)} sub={incomes.length ? 'After item-level taxes' : 'Optional'} />
        <SummaryTile
          label={gap >= 0 ? 'Monthly surplus' : 'Monthly shortfall'}
          value={money(Math.abs(gap))}
          sub={summary?.coverage_ratio == null ? 'No expenses entered' : `${(summary.coverage_ratio * 100).toFixed(0)}% covered`}
          tone={coverageTone}
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
          <ItemTable kind="expense" items={expenses} onEdit={editItem} onDelete={deleteItem} />
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
          <ItemTable kind="income" items={incomes} onEdit={editItem} onDelete={deleteItem} />
        )}
      </section>

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
              <span>Monthly surplus</span>
              <select value={settings.surplus_mode} onChange={e => setSettings({ ...settings, surplus_mode: e.target.value })}>
                <option value="cash">Add to cash reserve</option>
                <option value="reinvest">Reinvest in portfolio</option>
              </select>
            </label>
            <button className="btn btn-secondary" onClick={saveSettings} disabled={saving}>Save assumptions</button>
          </div>
        )}

        <div className="cf-scenario-grid">
          <div className="cf-grid-label" />
          <div className="cf-grid-colhead">With additional income</div>
          <div className="cf-grid-colhead">Portfolio income only</div>
          {SCENARIOS.map(scenario => (
            <React.Fragment key={scenario.key}>
              <div className="cf-scenario-label" style={{ '--scenario-color': scenario.color }}>
                <strong>{scenario.label}</strong>
                <small>{scenario.detail}</small>
              </div>
              <ScenarioOutcome result={resultMap[`${scenario.key}:with`]} />
              <ScenarioOutcome result={resultMap[`${scenario.key}:without`]} />
            </React.Fragment>
          ))}
        </div>

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
