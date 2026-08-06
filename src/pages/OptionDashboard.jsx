import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'

const TIMEFRAMES = [
  { key: 'daily', label: 'Daily', hint: 'Tactical entries · days to weeks' },
  { key: 'weekly', label: 'Weekly', hint: 'Swing positioning · weeks to months' },
  { key: 'monthly', label: 'Monthly', hint: 'Primary regime · months and longer' },
]

const CATEGORY_ORDER = { Ideal: 0, Favorable: 1, Selective: 2, Avoid: 3 }

const finite = value => value != null && Number.isFinite(Number(value))
const number = (value, digits = 2) => finite(value) ? Number(value).toFixed(digits) : '—'
const signed = (value, digits = 0) => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(digits)}` : '—'
const percent = (value, digits = 1) => finite(value) ? `${Number(value).toFixed(digits)}%` : '—'
const money = value => finite(value) ? `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

function scoreTone(score) {
  if (score >= 45) return 'positive'
  if (score <= -45) return 'negative'
  return 'neutral'
}

function fitTone(category) {
  return String(category || '').toLowerCase().replace(/\s+/g, '-')
}

function formatGenerated(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function TrendMeter({ score }) {
  const clamped = Math.max(-100, Math.min(100, Number(score) || 0))
  return (
    <div className="od-trend-meter" aria-label={`Trend score ${clamped}`}>
      <span className="od-trend-zero" />
      <span className={`od-trend-fill ${scoreTone(clamped)}`} style={{ left: `${Math.min(50, 50 + clamped / 2)}%`, width: `${Math.abs(clamped) / 2}%` }} />
      <i style={{ left: `calc(${50 + clamped / 2}% - 4px)` }} />
    </div>
  )
}

function HeroMetric({ label, value, helper, tone = 'neutral' }) {
  return (
    <div className={`od-hero-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  )
}

function MarketCard({ ticker, trend, selected, onSelect }) {
  const indicators = trend.indicators || {}
  return (
    <article className={`od-market-card ${selected ? 'is-selected' : ''}`}>
      <button type="button" className="od-market-card-select" onClick={onSelect} aria-pressed={selected}>
        <span><b>{ticker}</b><small>As of {trend.as_of}</small></span>
        <span className={`od-direction-badge ${trend.direction}`}>{trend.label}</span>
      </button>
      <div className="od-market-score-row">
        <div><strong className={scoreTone(trend.score)}>{signed(trend.score)}</strong><span>technical score</span></div>
        <div><strong>{money(trend.price)}</strong><span>adjusted close</span></div>
        <div><strong className={Number(trend.return_value) >= 0 ? 'positive' : 'negative'}>{signed(trend.return_value, 2)}%</strong><span>{trend.return_label}</span></div>
      </div>
      <TrendMeter score={trend.score} />
      <div className="od-market-quick-grid">
        <span><small>RSI 14</small><strong>{number(indicators.rsi_14, 1)}</strong></span>
        <span><small>MACD hist.</small><strong>{signed(indicators.macd_histogram, 2)}</strong></span>
        <span><small>ADX 14</small><strong>{number(indicators.adx_14, 1)}</strong></span>
        <span><small>RV percentile</small><strong>{percent(trend.volatility_percentile, 0)}</strong></span>
      </div>
      <details className="od-score-audit">
        <summary>Show score calculation</summary>
        <div>{(trend.components || []).map(component => (
          <span key={component.name} className={component.points > 0 ? 'positive' : component.points < 0 ? 'negative' : 'neutral'}>
            <b>{component.points > 0 ? '+1' : component.points < 0 ? '−1' : '0'}</b>
            <em>{component.name}</em>
            <small>{component.detail}</small>
          </span>
        ))}</div>
      </details>
    </article>
  )
}

function EvidenceCard({ item }) {
  const tone = item.signal || 'neutral'
  const value = item.unit === 'percentage points'
    ? `${signed(item.value, 2)} pts`
    : item.unit === 'price' ? money(item.value) : number(item.value, item.unit === 'index' ? 1 : 3)
  return (
    <div className={`od-evidence-card ${tone}`}>
      <div><span>{item.label}</span><b>{item.contribution > 0 ? `+${item.contribution}` : item.contribution} macro pts</b></div>
      <strong>{value}</strong>
      <small>{finite(item.change_3m) ? `${signed(item.change_3m, 2)}% over 3 months · ` : ''}{item.rationale}</small>
    </div>
  )
}

function IndicatorTable({ markets, order }) {
  return (
    <div className="od-table-wrap">
      <table className="od-indicator-table">
        <thead>
          <tr>
            <th>Market</th><th>Price</th><th>EMA 20</th><th>EMA 50</th><th>EMA 200</th>
            <th>MACD</th><th>Signal</th><th>Histogram</th><th>RSI 14</th><th>Awesome Osc.</th>
            <th>ADX 14</th><th>+DI / −DI</th><th>ATR 14</th><th>Realized vol.</th><th>RV percentile</th>
          </tr>
        </thead>
        <tbody>{order.map(ticker => {
          const trend = markets[ticker]
          if (!trend) return null
          const item = trend.indicators || {}
          return (
            <tr key={ticker}>
              <th><strong>{ticker}</strong><small>{trend.label} · {signed(trend.score)}</small></th>
              <td>{money(trend.price)}</td><td>{money(item.ema_20)}</td><td>{money(item.ema_50)}</td><td>{money(item.ema_200)}</td>
              <td>{number(item.macd, 3)}</td><td>{number(item.macd_signal, 3)}</td><td className={Number(item.macd_histogram) >= 0 ? 'positive' : 'negative'}>{signed(item.macd_histogram, 3)}</td>
              <td>{number(item.rsi_14, 1)}</td><td className={Number(item.awesome_oscillator) >= 0 ? 'positive' : 'negative'}>{signed(item.awesome_oscillator, 3)}</td>
              <td>{number(item.adx_14, 1)}</td><td>{number(item.plus_di, 1)} / {number(item.minus_di, 1)}</td><td>{number(item.atr_14, 2)}</td>
              <td>{percent(item.realized_volatility, 1)}</td><td>{percent(trend.volatility_percentile, 0)}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

function RecommendationTable({ rows, onOpen }) {
  if (!rows.length) return <div className="od-empty">No strategies match these filters. Choose “All fits” to see the full ranking.</div>
  return (
    <div className="od-table-wrap">
      <table className="od-recommendation-table">
        <thead><tr><th>Rank</th><th>Market</th><th>Trade to research</th><th>Fit</th><th>Technical</th><th>Economy</th><th>Volatility</th><th>Why it ranks here</th><th /></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={`${row.market}-${row.strategy_key}`}>
            <td><span className="od-rank">#{row.rank}</span></td>
            <td><strong className="od-market-symbol">{row.market}</strong><small>{row.stance}</small></td>
            <td><strong>{row.name}</strong><small>{row.risk} · {row.scanner}</small></td>
            <td><span className={`od-fit-badge ${fitTone(row.category)}`}>{row.category}</span><b className="od-fit-score">{row.score}</b></td>
            <td><b>{row.technical_fit}</b><small>55% weight</small></td>
            <td><b>{row.macro_fit}</b><small>{signed(row.macro_adjustment, 1)} pt adjustment</small></td>
            <td><b>{row.volatility_fit}</b><small>20% weight</small></td>
            <td className="od-reason-cell"><strong>{row.thesis}</strong><small>{(row.reasons || []).join(' · ')}</small>{row.cautions?.length > 0 && <em>{row.cautions.join(' · ')}</em>}</td>
            <td><button type="button" className="btn btn-primary od-open-scanner" onClick={() => onOpen(row.route)}>Open scanner</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export default function OptionDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeframe, setTimeframe] = useState('weekly')
  const [market, setMarket] = useState('all')
  const [fitFilter, setFitFilter] = useState('recommended')

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/options/dashboard${refresh ? '?refresh=1' : ''}`)
      const payload = await response.json()
      if (!response.ok || payload.error) throw new Error(payload.error || `Dashboard request failed (${response.status})`)
      setData(payload)
    } catch (err) {
      setError(err.message || 'Unable to load the option dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => load(false), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const current = data?.timeframes?.[timeframe]
  const trendMarkets = useMemo(() => current?.markets || {}, [current])
  const marketOrder = data?.markets || Object.keys(trendMarkets)
  const economy = data?.economy || {}
  const filteredRows = useMemo(() => {
    const rows = [...(current?.recommendations || [])]
      .filter(row => market === 'all' || row.market === market)
      .filter(row => fitFilter === 'all' || (fitFilter === 'ideal' ? row.category === 'Ideal' : ['Ideal', 'Favorable'].includes(row.category)))
    return rows.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || b.score - a.score || a.market.localeCompare(b.market))
  }, [current, market, fitFilter])

  const topRecommendation = filteredRows[0] || current?.recommendations?.[0]
  const averageVolatility = useMemo(() => {
    const values = Object.values(trendMarkets).map(item => Number(item.volatility_percentile)).filter(Number.isFinite)
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }, [trendMarkets])

  return (
    <div className="page od-page">
      <header className="od-header">
        <div>
          <span className="od-eyebrow">Technical + economic regime</span>
          <h1>Options Dashboard</h1>
          <p>Choose the right scanner before choosing a contract. SPY, QQQ, and IWM are scored across three timeframes, then matched to option strategies using the live economic and volatility backdrop.</p>
        </div>
        <div className="od-header-actions">
          <span><b>{data?.freshness?.status || (loading ? 'loading' : 'unavailable')}</b><small>{data ? `Updated ${formatGenerated(data.generated_at)}` : 'Waiting for market data'}</small></span>
          <button type="button" className="btn btn-secondary" onClick={() => load(true)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh market data'}</button>
        </div>
      </header>

      {error && <div className="od-error"><strong>Dashboard unavailable</strong><span>{error}</span><button type="button" onClick={() => load(true)}>Try again</button></div>}
      {data?.freshness?.status === 'stale' && <div className="od-warning"><strong>Showing last successful snapshot.</strong> Live refresh failed: {data.freshness.warning}</div>}
      {loading && !data && <div className="od-loading"><span /><strong>Building the market regime</strong><small>Downloading adjusted price history and calculating daily, weekly, monthly, and economic signals…</small></div>}

      {data && current && <>
        <section className="od-hero-grid" aria-label="Dashboard summary">
          <HeroMetric label={`${current.label} market posture`} value={signed(current.summary.score)} helper={`${current.summary.bullish_markets} bullish · ${current.summary.bearish_markets} bearish · ${current.summary.agreement}% agreement`} tone={scoreTone(current.summary.score)} />
          <HeroMetric label="Economic prediction" value={economy.outlook} helper={`${signed(economy.score)} macro score · ${economy.recession_risk} recession risk`} tone={scoreTone(economy.score)} />
          <HeroMetric label="Volatility regime" value={`${percent(averageVolatility, 0)} percentile`} helper="Average realized-volatility percentile across SPY, QQQ, and IWM" tone={averageVolatility >= 70 ? 'negative' : averageVolatility <= 30 ? 'positive' : 'neutral'} />
          <HeroMetric label="Best scanner fit" value={topRecommendation ? topRecommendation.name : 'No match'} helper={topRecommendation ? `${topRecommendation.market} · ${topRecommendation.category} ${topRecommendation.score}/100` : 'Adjust the recommendation filters'} tone={topRecommendation?.category === 'Ideal' ? 'positive' : 'neutral'} />
        </section>

        <section className="od-timeframe-shell card">
          <div className="od-section-heading">
            <div><span>Analysis horizon</span><h2>Filter every signal by timeframe</h2></div>
            <p>Use monthly for the primary regime, weekly for the trade thesis, and daily for entry timing. Alignment across all three is stronger than any one signal.</p>
          </div>
          <div className="od-timeframe-tabs" role="tablist" aria-label="Trend timeframe">
            {TIMEFRAMES.map(item => <button key={item.key} type="button" role="tab" aria-selected={timeframe === item.key} className={timeframe === item.key ? 'active' : ''} onClick={() => setTimeframe(item.key)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}
          </div>
        </section>

        <section className="od-section">
          <div className="od-section-heading">
            <div><span>{current.label} trend map</span><h2>SPY, QQQ, and IWM</h2></div>
            <p>Scores range from −100 to +100. Each of the eight technical rules contributes −1, 0, or +1; click a market to filter trade recommendations.</p>
          </div>
          <div className="od-market-grid">{marketOrder.map(ticker => <MarketCard key={ticker} ticker={ticker} trend={trendMarkets[ticker]} selected={market === ticker} onSelect={() => setMarket(currentMarket => currentMarket === ticker ? 'all' : ticker)} />)}</div>
        </section>

        <section className="od-section card od-indicator-section">
          <div className="od-section-heading">
            <div><span>Indicator evidence</span><h2>Every technical value used</h2></div>
            <p>EMAs define trend structure; MACD, RSI, and Awesome Oscillator measure momentum; ADX confirms direction strength; ATR and realized volatility describe the movement and premium backdrop.</p>
          </div>
          <IndicatorTable markets={trendMarkets} order={marketOrder} />
          <div className="od-method-strip"><span><b>EMA rules</b> Price vs 20 · 20 vs 50 · 50 vs 200</span><span><b>Momentum rules</b> MACD histogram · RSI zones · Awesome Oscillator</span><span><b>Confirmation</b> trailing return · ADX direction when ADX ≥ 20</span></div>
        </section>

        <section className="od-section card od-economy-section">
          <div className="od-economy-heading">
            <div><span>Economic nowcast</span><h2>{economy.outlook}</h2><p>{economy.prediction}</p></div>
            <div className={`od-macro-score ${scoreTone(economy.score)}`}><strong>{signed(economy.score)}</strong><span>macro score</span><small>{economy.recession_risk} recession risk</small></div>
          </div>
          <div className="od-evidence-grid">{(economy.evidence || []).map(item => <EvidenceCard key={item.key} item={item} />)}</div>
          <div className="od-economy-note"><strong>How this affects trades:</strong> the economic fit supplies 25% of every ranking. A bullish trade loses points in a contractionary backdrop; bearish and downside-aware structures gain relative fit. Neutral short-premium trades still require low trend strength and adequate volatility.</div>
          <small className="od-methodology">{economy.methodology}</small>
        </section>

        <section className="od-section card od-recommendations">
          <div className="od-section-heading od-recommendation-heading">
            <div><span>Action ranking</span><h2>Best scanners for the {current.label.toLowerCase()} setup</h2></div>
            <div className="od-filters">
              <label><span>Market</span><select value={market} onChange={event => setMarket(event.target.value)}><option value="all">All three</option>{(data.markets || []).map(ticker => <option key={ticker} value={ticker}>{ticker}</option>)}</select></label>
              <label><span>Fit</span><select value={fitFilter} onChange={event => setFitFilter(event.target.value)}><option value="recommended">Ideal &amp; favorable</option><option value="ideal">Ideal only</option><option value="all">All fits</option></select></label>
            </div>
          </div>
          <RecommendationTable rows={filteredRows} onOpen={navigate} />
          <div className="od-ranking-formula"><strong>Fit score</strong><span>55% technical alignment</span><i>+</i><span>25% economic alignment</span><i>+</i><span>20% volatility alignment</span><em>“Ideal” starts at 78. The linked scanner must still validate the underlying, chain liquidity, expiration, strikes, price, and trade-specific risk rules.</em></div>
        </section>

        <footer className="od-footer">
          <div><strong>Sources</strong>{(data.sources || []).map(source => <span key={source.name}>{source.name}: {source.coverage}</span>)}</div>
          <p><strong>Educational analysis only.</strong> Market data can be delayed or incomplete. An economic nowcast and technical score are decision aids, not guarantees or personalized investment advice.</p>
        </footer>
      </>}
    </div>
  )
}
