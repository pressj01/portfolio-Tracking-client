import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import ThemedPlot from './ThemedPlot'

const STRATEGIES = {
  covered_call: {
    label: 'Covered call',
    description: 'Long 100 shares and short one call.',
    capital: 'Fully covered by 100 shares per contract.',
    legs: [{ name: 'Short call', side: 'Sell', type: 'Call', method: 'delta', value: 30 }],
  },
  cash_secured_put: {
    label: 'Cash-secured put',
    description: 'Short one put with cash reserved for assignment.',
    capital: 'Cash is reserved at the short-put strike.',
    legs: [{ name: 'Short put', side: 'Sell', type: 'Put', method: 'delta', value: 30 }],
  },
  protective_put: {
    label: 'Protective put',
    description: 'Long 100 shares and long one downside put.',
    capital: 'Fully funded for the shares and put debit.',
    legs: [{ name: 'Long put', side: 'Buy', type: 'Put', method: 'delta', value: 30 }],
  },
  collar: {
    label: 'Collar',
    description: 'Long shares, long a downside put, and short an upside call.',
    capital: 'Fully funded for 100 shares plus any net option debit.',
    legs: [
      { name: 'Long put', side: 'Buy', type: 'Put', method: 'delta', value: 15 },
      { name: 'Short call', side: 'Sell', type: 'Call', method: 'delta', value: 30 },
    ],
  },
  bull_call_spread: {
    label: 'Bull call spread', description: 'Long a higher-delta call and short a lower-delta call.', capital: 'Fully funded to modeled maximum loss.',
    legs: [{ name: 'Long call', side: 'Buy', type: 'Call', method: 'delta', value: 70 }, { name: 'Short call', side: 'Sell', type: 'Call', method: 'delta', value: 30 }],
  },
  bear_put_spread: {
    label: 'Bear put spread', description: 'Long a higher-delta put and short a lower-delta put.', capital: 'Fully funded to modeled maximum loss.',
    legs: [{ name: 'Long put', side: 'Buy', type: 'Put', method: 'delta', value: 70 }, { name: 'Short put', side: 'Sell', type: 'Put', method: 'delta', value: 30 }],
  },
  bull_put_spread: {
    label: 'Bull put spread', description: 'Short a put and buy a farther downside put.', capital: 'Fully funded to modeled maximum loss.',
    legs: [{ name: 'Short put', side: 'Sell', type: 'Put', method: 'delta', value: 30 }, { name: 'Long put', side: 'Buy', type: 'Put', method: 'delta', value: 15 }],
  },
  bear_call_spread: {
    label: 'Bear call spread', description: 'Short a call and buy a farther upside call.', capital: 'Fully funded to modeled maximum loss.',
    legs: [{ name: 'Short call', side: 'Sell', type: 'Call', method: 'delta', value: 30 }, { name: 'Long call', side: 'Buy', type: 'Call', method: 'delta', value: 15 }],
  },
  long_straddle: {
    label: 'Long straddle', description: 'Long an at-the-money call and put at one expiry.', capital: 'Fully funded to the total option debit.',
    legs: [{ name: 'Long call', side: 'Buy', type: 'Call', method: 'moneyness', value: 0 }, { name: 'Long put', side: 'Buy', type: 'Put', method: 'moneyness', value: 0 }],
  },
  long_strangle: {
    label: 'Long strangle', description: 'Long an out-of-the-money call and put at one expiry.', capital: 'Fully funded to the total option debit.',
    legs: [{ name: 'Long call', side: 'Buy', type: 'Call', method: 'delta', value: 30 }, { name: 'Long put', side: 'Buy', type: 'Put', method: 'delta', value: 30 }],
  },
  iron_condor: {
    label: 'Iron condor', description: 'Short an out-of-the-money call and put with protective wings.', capital: 'Fully funded to the wider wing maximum loss.',
    legs: [
      { name: 'Long put', side: 'Buy', type: 'Put', method: 'delta', value: 15 },
      { name: 'Short put', side: 'Sell', type: 'Put', method: 'delta', value: 30 },
      { name: 'Short call', side: 'Sell', type: 'Call', method: 'delta', value: 30 },
      { name: 'Long call', side: 'Buy', type: 'Call', method: 'delta', value: 15 },
    ],
  },
}

