import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Plot from 'react-plotly.js'

const MAX_ROWS = 80
const CHART_COLORS = [
  '#7ecfff','#00e89a','#f9a825','#a78bfa','#ff6b6b',
  '#00bcd4','#ff9800','#e040fb','#8bc34a','#ff5252',
  '#64ffda','#ffab40',
]

function fmt$(v) {
  return '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + parseFloat(v).toFixed(2) + '%'
}

function StatTile({ label, value, color, sub }) {
  return (
    <div className="nep-stat-tile">
      <div className="nep-stat-val" style={{ color }}>{value}</div>
      <div className="nep-stat-lbl">{label}</div>
      {sub && <div className="nep-stat-sub">{sub}</div>}
    </div>
  )
}

const DRIP_HORIZON_OPTIONS = [1, 2, 3, 5, 10]
const DRIP_PCT_OPTIONS = Array.from({ length: 101 }, (_, i) => i)

function DripProjectionsPanel() {
  const [years, setYears] = useState(1)
  const [categories, setCategories] = useState([])
  const [selectedCats, setSelectedCats] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = React.useRef(null)
  const [dripSettings, setDripSettings] = useState({})
  const [investmentOverrides, setInvestmentOverrides] = useState({}) // {ticker: dollarAmount}
  const investmentOverridesRef = React.useRef(investmentOverrides)
  const [holdings, setHoldings] = useState([])
  const [yearlyTotals, setYearlyTotals] = useState([])
  const [tickerYearly, setTickerYearly] = useState({})
  const [totals, setTotals] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [setAllValue, setSetAllValue] = useState('')
  const setAllRef = React.useRef('')

  // Monthly contribution state
  const [monthlyAmount, setMonthlyAmount] = useState(0)
  const [contributionTargeted, setContributionTargeted] = useState(false)
  const [contributionTargets, setContributionTargets] = useState([])
  const [contribPickerOpen, setContribPickerOpen] = useState(false)
  const contribPickerRef = React.useRef(null)

  // Distribution redirects state
  const [redirects, setRedirects] = useState([])
  const [redirectsOpen, setRedirectsOpen] = useState(false)

  // Ticker filter state
  const [selectedTickers, setSelectedTickers] = useState([])
  const [tickerFilterOpen, setTickerFilterOpen] = useState(false)
  const tickerFilterRef = React.useRef(null)
  const [portfolioTickers, setPortfolioTickers] = useState([])  // persists across clears
  const skipRefetch = React.useRef(false)
  const [customTickers, setCustomTickers] = useState([])  // [{ticker, description, price, div_per_share, freq_str, shares}]
  const [customTickerInput, setCustomTickerInput] = useState('')
  const [customTickerLoading, setCustomTickerLoading] = useState(false)

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false)
      if (contribPickerRef.current && !contribPickerRef.current.contains(e.target)) setContribPickerOpen(false)
      if (tickerFilterRef.current && !tickerFilterRef.current.contains(e.target)) setTickerFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Load all saved settings on mount
  useEffect(() => {
    fetch('/api/drip-settings')
      .then(r => r.json())
      .then(data => { if (data && typeof data === 'object' && !data.error) setDripSettings(data) })
      .catch(() => {})
    fetch('/api/drip-contribution-settings')
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) {
          setMonthlyAmount(data.monthly_amount || 0)
          setContributionTargeted(!!data.targeted)
          setContributionTargets(data.targets || [])
        }
      })
      .catch(() => {})
    fetch('/api/drip-redirects')
      .then(r => r.json())
      .then(data => {
        if (data?.redirects?.length) {
          setRedirects(data.redirects)
          setRedirectsOpen(true)
        }
      })
      .catch(() => {})
  }, [])

  const fetchProjection = useCallback(() => {
    setLoading(true)
    fetch('/api/analytics/drip-projection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        years, categories: selectedCats, drip_settings: dripSettings,
        drip_default: setAllRef.current !== '' ? Number(setAllRef.current) : null,
        investment_overrides: investmentOverridesRef.current,
        monthly_contribution: monthlyAmount,
        contribution_targeted: contributionTargeted,
        contribution_targets: contributionTargets,
        redirects: redirects,
        custom_tickers: customTickers,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        setHoldings(data.holdings || [])
        setYearlyTotals(data.yearly_totals || [])
        setTickerYearly(data.ticker_yearly || {})
        setTotals(data.totals || {})
        if (data.categories) setCategories(data.categories)
        // Sync dripSettings with Set All value for any new holdings
        if (setAllRef.current !== '') {
          const allPct = Number(setAllRef.current)
          setDripSettings(prev => {
            const missing = (data.holdings || []).filter(h => !(h.ticker in prev))
            if (missing.length === 0) return prev  // no change, avoid loop
            const next = { ...prev }
            missing.forEach(h => { next[h.ticker] = allPct })
            return next
          })
        }
        // Persist portfolio tickers for dropdown (survives clear)
        const pt = (data.holdings || []).map(h => h.ticker).filter(t => t)
        if (pt.length > 0) setPortfolioTickers(prev => prev.length > 0 ? prev : pt)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [years, selectedCats, dripSettings, monthlyAmount, contributionTargeted, contributionTargets, redirects, customTickers])

  useEffect(() => { if (skipRefetch.current) { skipRefetch.current = false; return } fetchProjection() }, [fetchProjection])

  const saveSettings = () => {
    setSaving(true)
    Promise.all([
      fetch('/api/drip-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: dripSettings }),
      }),
      fetch('/api/drip-contribution-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_amount: monthlyAmount, targeted: contributionTargeted, targets: contributionTargets }),
      }),
      fetch('/api/drip-redirects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirects }),
      }),
    ])
      .then(() => { setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000) })
      .catch(() => {})
      .finally(() => setSaving(false))
  }

  const setAllPct = (pct) => {
    setAllRef.current = pct
    const updated = { ...dripSettings }
    holdings.forEach(h => { updated[h.ticker] = pct })
    setDripSettings(updated)
  }

  const updateTickerPct = (ticker, pct) => {
    setDripSettings(prev => ({ ...prev, [ticker]: Math.max(0, Math.min(100, pct)) }))
  }

  // Redirect helpers
  const addRedirect = () => setRedirects(prev => [...prev, { source: '', target: '' }])
  const removeRedirect = (i) => setRedirects(prev => prev.filter((_, j) => j !== i))
  const updateRedirect = (i, field, val) => setRedirects(prev => prev.map((r, j) => j === i ? { ...r, [field]: val } : r))
  const usedSources = useMemo(() => new Set(redirects.map(r => r.source).filter(Boolean)), [redirects])
  const allTickers = useMemo(() => holdings.map(h => h.ticker), [holdings])
  const allTickersWithCustom = useMemo(() => [...allTickers, ...customTickers.map(c => c.ticker)], [allTickers, customTickers])

  const addCustomTicker = () => {
    const sym = customTickerInput.trim().toUpperCase()
    if (!sym) return
    if (allTickers.includes(sym) || customTickers.some(c => c.ticker === sym)) {
      // Already in portfolio or custom list — just add to selected filter
      if (!selectedTickers.includes(sym)) setSelectedTickers(prev => [...prev, sym])
      setCustomTickerInput('')
      return
    }
    setCustomTickerLoading(true)
    fetch(`/api/lookup/${sym}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { alert(`Could not find ticker: ${sym}`); return }
        setCustomTickers(prev => [...prev, {
          ticker: sym,
          description: data.description || sym,
          price: data.current_price || 0,
          div_per_share: data.div || 0,
          freq_str: data.div_frequency || 'Q',
        }])
        setSelectedTickers(prev => [...prev, sym])
      })
      .catch(() => alert(`Could not look up ${sym}`))
      .finally(() => { setCustomTickerLoading(false); setCustomTickerInput('') })
  }

  const clearTickerFilter = () => {
    setSelectedTickers([])
    setCustomTickerInput('')
    setDripSettings({})
    setInvestmentOverrides({})
    investmentOverridesRef.current = {}
    setSetAllValue('')
    setAllRef.current = ''
    skipRefetch.current = true
    setCustomTickers([])
    setHoldings([])
    setTotals({})
    setTickerYearly({})
    setYearlyTotals([])
  }

  const sortedHoldings = useMemo(() => {
    if (!sortCol) return holdings
    const sorted = [...holdings]
    sorted.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol]
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va == null) return 1; if (vb == null) return -1
      if (va < vb) return sortAsc ? -1 : 1
      if (va > vb) return sortAsc ? 1 : -1
      return 0
    })
    return sorted
  }, [holdings, sortCol, sortAsc])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const sortIcon = (col) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  // Ticker filter: when tickers are selected, filter table/chart/totals to only those
  const tickerFilterActive = selectedTickers.length > 0
  const tickerSet = useMemo(() => new Set(selectedTickers), [selectedTickers])

  const displayHoldings = useMemo(() => {
    if (!tickerFilterActive) return sortedHoldings
    return sortedHoldings.filter(h => tickerSet.has(h.ticker))
  }, [sortedHoldings, tickerFilterActive, tickerSet])

  const displayTickerYearly = useMemo(() => {
    if (!tickerFilterActive) return tickerYearly
    const filtered = {}
    for (const t of selectedTickers) {
      if (tickerYearly[t]) filtered[t] = tickerYearly[t]
    }
    return filtered
  }, [tickerYearly, tickerFilterActive, selectedTickers])

  const displayYearlyTotals = useMemo(() => {
    if (!tickerFilterActive) return yearlyTotals
    return yearlyTotals.map((yt, yi) => {
      let income = 0
      for (const t of selectedTickers) {
        if (tickerYearly[t]?.[yi]) income += tickerYearly[t][yi].annual_income
      }
      return { ...yt, annual_income: income }
    })
  }, [yearlyTotals, tickerYearly, tickerFilterActive, selectedTickers])

  const displayTotals = useMemo(() => {
    if (!tickerFilterActive) return totals
    const filtered = displayHoldings
    const currentIncome = filtered.reduce((s, h) => s + (h.current_annual_income || 0), 0)
    const projIncome = filtered.reduce((s, h) => s + (h.projected_annual_income || 0), 0)
    const newShares = filtered.reduce((s, h) => s + (h.new_shares || 0), 0)
    const growthPct = currentIncome > 0 ? ((projIncome - currentIncome) / currentIncome) * 100 : 0
    return {
      ...totals,
      current_annual_income: currentIncome,
      projected_annual_income: projIncome,
      total_new_shares: newShares,
      income_growth_pct: growthPct,
    }
  }, [totals, tickerFilterActive, displayHoldings])

  const perEtfContrib = useMemo(() => {
    if (monthlyAmount <= 0) return 0
    if (contributionTargeted && contributionTargets.length > 0) return monthlyAmount / contributionTargets.length
    return allTickers.length > 0 ? monthlyAmount / allTickers.length : 0
  }, [monthlyAmount, contributionTargeted, contributionTargets, allTickers])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        {/* Category Filter Dropdown — only show when categories are defined */}
        {categories.length > 0 && (
          <div style={{ position: 'relative' }} ref={catRef}>
            <label className="ne-label" style={{ marginRight: '0.4rem' }}>Categories</label>
            <button
              className="nep-btn"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: 160, textAlign: 'left' }}
              onClick={() => setCatOpen(o => !o)}
            >
              {selectedCats.length === 0 ? 'All Holdings' : `${selectedCats.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {catOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4,
                background: '#16213e', border: '1px solid #0f3460', borderRadius: 6,
                minWidth: 200, maxHeight: 300, overflowY: 'auto', padding: '0.4rem 0',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #0f3460', marginBottom: '0.2rem', color: '#e0e8f5', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={selectedCats.length === 0} onChange={() => setSelectedCats([])} style={{ accentColor: '#64b5f6' }} />
                  <span>All Holdings</span>
                </label>
                {categories.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', cursor: 'pointer', color: '#b0bec5', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedCats.includes(c.name)}
                      onChange={e => {
                        if (e.target.checked) setSelectedCats(prev => [...prev, c.name])
                        else setSelectedCats(prev => prev.filter(n => n !== c.name))
                      }}
                      style={{ accentColor: '#64b5f6' }}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ position: 'relative' }} ref={tickerFilterRef}>
          <label className="ne-label" style={{ marginRight: '0.4rem' }}>Tickers</label>
          <button
            className="nep-btn"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: 140, textAlign: 'left' }}
            onClick={() => setTickerFilterOpen(o => !o)}
          >
            {selectedTickers.length === 0 ? 'All' : `${selectedTickers.length} selected`}
            <span style={{ float: 'right', marginLeft: '0.5rem' }}>{tickerFilterOpen ? '\u25B4' : '\u25BE'}</span>
          </button>
          {tickerFilterOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4,
              background: '#16213e', border: '1px solid #0f3460', borderRadius: 6,
              minWidth: 180, maxHeight: 350, overflowY: 'auto', padding: '0.4rem 0',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #0f3460', marginBottom: '0.2rem', color: '#e0e8f5', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={selectedTickers.length === 0 && holdings.length > 0} onChange={() => { setSelectedTickers([]); if (holdings.length === 0) fetchProjection() }} style={{ accentColor: '#64b5f6' }} />
                <span>All</span>
              </label>
              {(() => {
                const baseList = portfolioTickers.length > 0 ? portfolioTickers : allTickers
                const customOnly = customTickers.filter(c => !baseList.includes(c.ticker)).map(c => c.ticker).sort()
                const tickerItem = (t, isCustom) => (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem', cursor: 'pointer', color: isCustom ? '#ffb74d' : '#b0bec5', fontSize: '0.82rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedTickers.includes(t)}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedTickers(prev => [...prev, t])
                          if (holdings.length === 0) fetchProjection()
                        } else {
                          setSelectedTickers(prev => prev.filter(x => x !== t))
                        }
                      }}
                      style={{ accentColor: isCustom ? '#ffb74d' : '#64b5f6' }}
                    />
                    <span>{t}</span>
                  </label>
                )
                return (
                  <>
                    {[...baseList].sort().map(t => tickerItem(t, false))}
                    {customOnly.length > 0 && (
                      <>
                        <div style={{ borderTop: '1px solid #0f3460', margin: '0.3rem 0', padding: '0.2rem 0.75rem', color: '#ffb74d', fontSize: '0.75rem', fontWeight: 600 }}>Added</div>
                        {customOnly.map(t => tickerItem(t, true))}
                      </>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.3rem' }}>
          <div>
            <label className="ne-label" style={{ display: 'block', marginBottom: '0.15rem' }}>Add Ticker</label>
            <input
              className="ne-input"
              style={{ width: 80, fontSize: '0.85rem', textTransform: 'uppercase' }}
              value={customTickerInput}
              onChange={e => setCustomTickerInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCustomTicker() }}
              placeholder="e.g. SCHD"
              disabled={customTickerLoading}
            />
          </div>
          <button onClick={addCustomTicker} disabled={customTickerLoading} className="nep-btn" style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}>
            {customTickerLoading ? '...' : 'Add'}
          </button>
        </div>
        {(selectedTickers.length > 0 || customTickers.length > 0 || holdings.length > 0) && (
          <button onClick={clearTickerFilter} className="nep-btn" style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem', background: '#6b2020', alignSelf: 'flex-end' }}>
            Clear
          </button>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="ne-label">Horizon:</span>
          <select className="ne-input" value={years} onChange={e => setYears(Number(e.target.value))} style={{ width: 100 }}>
            {DRIP_HORIZON_OPTIONS.map(y => <option key={y} value={y}>{y} {y === 1 ? 'year' : 'years'}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span className="ne-label">Set All:</span>
          <select className="ne-input" style={{ width: 80 }} value={setAllValue} onChange={e => { const v = Number(e.target.value); setSetAllValue(v); setAllPct(v) }}>
            {setAllValue === '' && <option value="">—</option>}
            {DRIP_PCT_OPTIONS.map(p => <option key={p} value={p}>{p}%</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={saveSettings} disabled={saving} className="nep-btn" style={{ background: '#1a6b3c' }}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {savedMsg && <span style={{ color: '#4dff91', fontSize: '0.78rem' }}>Saved!</span>}
        </div>
      </div>

      {/* Monthly Contribution */}
      <div className="nep-card" style={{ padding: '0.6rem 0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span className="ne-label">Monthly Contribution:</span>
            <span style={{ color: '#8899aa' }}>$</span>
            <input
              type="number" min="0" step="100"
              className="ne-input" style={{ width: 100 }}
              value={monthlyAmount || ''}
              onChange={e => setMonthlyAmount(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0"
            />
          </div>
          {monthlyAmount > 0 && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: '#b0bec5', fontSize: '0.82rem' }}>
                <input type="checkbox" checked={contributionTargeted} onChange={e => setContributionTargeted(e.target.checked)} style={{ accentColor: '#64b5f6' }} />
                Target Specific ETFs
              </label>
              {contributionTargeted && (
                <div style={{ position: 'relative' }} ref={contribPickerRef}>
                  <button
                    className="nep-btn"
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.82rem', minWidth: 140, textAlign: 'left' }}
                    onClick={() => setContribPickerOpen(o => !o)}
                  >
                    {contributionTargets.length === 0 ? 'Select ETFs' : `${contributionTargets.length} ETFs`}
                    <span style={{ float: 'right', marginLeft: '0.5rem' }}>{contribPickerOpen ? '\u25B4' : '\u25BE'}</span>
                  </button>
                  {contribPickerOpen && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4,
                      background: '#16213e', border: '1px solid #0f3460', borderRadius: 6,
                      minWidth: 180, maxHeight: 300, overflowY: 'auto', padding: '0.4rem 0',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    }}>
                      {allTickers.map(t => (
                        <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.75rem', cursor: 'pointer', color: '#b0bec5', fontSize: '0.82rem' }}>
                          <input
                            type="checkbox"
                            checked={contributionTargets.includes(t)}
                            onChange={e => {
                              if (e.target.checked) setContributionTargets(prev => [...prev, t])
                              else setContributionTargets(prev => prev.filter(x => x !== t))
                            }}
                            style={{ accentColor: '#64b5f6' }}
                          />
                          <span>{t}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <span style={{ color: '#8899aa', fontSize: '0.78rem' }}>
                Per ETF: <span style={{ color: '#7ecfff' }}>{fmt$(perEtfContrib)}</span>/mo
              </span>
            </>
          )}
        </div>
      </div>

      {/* Distribution Redirects */}
      <div className="nep-card" style={{ padding: '0.6rem 0.75rem', marginBottom: '0.75rem' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#e0e8f5', fontSize: '0.85rem' }}
          onClick={() => setRedirectsOpen(o => !o)}
        >
          <span>{redirectsOpen ? '\u25BC' : '\u25B6'}</span>
          <span style={{ fontWeight: 600 }}>Distribution Redirects</span>
          {redirects.filter(r => r.source && r.target).length > 0 && (
            <span style={{ color: '#ffb74d', fontSize: '0.76rem' }}>({redirects.filter(r => r.source && r.target).length} active)</span>
          )}
        </div>
        {redirectsOpen && (
          <div style={{ marginTop: '0.5rem' }}>
            <p style={{ color: '#8899aa', fontSize: '0.76rem', margin: '0 0 0.5rem 0' }}>
              Redirect dividends from one ETF to buy shares of another instead of reinvesting into itself.
            </p>
            {redirects.map((rd, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <select
                  className="ne-input" style={{ width: 100, fontSize: '0.82rem' }}
                  value={rd.source}
                  onChange={e => updateRedirect(i, 'source', e.target.value)}
                >
                  <option value="">Source...</option>
                  {allTickers.filter(t => t === rd.source || !usedSources.has(t)).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <span style={{ color: '#ffb74d', fontSize: '1rem' }}>{'\u2192'}</span>
                <select
                  className="ne-input" style={{ width: 100, fontSize: '0.82rem' }}
                  value={rd.target}
                  onChange={e => updateRedirect(i, 'target', e.target.value)}
                >
                  <option value="">Target...</option>
                  {allTickers.filter(t => t !== rd.source).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button onClick={() => removeRedirect(i)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '1rem', padding: '0 0.3rem' }}>{'\u2715'}</button>
              </div>
            ))}
            <button onClick={addRedirect} className="nep-btn" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', marginTop: '0.25rem' }}>
              + Add Redirect
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {displayTotals.current_annual_income != null && (
        <div className="nep-stat-row" style={{ marginBottom: '1rem' }}>
          <StatTile label="Current Annual Income" value={fmt$(displayTotals.current_annual_income)} color="#e0e8f5" />
          <StatTile label={`Projected (${years}yr)`} value={fmt$(displayTotals.projected_annual_income)} color="#00e89a" />
          <StatTile label="Income Growth" value={`${displayTotals.income_growth_pct >= 0 ? '+' : ''}${displayTotals.income_growth_pct?.toFixed(1)}%`}
            color={displayTotals.income_growth_pct >= 0 ? '#00e89a' : '#ff6b6b'} />
          <StatTile label="New Shares (DRIP + Contrib)" value={displayTotals.total_new_shares?.toLocaleString('en-US', { maximumFractionDigits: 2 })} color="#7ecfff" />
          {displayTotals.total_contributions > 0 && (
            <StatTile label="Total Contributions" value={fmt$(displayTotals.total_contributions)} color="#ffb74d" />
          )}
        </div>
      )}

      {/* Table */}
      <div className="nep-card" style={{ padding: '0.5rem', marginBottom: '1rem', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#8899aa' }}><span className="spinner" /> Loading projections...</div>
        ) : holdings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#8899aa' }}>No holdings found. Import portfolio data to use DRIP projections.</div>
        ) : (
          <table className="nep-table" style={{ fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {[
                  { key: 'ticker', label: 'Ticker' },
                  { key: 'description', label: 'Description' },
                  { key: 'category', label: 'Category' },
                  { key: '_invested', label: 'Invested', right: true, noSort: true },
                  { key: 'shares', label: 'Shares', right: true },
                  { key: 'price', label: 'Price', right: true },
                  { key: 'div_per_share', label: 'Div/Share', right: true },
                  { key: 'frequency', label: 'Freq' },
                  { key: 'yield_pct', label: 'Yield%', right: true },
                  { key: '_reinvest', label: 'Reinvest%', right: true, noSort: true },
                  { key: 'projected_shares', label: 'Proj Shares', right: true },
                  { key: 'projected_annual_income', label: 'Proj Annual', right: true },
                ].map(col => (
                  <th key={col.key}
                    style={{ cursor: col.noSort ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: col.right ? 'right' : 'left' }}
                    onClick={() => !col.noSort && handleSort(col.key)}>
                    {col.label}{!col.noSort ? sortIcon(col.key) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayHoldings.map(h => (
                <tr key={h.ticker}>
                  <td style={{ color: '#7ecfff', fontWeight: 600 }}>
                    {h.ticker}
                    {h.redirect_target && <span style={{ color: '#ffb74d', fontSize: '0.65rem', marginLeft: 4 }} title={`Dividends redirected to ${h.redirect_target}`}>{'\u2192'}{h.redirect_target}</span>}
                  </td>
                  <td style={{ color: '#b0bec5', fontSize: '0.76rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.description || '\u2014'}</td>
                  <td style={{ color: '#ab97c6', fontSize: '0.76rem' }}>{h.category}</td>
                  <td style={{ textAlign: 'right', padding: '0.2rem 0.4rem' }}>
                    <input
                      type="number"
                      className="ne-input"
                      style={{ width: 100, padding: '0.3rem 0.4rem', fontSize: '0.85rem', textAlign: 'right' }}
                      value={investmentOverrides[h.ticker] ?? Math.round(h.shares * h.price)}
                      onChange={e => {
                        const val = e.target.value === '' ? '' : Number(e.target.value)
                        setInvestmentOverrides(prev => {
                          const next = { ...prev, [h.ticker]: val }
                          investmentOverridesRef.current = next
                          return next
                        })
                      }}
                      onBlur={e => {
                        const val = Math.max(0, Math.round(Number(e.target.value) || 0))
                        const next = { ...investmentOverrides, [h.ticker]: val }
                        setInvestmentOverrides(next)
                        investmentOverridesRef.current = next
                        fetchProjection()
                      }}
                      min="0"
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>{h.shares?.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: 'right' }}>{fmt$(h.price)}</td>
                  <td style={{ textAlign: 'right' }}>{h.div_per_share != null ? '$' + h.div_per_share.toFixed(4) : '\u2014'}</td>
                  <td style={{ color: '#8899aa', fontSize: '0.76rem' }}>{h.frequency || '\u2014'}</td>
                  <td style={{ textAlign: 'right', color: '#ffb74d' }}>{h.yield_pct != null ? h.yield_pct.toFixed(2) + '%' : '\u2014'}</td>
                  <td style={{ textAlign: 'right', padding: '0.2rem 0.3rem' }}>
                    <select
                      value={dripSettings[h.ticker] ?? ''}
                      onChange={e => updateTickerPct(h.ticker, Number(e.target.value))}
                      className="ne-input"
                      style={{ width: 65, padding: '0.2rem 0.2rem', fontSize: '0.8rem' }}>
                      {!(h.ticker in dripSettings) && <option value="">—</option>}
                      {DRIP_PCT_OPTIONS.map(p => <option key={p} value={p}>{p}%</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', color: '#7ecfff', fontWeight: 600 }}>
                    {h.projected_shares?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    {h.new_shares > 0 && <span style={{ color: '#00e89a', fontSize: '0.68rem', marginLeft: 4 }}>+{h.new_shares.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>}
                  </td>
                  <td style={{ textAlign: 'right', color: '#00e89a', fontWeight: 600 }}>{fmt$(h.projected_annual_income)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #0f3460', background: '#16213e' }}>
                <td colSpan={3}><strong>TOTAL</strong></td>
                <td colSpan={5}></td>
                <td></td>
                <td style={{ textAlign: 'right', color: '#7ecfff', fontWeight: 700 }}>+{displayTotals.total_new_shares?.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right', color: '#00e89a', fontWeight: 700 }}>{fmt$(displayTotals.projected_annual_income)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Growth Chart */}
      {displayYearlyTotals.length > 1 && (
        <div className="nep-card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <Plot
            data={(() => {
              const tickers = Object.keys(displayTickerYearly)
              const xLabels = displayYearlyTotals.map(y => `Year ${y.year}`)
              // Baseline trace: flat line at Year 0 income (no DRIP)
              const baselineIncome = displayYearlyTotals.length > 0 ? displayYearlyTotals[0].annual_income : 0
              const baselineTrace = {
                x: xLabels, y: xLabels.map(() => baselineIncome),
                name: 'No DRIP Baseline', type: 'scatter', mode: 'lines',
                line: { color: '#555', width: 1.5, dash: 'dash' },
                hovertemplate: 'Baseline: $%{y:,.0f}<extra></extra>',
              }
              if (tickers.length <= 15 && tickers.length > 0) {
                const traces = tickers.map((t, i) => {
                  const series = displayTickerYearly[t] || []
                  return {
                    x: series.map(s => `Year ${s.year}`), y: series.map(s => s.annual_income),
                    name: t, type: 'scatter', mode: 'lines+markers',
                    line: { color: CHART_COLORS[i % CHART_COLORS.length], width: 2 },
                    marker: { size: 6, color: CHART_COLORS[i % CHART_COLORS.length] },
                    hovertemplate: `${t}: $%{y:,.0f}<extra></extra>`,
                  }
                })
                return [baselineTrace, ...traces]
              }
              return [baselineTrace, {
                x: xLabels, y: displayYearlyTotals.map(y => y.annual_income),
                name: 'Total Annual Income', type: 'scatter', mode: 'lines+markers',
                line: { color: '#00e89a', width: 3 }, marker: { size: 8, color: '#00e89a' },
                hovertemplate: '$%{y:,.0f}<extra></extra>',
              }]
            })()}
            layout={{
              paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
              title: { text: `Projected Annual Income \u2014 ${years}-Year DRIP${monthlyAmount > 0 ? ' + Contributions' : ''}`, font: { size: 14, color: '#e0e8f5' } },
              xaxis: { color: '#8899aa', gridcolor: '#1a2a3e' },
              yaxis: { title: { text: 'Annual Income ($)', font: { size: 12, color: '#e0e8f5' } }, gridcolor: '#1a2a3e', color: '#8899aa', tickprefix: '$', tickformat: ',.0f', rangemode: 'tozero', type: 'linear' },
              height: 400, margin: { l: 80, r: 30, t: 50, b: 40 },
              showlegend: true,
              legend: { font: { color: '#8899aa', size: 10 }, orientation: 'h', y: -0.15 },
            }}
            useResizeHandler
            style={{ width: '100%', height: 400 }}
            config={{ responsive: true }}
          />
        </div>
      )}
    </>
  )
}

export default function PortfolioIncomeSim() {
  // Mode
  const [mode, setMode] = useState('historical')
  // Historical settings
  const [startDate, setStartDate] = useState('2015-01-01')
  const [endDate, setEndDate] = useState('2025-12-31')
  // Simulation settings
  const [marketType, setMarketType] = useState('neutral')
  const [durationMonths, setDurationMonths] = useState(36)
  // Reinvestment comparison
  const [reinvestCompare, setReinvestCompare] = useState(false)
  const [reinvestSlider, setReinvestSlider] = useState(50)
  // Grid
  const [gridRows, setGridRows] = useState([{ ticker: '', amount: '', reinvest_pct: '', yield_override: '' }])
  // Comparison tickers
  const [compTickers, setCompTickers] = useState([])
  const [compReinvest, setCompReinvest] = useState({}) // ticker -> reinvest_pct
  const [compAmount, setCompAmount] = useState({}) // ticker -> amount
  const [compYieldOverride, setCompYieldOverride] = useState({}) // ticker -> yield override %
  const [compInput, setCompInput] = useState('')
  // Comparison dropdown (portfolio holdings)
  const [compPortfolioTickers, setCompPortfolioTickers] = useState([])
  const [compDropdownOpen, setCompDropdownOpen] = useState(false)
  const [compDropdownSearch, setCompDropdownSearch] = useState('')
  const compDropdownRef = React.useRef(null)
  // Saved
  const [savedList, setSavedList] = useState([])
  const [selectedSaved, setSelectedSaved] = useState('')
  // Save form
  const [saveFormOpen, setSaveFormOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveError, setSaveError] = useState(null)
  // Rename form
  const [renameFormOpen, setRenameFormOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState(null)
  // State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [savedMsg, setSavedMsg] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState(false)
  // Sort
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  // Portfolio picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTickers, setPickerTickers] = useState([])
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerChecked, setPickerChecked] = useState(new Set())

  // Load saved list + ETF list on mount
  const loadSavedList = useCallback(() => {
    fetch('/api/pis/saved').then(r => r.json()).then(d => setSavedList(d.saved || [])).catch(() => {})
  }, [])

  // Load portfolio tickers for comparison dropdown
  useEffect(() => {
    fetch('/api/pis/portfolio-tickers').then(r => r.json()).then(d => {
      setCompPortfolioTickers(d.tickers || [])
    }).catch(() => {})
  }, [])

  // Close comparison dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (compDropdownRef.current && !compDropdownRef.current.contains(e.target))
        setCompDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    loadSavedList()
    fetch('/api/pis/list').then(r => r.json()).then(d => {
      if (d.rows && d.rows.length > 0)
        setGridRows(d.rows.map(r => ({
          ticker: r.ticker, amount: String(r.amount),
          reinvest_pct: String(r.reinvest_pct),
          yield_override: r.yield_override != null ? String(r.yield_override) : '',
        })))
    }).catch(() => {})
  }, [loadSavedList])

  // Grid helpers
  const updateRow = (idx, field, value) => {
    setGridRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }
  const removeRow = (idx) => setGridRows(prev => prev.filter((_, i) => i !== idx))
  const addRow = () => {
    if (gridRows.length >= MAX_ROWS) return
    setGridRows(prev => [...prev, { ticker: '', amount: '', reinvest_pct: '', yield_override: '' }])
  }
  const clearGrid = () => {
    setGridRows([{ ticker: '', amount: '', reinvest_pct: '', yield_override: '' }])
    setResults(null)
    fetch('/api/pis/list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [] }),
    })
  }

  const collectRows = (src) => src
    .map(r => ({
      ticker: r.ticker.trim().toUpperCase(),
      amount: parseFloat(r.amount) || 0,
      reinvest_pct: parseFloat(r.reinvest_pct) || 0,
      yield_override: r.yield_override !== '' ? parseFloat(r.yield_override) || null : null,
    }))
    .filter(r => r.ticker)

  // Comparison tickers
  const updateCompReinvest = (ticker, val) => {
    setCompReinvest(prev => ({ ...prev, [ticker]: Math.min(100, Math.max(0, parseFloat(val) || 0)) }))
  }
  const updateCompAmount = (ticker, val) => {
    setCompAmount(prev => ({ ...prev, [ticker]: Math.max(0, parseFloat(val) || 0) }))
  }
  const updateCompYieldOverride = (ticker, val) => {
    setCompYieldOverride(prev => ({ ...prev, [ticker]: val === '' ? null : Math.min(100, Math.max(0, parseFloat(val) || 0)) }))
  }
  const addCompTicker = () => {
    const t = compInput.trim().toUpperCase()
    if (t && !compTickers.includes(t)) {
      setCompTickers(prev => [...prev, t])
      setCompReinvest(prev => ({ ...prev, [t]: 0 }))
      setCompAmount(prev => ({ ...prev, [t]: 10000 }))
      setCompYieldOverride(prev => ({ ...prev, [t]: null }))
    }
    setCompInput('')
  }
  const removeCompTicker = (t) => {
    setCompTickers(prev => prev.filter(x => x !== t))
    setCompReinvest(prev => { const next = { ...prev }; delete next[t]; return next })
    setCompAmount(prev => { const next = { ...prev }; delete next[t]; return next })
    setCompYieldOverride(prev => { const next = { ...prev }; delete next[t]; return next })
  }

  // Comparison dropdown helpers
  const toggleCompPortfolio = (ticker) => {
    setCompTickers(prev => {
      if (prev.includes(ticker)) return prev.filter(x => x !== ticker)
      return [...prev, ticker]
    })
    setCompReinvest(prev => {
      if (prev[ticker] !== undefined) { const next = { ...prev }; delete next[ticker]; return next }
      return { ...prev, [ticker]: 0 }
    })
    setCompAmount(prev => {
      if (prev[ticker] !== undefined) { const next = { ...prev }; delete next[ticker]; return next }
      return { ...prev, [ticker]: 10000 }
    })
    setCompYieldOverride(prev => {
      if (prev[ticker] !== undefined) { const next = { ...prev }; delete next[ticker]; return next }
      return { ...prev, [ticker]: null }
    })
  }
  const compSelectAll = () => {
    const all = compPortfolioTickers.map(t => t.ticker)
    setCompTickers(prev => {
      const set = new Set(prev)
      all.forEach(t => set.add(t))
      return [...set]
    })
    setCompReinvest(prev => {
      const next = { ...prev }
      all.forEach(t => { if (next[t] === undefined) next[t] = 0 })
      return next
    })
    setCompAmount(prev => {
      const next = { ...prev }
      all.forEach(t => { if (next[t] === undefined) next[t] = 10000 })
      return next
    })
    setCompYieldOverride(prev => {
      const next = { ...prev }
      all.forEach(t => { if (next[t] === undefined) next[t] = null })
      return next
    })
  }
  const compClearAll = () => {
    const portfolioSet = new Set(compPortfolioTickers.map(t => t.ticker))
    setCompTickers(prev => prev.filter(t => !portfolioSet.has(t)))
    setCompReinvest(prev => {
      const next = { ...prev }
      portfolioSet.forEach(t => delete next[t])
      return next
    })
    setCompAmount(prev => {
      const next = { ...prev }
      portfolioSet.forEach(t => delete next[t])
      return next
    })
    setCompYieldOverride(prev => {
      const next = { ...prev }
      portfolioSet.forEach(t => delete next[t])
      return next
    })
  }
  const filteredCompPortfolio = useMemo(() => {
    const q = compDropdownSearch.toLowerCase()
    return compPortfolioTickers.filter(t =>
      !q || t.ticker.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    )
  }, [compPortfolioTickers, compDropdownSearch])
  const allPortfolioSelected = useMemo(() => {
    return compPortfolioTickers.length > 0 && compPortfolioTickers.every(t => compTickers.includes(t.ticker))
  }, [compPortfolioTickers, compTickers])
  const compPortfolioCount = useMemo(() => {
    const pSet = new Set(compPortfolioTickers.map(t => t.ticker))
    return compTickers.filter(t => pSet.has(t)).length
  }, [compPortfolioTickers, compTickers])
  const compCustomTickers = useMemo(() => {
    const pSet = new Set(compPortfolioTickers.map(t => t.ticker))
    return compTickers.filter(t => !pSet.has(t))
  }, [compPortfolioTickers, compTickers])

  // Save list
  const saveList = () => {
    const rows = collectRows(gridRows)
    return fetch('/api/pis/list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    }).then(r => r.json()).then(d => {
      if (d.error) { setError(d.error); return false }
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2500)
      return true
    })
  }

  // Load saved
  const loadSaved = () => {
    if (!selectedSaved) return
    fetch('/api/pis/saved/' + selectedSaved).then(r => r.json()).then(d => {
      if (d.error) { alert(d.error); return }
      setMode(d.mode || 'historical')
      if (d.mode === 'historical' || !d.mode) {
        if (d.start) setStartDate(d.start)
        if (d.end) setEndDate(d.end)
      } else {
        if (d.market_type) setMarketType(d.market_type)
        if (d.duration_months) setDurationMonths(d.duration_months)
      }
      const rows = (d.rows || []).map(r => ({
        ticker: r.ticker || '', amount: String(r.amount || ''),
        reinvest_pct: String(r.reinvest_pct || ''),
        yield_override: r.yield_override != null ? String(r.yield_override) : '',
      }))
      setGridRows(rows.length > 0 ? rows : [{ ticker: '', amount: '', reinvest_pct: '', yield_override: '' }])
      // Restore comparison tickers, reinvest %, amounts, and yield overrides
      const comp = d.comparison_tickers || []
      const tickers = []
      const reinvMap = {}
      const amtMap = {}
      const yieldMap = {}
      comp.forEach(c => {
        const t = typeof c === 'string' ? c : c.ticker
        const rp = typeof c === 'object' ? (c.reinvest_pct || 0) : 0
        const amt = typeof c === 'object' ? (c.amount || 10000) : 10000
        const yo = typeof c === 'object' ? (c.yield_override ?? null) : null
        if (t) { tickers.push(t); reinvMap[t] = rp; amtMap[t] = amt; yieldMap[t] = yo }
      })
      setCompTickers(tickers)
      setCompReinvest(reinvMap)
      setCompAmount(amtMap)
      setCompYieldOverride(yieldMap)
      setResults(null)
      if (rows.length === 0 && tickers.length === 0) {
        alert('Warning: This saved simulation has no ETFs. Add tickers before running.')
      }
    }).catch(err => alert('Load failed: ' + err.message))
  }

  // Delete saved
  const deleteSaved = () => {
    if (!selectedSaved) return
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    if (!confirm('Delete "' + (sel?.name || '') + '"?')) return
    fetch('/api/pis/saved/' + selectedSaved, { method: 'DELETE' })
      .then(r => r.json()).then(d => {
        if (d.error) { alert(d.error); return }
        setDeleteMsg(true)
        setTimeout(() => setDeleteMsg(false), 2000)
        setSelectedSaved('')
        loadSavedList()
      })
  }

  // Save simulation
  const confirmSaveSim = () => {
    const name = saveName.trim()
    if (!name) { setSaveError('Please enter a name.'); return }
    const rows = collectRows(gridRows)
    const payload = { name, mode, rows, comparison_tickers: compTickers.map(t => ({ ticker: t, reinvest_pct: compReinvest[t] || 0, amount: compAmount[t] || 10000, yield_override: compYieldOverride[t] ?? null })) }
    if (mode === 'historical') { payload.start = startDate; payload.end = endDate }
    else { payload.market_type = marketType; payload.duration_months = durationMonths }
    fetch('/api/pis/saved', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json()).then(d => {
      if (d.error) { setSaveError(d.error); return }
      setSaveFormOpen(false); setSaveName('')
      loadSavedList()
      setTimeout(() => setSelectedSaved(String(d.id)), 300)
    }).catch(err => setSaveError('Save failed: ' + err.message))
  }

  // Rename
  const openRename = () => {
    if (!selectedSaved) { alert('Select a simulation first.'); return }
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    setRenameName(sel?.name || '')
    setRenameError(null)
    setRenameFormOpen(true)
  }
  const confirmRename = () => {
    const name = renameName.trim()
    if (!name) { setRenameError('Enter a name.'); return }
    fetch('/api/pis/saved/' + selectedSaved).then(r => r.json()).then(d => {
      if (d.error) { setRenameError(d.error); return }
      return fetch('/api/pis/saved/' + selectedSaved, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mode: d.mode, rows: d.rows, start: d.start, end: d.end, market_type: d.market_type, duration_months: d.duration_months, comparison_tickers: d.comparison_tickers || [] }),
      }).then(r => r.json())
    }).then(d => {
      if (!d || d.error) { setRenameError((d && d.error) || 'Failed.'); return }
      setRenameFormOpen(false)
      loadSavedList()
    }).catch(err => setRenameError('Failed: ' + err.message))
  }

  // Update saved with current grid
  const updateSaved = () => {
    if (!selectedSaved) { alert('Select a simulation first.'); return }
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    const rows = collectRows(gridRows)
    const payload = { name: sel?.name || 'Unnamed', mode, rows, comparison_tickers: compTickers.map(t => ({ ticker: t, reinvest_pct: compReinvest[t] || 0, amount: compAmount[t] || 10000, yield_override: compYieldOverride[t] ?? null })) }
    if (mode === 'historical') { payload.start = startDate; payload.end = endDate }
    else { payload.market_type = marketType; payload.duration_months = durationMonths }
    fetch('/api/pis/saved/' + selectedSaved, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json()).then(d => {
      if (d.error) { alert(d.error); return }
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2500)
      loadSavedList()
    })
  }

  // Run simulation
  const runSim = () => {
    setError(null); setResults(null); setLoading(true)
    const rows = collectRows(gridRows)
    const payload = { mode, rows, comparison_tickers: compTickers.map(t => ({ ticker: t, reinvest_pct: compReinvest[t] || 0, amount: compAmount[t] || 10000, yield_override: compYieldOverride[t] ?? null })) }
    if (mode === 'historical') { payload.start = startDate; payload.end = endDate }
    else { payload.market_type = marketType; payload.duration_months = durationMonths }
    if (reinvestCompare) {
      payload.reinvest_compare = true
      payload.reinvest_compare_pct = reinvestSlider
    }

    // Save list first
    fetch('/api/pis/list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    }).then(() => {
      fetch('/api/pis/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json()).then(data => {
        setLoading(false)
        if (data.error) { setError(data.error); return }
        const res = data.results || []
        setResults(res)
      }).catch(err => { setLoading(false); setError('Request failed: ' + err.message) })
    })
  }

  // Portfolio picker
  const openPicker = () => {
    setPickerSearch(''); setPickerChecked(new Set()); setPickerOpen(true)
    fetch('/api/pis/portfolio-tickers').then(r => r.json()).then(d => {
      setPickerTickers(d.tickers || [])
    }).catch(() => setPickerTickers([]))
  }

  const existingTickers = useMemo(() => new Set(gridRows.map(r => r.ticker.trim().toUpperCase()).filter(Boolean)), [gridRows])

  const filteredPicker = useMemo(() => {
    const q = pickerSearch.toLowerCase()
    return pickerTickers.filter(t =>
      !q || t.ticker.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    )
  }, [pickerTickers, pickerSearch])

  const togglePickerCheck = (ticker) => {
    setPickerChecked(prev => {
      const next = new Set(prev)
      next.has(ticker) ? next.delete(ticker) : next.add(ticker)
      return next
    })
  }

  const pickerSelectAll = () => {
    const newSet = new Set(pickerChecked)
    filteredPicker.forEach(t => { if (!existingTickers.has(t.ticker)) newSet.add(t.ticker) })
    setPickerChecked(newSet)
  }
  const pickerClearAll = () => setPickerChecked(new Set())

  const pickerAddSelected = () => {
    const toAdd = pickerTickers.filter(t => pickerChecked.has(t.ticker))
    if (toAdd.length === 0) return
    // Remove empty rows
    const nonEmpty = gridRows.filter(r => r.ticker.trim())
    if (nonEmpty.length + toAdd.length > MAX_ROWS) {
      alert(`Adding ${toAdd.length} tickers would exceed the ${MAX_ROWS} row limit.`)
      return
    }
    const newRows = toAdd.map(t => ({
      ticker: t.ticker,
      amount: String(Math.round(t.amount)),
      reinvest_pct: t.drip ? '100' : '0',
      yield_override: '',
    }))
    setGridRows([...nonEmpty, ...newRows])
    setPickerOpen(false)
  }

  const pickerAddAll = () => {
    setPickerSearch('')
    const all = pickerTickers.filter(t => !existingTickers.has(t.ticker))
    if (all.length === 0) return
    const nonEmpty = gridRows.filter(r => r.ticker.trim())
    if (nonEmpty.length + all.length > MAX_ROWS) {
      alert(`Adding ${all.length} tickers would exceed the ${MAX_ROWS} row limit.`)
      return
    }
    const newRows = all.map(t => ({
      ticker: t.ticker,
      amount: String(Math.round(t.amount)),
      reinvest_pct: t.drip ? '100' : '0',
      yield_override: '',
    }))
    setGridRows([...nonEmpty, ...newRows])
    setPickerOpen(false)
  }

  // Sorting
  const isSim = mode === 'simulate'
  const colKeys = ['ticker', 'amount', 'reinvest_pct', 'start_price', 'end_price',
    'price_delta_pct', 'ttm_yield_pct',
    ...(isSim ? ['_hist_mean', '_hist_vol', '_hist_skew'] : []),
    'total_dist', 'effective_yield_pct',
    'total_reinvested', 'final_value', 'gain_loss_dollar', 'gain_loss_pct',
    'has_erosion', 'final_deficit', 'warning']

  const sortedResults = useMemo(() => {
    if (!results) return []
    const arr = [...results]
    if (sortCol !== null) {
      const key = colKeys[sortCol]
      const getSortVal = (r, k) => {
        if (k === '_hist_mean') return r.sim_stats?.hist_mean_monthly ?? ''
        if (k === '_hist_vol') return r.sim_stats?.hist_sigma_monthly ?? ''
        if (k === '_hist_skew') return r.sim_stats?.hist_skewness ?? ''
        return r[k] ?? ''
      }
      arr.sort((a, b) => {
        let aV = getSortVal(a, key), bV = getSortVal(b, key)
        if (key === 'has_erosion') { aV = aV ? 1 : 0; bV = bV ? 1 : 0 }
        if (typeof aV === 'number' && typeof bV === 'number')
          return sortAsc ? aV - bV : bV - aV
        return sortAsc ? String(aV).localeCompare(String(bV)) : String(bV).localeCompare(String(aV))
      })
    }
    return arr
  }, [results, sortCol, sortAsc])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }
  const arrow = (col) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  // When reinvest_compare is on, results have two rows per ticker (baseline + reinvested).
  const hasCompareGroupsRaw = useMemo(() => {
    return results ? results.some(r => r.compare_group) : false
  }, [results])

  // Merge baseline + reinvested rows into single objects for side-by-side display
  const mergedResults = useMemo(() => {
    if (!results) return []
    if (!hasCompareGroupsRaw) return sortedResults
    // Group by ticker (preserving order of first appearance)
    const seen = new Map()
    const order = []
    results.forEach(r => {
      const key = r.ticker + (r.is_comparison ? '__comp' : '')
      if (!seen.has(key)) {
        seen.set(key, { baseline: null, reinvested: null, single: null })
        order.push(key)
      }
      const entry = seen.get(key)
      if (r.compare_group === 'baseline') entry.baseline = r
      else if (r.compare_group === 'reinvested') entry.reinvested = r
      else entry.single = r
    })
    return order.map(key => {
      const { baseline, reinvested, single } = seen.get(key)
      if (single) return { merged: false, row: single }
      return { merged: true, baseline, reinvested, ticker: (baseline || reinvested).ticker, is_comparison: (baseline || reinvested).is_comparison }
    })
  }, [results, sortedResults, hasCompareGroupsRaw])

  const summary = useMemo(() => {
    if (!results) return null
    // Check if there are any non-comparison rows with data
    const hasPortfolioRows = results.some(r => !r.is_comparison && !r.error)
    let totAmount = 0, totDist = 0, totReinv = 0, totFinal = 0, totGL = 0
    let erosionCount = 0, erosionValid = 0, validCount = 0, errorCount = 0, best = null, worst = null
    results.forEach(r => {
      // If we have portfolio rows, exclude comparisons; otherwise include everything
      if (hasPortfolioRows && r.is_comparison) return
      // When reinvest compare is on, only count 'reinvested' rows for summary (skip 'baseline')
      if (hasCompareGroupsRaw && r.compare_group === 'baseline') return
      if (r.error && !r.start_price) { errorCount++; return }
      validCount++
      totAmount += r.amount || 0
      totDist += r.total_dist || 0
      totReinv += r.total_reinvested || 0
      totFinal += r.final_value || 0
      totGL += r.gain_loss_dollar || 0
      if (best === null || r.gain_loss_pct > best.gain_loss_pct) best = r
      if (worst === null || r.gain_loss_pct < worst.gain_loss_pct) worst = r
    })
    // NAV erosion: count from baseline rows only (erosion measures price decline, not reinvestment impact)
    if (hasCompareGroupsRaw) {
      results.forEach(r => {
        if (hasPortfolioRows && r.is_comparison) return
        if (r.compare_group !== 'baseline') return
        if (r.error && !r.start_price) return
        erosionValid++
        if (r.has_erosion) erosionCount++
      })
    } else {
      results.forEach(r => {
        if (hasPortfolioRows && r.is_comparison) return
        if (r.error && !r.start_price) return
        erosionValid++
        if (r.has_erosion) erosionCount++
      })
    }
    const totGLPct = totAmount > 0 ? totGL / totAmount * 100 : 0
    const totEffYld = totAmount > 0 ? totDist / totAmount * 100 : 0
    return { totAmount, totDist, totReinv, totFinal, totGL, totGLPct, totEffYld, erosionCount, erosionValid: erosionValid || validCount, validCount, errorCount, best, worst }
  }, [results, hasCompareGroupsRaw])

  // Chart data
  const chartableResults = useMemo(() => {
    if (!results) return []
    return results.filter(r => !r.error && r.monthly_prices?.length > 0)
  }, [results])

  // Helper to aggregate an array of results into one line
  const aggregateLine = (items) => {
    if (items.length === 0) return null
    const longest = items.reduce((a, b) => (a.date_labels?.length || 0) >= (b.date_labels?.length || 0) ? a : b)
    const dates = longest.date_labels || []
    const len = dates.length
    const totalVals = new Array(len).fill(0)
    const totalDivs = new Array(len).fill(0)
    items.forEach(r => {
      const vals = r.monthly_portfolio_vals || []
      const divs = r.monthly_dividends || []
      for (let i = 0; i < len; i++) {
        totalVals[i] += vals[i] || 0
        totalDivs[i] += divs[i] || 0
      }
    })
    return { dates, totalVals, totalDivs }
  }

  // Split results into groups for charting
  const portfolioCompSet = useMemo(() => new Set(compPortfolioTickers.map(t => t.ticker)), [compPortfolioTickers])

  // Detect if results contain reinvest comparison data
  const hasCompareGroups = useMemo(() => {
    return chartableResults.some(r => r.compare_group)
  }, [chartableResults])

  const chartLines = useMemo(() => {
    // Comparison tickers always have a single row (no baseline/reinvested split)
    const compResults = chartableResults.filter(r => r.is_comparison)
    const dropdownComps = compResults.filter(r => portfolioCompSet.has(r.ticker))
    const customComps = compResults.filter(r => !portfolioCompSet.has(r.ticker))

    if (hasCompareGroups) {
      // Reinvest comparison mode: split portfolio into baseline (0%) and reinvested (slider%)
      const baseline = chartableResults.filter(r => !r.is_comparison && r.compare_group === 'baseline')
      const reinvested = chartableResults.filter(r => !r.is_comparison && r.compare_group === 'reinvested')
      const pct = reinvested.length > 0 ? reinvested[0].reinvest_pct : 0
      return {
        baselineLine: aggregateLine(baseline),
        reinvestedLine: aggregateLine(reinvested),
        reinvestedPct: pct,
        portfolioLine: null,
        dropdownLine: aggregateLine(dropdownComps),
        dropdownTickers: dropdownComps.map(r => r.ticker),
        customLine: aggregateLine(customComps),
        customTickers: customComps.map(r => r.ticker),
      }
    }

    // Normal mode: single portfolio line
    const portfolio = chartableResults.filter(r => !r.is_comparison)
    return {
      baselineLine: null,
      reinvestedLine: null,
      reinvestedPct: 0,
      portfolioLine: aggregateLine(portfolio),
      dropdownLine: aggregateLine(dropdownComps),
      dropdownTickers: dropdownComps.map(r => r.ticker),
      customLine: aggregateLine(customComps),
      customTickers: customComps.map(r => r.ticker),
    }
  }, [chartableResults, portfolioCompSet, hasCompareGroups])

  // Build chart traces
  const valueChartTraces = useMemo(() => {
    const { portfolioLine, baselineLine, reinvestedLine, reinvestedPct,
            dropdownLine, dropdownTickers, customLine, customTickers } = chartLines
    const traces = []

    if (baselineLine) {
      traces.push({
        x: baselineLine.dates, y: baselineLine.totalVals,
        name: 'No Reinvestment (0%)', type: 'scatter', mode: 'lines',
        line: { color: '#ff6b6b', width: 3 },
        hovertemplate: '<b>%{x}</b><br>0% Reinvest: $%{y:,.2f}<extra></extra>',
      })
    }
    if (reinvestedLine) {
      traces.push({
        x: reinvestedLine.dates, y: reinvestedLine.totalVals,
        name: `Reinvest ${reinvestedPct}%`, type: 'scatter', mode: 'lines',
        line: { color: '#00e89a', width: 3 },
        hovertemplate: `<b>%{x}</b><br>${reinvestedPct}% Reinvest: $%{y:,.2f}<extra></extra>`,
      })
    }
    if (portfolioLine) {
      traces.push({
        x: portfolioLine.dates, y: portfolioLine.totalVals,
        name: 'Simulated Tickers (Aggregate)', type: 'scatter', mode: 'lines',
        line: { color: '#00e89a', width: 3 },
        hovertemplate: '<b>%{x}</b><br>Simulated Tickers (Aggregate): $%{y:,.2f}<extra></extra>',
      })
    }
    if (dropdownLine) {
      const label = 'Portfolio Comp (' + dropdownTickers.join(', ') + ')'
      traces.push({
        x: dropdownLine.dates, y: dropdownLine.totalVals,
        name: label, type: 'scatter', mode: 'lines',
        line: { color: '#7ecfff', width: 2, dash: 'dash' },
        hovertemplate: '<b>%{x}</b><br>' + label + ': $%{y:,.2f}<extra></extra>',
      })
    }
    if (customLine) {
      const label = 'Custom (' + customTickers.join(', ') + ')'
      traces.push({
        x: customLine.dates, y: customLine.totalVals,
        name: label, type: 'scatter', mode: 'lines',
        line: { color: '#f9a825', width: 2, dash: 'dashdot' },
        hovertemplate: '<b>%{x}</b><br>' + label + ': $%{y:,.2f}<extra></extra>',
      })
    }
    return traces
  }, [chartLines])

  const divChartTraces = useMemo(() => {
    const { portfolioLine, baselineLine, reinvestedLine, reinvestedPct,
            dropdownLine, dropdownTickers, customLine, customTickers } = chartLines
    const traces = []
    if (baselineLine) {
      traces.push({
        x: baselineLine.dates, y: baselineLine.totalDivs,
        name: 'No Reinvestment (0%)', type: 'scatter', mode: 'lines',
        line: { color: '#ff6b6b', width: 3 },
        hovertemplate: '<b>%{x}</b><br>0% Reinvest: $%{y:,.2f}<extra></extra>',
      })
    }
    if (reinvestedLine) {
      traces.push({
        x: reinvestedLine.dates, y: reinvestedLine.totalDivs,
        name: `Reinvest ${reinvestedPct}%`, type: 'scatter', mode: 'lines',
        line: { color: '#00e89a', width: 3 },
        hovertemplate: `<b>%{x}</b><br>${reinvestedPct}% Reinvest: $%{y:,.2f}<extra></extra>`,
      })
    }
    if (portfolioLine) {
      traces.push({
        x: portfolioLine.dates, y: portfolioLine.totalDivs,
        name: 'Simulated Tickers (Aggregate)', type: 'scatter', mode: 'lines',
        line: { color: '#00e89a', width: 3 },
        hovertemplate: '<b>%{x}</b><br>Simulated Tickers (Aggregate): $%{y:,.2f}<extra></extra>',
      })
    }
    if (dropdownLine) {
      const label = 'Portfolio Comp (' + dropdownTickers.join(', ') + ')'
      traces.push({
        x: dropdownLine.dates, y: dropdownLine.totalDivs,
        name: label, type: 'scatter', mode: 'lines',
        line: { color: '#7ecfff', width: 2, dash: 'dash' },
        hovertemplate: '<b>%{x}</b><br>' + label + ': $%{y:,.2f}<extra></extra>',
      })
    }
    if (customLine) {
      const label = 'Custom (' + customTickers.join(', ') + ')'
      traces.push({
        x: customLine.dates, y: customLine.totalDivs,
        name: label, type: 'scatter', mode: 'lines',
        line: { color: '#f9a825', width: 2, dash: 'dashdot' },
        hovertemplate: '<b>%{x}</b><br>' + label + ': $%{y:,.2f}<extra></extra>',
      })
    }
    return traces
  }, [chartLines])

  const headers = ['Ticker', 'Amount', 'Reinvest %', 'Start Price', 'End Price',
    'Price \u0394%', 'TTM Yield',
    ...(isSim ? ['Hist \u03BC%', 'Hist \u03C3%', 'Skew'] : []),
    'Total Dist', 'Cum Yield', 'Reinvested',
    'Final Value', 'Gain/Loss $', 'Gain/Loss %', 'NAV Erosion', 'Deficit', 'Note']

  // Get reinvest pct label for compare mode header
  const compareReinvestPct = useMemo(() => {
    if (!results || !hasCompareGroupsRaw) return 0
    const rRow = results.find(r => r.compare_group === 'reinvested')
    return rRow ? rRow.reinvest_pct : 0
  }, [results, hasCompareGroupsRaw])

  const compareSubHeaders = ['Total Dist', 'Cum Yield', 'Reinvested', 'Final Value', 'G/L $', 'G/L %']

  return (
    <div className="nep-page">
      <h1 style={{ marginBottom: '0.3rem' }}>Portfolio Income Simulator</h1>
      <p className="ne-desc">
        Simulate income generation across your portfolio using historical data or Monte-Carlo
        forward projection. Each ETF can have its own investment amount, reinvestment %, and
        optional yield override. Add comparison tickers to benchmark performance.
      </p>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`pis-mode-btn ${mode === 'historical' ? 'pis-mode-active-hist' : ''}`}
          onClick={() => setMode('historical')}
        >Historical Backtest</button>
        <button
          className={`pis-mode-btn ${mode === 'simulate' ? 'pis-mode-active-sim' : ''}`}
          onClick={() => setMode('simulate')}
        >Market Simulation</button>
        <button
          className={`pis-mode-btn ${mode === 'drip' ? 'pis-mode-active-hist' : ''}`}
          onClick={() => setMode('drip')}
        >DRIP Projections</button>
      </div>

      {/* DRIP Projections Mode */}
      {mode === 'drip' && <DripProjectionsPanel />}

      {mode !== 'drip' && <>
      {/* Settings */}
      {mode === 'historical' ? (
        <div className="ne-form" style={{ marginBottom: '1rem' }}>
          <div className="ne-field">
            <label className="ne-label">Start Date</label>
            <input className="ne-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="ne-field">
            <label className="ne-label">End Date</label>
            <input className="ne-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="ne-form" style={{ marginBottom: '1rem', flexDirection: 'column', gap: '0.7rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="ne-label" style={{ marginRight: '0.3rem' }}>Market Bias:</span>
            {['bullish', 'neutral', 'bearish'].map(k => {
              const color = k === 'bullish' ? '#00c853' : k === 'bearish' ? '#e05555' : '#f9a825'
              return (
                <button key={k}
                  className={`pis-market-btn ${marketType === k ? 'active' : ''}`}
                  style={marketType === k ? { borderColor: color, color } : {}}
                  onClick={() => setMarketType(k)}
                >{k.charAt(0).toUpperCase() + k.slice(1)}</button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="ne-label" style={{ marginRight: '0.3rem' }}>Duration:</span>
            {[{ l: '1yr', m: 12 }, { l: '3yr', m: 36 }, { l: '5yr', m: 60 }, { l: '10yr', m: 120 }].map(d => (
              <button key={d.m}
                className={`pis-dur-btn ${durationMonths === d.m ? 'active' : ''}`}
                onClick={() => setDurationMonths(d.m)}
              >{d.l}</button>
            ))}
            <input className="ne-input" type="number" min="1" max="600" value={durationMonths}
              style={{ width: 70, textAlign: 'center' }}
              onChange={e => setDurationMonths(parseInt(e.target.value) || 36)} />
            <span className="ne-label">months</span>
          </div>
        </div>
      )}

      {/* Reinvestment comparison toggle */}
      <div className="ne-form" style={{ marginBottom: '1rem', alignItems: 'center' }}>
        <label className="pis-reinv-toggle">
          <input type="checkbox" checked={reinvestCompare}
            onChange={e => setReinvestCompare(e.target.checked)}
            style={{ accentColor: '#a78bfa', marginRight: 6 }} />
          Compare Reinvestment Impact
        </label>
        {reinvestCompare && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1 }}>
            <span className="ne-label">0%</span>
            <input type="range" min="0" max="100" step="1" value={reinvestSlider}
              onChange={e => setReinvestSlider(parseInt(e.target.value))}
              style={{ flex: 1, maxWidth: 300, accentColor: '#a78bfa' }} />
            <span className="ne-label">100%</span>
            <input className="ne-input" type="number" min="0" max="100" step="1"
              value={reinvestSlider} onChange={e => setReinvestSlider(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
              style={{ width: 60, textAlign: 'center' }} />
            <span className="ne-label">%</span>
          </div>
        )}
      </div>

      {/* Saved simulations */}
      <div className="nep-saved-panel">
        <span className="nep-saved-label">Saved:</span>
        <select className="nep-saved-select" value={selectedSaved} onChange={e => setSelectedSaved(e.target.value)}>
          <option value="">— no saved simulations —</option>
          {savedList.map(s => {
            const ml = s.mode === 'simulate'
              ? `[Sim ${s.market_type || ''} ${s.duration_months || '?'}mo]`
              : `[Hist ${s.start_date || '?'} \u2192 ${s.end_date || '?'}]`
            return <option key={s.id} value={s.id}>{s.name}  {ml}  [{s.created_at}]</option>
          })}
        </select>
        <button className="nep-btn" onClick={loadSaved}>Load</button>
        <button className="nep-btn" onClick={openRename}>Rename</button>
        <button className="nep-btn" onClick={updateSaved}>Update</button>
        <button className="nep-btn nep-btn-del" onClick={deleteSaved}>Delete</button>
        {deleteMsg && <span style={{ color: '#00c853', fontSize: '0.78rem' }}>Deleted</span>}
      </div>

      {/* Rename form */}
      {renameFormOpen && (
        <div className="nep-bt-form" style={{ marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label className="ne-label">New name:</label>
            <input className="ne-input" style={{ flex: 1, minWidth: 200 }} value={renameName}
              onChange={e => setRenameName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenameFormOpen(false) }}
              autoFocus />
            <button className="nep-btn nep-btn-purple" onClick={confirmRename}>Rename</button>
            <button className="nep-btn" onClick={() => setRenameFormOpen(false)}>Cancel</button>
          </div>
          {renameError && <span style={{ color: '#e05555', fontSize: '0.78rem' }}>{renameError}</span>}
        </div>
      )}

      {/* ETF grid */}
      <div className="nep-grid-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
          <button className="nep-btn" onClick={addRow} disabled={gridRows.length >= MAX_ROWS}>+ Add ETF Row</button>
          <span style={{ fontSize: '0.75rem', color: '#666' }}>
            Add tickers to simulate — one per row ({gridRows.length} / {MAX_ROWS})
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="nep-grid-tbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', width: 100 }}>Ticker</th>
                <th style={{ textAlign: 'left', width: 140 }}>Amount ($)</th>
                <th style={{ textAlign: 'left', width: 140 }}>Reinvest %</th>
                <th style={{ textAlign: 'left', width: 140 }}>Yield Override %</th>
                <th style={{ width: 40 }}></th>
              </tr>
              <tr style={{ fontSize: '0.68rem', color: '#666' }}>
                <th style={{ textAlign: 'left', fontWeight: 400, paddingTop: 0 }}>ETF / stock symbol</th>
                <th style={{ textAlign: 'left', fontWeight: 400, paddingTop: 0 }}>$ to invest</th>
                <th style={{ textAlign: 'left', fontWeight: 400, paddingTop: 0 }}>% divs reinvested</th>
                <th style={{ textAlign: 'left', fontWeight: 400, paddingTop: 0 }}>Manual yield (blank=auto)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gridRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input className="ne-input" style={{ width: 80, textTransform: 'uppercase' }}
                      maxLength={10} placeholder="e.g. QQQI" value={r.ticker}
                      onChange={e => updateRow(i, 'ticker', e.target.value.toUpperCase())} />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input className="ne-input" type="number" min="1" step="100"
                      style={{ width: 110, textAlign: 'right' }} placeholder="e.g. 10000"
                      value={r.amount} onChange={e => updateRow(i, 'amount', e.target.value)} />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input className="ne-input" type="number" min="0" max="100" step="1"
                      style={{ width: 100, textAlign: 'right' }} placeholder="0-100"
                      value={r.reinvest_pct} onChange={e => updateRow(i, 'reinvest_pct', e.target.value)} />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input className="ne-input" type="number" min="0" max="100" step="0.1"
                      style={{ width: 100, textAlign: 'right', borderColor: '#2a4a3e' }} placeholder="auto"
                      value={r.yield_override} onChange={e => updateRow(i, 'yield_override', e.target.value)} />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem', textAlign: 'center' }}>
                    <button className="nep-row-del" title="Remove" onClick={() => removeRow(i)}>&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Comparison tickers */}
        <div style={{ marginTop: '0.7rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <span className="ne-label" style={{ whiteSpace: 'nowrap' }}>Compare to:</span>

            {/* Portfolio multiselect dropdown */}
            <div className="pis-comp-dropdown" ref={compDropdownRef}>
              <button className="pis-comp-dropdown-btn" onClick={() => setCompDropdownOpen(o => !o)}>
                {compPortfolioCount > 0
                  ? `Portfolio (${compPortfolioCount} selected)`
                  : 'Select from Portfolio'}
                <span className="nav-arrow" style={{ marginLeft: 6 }}>{compDropdownOpen ? '\u25B4' : '\u25BE'}</span>
              </button>
              {compDropdownOpen && (
                <div className="pis-comp-dropdown-menu">
                  <input className="ne-input" style={{ width: '100%', marginBottom: '0.4rem', fontSize: '0.82rem' }}
                    placeholder="Search..." value={compDropdownSearch}
                    onChange={e => setCompDropdownSearch(e.target.value)} autoFocus />
                  <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                    <button className="nep-btn" style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                      onClick={compSelectAll}>Select All</button>
                    <button className="nep-btn" style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                      onClick={compClearAll}>Clear All</button>
                    <span style={{ color: '#aaa', fontSize: '0.75rem', marginLeft: 'auto' }}>{compPortfolioCount} / {compPortfolioTickers.length}</span>
                  </div>
                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {filteredCompPortfolio.map(t => (
                      <label key={t.ticker} className="pis-comp-dropdown-item">
                        <input type="checkbox" checked={compTickers.includes(t.ticker)}
                          onChange={() => toggleCompPortfolio(t.ticker)}
                          style={{ accentColor: '#7ecfff' }} />
                        <span style={{ fontWeight: 600, minWidth: 55 }}>{t.ticker}</span>
                        <span style={{ color: '#888', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</span>
                      </label>
                    ))}
                    {filteredCompPortfolio.length === 0 && (
                      <div style={{ padding: '0.5rem', color: '#555', textAlign: 'center', fontSize: '0.82rem' }}>No tickers found</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Custom ticker input */}
            <input className="ne-input" style={{ width: 90, textTransform: 'uppercase' }}
              maxLength={10} placeholder="e.g. SPY" value={compInput}
              onChange={e => setCompInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') addCompTicker() }} />
            <button className="nep-btn" onClick={addCompTicker}>Add</button>
          </div>

          {/* Selected comparison tickers with reinvest % */}
          {compTickers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.4rem', alignItems: 'center' }}>
              {compTickers.map(t => (
                <span key={t} className="pis-comp-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <strong>{t}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#888', whiteSpace: 'nowrap' }}>Amount $</span>
                  <input type="number" min="0" step="500"
                    value={compAmount[t] || 10000}
                    onChange={e => updateCompAmount(t, e.target.value)}
                    title="Initial investment amount for this ticker"
                    style={{ width: 72, textAlign: 'right', background: '#1a1a2e', border: '1px solid #3a3a5c',
                      borderRadius: 3, color: '#ccc', fontSize: '0.82rem', padding: '2px 4px' }} />
                  <span style={{ fontSize: '0.74rem', color: '#888', whiteSpace: 'nowrap' }}>Reinvest:</span>
                  <input type="number" min="0" max="100" step="1"
                    value={compReinvest[t] || 0}
                    onChange={e => updateCompReinvest(t, e.target.value)}
                    title="Dividend reinvestment % for this ticker"
                    style={{ width: 52, textAlign: 'center', background: '#1a1a2e', border: '1px solid #3a3a5c',
                      borderRadius: 3, color: (compReinvest[t] || 0) > 0 ? '#00e89a' : '#888',
                      fontSize: '0.82rem', padding: '2px 4px' }} />
                  <span style={{ fontSize: '0.68rem', color: '#666' }}>%</span>
                  <span style={{ fontSize: '0.74rem', color: '#888', whiteSpace: 'nowrap' }}>Yield Override:</span>
                  <input type="number" min="0" max="100" step="0.1"
                    value={compYieldOverride[t] != null ? compYieldOverride[t] : ''}
                    onChange={e => updateCompYieldOverride(t, e.target.value)}
                    title="Manual yield override % (leave blank for auto)"
                    placeholder="auto"
                    style={{ width: 58, textAlign: 'center', background: '#1a1a2e', border: '1px solid #2a4a3e',
                      borderRadius: 3, color: compYieldOverride[t] != null ? '#00e89a' : '#888',
                      fontSize: '0.82rem', padding: '2px 4px' }} />
                  <span style={{ fontSize: '0.68rem', color: '#666' }}>%</span>
                  <button onClick={() => removeCompTicker(t)} className="pis-comp-tag-x">&times;</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="nep-actions" style={{ marginTop: '0.7rem' }}>
          <button className="nep-btn" onClick={addRow} disabled={gridRows.length >= MAX_ROWS}>+ Add ETF</button>
          <button className="nep-btn" onClick={clearGrid}>Clear</button>
          <button className="nep-btn" onClick={openPicker}>From Portfolio&hellip;</button>
          <button className="nep-btn" onClick={saveList}>Save List</button>
          <button className="nep-btn nep-btn-purple" onClick={() => { setSaveError(null); setSaveName(''); setSaveFormOpen(true) }}>
            Save Simulation&hellip;
          </button>
          <button className="ne-run-btn" onClick={runSim} disabled={loading}>Run</button>
          {savedMsg && <span style={{ color: '#00c853', fontSize: '0.82rem' }}>Saved</span>}
          <span style={{ color: '#555', fontSize: '0.78rem', marginLeft: 'auto' }}>
            {gridRows.filter(r => r.ticker.trim()).length} / {MAX_ROWS} ETFs
          </span>
        </div>

        {/* Save simulation form */}
        {saveFormOpen && (
          <div className="nep-bt-form" style={{ marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label className="ne-label">Name:</label>
              <input className="ne-input" style={{ flex: 1, minWidth: 200, borderColor: '#a78bfa' }}
                maxLength={200} placeholder="e.g. High-yield 3yr bearish"
                value={saveName} onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmSaveSim(); if (e.key === 'Escape') setSaveFormOpen(false) }}
                autoFocus />
              <button className="nep-btn nep-btn-purple" style={{ fontWeight: 600 }} onClick={confirmSaveSim}>Save</button>
              <button className="nep-btn" onClick={() => setSaveFormOpen(false)}>Cancel</button>
            </div>
            {saveError && <span style={{ color: '#e05555', fontSize: '0.78rem' }}>{saveError}</span>}
          </div>
        )}
      </div>

      {/* Portfolio picker modal */}
      {pickerOpen && (
        <div className="pis-picker-overlay" onClick={e => { if (e.target === e.currentTarget) setPickerOpen(false) }}>
          <div className="pis-picker-modal">
            <h2 style={{ margin: '0 0 0.6rem', fontSize: '1rem', color: '#ccc' }}>Select from Portfolio</h2>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="ne-input" style={{ flex: 1, minWidth: 150 }}
                placeholder="Search ticker or name..."
                value={pickerSearch} onChange={e => setPickerSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setPickerOpen(false) }}
                autoFocus />
              <button className="nep-btn" onClick={pickerSelectAll}>Select All</button>
              <button className="nep-btn" onClick={pickerClearAll}>Clear All</button>
              <span style={{ color: '#aaa', fontSize: '0.78rem' }}>{pickerChecked.size} selected</span>
            </div>
            <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid #2a2a3e', borderRadius: 6 }}>
              <table className="sst" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th style={{ textAlign: 'left' }}>Ticker</th>
                    <th style={{ textAlign: 'left' }}>Description</th>
                    <th>Type</th>
                    <th>Yield</th>
                    <th>Amount</th>
                    <th>Reinvest</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPicker.map(t => {
                    const already = existingTickers.has(t.ticker)
                    return (
                      <tr key={t.ticker} style={already ? { opacity: 0.45 } : {}}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" disabled={already}
                            checked={pickerChecked.has(t.ticker)}
                            onChange={() => togglePickerCheck(t.ticker)}
                            style={{ accentColor: '#00e89a', cursor: already ? 'not-allowed' : 'pointer' }} />
                        </td>
                        <td style={{ fontWeight: 700 }}>{t.ticker}</td>
                        <td style={{ color: '#aaa', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={t.description}>{t.description}</td>
                        <td style={{ color: '#666', fontSize: '0.75rem' }}>{t.type}</td>
                        <td style={{ textAlign: 'right', color: '#7ecfff' }}>{t.current_yield.toFixed(2)}%</td>
                        <td style={{ textAlign: 'right' }}>{fmt$(t.amount)}</td>
                        <td style={{ textAlign: 'right' }}>{t.drip ? '100%' : '0%'}</td>
                      </tr>
                    )
                  })}
                  {filteredPicker.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: '1rem', color: '#555' }}>No tickers found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem', justifyContent: 'flex-end' }}>
              <button className="nep-btn" onClick={pickerAddAll}>Add Entire Portfolio</button>
              <button className="nep-btn nep-btn-purple" onClick={pickerAddSelected}>Add Selected</button>
              <button className="nep-btn" onClick={() => setPickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Spinner */}
      {loading && (
        <div className="wl-spinner">
          <div className="wl-spin-circle" />
          <p>Running simulation&hellip;</p>
        </div>
      )}

      {/* Error */}
      {error && <div className="wl-error">{error}</div>}

      {/* Results */}
      {results && !loading && (
        <div style={{ marginTop: '0.6rem' }}>
          <h2 style={{ marginTop: 0, marginBottom: '0.7rem', fontSize: '1rem', color: '#ccc' }}>Results</h2>

          {/* Summary */}
          {summary && (
            <div className="nep-summary">
              <StatTile label="Total Invested" value={fmt$(summary.totAmount)} color="#7ecfff" />
              <StatTile label="Total Final Value" value={fmt$(summary.totFinal)} color="#7ecfff" />
              <StatTile label="Total Gain / Loss" value={fmt$(summary.totGL)} color={summary.totGL >= 0 ? '#00c853' : '#e05555'} />
              <StatTile label="Portfolio Return" value={fmtPct(summary.totGLPct)} color={summary.totGLPct >= 0 ? '#00c853' : '#e05555'} />
              <StatTile label="Total Distributions" value={fmt$(summary.totDist)} color="#00e89a" />
              <StatTile label="Cum Yield on Cost" value={summary.totEffYld.toFixed(2) + '%'} color="#00e89a" />
              <StatTile label="Total Reinvested" value={fmt$(summary.totReinv)} color="#7ecfff" />
              <StatTile label="NAV Erosion" value={summary.erosionCount + ' of ' + summary.erosionValid}
                color={summary.erosionCount > 0 ? '#e05555' : '#00c853'} sub="funds showing erosion" />
              {summary.best && <StatTile label="Best Performer"
                value={<span style={{ color: '#00c853', fontWeight: 700 }}>{summary.best.ticker}</span>}
                color="#00c853" sub={fmtPct(summary.best.gain_loss_pct)} />}
              {summary.worst && <StatTile label="Worst Performer"
                value={<span style={{ color: '#e05555', fontWeight: 700 }}>{summary.worst.ticker}</span>}
                color="#e05555" sub={fmtPct(summary.worst.gain_loss_pct)} />}
              {mode === 'simulate' && (
                <StatTile label="Market Bias"
                  value={marketType.charAt(0).toUpperCase() + marketType.slice(1)}
                  color={marketType === 'bullish' ? '#00c853' : marketType === 'bearish' ? '#e05555' : '#f9a825'} />
              )}
            </div>
          )}

          {/* Results table */}
          <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: '#666', fontWeight: 400 }}>
            Detail &mdash; click any header to sort
          </h3>
          <div className="nep-tbl-wrap">
            {hasCompareGroupsRaw ? (
            /* ===== COMPARE MODE: side-by-side baseline vs reinvested ===== */
            <table className="sst" style={{ minWidth: 1800 }}>
              <thead>
                <tr>
                  <th rowSpan={2}>Ticker</th>
                  <th rowSpan={2}>Amount</th>
                  <th rowSpan={2}>Start Price</th>
                  <th rowSpan={2}>End Price</th>
                  <th rowSpan={2}>Price &Delta;%</th>
                  <th rowSpan={2}>TTM Yield</th>
                  <th colSpan={6} style={{ textAlign: 'center', borderBottom: '2px solid #e05555', color: '#e05555' }}>0% Reinvest</th>
                  <th colSpan={6} style={{ textAlign: 'center', borderBottom: '2px solid #00c853', color: '#00c853' }}>{compareReinvestPct}% Reinvest</th>
                  <th rowSpan={2}>NAV Erosion</th>
                  <th rowSpan={2}>Deficit</th>
                  <th rowSpan={2}>Note</th>
                </tr>
                <tr>
                  {compareSubHeaders.map(h => <th key={'b_'+h} style={{ color: '#e08888', fontSize: '0.78rem' }}>{h}</th>)}
                  {compareSubHeaders.map(h => <th key={'r_'+h} style={{ color: '#66d98a', fontSize: '0.78rem' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {mergedResults.map((item, idx) => {
                  if (!item.merged) {
                    // Single row (e.g. comparison ticker without compare groups, or error)
                    const r = item.row
                    if (r.error && !r.start_price) {
                      return (
                        <tr key={idx} style={r.is_comparison ? { background: '#0d0d22' } : {}}>
                          <td><strong>{r.ticker}{r.is_comparison ? ' [C]' : ''}</strong></td>
                          <td>{fmt$(r.amount || 0)}</td>
                          <td colSpan={19} style={{ textAlign: 'left', color: '#e05555' }}>{r.error}</td>
                        </tr>
                      )
                    }
                    const pCls = r.price_delta_pct < 0 ? 'pct-down' : r.price_delta_pct > 0 ? 'pct-up' : ''
                    const glCls = r.gain_loss_dollar < 0 ? 'pct-down' : 'pct-up'
                    const glPCls = r.gain_loss_pct < 0 ? 'pct-down' : 'pct-up'
                    const effCls = (r.effective_yield_pct || 0) >= 10 ? 'pct-up' : ''
                    const defCls = (r.final_deficit || 0) > 0 ? 'ne-deficit' : 'ne-surplus'
                    return (
                      <tr key={idx} style={r.is_comparison ? { background: '#0d0d22' } : {}}>
                        <td><strong>{r.ticker}{r.is_comparison ? ' [C]' : ''}</strong></td>
                        <td>{fmt$(r.amount)}</td>
                        <td>{fmt$(r.start_price)}</td>
                        <td>{fmt$(r.end_price)}</td>
                        <td className={pCls}>{fmtPct(r.price_delta_pct)}</td>
                        <td>{r.ttm_yield_pct != null ? r.ttm_yield_pct.toFixed(2) + '%' : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                        {/* Single row spans both groups */}
                        <td>{fmt$(r.total_dist)}</td>
                        <td className={effCls}>{(r.effective_yield_pct || 0).toFixed(2)}%</td>
                        <td>{fmt$(r.total_reinvested)}</td>
                        <td>{fmt$(r.final_value)}</td>
                        <td className={glCls}>{fmt$(r.gain_loss_dollar)}</td>
                        <td className={glPCls}>{fmtPct(r.gain_loss_pct)}</td>
                        <td colSpan={6} style={{ textAlign: 'center', color: '#555' }}>&mdash;</td>
                        <td>{r.has_erosion
                          ? <span style={{ color: '#e05555', fontWeight: 700 }}>Yes</span>
                          : <span style={{ color: '#00c853', fontWeight: 700 }}>No</span>}</td>
                        <td className={defCls}>{parseFloat(r.final_deficit || 0).toFixed(4)}</td>
                        <td style={{ textAlign: 'left', fontSize: '0.78rem', color: '#aaa', minWidth: 180, whiteSpace: 'normal' }}>
                          {r.warning ? <span style={{ color: '#f9a825' }}>&#9888; {r.warning}</span> : <span style={{ color: '#555' }}>&mdash;</span>}
                        </td>
                      </tr>
                    )
                  }
                  // Merged row: baseline + reinvested side by side
                  const b = item.baseline || {}
                  const r = item.reinvested || {}
                  const shared = item.baseline || item.reinvested
                  const pCls = (shared.price_delta_pct || 0) < 0 ? 'pct-down' : (shared.price_delta_pct || 0) > 0 ? 'pct-up' : ''
                  // Baseline columns
                  const bGlCls = (b.gain_loss_dollar || 0) < 0 ? 'pct-down' : 'pct-up'
                  const bGlPCls = (b.gain_loss_pct || 0) < 0 ? 'pct-down' : 'pct-up'
                  const bEffCls = (b.effective_yield_pct || 0) >= 10 ? 'pct-up' : ''
                  // Reinvested columns
                  const rGlCls = (r.gain_loss_dollar || 0) < 0 ? 'pct-down' : 'pct-up'
                  const rGlPCls = (r.gain_loss_pct || 0) < 0 ? 'pct-down' : 'pct-up'
                  const rEffCls = (r.effective_yield_pct || 0) >= 10 ? 'pct-up' : ''
                  // NAV Erosion from baseline only
                  const defCls = (b.final_deficit || 0) > 0 ? 'ne-deficit' : 'ne-surplus'
                  return (
                    <tr key={idx} style={shared.is_comparison ? { background: '#0d0d22' } : {}}>
                      <td><strong>{item.ticker}{item.is_comparison ? ' [C]' : ''}</strong></td>
                      <td>{fmt$(shared.amount)}</td>
                      <td>{fmt$(shared.start_price)}</td>
                      <td>{fmt$(shared.end_price)}</td>
                      <td className={pCls}>{fmtPct(shared.price_delta_pct)}</td>
                      <td>{shared.ttm_yield_pct != null ? shared.ttm_yield_pct.toFixed(2) + '%' : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      {/* 0% Reinvest columns */}
                      <td>{b.total_dist != null ? fmt$(b.total_dist) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td className={bEffCls}>{b.effective_yield_pct != null ? b.effective_yield_pct.toFixed(2) + '%' : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td>{b.total_reinvested != null ? fmt$(b.total_reinvested) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td>{b.final_value != null ? fmt$(b.final_value) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td className={bGlCls}>{b.gain_loss_dollar != null ? fmt$(b.gain_loss_dollar) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td className={bGlPCls}>{b.gain_loss_pct != null ? fmtPct(b.gain_loss_pct) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      {/* X% Reinvest columns */}
                      <td>{r.total_dist != null ? fmt$(r.total_dist) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td className={rEffCls}>{r.effective_yield_pct != null ? r.effective_yield_pct.toFixed(2) + '%' : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td>{r.total_reinvested != null ? fmt$(r.total_reinvested) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td>{r.final_value != null ? fmt$(r.final_value) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td className={rGlCls}>{r.gain_loss_dollar != null ? fmt$(r.gain_loss_dollar) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      <td className={rGlPCls}>{r.gain_loss_pct != null ? fmtPct(r.gain_loss_pct) : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      {/* NAV Erosion from baseline */}
                      <td>{b.has_erosion
                        ? <span style={{ color: '#e05555', fontWeight: 700 }}>Yes</span>
                        : <span style={{ color: '#00c853', fontWeight: 700 }}>No</span>}</td>
                      <td className={defCls}>{parseFloat(b.final_deficit || 0).toFixed(4)}</td>
                      <td style={{ textAlign: 'left', fontSize: '0.78rem', color: '#aaa', minWidth: 180, whiteSpace: 'normal' }}>
                        {(shared.warning)
                          ? <span style={{ color: '#f9a825' }}>&#9888; {shared.warning}</span>
                          : <span style={{ color: '#555' }}>&mdash;</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {summary && (
                <tfoot>
                  <tr>
                    <td><strong>TOTAL</strong></td>
                    <td>{fmt$(summary.totAmount)}</td>
                    <td></td><td></td><td></td><td></td>
                    <td>{fmt$(summary.totDist)}</td>
                    <td>{summary.totEffYld.toFixed(2)}%</td>
                    <td>{fmt$(summary.totReinv)}</td>
                    <td>{fmt$(summary.totFinal)}</td>
                    <td className={summary.totGL >= 0 ? 'pct-up' : 'pct-down'}>{fmt$(summary.totGL)}</td>
                    <td className={summary.totGLPct >= 0 ? 'pct-up' : 'pct-down'}>{fmtPct(summary.totGLPct)}</td>
                    <td colSpan={6}></td>
                    <td></td><td></td><td></td>
                  </tr>
                </tfoot>
              )}
            </table>
            ) : (
            /* ===== NORMAL MODE: original single-row layout ===== */
            <table className="sst" style={{ minWidth: 1500 }}>
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={h} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>{h}{arrow(i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r, idx) => {
                  if (r.error && !r.start_price) {
                    return (
                      <tr key={idx} style={r.is_comparison ? { background: '#0d0d22' } : {}}>
                        <td><strong>{r.ticker}{r.is_comparison ? ' [C]' : ''}</strong></td>
                        <td>{fmt$(r.amount || 0)}</td>
                        <td>{(r.reinvest_pct || 0)}%</td>
                        <td colSpan={isSim ? 15 : 12} style={{ textAlign: 'left', color: '#e05555' }}>{r.error}</td>
                        <td></td>
                      </tr>
                    )
                  }
                  const pCls = r.price_delta_pct < 0 ? 'pct-down' : r.price_delta_pct > 0 ? 'pct-up' : ''
                  const glCls = r.gain_loss_dollar < 0 ? 'pct-down' : 'pct-up'
                  const glPCls = r.gain_loss_pct < 0 ? 'pct-down' : 'pct-up'
                  const effCls = (r.effective_yield_pct || 0) >= 10 ? 'pct-up' : ''
                  const defCls = r.final_deficit > 0 ? 'ne-deficit' : 'ne-surplus'
                  return (
                    <tr key={idx} style={r.is_comparison ? { background: '#0d0d22' } : {}}>
                      <td>
                        <strong>{r.ticker}{r.is_comparison ? ' [C]' : ''}</strong>
                        {r.compare_group === 'baseline' && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#e05555', fontWeight: 600 }}>0%</span>}
                        {r.compare_group === 'reinvested' && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#00c853', fontWeight: 600 }}>{r.reinvest_pct}%</span>}
                      </td>
                      <td>{fmt$(r.amount)}</td>
                      <td>{r.reinvest_pct}%</td>
                      <td>{fmt$(r.start_price)}</td>
                      <td>{fmt$(r.end_price)}</td>
                      <td className={pCls}>{fmtPct(r.price_delta_pct)}</td>
                      <td>{r.ttm_yield_pct != null ? r.ttm_yield_pct.toFixed(2) + '%' : <span style={{ color: '#555' }}>&mdash;</span>}</td>
                      {isSim && <td style={{ color: (r.sim_stats?.hist_mean_monthly || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}>{r.sim_stats?.hist_mean_monthly != null ? r.sim_stats.hist_mean_monthly.toFixed(2) + '%' : <span style={{ color: '#555' }}>&mdash;</span>}</td>}
                      {isSim && <td>{r.sim_stats?.hist_sigma_monthly != null ? r.sim_stats.hist_sigma_monthly.toFixed(2) + '%' : <span style={{ color: '#555' }}>&mdash;</span>}</td>}
                      {isSim && <td style={{ color: (r.sim_stats?.hist_skewness || 0) < -0.3 ? '#f9a825' : '#aaa' }}>{r.sim_stats?.hist_skewness != null ? r.sim_stats.hist_skewness.toFixed(2) : <span style={{ color: '#555' }}>&mdash;</span>}</td>}
                      <td>{fmt$(r.total_dist)}</td>
                      <td className={effCls}>{r.effective_yield_pct.toFixed(2)}%</td>
                      <td>{fmt$(r.total_reinvested)}</td>
                      <td>{fmt$(r.final_value)}</td>
                      <td className={glCls}>{fmt$(r.gain_loss_dollar)}</td>
                      <td className={glPCls}>{fmtPct(r.gain_loss_pct)}</td>
                      <td>{r.has_erosion
                        ? <span style={{ color: '#e05555', fontWeight: 700 }}>Yes</span>
                        : <span style={{ color: '#00c853', fontWeight: 700 }}>No</span>}</td>
                      <td className={defCls}>{parseFloat(r.final_deficit).toFixed(4)}</td>
                      <td style={{ textAlign: 'left', fontSize: '0.78rem', color: '#aaa', minWidth: 180, whiteSpace: 'normal' }}>
                        {r.warning
                          ? <span style={{ color: '#f9a825' }}>&#9888; {r.warning}</span>
                          : <span style={{ color: '#555' }}>&mdash;</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {summary && (
                <tfoot>
                  <tr>
                    <td><strong>TOTAL</strong></td>
                    <td>{fmt$(summary.totAmount)}</td>
                    <td></td><td></td><td></td><td></td><td></td>
                    {isSim && <><td></td><td></td><td></td></>}
                    <td>{fmt$(summary.totDist)}</td>
                    <td>{summary.totEffYld.toFixed(2)}%</td>
                    <td>{fmt$(summary.totReinv)}</td>
                    <td>{fmt$(summary.totFinal)}</td>
                    <td className={summary.totGL >= 0 ? 'pct-up' : 'pct-down'}>{fmt$(summary.totGL)}</td>
                    <td className={summary.totGLPct >= 0 ? 'pct-up' : 'pct-down'}>{fmtPct(summary.totGLPct)}</td>
                    <td></td><td></td><td></td>
                  </tr>
                </tfoot>
              )}
            </table>
            )}
          </div>

          {/* Charts */}
          {chartableResults.length > 0 && (
            <div style={{ marginTop: '1.2rem' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: '#ccc' }}>Charts</h3>
              <>
                  <Plot
                    data={valueChartTraces}
                    layout={{
                      template: 'plotly_dark',
                      title: {
                        text: hasCompareGroups
                          ? `Reinvestment Impact: 0% vs ${chartLines.reinvestedPct}% — ${mode === 'simulate' ? `${marketType.charAt(0).toUpperCase() + marketType.slice(1)} Simulation (${durationMonths}mo)` : `Historical (${startDate} to ${endDate})`}`
                          : mode === 'simulate'
                            ? `Portfolio Value vs Benchmarks — ${marketType.charAt(0).toUpperCase() + marketType.slice(1)} Simulation (${durationMonths} months)`
                            : `Portfolio Value vs Benchmarks — Historical (${startDate} to ${endDate})`,
                        font: { size: 14 },
                      },
                      height: 420, autosize: true,
                      margin: { t: 60, l: 60, r: 60, b: 80 },
                      legend: { orientation: 'h', y: 1.15, x: 0 },
                      hoverlabel: { bgcolor: '#111124', bordercolor: '#3a3a5c', font: { color: '#e0e0e0', size: 13 } },
                      hovermode: 'x unified',
                      xaxis: { tickangle: -45, nticks: 20, automargin: true },
                      yaxis: { title: 'Value ($)', tickprefix: '$' },
                      annotations: hasCompareGroups ? [{
                        text: 'Red = No reinvestment  |  Green = With reinvestment',
                        showarrow: false, xref: 'paper', yref: 'paper', x: 0.5, y: -0.13,
                        font: { size: 11, color: '#888' },
                      }] : compTickers.length > 0 ? [{
                        text: 'Solid = Simulated Tickers (Aggregate) (aggregated)  |  Dashed = Comparison benchmarks',
                        showarrow: false, xref: 'paper', yref: 'paper', x: 0.5, y: -0.13,
                        font: { size: 11, color: '#888' },
                      }] : [],
                    }}
                    useResizeHandler
                    style={{ width: '100%', height: 420 }}
                    config={{ responsive: true }}
                  />

                  {/* Dividend chart */}
                  <Plot
                    data={divChartTraces}
                    layout={{
                      template: 'plotly_dark',
                      title: {
                        text: hasCompareGroups
                          ? `Dividend Distributions: 0% vs ${chartLines.reinvestedPct}% Reinvestment`
                          : mode === 'simulate'
                            ? `Monthly Dividend Distributions — ${marketType.charAt(0).toUpperCase() + marketType.slice(1)} Scenario`
                            : `Monthly Dividend Distributions — Historical`,
                        font: { size: 14 },
                      },
                      height: 340, autosize: true,
                      margin: { t: 60, l: 60, r: 30, b: 80 },
                      legend: { orientation: 'h', y: 1.15, x: 0 },
                      hoverlabel: { bgcolor: '#111124', bordercolor: '#3a3a5c', font: { color: '#e0e0e0', size: 13 } },
                      hovermode: 'x unified',
                      xaxis: { tickangle: -45, nticks: 20, automargin: true },
                      yaxis: { title: 'Distribution ($)', tickprefix: '$' },
                      annotations: hasCompareGroups ? [{
                        text: 'Red = No reinvestment  |  Green = With reinvestment',
                        showarrow: false, xref: 'paper', yref: 'paper', x: 0.5, y: -0.15,
                        font: { size: 11, color: '#888' },
                      }] : compTickers.length > 0 ? [{
                        text: 'Solid = Simulated Tickers (Aggregate) (aggregated)  |  Dashed = Comparison benchmarks',
                        showarrow: false, xref: 'paper', yref: 'paper', x: 0.5, y: -0.15,
                        font: { size: 11, color: '#888' },
                      }] : [],
                    }}
                    useResizeHandler
                    style={{ width: '100%', height: 340, marginTop: '1rem' }}
                    config={{ responsive: true }}
                  />
                </>
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  )
}
