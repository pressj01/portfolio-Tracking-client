import React, { useState, useEffect } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { useCurrency } from '../context/CurrencyContext'
import { useAdviceNoticeVisibility } from '../components/NotFinancialAdviceNotice'
import {
  loadGradingPreferences,
  resetGradingPreferences,
  saveGradingPreferences,
} from '../utils/gradingPreferences'
import { gradingPreferenceHelp } from '../utils/gradingPreferenceHelp'

function FormulaNumberField({ label, value, onChange, help, min = 0, max = 100, step = 1, suffix = '' }) {
  return (
    <div className="formula-number-field">
      <label>
        <span className="formula-number-label">{label}</span>
        <span className="formula-number-control">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={event => onChange(Number(event.target.value))}
          />
          {suffix && <small>{suffix}</small>}
        </span>
      </label>
      <details className="formula-input-help">
        <summary>What this input changes</summary>
        <p>{help}</p>
      </details>
    </div>
  )
}

function FormulaFieldGrid({ children }) {
  return (
    <div className="formula-field-grid">
      {children}
    </div>
  )
}

const FORMULA_SCREENSHOTS = [
  { file: 'grading-risk-weights.png', title: 'Holding risk weights', caption: 'Ulcer Index through downside capture—the inputs that build each holding risk grade.' },
  { file: 'grading-risk-weights-2.png', title: 'Portfolio and NAV weights', caption: 'Portfolio-only weights, NAV Health scoring, and an expanded example of the detailed help.' },
  { file: 'grading-scoring-bands-1.png', title: 'Calmar and Omega bands', caption: 'The first higher-is-better scoring thresholds.' },
  { file: 'grading-scoring-bands-middle.png', title: 'Sortino, Sharpe, and diversification bands', caption: 'The middle higher-is-better thresholds, including an open field explanation.' },
  { file: 'grading-scoring-bands-2.png', title: 'Diversification and Ulcer Index bands', caption: 'The transition from higher-is-better to lower-is-better scoring.' },
  { file: 'grading-scoring-bands-3.png', title: 'Drawdown and downside-capture bands', caption: 'The remaining lower-is-better risk thresholds.' },
  { file: 'grading-letter-cutoffs.png', title: 'Letter-grade cutoffs: A through C', caption: 'The upper letter boundaries applied after the numeric risk score is calculated.' },
  { file: 'grading-letter-cutoffs-2.png', title: 'Letter-grade cutoffs: B through D−', caption: 'The lower grade boundaries and the rule that sends scores below D− to F.' },
  { file: 'grading-fund-verdicts.png', title: 'ETF, CEF, and option-income verdicts', caption: 'Composite-score and failed-criterion limits for Strong reading, Partial reading, and Low reading.' },
  { file: 'grading-stock-weights.png', title: 'Stock blend and group weights', caption: 'Fundamental-versus-technical influence and the first stock criterion weights.' },
  { file: 'grading-stock-weights-2.png', title: 'Remaining stock criterion weights', caption: 'Trend, momentum, oscillators, and volume/range influence, with a help example open.' },
  { file: 'grading-fundamental-formula.png', title: 'Sector-comparison boundaries', caption: 'Benchmark multiples that classify lower-is-better and higher-is-better fundamentals.' },
  { file: 'grading-fundamental-formula-2.png', title: 'Sector-comparison point values', caption: 'The points awarded after a fundamental metric lands in one of the comparison bands.' },
  { file: 'grading-stock-technicals.png', title: 'Stock technical thresholds and points', caption: 'Trend, RSI, stochastic, OBV, and the point value assigned to each signal state.' },
  { file: 'grading-range-badges-verdicts.png', title: '52-week range and badge inputs', caption: 'Range-position boundaries, range points, and the beginning of the badge/verdict cutoffs.' },
  { file: 'grading-range-badges-verdicts-2.png', title: 'Stock verdict cutoffs', caption: 'Pass/warn badges and the Strong reading, Favorable reading, and Mixed reading score boundaries.' },
  { file: 'grading-signal-dashboard.png', title: 'Signal Dashboard thresholds', caption: 'AO, RSI, SMA, vote-share, and NAV classification inputs.' },
  { file: 'grading-signal-dashboard-2.png', title: 'Signal Dashboard vote weights', caption: 'Relative vote weights used to turn the active signals into the Overall result.' },
]