const cloneLegRules = strategy => strategy.legs.map(leg => ({ ...leg }))

const savedOptionLegs = saved => (saved?.legs || []).filter(leg => Number(leg.included ?? 1) !== 0 && String(leg.opt_type).toUpperCase() !== 'STOCK')
const savedStockUnits = saved => (saved?.legs || [])
  .filter(leg => Number(leg.included ?? 1) !== 0 && String(leg.opt_type).toUpperCase() === 'STOCK')
  .reduce((total, leg) => total + Math.max(0, Number(leg.qty) || 0) / 100, 0)
const rulesFromSaved = (saved, referenceSpot) => savedOptionLegs(saved).map((leg, index) => ({
  name: `${String(leg.side).toUpperCase() === 'SELL' ? 'Short' : 'Long'} ${String(leg.opt_type).toLowerCase()}`,
  side: String(leg.side).toUpperCase() === 'SELL' ? 'Sell' : 'Buy',
  type: String(leg.opt_type).toUpperCase() === 'PUT' ? 'Put' : 'Call',
  quantity: Math.max(1, Number(leg.qty) || 1),
  method: referenceSpot > 0 ? 'moneyness' : 'fixed',
  value: referenceSpot > 0 ? Number((((Number(leg.strike) / referenceSpot) - 1) * 100).toFixed(2)) : Number(leg.strike),
  sourceStrike: Number(leg.strike),
  sourceIndex: index,
}))

const localISO = date => {
  const value = new Date(date)
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
  return value.toISOString().slice(0, 10)
}

const todayISO = () => localISO(new Date())
const yearsAgoISO = years => {
  const value = new Date()
  value.setFullYear(value.getFullYear() - years)
  return localISO(value)
}

const money = value => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toLocaleString(undefined, {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    })
const optionMoney = value => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toLocaleString(undefined, {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
    })
