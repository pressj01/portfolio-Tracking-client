import React, { useState, useEffect, useCallback, useRef } from 'react'

const PERIODS = [
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: 'YTD', value: 'ytd' },
  { label: '1Y', value: '1y' },
  { label: '2Y', value: '2y' },
  { label: '5Y', value: '5y' },
  { label: 'Max', value: 'max' },
]

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function metricColor(val, thresholds, lowerBetter = false) {
  if (val == null) return '#8899aa'
  const [a, b, c] = thresholds
  if (lowerBetter) return val <= a ? '#4dff91' : val <= b ? '#7ecfff' : val <= c ? '#ffb74d' : '#ff6b6b'
  return val >= a ? '#4dff91' : val >= b ? '#7ecfff' : val >= c ? '#ffb74d' : '#ff6b6b'
}

function fmt$(v) {
  if (v == null) return '--'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtN(v, dec = 2) {
  if (v == null) return '--'
  return Number(v).toFixed(dec)
}

export default function PortfolioBuilder() {
  // Portfolio list state
  const [portfolios, setPortfolios] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [activeName, setActiveName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  // Holdings state
  const [holdings, setHoldings] = useState([])
  const [tickerInput, setTickerInput] = useState('')
  const [dollarInput, setDollarInput] = useState('')
  const [editingDollar, setEditingDollar] = useState(null)
  const [editDollarVal, setEditDollarVal] = useState('')

  // Analysis state
  const [period, setPeriod] = useState('1y')
  const [benchmark, setBenchmark] = useState('SPY')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Sort state
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)

  // Compare state
  const [compareIds, setCompareIds] = useState([])
  const [compareResult, setCompareResult] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)

  // All Weather state
  const [awOpen, setAwOpen] = useState(false)
  const [awStrategy, setAwStrategy] = useState('all_weather')
  const [awMode, setAwMode] = useState('income')
  const [awBudget, setAwBudget] = useState('100000')
  const [awFundsPerClass, setAwFundsPerClass] = useState(1)
  const [awSelectionMode, setAwSelectionMode] = useState('auto')
  const [awResult, setAwResult] = useState(null)
  const [awLoading, setAwLoading] = useState(false)
  const [awError, setAwError] = useState(null)
  const [awOverrides, setAwOverrides] = useState({})

  // Rebalance state
  const [rebalanceResult, setRebalanceResult] = useState(null)
  const [rebalanceLoading, setRebalanceLoading] = useState(false)

  // Settings state (for Gemini key)
  const [showSettings, setShowSettings] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')

  const chartsRendered = useRef(false)

  // ── Load portfolios ──────────────────────────────────────────────────────
  const loadPortfolios = useCallback(async () => {
    try {
      const res = await fetch('/api/builder/portfolios')
      const data = await res.json()
      setPortfolios(data.portfolios || [])
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadPortfolios() }, [loadPortfolios])

  // ── Load holdings when active portfolio changes ──────────────────────────
  const loadHoldings = useCallback(async (pid) => {
    if (!pid) return
    try {
      const res = await fetch(`/api/builder/portfolios/${pid}/holdings`)
      const data = await res.json()
      setHoldings(data.holdings || [])
    } catch (e) { console.error(e) }
  }, [])

  const autoAnalyze = useCallback(async (pid) => {
    setLoading(true)
    setError(null)
    chartsRendered.current = false
    try {
      const res = await fetch(`/api/builder/portfolios/${pid}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benchmark, period }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); setAnalysisResult(null) }
      else { setAnalysisResult(data) }
    } catch (e) { setError(e.message); setAnalysisResult(null) }
    setLoading(false)
  }, [benchmark, period])

  useEffect(() => {
    if (activeId) {
      loadHoldings(activeId).then(() => {
        // Auto-analyze if the portfolio has holdings
        const port = portfolios.find(p => p.id === activeId)
        if (port && port.holding_count > 0) {
          autoAnalyze(activeId)
        } else {
          setAnalysisResult(null)
          chartsRendered.current = false
        }
      })
    }
  }, [activeId, loadHoldings, portfolios, autoAnalyze])

  // ── Create portfolio ─────────────────────────────────────────────────────
  const createPortfolio = async () => {
    const name = prompt('Portfolio name:')
    if (!name || !name.trim()) return
    try {
      const res = await fetch('/api/builder/portfolios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      await loadPortfolios()
      setActiveId(data.id)
      setActiveName(name.trim())
    } catch (e) { alert(e) }
  }

  // ── Delete portfolio ─────────────────────────────────────────────────────
  const deletePortfolio = async (pid, e) => {
    e.stopPropagation()
    if (!confirm('Delete this portfolio?')) return
    await fetch(`/api/builder/portfolios/${pid}`, { method: 'DELETE' })
    if (activeId === pid) {
      setActiveId(null)
      setActiveName('')
      setHoldings([])
      setAnalysisResult(null)
    }
    loadPortfolios()
  }

  // ── Save As (duplicate) portfolio ───────────────────────────────────────
  const saveAsPortfolio = async () => {
    if (!activeId || holdings.length === 0) return
    const name = prompt('Save as new portfolio name:')
    if (!name || !name.trim()) return
    try {
      const res = await fetch('/api/builder/portfolios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      const newId = data.id
      for (const h of holdings) {
        await fetch(`/api/builder/portfolios/${newId}/holdings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: h.ticker, dollar_amount: h.dollar_amount }),
        })
      }
      await loadPortfolios()
      setActiveId(newId)
      setActiveName(name.trim())
    } catch (e) { alert(e) }
  }

  // ── Rename portfolio ─────────────────────────────────────────────────────
  const startRename = () => {
    setEditingName(true)
    setNameInput(activeName)
  }
  const commitRename = async () => {
    setEditingName(false)
    if (nameInput.trim() && nameInput.trim() !== activeName) {
      await fetch(`/api/builder/portfolios/${activeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() }),
      })
      setActiveName(nameInput.trim())
      loadPortfolios()
    }
  }

  // ── Clear all holdings ────────────────────────────────────────────────────
  const clearHoldings = async () => {
    if (!activeId || holdings.length === 0) return
    if (!confirm('Remove all holdings from this portfolio?')) return
    for (const h of holdings) {
      await fetch(`/api/builder/portfolios/${activeId}/holdings/${h.ticker}`, { method: 'DELETE' })
    }
    setHoldings([])
    setAnalysisResult(null)
    chartsRendered.current = false
    loadPortfolios()
  }

  // ── Add holding ──────────────────────────────────────────────────────────
  const addHolding = async () => {
    if (!activeId || !tickerInput.trim()) return
    const amount = parseFloat(dollarInput) || 0
    await fetch(`/api/builder/portfolios/${activeId}/holdings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: tickerInput.trim(), dollar_amount: amount }),
    })
    setTickerInput('')
    setDollarInput('')
    loadHoldings(activeId)
    loadPortfolios()
  }

  // ── Delete holding ───────────────────────────────────────────────────────
  const deleteHolding = async (ticker) => {
    await fetch(`/api/builder/portfolios/${activeId}/holdings/${ticker}`, { method: 'DELETE' })
    loadHoldings(activeId)
    loadPortfolios()
  }

  // ── Inline dollar edit ───────────────────────────────────────────────────
  const startDollarEdit = (ticker, val) => {
    setEditingDollar(ticker)
    setEditDollarVal(String(val))
  }
  const commitDollarEdit = async (ticker) => {
    setEditingDollar(null)
    const newVal = parseFloat(editDollarVal) || 0
    await fetch(`/api/builder/portfolios/${activeId}/holdings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, dollar_amount: newVal }),
    })
    loadHoldings(activeId)
  }

  // ── Analyze ──────────────────────────────────────────────────────────────
  const analyze = async () => {
    if (!activeId || holdings.length === 0) return
    setLoading(true)
    setError(null)
    chartsRendered.current = false
    try {
      const res = await fetch(`/api/builder/portfolios/${activeId}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benchmark, period }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); setAnalysisResult(null) }
      else { setAnalysisResult(data) }
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  // ── Render Plotly charts ─────────────────────────────────────────────────
  useEffect(() => {
    if (!analysisResult || chartsRendered.current || !window.Plotly) return
    chartsRendered.current = true
    const Plotly = window.Plotly
    const layoutBase = { paper_bgcolor: '#0a0a1a', plot_bgcolor: '#0a0a1a', margin: { t: 45, r: 20, b: 55, l: 60 } }
    const axisStyle = { color: '#888', gridcolor: '#1a1a2e' }

    // 1. Risk vs Return scatter
    const hld = (analysisResult.holdings || []).filter(h => h.annual_ret != null && h.annual_vol != null)
    const scatterEl = document.getElementById('pb-scatter')
    if (scatterEl && hld.length) {
      Plotly.purge(scatterEl)
      Plotly.newPlot(scatterEl, [{
        type: 'scatter', mode: 'markers+text',
        x: hld.map(h => h.annual_vol), y: hld.map(h => h.annual_ret),
        text: hld.map(h => h.ticker), textposition: 'top center',
        textfont: { color: '#ddd', size: 11, family: 'Arial Black' },
        marker: {
          color: hld.map(h => h.annual_ret >= 0 ? '#00e89a' : '#ff5252'),
          size: hld.map(h => Math.max(8, Math.min(44, (h.weight_pct || 1) * 2.8))),
          line: { color: '#333', width: 1 }, opacity: 0.85,
        },
        hovertemplate: hld.map(h =>
          `${h.ticker}<br>Return: ${h.annual_ret}%<br>Vol: ${h.annual_vol}%<br>Weight: ${h.weight_pct}%<br>Ulcer: ${h.ulcer_index ?? 'N/A'}<extra></extra>`
        ),
      }], {
        ...layoutBase,
        title: { text: 'Risk vs Return (bubble = weight)', font: { color: '#ddd', size: 13 } },
        xaxis: { ...axisStyle, title: { text: 'Risk (Annualized Volatility %)', font: { color: '#ccc', size: 13 } }, zeroline: false },
        yaxis: { ...axisStyle, title: { text: 'Return (Annualized %)', font: { color: '#ccc', size: 13 } }, zeroline: true, zerolinecolor: '#444' },
      }, { responsive: true })
    }

    // 2. Correlation heatmap
    const corrEl = document.getElementById('pb-corr')
    const corr = analysisResult.correlation
    if (corrEl && corr && corr.labels.length > 1) {
      Plotly.purge(corrEl)
      Plotly.newPlot(corrEl, [{
        type: 'heatmap', x: corr.labels, y: corr.labels, z: corr.matrix,
        colorscale: [[0, '#d32f2f'], [0.5, '#111124'], [1, '#00e89a']],
        zmin: -1, zmax: 1, showscale: true,
        colorbar: { tickfont: { color: '#888' }, len: 0.8 },
      }], {
        ...layoutBase, margin: { t: 45, r: 60, b: 90, l: 90 },
        title: { text: 'Correlation Matrix', font: { color: '#ddd', size: 13 } },
        xaxis: { color: '#888', tickangle: -45, tickfont: { size: 9 } },
        yaxis: { color: '#888', tickfont: { size: 9 }, autorange: 'reversed' },
      }, { responsive: true })
    } else if (corrEl) {
      corrEl.innerHTML = '<p style="color:#555;text-align:center;padding:2rem">Need 2+ tickers for correlation.</p>'
    }

    // 3. Drawdown
    const ddEl = document.getElementById('pb-drawdown')
    const dd = analysisResult.drawdown_series
    if (ddEl && dd && dd.dates.length) {
      Plotly.purge(ddEl)
      Plotly.newPlot(ddEl, [{
        x: dd.dates, y: dd.values, fill: 'tozeroy',
        fillcolor: 'rgba(255,82,82,0.15)', line: { color: '#ff5252', width: 1.5 },
        mode: 'lines', name: 'Drawdown',
        hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
      }], {
        ...layoutBase, margin: { t: 45, r: 20, b: 40, l: 60 },
        title: { text: 'Portfolio Drawdown', font: { color: '#ddd', size: 13 } },
        xaxis: axisStyle, yaxis: { ...axisStyle, tickformat: '.1f', ticksuffix: '%' },
      }, { responsive: true })
    }
  }, [analysisResult])

  // ── Compare ──────────────────────────────────────────────────────────────
  const toggleCompare = (pid) => {
    setCompareIds(prev => prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid])
  }

  const runCompare = async () => {
    if (compareIds.length < 2) { alert('Select at least 2 portfolios'); return }
    setCompareLoading(true)
    setCompareResult(null)
    try {
      const res = await fetch('/api/builder/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio_ids: compareIds, period, benchmark }),
      })
      const data = await res.json()
      if (data.error) alert(data.error)
      else setCompareResult(data)
    } catch (e) { alert(e) }
    setCompareLoading(false)
  }

  // Render radar chart for compare
  useEffect(() => {
    if (!compareResult || !window.Plotly) return
    const Plotly = window.Plotly
    const radarEl = document.getElementById('pb-radar')
    if (!radarEl) return
    Plotly.purge(radarEl)

    const categories = ['Sharpe', 'Sortino', 'Calmar', 'Omega', 'Ulcer Index', 'Max DD', 'Diversification']
    const traces = compareResult.results.map(p => {
      const bd = p.breakdown || {}
      const vals = [
        bd['Sharpe Ratio'] || 0, bd['Sortino Ratio'] || 0, bd['Calmar Ratio'] || 0,
        bd['Omega Ratio'] || 0, bd['Ulcer Index'] || 0, bd['Max Drawdown'] || 0,
        bd['Diversification'] || 0,
      ]
      return {
        type: 'scatterpolar', r: [...vals, vals[0]], theta: [...categories, categories[0]],
        fill: 'toself', name: p.name, opacity: 0.6,
      }
    })

    Plotly.newPlot(radarEl, traces, {
      polar: {
        radialaxis: { visible: true, range: [0, 100], color: '#888', gridcolor: '#1a1a2e' },
        angularaxis: { color: '#888' },
        bgcolor: '#0a0a1a',
      },
      paper_bgcolor: '#0a0a1a',
      title: { text: 'Portfolio Comparison', font: { color: '#ddd', size: 13 } },
      margin: { t: 50, r: 40, b: 40, l: 40 },
      showlegend: true, legend: { font: { color: '#aaa' } },
    }, { responsive: true })
  }, [compareResult])

  // ── All Weather ──────────────────────────────────────────────────────────
  const runAllWeather = async () => {
    setAwLoading(true)
    setAwError(null)
    setAwResult(null)
    setAwOverrides({})
    const endpoint = awSelectionMode === 'ai' ? '/api/builder/all-weather-ai' : '/api/builder/all-weather'
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: awMode, budget: parseFloat(awBudget) || 100000, strategy: awStrategy, funds_per_class: awFundsPerClass }),
      })
      const data = await res.json()
      if (data.error) { setAwError(data.error) }
      else { setAwResult(data) }
    } catch (e) { setAwError(e.message) }
    setAwLoading(false)
  }

  const applyAllWeather = async () => {
    if (!activeId || !awResult) return
    // Aggregate amounts per ticker (same ticker may appear if user overrides multiple rows to same ETF)
    const tickerAmounts = {}
    awResult.allocations.forEach((alloc, idx) => {
      const ticker = awOverrides[idx] || alloc.ticker
      tickerAmounts[ticker] = (tickerAmounts[ticker] || 0) + alloc.dollar_amount
    })
    for (const [ticker, amount] of Object.entries(tickerAmounts)) {
      await fetch(`/api/builder/portfolios/${activeId}/holdings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, dollar_amount: amount }),
      })
    }
    setAwOpen(false)
    setAwResult(null)
    loadHoldings(activeId)
    loadPortfolios()
  }

  // ── Rebalance ──────────────────────────────────────────────────────────────
  const runRebalance = async () => {
    if (!activeId || holdings.length === 0) { setAwError('Portfolio has no holdings to rebalance'); return }
    setRebalanceLoading(true)
    setAwError(null)
    setRebalanceResult(null)
    try {
      const res = await fetch(`/api/builder/portfolios/${activeId}/rebalance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: awMode, strategy: awStrategy }),
      })
      const data = await res.json()
      if (data.error) { setAwError(data.error) }
      else { setRebalanceResult(data) }
    } catch (e) { setAwError(e.message) }
    setRebalanceLoading(false)
  }

  const applyRebalance = async () => {
    if (!activeId || !rebalanceResult) return
    for (const s of rebalanceResult.suggestions) {
      if (s.action === 'on_target') continue
      await fetch(`/api/builder/portfolios/${activeId}/holdings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: s.suggested_ticker, dollar_amount: s.target_amount }),
      })
    }
    setAwOpen(false)
    setRebalanceResult(null)
    loadHoldings(activeId)
    loadPortfolios()
  }

  // ── Save Gemini key ──────────────────────────────────────────────────────
  const saveGeminiKey = async () => {
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gemini_api_key: geminiKey }),
    })
    setShowSettings(false)
    alert('API key saved')
  }

  // ── Sorting ──────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const sortedHoldings = React.useMemo(() => {
    const src = analysisResult ? analysisResult.holdings : holdings.map(h => ({
      ticker: h.ticker, dollar_amount: h.dollar_amount, weight_pct: 0, score: 0, grade: 'N/A',
    }))
    if (!sortCol) return src
    return [...src].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (av == null) av = -Infinity
      if (bv == null) bv = -Infinity
      return sortAsc ? av - bv : bv - av
    })
  }, [analysisResult, holdings, sortCol, sortAsc])

  const totalInvested = holdings.reduce((s, h) => s + (h.dollar_amount || 0), 0)

  // ── Column definitions ───────────────────────────────────────────────────
  const cols = [
    { key: 'ticker', label: 'Ticker', fmt: v => v, align: 'left' },
    { key: 'dollar_amount', label: '$ Amount', fmt: v => fmt$(v) },
    { key: 'shares', label: 'Shares', fmt: v => fmtN(v, 2) },
    { key: 'current_price', label: 'Price', fmt: v => fmt$(v) },
    { key: 'weight_pct', label: 'Wt%', fmt: v => fmtN(v, 1) },
    { key: 'score', label: 'Score', fmt: v => fmtN(v, 1) },
    { key: 'grade', label: 'Grade', fmt: v => v },
    { key: 'ulcer_index', label: 'Ulcer', fmt: v => fmtN(v, 2), color: (v) => metricColor(v, [3, 7, 12], true) },
    { key: 'sharpe', label: 'Sharpe', fmt: v => fmtN(v, 2), color: (v) => metricColor(v, [1.5, 1.0, 0.5]) },
    { key: 'sortino', label: 'Sortino', fmt: v => fmtN(v, 2), color: (v) => metricColor(v, [2.0, 1.5, 1.0]) },
    { key: 'calmar', label: 'Calmar', fmt: v => fmtN(v, 2), color: (v) => metricColor(v, [1.5, 1.0, 0.5]) },
    { key: 'omega', label: 'Omega', fmt: v => fmtN(v, 2), color: (v) => metricColor(v, [2.0, 1.5, 1.2]) },
    { key: 'annual_ret', label: 'Ret%', fmt: v => fmtN(v, 1) },
    { key: 'annual_vol', label: 'Vol%', fmt: v => fmtN(v, 1) },
    { key: 'max_drawdown', label: 'MDD%', fmt: v => fmtN(v, 1), color: (v) => metricColor(v != null ? Math.abs(v) : null, [10, 20, 30], true) },
    { key: 'up_capture', label: 'Up Cap', fmt: v => fmtN(v, 1) },
    { key: 'down_capture', label: 'Dn Cap', fmt: v => fmtN(v, 1), color: (v) => metricColor(v, [80, 90, 100], true) },
    { key: 'annual_yield_pct', label: 'Yield%', fmt: v => fmtN(v, 2) },
    { key: 'annual_income', label: 'Ann Inc', fmt: v => fmt$(v) },
    { key: 'monthly_income', label: 'Mo Inc', fmt: v => fmt$(v) },
    { key: 'nav_erosion_pct', label: 'NAV%', fmt: v => fmtN(v, 1), color: (v) => v == null ? '#8899aa' : v >= 0 ? '#4dff91' : v > -15 ? '#ffb74d' : '#ff6b6b' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────
  const pm = analysisResult?.portfolio_metrics
  const gradeInfo = pm?.grade

  return (
    <div className="pb-layout">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="pb-sidebar">
        <div className="pb-sidebar-title">Portfolios</div>
        <button className="pb-new-btn" onClick={createPortfolio}>+ New Portfolio</button>
        <div className="pb-port-list">
          {portfolios.map(p => (
            <div
              key={p.id}
              className={`pb-port-item ${p.id === activeId ? 'pb-port-active' : ''}`}
              onClick={() => { setActiveId(p.id); setActiveName(p.name) }}
            >
              <div className="pb-port-name">{p.name}</div>
              <div className="pb-port-count">{p.holding_count}</div>
              <button className="pb-port-del" onClick={(e) => deletePortfolio(p.id, e)} title="Delete">&times;</button>
            </div>
          ))}
        </div>
        <div className="pb-compare-section">
          <div className="pb-sidebar-title" style={{ marginTop: '1rem' }}>Compare</div>
          {portfolios.map(p => (
            <label key={p.id} className="pb-compare-item">
              <input
                type="checkbox"
                checked={compareIds.includes(p.id)}
                onChange={() => toggleCompare(p.id)}
              />
              <span>{p.name}</span>
            </label>
          ))}
          <button
            className="btn-primary"
            style={{ width: '100%', marginTop: '0.5rem', padding: '0.4rem' }}
            onClick={runCompare}
            disabled={compareLoading || compareIds.length < 2}
          >
            {compareLoading ? 'Comparing...' : 'Run Compare'}
          </button>
        </div>
      </div>

      {/* ── Main Panel ───────────────────────────────────────────────────── */}
      <div className="pb-main">
        {!activeId ? (
          <div style={{ color: '#556', textAlign: 'center', padding: '4rem 2rem', fontSize: '1.1rem' }}>
            Select or create a portfolio to begin.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="pb-header">
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <input
                    className="pb-name-input"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => e.key === 'Enter' && commitRename()}
                    autoFocus
                  />
                ) : (
                  <h2 className="pb-port-title" onClick={startRename} title="Click to rename">
                    {activeName}
                  </h2>
                )}
              </div>
              <div className="pb-controls">
                {PERIODS.map(p => (
                  <button
                    key={p.value}
                    className={`pb-period-btn ${period === p.value ? 'pb-period-active' : ''}`}
                    onClick={() => setPeriod(p.value)}
                  >{p.label}</button>
                ))}
                <input
                  className="pb-bench-input"
                  value={benchmark}
                  onChange={e => setBenchmark(e.target.value.toUpperCase())}
                  placeholder="Bench"
                  style={{ width: 60 }}
                />
                <button className="btn-primary" onClick={analyze} disabled={loading || holdings.length === 0}>
                  {loading ? 'Analyzing...' : 'Analyze'}
                </button>
                <button className="btn-success" onClick={() => { setAwOpen(true); setAwResult(null); setAwError(null); setRebalanceResult(null) }}>
                  Strategies
                </button>
                <button className="btn-secondary" onClick={saveAsPortfolio} disabled={holdings.length === 0} style={{ padding: '0.35rem 0.7rem' }}>
                  Save As
                </button>
                <button className="btn-danger" onClick={clearHoldings} disabled={holdings.length === 0} style={{ padding: '0.35rem 0.7rem' }}>
                  Clear
                </button>
                <button className="btn-secondary" onClick={() => setShowSettings(true)} title="Settings" style={{ padding: '0.35rem 0.6rem' }}>
                  &#9881;
                </button>
              </div>
            </div>

            {/* Add holding row */}
            <div className="pb-add-row">
              <input
                className="pb-add-ticker"
                placeholder="Ticker"
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && addHolding()}
              />
              <input
                className="pb-add-dollars"
                placeholder="$ Amount"
                type="number"
                value={dollarInput}
                onChange={e => setDollarInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addHolding()}
              />
              <button className="btn-primary" onClick={addHolding}>Add</button>
              <span style={{ color: '#8899aa', marginLeft: '1rem' }}>
                Total Invested: {fmt$(totalInvested)}
              </span>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {/* Holdings table */}
            <div className="pb-table-wrap">
              <table className="pb-table">
                <thead>
                  <tr>
                    {cols.map(c => (
                      <th
                        key={c.key}
                        onClick={() => handleSort(c.key)}
                        style={{ cursor: 'pointer', textAlign: c.align || 'right', whiteSpace: 'nowrap' }}
                      >
                        {c.label}
                        {sortCol === c.key ? (sortAsc ? ' \u25B4' : ' \u25BE') : ''}
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map(h => (
                    <tr key={h.ticker}>
                      {cols.map(c => {
                        const val = h[c.key]
                        // Inline dollar edit
                        if (c.key === 'dollar_amount' && editingDollar === h.ticker) {
                          return (
                            <td key={c.key}>
                              <input
                                type="number"
                                className="pb-dollar-input"
                                value={editDollarVal}
                                onChange={e => setEditDollarVal(e.target.value)}
                                onBlur={() => commitDollarEdit(h.ticker)}
                                onKeyDown={e => e.key === 'Enter' && commitDollarEdit(h.ticker)}
                                autoFocus
                              />
                            </td>
                          )
                        }
                        if (c.key === 'dollar_amount') {
                          return (
                            <td
                              key={c.key}
                              className="pb-dollar-cell"
                              onClick={() => startDollarEdit(h.ticker, val)}
                              style={{ cursor: 'pointer', textAlign: 'right' }}
                            >{c.fmt(val)}</td>
                          )
                        }
                        if (c.key === 'grade') {
                          return <td key={c.key} style={{ textAlign: 'center' }}><GradeBadge grade={val} /></td>
                        }
                        return (
                          <td
                            key={c.key}
                            style={{
                              textAlign: c.align || 'right',
                              color: c.color ? c.color(val) : undefined,
                            }}
                          >{c.fmt(val)}</td>
                        )
                      })}
                      <td>
                        <button className="pb-del-holding" onClick={() => deleteHolding(h.ticker)} title="Remove">&times;</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Grade Panel */}
            {gradeInfo && (
              <div className="card" style={{ marginTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', color: '#ddd' }}>Portfolio Report Card</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
                  {/* Grade ring */}
                  <div className="pb-grade-ring">
                    <GradeBadge grade={gradeInfo.overall} large />
                    <div style={{ color: '#8899aa', fontSize: '0.85rem', marginTop: '0.3rem' }}>
                      {gradeInfo.score} / 100
                    </div>
                  </div>

                  {/* Breakdown bars */}
                  <div style={{ flex: 1, minWidth: 280 }}>
                    {(gradeInfo.breakdown || []).map(b => {
                      const barW = Math.max(0, Math.min(100, b.score))
                      const barColor = b.score >= 90 ? '#4dff91' : b.score >= 70 ? '#7ecfff' : b.score >= 50 ? '#ffb74d' : '#ff6b6b'
                      return (
                        <div key={b.category} className="pb-breakdown-row">
                          <div className="pb-breakdown-label">{b.category}</div>
                          <div className="pb-breakdown-bar-bg">
                            <div className="pb-breakdown-bar" style={{ width: `${barW}%`, background: barColor }} />
                          </div>
                          <div className="pb-breakdown-grade" style={{ color: barColor }}>{b.grade}</div>
                          <div className="pb-breakdown-weight">{b.weight}%</div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Summary stats */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', minWidth: 140 }}>
                    {[
                      { label: 'Total Value', val: fmt$(pm.total_value) },
                      { label: 'Holdings', val: pm.n_holdings },
                      { label: 'Effective N', val: pm.effective_n },
                      { label: 'Max Drawdown', val: pm.max_drawdown != null ? (pm.max_drawdown * 100).toFixed(1) + '%' : '--' },
                      { label: 'Ulcer Index', val: pm.ulcer_index != null ? pm.ulcer_index.toFixed(2) : '--' },
                      { label: 'NAV Health', val: pm.nav_erosion_avg_pct != null ? pm.nav_erosion_avg_pct.toFixed(1) + '%' : '--' },
                      { label: 'Annual Income', val: fmt$(pm.est_annual_income) },
                      { label: 'Monthly Income', val: fmt$(pm.est_monthly_income) },
                    ].map(s => (
                      <div key={s.label} className="pb-stat-card">
                        <div className="pb-stat-val">{s.val}</div>
                        <div className="pb-stat-lbl">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Charts */}
            {analysisResult && (
              <div className="card" style={{ marginTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', color: '#ddd' }}>Risk & Performance Charts</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ flex: 1, minWidth: 340 }}>
                    <div id="pb-scatter" style={{ width: '100%', height: 380 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 340 }}>
                    <div id="pb-corr" style={{ width: '100%', height: 380 }} />
                  </div>
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <div id="pb-drawdown" style={{ width: '100%', height: 240 }} />
                </div>
              </div>
            )}

            {/* Compare Results */}
            {compareResult && (() => {
              const res = compareResult.results || []
              // For 2-portfolio comparison, compute deltas
              const hasDelta = res.length === 2
              const metrics = [
                { key: 'score', label: 'Score', dec: 1, lowerBetter: false },
                { key: 'monthly_income', label: 'Mo Income', fmt: 'dollar', lowerBetter: false },
                { key: 'sharpe', label: 'Sharpe', dec: 2, lowerBetter: false },
                { key: 'sortino', label: 'Sortino', dec: 2, lowerBetter: false },
                { key: 'calmar', label: 'Calmar', dec: 2, lowerBetter: false },
                { key: 'omega', label: 'Omega', dec: 2, lowerBetter: false },
                { key: 'ulcer_index', label: 'Ulcer', dec: 2, lowerBetter: true },
                { key: 'max_drawdown', label: 'Max DD', fmt: 'pct', lowerBetter: true },
                { key: 'effective_n', label: 'Eff N', dec: 1, lowerBetter: false },
              ]
              // winner per metric: index of the better portfolio (0 or 1)
              const winners = hasDelta ? metrics.map(m => {
                const a = res[0][m.key], b = res[1][m.key]
                if (a == null && b == null) return -1
                if (a == null) return 1
                if (b == null) return 0
                if (m.lowerBetter) return a < b ? 0 : a > b ? 1 : -1
                return a > b ? 0 : a < b ? 1 : -1
              }) : []
              // count wins
              const wins = hasDelta ? [0, 0] : []
              if (hasDelta) winners.forEach(w => { if (w >= 0) wins[w]++ })

              const fmtMetric = (m, val) => {
                if (val == null) return '--'
                if (m.fmt === 'dollar') return fmt$(val)
                if (m.fmt === 'pct') return (val * 100).toFixed(1) + '%'
                return Number(val).toFixed(m.dec)
              }
              const fmtDelta = (m, a, b) => {
                if (a == null || b == null) return '--'
                const diff = a - b
                if (m.fmt === 'dollar') return (diff >= 0 ? '+' : '') + fmt$(diff)
                if (m.fmt === 'pct') return (diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + '%'
                return (diff >= 0 ? '+' : '') + Number(diff).toFixed(m.dec)
              }

              return (
                <div className="card" style={{ marginTop: '1.5rem' }}>
                  <h3 style={{ marginBottom: '1rem', color: '#ddd' }}>Comparison</h3>
                  {hasDelta && (
                    <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                      <span style={{ color: '#4dff91' }}>{res[0].name}: {wins[0]} wins</span>
                      <span style={{ color: '#ff6b6b' }}>{res[1].name}: {wins[1]} wins</span>
                      <span style={{ color: '#8899aa' }}>Tied: {winners.filter(w => w === -1).length}</span>
                    </div>
                  )}
                  <div id="pb-radar" style={{ width: '100%', height: 420 }} />
                  <div className="pb-table-wrap" style={{ marginTop: '1rem' }}>
                    <table className="pb-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Portfolio</th>
                          <th>Grade</th>
                          {metrics.map(m => <th key={m.key}>{m.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {res.map((r, ri) => (
                          <tr key={r.id}>
                            <td style={{ textAlign: 'left' }}>{r.name}</td>
                            <td><GradeBadge grade={r.grade} /></td>
                            {metrics.map((m, mi) => {
                              const isWinner = hasDelta && winners[mi] === ri
                              const isLoser = hasDelta && winners[mi] >= 0 && winners[mi] !== ri
                              return (
                                <td key={m.key} style={{
                                  color: isWinner ? '#4dff91' : isLoser ? '#ff6b6b' : '#ddd',
                                  fontWeight: isWinner ? 700 : 400,
                                }}>
                                  {fmtMetric(m, r[m.key])}
                                  {isWinner && ' ▲'}
                                  {isLoser && ' ▼'}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                        {hasDelta && (
                          <tr style={{ borderTop: '2px solid #334' }}>
                            <td style={{ textAlign: 'left', color: '#8899aa', fontStyle: 'italic' }}>Difference</td>
                            <td style={{ color: '#8899aa' }}>--</td>
                            {metrics.map((m, mi) => {
                              const better = winners[mi] === 0
                              const worse = winners[mi] === 1
                              return (
                                <td key={m.key} style={{
                                  color: better ? '#4dff91' : worse ? '#ff6b6b' : '#8899aa',
                                  fontSize: '0.85rem',
                                }}>
                                  {fmtDelta(m, res[0][m.key], res[1][m.key])}
                                </td>
                              )
                            })}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {/* Compare Results — outside activeId gate so compare works without selecting a portfolio */}
        {!activeId && compareResult && (() => {
          const res = compareResult.results || []
          const hasDelta = res.length === 2
          const metrics = [
            { key: 'score', label: 'Score', dec: 1, lowerBetter: false },
            { key: 'monthly_income', label: 'Mo Income', fmt: 'dollar', lowerBetter: false },
            { key: 'sharpe', label: 'Sharpe', dec: 2, lowerBetter: false },
            { key: 'sortino', label: 'Sortino', dec: 2, lowerBetter: false },
            { key: 'calmar', label: 'Calmar', dec: 2, lowerBetter: false },
            { key: 'omega', label: 'Omega', dec: 2, lowerBetter: false },
            { key: 'ulcer_index', label: 'Ulcer', dec: 2, lowerBetter: true },
            { key: 'max_drawdown', label: 'Max DD', fmt: 'pct', lowerBetter: true },
            { key: 'effective_n', label: 'Eff N', dec: 1, lowerBetter: false },
          ]
          const winners = hasDelta ? metrics.map(m => {
            const a = res[0][m.key], b = res[1][m.key]
            if (a == null && b == null) return -1
            if (a == null) return 1
            if (b == null) return 0
            if (m.lowerBetter) return a < b ? 0 : a > b ? 1 : -1
            return a > b ? 0 : a < b ? 1 : -1
          }) : []
          const wins = hasDelta ? [0, 0] : []
          if (hasDelta) winners.forEach(w => { if (w >= 0) wins[w]++ })
          const fmtMetric = (m, val) => {
            if (val == null) return '--'
            if (m.fmt === 'dollar') return fmt$(val)
            if (m.fmt === 'pct') return (val * 100).toFixed(1) + '%'
            return Number(val).toFixed(m.dec)
          }
          const fmtDelta = (m, a, b) => {
            if (a == null || b == null) return '--'
            const diff = a - b
            if (m.fmt === 'dollar') return (diff >= 0 ? '+' : '') + fmt$(diff)
            if (m.fmt === 'pct') return (diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + '%'
            return (diff >= 0 ? '+' : '') + Number(diff).toFixed(m.dec)
          }
          return (
            <div className="card" style={{ marginTop: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', color: '#ddd' }}>Comparison</h3>
              {hasDelta && (
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                  <span style={{ color: '#4dff91' }}>{res[0].name}: {wins[0]} wins</span>
                  <span style={{ color: '#ff6b6b' }}>{res[1].name}: {wins[1]} wins</span>
                  <span style={{ color: '#8899aa' }}>Tied: {winners.filter(w => w === -1).length}</span>
                </div>
              )}
              <div id="pb-radar" style={{ width: '100%', height: 420 }} />
              <div className="pb-table-wrap" style={{ marginTop: '1rem' }}>
                <table className="pb-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Portfolio</th>
                      <th>Grade</th>
                      {metrics.map(m => <th key={m.key}>{m.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {res.map((r, ri) => (
                      <tr key={r.id}>
                        <td style={{ textAlign: 'left' }}>{r.name}</td>
                        <td><GradeBadge grade={r.grade} /></td>
                        {metrics.map((m, mi) => {
                          const isWinner = hasDelta && winners[mi] === ri
                          const isLoser = hasDelta && winners[mi] >= 0 && winners[mi] !== ri
                          return (
                            <td key={m.key} style={{
                              color: isWinner ? '#4dff91' : isLoser ? '#ff6b6b' : '#ddd',
                              fontWeight: isWinner ? 700 : 400,
                            }}>
                              {fmtMetric(m, r[m.key])}
                              {isWinner && ' ▲'}
                              {isLoser && ' ▼'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {hasDelta && (
                      <tr style={{ borderTop: '2px solid #334' }}>
                        <td style={{ textAlign: 'left', color: '#8899aa', fontStyle: 'italic' }}>Difference</td>
                        <td style={{ color: '#8899aa' }}>--</td>
                        {metrics.map((m, mi) => {
                          const better = winners[mi] === 0
                          const worse = winners[mi] === 1
                          return (
                            <td key={m.key} style={{
                              color: better ? '#4dff91' : worse ? '#ff6b6b' : '#8899aa',
                              fontSize: '0.85rem',
                            }}>
                              {fmtDelta(m, res[0][m.key], res[1][m.key])}
                            </td>
                          )
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Strategy Modal ────────────────────────────────────────────── */}
      {awOpen && (
        <div className="pb-modal-overlay" onClick={() => setAwOpen(false)}>
          <div className="pb-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ color: '#ddd', margin: 0 }}>
                {awStrategy === 'income_factory' ? "Bavaria's Income Factory" : 'All Weather Portfolio'}
              </h3>
              <button className="pb-port-del" onClick={() => setAwOpen(false)} style={{ fontSize: '1.4rem' }}>&times;</button>
            </div>

            {/* Strategy selector */}
            <div style={{ display: 'flex', gap: 6, marginBottom: '0.75rem' }}>
              {[
                { key: 'all_weather', label: 'All Weather' },
                { key: 'income_factory', label: "Bavaria's Income Factory" },
              ].map(s => (
                <button
                  key={s.key}
                  className={`pb-period-btn ${awStrategy === s.key ? 'pb-period-active' : ''}`}
                  onClick={() => { setAwStrategy(s.key); setAwResult(null); setRebalanceResult(null); setAwError(null) }}
                  style={{ padding: '0.5rem 1.2rem', fontSize: '0.95rem' }}
                >{s.label}</button>
              ))}
            </div>

            <p style={{ color: '#8899aa', fontSize: '0.85rem', marginBottom: '1rem' }}>
              {awStrategy === 'income_factory'
                ? 'Steven Bavaria-style Income Factory: ~2/3 credit (HY bonds, CLOs, BDCs) + ~1/3 equity-income (covered calls, REITs, MLPs, preferred). Target 8-10%+ yield.'
                : 'Ray Dalio-style allocation: 30% Stocks, 40% Long Bonds, 15% Intermediate Bonds, 5-7.5% Gold, 2.5% Silver (income), 7.5% Commodities'}
            </p>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
              <div>
                <label style={{ color: '#8899aa', fontSize: '0.85rem' }}>Mode</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {['income', 'growth'].map(m => (
                    <button
                      key={m}
                      className={`pb-period-btn ${awMode === m ? 'pb-period-active' : ''}`}
                      onClick={() => setAwMode(m)}
                      style={{ padding: '0.45rem 1.1rem', fontSize: '0.9rem' }}
                    >{m.charAt(0).toUpperCase() + m.slice(1)}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ color: '#8899aa', fontSize: '0.85rem' }}>ETF Selection Method</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    className={`aw-mode-btn ${awSelectionMode === 'auto' ? 'aw-mode-active' : ''}`}
                    onClick={() => setAwSelectionMode('auto')}
                    style={{ padding: '0.45rem 1rem', fontSize: '0.9rem' }}
                  >Auto</button>
                  <button
                    className={`aw-mode-btn aw-mode-ai ${awSelectionMode === 'ai' ? 'aw-mode-active' : ''}`}
                    onClick={() => setAwSelectionMode('ai')}
                    style={{ padding: '0.45rem 1rem', fontSize: '0.9rem' }}
                  >AI-Assisted</button>
                  <button
                    className={`aw-mode-btn ${awSelectionMode === 'manual' ? 'aw-mode-active' : ''}`}
                    onClick={() => setAwSelectionMode('manual')}
                    style={{ padding: '0.45rem 1rem', fontSize: '0.9rem' }}
                  >Manual</button>
                </div>
              </div>
              <div>
                <label style={{ color: '#8899aa', fontSize: '0.85rem' }}>Budget ($)</label>
                <input
                  type="number"
                  value={awBudget}
                  onChange={e => setAwBudget(e.target.value)}
                  style={{ width: 150, marginTop: 4, display: 'block', padding: '0.45rem 0.6rem', fontSize: '0.95rem' }}
                />
              </div>
              <div>
                <label style={{ color: '#8899aa', fontSize: '0.85rem' }}>Funds / Class</label>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      className={`pb-period-btn ${awFundsPerClass === n ? 'pb-period-active' : ''}`}
                      onClick={() => setAwFundsPerClass(n)}
                      style={{ padding: '0.45rem 0.8rem', fontSize: '0.9rem', minWidth: 36 }}
                    >{n}</button>
                  ))}
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={runAllWeather}
                disabled={awLoading}
                style={{ alignSelf: 'flex-end', padding: '0.5rem 1.2rem', fontSize: '0.95rem' }}
              >{awLoading ? 'Loading...' : 'Generate'}</button>
              <button
                className="btn-warning"
                onClick={runRebalance}
                disabled={rebalanceLoading || !activeId || holdings.length === 0}
                style={{ alignSelf: 'flex-end', padding: '0.5rem 1.2rem', fontSize: '0.95rem' }}
              >{rebalanceLoading ? 'Analyzing...' : 'Rebalance Current'}</button>
            </div>

            {awError && <div className="alert alert-error">{awError}</div>}

            {/* Results table */}
            {awResult && (
              <>
                <table className="pb-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Asset Class</th>
                      <th>Target %</th>
                      <th>ETF</th>
                      <th>Source</th>
                      <th>$ Amount</th>
                      {awResult.allocations.some(a => a.reasoning) && <th style={{ textAlign: 'left' }}>Reasoning</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {awResult.allocations.map((a, idx) => (
                      <tr key={`${a.asset_class}-${a.ticker}-${idx}`}>
                        <td style={{ textAlign: 'left' }}>{a.asset_class}</td>
                        <td>{a.target_pct}%</td>
                        <td>
                          {awSelectionMode === 'manual' ? (
                            <input
                              value={awOverrides[idx] || a.ticker}
                              onChange={e => setAwOverrides(prev => ({ ...prev, [idx]: e.target.value.toUpperCase() }))}
                              style={{ width: 90, textAlign: 'center' }}
                              list={`aw-opts-${idx}`}
                            />
                          ) : (
                            <span style={{ fontWeight: 600 }}>{a.ticker}</span>
                          )}
                          {awSelectionMode === 'manual' && (
                            <datalist id={`aw-opts-${idx}`}>
                              {(a.candidates || []).map(c => <option key={c} value={c} />)}
                            </datalist>
                          )}
                        </td>
                        <td>
                          <span className={`aw-source-tag aw-source-${a.source}`}>{a.source}</span>
                        </td>
                        <td>{fmt$(a.dollar_amount)}</td>
                        {a.reasoning !== undefined && <td style={{ textAlign: 'left', color: '#8899aa', fontSize: '0.8rem' }}>{a.reasoning}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-success" onClick={applyAllWeather} disabled={!activeId}>
                    Apply to Portfolio
                  </button>
                  <button className="btn-secondary" onClick={() => setAwOpen(false)}>Cancel</button>
                </div>
              </>
            )}

            {/* Rebalance Results */}
            {rebalanceResult && (
              <>
                <h4 style={{ color: '#ddd', margin: '1.5rem 0 0.5rem', borderTop: '1px solid #333', paddingTop: '1rem' }}>
                  Rebalance Suggestions
                  <span style={{ color: '#8899aa', fontSize: '0.8rem', marginLeft: '0.8rem' }}>
                    Total: {fmt$(rebalanceResult.total_value)}
                  </span>
                </h4>
                <table className="pb-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Asset Class</th>
                      <th>Target %</th>
                      <th>Current %</th>
                      <th>Drift</th>
                      <th>Current $</th>
                      <th>Target $</th>
                      <th style={{ textAlign: 'left' }}>Action</th>
                      <th>Ticker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalanceResult.suggestions.map(s => {
                      const driftColor = Math.abs(s.drift_pct) <= 2 ? '#4dff91' : Math.abs(s.drift_pct) <= 5 ? '#ffb74d' : '#ff6b6b'
                      const actionColor = s.action === 'buy' ? '#4dff91' : s.action === 'reduce' ? '#ff6b6b' : s.action === 'add_new' ? '#7ecfff' : '#8899aa'
                      const actionText = s.action === 'buy' ? `Buy ${fmt$(s.change_amount)}`
                        : s.action === 'reduce' ? `Reduce ${fmt$(Math.abs(s.change_amount))}`
                        : s.action === 'add_new' ? `Add New: ${fmt$(s.change_amount)}`
                        : 'On Target'
                      return (
                        <tr key={s.asset_class}>
                          <td style={{ textAlign: 'left' }}>{s.asset_class}</td>
                          <td>{s.target_pct}%</td>
                          <td>{s.current_pct}%</td>
                          <td style={{ color: driftColor, fontWeight: 600 }}>
                            {s.drift_pct > 0 ? '+' : ''}{s.drift_pct}%
                          </td>
                          <td>{fmt$(s.current_amount)}</td>
                          <td>{fmt$(s.target_amount)}</td>
                          <td style={{ textAlign: 'left', color: actionColor, fontWeight: 600 }}>{actionText}</td>
                          <td style={{ fontWeight: 600 }}>{s.suggested_ticker}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {rebalanceResult.unclassified.length > 0 && (
                  <div style={{ marginTop: '0.8rem', color: '#8899aa', fontSize: '0.8rem' }}>
                    <strong style={{ color: '#ffb74d' }}>Unclassified holdings</strong> (not part of this strategy's template):
                    {' '}{rebalanceResult.unclassified.map(h => `${h.ticker} (${fmt$(h.amount)})`).join(', ')}
                  </div>
                )}
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-success" onClick={applyRebalance}>
                    Apply Suggestions
                  </button>
                  <button className="btn-secondary" onClick={() => setRebalanceResult(null)}>Dismiss</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Settings Modal ───────────────────────────────────────────────── */}
      {showSettings && (
        <div className="pb-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="pb-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3 style={{ color: '#ddd', marginBottom: '1rem' }}>Builder Settings</h3>
            <label style={{ color: '#8899aa', fontSize: '0.85rem' }}>Google Gemini API Key</label>
            <input
              type="password"
              value={geminiKey}
              onChange={e => setGeminiKey(e.target.value)}
              placeholder="Enter Gemini API key..."
              style={{ width: '100%', marginTop: '0.3rem', marginBottom: '1rem' }}
            />
            <p style={{ color: '#556', fontSize: '0.75rem', marginBottom: '1rem' }}>
              Get a free key at aistudio.google.com. Required for AI-assisted ETF selection.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-primary" onClick={saveGeminiKey}>Save</button>
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
