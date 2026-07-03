import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThemedPlot from '../components/ThemedPlot'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { formatMoney, formatMoneyCompact } from '../utils/money'

const STRATEGY_COLORS = ['#7ecfff', '#ffc857', '#5ee6a8']
const SCENARIOS = [
  { key: 'bullish', label: 'Bull', color: '#4dff91', detail: 'Expansion first, then fades toward neutral' },
  { key: 'neutral', label: 'Neutral', color: '#f9a825', detail: 'Long-run history blended with strategy assumptions' },
  { key: 'bearish', label: 'Bear', color: '#e05555', detail: 'Early shock, elevated volatility, then recovery' },
]
const WINNER_CARDS = [
  { key: 'freedomFirst', label: 'Reaches FI first' },
  { key: 'wealth', label: 'Wealth' },
  { key: 'income', label: 'Income' },
  { key: 'sustainableFreedom', label: 'Sustainable Freedom' },
]

const FREQUENCY_MULTIPLIERS = {
  W: 52,
  Weekly: 52,
  BW: 26,
  'Bi-Weekly': 26,
  M: 12,
  Monthly: 12,
  Q: 4,
  Quarterly: 4,
  SA: 2,
  'Semi-Annual': 2,
  A: 1,
  Annual: 1,
}

const BEHAVIOR_OPTIONS = [
  ['', 'Auto classify'],
  ['option_income', 'Diversified option income'],
  ['high_distribution_option', 'High-distribution options'],
  ['fixed_income', 'Bonds / fixed income'],
  ['cash', 'Cash / money market'],
  ['preferred_credit', 'Preferred / credit'],
  ['bdc', 'BDC'],
  ['cef', 'Closed-end fund'],
  ['reit', 'REIT / real estate'],
  ['dividend_growth', 'Dividend growth'],
  ['equity_income', 'Equity income'],
  ['commodities', 'Commodities'],
  ['non_income_equity', 'Growth / non-income equity'],
  ['other', 'Other'],
]

const OPTION_STRATEGY_OPTIONS = [
  ['auto', 'Auto detect'],
  ['none', 'No option overlay'],
  ['covered_call', 'Covered calls'],
  ['short_put', 'Short / cash-secured puts'],
  ['put_spread', 'Put spread · unspecified'],
  ['short_put_spread', 'Short put credit spreads'],
  ['protective_put_spread', 'Protective put spreads'],
  ['collar_buffer', 'Collar / buffer'],
  ['mixed_options', 'Mixed / other options'],
]

const CORRELATION_GROUP_OPTIONS = [
  ['auto', 'Auto detect'],
  ['us_equity', 'U.S. equities'],
  ['sp500', 'S&P 500'],
  ['nasdaq', 'Nasdaq'],
  ['small_cap', 'Small cap'],
  ['technology', 'Technology'],
  ['semiconductors', 'Semiconductors'],
  ['international', 'International'],
  ['option_income', 'Option-income funds'],
  ['fixed_income', 'Fixed income'],
  ['cash', 'Cash'],
  ['preferred_credit', 'Preferred / credit'],
  ['real_estate', 'Real estate'],
  ['commodities', 'Commodities'],
  ['precious_metals', 'Gold / precious metals'],
  ['crypto', 'Crypto'],
  ['single_stock', 'Single stock'],
  ['other', 'Other'],
]

function money(value) {
  return formatMoney(value, { zeroIfInvalid: true, digits: 0 })
}

function compactMoney(value) {
  return formatMoneyCompact(value, { zeroIfInvalid: true, minCompact: 1e6, smallDigits: 0 })
}

