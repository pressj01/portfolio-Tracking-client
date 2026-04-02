import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useProfileFetch, useProfile } from '../context/ProfileContext'
import Plot from 'react-plotly.js'

function fmt$(v) {
  if (v == null) return '—'
  return '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v) {
  if (v == null) return '—'
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

const YEAR_PRESETS = [
  { l: '1yr', v: 1 }, { l: '2yr', v: 2 }, { l: '3yr', v: 3 },
  { l: '5yr', v: 5 }, { l: '10yr', v: 10 }, { l: '20yr', v: 20 },
]

export default function IncomeGrowthSim() {
  const pf = useProfileFetch()
  const { selection } = useProfile()

  const [years, setYears] = useState(5)
  const [marketType, setMarketType] = useState('neutral')
  const [monthlyContribution, setMonthlyContribution] = useState(0)
  const [monteCarlo, setMonteCarlo] = useState(false)
  // reinvestPct removed — per-ticker reinvest is in simHoldings
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [sort, setSort] = useState({ col: null, asc: true })

  // Holdings editor state
  const [portfolioHoldings, setPortfolioHoldings] = useState([])  // from DB
  const [simHoldings, setSimHoldings] = useState([])  // editable: [{ticker, description, shares, price, div_per_share, freq_str, enabled, isCustom}]
  const [holdingsOpen, setHoldingsOpen] = useState(false)
  const [addTickerInput, setAddTickerInput] = useState('')
  const [addTickerLoading, setAddTickerLoading] = useState(false)
  const [holdingsModified, setHoldingsModified] = useState(false)

  // Fetch portfolio holdings on profile change, then auto-run sim
  const holdingsLoaded = useRef(false)
  useEffect(() => {
    holdingsLoaded.current = false
    pf('/api/holdings')
      .then(r => r.json())
      .then(rows => {
        const h = (rows || []).filter(r => r.quantity > 0 && r.current_price > 0).map(r => ({
          ticker: r.ticker,
          description: (r.description || '').substring(0, 40),
          shares: r.quantity,
          price: r.current_price,
          div_per_share: r.div || 0,
          freq_str: r.div_frequency || 'Q',
          enabled: true,
          isCustom: false,
          reinvest: r.reinvest === 'Y' || r.reinvest === true,
        }))
        setPortfolioHoldings(h)
        setSimHoldings(h)
        setHoldingsModified(false)
        holdingsLoaded.current = true
      })
      .catch(() => {})
  }, [pf, selection])

  const enabledHoldings = useMemo(() => simHoldings.filter(h => h.enabled), [simHoldings])

  const toggleHolding = (ticker) => {
    setSimHoldings(prev => prev.map(h => h.ticker === ticker ? { ...h, enabled: !h.enabled } : h))
    setHoldingsModified(true)
  }

  const updateShares = (ticker, val) => {
    setSimHoldings(prev => prev.map(h => h.ticker === ticker ? { ...h, shares: Math.max(0, parseFloat(val) || 0) } : h))
    setHoldingsModified(true)
  }

  const toggleReinvest = (ticker) => {
    setSimHoldings(prev => prev.map(h => h.ticker === ticker ? { ...h, reinvest: !h.reinvest } : h))
    setHoldingsModified(true)
  }

  const removeCustom = (ticker) => {
    setSimHoldings(prev => prev.filter(h => h.ticker !== ticker))
    setHoldingsModified(true)
  }

  const resetHoldings = () => {
    setSimHoldings(portfolioHoldings.map(h => ({ ...h })))
    setHoldingsModified(false)
  }

  const selectAll = () => {
    setSimHoldings(prev => prev.map(h => ({ ...h, enabled: true })))
    setHoldingsModified(true)
  }
  const selectNone = () => {
    setSimHoldings(prev => prev.map(h => ({ ...h, enabled: false })))
    setHoldingsModified(true)
  }

  const addCustomTicker = () => {
    const sym = addTickerInput.trim().toUpperCase()
    if (!sym) return
    if (simHoldings.some(h => h.ticker === sym)) {
      // Already exists — just enable it
      setSimHoldings(prev => prev.map(h => h.ticker === sym ? { ...h, enabled: true } : h))
      setAddTickerInput('')
      setHoldingsModified(true)
      return
    }
    setAddTickerLoading(true)
    fetch(`/api/lookup/${sym}`)
      .then(r => r.json())
      .then(info => {
        const newH = {
          ticker: info.renamed_to || sym,
          description: (info.description || sym).substring(0, 40),
          shares: 100,
          price: info.current_price || 0,
          div_per_share: info.div || 0,
          freq_str: info.div_frequency || 'Q',
          enabled: true,
          isCustom: true,
          reinvest: true,
        }
        setSimHoldings(prev => [...prev, newH])
        setHoldingsModified(true)
      })
      .catch(() => {})
      .finally(() => { setAddTickerLoading(false); setAddTickerInput('') })
  }

  const buildOverride = useCallback(() => {
    if (enabledHoldings.length === 0) return undefined
    return enabledHoldings.map(h => ({
      ticker: h.ticker,
      shares: h.shares,
      price: h.price,
      div_per_share: h.div_per_share,
      freq_str: h.freq_str,
      description: h.description,
      reinvest: h.reinvest,
    }))
  }, [holdingsModified, enabledHoldings])

  const run = useCallback(() => {
    setLoading(true)
    setError(null)
    const anyReinvest = simHoldings.some(h => h.enabled && h.reinvest)
    const payload = {
      years,
      market_type: marketType,
      monthly_contribution: monthlyContribution,
      reinvest_pct: anyReinvest ? 100 : 0,
      monte_carlo: monteCarlo,
    }
    const override = buildOverride()
    if (override) payload.holdings_override = override
    pf('/api/analytics/income-growth-sim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf, years, marketType, monthlyContribution, monteCarlo, buildOverride])

  // Auto-run after holdings load
  useEffect(() => {
    if (simHoldings.length > 0) run()
  }, [portfolioHoldings])

  const showMonthly = years <= 5
  const series = data ? (showMonthly ? data.monthly_series : data.annual_series) : []

  // Chart traces
  const chartTraces = []
  if (data && series.length > 0) {
    const x = series.map(s => s.label)
    const y = series.map(s => s.total_income)
    const scenarioColor = marketType === 'bullish' ? '#00c853' : marketType === 'bearish' ? '#e05555' : '#f9a825'

    if (monteCarlo && series[0].p10 != null) {
      // P90 upper band
      chartTraces.push({
        x, y: series.map(s => s.p90),
        type: 'scatter', mode: 'lines',
        line: { width: 0 }, showlegend: false,
        hoverinfo: 'skip',
      })
      // P10 lower band with fill
      chartTraces.push({
        x, y: series.map(s => s.p10),
        type: 'scatter', mode: 'lines',
        fill: 'tonexty', fillcolor: scenarioColor + '22',
        line: { width: 0 }, name: '10th–90th Percentile',
        hoverinfo: 'skip',
      })
    }

    if (showMonthly) {
      chartTraces.push({
        x, y, type: 'scatter', mode: 'lines',
        name: 'Monthly Income',
        line: { color: scenarioColor, width: 3 },
        hovertemplate: '%{x}<br>Monthly: $%{y:,.2f}<extra></extra>',
      })
    } else {
      chartTraces.push({
        x, y, type: 'bar',
        name: 'Annual Income',
        marker: { color: scenarioColor },
        hovertemplate: '%{x}<br>Income: $%{y:,.2f}<extra></extra>',
      })
    }
  }

  // Sort handler for holdings table
  const handleSort = (col) => {
    setSort(prev => ({ col, asc: prev.col === col ? !prev.asc : col === 'ticker' }))
  }
  const sortIcon = (col) => sort.col === col ? (sort.asc ? ' ↑' : ' ↓') : ''

  const sortedHoldings = data?.holdings ? [...data.holdings].sort((a, b) => {
    if (!sort.col) return 0
    const av = a[sort.col], bv = b[sort.col]
    if (typeof av === 'string') return sort.asc ? av.localeCompare(bv) : bv.localeCompare(av)
    return sort.asc ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0)
  }) : []

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.25rem' }}>Income Growth Simulator</h1>
      <p style={{ color: '#90a4ae', fontSize: '0.82rem', marginBottom: '1rem' }}>
        Project how your portfolio income changes over time with scenario-based growth rates.
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginBottom: '1rem',
        background: '#111124', border: '1px solid #2a2a3e', borderRadius: 8, padding: '0.75rem 1rem' }}>

        {/* Scenario */}
        <div>
          <div style={{ fontSize: '0.68rem', color: '#888', marginBottom: 4 }}>Scenario</div>
          <div style={{ display: 'flex', gap: 4 }}>
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
        </div>

        {/* Timeframe */}
        <div>
          <div style={{ fontSize: '0.68rem', color: '#888', marginBottom: 4 }}>Timeframe</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {YEAR_PRESETS.map(p => (
              <button key={p.v}
                className={`pis-dur-btn ${years === p.v ? 'active' : ''}`}
                onClick={() => setYears(p.v)}
              >{p.l}</button>
            ))}
            <input type="number" min="1" max="20" value={years}
              onChange={e => setYears(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              style={{ width: 50, background: '#1a1a2e', border: '1px solid #3a3a5c', color: '#ccc',
                borderRadius: 4, padding: '0.3rem 0.4rem', fontSize: '0.82rem', textAlign: 'center' }}
            />
          </div>
        </div>

        {/* Monthly Contribution */}
        <div>
          <div style={{ fontSize: '0.68rem', color: '#888', marginBottom: 4 }}>Monthly Investment</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>$</span>
            <input type="number" min="0" step="100" value={monthlyContribution}
              onChange={e => setMonthlyContribution(Math.max(0, parseFloat(e.target.value) || 0))}
              style={{ width: 90, background: '#1a1a2e', border: '1px solid #3a3a5c', color: '#ccc',
                borderRadius: 4, padding: '0.3rem 0.4rem', fontSize: '0.82rem', textAlign: 'right' }}
            />
          </div>
        </div>

        {/* DRIP Reinvest All */}
        <div>
          <div style={{ fontSize: '0.68rem', color: '#888', marginBottom: 4 }}>Reinvest All</div>
          <button
            className={`pis-dur-btn ${simHoldings.every(h => h.reinvest) ? 'active' : ''}`}
            onClick={() => {
              const allOn = simHoldings.every(h => h.reinvest)
              setSimHoldings(prev => prev.map(h => ({ ...h, reinvest: !allOn })))
              setHoldingsModified(true)
            }}
            style={simHoldings.every(h => h.reinvest) ? { borderColor: '#4caf50', color: '#4caf50', background: '#0f3460' } : {}}
          >
            {simHoldings.every(h => h.reinvest) ? 'DRIP All On' : simHoldings.some(h => h.reinvest) ? 'DRIP Mixed' : 'DRIP All Off'}
          </button>
        </div>

        {/* Monte Carlo toggle */}
        <div>
          <div style={{ fontSize: '0.68rem', color: '#888', marginBottom: 4 }}>Simulation</div>
          <button
            className={`pis-dur-btn ${monteCarlo ? 'active' : ''}`}
            onClick={() => setMonteCarlo(v => !v)}
            style={monteCarlo ? { borderColor: '#7ecfff', color: '#7ecfff', background: '#0f3460' } : {}}
          >
            {monteCarlo ? 'Monte Carlo (300 paths)' : 'Deterministic'}
          </button>
        </div>

        {/* Run */}
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={run} disabled={loading}
            style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6,
              padding: '0.5rem 1.5rem', fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Running...' : 'Run Simulation'}
          </button>
        </div>
      </div>

      {/* Holdings Editor */}
      <div style={{ marginBottom: '1rem', background: '#111124', border: '1px solid #2a2a3e', borderRadius: 8 }}>
        <button onClick={() => setHoldingsOpen(o => !o)}
          style={{ width: '100%', background: 'none', border: 'none', color: '#7ecfff', padding: '0.6rem 1rem',
            cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Holdings ({enabledHoldings.length} of {simHoldings.length} selected)
            {holdingsModified && <span style={{ color: '#f9a825', fontSize: '0.72rem', marginLeft: 8 }}>modified</span>}
          </span>
          <span>{holdingsOpen ? '▴' : '▾'}</span>
        </button>
        {holdingsOpen && (
          <div style={{ padding: '0.5rem 1rem 0.75rem' }}>
            {/* Action bar */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <button className="nep-btn" onClick={selectAll} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>All</button>
              <button className="nep-btn" onClick={selectNone} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>None</button>
              {holdingsModified && (
                <button className="nep-btn" onClick={resetHoldings}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: '#6b2020' }}>Reset</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <input className="ne-input" style={{ width: 90, fontSize: '0.8rem', textTransform: 'uppercase' }}
                  value={addTickerInput} onChange={e => setAddTickerInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustomTicker() }}
                  placeholder="Add ticker" disabled={addTickerLoading} />
                <button className="nep-btn" onClick={addCustomTicker} disabled={addTickerLoading}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                  {addTickerLoading ? '...' : 'Add'}
                </button>
              </div>
            </div>
            {/* Holdings list */}
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #1a2233', borderRadius: 4 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', position: 'sticky', top: 0, background: '#111124' }}>
                    <th style={{ ...thStyle, width: 30 }}></th>
                    <th style={{ ...thStyle }}>Ticker</th>
                    <th style={{ ...thStyle }}>Description</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Shares</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Div/Share</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Freq</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Annual Inc</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>DRIP</th>
                    {simHoldings.some(h => h.isCustom) && <th style={{ ...thStyle, width: 30 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {simHoldings.map(h => {
                    const annInc = h.div_per_share * h.shares * ({ M: 12, Monthly: 12, W: 52, Weekly: 52, BW: 26, Q: 4, Quarterly: 4, SA: 2, A: 1 }[h.freq_str] || 4)
                    return (
                      <tr key={h.ticker} style={{ borderBottom: '1px solid #1a2233', opacity: h.enabled ? 1 : 0.4 }}>
                        <td style={tdStyle}>
                          <input type="checkbox" checked={h.enabled} onChange={() => toggleHolding(h.ticker)}
                            style={{ accentColor: '#64b5f6' }} />
                        </td>
                        <td style={{ ...tdStyle, color: h.isCustom ? '#ffb74d' : '#90caf9', fontWeight: 600 }}>{h.ticker}</td>
                        <td style={{ ...tdStyle, color: '#aaa', fontSize: '0.72rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.description}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <input type="number" min="0" step="1" value={h.shares}
                            onChange={e => updateShares(h.ticker, e.target.value)}
                            style={{ width: 75, background: '#1a1a2e', border: '1px solid #3a3a5c', color: '#ccc',
                              borderRadius: 3, padding: '0.15rem 0.3rem', fontSize: '0.78rem', textAlign: 'right' }} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#aaa' }}>${h.price.toFixed(2)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#aaa' }}>${h.div_per_share.toFixed(4)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>{h.freq_str}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#66bb6a' }}>{fmt$(annInc)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <input type="checkbox" checked={h.reinvest} onChange={() => toggleReinvest(h.ticker)}
                            style={{ accentColor: '#4caf50' }} />
                        </td>
                        {simHoldings.some(hh => hh.isCustom) && (
                          <td style={tdStyle}>
                            {h.isCustom && (
                              <button onClick={() => removeCustom(h.ticker)}
                                style={{ background: 'none', border: 'none', color: '#ef5350', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>✕</button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {error && <p style={{ color: '#ef5350', marginBottom: '1rem' }}>{error}</p>}
      {loading && <p style={{ color: '#90caf9' }}>Running income growth simulation...</p>}

      {data && !loading && (
        <>
          {/* Stat tiles */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem' }}>
            <StatTile label="Current Monthly Income" value={fmt$(data.current_monthly_income)} color="#e0e8f5" />
            <StatTile label="Current Annual Income" value={fmt$(data.current_annual_income)} color="#e0e8f5" />
            <StatTile label={`Projected Annual (Year ${years})`} value={fmt$(data.projected_annual_income)}
              color={data.projected_annual_income >= data.current_annual_income ? '#00e89a' : '#ef5350'} />
            <StatTile label="Income Change"
              value={fmtPct(data.current_annual_income > 0
                ? ((data.projected_annual_income / data.current_annual_income - 1) * 100)
                : 0)}
              color={data.projected_annual_income >= data.current_annual_income ? '#00e89a' : '#ef5350'}
              sub={fmt$(data.projected_annual_income - data.current_annual_income)} />
            {monthlyContribution > 0 && (
              <StatTile label="Total Contributed" value={fmt$(data.total_contributed)} color="#90caf9" />
            )}
          </div>

          {/* Chart */}
          {chartTraces.length > 0 && (
            <Plot
              data={chartTraces}
              layout={{
                template: 'plotly_dark',
                height: 380, autosize: true,
                margin: { t: 40, b: 60, l: 80, r: 30 },
                title: {
                  text: `${showMonthly ? 'Monthly' : 'Annual'} Income — ${marketType.charAt(0).toUpperCase() + marketType.slice(1)} (${years}yr)`,
                  font: { size: 14 },
                },
                xaxis: { tickangle: showMonthly ? -45 : 0, nticks: showMonthly ? 24 : years + 1 },
                yaxis: { title: showMonthly ? 'Monthly Income ($)' : 'Annual Income ($)', tickprefix: '$' },
                legend: { orientation: 'h', y: 1.12, x: 0.5, xanchor: 'center', font: { color: '#ccc' } },
                hoverlabel: { bgcolor: '#111124', bordercolor: '#3a3a5c', font: { color: '#e0e0e0', size: 13 } },
                hovermode: 'x unified',
              }}
              useResizeHandler
              style={{ width: '100%', height: 380 }}
              config={{ responsive: true, displayModeBar: false }}
            />
          )}

          {/* Income Timeline Table */}
          <h3 style={{ color: '#7ecfff', marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            {showMonthly ? 'Monthly Income Timeline' : 'Annual Income Timeline'}
          </h3>
          <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #334155' }}>
                  <th style={thStyle}>{showMonthly ? 'Month' : 'Year'}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{showMonthly ? 'Monthly Income' : 'Annual Income'}</th>
                  {monteCarlo && <th style={{ ...thStyle, textAlign: 'right', color: '#ef5350' }}>P10</th>}
                  {monteCarlo && <th style={{ ...thStyle, textAlign: 'right', color: '#4caf50' }}>P90</th>}
                  <th style={{ ...thStyle, textAlign: 'right' }}>From Existing</th>
                  {monthlyContribution > 0 && <th style={{ ...thStyle, textAlign: 'right' }}>From New Investment</th>}
                  <th style={{ ...thStyle, textAlign: 'right' }}>Change ($)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Change (%)</th>
                </tr>
              </thead>
              <tbody>
                {series.map((row, i) => {
                  const isYearBoundary = showMonthly && row.month % 12 === 0
                  return (
                    <React.Fragment key={i}>
                      <tr style={{ borderBottom: '1px solid #1a2233',
                        background: isYearBoundary ? 'rgba(126,207,255,0.05)' : 'transparent' }}>
                        <td style={tdStyle}>{row.label}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmt$(row.total_income)}</td>
                        {monteCarlo && <td style={{ ...tdStyle, textAlign: 'right', color: '#ef5350', fontSize: '0.75rem' }}>{fmt$(row.p10)}</td>}
                        {monteCarlo && <td style={{ ...tdStyle, textAlign: 'right', color: '#4caf50', fontSize: '0.75rem' }}>{fmt$(row.p90)}</td>}
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#aaa' }}>{fmt$(row.income_from_existing)}</td>
                        {monthlyContribution > 0 && (
                          <td style={{ ...tdStyle, textAlign: 'right', color: '#90caf9' }}>{fmt$(row.income_from_contributions)}</td>
                        )}
                        <td style={{ ...tdStyle, textAlign: 'right',
                          color: (row.change_dollar || 0) >= 0 ? '#4caf50' : '#ef5350', fontWeight: 600 }}>
                          {row.change_dollar != null ? ((row.change_dollar >= 0 ? '+' : '') + fmt$(row.change_dollar)) : '—'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right',
                          color: (row.change_pct || 0) >= 0 ? '#4caf50' : '#ef5350' }}>
                          {fmtPct(row.change_pct)}
                        </td>
                      </tr>
                      {/* Year subtotal for monthly view */}
                      {showMonthly && row.month % 12 === 0 && (() => {
                        const yearNum = row.month / 12
                        const yearStart = (yearNum - 1) * 12
                        const yearSlice = series.slice(yearStart, yearStart + 12)
                        const yearTotal = yearSlice.reduce((s, m) => s + (m.total_income || 0), 0)
                        const yearExisting = yearSlice.reduce((s, m) => s + (m.income_from_existing || 0), 0)
                        const yearContrib = yearSlice.reduce((s, m) => s + (m.income_from_contributions || 0), 0)
                        return (
                          <tr style={{ background: 'rgba(126,207,255,0.08)', borderBottom: '2px solid #334155' }}>
                            <td style={{ ...tdStyle, fontWeight: 700, color: '#7ecfff' }}>Year {yearNum} Total</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#7ecfff' }}>{fmt$(yearTotal)}</td>
                            {monteCarlo && <td style={tdStyle}></td>}
                            {monteCarlo && <td style={tdStyle}></td>}
                            <td style={{ ...tdStyle, textAlign: 'right', color: '#8ab4cc' }}>{fmt$(yearExisting)}</td>
                            {monthlyContribution > 0 && (
                              <td style={{ ...tdStyle, textAlign: 'right', color: '#8ab4cc' }}>{fmt$(yearContrib)}</td>
                            )}
                            <td style={tdStyle}></td>
                            <td style={tdStyle}></td>
                          </tr>
                        )
                      })()}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Holdings Breakdown */}
          <h3 style={{ color: '#7ecfff', marginBottom: '0.5rem', fontSize: '0.95rem' }}>Holdings Breakdown</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #334155' }}>
                  {[
                    { key: 'ticker', label: 'Ticker', align: 'left' },
                    { key: 'description', label: 'Description', align: 'left' },
                    { key: 'shares_start', label: 'Starting Shares', align: 'right' },
                    { key: 'shares_end', label: 'Ending Shares', align: 'right' },
                    { key: 'frequency', label: 'Freq', align: 'center' },
                    { key: 'current_annual_income', label: 'Current Annual', align: 'right' },
                    { key: 'projected_annual_income', label: 'Projected Annual', align: 'right' },
                    { key: 'growth_pct', label: 'Growth %', align: 'right' },
                  ].map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)}
                      style={{ ...thStyle, textAlign: col.align, cursor: 'pointer', userSelect: 'none' }}>
                      {col.label}{sortIcon(col.key)}
                    </th>
                  ))}
                  <th style={{ ...thStyle, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span>DRIP</span>
                      <input type="checkbox"
                        checked={simHoldings.filter(h => h.enabled).every(h => h.reinvest)}
                        ref={el => { if (el) el.indeterminate = simHoldings.filter(h => h.enabled).some(h => h.reinvest) && !simHoldings.filter(h => h.enabled).every(h => h.reinvest) }}
                        onChange={() => {
                          const allOn = simHoldings.filter(h => h.enabled).every(h => h.reinvest)
                          setSimHoldings(prev => prev.map(h => h.enabled ? { ...h, reinvest: !allOn } : h))
                          setHoldingsModified(true)
                        }}
                        style={{ accentColor: '#4caf50', cursor: 'pointer' }}
                        title={simHoldings.filter(h => h.enabled).every(h => h.reinvest) ? 'Turn off DRIP for all' : 'Turn on DRIP for all'}
                      />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.map((h, i) => {
                  const simH = simHoldings.find(s => s.ticker === h.ticker)
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #1a2233' }}>
                      <td style={{ ...tdStyle, color: '#90caf9', fontWeight: 600 }}>{h.ticker}</td>
                      <td style={{ ...tdStyle, color: '#aaa', fontSize: '0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.description?.substring(0, 35)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {h.shares_start?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: h.shares_end > h.shares_start ? '#4caf50' : '#e0e0e0' }}>
                        {h.shares_end?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        {h.shares_added > 0 && (
                          <span style={{ color: '#90caf9', fontSize: '0.7rem', marginLeft: 4 }}>
                            (+{h.shares_added?.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>{h.frequency}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt$(h.current_annual_income)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right',
                        color: h.projected_annual_income >= h.current_annual_income ? '#4caf50' : '#ef5350', fontWeight: 600 }}>
                        {fmt$(h.projected_annual_income)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right',
                        color: (h.growth_pct || 0) >= 0 ? '#4caf50' : '#ef5350' }}>
                        {fmtPct(h.growth_pct)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <input type="checkbox"
                          checked={simH?.reinvest ?? false}
                          onChange={() => toggleReinvest(h.ticker)}
                          style={{ accentColor: '#4caf50', cursor: 'pointer' }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const thStyle = {
  padding: '0.5rem 0.6rem', color: '#7ecfff', fontWeight: 600, fontSize: '0.75rem',
  textAlign: 'left', whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '0.4rem 0.6rem', color: '#e0e0e0', whiteSpace: 'nowrap',
}