const moneySigned = value => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${Number(value) >= 0 ? '+' : '−'}${money(Math.abs(Number(value)))}`
const pct = (value, digits = 1) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${(Number(value) * 100).toFixed(digits)}%`
const number = (value, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toFixed(digits)
const shortDate = value => {
  if (!value) return '—'
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function BacktestHelp() {
  return (
    <details className="card opt-backtest-help">
      <summary>
        <span className="opt-backtest-help-icon" aria-hidden="true">?</span>
        <span><strong>How this backtest works</strong><small>Methodology, accuracy, and educational-use limitations</small></span>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="opt-backtest-help-content">
        <div className="opt-backtest-help-callout">
          <strong>Educational modeling—not an execution-grade trading simulator</strong>
          <p>Use these results to learn how a strategy behaves, compare structures under consistent assumptions, and explore sensitivity. Do not treat the ending value, CAGR, drawdown, premium, or winning rate as a forecast or recommendation.</p>
        </div>

        <section>
          <span className="opt-backtest-help-kicker">Replay method</span>
          <h3>Exactly what happens in each test</h3>
          <ol className="opt-backtest-help-steps">
            <li><strong>Prepare daily market history.</strong><span>The test uses daily unadjusted underlying prices and dividends, a trailing volatility estimate, VIX or VXN for the volatility regime, and the 13-week Treasury-bill yield for cash interest. Volatility inputs use only information available on or before each test date.</span></li>
            <li><strong>Open the strategy.</strong><span>The first cycle begins on the first eligible trading day. Contracts are sized from the selected capital allocation and the structure's fully funded stock, cash-secured, debit, or maximum-loss requirement.</span></li>
            <li><strong>Choose one shared expiration.</strong><span>The requested calendar DTE is mapped to the nearest trading date contained in the underlying history. Every option leg receives that same expiration. The next cycle starts on the following trading day.</span></li>
            <li><strong>Select each strike.</strong><span>Delta rules choose the nearest strike on a modeled listed-style grid. Spot-offset rules roll the saved percentage distance from the underlying. Fixed rules reuse the entered strike. Historical contract listings are not available, so actual strike and expiration availability cannot be confirmed.</span></li>
            <li><strong>Model premiums and fills.</strong><span>Each leg is priced with Black–Scholes or Bjerksund–Stensland using the modeled volatility, rate, and trailing dividend yield. Bought legs pay above theoretical value and sold legs receive below theoretical value according to the slippage setting; commissions are then deducted.</span></li>
            <li><strong>Mark the portfolio daily.</strong><span>Stock, cash, dividends, cash interest, and every option leg are valued on each trading day. Options use the remaining calendar time and that day's trailing volatility estimate.</span></li>
            <li><strong>Hold through expiration.</strong><span>Options settle at intrinsic value. Covered stock can be called away and protective puts can be exercised. Other option structures are economically cash-settled, then rolled. Early exits, adjustments, early exercise, taxes, borrowing costs, and broker-specific fees are excluded.</span></li>
            <li><strong>Calculate results.</strong><span>The tool reports the equity curve, CAGR, maximum drawdown, Sharpe and Sortino ratios, option P/L, premiums, costs, assignments, and cycle-level audit records against dividend-reinvested buy and hold.</span></li>
          </ol>
        </section>

        <section>
          <span className="opt-backtest-help-kicker">Strategy handling</span>
          <h3>Templates and saved examples</h3>
          <div className="opt-backtest-help-grid">
            <div><strong>Stock-backed</strong><p>Covered calls, protective puts, and collars hold the required shares. Cash-secured puts reserve assignment capital at the put strike.</p></div>
            <div><strong>Defined-risk and long options</strong><p>Vertical spreads, straddles, strangles, and iron condors are sized from modeled maximum loss or total debit. The capital-allocation control limits how much equity is deployed per cycle.</p></div>
            <div><strong>Saved strategies</strong><p>Included calls and puts, buy/sell sides, and leg quantities are preserved. Saved strikes become rolling percentage offsets from the current underlying so the original shape can be replayed through history.</p></div>
            <div><strong>Unsupported structures</strong><p>Calendars and diagonals are rejected because all legs must share one expiration. Saved positions with uncovered upside risk are also rejected because they cannot be fully funded.</p></div>
          </div>
        </section>

        <section>
          <span className="opt-backtest-help-kicker">Accuracy</span>
          <h3>How much confidence to place in the output</h3>
          <p className="opt-backtest-help-intro">These are approximate judgment ranges, not measured confidence intervals. The current tool has not yet been calibrated against a historical option-chain database.</p>
          <div className="opt-backtest-accuracy-table" role="table" aria-label="Approximate backtest confidence">
            <div role="row"><span role="cell">Underlying buy-and-hold benchmark</span><strong role="cell">High · roughly 8–9/10</strong><small role="cell">Daily prices and dividends are observed.</small></div>
            <div role="row"><span role="cell">Portfolio accounting and expiration payoff</span><strong role="cell">Moderately high · roughly 7–8/10</strong><small role="cell">Mechanics are tested, but real assignment timing and early exercise are simplified.</small></div>
            <div role="row"><span role="cell">Simple liquid covered calls or cash-secured puts</span><strong role="cell">Moderate · roughly 5–6/10</strong><small role="cell">Direction can be informative; exact premium and return are modeled.</small></div>
            <div role="row"><span role="cell">Verticals, condors, and other multi-leg structures</span><strong role="cell">Low to moderate · roughly 3–5/10</strong><small role="cell">Small pricing errors across several legs can materially change net premium and P/L.</small></div>
          </div>
          <div className="opt-backtest-accuracy-bands">
            <div><strong>Planning-only error bands</strong><p>Until validated with actual historical quotes, allow roughly ±3–6 percentage points of annualized-return error for simple liquid SPY strategies and ±5–10 points or more for skew-sensitive multi-leg structures. Drawdown can differ by roughly 5–15 percentage points.</p></div>
            <div><strong>Why multi-leg accuracy is lower</strong><p>All legs currently share one modeled volatility for a date. Real markets have a volatility smile or skew by strike and maturity. A spread or condor subtracts several option prices, so the net debit or credit can have a much larger percentage error than any single leg.</p></div>
            <div><strong>Scenario tabs are not confidence intervals</strong><p>Lower-IV, Base, and Higher-IV vary volatility and fills to show sensitivity. They do not cover every source of model error and should not be read as the full range of possible real-world results.</p></div>
          </div>
        </section>

        <section className="opt-backtest-help-upgrade">
          <strong>What would make it execution-grade?</strong>
          <p>Historical option chains with actual listed strikes and expirations, timestamped bid/ask quotes, volume and open interest, strike-specific implied-volatility surfaces, exact settlement data, and a documented fill rule. Results would then be validated against observed entry credits, cycle P/L, and established option benchmarks.</p>
        </section>
      </div>
    </details>
  )
}

export default function OptionBacktest({ ticker, spot = 0, savedStrategies = [], onTickerChange }) {
  const [strategyId, setStrategyId] = useState('covered_call')
  const [selectedSaved, setSelectedSaved] = useState(null)
  const [savedReferenceReady, setSavedReferenceReady] = useState(false)
  const [start, setStart] = useState(() => yearsAgoISO(5))
  const [end, setEnd] = useState(todayISO)
  const [initialCapital, setInitialCapital] = useState(100000)
  const [capitalAllocationPct, setCapitalAllocationPct] = useState(100)
  const [targetDte, setTargetDte] = useState(30)
  const [legRules, setLegRules] = useState(() => cloneLegRules(STRATEGIES.covered_call))
  const [pricingModel, setPricingModel] = useState('bjerksund-stensland')
  const [commission, setCommission] = useState(0.65)
  const [slippagePct, setSlippagePct] = useState(5)
  const [volatilityIndex, setVolatilityIndex] = useState('auto')
  const [result, setResult] = useState(null)
  const [scenarioId, setScenarioId] = useState('base')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const strategy = selectedSaved ? {
    label: selectedSaved.name,
    description: `Saved ${selectedSaved.underlying} example · ${legRules.length} option legs${savedStockUnits(selectedSaved) ? ' plus stock' : ''}.`,
    capital: savedStockUnits(selectedSaved) ? 'Saved stock coverage and option ratios are preserved.' : 'The saved structure is fully funded to modeled maximum loss.',
    legs: legRules,
  } : STRATEGIES[strategyId]

  useEffect(() => {
    setResult(null)
    setError('')
  }, [ticker])

  useEffect(() => {
    if (!selectedSaved || savedReferenceReady || ticker !== selectedSaved.underlying || Number(spot) <= 0) return
    setLegRules(rulesFromSaved(selectedSaved, Number(spot)))
    setSavedReferenceReady(true)
  }, [savedReferenceReady, selectedSaved, spot, ticker])

  const changeStrategy = nextId => {
    if (nextId.startsWith('saved:')) {
      const saved = savedStrategies.find(item => `saved:${item.id}` === nextId)
      if (!saved) return
      const options = savedOptionLegs(saved)
      const expirations = [...new Set(options.map(leg => leg.expiration).filter(Boolean))]
      if (!options.length) {
        setError(`${saved.name} has no included option legs to backtest.`)
        return
      }
      if (expirations.length !== 1) {
        setError(`${saved.name} uses multiple expirations. Calendars and diagonals are not supported in the same-expiration backtester.`)
        return
      }
      const referenceSpot = saved.underlying === ticker && Number(spot) > 0 ? Number(spot) : 0
      setSelectedSaved(saved)
      setSavedReferenceReady(referenceSpot > 0)
      setStrategyId(nextId)
      setLegRules(rulesFromSaved(saved, referenceSpot))
      setCapitalAllocationPct(savedStockUnits(saved) ? 100 : 10)
      if (saved.model === 'black-scholes' || saved.model === 'bjerksund-stensland') setPricingModel(saved.model)
      const expiration = new Date(`${expirations[0]}T00:00:00`)
      const remainingDte = Math.ceil((expiration.getTime() - Date.now()) / 86400000)
      if (Number.isFinite(remainingDte) && remainingDte > 0) setTargetDte(remainingDte)
      if (saved.underlying && saved.underlying !== ticker) onTickerChange?.(saved.underlying)
      setResult(null)
      setError('')
      return
    }
    setSelectedSaved(null)
    setSavedReferenceReady(false)
    setStrategyId(nextId)
    setLegRules(cloneLegRules(STRATEGIES[nextId]))
    setCapitalAllocationPct(['bull_call_spread', 'bear_put_spread', 'bull_put_spread', 'bear_call_spread', 'long_straddle', 'long_strangle', 'iron_condor'].includes(nextId) ? 10 : 100)
    setResult(null)
    setError('')
  }

  const updateLegRule = (index, field, value) => {
    setLegRules(current => current.map((leg, legIndex) => {
      if (legIndex !== index) return leg
      if (field !== 'method') return { ...leg, [field]: value }
      const nextValue = value === 'delta' ? 30 : value === 'moneyness' ? (leg.type === 'Call' ? 5 : -5) : 100
      return { ...leg, method: value, value: nextValue }
    }))
  }

  const scenario = result?.scenarios?.[scenarioId] || null
  const benchmark = result?.benchmark || null
  const benchmarkDelta = scenario?.metrics?.ending_value != null && benchmark?.metrics?.ending_value != null
    ? Number(scenario.metrics.ending_value) - Number(benchmark.metrics.ending_value)
    : null

  const chartData = useMemo(() => {
    if (!scenario?.curve?.dates?.length || !benchmark?.curve?.dates?.length) return []
    return [
      {
        x: scenario.curve.dates,
        y: scenario.curve.values,
        name: `${scenario.label} ${result.strategy_label}`,
        type: 'scatter',
        mode: 'lines',
        line: { width: 2.6 },
        hovertemplate: '%{x}<br>Strategy: $%{y:,.0f}<extra></extra>',
      },
      {
        x: benchmark.curve.dates,
        y: benchmark.curve.values,
        name: `${result.ticker} buy and hold`,
        type: 'scatter',
        mode: 'lines',
        line: { width: 2 },
        hovertemplate: '%{x}<br>Buy and hold: $%{y:,.0f}<extra></extra>',
      },
    ]
  }, [benchmark, result, scenario])

  const chartLayout = useMemo(() => ({
    autosize: true,
    height: 390,
    margin: { l: 72, r: 28, t: 22, b: 52 },
    hovermode: 'x unified',
    legend: { orientation: 'h', x: 0, y: 1.12 },
    xaxis: { title: { text: 'Date' }, type: 'date' },
    yaxis: { title: { text: 'Portfolio value' }, tickprefix: '$', tickformat: ',.0f' },
  }), [])

  const runBacktest = async event => {
    event?.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/options/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          strategy: selectedSaved ? 'custom_same_expiration' : strategyId,
          ...(selectedSaved ? {
            custom_strategy: {
              name: selectedSaved.name,
              stock_units: savedStockUnits(selectedSaved),
              legs: legRules.map(leg => ({
                name: leg.name,
                side: leg.side.toLowerCase(),
                option_type: leg.type.toLowerCase(),
                quantity: Number(leg.quantity) || 1,
              })),
            },
          } : {}),
          start,
          end,
          initial_capital: Number(initialCapital),
          capital_allocation_pct: Number(capitalAllocationPct) / 100,
          target_dte: Number(targetDte),
          target_delta: 0.30,
          wing_delta: 0.15,
          leg_rules: legRules.map(leg => ({
            method: leg.method,
            value: leg.method === 'delta' ? Number(leg.value) / 100 : Number(leg.value),
          })),
          pricing_model: pricingModel,
          commission_per_contract: Number(commission),
          slippage_pct: Number(slippagePct) / 100,
          minimum_slippage: 0.02,
          volatility_index: volatilityIndex,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error || `Backtest failed (${response.status})`)
      setResult(data)
      setScenarioId('base')
    } catch (requestError) {
      setResult(null)
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="opt-backtest-workspace">
      <form className="card opt-backtest-setup" onSubmit={runBacktest}>
        <div className="opt-section-heading">
          <div>
            <span>Modeled historical replay</span>
            <h2>{ticker} {strategy.label.toLowerCase()} backtest</h2>
          </div>
          <div className="opt-backtest-policy"><strong>Same expiration · any DTE</strong><span>Historical option quotes are not used</span></div>
        </div>

        <div className="opt-backtest-input-grid">
          <label><span>Strategy</span><select value={strategyId} onChange={event => changeStrategy(event.target.value)}>
            {!!savedStrategies.length && <optgroup label="Saved examples">{savedStrategies.map(saved => <option key={saved.id} value={`saved:${saved.id}`}>{saved.name} · {saved.underlying}</option>)}</optgroup>}
            <optgroup label="Income and protection"><option value="covered_call">Covered call</option><option value="cash_secured_put">Cash-secured put</option><option value="protective_put">Protective put</option><option value="collar">Collar</option></optgroup>
            <optgroup label="Vertical spreads"><option value="bull_call_spread">Bull call spread</option><option value="bear_put_spread">Bear put spread</option><option value="bull_put_spread">Bull put spread</option><option value="bear_call_spread">Bear call spread</option></optgroup>
            <optgroup label="Volatility and multi-leg"><option value="long_straddle">Long straddle</option><option value="long_strangle">Long strangle</option><option value="iron_condor">Iron condor</option></optgroup>
          </select></label>
          <label><span>Start date</span><input type="date" value={start} max={end} onChange={event => setStart(event.target.value)} /></label>
          <label><span>End date</span><input type="date" value={end} min={start} max={todayISO()} onChange={event => setEnd(event.target.value)} /></label>
          <label><span>Initial capital</span><input type="number" min="1000" step="1000" value={initialCapital} onChange={event => setInitialCapital(event.target.value)} /></label>
          <label><span>Capital allocation</span><div className="opt-suffix-input"><input type="number" min="1" max="100" step="1" value={capitalAllocationPct} onChange={event => setCapitalAllocationPct(event.target.value)} /><b>%</b></div></label>
          <label><span>Target DTE</span><input type="number" min="1" step="1" value={targetDte} onChange={event => setTargetDte(event.target.value)} /></label>
          <label><span>Pricing model</span><select value={pricingModel} onChange={event => setPricingModel(event.target.value)}><option value="bjerksund-stensland">Bjerksund–Stensland</option><option value="black-scholes">Black–Scholes</option></select></label>
          <label><span>Volatility index</span><select value={volatilityIndex} onChange={event => setVolatilityIndex(event.target.value)}><option value="auto">Auto · VIX or VXN</option><option value="vix">VIX</option><option value="vxn">VXN</option></select></label>
          <label><span>Commission / contract</span><div className="opt-prefix-input"><b>$</b><input type="number" min="0" step="0.05" value={commission} onChange={event => setCommission(event.target.value)} /></div></label>
          <label><span>Modeled slippage</span><div className="opt-suffix-input"><input type="number" min="0" max="25" step="0.5" value={slippagePct} onChange={event => setSlippagePct(event.target.value)} /><b>%</b></div></label>
        </div>

        <div className="opt-backtest-leg-builder">
          <div className="opt-backtest-leg-heading">
            <div><strong>Same-expiration legs</strong><span>{strategy.description}</span></div>
            <small>Every cycle maps the requested DTE to the nearest available trading date.</small>
          </div>
          <div className="opt-backtest-leg-rules">
            {legRules.map((leg, index) => (
              <div className="opt-backtest-leg-rule" key={`${strategyId}-${leg.name}-${index}`}>
                <div><span className={leg.side === 'Buy' ? 'buy' : 'sell'}>{leg.side}</span><strong>{leg.quantity > 1 ? `${leg.quantity}× ` : ''}{leg.type}</strong><small>{leg.name}{leg.sourceStrike ? ` · saved ${money(leg.sourceStrike)}` : ''}</small></div>
                <label><span>Strike rule</span><select value={leg.method} onChange={event => updateLegRule(index, 'method', event.target.value)}><option value="delta">Target delta</option><option value="moneyness">% from spot</option><option value="fixed">Fixed strike</option></select></label>
                <label><span>{leg.method === 'delta' ? 'Absolute delta' : leg.method === 'moneyness' ? 'Spot offset' : 'Strike'}</span><div className={leg.method === 'fixed' ? 'opt-prefix-input' : 'opt-suffix-input'}>{leg.method === 'fixed' && <b>$</b>}<input type="number" min={leg.method === 'delta' ? 1 : leg.method === 'fixed' ? 0.01 : -98} max={leg.method === 'delta' ? 99 : leg.method === 'moneyness' ? 500 : undefined} step={leg.method === 'fixed' ? 0.5 : leg.method === 'moneyness' ? 0.01 : 1} value={leg.value} onChange={event => updateLegRule(index, 'value', event.target.value)} />{leg.method !== 'fixed' && <b>%</b>}</div></label>
              </div>
            ))}
          </div>
          <p>{selectedSaved ? 'Saved strikes are converted to offsets from the current underlying so the asymmetric structure rolls through history; quantities are preserved.' : 'Delta and spot-offset rules roll with the underlying. A fixed strike stays fixed across cycles.'} All strikes are rounded to a modeled listed-style grid; historical chain availability cannot be verified with the current data.</p>
        </div>

        <div className="opt-backtest-run-row">
          <p>{strategy.capital} Contracts resize from account equity each cycle. Dividends on stock-backed strategies and available-cash interest are included.</p>
          <button type="submit" className="btn btn-primary" disabled={loading || !ticker}>{loading ? 'Running modeled backtest…' : `Run ${ticker} backtest`}</button>
        </div>
        {error && <div className="opt-error">{error}</div>}
      </form>

      <BacktestHelp />

      {!result && !loading && !error && (
        <div className="card opt-backtest-empty">
          <strong>Configure the historical test, then run it.</strong>
          <span>The result will compare the continuously rolled same-expiration strategy with dividend-reinvested buy and hold.</span>
        </div>
      )}

      {result && scenario && (
        <div className="opt-backtest-results">
          <div className="opt-backtest-result-heading">
            <div>
              <span>Completed same-expiration cycles · {shortDate(result.effective_start)} to {shortDate(result.effective_end)}</span>
              <h2>{result.ticker} {result.strategy_label.toLowerCase()} versus buy and hold</h2>
            </div>
            <div className="opt-backtest-scenarios" role="tablist" aria-label="Backtest sensitivity scenario">
              {Object.entries(result.scenarios).map(([id, item]) => (
                <button key={id} type="button" role="tab" aria-selected={scenarioId === id} className={scenarioId === id ? 'active' : ''} onClick={() => setScenarioId(id)}>
                  <strong>{item.label}</strong><span>{id === 'base' ? 'Central estimate' : item.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="opt-backtest-metrics">
            <div className="summary-card"><span className="summary-label">Ending value</span><span className="summary-value">{money(scenario.metrics.ending_value)}</span><span className={benchmarkDelta >= 0 ? 'opt-positive' : 'opt-negative'}>{moneySigned(benchmarkDelta)} vs buy and hold</span></div>
            <div className="summary-card"><span className="summary-label">Annualized return</span><span className="summary-value">{pct(scenario.metrics.cagr)}</span><span>Buy and hold {pct(benchmark.metrics.cagr)}</span></div>
            <div className="summary-card"><span className="summary-label">Maximum drawdown</span><span className="summary-value">{pct(scenario.metrics.max_drawdown)}</span><span>Buy and hold {pct(benchmark.metrics.max_drawdown)}</span></div>
            <div className="summary-card"><span className="summary-label">Risk-adjusted return</span><span className="summary-value">{number(scenario.metrics.sharpe)}</span><span>Sharpe · Sortino {number(scenario.metrics.sortino)}</span></div>
          </div>

          <section className="card opt-backtest-chart-card">
            <div className="opt-section-heading">
              <div><span>Equity curve</span><h2>Strategy value through completed cycles</h2></div>
              <small>{scenario.description}</small>
            </div>
            <div className="opt-backtest-chart" role="img" aria-label={`${scenario.label} ${result.strategy_label} equity curve compared with ${result.ticker} buy and hold`}>
              <ThemedPlot data={chartData} layout={chartLayout} style={{ width: '100%', height: '390px' }} config={{ responsive: true, displaylogo: false }} useResizeHandler themeSurface />
            </div>
          </section>

          <div className="opt-backtest-summary-strip">
            <span><strong>{scenario.summary.cycle_count}</strong> cycles · {number(scenario.summary.average_dte, 1)} actual avg DTE</span>
            {scenario.summary.gross_premium > 0 && <span><strong>{money(scenario.summary.gross_premium)}</strong> short premium</span>}
            {scenario.summary.premium_paid > 0 && <span><strong>{money(scenario.summary.premium_paid)}</strong> long premium</span>}
            <span><strong className={scenario.summary.net_entry_premium >= 0 ? 'opt-positive' : 'opt-negative'}>{moneySigned(scenario.summary.net_entry_premium)}</strong> net entry premium</span>
            <span><strong className={scenario.summary.net_option_pnl >= 0 ? 'opt-positive' : 'opt-negative'}>{moneySigned(scenario.summary.net_option_pnl)}</strong> net option P/L</span>
            <span><strong>{pct(scenario.summary.assignment_rate)}</strong> short-leg ITM cycles</span>
            <span><strong>{money(scenario.summary.estimated_costs)}</strong> estimated costs</span>
            <span><strong>{money(scenario.summary.dividends_received)}</strong> dividends</span>
          </div>

          <section className="card opt-backtest-ledger-card">
            <div className="opt-section-heading">
              <div><span>Audit trail</span><h2>Recent same-expiration cycles</h2></div>
              <small>Every leg's strike, delta, fill, and expiration outcome is retained.</small>
            </div>
            <div className="opt-table-wrap">
              <table className="opt-backtest-ledger">
                <thead><tr><th>Entry</th><th>Expiration</th><th>DTE</th><th>Contracts</th><th>Entry spot</th><th>Option legs</th><th>Modeled IV</th><th>Net premium</th><th>Expiration spot</th><th>Outcome</th><th>Option P/L</th><th>Cycle P/L</th></tr></thead>
                <tbody>
                  {[...scenario.cycles].reverse().slice(0, 12).map(cycle => (
                    <tr key={`${cycle.entry_date}-${cycle.expiration_date}`}>
                      <td>{shortDate(cycle.entry_date)}</td><td>{shortDate(cycle.expiration_date)}</td><td>{cycle.dte}</td><td>{cycle.contracts}</td>
                      <td>{money(cycle.entry_spot)}</td>
                      <td><div className="opt-backtest-cycle-legs">{cycle.legs.map((leg, index) => <span key={`${leg.name}-${leg.strike}-${index}`}><b className={leg.side === 'buy' ? 'buy' : 'sell'}>{leg.side}</b> {leg.quantity > 1 ? `${leg.quantity}× ` : ''}{leg.strike} {leg.option_type === 'call' ? 'C' : 'P'} <small>Δ {number(Math.abs(leg.modeled_delta), 2)} · {optionMoney(leg.fill_price)}</small></span>)}</div></td>
                      <td>{pct(cycle.modeled_iv)}</td><td className={cycle.net_entry_premium >= 0 ? 'opt-positive' : 'opt-negative'}>{moneySigned(cycle.net_entry_premium)}</td><td>{money(cycle.expiration_spot)}</td>
                      <td><span className={cycle.assigned ? 'opt-backtest-assigned' : cycle.exercised ? 'opt-backtest-exercised' : 'opt-backtest-expired'}>{cycle.outcome}</span></td>
                      <td className={cycle.option_pnl >= 0 ? 'opt-positive' : 'opt-negative'}>{moneySigned(cycle.option_pnl)}</td>
                      <td className={cycle.cycle_pnl >= 0 ? 'opt-positive' : 'opt-negative'}>{moneySigned(cycle.cycle_pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="card opt-backtest-assumptions">
            <summary>Model assumptions and limitations</summary>
            <div>
              <p><strong>Volatility:</strong> {result.assumptions.volatility_model} using {result.assumptions.volatility_index}.</p>
              <p><strong>Expiration:</strong> requested {result.assumptions.target_dte} DTE; actual cycles used {result.assumptions.actual_dte_min}–{result.assumptions.actual_dte_max} calendar days, with every option leg on the same date.</p>
              <p><strong>Strikes:</strong> {result.assumptions.strike_selection}.</p>
              <p><strong>Capital:</strong> {result.assumptions.capitalization}.</p>
              <ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
            </div>
          </details>
        </div>
      )}
    </section>
  )
}