function pct(value, digits = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number.toFixed(digits)}%`
}

function createStrategy(name, style) {
  return {
    name,
    style,
    source: 'portfolio',
    selectionMode: 'all',
    profileId: '',
    currentValue: 0,
    holdings: [],
    portfolioName: name,
    autoName: true,
  }
}

function normalizeHoldings(holdings) {
  const active = holdings.filter(row => row.enabled !== false && Number(row.weight) > 0)
  const total = active.reduce((sum, row) => sum + Number(row.weight || 0), 0)
  if (total <= 0) return []
  return active.map(row => ({ ...row, weight: Number(row.weight) / total * 100 }))
}

function normalizeEnabledRows(holdings) {
  const active = holdings.filter(row => row.enabled !== false && Number(row.weight) > 0)
  const total = active.reduce((sum, row) => sum + Number(row.weight || 0), 0)
  if (total <= 0) return holdings
  return holdings.map(row => (
    row.enabled === false
      ? row
      : { ...row, weight: Number(row.weight || 0) / total * 100 }
  ))
}

function normalizePortfolioSelection(holdings) {
  return normalizeEnabledRows(holdings.map(row => (
    row.imported === true && row.enabled !== false
      ? { ...row, weight: Number(row.portfolio_weight) || Number(row.weight) || 0 }
      : row
  )))
}

// When a saved portfolio is trimmed to a subset, "Owner" is a misleading name for
// what's actually just one or a few tickers. Suggest a clearer name automatically,
// unless the user has already typed a custom one (autoName === false).
function suggestPortfolioName(strategy, holdings) {
  if (strategy.source !== 'portfolio' || strategy.autoName === false) return null
  const importedRows = holdings.filter(row => row.imported === true)
  if (!importedRows.length) return null
  const selected = importedRows.filter(row => row.enabled !== false)
  const basePortfolioName = strategy.portfolioName || strategy.name
  if (selected.length === importedRows.length) return basePortfolioName
  if (selected.length === 1) return selected[0].ticker
  if (selected.length > 1) return `${basePortfolioName} (${selected.length} of ${importedRows.length})`
  return null
}

function winnerValue(strategy, goal, targetEnabled) {
  const summary = strategy?.summary || {}
  if (goal === 'freedomFirst') {
    // Earliest retirement year whose withdrawals last the full horizon wins;
    // Infinity => never reached, sorts last. Guard against Number(null) === 0.
    const raw = summary.fi_year_lasts
    const year = raw == null ? Infinity : Number(raw)
    return Number.isFinite(year) && year > 0 ? year : Infinity
  }
  if (goal === 'sustainableFreedom' && targetEnabled) {
    const combined = Number(summary.sustainable_freedom_probability)
    if (Number.isFinite(combined)) return combined
    return Math.max(Number(summary.income_target_probability) || 0, Number(summary.spending_target_probability) || 0)
  }
  if (goal === 'income') return Number(summary.final_real_monthly_income?.p50) || 0
  if (goal === 'resilience') return Number(summary.final_real_value?.p10) || 0
  return Number(summary.final_real_value?.p50) || 0
}

function winnerMetricLabel(goal, targetEnabled) {
  if (goal === 'freedomFirst') return 'to reach FI (withdrawals last the full horizon)'
  if (goal === 'sustainableFreedom' && targetEnabled) {
    return 'chance of meeting the freedom target with the enabled sustainability tests applied'
  }
  if (goal === 'income') return 'real monthly distribution income'
  if (goal === 'resilience') return '10th-percentile real ending value'
  return 'median real ending value'
}

function winnerMetricValue(value, goal, targetEnabled) {
  if (goal === 'freedomFirst') return Number.isFinite(value) ? `year ${value}` : 'no year (not reached)'
  if (goal === 'sustainableFreedom' && targetEnabled) return pct(value)
  if (goal === 'income') return `${money(value)}/month`
  return money(value)
}

function rankStrategies(strategyResults, goal, targetEnabled) {
  if (!strategyResults?.length) return null
  const ascending = goal === 'freedomFirst'  // lower FI year is better
  const ranked = strategyResults
    .map((strategy, index) => ({
      strategy,
      index,
      value: winnerValue(strategy, goal, targetEnabled),
    }))
    .sort((left, right) => (ascending ? left.value - right.value : right.value - left.value))
  const top = ranked[0]
  if (ascending && !Number.isFinite(top.value)) {
    // No strategy reached FI within the horizon — treat as an all-way tie.
    return { ...top, leaders: ranked, tied: ranked.length > 1 }
  }
  const tolerance = goal === 'freedomFirst' || (goal === 'sustainableFreedom' && targetEnabled)
    ? 0.5
    : Math.max(Math.abs(top.value) * 0.005, 1)
  const leaders = ranked.filter(row => Math.abs(top.value - row.value) <= tolerance)
  return { ...top, leaders, tied: leaders.length > 1 }
}

function buildBlend(strategyA, strategyB, pctA) {
  const merged = new Map()
  const add = (holding, multiplier) => {
    const existing = merged.get(holding.ticker)
    if (existing) {
      existing.weight += holding.weight * multiplier
    } else {
      merged.set(holding.ticker, { ...holding, weight: holding.weight * multiplier })
    }
  }
  normalizeHoldings(strategyA.holdings).forEach(row => add(row, pctA / 100))
  normalizeHoldings(strategyB.holdings).forEach(row => add(row, (100 - pctA) / 100))
  return {
    name: `${strategyA.name} / ${strategyB.name} Blend`,
    style: 'blend',
    holdings: [...merged.values()],
  }
}

function StrategyBuilder({
  index,
  strategy,
  profiles,
  aggregates,
  loading,
  onChange,
  onLoadPortfolio,
}) {
  const pf = useProfileFetch()
  const color = STRATEGY_COLORS[index]
  const [tickerInput, setTickerInput] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [portfolioSearch, setPortfolioSearch] = useState('')
  const [holdingPickerOpen, setHoldingPickerOpen] = useState(false)
  const active = strategy.holdings.filter(row => row.enabled !== false)
  const importedHoldings = strategy.holdings.filter(row => row.imported === true)
  const importedSelected = importedHoldings.filter(row => row.enabled !== false)
  const visibleImportedHoldings = importedHoldings.filter(row => {
    const query = portfolioSearch.trim().toLowerCase()
    if (!query) return true
    return `${row.ticker} ${row.description || ''} ${row.scenario_label || ''}`
      .toLowerCase()
      .includes(query)
  })
  const weightTotal = active.reduce((sum, row) => sum + (Number(row.weight) || 0), 0)

  const updateHolding = (ticker, patch) => {
    const holdings = strategy.holdings.map(row => (
      row.ticker === ticker ? { ...row, ...patch } : row
    ))
    const changesSelection = Object.prototype.hasOwnProperty.call(patch, 'enabled')
    const normalizedHoldings = changesSelection ? normalizePortfolioSelection(holdings) : holdings
    // Skip the live rename while the holding picker is open so the name field
    // doesn't change on every click mid-selection; the picker-close handler
    // catches up once the user is done.
    const suggestedName = changesSelection && !holdingPickerOpen
      ? suggestPortfolioName(strategy, normalizedHoldings)
      : null
    onChange({
      holdings: normalizedHoldings,
      ...(changesSelection && strategy.source === 'portfolio' ? { selectionMode: 'custom' } : {}),
      ...(suggestedName ? { name: suggestedName, autoName: true } : {}),
    })
  }

  const removeHolding = ticker => {
    const holdings = strategy.holdings.filter(row => row.ticker !== ticker)
    const suggestedName = suggestPortfolioName(strategy, holdings)
    onChange({
      holdings,
      ...(suggestedName ? { name: suggestedName, autoName: true } : {}),
    })
  }

  const equalWeight = () => {
    const count = active.length
    if (!count) return
    const each = 100 / count
    onChange({
      holdings: strategy.holdings.map(row => (
        row.enabled === false ? row : { ...row, weight: each }
      )),
    })
  }

  const normalizeWeights = () => {
    const normalized = normalizeHoldings(strategy.holdings)
    const byTicker = new Map(normalized.map(row => [row.ticker, row.weight]))
    onChange({
      holdings: strategy.holdings.map(row => (
        byTicker.has(row.ticker) ? { ...row, weight: byTicker.get(row.ticker) } : row
      )),
    })
  }

  const checkAllHoldings = () => {
    const holdings = strategy.holdings.map(row => ({ ...row, enabled: true }))
    const normalizedHoldings = normalizePortfolioSelection(holdings)
    const suggestedName = suggestPortfolioName(strategy, normalizedHoldings)
    onChange({
      holdings: normalizedHoldings,
      ...(strategy.source === 'portfolio' ? { selectionMode: 'all' } : {}),
      ...(suggestedName ? { name: suggestedName, autoName: true } : {}),
    })
  }

  const uncheckAllHoldings = () => {
    onChange({
      holdings: strategy.holdings.map(row => ({ ...row, enabled: false })),
      ...(strategy.source === 'portfolio' ? { selectionMode: 'custom' } : {}),
    })
  }

  const useEntirePortfolio = () => {
    const holdings = strategy.holdings.map(row => (
      row.imported === true ? { ...row, enabled: true } : row
    ))
    const normalizedHoldings = normalizePortfolioSelection(holdings)
    const suggestedName = suggestPortfolioName(strategy, normalizedHoldings)
    onChange({
      holdings: normalizedHoldings,
      selectionMode: 'all',
      ...(suggestedName ? { name: suggestedName, autoName: true } : {}),
    })
    setHoldingPickerOpen(false)
    setPortfolioSearch('')
  }

  const choosePortfolioHoldings = () => {
    onChange({ selectionMode: 'custom' })
    setHoldingPickerOpen(true)
  }

  const toggleHoldingPicker = () => {
    if (holdingPickerOpen) {
      const suggestedName = suggestPortfolioName(strategy, strategy.holdings)
      if (suggestedName) onChange({ name: suggestedName, autoName: true })
    }
    setHoldingPickerOpen(open => !open)
  }

  const clearImportedSelection = () => {
    const holdings = strategy.holdings.map(row => (
      row.imported === true ? { ...row, enabled: false } : row
    ))
    onChange({ holdings: normalizePortfolioSelection(holdings), selectionMode: 'custom' })
  }

  const addTicker = () => {
    const ticker = tickerInput.trim().toUpperCase()
    if (!ticker) return
    const existing = strategy.holdings.find(row => row.ticker === ticker)
    if (existing) {
      updateHolding(ticker, { enabled: true })
      setTickerInput('')
      return
    }
    setLookupLoading(true)
    setLookupError('')
    pf(`/api/lookup/${encodeURIComponent(ticker)}`)
      .then(async response => {
        const body = await response.json()
        if (!response.ok || body.error) throw new Error(body.error || 'Ticker lookup failed.')
        return body
      })
      .then(info => {
        const resolvedTicker = (info.renamed_to || info.ticker || ticker).toUpperCase()
        const multiplier = FREQUENCY_MULTIPLIERS[info.div_frequency] || 0
        const price = Number(info.current_price) || 0
        const annualDistribution = (Number(info.div) || 0) * multiplier
        const currentYield = price > 0 ? annualDistribution / price * 100 : 0
        const nextCount = active.length + 1
        const defaultWeight = nextCount > 0 ? 100 / nextCount : 100
        const scaled = strategy.holdings.map(row => (
          row.enabled === false
            ? row
            : { ...row, weight: Number(row.weight || 0) * (100 - defaultWeight) / 100 }
        ))
        onChange({
          holdings: [...scaled, {
            ticker: resolvedTicker,
            description: info.description || resolvedTicker,
            weight: defaultWeight,
            enabled: true,
            current_price: price,
            current_yield_pct: currentYield,
            classification_type: info.classification_type || '',
            scenario_type: 'other',
            scenario_type_override: '',
            option_strategy: 'auto',
            correlation_group: 'auto',
            imported: false,
          }],
        })
        setTickerInput('')
      })
      .catch(error => setLookupError(error.message))
      .finally(() => setLookupLoading(false))
  }

  return (
    <section className="gif-strategy-card" style={{ '--strategy-color': color }}>
      <div className="gif-strategy-heading">
        <div>
          <span className="gif-strategy-kicker">Strategy {index === 0 ? 'A' : 'B'}</span>
          <input
            className="gif-name-input"
            value={strategy.name}
            onChange={event => onChange({ name: event.target.value, autoName: false })}
            aria-label={`Strategy ${index === 0 ? 'A' : 'B'} name`}
          />
        </div>
        <div className="gif-field gif-style-field">
          <label>Strategy style</label>
          <select value={strategy.style} onChange={event => onChange({ style: event.target.value })}>
            <option value="income">Income</option>
            <option value="growth">Growth</option>
            <option value="custom">Custom / mixed</option>
          </select>
        </div>
      </div>

      <div className="gif-source-tabs" role="group" aria-label={`${strategy.name} source`}>
        <button
          className={strategy.source === 'portfolio' ? 'active' : ''}
          onClick={() => onChange({ source: 'portfolio' })}
        >
          Saved portfolio
        </button>
        <button
          className={strategy.source === 'manual' ? 'active' : ''}
          onClick={() => onChange({ source: 'manual' })}
        >
          Build from tickers
        </button>
      </div>

      {strategy.source === 'portfolio' && (
        <div className="gif-portfolio-picker">
          <div className="gif-field">
            <label>Portfolio</label>
            <select
              value={strategy.profileId}
              onChange={event => onLoadPortfolio(event.target.value)}
              disabled={loading}
              aria-label={`Portfolio or aggregate for ${strategy.name}`}
            >
              <option value="">Choose a portfolio or aggregate…</option>
              {profiles.length > 0 && (
                <optgroup label="Individual accounts">
                  {profiles.map(profile => (
                    <option key={`profile:${profile.id}`} value={`profile:${profile.id}`}>
                      {profile.name}
                    </option>
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
          </div>
          <div className="gif-import-summary">
            {loading
              ? 'Loading holdings…'
              : strategy.currentValue > 0
                ? `${compactMoney(strategy.currentValue)} current value imported`
                : 'Import a portfolio, then edit its holdings and weights below.'}
          </div>
        </div>
      )}

      {strategy.source === 'portfolio' && importedHoldings.length > 0 && (
        <div className="gif-portfolio-scope">
          <div className="gif-portfolio-scope-title">
            <div>
              <strong>Which holdings should be simulated?</strong>
              <span>
                {importedSelected.length} of {importedHoldings.length} saved-portfolio holdings selected
              </span>
            </div>
            <div className="gif-portfolio-scope-buttons" role="group" aria-label="Saved portfolio holding selection">
              <button
                className={strategy.selectionMode !== 'custom' ? 'active' : ''}
                onClick={useEntirePortfolio}
              >
                Entire portfolio
              </button>
              <button
                className={strategy.selectionMode === 'custom' ? 'active' : ''}
                onClick={choosePortfolioHoldings}
              >
                Choose individual holdings
              </button>
            </div>
          </div>

          {strategy.selectionMode === 'custom' && (
            <>
              <button
                className="gif-holding-picker-toggle"
                onClick={toggleHoldingPicker}
                aria-expanded={holdingPickerOpen}
              >
                {holdingPickerOpen ? 'Hide holding picker' : `Open holding picker (${importedSelected.length} selected)`}
              </button>
              {holdingPickerOpen && (
                <div className="gif-holding-picker">
                  <div className="gif-holding-picker-tools">
                    <input
                      value={portfolioSearch}
                      onChange={event => setPortfolioSearch(event.target.value)}
                      placeholder="Search this portfolio by ticker or name"
                      aria-label={`Search holdings in ${strategy.name}`}
                    />
                    <button onClick={useEntirePortfolio}>Select all</button>
                    <button onClick={clearImportedSelection}>Clear selection</button>
                  </div>
                  <div className="gif-holding-picker-list">
                    {visibleImportedHoldings.length === 0 ? (
                      <div className="gif-holding-picker-empty">No holdings match that search.</div>
                    ) : visibleImportedHoldings.map(row => (
                      <label key={row.ticker} className="gif-holding-picker-row">
                        <input
                          type="checkbox"
                          checked={row.enabled !== false}
                          onChange={event => updateHolding(row.ticker, { enabled: event.target.checked })}
                        />
                        <span>
                          <strong>{row.ticker}</strong>
                          <small>{row.description || row.scenario_label || 'Saved portfolio holding'}</small>
                        </span>
                        <em>{pct(row.current_yield_pct || 0, 2)} yield</em>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="gif-add-ticker">
        <input
          value={tickerInput}
          onChange={event => setTickerInput(event.target.value.toUpperCase())}
          onKeyDown={event => { if (event.key === 'Enter') addTicker() }}
          placeholder="Add any ticker, e.g. SCHD"
          aria-label={`Add ticker to ${strategy.name}`}
        />
        <button onClick={addTicker} disabled={lookupLoading}>
          {lookupLoading ? 'Looking up…' : 'Add ticker'}
        </button>
      </div>
      {lookupError && <div className="gif-inline-error">{lookupError}</div>}

      <div className="gif-holding-tools">
        <span>
          {active.length} holding{active.length === 1 ? '' : 's'} · weights {weightTotal.toFixed(1)}%
        </span>
        <button onClick={checkAllHoldings} disabled={!strategy.holdings.length || active.length === strategy.holdings.length}>
          Check all
        </button>
        <button onClick={uncheckAllHoldings} disabled={!active.length}>Uncheck all</button>
        <button onClick={equalWeight} disabled={!active.length}>Equal weight</button>
        <button onClick={normalizeWeights} disabled={!active.length}>Normalize to 100%</button>
        <button
          onClick={() => onChange({ holdings: [], currentValue: 0, profileId: '', source: 'manual' })}
          disabled={!strategy.holdings.length}
        >
          Clear
        </button>
      </div>

      <div className="gif-holdings-wrap">
        {strategy.holdings.length === 0 ? (
          <div className="gif-empty-holdings">
            Select a portfolio or add tickers to build this strategy.
          </div>
        ) : (
          <table className="gif-holdings-table">
            <thead>
              <tr>
                <th aria-label="Include"></th>
                <th>Ticker</th>
                <th>Weight</th>
                <th>Current yield</th>
                <th>Behavior override</th>
                <th>Option structure</th>
                <th>Correlation group</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {strategy.holdings.map(row => (
                <tr key={row.ticker} className={row.enabled === false ? 'disabled' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.enabled !== false}
                      onChange={event => updateHolding(row.ticker, { enabled: event.target.checked })}
                      aria-label={`Include ${row.ticker}`}
                    />
                  </td>
                  <td title={row.description}>
                    <strong>{row.ticker}</strong>
                    <small>{row.scenario_label || row.description || ''}</small>
                  </td>
                  <td>
                    <div className="gif-weight-input">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.weight}
                        disabled={row.enabled === false}
                        onChange={event => updateHolding(row.ticker, {
                          weight: Math.max(0, Number(event.target.value) || 0),
                        })}
                        aria-label={`${row.ticker} weight`}
                      />
                      <span>%</span>
                    </div>
                  </td>
                  <td>{pct(row.current_yield_pct || 0, 2)}</td>
                  <td>
                    <select
                      className="gif-holding-select"
                      value={row.scenario_type_override || ''}
                      disabled={row.enabled === false}
                      onChange={event => updateHolding(row.ticker, {
                        scenario_type_override: event.target.value,
                      })}
                      aria-label={`${row.ticker} behavior override`}
                    >
                      {BEHAVIOR_OPTIONS.map(([value, label]) => (
                        <option key={value || 'auto'} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="gif-holding-select"
                      value={row.option_strategy || 'auto'}
                      disabled={row.enabled === false}
                      onChange={event => updateHolding(row.ticker, {
                        option_strategy: event.target.value,
                      })}
                      aria-label={`${row.ticker} option structure`}
                    >
                      {OPTION_STRATEGY_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="gif-holding-select"
                      value={row.correlation_group || 'auto'}
                      disabled={row.enabled === false}
                      onChange={event => updateHolding(row.ticker, {
                        correlation_group: event.target.value,
                      })}
                      aria-label={`${row.ticker} correlation group`}
                    >
                      {CORRELATION_GROUP_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="gif-remove-ticker"
                      onClick={() => removeHolding(row.ticker)}
                      aria-label={`Remove ${row.ticker}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value, sub, tone }) {
  return (
    <div className={`gif-metric ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function StrategyResultCard({ result, index, targetEnabled }) {
  const summary = result.summary
  const detail = summary.sustainability_detail
  const finalRange = summary.final_real_value
  return (
    <article className="gif-result-card" style={{ '--strategy-color': STRATEGY_COLORS[index] }}>
      <div className="gif-result-head">
        <div>
          <span>{result.style}</span>
          <h3>{result.name}</h3>
        </div>
        <div className="gif-range">
          <small>Real ending value · P10–P90</small>
          <strong>{compactMoney(finalRange.p50)}</strong>
          <span>{compactMoney(finalRange.p10)} – {compactMoney(finalRange.p90)}</span>
        </div>
      </div>
      <div className="gif-result-metrics">
        <Metric
          label="Real monthly income"
          value={money(summary.final_real_monthly_income.p50)}
          sub={`${money(summary.final_monthly_income.p50)} nominal`}
        />
        <Metric
          label="Spending capacity (4% reference)"
          value={money(summary.spending_capacity.p50 / 12)}
          sub="Value × reference rate · informational, not the FI test"
        />
        <Metric
          label="Median max drawdown"
          value={pct(summary.max_drawdown_pct.p50)}
          tone={summary.max_drawdown_pct.p50 <= -30 ? 'bad' : 'warn'}
        />
        <Metric
          label="Distributions reinvested"
          value={compactMoney(summary.cumulative_distributions_reinvested.p50)}
          sub="Generated and reinvested, not added twice"
        />
        {targetEnabled && (
          <>
            <Metric
              label={`FI · money lasts ${summary.money_lasts_years}y`}
              value={pct(summary.fi_lasts_probability)}
              sub={summary.fi_year_lasts
                ? `Reaches FI in year ${summary.fi_year_lasts} (sells shares as needed)`
                : `Not reached at ${pct(summary.fi_confidence_pct, 0)} confidence`}
            />
            <Metric
              label="FI · preserves principal"
              value={pct(summary.fi_principal_probability)}
              sub={summary.fi_year_principal
                ? `Reaches FI in year ${summary.fi_year_principal} (real principal intact)`
                : `Not reached at ${pct(summary.fi_confidence_pct, 0)} confidence`}
            />
            <Metric
              label="Distribution income only"
              value={pct(summary.income_target_probability)}
              sub={summary.freedom_year_income ? `Payouts alone cover it in year ${summary.freedom_year_income}` : 'Payouts alone never cover it'}
            />
            <Metric
              label="Sustainable freedom"
              value={pct(summary.sustainable_freedom_probability)}
              sub="Meets the target after any enabled sustainability tests"
            />
          </>
        )}
      </div>
      {detail && (detail.apply_tax || detail.cap_payout_to_total_return || detail.check_drip_stop_stability || detail.run_withdrawal_phase) && (
        <div className="gif-sustainability-detail">
          <strong>Sustainability detail</strong>
          <div className="gif-result-metrics">
            {(detail.apply_tax || detail.cap_payout_to_total_return) && (
              <Metric
                label="Sustainability-adjusted income"
                value={money(detail.sustainability_adjusted_monthly_income?.p50)}
                sub={detail.apply_tax
                  ? `After ${detail.tax_rate_pct}% estimated tax${detail.cap_payout_to_total_return ? ' and payout cap' : ''}`
                  : 'Capped at sustainable total return'}
              />
            )}
            {detail.cap_payout_to_total_return && (
              <Metric
                label="Payout vs. total return"
                value={detail.payout_sustainable_ratio_pct == null ? '—' : pct(detail.payout_sustainable_ratio_pct)}
                sub={detail.payout_sustainable_ratio_pct > 100 ? 'Yield exceeds expected total return' : 'Within expected total return'}
                tone={detail.payout_sustainable_ratio_pct > 100 ? 'bad' : undefined}
              />
            )}
            {detail.check_drip_stop_stability && (
              <Metric
                label="Capital stability without DRIP"
                value={pct(detail.capital_stability_probability)}
                sub="Chance principal holds up once distributions are taken as cash"
              />
            )}
            {detail.run_withdrawal_phase && (
              <Metric
                label={`Withdrawal-phase survival (+${detail.withdrawal_years}y)`}
                value={pct(detail.withdrawal_survival_probability)}
                sub="Chance principal doesn't deplete funding the freedom target"
              />
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function WinnerCard({ cardKey, label, scenario, strategies, allScenarios, years, targetEnabled }) {
  const winner = rankStrategies(strategies, cardKey, targetEnabled)
  if (!winner) return null

  const scenarioLabel = SCENARIOS.find(row => row.key === scenario)?.label || scenario
  const metricLabel = winnerMetricLabel(cardKey, targetEnabled)
  const names = winner.leaders.map(row => row.strategy.name)
  const scenarioRanks = SCENARIOS
    .map(row => rankStrategies(allScenarios?.[row.key]?.strategies || [], cardKey, targetEnabled))
    .filter(Boolean)
  const winCounts = new Map()
  scenarioRanks.forEach(rank => {
    if (!rank.tied) {
      winCounts.set(rank.strategy.name, (winCounts.get(rank.strategy.name) || 0) + 1)
    }
  })
  const highestCount = Math.max(0, ...winCounts.values())
  const overallLeaders = [...winCounts.entries()].filter(([, count]) => count === highestCount)
  let overallText = 'All three scenarios are effectively tied.'
  if (highestCount > 0 && overallLeaders.length === 1) {
    overallText = `Leads ${highestCount} of 3 market scenarios.`
  } else if (highestCount > 0) {
    overallText = `Split between ${overallLeaders.map(([name]) => name).join(' and ')}.`
  }

  return (
    <article className="gif-winner-card" style={{ '--scenario-color': SCENARIOS.find(row => row.key === scenario)?.color }}>
      <span className="gif-winner-kicker">{label} winner · {scenarioLabel} · {years}-year run</span>
      <h3>
        {winner.tied ? `Tie: ${names.join(' and ')}` : winner.strategy.name}
      </h3>
      <p>
        {winner.tied
          ? `${names.join(' and ')} finish within the tie range at ${winnerMetricValue(winner.value, cardKey, targetEnabled)} ${metricLabel}.`
          : `Leads with ${winnerMetricValue(winner.value, cardKey, targetEnabled)} ${metricLabel}.`}
        {cardKey === 'sustainableFreedom' && !targetEnabled && ' No freedom target is set, so real ending wealth is used.'}
      </p>
      <strong className="gif-winner-overall">{overallText}</strong>
    </article>
  )
}

function WinnerPanel({ scenario, strategies, allScenarios, years, targetEnabled }) {
  if (!strategies?.length) return null
  return (
    <section className="gif-winner-grid">
      {WINNER_CARDS.filter(card => card.key !== 'freedomFirst' || targetEnabled).map(card => (
        <WinnerCard
          key={card.key}
          cardKey={card.key}
          label={card.label}
          scenario={scenario}
          strategies={strategies}
          allScenarios={allScenarios}
          years={years}
          targetEnabled={targetEnabled}
        />
      ))}
    </section>
  )
}

function ScenarioOverviewCards({
  allScenarios,
  years,
  targetEnabled,
  selectedScenario,
  onSelectScenario,
}) {
  return (
    <section className="gif-scenario-overview">
      <div className="gif-scenario-overview-heading">
        <div>
          <span className="gif-eyebrow">Results at a glance</span>
          <h2>Bull, neutral and bear winners</h2>
        </div>
        <p>
          Projected outcomes after {years} year{years === 1 ? '' : 's'} · wealth, income, and
          sustainable-freedom winners per scenario
        </p>
      </div>
      <div className="gif-scenario-overview-grid">
        {SCENARIOS.map(scenario => {
          const strategies = allScenarios?.[scenario.key]?.strategies || []
          const leaderLines = WINNER_CARDS.filter(card => card.key !== 'freedomFirst' || targetEnabled).map(card => {
            const winner = rankStrategies(strategies, card.key, targetEnabled)
            const text = winner?.tied
              ? `Tie: ${winner.leaders.map(row => row.strategy.name).join(' / ')}`
              : winner?.strategy.name || 'Unavailable'
            return { key: card.key, label: card.label, text }
          })
          return (
            <button
              key={scenario.key}
              className={`gif-scenario-overview-card ${selectedScenario === scenario.key ? 'active' : ''}`}
              style={{ '--scenario-color': scenario.color }}
              onClick={() => onSelectScenario(scenario.key)}
              aria-pressed={selectedScenario === scenario.key}
            >
              <div className="gif-scenario-overview-card-head">
                <div>
                  <span>{scenario.label} market</span>
                  <div className="gif-scenario-overview-leaders">
                    {leaderLines.map(item => (
                      <strong key={item.key}>{item.label}: {item.text}</strong>
                    ))}
                  </div>
                </div>
                <em>View details</em>
              </div>
              <div className="gif-scenario-overview-labels">
                <span>Strategy</span>
                <span>Total portfolio value</span>
                <span>Monthly income</span>
              </div>
              {strategies.map((strategy, index) => (
                <div className="gif-scenario-overview-row" key={strategy.name}>
                  <strong style={{ color: STRATEGY_COLORS[index] }}>{strategy.name}</strong>
                  <span>{money(strategy.summary.final_real_value.p50)}</span>
                  <span>{money(strategy.summary.final_real_monthly_income.p50)}</span>
                </div>
              ))}
              <small>Median values in today&apos;s dollars</small>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ProjectedIncomePanel({ strategies, years, scenario }) {
  const scenarioLabel = SCENARIOS.find(row => row.key === scenario)?.label || scenario
  return (
    <section className="gif-income-summary">
      <div className="gif-income-summary-heading">
        <div>
          <span className="gif-eyebrow">Projected distribution income</span>
          <h3>Income generated after {years} year{years === 1 ? '' : 's'}</h3>
        </div>
        <p>
          {scenarioLabel} scenario · median values in today&apos;s dollars · all distributions,
          including growth holdings, remain reinvested
        </p>
      </div>
      <div className="gif-income-summary-grid">
        {strategies.map((strategy, index) => {
          const realMonthly = strategy.summary.final_real_monthly_income
          const realAnnual = strategy.summary.final_real_annual_income
          const nominalMonthly = strategy.summary.final_monthly_income
          return (
            <article
              key={strategy.name}
              className="gif-income-summary-card"
              style={{ '--strategy-color': STRATEGY_COLORS[index] }}
            >
              <div>
                <span>{strategy.style}</span>
                <h4>{strategy.name}</h4>
              </div>
              <div className="gif-income-summary-values">
                <div>
                  <span>Projected monthly income</span>
                  <strong>{money(realMonthly.p50)}</strong>
                </div>
                <div>
                  <span>Projected annual income</span>
                  <strong>{money(realAnnual.p50)}</strong>
                </div>
              </div>
              <small>
                P10–P90 monthly range: {money(realMonthly.p10)}–{money(realMonthly.p90)}
                {' '}· {money(nominalMonthly.p50)}/month nominal
              </small>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default function GrowthIncomeFreedom() {
  const pf = useProfileFetch()
  const { profiles, aggregates } = useProfile()
  const [strategies, setStrategies] = useState([
    createStrategy('Income Strategy', 'income'),
    createStrategy('Growth Strategy', 'growth'),
  ])
  const [portfolioLoading, setPortfolioLoading] = useState([false, false])
  const [years, setYears] = useState(10)
  const [startingCapital, setStartingCapital] = useState(100000)
  const [monthlyContribution, setMonthlyContribution] = useState(1000)
  const [inflationRate, setInflationRate] = useState(2.5)
  const [freedomTarget, setFreedomTarget] = useState(5000)
  const [spendingRate, setSpendingRate] = useState(4)
  const [fiConfidence, setFiConfidence] = useState(85)
  const [moneyLastsYears, setMoneyLastsYears] = useState(25)
  const [paths, setPaths] = useState(500)
  const [blendEnabled, setBlendEnabled] = useState(false)
  const [blendA, setBlendA] = useState(50)
  const [selectedScenario, setSelectedScenario] = useState('neutral')
  const [applyTax, setApplyTax] = useState(false)
  const [taxRatePct, setTaxRatePct] = useState(15)
  const [capPayout, setCapPayout] = useState(false)
  const [checkDripStop, setCheckDripStop] = useState(false)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const initialized = useRef(false)

  const patchStrategy = useCallback((index, patch) => {
    setDirty(true)
    setStrategies(previous => previous.map((strategy, i) => (
      i === index ? { ...strategy, ...patch } : strategy
    )))
  }, [])

  const loadPortfolio = useCallback((index, portfolioKey) => {
    patchStrategy(index, { profileId: portfolioKey, source: 'portfolio' })
    if (!portfolioKey) {
      patchStrategy(index, { holdings: [], currentValue: 0 })
      return
    }
    const [sourceType, sourceId] = String(portfolioKey).includes(':')
      ? String(portfolioKey).split(':', 2)
      : ['profile', String(portfolioKey)]
    const endpoint = sourceType === 'aggregate'
      ? `/api/accumulation-compare/aggregate/${sourceId}`
      : `/api/accumulation-compare/portfolio/${sourceId}`
    setPortfolioLoading(previous => previous.map((value, i) => i === index ? true : value))
    pf(endpoint)
      .then(async response => {
        const body = await response.json()
        if (!response.ok || body.error) throw new Error(body.error || 'Portfolio could not be loaded.')
        return body
      })
      .then(body => {
        const portfolioName = body.name || strategies[index].name
        patchStrategy(index, {
          profileId: portfolioKey,
          name: portfolioName,
          portfolioName,
          autoName: true,
          currentValue: body.current_value || 0,
          selectionMode: 'all',
          holdings: (body.holdings || []).map(row => ({
            ...row,
            enabled: true,
            imported: true,
            portfolio_weight: row.weight,
          })),
        })
      })
      .catch(loadError => setError(loadError.message))
      .finally(() => {
        setPortfolioLoading(previous => previous.map((value, i) => i === index ? false : value))
      })
  }, [pf, patchStrategy, strategies])

  useEffect(() => {
    if (initialized.current || profiles.length === 0) return
    initialized.current = true
    loadPortfolio(0, `profile:${profiles[0].id}`)
    loadPortfolio(1, `profile:${(profiles[1] || profiles[0]).id}`)
  }, [profiles, loadPortfolio])

  const requestStrategies = useMemo(() => {
    const base = strategies.map(strategy => ({
      name: strategy.name,
      style: strategy.style,
      holdings: normalizeHoldings(strategy.holdings),
    }))
    if (blendEnabled) base.push(buildBlend(strategies[0], strategies[1], blendA))
    return base
  }, [strategies, blendEnabled, blendA])

  const validationError = useMemo(() => {
    for (const strategy of requestStrategies.slice(0, 2)) {
      if (!strategy.name.trim()) return 'Give both strategies a name.'
      if (strategy.holdings.length === 0) return `${strategy.name}: add at least one enabled ticker with a positive weight.`
    }
    return ''
  }, [requestStrategies])

  const runSimulation = () => {
    if (validationError) {
      setError(validationError)
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    pf('/api/accumulation-compare/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        years,
        starting_capital: startingCapital,
        monthly_contribution: monthlyContribution,
        inflation_rate: inflationRate,
        freedom_monthly_target: freedomTarget,
        spending_rate: spendingRate,
        fi_confidence_pct: fiConfidence,
        money_lasts_years: moneyLastsYears,
        paths,
        strategies: requestStrategies,
        sustainability: {
          apply_tax: applyTax,
          tax_rate_pct: taxRatePct,
          cap_payout_to_total_return: capPayout,
          check_drip_stop_stability: checkDripStop,
        },
      }),
    })
      .then(async response => {
        const rawBody = await response.text()
        if (!rawBody.trim()) {
          throw new Error(
            'The simulation service disconnected before returning results. '
            + 'The portfolio settings are still here; wait a moment and run the comparison again.'
          )
        }
        let body
        try {
          body = JSON.parse(rawBody)
        } catch {
          throw new Error(
            response.ok
              ? 'The simulation completed without a readable result. Please run it again.'
              : `The simulation service returned an unreadable error (HTTP ${response.status}). Please retry.`
          )
        }
        if (!response.ok || body.error) throw new Error(body.error || 'Simulation failed.')
        return body
      })
      .then(body => {
        setResult(body)
        setDirty(false)
      })
      .catch(runError => setError(runError.message))
      .finally(() => setLoading(false))
  }

  const selectedResults = result?.scenarios?.[selectedScenario]?.strategies || []
  const targetEnabled = (result?.settings?.freedom_monthly_target ?? freedomTarget) > 0
  const resultYears = result?.settings?.years || years
  const valueTraces = useMemo(() => {
    const traces = []
    selectedResults.forEach((strategy, index) => {
      const color = STRATEGY_COLORS[index]
      const series = strategy.yearly_series || []
      const x = series.map(row => `Year ${row.year}`)
      traces.push(
        {
          x,
          y: series.map(row => row.real_value.p90),
          type: 'scatter',
          mode: 'lines',
          line: { width: 0 },
          showlegend: false,
          hoverinfo: 'skip',
        },
        {
          x,
          y: series.map(row => row.real_value.p10),
          type: 'scatter',
          mode: 'lines',
          line: { width: 0 },
          fill: 'tonexty',
          fillcolor: `${color}18`,
          showlegend: false,
          hoverinfo: 'skip',
        },
        {
          x,
          y: series.map(row => row.real_value.p50),
          type: 'scatter',
          mode: 'lines+markers',
          name: strategy.name,
          line: { color, width: 3 },
          marker: { color, size: 5 },
          hovertemplate: '%{x}<br>%{y:$,.0f}<extra>%{fullData.name}</extra>',
        },
      )
    })
    return traces
  }, [selectedResults])

  const incomeTraces = useMemo(() => selectedResults.map((strategy, index) => ({
    x: (strategy.yearly_series || []).map(row => `Year ${row.year}`),
    y: (strategy.yearly_series || []).map(row => row.real_annual_income.p50 / 12),
    type: 'scatter',
    mode: 'lines+markers',
    name: strategy.name,
    line: { color: STRATEGY_COLORS[index], width: 3 },
    marker: { color: STRATEGY_COLORS[index], size: 5 },
    hovertemplate: '%{x}<br>%{y:$,.0f}/month<extra>%{fullData.name}</extra>',
  })), [selectedResults])

  return (
    <div className="page gif-page">
      <header className="gif-page-header">
        <div>
          <span className="gif-eyebrow">Accumulation planning</span>
          <h1>Growth &amp; Income Freedom Simulator</h1>
          <p>
            Compare income with income, growth with growth, or any combination using equal capital,
            identical contributions, and shared market conditions.
          </p>
        </div>
        <div className="gif-policy-badge">
          <strong>100% DRIP</strong>
          <span>No withdrawals during the growth phase</span>
        </div>
      </header>

      <section className="gif-method-card">
        <div className="gif-method-copy">
          <span>Simulation method</span>
          <strong>Forward Monte Carlo · Bull, Neutral &amp; Bear</strong>
        </div>
        <p>
          Each run blends market history with strategy-specific assumptions. Both sides receive the
          same market shocks, while distributions and volatility remain specific to each holding.
        </p>
        <div className="gif-method-horizon">
          <label htmlFor="gif-simulation-years">Simulation length</label>
          <select
            id="gif-simulation-years"
            value={years}
            aria-label="Simulation length"
            onChange={event => {
              setYears(Number(event.target.value))
              setDirty(true)
            }}
          >
            {Array.from({ length: 25 }, (_, index) => index + 1).map(option => (
              <option key={option} value={option}>
                {option} year{option === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <small>Choose 1–25 years · {years * 12} months</small>
        </div>
      </section>

      <div className="gif-strategy-grid">
        {strategies.map((strategy, index) => (
          <StrategyBuilder
            key={index}
            index={index}
            strategy={strategy}
            profiles={profiles}
            aggregates={aggregates}
            loading={portfolioLoading[index]}
            onChange={patch => patchStrategy(index, patch)}
            onLoadPortfolio={profileId => loadPortfolio(index, profileId)}
          />
        ))}
      </div>

      <section className="gif-assumptions-card">
        <div className="gif-assumptions-title">
          <div>
            <span className="gif-eyebrow">Shared comparison assumptions</span>
            <h2>Keep the contest fair</h2>
          </div>
          <p>Both strategies start with and receive the same dollars.</p>
        </div>
        <div className="gif-assumption-grid">
          <div className="gif-field">
            <label>Starting capital per strategy</label>
            <div className="gif-money-input">
              <span>$</span>
              <input type="number" min="1" step="1000" value={startingCapital}
                onChange={event => {
                  setStartingCapital(Math.max(1, Number(event.target.value) || 1))
                  setDirty(true)
                }} />
            </div>
          </div>
          <div className="gif-field">
            <label>Monthly contribution per strategy</label>
            <div className="gif-money-input">
              <span>$</span>
              <input type="number" min="0" step="100" value={monthlyContribution}
                onChange={event => {
                  setMonthlyContribution(Math.max(0, Number(event.target.value) || 0))
                  setDirty(true)
                }} />
            </div>
          </div>
          <div className="gif-field">
            <label>Inflation</label>
            <div className="gif-percent-input">
              <input type="number" min="0" max="20" step="0.1" value={inflationRate}
                onChange={event => {
                  setInflationRate(Math.max(0, Number(event.target.value) || 0))
                  setDirty(true)
                }} />
              <span>%</span>
            </div>
          </div>
          <div className="gif-field">
            <label>Freedom target · monthly, today&apos;s dollars</label>
            <div className="gif-money-input">
              <span>$</span>
              <input type="number" min="0" step="100" value={freedomTarget}
                onChange={event => {
                  setFreedomTarget(Math.max(0, Number(event.target.value) || 0))
                  setDirty(true)
                }} />
            </div>
          </div>
          <div className="gif-field">
            <label>FI confidence · share of paths that must last</label>
            <div className="gif-percent-input">
              <input type="number" min="50" max="99" step="1" value={fiConfidence}
                onChange={event => {
                  setFiConfidence(Math.min(99, Math.max(50, Number(event.target.value) || 50)))
                  setDirty(true)
                }} />
              <span>%</span>
            </div>
          </div>
          <div className="gif-field">
            <label>Money must last · years of withdrawals</label>
            <div className="gif-percent-input">
              <input type="number" min="1" max="40" step="1" value={moneyLastsYears}
                onChange={event => {
                  setMoneyLastsYears(Math.min(40, Math.max(1, Number(event.target.value) || 1)))
                  setDirty(true)
                }} />
              <span>yrs</span>
            </div>
          </div>
          <div className="gif-field">
            <label>Reference spending rate · informational only</label>
            <div className="gif-percent-input">
              <input type="number" min="0.1" max="20" step="0.1" value={spendingRate}
                onChange={event => {
                  setSpendingRate(Math.max(0.1, Number(event.target.value) || 0.1))
                  setDirty(true)
                }} />
              <span>%</span>
            </div>
          </div>
          <div className="gif-field">
            <label>Monte Carlo paths</label>
            <select value={paths} onChange={event => {
              setPaths(Number(event.target.value))
              setDirty(true)
            }}>
              <option value={300}>300 · faster</option>
              <option value={500}>500 · standard</option>
              <option value={1000}>1,000 · steadier ranges</option>
            </select>
          </div>
        </div>

        <div className="gif-sustainability-control">
          <div className="gif-sustainability-title">
            <strong>Sustainability tests</strong>
            <span>Taxes and payout caps also flow into the FI funding test. Leave taxes off for Roth or other tax-free accounts.</span>
          </div>
          <div className="gif-sustainability-grid">
            <div className="gif-sustainability-item">
              <label>
                <input type="checkbox" checked={applyTax} onChange={event => {
                  setApplyTax(event.target.checked)
                  setDirty(true)
                }} />
                Income after estimated taxes
              </label>
              <small className="gif-sustainability-hint">Leave off for Roth / tax-advantaged accounts (no tax on withdrawals).</small>
              {applyTax && (
                <div className="gif-percent-input gif-sustainability-subinput">
                  <input type="number" min="0" max="100" step="1" value={taxRatePct}
                    onChange={event => {
                      setTaxRatePct(Math.min(100, Math.max(0, Number(event.target.value) || 0)))
                      setDirty(true)
                    }} />
                  <span>% tax</span>
                </div>
              )}
            </div>
            <div className="gif-sustainability-item">
              <label>
                <input type="checkbox" checked={capPayout} onChange={event => {
                  setCapPayout(event.target.checked)
                  setDirty(true)
                }} />
                Payout limited by sustainable total return
              </label>
            </div>
            <div className="gif-sustainability-item">
              <label>
                <input type="checkbox" checked={checkDripStop} onChange={event => {
                  setCheckDripStop(event.target.checked)
                  setDirty(true)
                }} />
                Capital stays stable after stopping DRIP
              </label>
            </div>
          </div>
          <small className="gif-sustainability-note">
            The FI dates below actively sell shares to fund the target and require the money to last the
            “Money must last” horizon. These toggles refine that test and the Sustainable Freedom winner;
            the value/income lines above still assume 100% DRIP and no withdrawals.
          </small>
        </div>

        <div className="gif-blend-control">
          <label>
            <input type="checkbox" checked={blendEnabled} onChange={event => {
              setBlendEnabled(event.target.checked)
              setDirty(true)
            }} />
            Add a combined strategy
          </label>
          {blendEnabled && (
            <div className="gif-blend-slider">
              <span>{strategies[0].name}: {blendA}%</span>
              <input type="range" min="0" max="100" step="5" value={blendA}
                onChange={event => {
                  setBlendA(Number(event.target.value))
                  setDirty(true)
                }} />
              <span>{strategies[1].name}: {100 - blendA}%</span>
            </div>
          )}
        </div>

        <div className="gif-run-row">
          <div>
            <strong>{years}-year run · {requestStrategies.length} strategies × 3 market scenarios</strong>
            <span>Results are shown in nominal and inflation-adjusted dollars.</span>
          </div>
          <button className="gif-run-button" onClick={runSimulation} disabled={loading || Boolean(validationError)}>
            {loading ? 'Calibrating and simulating…' : 'Run comparison'}
          </button>
        </div>
        {validationError && <div className="gif-inline-error">{validationError}</div>}
        {error && <div className="gif-error" role="alert">{error}</div>}
      </section>

      {loading && (
        <div className="gif-loading-panel">
          <div className="dc-spin-icon"></div>
          <strong>Building shared market paths</strong>
          <span>Loading history, calibrating holdings, and running all three scenarios…</span>
        </div>
      )}

      {result && (
        <section className="gif-results">
          {dirty && (
            <div className="gif-stale-banner">
              Inputs changed after this run. Run the comparison again to refresh these results.
            </div>
          )}
          <ScenarioOverviewCards
            allScenarios={result.scenarios}
            years={resultYears}
            targetEnabled={targetEnabled}
            selectedScenario={selectedScenario}
            onSelectScenario={setSelectedScenario}
          />
          <div className="gif-results-heading">
            <div>
              <span className="gif-eyebrow">Selected scenario details</span>
              <h2>Projected winner and tradeoffs</h2>
            </div>
            <div className="gif-scenario-tabs">
              {SCENARIOS.map(scenario => (
                <button
                  key={scenario.key}
                  className={selectedScenario === scenario.key ? 'active' : ''}
                  style={{ '--scenario-color': scenario.color }}
                  onClick={() => setSelectedScenario(scenario.key)}
                >
                  <strong>{scenario.label}</strong>
                  <span>{scenario.detail}</span>
                </button>
              ))}
            </div>
          </div>

          <WinnerPanel
            scenario={selectedScenario}
            strategies={selectedResults}
            allScenarios={result.scenarios}
            years={resultYears}
            targetEnabled={targetEnabled}
          />

          <ProjectedIncomePanel
            strategies={selectedResults}
            years={resultYears}
            scenario={selectedScenario}
          />

          <div className="gif-result-grid">
            {selectedResults.map((strategy, index) => (
              <StrategyResultCard
                key={strategy.name}
                result={strategy}
                index={index}
                targetEnabled={targetEnabled}
              />
            ))}
          </div>

          <div className="gif-chart-grid">
            <div className="gif-chart-card">
              <div>
                <h3>Real portfolio value</h3>
                <p>Median path with a shaded 10th–90th percentile range.</p>
              </div>
              <ThemedPlot
                data={valueTraces}
                layout={{
                  autosize: true,
                  height: 410,
                  margin: { l: 70, r: 20, t: 20, b: 50 },
                  hovermode: 'x unified',
                  xaxis: { title: 'Simulation year' },
                  yaxis: { title: 'Value in today’s dollars', tickprefix: '$' },
                  legend: { orientation: 'h', y: 1.12 },
                }}
                config={{ responsive: true, displaylogo: false }}
                useResizeHandler
                style={{ width: '100%' }}
              />
            </div>
            <div className="gif-chart-card">
              <div>
                <h3>Real monthly distribution income</h3>
                <p>What the holdings could be producing at each year-end while DRIP remains on.</p>
              </div>
              <ThemedPlot
                data={incomeTraces}
                layout={{
                  autosize: true,
                  height: 410,
                  margin: { l: 70, r: 20, t: 20, b: 50 },
                  hovermode: 'x unified',
                  xaxis: { title: 'Simulation year' },
                  yaxis: { title: 'Monthly income in today’s dollars', tickprefix: '$' },
                  legend: { orientation: 'h', y: 1.12 },
                }}
                config={{ responsive: true, displaylogo: false }}
                useResizeHandler
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div className="gif-scenario-table-card">
            <div>
              <h3>All scenarios at the finish line</h3>
              <p>Median inflation-adjusted outcomes; drawdown is the median worst decline per path.</p>
            </div>
            <div className="gif-table-scroll">
              <table className="gif-scenario-table">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Strategy</th>
                    <th>Real ending value</th>
                    <th>Real monthly income</th>
                    <th>Real monthly spending</th>
                    <th>Median max drawdown</th>
                    {targetEnabled && <th>Income target chance</th>}
                  </tr>
                </thead>
                <tbody>
                  {SCENARIOS.flatMap(scenario => (
                    (result.scenarios[scenario.key]?.strategies || []).map((strategy, index) => (
                      <tr key={`${scenario.key}-${strategy.name}`}>
                        <td>
                          <span className="gif-scenario-dot" style={{ background: scenario.color }}></span>
                          {scenario.label}
                        </td>
                        <td style={{ color: STRATEGY_COLORS[index] }}><strong>{strategy.name}</strong></td>
                        <td>{money(strategy.summary.final_real_value.p50)}</td>
                        <td>{money(strategy.summary.final_real_monthly_income.p50)}</td>
                        <td>{money(strategy.summary.spending_capacity.p50 / 12)}</td>
                        <td>{pct(strategy.summary.max_drawdown_pct.p50)}</td>
                        {targetEnabled && <td>{pct(strategy.summary.income_target_probability)}</td>}
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {(result.data_quality_warnings || []).length > 0 && (
            <details className="gif-quality-panel">
              <summary>Data quality and fallback notes ({result.data_quality_warnings.length})</summary>
              <ul>
                {result.data_quality_warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </details>
          )}

          {result.correlation_model && (
            <details className="gif-quality-panel">
              <summary>
                Correlation model · average {pct(result.correlation_model.average_correlation * 100, 0)}
                {' '}→ bear {pct(result.correlation_model.bear_average_correlation * 100, 0)}
              </summary>
              <div className="gif-correlation-summary">
                <p>
                  {result.correlation_model.historical_pair_count} pairs use overlapping market history;
                  {' '}{result.correlation_model.fallback_pair_count} use conservative group fallbacks.
                  Bear-market correlations are stressed upward for risk assets.
                </p>
                {(result.correlation_model.strongest_pairs || []).length > 0 && (
                  <div className="gif-correlation-pairs">
                    {result.correlation_model.strongest_pairs.map(row => (
                      <span key={`${row.left}-${row.right}`}>
                        <strong>{row.left} / {row.right}</strong>
                        {pct(row.correlation * 100, 0)}
                        <small>
                          {row.source}
                          {row.overlap_months > 0 ? ` · ${row.overlap_months} months` : ''}
                        </small>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}

          <details className="gif-quality-panel">
            <summary>Holding assumptions used in this run</summary>
            <div className="gif-table-scroll">
              <table className="gif-scenario-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Behavior</th>
                    <th>Option structure</th>
                    <th>Correlation group</th>
                    <th>Current yield</th>
                    <th>Expected total return</th>
                    <th>Forecast volatility</th>
                    <th>Avg. correlation</th>
                    <th>Beta</th>
                    <th>Yield ceiling</th>
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.assumptions || []).map(row => (
                    <tr key={row.ticker}>
                      <td><strong>{row.ticker}</strong></td>
                      <td>{row.scenario_label}</td>
                      <td>{OPTION_STRATEGY_OPTIONS.find(([value]) => value === row.option_strategy)?.[1] || row.option_strategy}</td>
                      <td>{CORRELATION_GROUP_OPTIONS.find(([value]) => value === row.correlation_group)?.[1] || row.correlation_group}</td>
                      <td>{pct(row.current_yield * 100, 2)}</td>
                      <td>{pct(row.expected_total_return * 100, 2)}</td>
                      <td>
                        {pct((row.forecast_annual_volatility ?? row.annual_volatility) * 100, 1)}
                        {row.history_confidence_pct < 100 && (
                          <small className="gif-table-sub">
                            {pct(row.annual_volatility * 100, 1)} base
                          </small>
                        )}
                      </td>
                      <td>{pct((row.average_correlation || 0) * 100, 0)}</td>
                      <td>{Number(row.beta).toFixed(2)}</td>
                      <td>{pct(row.sustainable_yield_cap * 100, 1)}</td>
                      <td>
                        {row.history_years > 0 ? `${row.history_years} years` : 'Class fallback'}
                        <small className="gif-table-sub">
                          {pct(row.history_confidence_pct || 0, 0)} confidence
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="gif-disclaimer">
            These are hypothetical planning ranges, not forecasts or guarantees. The “Reaches FI” dates
            retire at each year and fund the freedom target from distributions plus share sales, requiring
            the money to last the “Money must last” horizon at your chosen confidence; “preserves principal”
            additionally keeps real starting value intact. “Spending capacity (4% reference)” is an
            informational value × rate figure only and does not drive the FI dates. The value/income charts
            still assume 100% DRIP and no withdrawals. Estimated taxes apply only when enabled — leave them
            off for Roth or other tax-free accounts.
          </div>
        </section>
      )}
    </div>
  )
}
