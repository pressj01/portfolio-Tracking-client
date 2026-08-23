import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import CompactScannerFilterPanel from '../components/CompactScannerFilterPanel'
import GeneralScannerAnalysis from '../components/GeneralScannerAnalysis'
import { useProfileFetch } from '../context/ProfileContext'
import { OPTION_SCANNER_GROUPS, OPTION_SCANNERS } from '../utils/optionScannerCatalog'
import {
  CORE_INDEX_TICKERS,
  defaultsForGeneralStrategy,
  fieldsForGeneralStrategy,
  GENERAL_STRATEGY_CONFIG,
  helpForGeneralField,
  isIndexOnlyStrategy,
  MAX_OPTION_DTE,
  MIN_OPTION_DTE,
  riskProfileDefaultsForGeneralStrategy,
  setupDefaultsForGeneralStrategy,
  setupsForGeneralStrategy,
  updateDteFilters,
} from '../utils/generalOptionScannerConfig'
import { buildScannerTrade, hasScannerTrade } from '../utils/optionTradeHandoff'
import {
  DEFAULT_EXPIRATION_SCENARIO,
  EXPIRATION_SCENARIO_REFERENCES,
  EXPIRATION_SCENARIO_STRATEGIES,
  calculateExpirationScenario,
  describeExpirationScenario,
  expirationScenarioPasses,
} from '../utils/optionExpirationScenario'

const money = value => value != null && value !== '' && Number.isFinite(Number(value))
  ? Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '—'
const number = (value, digits = 1) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'
const percent = value => value != null && value !== '' && Number.isFinite(Number(value)) ? `${number(value, 1)}%` : '—'
const signedPoints = value => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
  const amount = Number(value)
  return `${amount > 0 ? '+' : ''}${amount.toFixed(1)}`
}
const rangeText = (min, max, { floor = 0, ceil = 100, suffix = '' } = {}) => {
  const low = Number(min)
  const high = Number(max)
  if (!Number.isFinite(low) || !Number.isFinite(high) || (low <= floor && high >= ceil)) return 'Any'
  if (low <= floor) return `Up to ${high}${suffix}`
  if (high >= ceil) return `Above ${low}${suffix}`
  return `${low}–${high}${suffix}`
}
const observationDays = observations => `${observations} ${Number(observations) === 1 ? 'day' : 'days'}`
const rankCell = (value, observations, warmingTitle, provisional = false) => (
  value == null
    ? <small title={warmingTitle}>Warming up{observations != null ? <><br />{observationDays(observations)}</> : null}</small>
    : <span title={provisional ? `Provisional percentile from ${observations || 0} daily observations; stabilizes after about 20` : undefined}>{percent(value)}{provisional ? <sup>*</sup> : null}</span>
)
const riskMoney = (value, unbounded) => unbounded ? 'Unlimited' : money(value)
const signedMoney = value => value != null && value !== '' && Number.isFinite(Number(value))
  ? `${Number(value) > 0 ? '+' : ''}${money(value)}`
  : '—'
const MONTH_LABELS = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const ordinal = value => {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  return `${value}${value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'}`
}
const formatExpiration = value => {
  if (!value) return '—'
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : `${MONTH_LABELS[parsed.getMonth()]} ${ordinal(parsed.getDate())} ${parsed.getFullYear()}`
}

const SCANNER_BY_KEY = Object.fromEntries(OPTION_SCANNERS.map(scanner => [scanner.key, scanner]))
const SCANNER_SESSION_KEY = 'generalOptionScannerSessionV3'
const TREND_FIELD = { key: 'trend', label: 'Trend', type: 'select', options: [['any', 'Any'], ['uptrend', 'Uptrend'], ['downtrend', 'Downtrend'], ['mixed', 'Mixed / range']] }
const MOVE_FIELD = { key: 'move', label: 'Recent move', type: 'select', options: [['any', 'Any'], ['down', 'Down / pullback'], ['up', 'Up / rally']] }
const LOOKBACK_FIELD = { key: 'lookback', label: 'Move lookback', type: 'select', options: [['5', '5 sessions'], ['10', '10 sessions'], ['21', '21 sessions']] }

function restoredScannerSession(initialStrategy) {
  if (!initialStrategy) return null
  try {
    const saved = JSON.parse(sessionStorage.getItem(SCANNER_SESSION_KEY) || 'null')
    if (saved?.version !== 1 || saved.strategy !== initialStrategy || !Array.isArray(saved.rows)) return null
    return saved
  } catch {
    return null
  }
}

function scoreText(filters, key) {
  const low = Number(filters[`stock_score_${key}_min`] ?? 1)
  const high = Number(filters[`stock_score_${key}_max`] ?? 10)
  return low === 1 && high === 10 ? 'Any' : `${low}–${high}`
}

function symbolScopeText(filters) {
  if (filters.symbols) return filters.symbols
  const groups = []
  if (filters.include_stocks) groups.push(filters.universe === 'mid_cap' ? 'Mid caps' : filters.universe === 'large_mid' ? 'Large + mid caps' : filters.universe === 'holdings' ? 'My holdings' : filters.universe === 'watchlist' ? 'My watchlist' : 'Large caps')
  if (filters.include_index_etfs) groups.push(filters.index_tickers ? `Index ETFs: ${filters.index_tickers}` : 'All index ETFs')
  if (filters.include_sector_etfs) groups.push('Sector ETFs')
  if (filters.include_commodity_etfs) groups.push('Commodity ETFs')
  return groups.join(' + ') || 'None selected'
}

const SCAN_UNIVERSE_OPTIONS = [
  ['stocks_large_cap', 'Stocks only — Large caps', { universe: 'large_cap', include_stocks: true }],
  ['stocks_large_mid', 'Stocks only — Large + mid caps', { universe: 'large_mid', include_stocks: true }],
  ['stocks_mid_cap', 'Stocks only — Mid caps', { universe: 'mid_cap', include_stocks: true }],
  ['stocks_holdings', 'Stocks only — My holdings', { universe: 'holdings', include_stocks: true }],
  ['stocks_watchlist', 'Stocks only — My watchlist', { universe: 'watchlist', include_stocks: true }],
  ['core_index_etfs', 'Core index ETFs - SPY, QQQ, IWM', { include_stocks: false, include_index_etfs: true, index_tickers: CORE_INDEX_TICKERS }],
  ['all_index_etfs', 'All index ETFs', { include_stocks: false, include_index_etfs: true, index_tickers: '' }],
  ['sector_etfs', 'Sector ETFs only', { include_stocks: false, include_sector_etfs: true }],
  ['commodity_etfs', 'Commodity ETFs only', { include_stocks: false, include_commodity_etfs: true }],
  ['core_index_commodity_etfs', 'Core index + commodity ETFs', { include_stocks: false, include_index_etfs: true, include_commodity_etfs: true, index_tickers: CORE_INDEX_TICKERS }],
  ['all_index_commodity_etfs', 'All index + commodity ETFs', { include_stocks: false, include_index_etfs: true, include_commodity_etfs: true, index_tickers: '' }],
  ['index_sector_etfs', 'All index + sector ETFs', { include_stocks: false, include_index_etfs: true, include_sector_etfs: true, index_tickers: '' }],
  ['sector_commodity_etfs', 'Sector + commodity ETFs', { include_stocks: false, include_sector_etfs: true, include_commodity_etfs: true }],
  ['all_etfs', 'All ETFs — index + sector + commodity', { include_stocks: false, include_index_etfs: true, include_sector_etfs: true, include_commodity_etfs: true, index_tickers: '' }],
  ['stocks_core_index_etfs', 'Stocks + core index ETFs', { include_stocks: true, include_index_etfs: true, index_tickers: CORE_INDEX_TICKERS }],
  ['stocks_all_index_etfs', 'Stocks + all index ETFs', { include_stocks: true, include_index_etfs: true, index_tickers: '' }],
  ['stocks_all_etfs', 'Stocks + all ETFs', { include_stocks: true, include_index_etfs: true, include_sector_etfs: true, include_commodity_etfs: true, index_tickers: '' }],
  ['custom_combination', 'Custom combination — use the checkboxes below', null],
]

