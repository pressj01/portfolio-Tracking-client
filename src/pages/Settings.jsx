import React, { useState, useEffect } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

export default function Settings() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [stats, setStats] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

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

  useEffect(() => { fetchStats(); fetchSingleStockEtfs(); fetchNavBenchmarkOverrides() }, [selection])

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
    background: removable ? '#1a3a4a' : '#1a2a3a', color: removable ? '#7ecfff' : '#8899aa',
    borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem', margin: 2,
    border: removable ? '1px solid #2a5a6a' : '1px solid #2a3a4a',
  })

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h1>Settings</h1>

      {/* Data Overview */}
      <div className="card">
        <h2>Data Overview</h2>
        {stats ? (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.8rem' }}>Holdings</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7ecfff' }}>{stats.holdings}</div>
            </div>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.8rem' }}>Dividend Records</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7ecfff' }}>{stats.dividends}</div>
            </div>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.8rem' }}>Income Tracking</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7ecfff' }}>{stats.income_tracking}</div>
            </div>
          </div>
        ) : (
          <p style={{ color: '#8899aa' }}>Loading...</p>
        )}
      </div>

      {/* NAV Benchmark Overrides */}
      <div className="card">
        <h2>NAV Benchmark Overrides</h2>
        <p style={{ color: '#90a4ae', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Automatic NAV erosion checks infer benchmarks from ticker, fund name, and strategy.
          Add an override when a new fund needs a specific underlying.
        </p>

        {navStatus && (
          <div className={`alert alert-${navStatus.type}`} style={{ marginBottom: '0.75rem' }}>{navStatus.msg}</div>
        )}

        {Object.keys(navOverrides).length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ color: '#8899aa', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Overrides</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {Object.entries(navOverrides).sort(([a], [b]) => a.localeCompare(b)).map(([ticker, benchmark]) => (
                <span key={ticker} style={tagStyle(true)}>
                  {ticker} {'->'} {benchmark}
                  <button
                    onClick={() => handleRemoveNavOverride(ticker)}
                    disabled={navSaving}
                    style={{
                      background: 'none', border: 'none', color: '#ff6b6b',
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
        <p style={{ color: '#90a4ae', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          These tickers are excluded from BUY recommendations in Optimize Returns and Balanced mode
          (unless the slider is at 100%). They are still allowed in Optimize Income.
        </p>

        {etfStatus && (
          <div className={`alert alert-${etfStatus.type}`} style={{ marginBottom: '0.75rem' }}>{etfStatus.msg}</div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <span style={{ color: '#8899aa', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Built-in ({builtinEtfs.length})</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {builtinEtfs.map(t => <span key={t} style={tagStyle(false)}>{t}</span>)}
          </div>
        </div>

        {userEtfs.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ color: '#8899aa', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Your additions ({userEtfs.length})</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {userEtfs.map(t => (
                <span key={t} style={tagStyle(true)}>
                  {t}
                  <button
                    onClick={() => handleRemoveEtf(t)}
                    disabled={etfSaving}
                    style={{
                      background: 'none', border: 'none', color: '#ff6b6b',
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
        <p style={{ color: '#90a4ae', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Used by the Tax-Loss Harvest page to estimate the tax saved when realizing a loss.
          Enter as percentages (e.g. 32 for 32%).
        </p>

        {taxStatus && (
          <div className={`alert alert-${taxStatus.type}`} style={{ marginBottom: '0.75rem' }}>{taxStatus.msg}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(110px, 1fr)) auto', gap: '0.5rem', alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', color: '#c0cdd8' }}>
            Short-term (%)
            <input
              type="number" step="0.01" min="0" max="100"
              value={taxRates.short}
              onChange={e => setTaxRates({ ...taxRates, short: e.target.value })}
              disabled={taxSaving}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', color: '#c0cdd8' }}>
            Long-term (%)
            <input
              type="number" step="0.01" min="0" max="100"
              value={taxRates.long}
              onChange={e => setTaxRates({ ...taxRates, long: e.target.value })}
              disabled={taxSaving}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', color: '#c0cdd8' }}>
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

      {/* Clear Data */}
      <div className="card">
        <h2>Clear All Data</h2>
        <p style={{ color: '#90a4ae', marginBottom: '1rem', fontSize: '0.9rem' }}>
          This will permanently delete all holdings, dividends, income tracking, and payout data.
          You can re-import a spreadsheet after clearing.
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
            <span style={{ color: '#ef9a9a', fontWeight: 600 }}>Are you sure? This cannot be undone.</span>
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