export default function Settings() {
  const pf = useProfileFetch()
  const { selection, currentProfileName, isAggregate } = useProfile()
  const { theme, setTheme, isDark } = useTheme()
  const { displayCurrency, usdToCadRate, rateAsOf, rateInfo, loading: currencyLoading, setDisplayCurrency, refreshCadRate, setCadManualRate } = useCurrency()
  const [adviceNoticesVisible, setAdviceNoticesVisible] = useAdviceNoticeVisibility()
  const [stats, setStats] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [currencySaving, setCurrencySaving] = useState(false)
  const [currencyStatus, setCurrencyStatus] = useState(null)
  const [rateBusy, setRateBusy] = useState(false)
  const [manualRateInput, setManualRateInput] = useState('')
  const [gradingPreferences, setGradingPreferences] = useState(loadGradingPreferences)
  const [gradingStatus, setGradingStatus] = useState(null)

  // Tax-loss harvesting rates
  const [taxRates, setTaxRates] = useState({ short: '32', long: '15', state: '0' })
  const [taxStatus, setTaxStatus] = useState(null)
  const [taxSaving, setTaxSaving] = useState(false)

  // Single-stock ETF state
  const [builtinEtfs, setBuiltinEtfs] = useState([])
  const [userEtfs, setUserEtfs] = useState([])
  const [etfInput, setEtfInput] = useState('')
  const [etfStatus, setEtfStatus] = useState(null)
  const [etfSaving, setEtfSaving] = useState(false)
  const [navOverrides, setNavOverrides] = useState({})
  const [navTicker, setNavTicker] = useState('')
  const [navBenchmark, setNavBenchmark] = useState('')
  const [navStatus, setNavStatus] = useState(null)
  const [navSaving, setNavSaving] = useState(false)

  // Price reuse (fewer Yahoo requests, slightly older prices)
  const [priceReuse, setPriceReuse] = useState({ enabled: false, ttl_sec: 600, requests_avoided: 0, entries: 0 })
  const [priceReuseBusy, setPriceReuseBusy] = useState(false)
  const [priceReuseStatus, setPriceReuseStatus] = useState(null)

  // Optional Tiingo-first market data. A saved key alone never enables it.
  const [marketProvider, setMarketProvider] = useState({
    requested: false, enabled: false, key_configured: false, key_valid: false,
    masked_key: null, runtime: {},
  })
  const [useTiingo, setUseTiingo] = useState(false)
  const [tiingoKey, setTiingoKey] = useState('')
  const [providerBusy, setProviderBusy] = useState(false)
  const [providerStatus, setProviderStatus] = useState(null)

  // Broker -> Yahoo symbol mapping
  const [symbolMap, setSymbolMap] = useState([])
  const [symbolStatus, setSymbolStatus] = useState(null)
  const [symbolBusy, setSymbolBusy] = useState(false)
  const [symbolScanning, setSymbolScanning] = useState(false)
  const [symbolBroker, setSymbolBroker] = useState('')
  const [symbolYahoo, setSymbolYahoo] = useState('')

  // Backup management
  const [backups, setBackups] = useState([])
  const [backupDir, setBackupDir] = useState('')
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupStatus, setBackupStatus] = useState(null)
  const [deletingBackup, setDeletingBackup] = useState(null)

  const navBenchmarkChoices = [
    'SPY', 'QQQ', 'IWM', 'DIA', 'EFA', 'EEM',
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'BTC-USD+GLD', 'SPY+BTC-USD',
    'GLD', 'SLV', 'CPER', 'AMLP', 'PFF',
    'BIL', 'BND', 'TLT', 'NLR', 'ITA',
    'XLE', 'SOXX', 'XLF', 'XLV', 'XLU', 'VNQ',
  ]

  const fetchPriceReuse = () => {
    pf('/api/market-feed/price-reuse')
      .then(r => r.json())
      .then(d => { if (d && d.ok) setPriceReuse(d) })
      .catch(() => {})
  }

  const savePriceReuse = (enabled, ttlMinutes) => {
    setPriceReuseBusy(true)
    setPriceReuseStatus(null)
    const minutes = ttlMinutes ?? Math.round((priceReuse.ttl_sec || 600) / 60)
    pf('/api/market-feed/price-reuse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, ttl_minutes: minutes }),
    })
      .then(r => r.json())
      .then(d => {
        if (d && d.ok) {
          setPriceReuse(d)
          setPriceReuseStatus({
            type: 'success',
            msg: enabled
              ? `Prices downloaded in the last ${minutes} minute${minutes === 1 ? '' : 's'} will be reused.`
              : 'Every screen will download live prices from now on.',
          })
        } else {
          setPriceReuseStatus({ type: 'error', msg: 'Could not save that setting.' })
        }
      })
      .catch(() => setPriceReuseStatus({ type: 'error', msg: 'Could not save that setting.' }))
      .finally(() => setPriceReuseBusy(false))
  }

  const clearPriceCache = () => {
    setPriceReuseBusy(true)
    pf('/api/market-feed/clear-price-cache', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d && d.ok) setPriceReuse(d)
        setPriceReuseStatus({ type: 'info', msg: 'Cleared. The next screen you open downloads fresh prices.' })
      })
      .catch(() => setPriceReuseStatus({ type: 'error', msg: 'Could not clear the reused prices.' }))
      .finally(() => setPriceReuseBusy(false))
  }

  const applyMarketProviderResponse = (data) => {
    if (!data || data.error) return
    setMarketProvider(data)
    setUseTiingo(Boolean(data.requested))
  }

  const fetchMarketProvider = () => {
    pf('/api/market-feed/provider')
      .then(r => r.json())
      .then(applyMarketProviderResponse)
      .catch(() => {})
  }

  const testTiingoKey = async () => {
    if (!tiingoKey.trim() && !marketProvider.key_configured) {
      setProviderStatus({ type: 'error', msg: 'Enter a Tiingo API key first.' })
      return
    }
    setProviderBusy(true)
    setProviderStatus(null)
    try {
      const response = await pf('/api/market-feed/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          use_tiingo: true,
          tiingo_api_key: tiingoKey.trim() || undefined,
          test_only: true,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Tiingo did not accept that key.')
      setProviderStatus({ type: 'success', msg: 'Tiingo accepted the API key.' })
    } catch (error) {
      setProviderStatus({ type: 'error', msg: error.message })
    } finally {
      setProviderBusy(false)
    }
  }

  const saveMarketProvider = async () => {
    if (useTiingo && !tiingoKey.trim() && !marketProvider.key_configured) {
      setProviderStatus({ type: 'error', msg: 'Enter a valid Tiingo API key before enabling Tiingo.' })
      return
    }
    setProviderBusy(true)
    setProviderStatus(null)
    try {
      const response = await pf('/api/market-feed/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          use_tiingo: useTiingo,
          tiingo_api_key: tiingoKey.trim() || undefined,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not save the market-data provider.')
      applyMarketProviderResponse(data)
      setTiingoKey('')
      setProviderStatus({
        type: 'success',
        msg: data.enabled
          ? 'Tiingo is now preferred. Yahoo will fill unsupported, quota-limited, or unavailable data.'
          : 'Tiingo is off. Non-option market data will use Yahoo.',
      })
    } catch (error) {
      setProviderStatus({ type: 'error', msg: error.message })
    } finally {
      setProviderBusy(false)
    }
  }

  const clearTiingoKey = async () => {
    setProviderBusy(true)
    setProviderStatus(null)
    try {
      const response = await pf('/api/market-feed/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ use_tiingo: false, clear_key: true }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not remove the Tiingo key.')
      applyMarketProviderResponse(data)
      setTiingoKey('')
      setProviderStatus({ type: 'success', msg: 'The Tiingo key was removed and Yahoo is active.' })
    } catch (error) {
      setProviderStatus({ type: 'error', msg: error.message })
    } finally {
      setProviderBusy(false)
    }
  }

  const fetchSymbolMap = () => {
    pf('/api/symbol-map')
      .then(r => r.json())
      .then(d => setSymbolMap(Array.isArray(d?.mappings) ? d.mappings : []))
      .catch(() => setSymbolMap([]))
  }

  const handleScanSymbols = () => {
    setSymbolScanning(true)
    setSymbolStatus({ type: 'info', msg: 'Checking every holding against Yahoo. This takes a minute.' })
    pf('/api/symbol-map/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => {
        const found = (d?.resolved || []).length
        const stuck = d?.unresolved || []
        setSymbolStatus({
          type: found ? 'success' : 'info',
          msg: found
            ? `Matched ${found} symbol${found === 1 ? '' : 's'}.`
              + (stuck.length ? ` No Yahoo listing for ${stuck.join(', ')}.` : '')
            : stuck.length
              ? `No Yahoo listing found for ${stuck.join(', ')}.`
              : 'Every holding already prices under its own symbol.',
        })
        fetchSymbolMap()
      })
      .catch(() => setSymbolStatus({ type: 'error', msg: 'Symbol scan failed.' }))
      .finally(() => setSymbolScanning(false))
  }

  const handleSaveSymbol = () => {
    const broker = symbolBroker.trim().toUpperCase()
    const yahoo = symbolYahoo.trim().toUpperCase()
    if (!broker || !yahoo) return
    setSymbolBusy(true)
    pf('/api/symbol-map', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broker_symbol: broker, yahoo_symbol: yahoo }),
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d?.error || 'Could not save that mapping')
        setSymbolStatus({ type: 'success', msg: `${broker} will be priced as ${yahoo}.` })
        setSymbolBroker('')
        setSymbolYahoo('')
        fetchSymbolMap()
      })
      .catch(e => setSymbolStatus({ type: 'error', msg: e.message }))
      .finally(() => setSymbolBusy(false))
  }

  const handleRemoveSymbol = (broker) => {
    setSymbolBusy(true)
    pf(`/api/symbol-map/${encodeURIComponent(broker)}`, { method: 'DELETE' })
      .then(() => {
        setSymbolStatus({ type: 'success', msg: `${broker} will be asked for exactly as your broker writes it.` })
        fetchSymbolMap()
      })
      .catch(() => setSymbolStatus({ type: 'error', msg: `Could not remove ${broker}.` }))
      .finally(() => setSymbolBusy(false))
  }

  const fetchStats = () => {
    pf('/api/data/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats(null))
  }

  const fetchSingleStockEtfs = () => {
    pf('/api/single-stock-etfs')
      .then(r => r.json())
      .then(data => {
        setBuiltinEtfs(data.builtin || [])
        setUserEtfs(data.user_added || [])
      })
      .catch(() => {})
  }

  const fetchNavBenchmarkOverrides = () => {
    pf('/api/settings')
      .then(r => r.json())
      .then(data => {
        try {
          const parsed = data.nav_benchmark_overrides ? JSON.parse(data.nav_benchmark_overrides) : {}
          setNavOverrides(parsed && typeof parsed === 'object' ? parsed : {})
        } catch {
          setNavOverrides({})
        }
        // Tax rates ride on the same settings endpoint. Stored as fractions (e.g. 0.32);
        // displayed as percentages.
        const toPct = (v, fallback) => {
          const n = Number(v)
          if (!Number.isFinite(n)) return fallback
          return String(+(n * 100).toFixed(2))
        }
        setTaxRates({
          short: toPct(data.tax_short_term_rate, '32'),
          long: toPct(data.tax_long_term_rate, '15'),
          state: toPct(data.tax_state_rate, '0'),
        })
      })
      .catch(() => {})
  }

  const saveDisplayCurrency = async (currency) => {
    if (currency !== 'USD' && currency !== 'CAD') return
    setCurrencySaving(true)
    setCurrencyStatus(null)
    try {
      await setDisplayCurrency(currency)
      setCurrencyStatus({ type: 'success', msg: `Display currency saved as ${currency}.` })
    } catch (e) {
      setCurrencyStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setCurrencySaving(false)
  }

  useEffect(() => {
    setManualRateInput(rateInfo.manualRate ? String(rateInfo.manualRate) : '')
  }, [rateInfo.manualRate])

  const refreshExchangeRate = async () => {
    setRateBusy(true)
    setCurrencyStatus(null)
    try {
      const result = await refreshCadRate()
      setCurrencyStatus({ type: 'success', msg: `Live USD/CAD rate refreshed to ${result.info.liveRate?.toFixed(4) || result.rate.toFixed(4)}.` })
    } catch (e) {
      setCurrencyStatus({ type: 'error', msg: e.message })
    } finally {
      setRateBusy(false)
    }
  }

  const saveManualExchangeRate = async () => {
    const rate = Number(manualRateInput)
    if (!Number.isFinite(rate) || rate <= 0) {
      setCurrencyStatus({ type: 'error', msg: 'Enter a valid USD/CAD rate.' })
      return
    }
    setRateBusy(true)
    setCurrencyStatus(null)
    try {
      await setCadManualRate(rate)
      setCurrencyStatus({ type: 'success', msg: `Manual USD/CAD rate saved at ${rate.toFixed(4)}.` })
    } catch (e) {
      setCurrencyStatus({ type: 'error', msg: e.message })
    } finally {
      setRateBusy(false)
    }
  }

  const clearManualExchangeRate = async () => {
    setRateBusy(true)
    setCurrencyStatus(null)
    try {
      const result = await setCadManualRate(null)
      setManualRateInput('')
      setCurrencyStatus({ type: 'success', msg: `Manual override cleared. Using live rate ${result.rate.toFixed(4)}.` })
    } catch (e) {
      setCurrencyStatus({ type: 'error', msg: e.message })
    } finally {
      setRateBusy(false)
    }
  }

  const updatedLabel = rateInfo.updatedAt
    ? new Date(rateInfo.updatedAt).toLocaleString()
    : 'Not available'

  const saveTaxRates = async () => {
    setTaxSaving(true)
    setTaxStatus(null)
    const toFrac = (v) => {
      const n = parseFloat(v)
      return Number.isFinite(n) ? (n / 100).toString() : '0'
    }
    try {
      const res = await pf('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tax_short_term_rate: toFrac(taxRates.short),
          tax_long_term_rate: toFrac(taxRates.long),
          tax_state_rate: toFrac(taxRates.state),
        }),
      })
      if (res.ok) {
        setTaxStatus({ type: 'success', msg: 'Saved tax rates.' })
      } else {
        setTaxStatus({ type: 'error', msg: 'Failed to save tax rates.' })
      }
    } catch (e) {
      setTaxStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setTaxSaving(false)
  }

  const fetchBackups = () => {
    setBackupLoading(true)
    fetch('/api/backups')
      .then(r => r.json())
      .then(data => {
        setBackups(data.backups || [])
        setBackupDir(data.directory || '')
      })
      .catch(() => {})
      .finally(() => setBackupLoading(false))
  }

  const deleteBackup = (filename) => {
    setDeletingBackup(filename)
    setBackupStatus(null)
    fetch(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setBackupStatus({ type: 'error', msg: d.error })
        } else {
          setBackupStatus({ type: 'success', msg: d.message })
          fetchBackups()
        }
      })
      .catch(() => setBackupStatus({ type: 'error', msg: 'Delete failed.' }))
      .finally(() => setDeletingBackup(null))
  }

  useEffect(() => { fetchStats(); fetchSingleStockEtfs(); fetchNavBenchmarkOverrides(); fetchBackups(); fetchSymbolMap(); fetchPriceReuse(); fetchMarketProvider() }, [selection])

  const handleClearAll = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const res = await pf('/api/data/clear-all', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setStatus({ type: 'success', msg: 'All data cleared successfully.' })
        fetchStats()
      } else {
        setStatus({ type: 'error', msg: data.error || 'Failed to clear data.' })
      }
    } catch (e) {
      setStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setLoading(false)
    setConfirming(false)
  }

  const handleAddEtf = async () => {
    const newTickers = etfInput.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    if (!newTickers.length) return
    const merged = [...new Set([...userEtfs, ...newTickers])]
    setEtfSaving(true)
    setEtfStatus(null)
    try {
      const res = await pf('/api/single-stock-etfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: merged }),
      })
      if (res.ok) {
        const data = await res.json()
        setUserEtfs(data.user_added || merged)
        setEtfInput('')
        setEtfStatus({ type: 'success', msg: `Added ${newTickers.join(', ')}` })
      } else {
        setEtfStatus({ type: 'error', msg: 'Failed to save.' })
      }
    } catch (e) {
      setEtfStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setEtfSaving(false)
  }

  const handleRemoveEtf = async (ticker) => {
    const updated = userEtfs.filter(t => t !== ticker)
    setEtfSaving(true)
    setEtfStatus(null)
    try {
      const res = await pf('/api/single-stock-etfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: updated }),
      })
      if (res.ok) {
        const data = await res.json()
        setUserEtfs(data.user_added || updated)
        setEtfStatus({ type: 'success', msg: `Removed ${ticker}` })
      }
    } catch (e) {
      setEtfStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setEtfSaving(false)
  }

  const saveNavBenchmarkOverrides = async (next, successMsg) => {
    setNavSaving(true)
    setNavStatus(null)
    try {
      const res = await pf('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nav_benchmark_overrides: JSON.stringify(next) }),
      })
      if (res.ok) {
        setNavOverrides(next)
        setNavStatus({ type: 'success', msg: successMsg })
      } else {
        setNavStatus({ type: 'error', msg: 'Failed to save benchmark override.' })
      }
    } catch (e) {
      setNavStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setNavSaving(false)
  }

  const handleAddNavOverride = () => {
    const ticker = navTicker.trim().toUpperCase()
    const benchmark = navBenchmark.trim().toUpperCase()
    if (!ticker || !benchmark) return
    const next = { ...navOverrides, [ticker]: benchmark }
    saveNavBenchmarkOverrides(next, `${ticker} will benchmark against ${benchmark}`)
    setNavTicker('')
    setNavBenchmark('')
  }

  const handleRemoveNavOverride = (ticker) => {
    const next = { ...navOverrides }
    delete next[ticker]
    saveNavBenchmarkOverrides(next, `Removed ${ticker} benchmark override`)
  }

  const tagStyle = (removable) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: isDark
      ? (removable ? '#1a3a4a' : '#1a2a3a')
      : (removable ? '#dbeeff' : '#eef2f6'),
    color: isDark
      ? (removable ? '#7ecfff' : '#8899aa')
      : (removable ? '#1565c0' : '#546e7a'),
    borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem', margin: 2,
    border: isDark
      ? (removable ? '1px solid #2a5a6a' : '1px solid #2a3a4a')
      : (removable ? '1px solid #90caf9' : '1px solid #b0bec5'),
  })

  const updateGradingPreference = (section, group, key, value) => {
    setGradingPreferences(current => ({
      ...current,
      [section]: {
        ...current[section],
        [group]: { ...current[section][group], [key]: value },
      },
    }))
    setGradingStatus(null)
  }

  const updateNestedGradingPreference = (section, group, subgroup, key, value) => {
    setGradingPreferences(current => ({
      ...current,
      [section]: {
        ...current[section],
        [group]: {
          ...current[section][group],
          [subgroup]: { ...current[section][group][subgroup], [key]: value },
        },
      },
    }))
    setGradingStatus(null)
  }

  const saveFormulaSettings = () => {
    const portfolioRisk = gradingPreferences.portfolioRisk
    const fundVerdicts = gradingPreferences.fundVerdicts
    const stock = gradingPreferences.stock
    const signals = gradingPreferences.signals
    const increasing = values => values.every((value, index) => index === 0 || value >= values[index - 1])
    const decreasing = values => values.every((value, index) => index === 0 || value <= values[index - 1])
    const valid = (
      decreasing(Object.values(portfolioRisk.letterCutoffs))
      && Object.values(portfolioRisk.holdingWeights).some(weight => weight > 0)
      && Object.values(portfolioRisk.portfolioWeights).some(weight => weight > 0)
      && Object.values(portfolioRisk.higherBands).every(bands => decreasing(Object.values(bands)))
      && Object.values(portfolioRisk.lowerBands).every(bands => increasing(Object.values(bands)))
      && fundVerdicts.strongScore > fundVerdicts.moderateScore
      && fundVerdicts.strongMaxFails <= fundVerdicts.moderateMaxFails
      && stock.blendWeights.fundamental + stock.blendWeights.technical > 0
      && Object.values(stock.groupWeights).some(weight => weight > 0)
      && stock.badgeBands.pass > stock.badgeBands.warn
      && stock.technicalThresholds.rsiBuyBelow < stock.technicalThresholds.rsiSellAbove
      && stock.technicalThresholds.stochasticBuyBelow < stock.technicalThresholds.stochasticSellAbove
      && increasing(Object.values(stock.rangeBands))
      && increasing([
        stock.fundamentalBands.lowerExcellent,
        stock.fundamentalBands.lowerGood,
        stock.fundamentalBands.lowerFair,
        stock.fundamentalBands.lowerWeak,
      ])
      && decreasing([
        stock.fundamentalBands.higherExcellent,
        stock.fundamentalBands.higherGood,
        stock.fundamentalBands.higherFair,
        stock.fundamentalBands.higherWeak,
      ])
      && decreasing([
        stock.verdictBands.strongBuy,
        stock.verdictBands.buy,
        stock.verdictBands.hold,
      ])
      && signals.thresholds.rsiBuyBelow < signals.thresholds.rsiSellAbove
      && signals.thresholds.navBuyMaxRatio < signals.thresholds.navSellAboveRatio
      && Object.values(signals.weights).some(weight => weight > 0)
    )
    if (!valid) {
      setGradingStatus({ type: 'error', msg: 'Some formula bands overlap or are out of order. Check the values and try again.' })
      return
    }
    const saved = saveGradingPreferences(gradingPreferences)
    setGradingPreferences(saved)
    setGradingStatus({ type: 'success', msg: 'Grading and signal formulas saved on this device.' })
  }

  const resetFormulaSettings = () => {
    setGradingPreferences(resetGradingPreferences())
    setGradingStatus({ type: 'success', msg: 'Grading and signal formulas reset to the application defaults.' })
  }

  const stockFormula = gradingPreferences.stock
  const signalFormula = gradingPreferences.signals
  const portfolioRiskFormula = gradingPreferences.portfolioRisk
  const fundVerdictFormula = gradingPreferences.fundVerdicts

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h1>Settings</h1>

      {/* Appearance */}
      <div className="card">
        <h2>Appearance</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Choose a light or dark color theme. Your choice is saved on this device.
        </p>
        <div className="theme-toggle" role="group" aria-label="Color theme">
          <button
            type="button"
            className={`theme-toggle-btn${theme === 'dark' ? ' active' : ''}`}
            onClick={() => setTheme('dark')}
            aria-pressed={theme === 'dark'}
          >
            🌙 Dark
          </button>
          <button
            type="button"
            className={`theme-toggle-btn${theme === 'light' ? ' active' : ''}`}
            onClick={() => setTheme('light')}
            aria-pressed={theme === 'light'}
          >
            ☀️ Light
          </button>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', marginTop: '1rem', paddingTop: '0.9rem' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={adviceNoticesVisible}
              onChange={event => setAdviceNoticesVisible(event.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong style={{ color: 'var(--text-strong)' }}>Show educational notice boxes</strong>
              <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: 3 }}>
                Close either notice with its × button to hide both across the app. This setting restores them whenever you want to read them again.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Grading and signal formulas */}
      <div className="card" id="grading-formulas">
        <h2>Grading &amp; Signal Formulas</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          These are the exact user-controlled inputs behind portfolio, holding, stock, fund, and market-signal grades.
          Weights are relative: a weight of 2 counts twice as much as a weight of 1, and 0 excludes that item.
          ETF and CEF criterion thresholds remain editable directly on their evaluator cards; their final grade bands are below.
        </p>
        <p className="formula-help-intro">
          Every input is labeled by its role. Open <strong>What this input changes</strong> beneath any value for a detailed definition,
          where the setting is used, and what increasing or decreasing it will do. Changes do not take effect until you select
          <strong> Save grading formulas</strong>.
        </p>
        <details className="formula-screenshot-guide">
          <summary>Screenshot guide: find and identify every formula input</summary>
          <p>
            The screenshots follow the groups below in screen order. Each input is labeled with the exact name used on this page;
            select an image to open it at full size, then use the matching <strong>What this input changes</strong> row for the complete explanation.
          </p>
          <div className="formula-screenshot-grid">
            {FORMULA_SCREENSHOTS.map(item => {
              const src = `./help-screenshots/settings/${item.file}`
              return (
                <figure key={item.file}>
                  <a href={src} target="_blank" rel="noreferrer" aria-label={`Open full-size screenshot: ${item.title}`}>
                    <img src={src} alt={`${item.title} settings with every input labeled`} loading="lazy" />
                  </a>
                  <figcaption><strong>{item.title}</strong><span>{item.caption}</span></figcaption>
                </figure>
              )
            })}
          </div>
        </details>
        {gradingStatus && (
          <div className={`alert alert-${gradingStatus.type}`} style={{ marginBottom: '0.75rem' }}>{gradingStatus.msg}</div>
        )}

        <details open style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>Portfolio and holding risk-grade weights</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            Each available metric receives a 0–100 score from the bands below. Holding and portfolio grades use separate relative weights. NAV Health is included in a portfolio only when NAV erosion data is available.
          </p>
          <h4 style={{ marginBottom: 0 }}>Holding weights</h4>
          <FormulaFieldGrid>
            {Object.entries({ ulcerIndex: 'Ulcer Index', calmar: 'Calmar', omega: 'Omega', sortino: 'Sortino', sharpe: 'Sharpe', maxDrawdown: 'Max drawdown', downCapture: 'Downside capture' }).map(([key, label]) => (
              <FormulaNumberField key={key} label={`${label} weight`} help={gradingPreferenceHelp('portfolioRisk', 'holdingWeights', key)} value={portfolioRiskFormula.holdingWeights[key]} onChange={value => updateGradingPreference('portfolioRisk', 'holdingWeights', key, value)} />
            ))}
          </FormulaFieldGrid>
          <h4 style={{ marginBottom: 0 }}>Portfolio weights</h4>
          <FormulaFieldGrid>
            {Object.entries({ ulcerIndex: 'Ulcer Index', calmar: 'Calmar', omega: 'Omega', sortino: 'Sortino', sharpe: 'Sharpe', maxDrawdown: 'Max drawdown', downCapture: 'Downside capture', diversification: 'Diversification', navHealth: 'NAV Health' }).map(([key, label]) => (
              <FormulaNumberField key={key} label={`${label} weight`} help={gradingPreferenceHelp('portfolioRisk', 'portfolioWeights', key)} value={portfolioRiskFormula.portfolioWeights[key]} onChange={value => updateGradingPreference('portfolioRisk', 'portfolioWeights', key, value)} />
            ))}
          </FormulaFieldGrid>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.8rem' }}>
            NAV Health score = full score − (portfolio-weighted NAV decline percentage points × penalty per point). Positive or flat NAV receives the full score.
          </p>
          <FormulaFieldGrid>
            <FormulaNumberField label="NAV Health full score" help={gradingPreferenceHelp('portfolioRisk', 'navHealth', 'fullScore')} value={portfolioRiskFormula.navHealth.fullScore} onChange={value => updateGradingPreference('portfolioRisk', 'navHealth', 'fullScore', value)} />
            <FormulaNumberField label="Penalty per 1% decline" help={gradingPreferenceHelp('portfolioRisk', 'navHealth', 'penaltyPerDeclinePct')} value={portfolioRiskFormula.navHealth.penaltyPerDeclinePct} max={1000} step={0.1} suffix="points" onChange={value => updateGradingPreference('portfolioRisk', 'navHealth', 'penaltyPerDeclinePct', value)} />
          </FormulaFieldGrid>
        </details>

        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>Portfolio and holding scoring bands</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            Higher-is-better metrics use descending cutoffs; lower-is-better metrics use ascending cutoffs. Values between cutoffs are interpolated to a 0–100 score.
          </p>
          {Object.entries({
            calmar: 'Calmar ratio', omega: 'Omega ratio', sortino: 'Sortino ratio', sharpe: 'Sharpe ratio', diversification: 'Effective holdings',
          }).map(([metric, label]) => (
            <div key={metric} style={{ marginTop: '0.8rem' }}>
              <strong style={{ fontSize: '0.82rem' }}>{label} · higher is better</strong>
              <FormulaFieldGrid>
                {Object.entries({ excellent: 'Excellent from', good: 'Good from', fair: 'Fair from', poor: 'Poor from' }).map(([key, fieldLabel]) => (
                  <FormulaNumberField key={key} label={fieldLabel} help={gradingPreferenceHelp('portfolioRisk', 'higherBands', metric, key)} value={portfolioRiskFormula.higherBands[metric][key]} min={-1000} max={1000} step={0.1} onChange={value => updateNestedGradingPreference('portfolioRisk', 'higherBands', metric, key, value)} />
                ))}
              </FormulaFieldGrid>
            </div>
          ))}
          {Object.entries({ ulcerIndex: 'Ulcer Index', maxDrawdown: 'Max drawdown %', downCapture: 'Downside capture %' }).map(([metric, label]) => (
            <div key={metric} style={{ marginTop: '0.8rem' }}>
              <strong style={{ fontSize: '0.82rem' }}>{label} · lower is better</strong>
              <FormulaFieldGrid>
                {Object.entries({ excellent: 'Excellent through', good: 'Good through', fair: 'Fair through', poor: 'Poor through' }).map(([key, fieldLabel]) => (
                  <FormulaNumberField key={key} label={fieldLabel} help={gradingPreferenceHelp('portfolioRisk', 'lowerBands', metric, key)} value={portfolioRiskFormula.lowerBands[metric][key]} min={-1000} max={1000} step={0.1} onChange={value => updateNestedGradingPreference('portfolioRisk', 'lowerBands', metric, key, value)} />
                ))}
              </FormulaFieldGrid>
            </div>
          ))}
        </details>

        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>Letter-grade cutoffs</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>A score at or above a cutoff receives that letter. Scores below D− receive F.</p>
          <FormulaFieldGrid>
            {Object.entries({ aPlus: 'A+', a: 'A', aMinus: 'A−', bPlus: 'B+', b: 'B', bMinus: 'B−', cPlus: 'C+', c: 'C', cMinus: 'C−', dPlus: 'D+', d: 'D', dMinus: 'D−' }).map(([key, label]) => (
              <FormulaNumberField key={key} label={`${label} from`} help={gradingPreferenceHelp('portfolioRisk', 'letterCutoffs', key)} value={portfolioRiskFormula.letterCutoffs[key]} onChange={value => updateGradingPreference('portfolioRisk', 'letterCutoffs', key, value)} />
            ))}
          </FormulaFieldGrid>
        </details>

        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>ETF, CEF, and option-income final grade bands</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>These final labels summarize a checklist; they are research grades, not instructions to trade.</p>
          <FormulaFieldGrid>
            <FormulaNumberField label="Strong grade from" help={gradingPreferenceHelp('fundVerdicts', 'strongScore')} value={fundVerdictFormula.strongScore} onChange={value => setGradingPreferences(current => ({ ...current, fundVerdicts: { ...current.fundVerdicts, strongScore: value } }))} />
            <FormulaNumberField label="Moderate grade from" help={gradingPreferenceHelp('fundVerdicts', 'moderateScore')} value={fundVerdictFormula.moderateScore} onChange={value => setGradingPreferences(current => ({ ...current, fundVerdicts: { ...current.fundVerdicts, moderateScore: value } }))} />
            <FormulaNumberField label="Strong grade max weak criteria" help={gradingPreferenceHelp('fundVerdicts', 'strongMaxFails')} value={fundVerdictFormula.strongMaxFails} max={20} onChange={value => setGradingPreferences(current => ({ ...current, fundVerdicts: { ...current.fundVerdicts, strongMaxFails: value } }))} />
            <FormulaNumberField label="Moderate grade max weak criteria" help={gradingPreferenceHelp('fundVerdicts', 'moderateMaxFails')} value={fundVerdictFormula.moderateMaxFails} max={20} onChange={value => setGradingPreferences(current => ({ ...current, fundVerdicts: { ...current.fundVerdicts, moderateMaxFails: value } }))} />
          </FormulaFieldGrid>
        </details>

        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>Stock grade blend and criterion weights</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            Each side is a weighted average of its available criteria. The final score blends the Fundamental and Technical sides after normalizing their two weights.
          </p>
          <FormulaFieldGrid>
            <FormulaNumberField label="Fundamental blend weight" help={gradingPreferenceHelp('stock', 'blendWeights', 'fundamental')} value={stockFormula.blendWeights.fundamental} onChange={value => updateGradingPreference('stock', 'blendWeights', 'fundamental', value)} />
            <FormulaNumberField label="Technical blend weight" help={gradingPreferenceHelp('stock', 'blendWeights', 'technical')} value={stockFormula.blendWeights.technical} onChange={value => updateGradingPreference('stock', 'blendWeights', 'technical', value)} />
            {Object.entries({
              valuation: 'Valuation weight', profitability: 'Profitability weight', growth: 'Growth weight', health: 'Balance-sheet weight',
              trend: 'Trend weight', momentum: 'Momentum weight', oscillators: 'Oscillators weight', volume: 'Volume/range weight',
            }).map(([key, label]) => (
              <FormulaNumberField key={key} label={label} help={gradingPreferenceHelp('stock', 'groupWeights', key)} value={stockFormula.groupWeights[key]} max={10} step={0.25} onChange={value => updateGradingPreference('stock', 'groupWeights', key, value)} />
            ))}
          </FormulaFieldGrid>
        </details>

        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>Fundamental sector-comparison formula</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            Each available metric is divided by its sector benchmark. Lower-is-better metrics pass as the ratio falls; margins, returns and growth pass as the ratio rises.
          </p>
          <FormulaFieldGrid>
            {Object.entries({
              lowerExcellent: 'Lower: excellent through', lowerGood: 'Lower: good through', lowerFair: 'Lower: fair through', lowerWeak: 'Lower: weak through',
              higherExcellent: 'Higher: excellent from', higherGood: 'Higher: good from', higherFair: 'Higher: fair from', higherWeak: 'Higher: weak from',
            }).map(([key, label]) => (
              <FormulaNumberField key={key} label={label} help={gradingPreferenceHelp('stock', 'fundamentalBands', key)} value={stockFormula.fundamentalBands[key]} max={10} step={0.05} suffix="× benchmark" onChange={value => updateGradingPreference('stock', 'fundamentalBands', key, value)} />
            ))}
          </FormulaFieldGrid>
          <FormulaFieldGrid>
            {Object.entries({
              excellent: 'Excellent points', good: 'Good points', lowerFair: 'Lower/fair points', lowerWeak: 'Lower/weak points',
              higherFair: 'Higher/fair points', higherWeak: 'Higher/weak points', poor: 'Poor points',
            }).map(([key, label]) => (
              <FormulaNumberField key={key} label={label} help={gradingPreferenceHelp('stock', 'metricScores', key)} value={stockFormula.metricScores[key]} onChange={value => updateGradingPreference('stock', 'metricScores', key, value)} />
            ))}
          </FormulaFieldGrid>
        </details>

        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>Stock technical thresholds and signal points</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            Trend, RSI, stochastic and OBV are reclassified with these thresholds before the technical groups are scored.
          </p>
          <FormulaFieldGrid>
            <FormulaNumberField label="Trend neutral band" help={gradingPreferenceHelp('stock', 'technicalThresholds', 'trendBufferPct')} value={stockFormula.technicalThresholds.trendBufferPct} step={0.1} suffix="± %" onChange={value => updateGradingPreference('stock', 'technicalThresholds', 'trendBufferPct', value)} />
            <FormulaNumberField label="RSI Bullish below" help={gradingPreferenceHelp('stock', 'technicalThresholds', 'rsiBuyBelow')} value={stockFormula.technicalThresholds.rsiBuyBelow} onChange={value => updateGradingPreference('stock', 'technicalThresholds', 'rsiBuyBelow', value)} />
            <FormulaNumberField label="RSI Bearish above" help={gradingPreferenceHelp('stock', 'technicalThresholds', 'rsiSellAbove')} value={stockFormula.technicalThresholds.rsiSellAbove} onChange={value => updateGradingPreference('stock', 'technicalThresholds', 'rsiSellAbove', value)} />
            <FormulaNumberField label="Stochastic Bullish below" help={gradingPreferenceHelp('stock', 'technicalThresholds', 'stochasticBuyBelow')} value={stockFormula.technicalThresholds.stochasticBuyBelow} onChange={value => updateGradingPreference('stock', 'technicalThresholds', 'stochasticBuyBelow', value)} />
            <FormulaNumberField label="Stochastic Bearish above" help={gradingPreferenceHelp('stock', 'technicalThresholds', 'stochasticSellAbove')} value={stockFormula.technicalThresholds.stochasticSellAbove} onChange={value => updateGradingPreference('stock', 'technicalThresholds', 'stochasticSellAbove', value)} />
            <FormulaNumberField label="OBV neutral band" help={gradingPreferenceHelp('stock', 'technicalThresholds', 'obvNeutralBandPct')} value={stockFormula.technicalThresholds.obvNeutralBandPct} step={0.1} suffix="± %" onChange={value => updateGradingPreference('stock', 'technicalThresholds', 'obvNeutralBandPct', value)} />
            <FormulaNumberField label="Bullish signal points" help={gradingPreferenceHelp('stock', 'signalScores', 'buy')} value={stockFormula.signalScores.buy} onChange={value => updateGradingPreference('stock', 'signalScores', 'buy', value)} />
            <FormulaNumberField label="Neutral signal points" help={gradingPreferenceHelp('stock', 'signalScores', 'neutral')} value={stockFormula.signalScores.neutral} onChange={value => updateGradingPreference('stock', 'signalScores', 'neutral', value)} />
            <FormulaNumberField label="Bearish signal points" help={gradingPreferenceHelp('stock', 'signalScores', 'sell')} value={stockFormula.signalScores.sell} onChange={value => updateGradingPreference('stock', 'signalScores', 'sell', value)} />
          </FormulaFieldGrid>
        </details>

        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>52-week range, badges, and verdict bands</summary>
          <FormulaFieldGrid>
            {Object.entries({ best: 'Range best through', good: 'Range good through', fair: 'Range fair through', weak: 'Range weak through' }).map(([key, label]) => (
              <FormulaNumberField key={key} label={label} help={gradingPreferenceHelp('stock', 'rangeBands', key)} value={stockFormula.rangeBands[key]} suffix="% of range" onChange={value => updateGradingPreference('stock', 'rangeBands', key, value)} />
            ))}
            {Object.entries({ best: 'Range best points', good: 'Range good points', fair: 'Range fair points', weak: 'Range weak points', poor: 'Range poor points' }).map(([key, label]) => (
              <FormulaNumberField key={key} label={label} help={gradingPreferenceHelp('stock', 'rangeScores', key)} value={stockFormula.rangeScores[key]} onChange={value => updateGradingPreference('stock', 'rangeScores', key, value)} />
            ))}
            <FormulaNumberField label="Pass badge from" help={gradingPreferenceHelp('stock', 'badgeBands', 'pass')} value={stockFormula.badgeBands.pass} onChange={value => updateGradingPreference('stock', 'badgeBands', 'pass', value)} />
            <FormulaNumberField label="Warn badge from" help={gradingPreferenceHelp('stock', 'badgeBands', 'warn')} value={stockFormula.badgeBands.warn} onChange={value => updateGradingPreference('stock', 'badgeBands', 'warn', value)} />
            <FormulaNumberField label="Strong reading from" help={gradingPreferenceHelp('stock', 'verdictBands', 'strongBuy')} value={stockFormula.verdictBands.strongBuy} onChange={value => updateGradingPreference('stock', 'verdictBands', 'strongBuy', value)} />
            <FormulaNumberField label="Strong reading min fundamental" help={gradingPreferenceHelp('stock', 'verdictBands', 'strongFundamental')} value={stockFormula.verdictBands.strongFundamental} onChange={value => updateGradingPreference('stock', 'verdictBands', 'strongFundamental', value)} />
            <FormulaNumberField label="Favorable reading from" help={gradingPreferenceHelp('stock', 'verdictBands', 'buy')} value={stockFormula.verdictBands.buy} onChange={value => updateGradingPreference('stock', 'verdictBands', 'buy', value)} />
            <FormulaNumberField label="Mixed reading from" help={gradingPreferenceHelp('stock', 'verdictBands', 'hold')} value={stockFormula.verdictBands.hold} onChange={value => updateGradingPreference('stock', 'verdictBands', 'hold', value)} />
          </FormulaFieldGrid>
        </details>

        <details open style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>Technical Readings formula</summary>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            AO, RSI, MACD, SMA 50, SMA 200 and eligible NAV signals cast weighted votes. Bullish or Bearish must exceed the selected percentage of all active vote weight; otherwise the result is Neutral.
          </p>
          <FormulaFieldGrid>
            <FormulaNumberField label="AO zero-line buffer" help={gradingPreferenceHelp('signals', 'thresholds', 'aoZeroBuffer')} value={signalFormula.thresholds.aoZeroBuffer} step={0.01} onChange={value => updateGradingPreference('signals', 'thresholds', 'aoZeroBuffer', value)} />
            <FormulaNumberField label="RSI Bullish below" help={gradingPreferenceHelp('signals', 'thresholds', 'rsiBuyBelow')} value={signalFormula.thresholds.rsiBuyBelow} onChange={value => updateGradingPreference('signals', 'thresholds', 'rsiBuyBelow', value)} />
            <FormulaNumberField label="RSI Bearish above" help={gradingPreferenceHelp('signals', 'thresholds', 'rsiSellAbove')} value={signalFormula.thresholds.rsiSellAbove} onChange={value => updateGradingPreference('signals', 'thresholds', 'rsiSellAbove', value)} />
            <FormulaNumberField label="SMA neutral band" help={gradingPreferenceHelp('signals', 'thresholds', 'smaBufferPct')} value={signalFormula.thresholds.smaBufferPct} step={0.1} suffix="± %" onChange={value => updateGradingPreference('signals', 'thresholds', 'smaBufferPct', value)} />
            <FormulaNumberField label="Required vote share" help={gradingPreferenceHelp('signals', 'thresholds', 'majorityPct')} value={signalFormula.thresholds.majorityPct} min={1} max={100} suffix="%" onChange={value => updateGradingPreference('signals', 'thresholds', 'majorityPct', value)} />
            <FormulaNumberField label="NAV Bullish ratio through" help={gradingPreferenceHelp('signals', 'thresholds', 'navBuyMaxRatio')} value={signalFormula.thresholds.navBuyMaxRatio} step={0.05} onChange={value => updateGradingPreference('signals', 'thresholds', 'navBuyMaxRatio', value)} />
            <FormulaNumberField label="NAV Bearish ratio above" help={gradingPreferenceHelp('signals', 'thresholds', 'navSellAboveRatio')} value={signalFormula.thresholds.navSellAboveRatio} step={0.05} onChange={value => updateGradingPreference('signals', 'thresholds', 'navSellAboveRatio', value)} />
            <FormulaNumberField label="NAV hard-decline Bearish" help={gradingPreferenceHelp('signals', 'thresholds', 'navHardDeclinePct')} value={signalFormula.thresholds.navHardDeclinePct} step={1} suffix="% decline" onChange={value => updateGradingPreference('signals', 'thresholds', 'navHardDeclinePct', value)} />
            <FormulaNumberField label="NAV share-deficit High" help={gradingPreferenceHelp('signals', 'thresholds', 'navHardDeficitPct')} value={signalFormula.thresholds.navHardDeficitPct} step={0.5} suffix="% deficit" onChange={value => updateGradingPreference('signals', 'thresholds', 'navHardDeficitPct', value)} />
            {Object.entries({ ao: 'AO vote weight', rsi: 'RSI vote weight', macd: 'MACD vote weight', sma50: 'SMA 50 vote weight', sma200: 'SMA 200 vote weight', nav: 'NAV vote weight' }).map(([key, label]) => (
              <FormulaNumberField key={key} label={label} help={gradingPreferenceHelp('signals', 'weights', key)} value={signalFormula.weights[key]} max={10} step={0.25} onChange={value => updateGradingPreference('signals', 'weights', key, value)} />
            ))}
          </FormulaFieldGrid>
        </details>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="button" className="btn btn-primary" onClick={saveFormulaSettings}>Save grading formulas</button>
          <button type="button" className="btn" onClick={resetFormulaSettings}>Reset formulas to defaults</button>
        </div>
      </div>

      {/* Display Currency */}
      <div className="card">
        <h2>Display Currency</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Choose the currency preference for money displays.
        </p>
        {currencyStatus && (
          <div className={`alert alert-${currencyStatus.type}`} style={{ marginBottom: '0.75rem' }}>{currencyStatus.msg}</div>
        )}
        <div className="theme-toggle" role="group" aria-label="Display currency">
          <button
            type="button"
            className={`theme-toggle-btn${displayCurrency === 'USD' ? ' active' : ''}`}
            onClick={() => saveDisplayCurrency('USD')}
            aria-pressed={displayCurrency === 'USD'}
            disabled={currencySaving || currencyLoading}
          >
            USD
          </button>
          <button
            type="button"
            className={`theme-toggle-btn${displayCurrency === 'CAD' ? ' active' : ''}`}
            onClick={() => saveDisplayCurrency('CAD')}
            aria-pressed={displayCurrency === 'CAD'}
            disabled={currencySaving || currencyLoading}
          >
            CAD
          </button>
        </div>
        <div style={{ marginTop: '1rem', padding: '0.85rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-sunken)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-strong)', fontWeight: 700 }}>1 USD = {usdToCadRate.toFixed(4)} CAD</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: 3 }}>
                {rateInfo.mode === 'manual' ? 'Manual override' : rateInfo.cached ? 'Cached live rate' : 'Live rate'}
                {rateInfo.source ? ` · ${rateInfo.source}` : ''}
                {rateInfo.stale ? ' · stale' : ''}
              </div>
            </div>
            <button className="btn btn-secondary" type="button" onClick={refreshExchangeRate} disabled={rateBusy || currencyLoading}>
              {rateBusy ? 'Working…' : 'Refresh Live Rate'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.65rem', marginTop: '0.8rem', fontSize: '0.78rem' }}>
            <div><span style={{ color: 'var(--text-dim)' }}>Last updated</span><br /><strong>{updatedLabel}</strong></div>
            <div><span style={{ color: 'var(--text-dim)' }}>Market date</span><br /><strong>{rateAsOf || 'Not available'}</strong></div>
            <div><span style={{ color: 'var(--text-dim)' }}>Latest live rate</span><br /><strong>{rateInfo.liveRate ? rateInfo.liveRate.toFixed(4) : 'Not available'}</strong>
              {rateInfo.liveUpdatedAt && <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>{new Date(rateInfo.liveUpdatedAt).toLocaleString()}</div>}
            </div>
          </div>
          <div style={{ marginTop: '0.9rem', borderTop: '1px solid var(--border)', paddingTop: '0.8rem' }}>
            <label htmlFor="manual-usd-cad-rate" style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 5 }}>
              Manual override (CAD per USD)
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input id="manual-usd-cad-rate" type="number" min="0.5" max="2.5" step="0.0001" value={manualRateInput}
                onChange={e => setManualRateInput(e.target.value)} placeholder="e.g. 1.3750"
                style={{ width: 150, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.45rem 0.55rem' }} />
              <button className="btn btn-primary" type="button" onClick={saveManualExchangeRate} disabled={rateBusy}>Use Override</button>
              {/* Ternary, not `&&`: a numeric 0 on the left of `&&` renders as
                  a literal "0" rather than nothing. */}
              {rateInfo.manualRate ? <button className="btn btn-secondary" type="button" onClick={clearManualExchangeRate} disabled={rateBusy}>Use Live Rate</button> : null}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 5 }}>
              Overrides affect display and display-currency exports. The app still refreshes and retains the latest live rate for comparison.
            </div>
          </div>
        </div>
      </div>

      {/* Market Data Provider */}
      <div className="card">
        <h2>Market Data Provider</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Yahoo is the default. You may use your own Tiingo API key for non-option prices,
          history, dividends, and splits. If Tiingo cannot provide a ticker or field—or the
          account reaches a plan limit—the app automatically fills that request from Yahoo.
        </p>

        {providerStatus && (
          <div className={`alert alert-${providerStatus.type}`} style={{ marginBottom: '0.75rem' }}>{providerStatus.msg}</div>
        )}

        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.65rem', padding: '0.8rem',
          border: `1px solid ${useTiingo ? 'var(--accent-bright)' : 'var(--border)'}`,
          borderRadius: 6, background: 'var(--surface-sunken)', cursor: providerBusy ? 'wait' : 'pointer',
        }}>
          <input
            type="checkbox"
            checked={useTiingo}
            onChange={event => { setUseTiingo(event.target.checked); setProviderStatus(null) }}
            disabled={providerBusy}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong style={{ color: 'var(--text-strong)' }}>Use Tiingo when available</strong>
            <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 3 }}>
              Tiingo activates only after this box is saved and Tiingo validates the key.
              Clearing the box sends all non-option requests directly to Yahoo.
            </span>
          </span>
        </label>

        <div style={{ marginTop: '0.9rem' }}>
          <label htmlFor="tiingo-api-key" style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 5 }}>
            Tiingo API key
          </label>
          <input
            id="tiingo-api-key"
            type="password"
            autoComplete="off"
            value={tiingoKey}
            onChange={event => { setTiingoKey(event.target.value); setProviderStatus(null) }}
            placeholder={marketProvider.masked_key || 'Paste your Tiingo key'}
            disabled={providerBusy}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 5 }}>
            {marketProvider.key_configured
              ? `A validated key is saved on this device (${marketProvider.masked_key || 'masked'}). Leave this blank to keep it.`
              : 'The key is stored only in this application database and is never returned by the API.'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
          <button className="btn btn-secondary" type="button" onClick={testTiingoKey} disabled={providerBusy || (!tiingoKey.trim() && !marketProvider.key_configured)}>
            {providerBusy ? 'Working…' : 'Test key'}
          </button>
          <button className="btn btn-primary" type="button" onClick={saveMarketProvider} disabled={providerBusy}>
            Save provider
          </button>
          {marketProvider.key_configured && (
            <button className="btn" type="button" onClick={clearTiingoKey} disabled={providerBusy}>
              Remove Tiingo key
            </button>
          )}
        </div>

        <div style={{
          marginTop: '0.9rem', padding: '0.75rem 0.8rem', borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--surface-sunken)', fontSize: '0.8rem',
        }}>
          <div style={{ color: 'var(--text-strong)', fontWeight: 700 }}>
            Active: {marketProvider.enabled ? 'Tiingo preferred · Yahoo fallback' : 'Yahoo'}
          </div>
          <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>
            Options always remain on Yahoo. CEF Connect, SEC filings, issuer holdings, and other
            specialist sources are unchanged. Paid Tiingo plans should fall back less often for
            ordinary price history, but unsupported metadata, indices, and non-entitled fundamentals
            can still use Yahoo.
          </div>
          {marketProvider.runtime?.yahoo_fallbacks > 0 && (
            <div style={{ color: 'var(--text-dim)', marginTop: 5 }}>
              This session: {marketProvider.runtime.yahoo_fallbacks} Yahoo fallback{marketProvider.runtime.yahoo_fallbacks === 1 ? '' : 's'}
              {marketProvider.runtime.last_fallback_reason ? ` · latest reason: ${marketProvider.runtime.last_fallback_reason}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Price Data Freshness */}
      <div className="card">
        <h2>Price Data Freshness</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Market-data providers limit how many requests this app may make. Switching date ranges
          or moving between screens often re-downloads prices this app already has. Reusing those
          cuts both Tiingo requests and Yahoo fallback requests.
        </p>

        {priceReuseStatus && (
          <div className={`alert alert-${priceReuseStatus.type}`} style={{ marginBottom: '0.75rem' }}>{priceReuseStatus.msg}</div>
        )}

        <div className="theme-toggle" role="group" aria-label="Price data freshness">
          <button
            type="button"
            className={`theme-toggle-btn${!priceReuse.enabled ? ' active' : ''}`}
            onClick={() => savePriceReuse(false)}
            aria-pressed={!priceReuse.enabled}
            disabled={priceReuseBusy}
          >
            Always Fetch Live
          </button>
          <button
            type="button"
            className={`theme-toggle-btn${priceReuse.enabled ? ' active' : ''}`}
            onClick={() => savePriceReuse(true)}
            aria-pressed={priceReuse.enabled}
            disabled={priceReuseBusy}
          >
            Reuse Recent Prices
          </button>
        </div>

        {/* Say plainly what each choice does, so the trade-off is not a guess. */}
        <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.65rem' }}>
          <div style={{
            padding: '0.7rem 0.8rem', borderRadius: 6, fontSize: '0.83rem',
            background: 'var(--surface-sunken)',
            border: `1px solid ${!priceReuse.enabled ? 'var(--accent-bright)' : 'var(--border)'}`,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Always Fetch Live</div>
            <div style={{ color: 'var(--text-dim)' }}>
              Every screen downloads current prices. The app makes the most provider requests,
              so rate limiting and Yahoo fallback are more likely.
            </div>
          </div>
          <div style={{
            padding: '0.7rem 0.8rem', borderRadius: 6, fontSize: '0.83rem',
            background: 'var(--surface-sunken)',
            border: `1px solid ${priceReuse.enabled ? 'var(--accent-bright)' : 'var(--border)'}`,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Reuse Recent Prices</div>
            <div style={{ color: 'var(--text-dim)' }}>
              If this app already downloaded the exact same prices within the time below,
              it reuses them instead of asking the active provider again. Far fewer requests — but a
              price can be up to that many minutes old.
            </div>
          </div>
        </div>

        {priceReuse.enabled && (
          <div style={{ marginTop: '1rem', padding: '0.85rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-sunken)' }}>
            <label htmlFor="price-reuse-ttl" style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 5 }}>
              Reuse prices for
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                id="price-reuse-ttl"
                value={Math.round((priceReuse.ttl_sec || 600) / 60)}
                onChange={e => savePriceReuse(true, Number(e.target.value))}
                disabled={priceReuseBusy}
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.45rem 0.55rem' }}
              >
                {[1, 2, 5, 10, 15, 30, 60].map(m => (
                  <option key={m} value={m}>{m} minute{m === 1 ? '' : 's'}</option>
                ))}
              </select>
              <button className="btn btn-secondary" type="button" onClick={clearPriceCache} disabled={priceReuseBusy}>
                Clear Reused Prices Now
              </button>
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '0.7rem' }}>
              Holding {priceReuse.entries || 0} reused price set{priceReuse.entries === 1 ? '' : 's'}
              {priceReuse.requests_avoided ? ` · ${priceReuse.requests_avoided} provider request${priceReuse.requests_avoided === 1 ? '' : 's'} avoided this session` : ''}
            </div>
          </div>
        )}

        <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '0.9rem', marginBottom: 0 }}>
          This only changes how often <strong>market prices</strong> are re-downloaded. It never
          affects your holdings, transactions, cost basis or dividend records. Reused prices are
          dropped when you switch this off, change the time above, press Clear, or restart the app.
        </p>
      </div>

      {/* Data Overview */}
      <div className="card">
        <h2>Data Overview</h2>
        {stats ? (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Holdings</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-bright)' }}>{stats.holdings}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Dividend Records</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-bright)' }}>{stats.dividends}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Income Tracking</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-bright)' }}>{stats.income_tracking}</div>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-dim)' }}>Loading...</p>
        )}
      </div>

      {/* NAV Benchmark Overrides */}
      <div className="card">
        <h2>NAV Benchmark Overrides</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Automatic NAV erosion checks infer benchmarks from ticker, fund name, and strategy.
          Add an override when a new fund needs a specific underlying.
        </p>

        {navStatus && (
          <div className={`alert alert-${navStatus.type}`} style={{ marginBottom: '0.75rem' }}>{navStatus.msg}</div>
        )}

        {Object.keys(navOverrides).length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Overrides</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {Object.entries(navOverrides).sort(([a], [b]) => a.localeCompare(b)).map(([ticker, benchmark]) => (
                <span key={ticker} style={tagStyle(true)}>
                  {ticker} {'->'} {benchmark}
                  <button
                    onClick={() => handleRemoveNavOverride(ticker)}
                    disabled={navSaving}
                    style={{
                      background: 'none', border: 'none', color: 'var(--neg)',
                      cursor: 'pointer', padding: '0 2px', fontSize: '0.9rem', lineHeight: 1,
                    }}
                    title={`Remove ${ticker}`}
                  >&times;</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) minmax(130px, 1fr) auto', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={navTicker}
            onChange={e => setNavTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleAddNavOverride()}
            placeholder="Fund ticker"
            style={{ textTransform: 'uppercase' }}
            disabled={navSaving}
          />
          <input
            type="text"
            value={navBenchmark}
            onChange={e => setNavBenchmark(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleAddNavOverride()}
            placeholder="Benchmark"
            list="nav-benchmark-choices"
            style={{ textTransform: 'uppercase' }}
            disabled={navSaving}
          />
          <datalist id="nav-benchmark-choices">
            {navBenchmarkChoices.map(b => <option key={b} value={b} />)}
          </datalist>
          <button className="btn btn-primary" onClick={handleAddNavOverride} disabled={navSaving || !navTicker.trim() || !navBenchmark.trim()}>
            Save
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Broker Symbol Mapping</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Brokers do not always spell a symbol the way Yahoo does. Interactive Brokers writes
          TSX Venture listings bare (PGDC, where Yahoo wants PGDC.V) and preferreds as CIM-PRB
          (Yahoo: CIM-PB); Fidelity writes Berkshire class B as BRKB (Yahoo: BRK-B). Without a
          mapping those holdings get no price, so they show no grade and no NAV score.
          Your broker&apos;s spelling stays the ticker everywhere &mdash; this only changes what
          Yahoo is asked for.
        </p>

        {symbolStatus && (
          <div className={`alert alert-${symbolStatus.type}`} style={{ marginBottom: '0.75rem' }}>{symbolStatus.msg}</div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <button className="btn" onClick={handleScanSymbols} disabled={symbolScanning || symbolBusy}>
            {symbolScanning ? 'Scanning...' : 'Scan holdings for unmatched symbols'}
          </button>
        </div>

        {symbolMap.length > 0 && (
          <div style={{ marginBottom: '0.75rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>Broker</th>
                  <th style={{ padding: '4px 8px' }}>Yahoo</th>
                  <th style={{ padding: '4px 8px' }}>Source</th>
                  <th style={{ padding: '4px 0' }}></th>
                </tr>
              </thead>
              <tbody>
                {symbolMap.map(row => (
                  <tr key={row.broker_symbol} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>
                      {row.broker_symbol}
                      {!row.held && (
                        <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> (not held)</span>
                      )}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      {row.yahoo_symbol || (
                        // A recorded miss, kept so the symbol is not re-probed on
                        // every scan. Worth showing: it explains a blank grade.
                        <span style={{ color: 'var(--warning-money)' }}>no Yahoo listing</span>
                      )}
                    </td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-dim)' }}>{row.source}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right' }}>
                      <button
                        onClick={() => handleRemoveSymbol(row.broker_symbol)}
                        disabled={symbolBusy || symbolScanning}
                        style={{
                          background: 'none', border: 'none', color: 'var(--neg)',
                          cursor: 'pointer', padding: '0 2px', fontSize: '1rem', lineHeight: 1,
                        }}
                        title={`Remove ${row.broker_symbol}`}
                      >&times;</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) minmax(90px, 1fr) auto', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={symbolBroker}
            onChange={e => setSymbolBroker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSaveSymbol()}
            placeholder="Broker symbol"
            style={{ textTransform: 'uppercase' }}
            disabled={symbolBusy}
          />
          <input
            type="text"
            value={symbolYahoo}
            onChange={e => setSymbolYahoo(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSaveSymbol()}
            placeholder="Yahoo symbol"
            style={{ textTransform: 'uppercase' }}
            disabled={symbolBusy}
          />
          <button
            className="btn btn-primary"
            onClick={handleSaveSymbol}
            disabled={symbolBusy || !symbolBroker.trim() || !symbolYahoo.trim()}
          >
            Save
          </button>
        </div>
      </div>

      {/* Single-Stock ETFs */}
      <div className="card">
        <h2>Single-Stock ETFs</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          These tickers are excluded from increase-weight results in Optimize Returns and Balanced mode
          (unless the slider is at 100%). They are still allowed in Optimize Income.
        </p>

        {etfStatus && (
          <div className={`alert alert-${etfStatus.type}`} style={{ marginBottom: '0.75rem' }}>{etfStatus.msg}</div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Built-in ({builtinEtfs.length})</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {builtinEtfs.map(t => <span key={t} style={tagStyle(false)}>{t}</span>)}
          </div>
        </div>

        {userEtfs.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Your additions ({userEtfs.length})</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {userEtfs.map(t => (
                <span key={t} style={tagStyle(true)}>
                  {t}
                  <button
                    onClick={() => handleRemoveEtf(t)}
                    disabled={etfSaving}
                    style={{
                      background: 'none', border: 'none', color: 'var(--neg)',
                      cursor: 'pointer', padding: '0 2px', fontSize: '0.9rem', lineHeight: 1,
                    }}
                    title={`Remove ${t}`}
                  >&times;</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={etfInput}
            onChange={e => setEtfInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddEtf()}
            placeholder="Add tickers (e.g. XXXY, ZZZY)"
            style={{ flex: 1 }}
            disabled={etfSaving}
          />
          <button className="btn btn-primary" onClick={handleAddEtf} disabled={etfSaving || !etfInput.trim()}>
            Add
          </button>
        </div>
      </div>

      {/* Tax-Loss Harvesting Rates */}
      <div className="card">
        <h2>Tax-Loss Harvesting Rates</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Used by the Tax-Loss Harvest page to estimate the tax saved when realizing a loss.
          Enter as percentages (e.g. 32 for 32%).
        </p>

        {taxStatus && (
          <div className={`alert alert-${taxStatus.type}`} style={{ marginBottom: '0.75rem' }}>{taxStatus.msg}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(110px, 1fr)) auto', gap: '0.5rem', alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', color: 'var(--p-c0cdd8)' }}>
            Short-term (%)
            <input
              type="number" step="0.01" min="0" max="100"
              value={taxRates.short}
              onChange={e => setTaxRates({ ...taxRates, short: e.target.value })}
              disabled={taxSaving}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', color: 'var(--p-c0cdd8)' }}>
            Long-term (%)
            <input
              type="number" step="0.01" min="0" max="100"
              value={taxRates.long}
              onChange={e => setTaxRates({ ...taxRates, long: e.target.value })}
              disabled={taxSaving}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', color: 'var(--p-c0cdd8)' }}>
            State (%)
            <input
              type="number" step="0.01" min="0" max="100"
              value={taxRates.state}
              onChange={e => setTaxRates({ ...taxRates, state: e.target.value })}
              disabled={taxSaving}
            />
          </label>
          <button className="btn btn-primary" onClick={saveTaxRates} disabled={taxSaving}>
            {taxSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Database Backups */}
      <div className="card">
        <h2>Database Backups</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
          Backups are stored in: <code style={{ color: 'var(--p-80cbc4)', fontSize: '0.8rem' }}>{backupDir || 'backend/backups/'}</code>
        </p>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem', fontSize: '0.85rem' }}>
          Auto backups are created before each import. Pre-operation backups are created before repair/sync operations.
          To restore, use the Import page's Restore tab.
        </p>

        {backupStatus && (
          <div className={`alert alert-${backupStatus.type}`} style={{ marginBottom: '0.75rem' }}>{backupStatus.msg}</div>
        )}

        {backupLoading ? (
          <p style={{ color: 'var(--text-dim)' }}>Loading...</p>
        ) : backups.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>No backups found.</p>
        ) : (
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>File</th>
                  <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>Date</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>Size</th>
                  <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>Type</th>
                  <th style={{ padding: '0.3rem 0.5rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {backups.map(b => (
                  <tr key={b.filename}>
                    <td style={{ padding: '0.3rem 0.5rem', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={b.filename}>
                      {b.filename}
                    </td>
                    <td style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap' }}>{b.label}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{b.size_mb} MB</td>
                    <td style={{ padding: '0.3rem 0.5rem' }}>
                      <span style={{ color: b.kind === 'pre-operation' ? 'var(--p-ffcc80)' : 'var(--p-a5d6a7)', fontSize: '0.75rem' }}>
                        {b.kind === 'pre-operation' ? 'pre-op' : 'auto'}
                      </span>
                    </td>
                    <td style={{ padding: '0.3rem 0.5rem' }}>
                      <button
                        className="btn btn-danger"
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                        disabled={deletingBackup === b.filename}
                        onClick={() => deleteBackup(b.filename)}
                      >
                        {deletingBackup === b.filename ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={fetchBackups} disabled={backupLoading}>
            Refresh
          </button>
        </div>
      </div>

      {/* Clear Data */}
      <div className="card">
        <h2>Clear All Data</h2>
        {isAggregate ? (
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Clearing works on one portfolio at a time, so it is unavailable while an aggregate is
            selected. Pick a specific portfolio from the navbar dropdown, or use Clear or Reset on
            the <strong>Portfolios</strong> page to empty one account.
          </p>
        ) : (
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem', fontSize: '0.9rem' }}>
            This will permanently delete holdings, the transaction ledger, dividends, income tracking,
            and payout data for <strong>{currentProfileName || 'the current portfolio'}</strong> only.
            Other portfolios are not touched. Option trades, the DRIP contribution schedule, NAV
            history, and saved plans are kept — to remove option trades and the DRIP schedule too,
            use Reset on the <strong>Portfolios</strong> page. A database backup is created
            automatically — you can restore it from the Import page.
          </p>
        )}

        {status && (
          <div className={`alert alert-${status.type}`}>{status.msg}</div>
        )}

        {!confirming ? (
          <button
            className="btn btn-danger"
            onClick={() => setConfirming(true)}
            disabled={loading || isAggregate || (stats && stats.holdings === 0 && (stats.transactions || 0) === 0)}
            title={isAggregate ? 'Select a specific portfolio to clear its data' : undefined}
          >
            Clear All Data
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: 'var(--p-ef9a9a)', fontWeight: 600 }}>Are you sure? This cannot be undone.</span>
            <button className="btn btn-danger" onClick={handleClearAll} disabled={loading}>
              {loading ? 'Clearing...' : 'Yes, Delete Everything'}
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={loading}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