function selectedUniverseOption(filters) {
  const flags = [
    Boolean(filters.include_stocks),
    Boolean(filters.include_index_etfs),
    Boolean(filters.include_sector_etfs),
    Boolean(filters.include_commodity_etfs),
  ]
  const normalizedIndexTickers = String(filters.index_tickers || '').replace(/\s+/g, '').toUpperCase()
  const indexScope = !normalizedIndexTickers ? 'all' : normalizedIndexTickers === CORE_INDEX_TICKERS ? 'core' : 'custom'
  if (flags[0] && !flags.slice(1).some(Boolean)) {
    return `stocks_${filters.universe === 'large_mid' ? 'large_mid' : filters.universe === 'mid_cap' ? 'mid_cap' : filters.universe === 'holdings' ? 'holdings' : filters.universe === 'watchlist' ? 'watchlist' : 'large_cap'}`
  }
  if (!flags[0] && flags[1] && !flags[2] && !flags[3] && indexScope !== 'custom') return `${indexScope}_index_etfs`
  if (!flags[0] && !flags[1] && flags[2] && !flags[3]) return 'sector_etfs'
  if (!flags[0] && !flags[1] && !flags[2] && flags[3]) return 'commodity_etfs'
  if (!flags[0] && flags[1] && !flags[2] && flags[3] && indexScope !== 'custom') return `${indexScope}_index_commodity_etfs`
  if (!flags[0] && flags[1] && flags[2] && !flags[3] && indexScope === 'all') return 'index_sector_etfs'
  if (!flags[0] && !flags[1] && flags[2] && flags[3]) return 'sector_commodity_etfs'
  if (!flags[0] && flags.slice(1).every(Boolean) && indexScope === 'all') return 'all_etfs'
  if (flags[0] && flags[1] && !flags[2] && !flags[3] && indexScope !== 'custom') return `stocks_${indexScope}_index_etfs`
  if (flags[0] && flags.slice(1).every(Boolean) && indexScope === 'all') return 'stocks_all_etfs'
  return 'custom_combination'
}

function applyUniverseOption(current, value) {
  const option = SCAN_UNIVERSE_OPTIONS.find(([key]) => key === value)
  if (!option?.[2]) return current
  const next = { ...current, ...option[2] }
  for (const key of ['include_stocks', 'include_index_etfs', 'include_sector_etfs', 'include_commodity_etfs']) {
    if (!(key in option[2])) next[key] = false
  }
  return next
}

function openingCashflowText(mode) {
  if (mode === 'debit_or_flat') return 'Debit or zero credit'
  if (mode === 'flat_or_slight_credit') return 'Zero to slight credit'
  if (mode === 'credit') return 'Opening credit'
  return 'Any opening cash flow'
}

function fieldText(field, value) {
  if (field.type === 'select') {
    return field.options.find(([candidate]) => String(candidate) === String(value))?.[1] || String(value ?? 'Any')
  }
  if (field.type === 'checkbox') return value ? 'Yes' : 'No'
  if (field.type === 'text') return value == null || value === '' ? 'Any' : String(value)
  if (value == null || value === '' || (field.zeroIsAny && !Number(value))) return 'Any'
  const amount = field.scale ? Number(value) / field.scale : Number(value)
  const digits = field.scale ? 1 : undefined
  return `${field.prefix || ''}${amount.toLocaleString(undefined, digits != null ? { maximumFractionDigits: digits } : undefined)}${field.suffix ? ` ${field.suffix}` : ''}`
}

function sizeText(value, scale, suffix) {
  if (!Number(value)) return 'Any'
  return `Above $${(Number(value) / scale).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`
}

function ScoreRange({ label, name, filters, setFilter }) {
  const minKey = `stock_score_${name}_min`
  const maxKey = `stock_score_${name}_max`
  const low = Number(filters[minKey] ?? 1)
  const high = Number(filters[maxKey] ?? 10)
  return <div className="csf-score-filter">
    <span>{label}</span>
    <div className="csf-score-range">
      <label>Minimum<input type="range" min="1" max="10" value={low} onChange={event => setFilter(minKey, Math.min(Number(event.target.value), high))} /></label>
      <b>{low === 1 && high === 10 ? 'Any' : `${low}–${high}`}</b>
      <label>Maximum<input type="range" min="1" max="10" value={high} onChange={event => setFilter(maxKey, Math.max(Number(event.target.value), low))} /></label>
    </div>
  </div>
}

function DynamicField({ field, value, onChange }) {
  if (field.type === 'select') {
    return <label className="gos-input"><span>{field.label}</span><select value={String(value)} onChange={event => {
      const next = event.target.value
      onChange(next === 'true' ? true : next === 'false' ? false : next)
    }}>{field.options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
  }
  if (field.type === 'checkbox') {
    return <label className="gos-check"><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked)} /> {field.label}</label>
  }
  if (field.type === 'text') {
    return <label className="gos-input"><span>{field.label}</span><input type="text" value={value ?? ''} placeholder={field.placeholder} onChange={event => onChange(event.target.value.toUpperCase())} /></label>
  }
  const scale = field.scale || 1
  const display = value == null || value === '' ? '' : Number(value) / scale
  return <label className="gos-input"><span>{field.label}</span><div>{field.prefix && <b>{field.prefix}</b>}<input type="number" value={display} step={field.step ?? 1} min={field.min} max={field.max} onChange={event => onChange(event.target.value === '' ? (field.zeroIsAny ? 0 : null) : Number(event.target.value) * scale)} />{field.suffix && <b>{field.suffix}</b>}</div></label>
}

