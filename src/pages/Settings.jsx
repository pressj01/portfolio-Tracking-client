import React, { useState, useEffect } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { useCurrency } from '../context/CurrencyContext'

export default function Settings() {
  const pf = useProfileFetch()
  const { selection, currentProfileName, isAggregate } = useProfile()
  const { theme, setTheme, isDark } = useTheme()
  const { displayCurrency, usdToCadRate, rateAsOf, rateInfo, loading: currencyLoading, setDisplayCurrency, refreshCadRate, setCadManualRate } = useCurrency()
  const [stats, setStats] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [currencySaving, setCurrencySaving] = useState(false)
  const [currencyStatus, setCurrencyStatus] = useState(null)
  const [rateBusy, setRateBusy] = useState(false)
  const [manualRateInput, setManualRateInput] = useState('')

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

  useEffect(() => { fetchStats(); fetchSingleStockEtfs(); fetchNavBenchmarkOverrides(); fetchBackups() }, [selection])

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
              {rateInfo.manualRate && <button className="btn btn-secondary" type="button" onClick={clearManualExchangeRate} disabled={rateBusy}>Use Live Rate</button>}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 5 }}>
              Overrides affect display and display-currency exports. The app still refreshes and retains the latest live rate for comparison.
            </div>
          </div>
        </div>
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

      {/* Single-Stock ETFs */}
      <div className="card">
        <h2>Single-Stock ETFs</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          These tickers are excluded from BUY recommendations in Optimize Returns and Balanced mode
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
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          This will permanently delete all holdings, dividends, income tracking, and payout data
          for <strong>{isAggregate ? 'the active aggregate view' : (currentProfileName || 'the current portfolio')}</strong> only.
          Other portfolios are not touched. A database backup is created automatically — you can restore it from the Import page.
        </p>

        {status && (
          <div className={`alert alert-${status.type}`}>{status.msg}</div>
        )}

        {!confirming ? (
          <button
            className="btn btn-danger"
            onClick={() => setConfirming(true)}
            disabled={loading || (stats && stats.holdings === 0)}
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
