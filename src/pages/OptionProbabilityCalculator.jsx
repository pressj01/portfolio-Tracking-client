import { useMemo, useState } from 'react'
import { API_BASE } from '../config'
import { calculateOptionProbability } from '../utils/optionProbability'

const DAY_MS = 86400000

function localToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function formatIsoDate(date) {
  const local = new Date(date)
  if (Number.isNaN(local.getTime())) return 'Select a future date'
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset())
  return local.toISOString().slice(0, 10)
}

function addDays(days) {
  const date = localToday()
  date.setDate(date.getDate() + Number(days))
  return formatIsoDate(date)
}

function calendarDaysUntil(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return Math.round((date - localToday()) / DAY_MS)
}

function currency(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function percent(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}

function signedPercent(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '—'
  return `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(digits)}%`
}

function integer(value) {
  if (!Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function deviationLabel(deviation) {
  if (deviation === 0) return 'Spot'
  return `${deviation > 0 ? '+' : '−'}${Math.abs(deviation)}σ`
}

function contractMid(contract) {
  const bid = Number(contract?.bid)
  const ask = Number(contract?.ask)
  if (bid > 0 && ask > 0) return (bid + ask) / 2
  return Number(contract?.last) || null
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`)
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Market data request failed (${response.status})`)
  }
  return payload
}

function _ProbabilityCard({ className, label, value, detail }) {
  return (
    <article className={`opc-probability-card ${className}`}>
      <span>{label}</span>
      <strong>{percent(value)}</strong>
      <small>{detail}</small>
    </article>
  )
}

export default function OptionProbabilityCalculator() {
  const [currentPrice, setCurrentPrice] = useState(100)
  const [futureDate, setFutureDate] = useState(() => addDays(45))
  const [daysAhead, setDaysAhead] = useState(45)
  const [volatilityPct, setVolatilityPct] = useState(25)
  const [firstTarget, setFirstTarget] = useState(90)
  const [secondTarget, setSecondTarget] = useState(110)

  const [tickerInput, setTickerInput] = useState('SPY')
  const [marketTicker, setMarketTicker] = useState('')
  const [expirations, setExpirations] = useState([])
  const [selectedExpiration, setSelectedExpiration] = useState('')
  const [optionType, setOptionType] = useState('calls')
  const [selectedStrike, setSelectedStrike] = useState('')
  const [chain, setChain] = useState(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [lookupMessage, setLookupMessage] = useState('')

  const result = useMemo(() => calculateOptionProbability({
    currentPrice,
    daysAhead,
    volatilityPct,
    firstTarget,
    secondTarget,
  }), [currentPrice, daysAhead, volatilityPct, firstTarget, secondTarget])

  const contracts = useMemo(() => {
    const rows = chain?.[optionType]
    return Array.isArray(rows) ? rows.filter(item => Number(item.strike) > 0) : []
  }, [chain, optionType])

  const selectedContract = useMemo(
    () => contracts.find(item => String(item.strike) === String(selectedStrike)) || null,
    [contracts, selectedStrike],
  )
  const selectedContractMid = useMemo(() => contractMid(selectedContract), [selectedContract])
  const oneContractPremium = selectedContractMid > 0 ? selectedContractMid * 100 : null

  const pickNearestStrike = (rows, preferred) => {
    if (!rows.length) return ''
    const target = Number(preferred)
    const nearest = rows.reduce((best, item) => (
      Math.abs(Number(item.strike) - target) < Math.abs(Number(best.strike) - target) ? item : best
    ), rows[0])
    return String(nearest.strike)
  }

  const pickNearestExpiration = (available, preferred) => {
    if (!available.length) return ''
    const target = new Date(`${preferred}T00:00:00`).getTime()
    if (!Number.isFinite(target)) return available[0]
    return available.reduce((best, expiration) => {
      const distance = Math.abs(new Date(`${expiration}T00:00:00`).getTime() - target)
      const bestDistance = Math.abs(new Date(`${best}T00:00:00`).getTime() - target)
      return distance < bestDistance ? expiration : best
    }, available[0])
  }

  const loadChain = async (symbol, expiration, preferredStrike) => {
    const chainData = await fetchJson(`/api/options/chain?ticker=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}`)
    setChain(chainData)
    const rows = Array.isArray(chainData?.[optionType]) ? chainData[optionType] : []
    setSelectedStrike(pickNearestStrike(rows, preferredStrike || chainData.spot))
    return chainData
  }

  const findContracts = async event => {
    event.preventDefault()
    const symbol = tickerInput.trim().toUpperCase()
    if (!symbol) {
      setLookupError('Enter an underlying symbol first.')
      return
    }
    setLookupLoading(true)
    setLookupError('')
    setLookupMessage('')
    try {
      const expirationData = await fetchJson(`/api/options/expirations?ticker=${encodeURIComponent(symbol)}`)
      const available = Array.isArray(expirationData.expirations) ? expirationData.expirations : []
      if (!available.length) throw new Error(`Yahoo did not return option expirations for ${symbol}.`)
      const expiration = pickNearestExpiration(available, futureDate)
      setMarketTicker(symbol)
      setExpirations(available)
      setSelectedExpiration(expiration)
      const chainData = await loadChain(symbol, expiration, null)
      setLookupMessage(`Loaded ${symbol} contracts from Yahoo. Spot is ${currency(chainData.spot)}.`)
    } catch (error) {
      setChain(null)
      setExpirations([])
      setSelectedExpiration('')
      setSelectedStrike('')
      setLookupError(`${error.message} You can still enter volatility manually below.`)
    } finally {
      setLookupLoading(false)
    }
  }

  const changeExpiration = async event => {
    const expiration = event.target.value
    setSelectedExpiration(expiration)
    setLookupLoading(true)
    setLookupError('')
    setLookupMessage('')
    try {
      const chainData = await loadChain(marketTicker, expiration, selectedStrike || firstTarget)
      setLookupMessage(`Loaded ${marketTicker} ${expiration} contracts. Spot is ${currency(chainData.spot)}.`)
    } catch (error) {
      setChain(null)
      setSelectedStrike('')
      setLookupError(`${error.message} You can still enter volatility manually below.`)
    } finally {
      setLookupLoading(false)
    }
  }

  const changeOptionType = event => {
    const type = event.target.value
    setOptionType(type)
    const rows = Array.isArray(chain?.[type]) ? chain[type] : []
    setSelectedStrike(pickNearestStrike(rows, selectedStrike || chain?.spot))
    setLookupMessage('')
  }

  const applyYahooContract = () => {
    if (!chain || !selectedContract) return
    const spot = Number(chain.spot)
    const strike = Number(selectedContract.strike)
    const iv = Number(selectedContract.iv)
    const days = calendarDaysUntil(selectedExpiration)
    if (spot > 0) setCurrentPrice(Number(spot.toFixed(4)))
    if (strike > 0) {
      setFirstTarget(strike)
      setSecondTarget(strike)
    }
    if (days > 0) {
      setFutureDate(selectedExpiration)
      setDaysAhead(days)
    }
    if (iv > 0) {
      setVolatilityPct(Number((iv * 100).toFixed(2)))
      setLookupMessage(`Applied Yahoo spot, ${optionType === 'calls' ? 'call' : 'put'} strike, expiration, and ${percent(iv * 100)} implied volatility.`)
    } else {
      setLookupMessage('Applied Yahoo spot, strike, and expiration. Yahoo did not provide IV for this contract, so enter volatility manually.')
    }
  }

  const changeDate = event => {
    const value = event.target.value
    setFutureDate(value)
    const days = calendarDaysUntil(value)
    if (days != null && days > 0) setDaysAhead(days)
  }

  const changeDays = event => {
    const value = event.target.value
    setDaysAhead(value)
    const days = Number(value)
    if (Number.isFinite(days) && days > 0) setFutureDate(addDays(Math.round(days)))
  }

  const invalidDate = Number(daysAhead) <= 0
  const invalidInputs = !result
  const ivAvailable = Number(selectedContract?.iv) > 0

  return (
    <div className="page opc-page">
      <header className="opc-header">
        <div>
          <span className="opc-eyebrow">Options · Probability planning</span>
          <h1>Option Probability Calculator</h1>
          <p>Estimate the price range and probability of finishing below, between, or above two target prices. Pull a contract’s implied volatility from Yahoo or type your own forecast.</p>
        </div>
        <div className="opc-header-stats">
          {Number(chain?.spot) > 0 && (
            <div className="opc-current-price-bubble" role="status">
              <span>Current {marketTicker} price</span>
              <strong>{currency(chain.spot)}</strong>
              <small>Yahoo market data</small>
            </div>
          )}
          <div className="opc-header-badge">
            <strong>Calendar-day model</strong>
            <span>Zero-drift lognormal estimate</span>
          </div>
        </div>
      </header>

      <section className="card opc-yahoo-card">
        <div className="opc-section-heading">
          <div><span>Optional market lookup</span><h2>Use a strike’s Yahoo implied volatility</h2></div>
          <p>IV belongs to a specific call or put, strike, and expiration. Select the exact contract you want to use.</p>
        </div>
        <form className="opc-lookup-form" onSubmit={findContracts}>
          <label className="opc-symbol-field">
            <span>Underlying</span>
            <input value={tickerInput} onChange={event => setTickerInput(event.target.value.toUpperCase())} aria-label="Yahoo lookup underlying" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={lookupLoading}>{lookupLoading ? 'Loading…' : 'Find contracts'}</button>
          <label>
            <span>Expiration</span>
            <select value={selectedExpiration} onChange={changeExpiration} disabled={!expirations.length || lookupLoading}>
              <option value="">Load a symbol first</option>
              {expirations.map(expiration => <option key={expiration} value={expiration}>{expiration}</option>)}
            </select>
          </label>
          <label>
            <span>Option type</span>
            <select value={optionType} onChange={changeOptionType} disabled={!chain || lookupLoading}>
              <option value="calls">Call</option>
              <option value="puts">Put</option>
            </select>
          </label>
          <label>
            <span>Strike</span>
            <select value={selectedStrike} onChange={event => { setSelectedStrike(event.target.value); setLookupMessage('') }} disabled={!contracts.length || lookupLoading}>
              <option value="">Select strike</option>
              {contracts.map(contract => <option key={contract.strike} value={contract.strike}>{currency(contract.strike)}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-secondary opc-apply-button" onClick={applyYahooContract} disabled={!selectedContract || lookupLoading}>Apply to calculator</button>
        </form>
        {selectedContract && <>
          <div className="opc-contract-strip">
            <div><span>Contract</span><strong>{marketTicker} {selectedExpiration} {currency(selectedContract.strike)} {optionType === 'calls' ? 'Call' : 'Put'}</strong></div>
            <div><span>Implied volatility</span><strong className={ivAvailable ? 'positive' : 'warning'}>{ivAvailable ? percent(Number(selectedContract.iv) * 100) : 'Not available'}</strong></div>
            <div><span>Bid / Ask</span><strong>{currency(selectedContract.bid)} / {currency(selectedContract.ask)}</strong></div>
            <div><span>Mid / Last</span><strong>{currency(selectedContractMid)} / {currency(selectedContract.last)}</strong></div>
            <div><span>Volume / Open interest</span><strong>{integer(selectedContract.volume)} / {integer(selectedContract.open_interest)}</strong></div>
          </div>
          <div className="opc-premium-grid" aria-label="Estimated premium at the contract mid price">
            <article className="sell">
              <div><span>Sell one contract at mid</span><small>Estimated gross premium received</small></div>
              <strong>{oneContractPremium == null ? 'Not available' : `+${currency(oneContractPremium)}`}</strong>
            </article>
            <article className="buy">
              <div><span>Buy one contract at mid</span><small>Estimated gross premium paid</small></div>
              <strong>{oneContractPremium == null ? 'Not available' : `−${currency(oneContractPremium)}`}</strong>
            </article>
            <p>{selectedContractMid == null
              ? 'Yahoo did not provide enough bid/ask or last-price data to estimate the mid premium.'
              : `${currency(selectedContractMid)} mid price × 100 shares per standard contract. Excludes commissions, fees, slippage, and price changes; a mid-price fill is not guaranteed.`}</p>
          </div>
        </>}
        {lookupError && <div className="opc-message error" role="alert">{lookupError}</div>}
        {lookupMessage && <div className="opc-message success" role="status">{lookupMessage}</div>}
      </section>

      <section className="card opc-calculator-card">
        <div className="opc-section-heading">
          <div><span>Scenario inputs</span><h2>Define the future price window</h2></div>
          <p>Future date and calendar days stay synchronized. Volatility always remains editable, including after a Yahoo lookup.</p>
        </div>
        <div className="opc-input-grid">
          <label>
            <span>Current underlying price</span>
            <div className="opc-affix-input"><b>$</b><input type="number" min="0.01" step="0.01" value={currentPrice} onChange={event => setCurrentPrice(event.target.value)} /></div>
          </label>
          <label>
            <span>Future date</span>
            <input type="date" min={addDays(1)} value={futureDate} onChange={changeDate} />
          </label>
          <label>
            <span>Days ahead</span>
            <div className="opc-affix-input suffix"><input type="number" min="1" max="3650" step="1" value={daysAhead} onChange={changeDays} /><b>days</b></div>
          </label>
          <label>
            <span>Future volatility</span>
            <div className="opc-affix-input suffix"><input type="number" min="0.01" max="1000" step="0.1" value={volatilityPct} onChange={event => setVolatilityPct(event.target.value)} aria-describedby="opc-volatility-help" /><b>%</b></div>
            <small id="opc-volatility-help">Annualized IV or your own volatility estimate</small>
          </label>
          <label>
            <span>First target price</span>
            <div className="opc-affix-input"><b>$</b><input type="number" min="0.01" step="0.01" value={firstTarget} onChange={event => setFirstTarget(event.target.value)} /></div>
          </label>
          <label>
            <span>Second target price</span>
            <div className="opc-affix-input"><b>$</b><input type="number" min="0.01" step="0.01" value={secondTarget} onChange={event => setSecondTarget(event.target.value)} /></div>
          </label>
        </div>
        {(invalidDate || invalidInputs) && <div className="opc-validation">Enter positive values for price, days, volatility, and both targets to calculate probabilities.</div>}
      </section>

      {result && (
        <>
          <section className="opc-summary-grid" aria-label="Probability calculation summary">
            <article><span>Expected move · 1σ</span><strong>{currency(result.expectedMove)}</strong><small>{percent(result.horizonVolatility * 100)} of spot over {result.days} calendar days</small></article>
            <article><span>One-standard-deviation range</span><strong>{currency(result.standardDeviationPrices[2].price)} – {currency(result.standardDeviationPrices[4].price)}</strong><small>Linearized price range around today’s price</small></article>
            <article><span>Target window</span><strong>{currency(result.lowerTarget)} – {currency(result.upperTarget)}</strong><small>Targets are sorted automatically</small></article>
          </section>

          <section className="card opc-results-card">
            <div className="opc-section-heading">
              <div><span>Modeled range</span><h2>Price at each standard deviation</h2></div>
              <p>These levels use the same price-times-volatility expected-move convention as the reference calculator.</p>
            </div>
            <div className="opc-deviation-grid">
              {result.standardDeviationPrices.map(item => (
                <div key={item.deviation} className={item.deviation === 0 ? 'spot' : item.deviation < 0 ? 'downside' : 'upside'}>
                  <span>{deviationLabel(item.deviation)}</span>
                  <strong>{currency(item.price)}</strong>
                </div>
              ))}
            </div>

            <div className="opc-probability-heading">
              <div><span>Terminal probabilities</span><h2>Probability of finishing in each zone</h2></div>
              <strong>{formatIsoDate(new Date(`${futureDate}T00:00:00`))}</strong>
            </div>
            <div className="opc-probability-grid">
              <_ProbabilityCard className="below" label="Below lower target" value={result.probabilityBelowPct} detail={`Below ${currency(result.lowerTarget)}`} />
              <_ProbabilityCard className="between" label="Between both targets" value={result.probabilityBetweenPct} detail={`${currency(result.lowerTarget)} to ${currency(result.upperTarget)}`} />
              <_ProbabilityCard className="above" label="Above upper target" value={result.probabilityAbovePct} detail={`Above ${currency(result.upperTarget)}`} />
            </div>
            <div className="opc-probability-bar" aria-label="Probability distribution across target zones">
              <span className="below" style={{ width: `${result.probabilityBelowPct}%` }} />
              <span className="between" style={{ width: `${result.probabilityBetweenPct}%` }} />
              <span className="above" style={{ width: `${result.probabilityAbovePct}%` }} />
            </div>

            <div className="opc-return-heading">
              <div><span>Return scenarios</span><h2>Annualized return at each target</h2></div>
              <p>Simple annualized underlying return · excludes option premium and leverage</p>
            </div>
            <div className="opc-return-grid">
              {result.targetReturns.map(item => (
                <article key={item.index} className={item.horizonReturnPct >= 0 ? 'positive' : 'negative'}>
                  <span>{item.index === 0 ? 'First' : 'Second'} target · {currency(item.target)}</span>
                  <strong>{signedPercent(item.annualizedReturnPct)}</strong>
                  <small>{signedPercent(item.horizonReturnPct)} price return over {result.days} calendar days</small>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <footer className="opc-method-card card">
        <div>
          <span>How the estimate works</span>
          <p>Terminal probabilities use a zero-drift lognormal distribution with annualized volatility scaled by the square root of calendar time. Standard-deviation price levels use a linear expected move and are floored at $0. Target returns use simple annualization: price return × 365.25 ÷ calendar days.</p>
        </div>
        <div>
          <span>Important limitations</span>
          <p>Yahoo IV is a market-implied input for one contract, not a forecast or guarantee. The model does not include drift, dividends, volatility skew changes, jumps, early exercise, fees, or path-dependent “touch” probability.</p>
        </div>
        <strong>Educational analysis only · Market data may be delayed</strong>
      </footer>
    </div>
  )
}