function ExpirationScenarioEditor({ scenario, enabled, onChange, onToggle }) {
  const reference = EXPIRATION_SCENARIO_REFERENCES.find(item => item.value === scenario.reference)
    || EXPIRATION_SCENARIO_REFERENCES[0]
  return <div className="gos-scenario-editor">
    <p>Model the trade&apos;s P/L at expiration after an underlying-price move, then optionally filter the scan by P/L on margin.</p>
    <label className="gos-input gos-wide"><span>Underlying price at expiration</span><select value={scenario.reference} onChange={event => onChange({ ...scenario, reference: event.target.value })}>{EXPIRATION_SCENARIO_REFERENCES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <div className="gos-quick-pair">
      <label className="gos-input"><span>Move</span><div><input type="number" value={scenario.amount} step="0.25" onChange={event => onChange({ ...scenario, amount: event.target.value === '' ? 0 : Number(event.target.value) })} /><b>{reference.unit}</b></div></label>
      <label className="gos-input"><span>P/L on margin</span><select value={scenario.marginRule} onChange={event => onChange({ ...scenario, marginRule: event.target.value })}><option value="any">Any</option><option value="above">At or above</option><option value="below">At or below</option></select></label>
    </div>
    {scenario.marginRule !== 'any' && <label className="gos-input gos-wide"><span>P/L on margin threshold</span><div><input type="number" value={scenario.marginPct} step="0.5" onChange={event => onChange({ ...scenario, marginPct: event.target.value === '' ? 0 : Number(event.target.value) })} /><b>%</b></div></label>}
    <div className="gos-scenario-actions">
      <span>{enabled ? 'Scenario #1 is active and the expiry P/L column is visible.' : 'Add this scenario to the current scan.'}</span>
      <button type="button" className={enabled ? 'btn btn-xs btn-outline' : 'btn btn-xs btn-primary'} onClick={() => onToggle(!enabled)}>{enabled ? 'Remove scenario' : 'Add scenario'}</button>
    </div>
  </div>
}

function scenarioContext(row) {
  const meta = row?._general || {}
  const technicals = meta.technicals || {}
  return {
    currentPrice: meta.price ?? row?.price,
    atr14: technicals.atr_14 ?? row?.atr_14,
    annualizedVolatility: technicals.rv_30 ?? meta.rv ?? row?.rv_30,
    targetPrice: technicals.target_mean_price ?? row?.target_mean_price,
    sma200: technicals.sma_200 ?? row?.sma_200,
    week52High: technicals.week52_high ?? row?.week52_high,
    week52Low: technicals.week52_low ?? row?.week52_low,
  }
}

function calculateRowScenario(row, scenario, strategy) {
  const meta = row?._general || {}
  const trade = buildScannerTrade(meta.trade_kind || strategy, row)
  if (!trade) return { spot: null, pnl: null, margin: null, pnlOnMarginPct: null, error: 'The scanner trade could not be reconstructed.' }
  return calculateExpirationScenario(
    trade,
    scenario,
    scenarioContext(row),
    meta.dte,
    meta.max_loss_unbounded ? null : meta.max_loss,
  )
}

function ScoreCells({ scores }) {
  const scoreTypes = [
    ['fundamental', 'F', 'Fundamental'],
    ['growth', 'G', 'Growth'],
    ['technical', 'T', 'Technical'],
  ]
  const values = scoreTypes.map(([key]) => scores?.[key])
  if (values.every(value => value == null)) return <span className="gos-na">N/A</span>
  return <span className="gos-scores" aria-label="Fundamental, growth, and technical scores">{scoreTypes.map(([key, shortLabel, label]) => {
    const value = scores?.[key]
    return <b key={key} data-score={value == null ? undefined : Math.round(Number(value) || 0)} data-missing={value == null ? 'true' : undefined} title={`${label}: ${value == null ? 'Not available' : number(value, 0)}`}><small>{shortLabel}</small><span>{value == null ? '—' : number(value, 0)}</span></b>
  })}</span>
}

function TechnicalCells({ meta }) {
  const technicals = meta.technicals || {}
  const market = meta.market_technicals || {}
  const move = technicals.moves_pct?.['5']
  const arrow = trend => trend === 'uptrend' ? '↑' : trend === 'downtrend' ? '↓' : trend === 'mixed' ? '↔' : '—'
  return <span className="gos-technical-cells">
    <b>SPY {arrow(market.trend)}</b>
    <b>{meta.ticker} {arrow(technicals.trend)}</b>
    <small>{move == null ? 'move N/A' : `5d ${move > 0 ? '+' : ''}${number(move, 1)}%`} · RSI {technicals.rsi_14 == null ? 'N/A' : number(technicals.rsi_14, 0)}</small>
  </span>
}

function ResultTable({ rows, focusedTicker, setFocusedTicker, selected, setSelected, strategy, scenario, scenarioResults }) {
  const sideSkew = strategy === 'cash-secured-put'
    ? { label: 'Put Skew Rank', key: 'put_skew_rank', rawKey: 'put_skew', readyKey: 'put_skew_rank_ready', observationsKey: 'put_skew_rank_observations', explanation: '25-delta put IV minus ATM put IV' }
    : strategy === 'covered-call'
      ? { label: 'Call Skew Rank', key: 'call_skew_rank', rawKey: 'call_skew', readyKey: 'call_skew_rank_ready', observationsKey: 'call_skew_rank_observations', explanation: '25-delta call IV minus ATM call IV' }
      : null
  return <div className="gos-table-wrap"><table className="gos-table">
    <thead><tr><th>Ticker</th><th>Price</th><th>IV Rank</th><th>IV−RV</th><th>IV−RV Rank</th><th>RV Rank</th><th>Vol Score</th>{sideSkew && <><th>{sideSkew.label}</th><th>Skew Rank</th></>}<th>Strikes</th><th>Expiration</th><th>DTE</th><th>Total Opt. Vol.</th><th>Stock Scores</th><th>Technical Setup</th><th>Delta</th><th>Prob. Max Profit</th><th>Prob. Max Loss</th><th>Expected Value</th><th>Max Profit</th><th>Max Loss</th><th>Profit Ratio</th>{scenario && <th>P/L on Expiry #1</th>}</tr></thead>
    <tbody>{rows.map((row, index) => {
      const meta = row._general || {}
      const key = `${meta.ticker}:${meta.expiration}:${meta.strikes}:${index}`
      const active = selected === row
      const nearMatch = meta.match_status === 'near_match'
      const scenarioResult = scenarioResults?.get(row)
      return <tr key={key} className={`${active ? 'selected ' : ''}${nearMatch ? 'near-match' : ''}`.trim()} onClick={() => setSelected(row)} title={nearMatch ? `Near match; missed: ${(meta.filter_reasons || []).join(', ')}` : 'Matches every active filter'}>
        <td><button className="gos-ticker" onClick={event => { event.stopPropagation(); setFocusedTicker(meta.ticker); setSelected(row) }}><span>⊕</span><b>{meta.ticker}</b><small>{meta.name || (focusedTicker ? 'Candidate structure' : '')}</small>{nearMatch && <em>{(meta.filter_reasons || []).length} rule{(meta.filter_reasons || []).length === 1 ? '' : 's'} missed</em>}</button></td>
        <td>{money(meta.price)}</td>
        <td title={meta.iv_rank_source === 'history' ? `${meta.iv_rank_observations} locally collected Yahoo observations` : 'Yahoo IV history is still accumulating'}>{rankCell(meta.iv_rank, meta.iv_rank_observations, 'IV Rank needs about 20 daily observations', meta.iv_rank_source === 'provisional_history')}</td>
        <td title="Today’s at-the-money IV minus the past month’s realized volatility, in volatility points. Positive means options look expensive versus recent realized vol.">{signedPoints(meta.iv_rv)}</td>
        <td title={meta.iv_rv_rank == null ? 'IV−RV rank needs about 20 paired IV and realized-vol observations' : 'Percentile of today’s IV−RV versus the past year'}>{rankCell(meta.iv_rv_rank, meta.iv_rv_observations, 'IV−RV rank needs about 20 paired observations', !meta.iv_rv_rank_ready)}</td>
        <td title="Percentile of the past month’s realized volatility versus the previous year">{meta.rv_rank == null ? '—' : percent(meta.rv_rank)}</td>
        <td title={meta.volatility_score_provisional ? `Provisional average from ${meta.volatility_score_observations || 0} daily observations; stabilizes after about 20` : 'Average of IV Rank and IV−RV Rank. High suggests overpriced options; low suggests underpriced options.'}>{meta.volatility_score == null ? <small>Warming up</small> : <>{number(meta.volatility_score, 1)}{meta.volatility_score_provisional ? <sup>*</sup> : null}</>}</td>
        {sideSkew && <>
          <td title={`${sideSkew.explanation}. Current gap: ${signedPoints(meta[sideSkew.rawKey])} volatility points.`}>{rankCell(meta[sideSkew.key], meta[sideSkew.observationsKey], `${sideSkew.label} needs about 20 daily observations`, !meta[sideSkew.readyKey])}</td>
          <td title={`25-delta put IV minus 25-delta call IV. High means puts are unusually expensive; low means calls are unusually expensive. Current gap: ${signedPoints(meta.skew)} volatility points.`}>{rankCell(meta.skew_rank, meta.skew_rank_observations, 'Skew Rank needs about 20 daily observations', !meta.skew_rank_ready)}</td>
        </>}
        <td className="gos-strikes">{meta.strikes}</td><td>{formatExpiration(meta.expiration)}</td><td>{number(meta.dte, 0)}</td>
        <td title={meta.total_option_volume_source === 'selected_legs' ? 'Full-chain volume was unavailable; this is the combined volume of the selected legs.' : 'Combined option volume reported by the scanner for the priced chain.'}>{meta.total_option_volume == null ? '—' : Number(meta.total_option_volume).toLocaleString()}</td>
        <td><ScoreCells scores={meta.stock_scores} /></td><td><TechnicalCells meta={meta} /></td><td>{number(meta.delta, 2)}</td>
        <td>{meta.prob_max_profit == null && meta.max_profit_unbounded ? 'N/A' : percent(meta.prob_max_profit)}</td><td>{meta.prob_max_loss == null && meta.max_loss_unbounded ? 'N/A' : percent(meta.prob_max_loss)}</td><td>{money(meta.expected_value)}</td>
        <td>{riskMoney(meta.max_profit, meta.max_profit_unbounded)}</td><td>{riskMoney(meta.max_loss, meta.max_loss_unbounded)}</td><td>{percent(meta.profit_ratio)}</td>
        {scenario && <td className="gos-scenario-cell" title={scenarioResult?.error || `${describeExpirationScenario(scenario)}; modeled underlying ${money(scenarioResult?.spot)}`}><b className={scenarioResult?.pnl == null ? '' : Number(scenarioResult.pnl) >= 0 ? 'positive' : 'negative'}>{signedMoney(scenarioResult?.pnl)}</b><small>{scenarioResult?.pnlOnMarginPct == null ? 'margin N/A' : `${percent(scenarioResult.pnlOnMarginPct)} on margin`} · spot {money(scenarioResult?.spot)}</small></td>}
      </tr>
    })}</tbody>
  </table></div>
}

function GeneralOptionScannerWorkspace({ initialStrategy }) {
  const pf = useProfileFetch()
  const [, setSearchParams] = useSearchParams()
  const restored = useMemo(() => restoredScannerSession(initialStrategy), [initialStrategy])
  const restoredRows = restored?.rows || []
  const [strategy, setStrategy] = useState(restored?.strategy || initialStrategy)
  const [filters, setFilters] = useState(() => {
    if (!initialStrategy) return {}
    const restoredFilters = { ...defaultsForGeneralStrategy(initialStrategy), ...(restored?.filters || {}) }
    return isIndexOnlyStrategy(initialStrategy)
      ? { ...restoredFilters, include_stocks: false, include_index_etfs: true, include_sector_etfs: false, include_commodity_etfs: false }
      : restoredFilters
  })
  const [rows, setRows] = useState(restoredRows)
  const [selected, setSelected] = useState(() => restoredRows[restored?.selectedIndex] || restoredRows[0] || null)
  const [focusedTicker, setFocusedTicker] = useState(restored?.focusedTicker || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(restored?.stats || null)
  const [asOf, setAsOf] = useState(restored?.asOf || null)
  const [expirationScenario, setExpirationScenario] = useState(() => ({
    ...DEFAULT_EXPIRATION_SCENARIO,
    ...(restored?.expirationScenario || {}),
  }))
  const [expirationScenarioEnabled, setExpirationScenarioEnabled] = useState(Boolean(restored?.expirationScenarioEnabled))
  const scanRequestRef = useRef({ id: 0, controller: null })

  const scanner = SCANNER_BY_KEY[strategy]
  const config = GENERAL_STRATEGY_CONFIG[strategy]
  const strategyFields = strategy
    ? fieldsForGeneralStrategy(strategy).filter(field => field.key !== 'min_open_interest')
    : []
  const expirationScenarioSupported = EXPIRATION_SCENARIO_STRATEGIES.has(strategy)
  const setFilter = (key, value) => setFilters(current => ({ ...current, risk_profile: 'custom', [key]: value }))
  const setDteFilter = (key, value) => setFilters(current => ({
    ...updateDteFilters(current, key, value),
    risk_profile: 'custom',
  }))

  const replaceFilters = nextFilters => {
    setFilters(nextFilters)
    setRows([]); setSelected(null); setFocusedTicker(null); setStats(null); setAsOf(null); setError('')
  }

  useEffect(() => {
    if (!isIndexOnlyStrategy(strategy)) return
    setFilters(current => current.include_stocks === false
      && current.include_index_etfs === true
      && current.include_sector_etfs === false
      && current.include_commodity_etfs === false
      ? current
      : { ...current, include_stocks: false, include_index_etfs: true, include_sector_etfs: false, include_commodity_etfs: false })
  }, [strategy])

  useEffect(() => {
    if (!strategy) return
    try {
      sessionStorage.setItem(SCANNER_SESSION_KEY, JSON.stringify({
        version: 1,
        strategy,
        filters,
        rows,
        selectedIndex: rows.indexOf(selected),
        focusedTicker,
        stats,
        asOf,
        expirationScenario,
        expirationScenarioEnabled,
      }))
    } catch {
      // A scan remains usable even when private browsing or storage quotas prevent restoration.
    }
  }, [strategy, filters, rows, selected, focusedTicker, stats, asOf, expirationScenario, expirationScenarioEnabled])

  useEffect(() => () => {
    scanRequestRef.current.controller?.abort()
  }, [])

  const changeStrategy = next => {
    setStrategy(next)
    setSearchParams(next ? { strategy: next } : {}, { replace: true })
    setExpirationScenario({ ...DEFAULT_EXPIRATION_SCENARIO })
    setExpirationScenarioEnabled(false)
    replaceFilters(next ? defaultsForGeneralStrategy(next) : {})
  }

  const strategyPicker = <select className="csf-strategy-select" aria-label="Option strategy" title="Choose the option structure to scan. It controls the strategy-specific construction, payoff, and probability rules shown below." value={strategy} onChange={event => changeStrategy(event.target.value)}>
    <option value="">Choose a scan…</option>
    {OPTION_SCANNER_GROUPS.map(group => <optgroup key={group.id} label={group.label}>{group.scanners.map(item => <option key={item.key} value={item.key}>{item.key === 'unbalanced-butterfly' ? 'Put / Unbalanced Butterfly' : item.label}</option>)}</optgroup>)}
  </select>

  const summaryGroups = useMemo(() => {
    if (!strategy) return []
    const indexOnly = isIndexOnlyStrategy(strategy)
    const restrictedCondor = strategy === 'put-call-condor'
    const symbolEditor = restrictedCondor
      ? <div className="gos-inline-stack"><label className="gos-input gos-wide"><span>Supported underlying</span><select value={filters.symbols || 'SPY'} onChange={event => setFilter('symbols', event.target.value)}><option value="SPY">SPY — SPDR S&amp;P 500 ETF</option><option value="^XSP">^XSP — Mini-SPX index</option></select></label><small className="csf-editor-note">This specialized risk-budgeted Condor engine supports SPY and Mini-SPX only and prices one underlying per run.</small></div>
      : indexOnly
      ? <div className="gos-inline-stack"><label className="gos-input gos-wide"><span>Index ETFs (optional)</span><input value={filters.symbols} onChange={event => setFilter('symbols', event.target.value.toUpperCase())} placeholder="SPY, QQQ, IWM, VOO" /></label>{filters.symbols && <small className="csf-editor-note">Only index ETFs are supported for this long-dated structure. Stock symbols will be rejected.</small>}<small className="csf-editor-note">Leave blank to scan the default index ETF set.</small></div>
      : <div className="gos-inline-stack"><label className="gos-input gos-wide"><span>Exact symbols (optional)</span><input value={filters.symbols} onChange={event => setFilter('symbols', event.target.value.toUpperCase())} placeholder="SPY, QQQ, IWM, GLD, DBC, AAPL" /></label><label className="gos-input gos-wide"><span>Scan universe</span><select value={selectedUniverseOption(filters)} onChange={event => setFilters(current => ({ ...applyUniverseOption(current, event.target.value), risk_profile: 'custom' }))}>{SCAN_UNIVERSE_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="gos-inline-checks"><label className="gos-check"><input type="checkbox" checked={filters.include_stocks} onChange={event => setFilter('include_stocks', event.target.checked)} /> Stocks</label><label className="gos-check"><input type="checkbox" checked={filters.include_index_etfs} onChange={event => setFilter('include_index_etfs', event.target.checked)} /> Index ETFs (SPY, QQQ, IWM…)</label><label className="gos-check"><input type="checkbox" checked={filters.include_sector_etfs} onChange={event => setFilter('include_sector_etfs', event.target.checked)} /> Sector ETFs</label><label className="gos-check"><input type="checkbox" checked={filters.include_commodity_etfs} onChange={event => setFilter('include_commodity_etfs', event.target.checked)} /> Commodity ETFs (GLD, SLV, DBC…)</label></div>{filters.symbols && <small className="csf-editor-note">The exact list is active; universe choices are ignored until the list is cleared.</small>}<small className="csf-editor-note">Use the dropdown for a common combination, or use the checkboxes to fine-tune it.</small></div>
    const symbolHelp = restrictedCondor
      ? 'The specialized Put / Call Condor module supports SPY and Mini-SPX (^XSP) only. That engine prices one underlying per run, so this field intentionally replaces the broad universe selector.'
      : indexOnly
      ? 'These long-dated unbalanced structures are defined for broad index ETFs only. Enter symbols such as SPY, QQQ, IWM, or VOO; individual stocks and sector ETFs are not supported.'
      : 'Enter ticker symbols to scan only those names, including any mix such as SPY, QQQ, IWM, GLD, DBC, AAPL, and MSFT. Leave the list empty to choose stocks, index ETFs, sector ETFs, and commodity ETFs from the scan universe selector.'
    const groups = [
    { title: 'Expiration (DTE)', help: 'Filters every strategy by days to expiration. Same-day contracts are 0 DTE, and the three-year upper limit includes LEAPS beyond 12 months.', items: [
      { label: 'DTE filter', value: `${filters.min_dte}–${filters.max_dte} DTE · target ${filters.target_dte}`, help: 'Minimum and maximum DTE are hard filters. Target DTE picks the preferred listed expiration inside that range. Set all three values to the same number to request one exact DTE; the scanner uses a contract only when that DTE is listed.', editor: <div className="gos-dte-fields"><DynamicField field={{ key: 'min_dte', label: 'Minimum DTE', step: 1, min: MIN_OPTION_DTE, max: MAX_OPTION_DTE }} value={filters.min_dte} onChange={value => setDteFilter('min_dte', value)} /><DynamicField field={{ key: 'target_dte', label: 'Target DTE', step: 1, min: MIN_OPTION_DTE, max: MAX_OPTION_DTE }} value={filters.target_dte} onChange={value => setDteFilter('target_dte', value)} /><DynamicField field={{ key: 'max_dte', label: 'Maximum DTE', step: 1, min: MIN_OPTION_DTE, max: MAX_OPTION_DTE }} value={filters.max_dte} onChange={value => setDteFilter('max_dte', value)} /></div> },
    ] },
    { title: 'Descriptive data', help: 'Select the stock and ETF symbols to scan. An exact symbol list takes precedence over the universe selections.', items: [{ label: 'Include symbols', value: restrictedCondor ? (filters.symbols || 'SPY') : indexOnly ? (filters.symbols || 'Index ETFs only') : symbolScopeText(filters), help: symbolHelp, editor: symbolEditor }, ...(indexOnly ? [{ label: 'Opening cash flow', value: openingCashflowText(filters.entry_credit_mode), help: 'Risk Averse accepts a debit or zero credit, Moderate accepts zero through a small credit, and Aggressive requires a positive opening credit. These rules apply to all unbalanced long-dated structures.', editor: null }] : [])] },
    { title: 'Quality and liquidity', help: 'Drops names that are too small, too thinly traded, or that report earnings inside the option\'s life. Open Filters leave these off; Risk Averse and Moderate turn them on.', items: [
      { label: 'Skip earnings inside the trade', value: filters.exclude_earnings_before_expiry ? 'Yes' : 'No', help: 'Rejects stocks whose next earnings report falls on or before the selected expiration. Funds are not filtered. Short-premium presets turn this on because an earnings gap can overwhelm the collected credit.', editor: <DynamicField field={{ key: 'exclude_earnings_before_expiry', label: 'Skip names with earnings before expiry', type: 'checkbox' }} value={filters.exclude_earnings_before_expiry} onChange={value => setFilter('exclude_earnings_before_expiry', value)} /> },
      { label: 'Min market cap', value: sizeText(filters.min_market_cap, 1e9, 'B'), help: 'Minimum equity market capitalization for individual stocks. Zero means any size. ETFs are sized by AUM instead of market cap.', editor: <DynamicField field={{ key: 'min_market_cap', label: 'Minimum market cap', prefix: '$', suffix: 'B', scale: 1e9, step: 0.5, min: 0, zeroIsAny: true }} value={filters.min_market_cap} onChange={value => setFilter('min_market_cap', value)} /> },
      { label: 'ETF min AUM', value: sizeText(filters.fund_min_aum, 1e9, 'B'), help: 'Minimum fund assets under management. Zero means any size. This applies to index, sector, and commodity ETFs, not to individual stocks.', editor: <DynamicField field={{ key: 'fund_min_aum', label: 'Minimum ETF AUM', prefix: '$', suffix: 'B', scale: 1e9, step: 0.1, min: 0, zeroIsAny: true }} value={filters.fund_min_aum} onChange={value => setFilter('fund_min_aum', value)} /> },
      { label: 'Min $ volume', value: sizeText(filters.min_avg_dollar_volume, 1e6, 'M'), help: 'Minimum average daily share-price × share-volume over the recent month. Higher values usually lead to more liquid option chains.', editor: <DynamicField field={{ key: 'min_avg_dollar_volume', label: 'Minimum dollar volume', prefix: '$', suffix: 'M', scale: 1e6, step: 5, min: 0, zeroIsAny: true }} value={filters.min_avg_dollar_volume} onChange={value => setFilter('min_avg_dollar_volume', value)} /> },
      { label: 'Min open interest', value: Number(filters.min_open_interest) > 0 ? `Above ${Number(filters.min_open_interest).toLocaleString()}` : 'Any', help: 'Requires each relevant option leg to have at least this many open contracts. Zero leaves the chain unfiltered.', editor: <DynamicField field={{ key: 'min_open_interest', label: 'Minimum open interest', step: 10, min: 0, zeroIsAny: true }} value={filters.min_open_interest} onChange={value => setFilter('min_open_interest', value)} /> },
    ] },
    { title: 'Fundamental data', help: 'Filters individual stocks using the app\'s Fundamental and Growth scores. ETFs do not require these company-level scores.', items: [
      { label: 'Stock Score Fundamental', value: scoreText(filters, 'fundamental'), help: 'A transparent 1–10 app score for company quality and value. It averages valuation (forward or trailing P/E), profit margin, return on equity, current ratio, and lower debt-to-equity. Higher is better; missing inputs are excluded. It applies only to individual stocks; index, sector, and commodity ETFs such as SPY, QQQ, IWM, and XLK skip this filter.', editor: <ScoreRange label="Quality and value" name="fundamental" filters={filters} setFilter={setFilter} /> },
      { label: 'Stock Score Growth', value: scoreText(filters, 'growth'), help: 'A transparent 1–10 app score based on Yahoo revenue growth, earnings growth, and whether trailing EPS is positive. Higher is better; missing inputs are excluded. It applies only to individual stocks; index, sector, and commodity ETFs skip this filter.', editor: <ScoreRange label="Revenue and earnings growth" name="growth" filters={filters} setFilter={setFilter} /> },
      { label: 'Stock Score Technical', value: scoreText(filters, 'technical'), help: 'A transparent 1–10 app score using price versus the 20-, 50-, and 200-day moving averages, 14-day RSI, and relative strength. Strong trends score well, while overbought RSI readings are penalized. This works for stocks and ETFs.', editor: <ScoreRange label="Trend and relative strength" name="technical" filters={filters} setFilter={setFilter} /> },
    ] },
    { title: 'Technical market conditions', help: 'Filters the broad market and each underlying by trend, recent price movement, lookback period, and RSI.', items: [
      { label: 'Market trend (SPY)', value: fieldText(TREND_FIELD, filters.market_trend), help: 'Classifies the broad market using SPY. Uptrend means price is above its 50-day average and the 50-day is above the 200-day. Downtrend is the reverse; Mixed covers all other arrangements.', editor: <DynamicField field={{ ...TREND_FIELD, label: 'Required SPY trend' }} value={filters.market_trend} onChange={value => setFilter('market_trend', value)} /> },
      { label: 'Stock / ETF trend', value: fieldText(TREND_FIELD, filters.underlying_trend), help: 'Applies the same price/50-day/200-day trend test to each stock or ETF being scanned.', editor: <DynamicField field={{ ...TREND_FIELD, label: 'Required underlying trend' }} value={filters.underlying_trend} onChange={value => setFilter('underlying_trend', value)} /> },
      { label: 'Recent stock / ETF move', value: fieldText(MOVE_FIELD, filters.recent_move_direction), help: 'Choose whether the underlying must have declined or rallied over the selected lookback. Combining Uptrend with Down / pullback finds an established uptrend experiencing a short-term decline.', editor: <DynamicField field={MOVE_FIELD} value={filters.recent_move_direction} onChange={value => setFilter('recent_move_direction', value)} /> },
      { label: 'Move lookback', value: fieldText(LOOKBACK_FIELD, String(filters.recent_move_lookback)), help: 'Number of trading sessions used to measure the recent stock or ETF move. Five sessions is roughly one trading week; 21 is roughly one month.', editor: <DynamicField field={LOOKBACK_FIELD} value={String(filters.recent_move_lookback)} onChange={value => setFilter('recent_move_lookback', Number(value))} /> },
      { label: 'Minimum move', value: `${filters.min_abs_recent_move_pct || 0}%`, help: 'Requires the recent rise or decline to be at least this large. Zero requires only the selected direction; increasing it finds more substantial pullbacks or rallies.', editor: <DynamicField field={{ key: 'min_abs_recent_move_pct', label: 'Minimum absolute move', suffix: '%', step: 0.25, min: 0 }} value={filters.min_abs_recent_move_pct} onChange={value => setFilter('min_abs_recent_move_pct', value)} /> },
      { label: 'RSI range', value: `${filters.technical_rsi_min}–${filters.technical_rsi_max}`, help: 'Limits the 14-day Relative Strength Index. RSI near 30 is commonly considered oversold and near 70 overbought, but the range is fully user-controlled.', editor: <div className="gos-quick-pair"><DynamicField field={{ key: 'technical_rsi_min', label: 'Minimum RSI', step: 1, min: 0, max: 100 }} value={filters.technical_rsi_min} onChange={value => setFilter('technical_rsi_min', Math.min(value, filters.technical_rsi_max))} /><DynamicField field={{ key: 'technical_rsi_max', label: 'Maximum RSI', step: 1, min: 0, max: 100 }} value={filters.technical_rsi_max} onChange={value => setFilter('technical_rsi_max', Math.max(value, filters.technical_rsi_min))} /></div> },
    ] },
    { title: 'Consolidated options data', help: 'Filters the option chain by total trading volume, IV Rank, IV−RV, RV Rank, Volatility score, and skew rank.', items: [
      { label: 'Total Option Volume', value: filters.min_total_option_volume > 0 ? `Above ${Number(filters.min_total_option_volume).toLocaleString()}` : 'Any', help: 'Requires at least this much option-contract volume in the chain or expiration evaluated by the underlying strategy scanner. Higher thresholds favor liquid names but may remove otherwise valid trades.', editor: <DynamicField field={{ key: 'min_total_option_volume', label: 'Minimum volume', step: 500, min: 0 }} value={filters.min_total_option_volume} onChange={value => setFilter('min_total_option_volume', value)} /> },
      { label: 'IV Rank', value: rangeText(filters.min_iv_rank, filters.max_iv_rank), help: 'IV Rank is labelled like Option Samurai’s column, but the calculation is a percentile: the share of prior daily ATM IV prints in the past year that were below today. Front-month (about 21–60 DTE) prints are preferred, one-day spikes are ignored, and it begins populating after 20 observations. High readings (for example above 80) have historically been followed by lower IV, and low readings by higher IV.', editor: <div className="gos-quick-pair"><DynamicField field={{ key: 'min_iv_rank', label: 'Minimum IV Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.min_iv_rank} onChange={value => setFilter('min_iv_rank', Math.min(value, filters.max_iv_rank))} /><DynamicField field={{ key: 'max_iv_rank', label: 'Maximum IV Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.max_iv_rank} onChange={value => setFilter('max_iv_rank', Math.max(value, filters.min_iv_rank))} /></div> },
      { label: 'IV − RV', value: rangeText(filters.min_iv_rv, filters.max_iv_rv, { floor: -100, ceil: 100 }), help: 'Today’s at-the-money implied volatility minus the past month’s realized volatility, in volatility points. A positive value means IV is higher than recent realized vol (options look expensive versus the past). A negative value means options look cheaper than the past month’s realized vol.', editor: <div className="gos-quick-pair"><DynamicField field={{ key: 'min_iv_rv', label: 'Minimum IV − RV', step: 1, min: -100, max: 100 }} value={filters.min_iv_rv} onChange={value => setFilter('min_iv_rv', Math.min(value, filters.max_iv_rv))} /><DynamicField field={{ key: 'max_iv_rv', label: 'Maximum IV − RV', step: 1, min: -100, max: 100 }} value={filters.max_iv_rv} onChange={value => setFilter('max_iv_rv', Math.max(value, filters.min_iv_rv))} /></div> },
      { label: 'IV − RV Rank', value: rangeText(filters.min_iv_rv_rank, filters.max_iv_rv_rank), help: 'A 0–100 percentile of today’s IV − RV versus the same spread over the past year. It is mean-reverting: a high reading has typically been followed by a lower one, and the reverse.', editor: <div className="gos-quick-pair"><DynamicField field={{ key: 'min_iv_rv_rank', label: 'Minimum IV − RV Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.min_iv_rv_rank} onChange={value => setFilter('min_iv_rv_rank', Math.min(value, filters.max_iv_rv_rank))} /><DynamicField field={{ key: 'max_iv_rv_rank', label: 'Maximum IV − RV Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.max_iv_rv_rank} onChange={value => setFilter('max_iv_rv_rank', Math.max(value, filters.min_iv_rv_rank))} /></div> },
      { label: 'RV Rank', value: rangeText(filters.min_rv_rank, filters.max_rv_rank), help: 'A 0–100 percentile of the past month’s realized (historical) volatility versus the previous year. It shows whether recent actual movement is high or low for this name and is also mean-reverting.', editor: <div className="gos-quick-pair"><DynamicField field={{ key: 'min_rv_rank', label: 'Minimum RV Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.min_rv_rank} onChange={value => setFilter('min_rv_rank', Math.min(value, filters.max_rv_rank))} /><DynamicField field={{ key: 'max_rv_rank', label: 'Maximum RV Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.max_rv_rank} onChange={value => setFilter('max_rv_rank', Math.max(value, filters.min_rv_rank))} /></div> },
      { label: 'Volatility score', value: rangeText(filters.min_volatility_score, filters.max_volatility_score), help: 'The average of IV Rank and IV − RV Rank. It is a smoother way to find options that look overpriced (high score) or underpriced (low score).', editor: <div className="gos-quick-pair"><DynamicField field={{ key: 'min_volatility_score', label: 'Minimum Volatility score', step: 5, min: 0, max: 100 }} value={filters.min_volatility_score} onChange={value => setFilter('min_volatility_score', Math.min(value, filters.max_volatility_score))} /><DynamicField field={{ key: 'max_volatility_score', label: 'Maximum Volatility score', step: 5, min: 0, max: 100 }} value={filters.max_volatility_score} onChange={value => setFilter('max_volatility_score', Math.max(value, filters.min_volatility_score))} /></div> },
      { label: 'Skew Rank', value: rangeText(filters.min_skew_rank, filters.max_skew_rank), help: 'Ranks the roughly 30-DTE 25-delta put-IV minus 25-delta call-IV gap against this ticker’s own trailing year. High values mean puts are unusually expensive versus calls; low values mean calls are unusually expensive. Missing history does not hide a trade.', editor: <div className="gos-quick-pair"><DynamicField field={{ key: 'min_skew_rank', label: 'Minimum Skew Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.min_skew_rank} onChange={value => setFilter('min_skew_rank', Math.min(value, filters.max_skew_rank))} /><DynamicField field={{ key: 'max_skew_rank', label: 'Maximum Skew Rank', suffix: '%', step: 5, min: 0, max: 100 }} value={filters.max_skew_rank} onChange={value => setFilter('max_skew_rank', Math.max(value, filters.min_skew_rank))} /></div> },
    ] },
    { title: 'Option data', help: 'Sets the price-fill assumption and primary option-leg delta used to construct each trade.', items: [
      { label: 'Bid/Ask level', value: filters.bid_ask_level || config?.bidAsk || 'Mid', help: 'Controls the quote assumption used to estimate entry price. Conservative uses sell-at-bid and buy-at-ask values; Mid uses midpoint prices; 25% improvement assumes a fill one quarter of the way from the conservative price toward mid.', editor: <DynamicField field={{ key: 'bid_ask_level', label: 'Pricing assumption', type: 'select', options: [['Conservative (use bid/ask values)', 'Conservative (bid/ask)'], ['25% price improvement', '25% price improvement'], ['Mid', 'Mid']] }} value={filters.bid_ask_level} onChange={value => setFilter('bid_ask_level', value)} /> },
      { label: 'Reference option delta', value: filters.reference_delta_mode === 'none' ? 'Construction-specific' : `${filters.reference_delta_mode === 'short' ? 'Short' : 'Long'} ${filters.min_reference_delta}–${filters.max_reference_delta} Δ`, help: 'Controls the absolute delta of the primary risk-defining option. For income and credit trades this is normally the short leg; for directional debit trades it is the long leg. A displayed value of 10 means 0.10 delta. Neutral structures can leave this construction-specific.', editor: <div className="gos-inline-stack"><DynamicField field={{ key: 'reference_delta_mode', label: 'Reference leg', type: 'select', options: [['none', 'Use strategy construction'], ['short', 'Short option'], ['long', 'Long option']] }} value={filters.reference_delta_mode} onChange={value => setFilter('reference_delta_mode', value)} />{filters.reference_delta_mode !== 'none' && <div className="gos-quick-pair"><DynamicField field={{ key: 'min_reference_delta', label: 'Minimum absolute delta', step: 1, min: 1, max: 99 }} value={filters.min_reference_delta} onChange={value => setFilter('min_reference_delta', Math.min(value, filters.max_reference_delta))} /><DynamicField field={{ key: 'max_reference_delta', label: 'Maximum absolute delta', step: 1, min: 1, max: 99 }} value={filters.max_reference_delta} onChange={value => setFilter('max_reference_delta', Math.max(value, filters.min_reference_delta))} /></div>}</div> },
    ] },
    { title: 'Strategy specific', help: 'Defines the selected strategy\'s trade construction, risk and reward requirements, and any strategy-only mechanics.', items: strategyFields.map(item => ({ label: item.label, value: fieldText(item, filters[item.key]), help: helpForGeneralField(item), editor: <DynamicField field={item} value={filters[item.key]} onChange={value => setFilter(item.key, value)} /> })) },
    ]
    if (expirationScenarioSupported) {
      const marginText = expirationScenario.marginRule === 'any'
        ? 'P/L on margin: Any'
        : `P/L on margin: ${expirationScenario.marginRule === 'above' ? '≥' : '≤'} ${expirationScenario.marginPct}%`
      groups.push({
        title: 'Scenarios',
        help: 'Model expiration P/L for the selected call, put, bull put spread, or bear call spread and optionally use P/L on margin as a results filter.',
        items: [{
          label: 'Scenario #1 (Expiry)',
          value: expirationScenarioEnabled ? `${describeExpirationScenario(expirationScenario)} · ${marginText}` : 'Add scenario',
          muted: !expirationScenarioEnabled,
          help: 'Choose a reference price and move. Each row is repriced at expiration using its actual legs and entry prices. At or above / At or below makes P/L on margin a filter; Any displays the scenario without excluding results.',
          editor: <ExpirationScenarioEditor scenario={expirationScenario} enabled={expirationScenarioEnabled} onChange={setExpirationScenario} onToggle={setExpirationScenarioEnabled} />,
        }],
      })
    }
    return groups
  }, [config?.bidAsk, expirationScenario, expirationScenarioEnabled, expirationScenarioSupported, filters, strategy, strategyFields])

  const runScan = async () => {
    if (!strategy) return
    scanRequestRef.current.controller?.abort()
    const requestId = scanRequestRef.current.id + 1
    const controller = new AbortController()
    scanRequestRef.current = { id: requestId, controller }
    setLoading(true); setError(''); setFocusedTicker(null); setSelected(null); setRows([]); setStats(null); setAsOf(null)
    const requestFilters = isIndexOnlyStrategy(strategy)
      ? { ...filters, include_stocks: false, include_index_etfs: true, include_sector_etfs: false, include_commodity_etfs: false }
      : filters
    const strategyFilters = Object.fromEntries(strategyFields.map(field => [field.key, requestFilters[field.key]]))
    try {
      const response = await pf('/api/options/general-scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ strategy, ...requestFilters, strategy_filters: strategyFilters }),
      })
      const body = await response.text()
      if (!body) throw new Error(`The scanner returned no data (${response.status}). Please run it again.`)
      let data
      try {
        data = JSON.parse(body)
      } catch {
        throw new Error(`The scanner returned an unreadable response (${response.status}). Please run it again.`)
      }
      if (!response.ok || data.error) throw new Error(data.error || `Scan failed (${response.status})`)
      const nextRows = (data.rows || []).filter(row => (
        hasScannerTrade(row._general?.trade_kind || strategy, row)
      ))
      if (requestId !== scanRequestRef.current.id) return
      setRows(nextRows); setSelected(nextRows[0] || null); setStats(data.stats || null); setAsOf(data.as_of || null)
    } catch (scanError) {
      if (scanError.name !== 'AbortError' && requestId === scanRequestRef.current.id) {
        setError(scanError.message)
        setRows([])
      }
    } finally {
      if (requestId === scanRequestRef.current.id) {
        scanRequestRef.current.controller = null
        setLoading(false)
      }
    }
  }

  const scenarioResults = useMemo(() => {
    const results = new Map()
    if (!expirationScenarioSupported || !expirationScenarioEnabled) return results
    rows.forEach(row => results.set(row, calculateRowScenario(row, expirationScenario, strategy)))
    return results
  }, [expirationScenario, expirationScenarioEnabled, expirationScenarioSupported, rows, strategy])

  const scenarioFilteredRows = useMemo(() => (
    !expirationScenarioSupported || !expirationScenarioEnabled
      ? rows
      : rows.filter(row => expirationScenarioPasses(scenarioResults.get(row), expirationScenario))
  ), [expirationScenario, expirationScenarioEnabled, expirationScenarioSupported, rows, scenarioResults])

  const displayedRows = useMemo(() => {
    if (focusedTicker) return scenarioFilteredRows.filter(row => row._general?.ticker === focusedTicker)
    const seen = new Set()
    return scenarioFilteredRows.filter(row => {
      const ticker = row._general?.ticker
      if (!ticker || seen.has(ticker)) return false
      seen.add(ticker)
      return true
    })
  }, [scenarioFilteredRows, focusedTicker])
  const visibleSelected = displayedRows.includes(selected) ? selected : displayedRows[0] || null

  const rejectionSummary = useMemo(() => Object.entries(stats?.filter_rejections || {})
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 4), [stats])
  const scanCompleted = Boolean(stats || asOf)

  return <main className="page gos-page">
    <header className="gos-page-header">
      <div><span>Inspired by <a href="https://optionsamurai.com/" target="_blank" rel="noreferrer">Option Samurai</a> · powered by the app’s existing scanners</span><h1>General Option Scanner</h1><p>Filter the market once, compare the best structure for each ticker, then drill into every candidate and model its payoff.</p></div>
      <div className="gos-header-actions">
        <span className="gos-unified-note">One unified interface for every supported strategy</span>
        <div className="gos-header-help-links">
          <Link to="/general-option-scanner/help">Scanner guide</Link>
          <Link to="/general-option-scanner/strategies">Every strategy&apos;s inputs</Link>
        </div>
      </div>
    </header>

    <div className="scanner-filter-workspace">
      <CompactScannerFilterPanel title={scanner?.label || 'Choose a scan'} strategyControl={strategyPicker} groups={summaryGroups} onRun={runScan} loading={loading} disabled={!strategy} toolbar={strategy && (
        <div className="gos-preset-bar">
          <span>Starting point</span>
          <button type="button" className={filters.risk_profile === 'open' ? 'active' : ''} onClick={() => replaceFilters(defaultsForGeneralStrategy(strategy))} title="Use broad discovery filters while retaining this trade's construction rules">Open Filters</button>
          <button type="button" className={filters.risk_profile === 'risk_averse' ? 'active' : ''} onClick={() => replaceFilters(riskProfileDefaultsForGeneralStrategy(strategy, 'risk_averse'))} title="Higher-quality, tighter-liquidity setup. Short-premium trades target 5–15 delta.">Risk Averse</button>
          <button type="button" className={filters.risk_profile === 'moderate' ? 'active' : ''} onClick={() => replaceFilters(riskProfileDefaultsForGeneralStrategy(strategy, 'moderate'))} title="Balanced setup. Short-premium trades target 15–20 delta.">Moderate</button>
          <button type="button" className={filters.risk_profile === 'aggressive' ? 'active' : ''} onClick={() => replaceFilters(riskProfileDefaultsForGeneralStrategy(strategy, 'aggressive'))} title="Broader, higher-risk setup. Short-premium trades target 30–50 delta.">Aggressive</button>
          {setupsForGeneralStrategy(strategy).length > 0 && (
            <>
              <span>Setup</span>
              {setupsForGeneralStrategy(strategy).map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  className={filters.risk_profile === preset.key ? 'active' : ''}
                  title={preset.title}
                  onClick={() => replaceFilters(setupDefaultsForGeneralStrategy(strategy, preset.key))}
                >
                  {preset.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}>
        <p className="csf-single-source-note">{strategy ? 'Changing strategy replaces these values with that trade’s construction rules and defaults. Click any green value to edit it; there is no second set of conflicting inputs.' : 'Choose a strategy above. Its construction rules, filters, probability analysis, and payoff graph will load here.'}</p>
      </CompactScannerFilterPanel>

      <section className="scanner-filter-results gos-results">
        <div className="gos-results-toolbar">
          <div>{focusedTicker ? <button className="btn btn-xs btn-outline" onClick={() => setFocusedTicker(null)}>← All tickers</button> : <strong>Best structure per ticker</strong>}<span>{focusedTicker ? `${displayedRows.length} ${focusedTicker} candidates` : `${displayedRows.length} tickers`}</span></div>
          <small>{asOf ? `As of ${new Date(asOf).toLocaleString()}` : 'Run the scan to load current Yahoo chains'}</small>
        </div>
        {error && <div className="error-message">{error}</div>}
        {!loading && !error && !rows.length && <div className="gos-empty"><strong>{!strategy ? 'Choose a strategy from the dropdown' : scanCompleted ? (Number(stats?.unpriced_dropped) && !Number(stats?.candidates_evaluated) ? 'No listed option contracts were found' : 'No candidates met every active filter') : 'Run the scan to find candidates'}</strong><span>{scanCompleted
          ? `${Number(stats?.candidates_evaluated || 0).toLocaleString()} candidate structures were evaluated${Number(stats?.unpriced_dropped) ? `, and ${Number(stats.unpriced_dropped).toLocaleString()} names without a listed contract were omitted` : ''}. ${rejectionSummary.length ? `Most common blockers: ${rejectionSummary.map(([reason, count]) => `${reason} (${count})`).join(', ')}.` : 'The selected universe did not produce a constructible trade.'} Click the relevant green values to loosen only the rules you want to change.`
          : 'Each selected result includes probability of profit and loss, expected value, maximum profit and loss, plus the interactive price/P&L graph.'}</span></div>}
        {loading && <div className="gos-empty"><strong>Scanning current option chains…</strong><span>Pricing listed contracts and expirations against your filters. Broader stock and ETF universes take longer to evaluate.</span></div>}
        {!loading && !error && stats?.showing_near_matches && <div className="gos-near-match-note"><strong>No exact preset match today; showing the best priced trades.</strong><span>These are constructible near matches, not trades that passed every rule. Each row shows how many rules it missed; select it to see the exact rules above the analysis.</span></div>}
        {!loading && !error && rows.length > 0 && displayedRows.length === 0 && expirationScenarioEnabled && <div className="gos-empty gos-scenario-empty"><strong>No trades passed Scenario #1</strong><span>Change the P/L on margin threshold, choose Any to keep all results, or remove the scenario.</span></div>}
        {!loading && displayedRows.length > 0 && <ResultTable rows={displayedRows} focusedTicker={focusedTicker} setFocusedTicker={setFocusedTicker} selected={visibleSelected} setSelected={setSelected} strategy={strategy} scenario={expirationScenarioEnabled && expirationScenarioSupported ? expirationScenario : null} scenarioResults={scenarioResults} />}
        {stats && <div className="gos-stats"><span>{stats.showing_near_matches ? `${stats.near_matches_returned || rows.length} near-match structures shown` : `${stats.general_results ?? rows.length} matching structures`}</span><span>{stats.chains_fetched ?? stats.expirations_priced ?? '—'} chains / expirations priced</span></div>}
        <GeneralScannerAnalysis row={visibleSelected} strategyLabel={scanner?.label || strategy} />
      </section>
    </div>
  </main>
}

export default function GeneralOptionScanner() {
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('strategy')
  const initialStrategy = GENERAL_STRATEGY_CONFIG[requested] ? requested : ''
  return <GeneralOptionScannerWorkspace key={initialStrategy || 'choose'} initialStrategy={initialStrategy} />
}
