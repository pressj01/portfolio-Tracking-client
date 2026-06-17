import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, themedPlotlyLayout } from '../utils/chartTheme'

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function MetricCard({ label, value }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '—'}</div>
    </div>
  )
}

const fmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmtPct = v => v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—'
const fmtPctRaw = v => v != null ? `${Number(v).toFixed(2)}%` : '—'

const fmtNum = v => v != null && v !== '' ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '\u2014'

function SafetyBadge({ level }) {
  const text = level || 'Unknown'
  const cls = String(text).toLowerCase().replace(/\s+/g, '-')
  return <span className={`safety-badge safety-${cls}`}>{text}</span>
}

function SafetyScore({ score }) {
  if (score == null) return <span className="safety-score safety-unknown">{'\u2014'}</span>
  const level = score >= 80 ? 'low' : score >= 65 ? 'moderate' : score >= 45 ? 'elevated' : 'high'
  return <span className={`safety-score safety-${level}`}>{Math.round(Number(score))}</span>
}

function SafetyModelLabel({ model }) {
  const labels = {
    stock: 'Stock',
    fund: 'Fund',
    option_income: 'Option Income',
    bdc: 'BDC',
  }
  return labels[model] || 'Other'
}

const METRIC_OPTIONS = [
  { value: 'yield_pct', label: 'Yield (%)' },
  { value: 'annual_payout', label: 'Annual payout ($)' },
]
const GROUP_OPTIONS = [
  { value: 'holdings', label: 'Holdings' },
  { value: 'categories', label: 'Categories' },
]
const DONUT_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8',
  '#4dd0e1', '#aed581', '#fff176', '#f06292', '#7986cb',
  '#90a4ae', '#a1887f',
]

function YieldPayoutChart({ rows }) {
  const chartRef = useRef(null)
  const { isDark } = useTheme()
  const [metric, setMetric] = useState('yield_pct')
  const [group, setGroup] = useState('holdings')
  const [metricOpen, setMetricOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const metricRef = useRef(null)
  const groupRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (metricRef.current && !metricRef.current.contains(e.target)) setMetricOpen(false)
      if (groupRef.current && !groupRef.current.contains(e.target)) setGroupOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const chartData = useMemo(() => {
    if (!rows?.length) return null

    const currentYieldPct = (row) => {
      const directYield = Number(row.current_annual_yield)
      if (Number.isFinite(directYield) && directYield > 0) return directYield * 100

      const annualPayout = Number(row.estim_payment_per_year) || 0
      const currentValue = Number(row.current_value) || 0
      return annualPayout > 0 && currentValue > 0 ? (annualPayout / currentValue) * 100 : 0
    }

    const groupKey = {
      holdings: 'ticker',
      categories: 'category_name',
    }[group]

    // Aggregate by group
    const grouped = {}
    rows.forEach(r => {
      const key = r[groupKey] || 'Other'
      if (!grouped[key]) grouped[key] = { yield_sum: 0, yield_count: 0, annual_payout: 0, value: 0 }
      const yld = currentYieldPct(r)
      grouped[key].yield_sum += yld
      grouped[key].yield_count += 1
      grouped[key].annual_payout += (r.estim_payment_per_year || 0)
      grouped[key].value += (r.current_value || 0)
    })

    // Build arrays
    let entries = Object.entries(grouped).map(([label, d]) => ({
      label,
      yield_pct: group === 'holdings'
        ? currentYieldPct(rows.find(r => r.ticker === label) || {})
        : (d.value > 0 ? (d.annual_payout / d.value) * 100 : (d.yield_count > 0 ? d.yield_sum / d.yield_count : 0)),
      annual_payout: d.annual_payout,
      value: d.value,
    }))

    // Sort descending by selected metric
    const sortKey = metric === 'yield_pct' ? 'yield_pct' : 'annual_payout'
    entries.sort((a, b) => b[sortKey] - a[sortKey])

    const yields = entries.map(e => e.yield_pct)
    const payouts = entries.map(e => e.annual_payout)
    const maxYield = Math.max(...yields, 0)
    const minVisibleYield = maxYield > 0 ? Math.max(maxYield * 0.055, 3) : 0
    const displayYields = yields.map(v => (v > 0 && v < minVisibleYield ? minVisibleYield : v))

    return {
      labels: entries.map(e => e.label),
      yields,
      payouts,
      displayYields,
    }
  }, [rows, metric, group])

  useEffect(() => {
    if (!chartData || !chartRef.current || !window.Plotly) return
    const el = chartRef.current
    const ct = chartTheme(isDark)

    const traces = [
      {
        x: chartData.labels,
        y: chartData.displayYields,
        customdata: chartData.yields,
        type: 'bar',
        name: 'Yield (%)',
        marker: { color: '#38bdf8', line: { color: '#7dd3fc', width: 1 } },
        opacity: 0.95,
        text: chartData.yields.map(v => `${v.toFixed(1)}%`),
        textposition: 'none',
        hovertemplate: '%{x}<br>Yield: %{customdata:.2f}%<extra></extra>',
      },
      {
        x: chartData.labels,
        y: chartData.payouts,
        customdata: chartData.payouts,
        type: 'scatter',
        mode: 'markers',
        name: 'Annual Payout ($)',
        marker: { color: '#a855f7', size: 7, symbol: 'circle', line: { width: 1, color: '#d8b4fe' } },
        yaxis: 'y2',
        hovertemplate: '%{x}<br>Est. annual payout: $%{customdata:,.0f}<extra></extra>',
      },
    ]

    const layout = themedPlotlyLayout({
      margin: { t: 10, b: chartData.labels.length > 15 ? 120 : 80, l: 60, r: 60 },
      xaxis: {
        tickangle: chartData.labels.length > 10 ? -45 : 0,
        tickfont: { size: chartData.labels.length > 30 ? 9 : 11 },
      },
      yaxis: {
        title: 'Yield (%)',
        titlefont: { color: '#38bdf8', size: 12 },
        tickfont: { color: '#38bdf8' },
        ticksuffix: '%',
        separatethousands: true,
      },
      yaxis2: {
        title: 'Annual Payout ($)',
        titlefont: { color: '#a855f7', size: 12 },
        tickfont: { color: '#a855f7' },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        tickprefix: '$',
        separatethousands: true,
      },
      legend: { orientation: 'h', y: 1.12, x: 0.5, xanchor: 'center' },
      bargap: 0.15,
    }, isDark)

    window.Plotly.newPlot(el, traces, themedPlotlyLayout(layout, isDark), { responsive: true })
    return () => window.Plotly.purge(el)
  }, [chartData, metric, isDark])

  if (!rows?.length) return null

  const metricLabel = METRIC_OPTIONS.find(o => o.value === metric)?.label
  const groupLabel = GROUP_OPTIONS.find(o => o.value === group)?.label

  const dropdownStyle = {
    position: 'relative', display: 'inline-block',
  }
  const btnStyle = {
    background: 'transparent', border: '1px solid var(--p-334155)', color: 'var(--text-strong)',
    padding: '0.3rem 0.7rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem',
    minWidth: '130px', textAlign: 'left',
  }
  const menuStyle = {
    position: 'absolute', top: '100%', right: 0, zIndex: 20,
    background: 'var(--p-1e293b)', border: '1px solid var(--p-334155)', borderRadius: '4px',
    boxShadow: '0 4px 12px var(--panel-dim)', minWidth: '140px',
  }
  const itemStyle = (active) => ({
    padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem',
    color: active ? '#38bdf8' : '#e0e8f5',
    background: active ? 'rgba(56,189,248,0.1)' : 'transparent',
  })

  return (
    <div className="da-chart-panel" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem 0.25rem' }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-strong)' }}>
          Yield/Payout <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', cursor: 'help' }} title="Compare yield and payout across your portfolio grouped by different dimensions">&#9432;</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div ref={metricRef} style={dropdownStyle}>
            <button style={btnStyle} onClick={() => { setMetricOpen(o => !o); setGroupOpen(false) }}>
              {metricLabel} <span style={{ float: 'right', marginLeft: '0.5rem', fontSize: '0.7em' }}>&#9662;</span>
            </button>
            {metricOpen && (
              <div style={menuStyle}>
                {METRIC_OPTIONS.map(o => (
                  <div key={o.value} style={itemStyle(o.value === metric)}
                    onMouseEnter={e => e.target.style.background = 'rgba(56,189,248,0.15)'}
                    onMouseLeave={e => e.target.style.background = o.value === metric ? 'rgba(56,189,248,0.1)' : 'transparent'}
                    onClick={() => { setMetric(o.value); setMetricOpen(false) }}>
                    {o.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div ref={groupRef} style={dropdownStyle}>
            <button style={btnStyle} onClick={() => { setGroupOpen(o => !o); setMetricOpen(false) }}>
              {groupLabel} <span style={{ float: 'right', marginLeft: '0.5rem', fontSize: '0.7em' }}>&#9662;</span>
            </button>
            {groupOpen && (
              <div style={menuStyle}>
                {GROUP_OPTIONS.map(o => (
                  <div key={o.value} style={itemStyle(o.value === group)}
                    onMouseEnter={e => e.target.style.background = 'rgba(56,189,248,0.15)'}
                    onMouseLeave={e => e.target.style.background = o.value === group ? 'rgba(56,189,248,0.1)' : 'transparent'}
                    onClick={() => { setGroup(o.value); setGroupOpen(false) }}>
                    {o.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 1rem 0.35rem', color: 'var(--p-9aa8ba)', fontSize: '0.78rem', lineHeight: 1.35 }}>
        Blue bars show estimated annual yield on the left axis. Purple dots show estimated annual payout dollars on the right axis. Compare bars to bars and dots to dots; a high-yield holding may still pay fewer dollars if the position is small.
      </div>
      <div ref={chartRef} style={{ width: '100%', height: '400px' }} />
    </div>
  )
}

function CategoryDividendsChart({ rows, categories }) {
  const chartRef = useRef(null)
  const { isDark } = useTheme()
  const [categoryId, setCategoryId] = useState('')
  const [subcategoryId, setSubcategoryId] = useState('')

  const selectedCategory = useMemo(
    () => categories?.find(c => String(c.id) === String(categoryId)) || null,
    [categories, categoryId]
  )

  const subcategoryOptions = useMemo(() => {
    const source = selectedCategory ? [selectedCategory] : (categories || [])
    return source.flatMap(c => (c.subcategories || []).map(s => ({
      ...s,
      categoryName: c.name,
    })))
  }, [categories, selectedCategory])

  useEffect(() => {
    if (!subcategoryId) return
    const stillAvailable = subcategoryOptions.some(s => String(s.id) === String(subcategoryId))
    if (!stillAvailable) setSubcategoryId('')
  }, [subcategoryId, subcategoryOptions])

  const chartData = useMemo(() => {
    if (!rows?.length) return null

    const add = (bucket, name, value, count = 1) => {
      if (value <= 0) return
      if (!bucket[name]) bucket[name] = { name, value: 0, count: 0 }
      bucket[name].value += value
      bucket[name].count += count
    }

    const grouped = {}
    if (selectedCategory && subcategoryId) {
      rows
        .filter(r => r.category_name === selectedCategory.name && String(r.subcategory_id || '') === String(subcategoryId))
        .forEach(r => add(grouped, r.ticker || 'Unknown', Number(r.total_divs_received) || 0))
    } else if (selectedCategory) {
      const subcats = selectedCategory.subcategories || []
      if (subcats.length) {
        subcats.forEach(s => { grouped[s.name] = { name: s.name, value: 0, count: 0 } })
        grouped.Unassigned = { name: 'Unassigned', value: 0, count: 0 }
        rows
          .filter(r => r.category_name === selectedCategory.name)
          .forEach(r => {
            const value = Number(r.total_divs_received) || 0
            const sub = subcats.find(s => String(s.id) === String(r.subcategory_id || ''))
            add(grouped, sub ? sub.name : 'Unassigned', value)
          })
      } else {
        rows
          .filter(r => r.category_name === selectedCategory.name)
          .forEach(r => add(grouped, r.ticker || 'Unknown', Number(r.total_divs_received) || 0))
      }
    } else {
      rows.forEach(r => add(grouped, r.category_name || 'Other', Number(r.total_divs_received) || 0))
    }

    const entries = Object.values(grouped)
      .filter(g => g.value > 0)
      .sort((a, b) => b.value - a.value)
    const total = entries.reduce((sum, e) => sum + e.value, 0)

    return {
      labels: entries.map(e => e.name),
      values: entries.map(e => e.value),
      entries,
      total,
    }
  }, [rows, selectedCategory, subcategoryId])

  useEffect(() => {
    if (!chartRef.current || !window.Plotly) return
    const el = chartRef.current
    const ct = chartTheme(isDark)

    if (!chartData?.labels?.length) {
      window.Plotly.purge(el)
      return
    }

    const colors = chartData.labels.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length])
    const traces = [{
      type: 'pie',
      hole: 0.55,
      labels: chartData.labels,
      values: chartData.values,
      marker: { colors, line: { color: ct.surface, width: 1.5 } },
      textinfo: 'none',
      hovertemplate: '%{label}: $%{value:,.2f}<br>%{percent}<extra></extra>',
      sort: false,
    }]
    const layout = themedPlotlyLayout({
      margin: { l: 10, r: 10, t: 10, b: 10 },
      showlegend: false,
      height: 280,
      width: 280,
    }, isDark, { surface: true })

    window.Plotly.newPlot(el, traces, themedPlotlyLayout(layout, isDark), { responsive: true, displayModeBar: false })
    return () => window.Plotly.purge(el)
  }, [chartData, isDark])

  const controlStyle = {
    background: 'var(--border)',
    border: '1px solid var(--p-1a2a4a)',
    color: 'var(--text-strong)',
    borderRadius: '6px',
    padding: '0.3rem 0.5rem',
    fontSize: '0.82rem',
  }
  const selectedSubcategory = subcategoryOptions.find(s => String(s.id) === String(subcategoryId))
  const heading = selectedSubcategory
    ? selectedSubcategory.name
    : selectedCategory
      ? selectedCategory.name
      : 'All Categories'
  const nameLabel = selectedSubcategory ? 'Holding' : selectedCategory ? 'Name' : 'Category'

  return (
    <div className="da-chart-panel" style={{ padding: '0.75rem 1rem' }}>
      <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.75rem', fontSize: '1rem' }}>Total Dividends Received</h3>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Category:</span>
        <select style={controlStyle} value={categoryId} onChange={e => { setCategoryId(e.target.value); setSubcategoryId('') }} title="Filter category">
          <option value="">All categories</option>
          {(categories || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selectedCategory && selectedCategory.subcategories?.length > 0 && (
          <>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Sub-category:</span>
            <select style={controlStyle} value={subcategoryId} onChange={e => setSubcategoryId(e.target.value)} title="Filter subcategory">
              <option value="">All sub-categories</option>
              {selectedCategory.subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        )}
        {categoryId && (
          <button
            onClick={() => { setCategoryId(''); setSubcategoryId('') }}
            style={{ ...controlStyle, cursor: 'pointer', color: 'var(--accent-2)' }}
          >
            Clear
          </button>
        )}
      </div>
      {chartData?.labels?.length ? (
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
          <div ref={chartRef} style={{ width: 280, flexShrink: 0 }} />
          <div style={{ flex: 1, overflowX: 'auto', minWidth: 0 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
              {heading} - {fmt(chartData.total)} total dividends received
            </div>
            <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.55rem 0.65rem', color: 'var(--p-b5c5d8)' }}>{nameLabel}</th>
                  <th style={{ textAlign: 'right', padding: '0.55rem 0.65rem', color: 'var(--p-b5c5d8)' }}>Total Dividends</th>
                  <th style={{ textAlign: 'right', padding: '0.55rem 0.65rem', color: 'var(--p-b5c5d8)' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {chartData.entries.map((g, i) => {
                  const color = DONUT_COLORS[i % DONUT_COLORS.length]
                  const share = chartData.total ? (g.value / chartData.total) * 100 : 0
                  return (
                    <tr key={g.name} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.55rem 0.65rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <div>
                            <div style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{g.name}</div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{g.count} item{g.count !== 1 ? 's' : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.55rem 0.65rem', color: 'var(--text-strong)' }}>{fmt(g.value)}</td>
                      <td style={{ textAlign: 'right', padding: '0.55rem 0.65rem', color: 'var(--text-strong)' }}>{share.toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
          No dividend history for the selected category filters.
          <div ref={chartRef} style={{ display: 'none' }} />
        </div>
      )}
    </div>
  )
}

function DividendPipelineChart({ pipeline }) {
  const chartRef = useRef(null)
  const { isDark } = useTheme()
  const [selectedMonth, setSelectedMonth] = useState('')

  useEffect(() => {
    if (!pipeline?.months?.length) return
    setSelectedMonth(prev => (prev && pipeline.months.includes(prev)) ? prev : pipeline.months[0])
  }, [pipeline])

  useEffect(() => {
    if (!pipeline?.months?.length || !chartRef.current || !window.Plotly) return
    const el = chartRef.current
    const ct = chartTheme(isDark)
    const labels = pipeline.labels || pipeline.months
    const months = pipeline.months
    const valueFor = (month, key) => Number(pipeline.totals?.[month]?.[key] || 0)

    const traces = [
      {
        x: labels,
        y: months.map(m => valueFor(m, 'received')),
        name: 'Received',
        type: 'bar',
        marker: { color: '#22c55e' },
        customdata: months,
        hovertemplate: '<b>%{x}</b><br>Received: $%{y:,.2f}<extra></extra>',
      },
      {
        x: labels,
        y: months.map(m => valueFor(m, 'earned_not_paid')),
        name: 'Ex-Date Passed',
        type: 'bar',
        marker: { color: '#38bdf8' },
        customdata: months,
        hovertemplate: '<b>%{x}</b><br>Ex-date passed: $%{y:,.2f}<extra></extra>',
      },
      {
        x: labels,
        y: months.map(m => valueFor(m, 'declared')),
        name: 'Announced',
        type: 'bar',
        marker: { color: '#a855f7' },
        customdata: months,
        hovertemplate: '<b>%{x}</b><br>Announced, ex-date upcoming: $%{y:,.2f}<extra></extra>',
      },
      {
        x: labels,
        y: months.map(m => valueFor(m, 'estimated')),
        name: 'Unconfirmed Estimate',
        type: 'bar',
        marker: { color: '#64748b' },
        customdata: months,
        hovertemplate: '<b>%{x}</b><br>Unconfirmed estimate: $%{y:,.2f}<extra></extra>',
      },
    ]

    const totals = months.map(m => ['received', 'earned_not_paid', 'declared', 'estimated'].reduce((sum, key) => sum + valueFor(m, key), 0))
    traces.push({
      x: labels,
      y: totals,
      type: 'scatter',
      mode: 'text',
      name: 'Total',
      text: totals.map(v => v > 0 ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ''),
      textposition: 'top center',
      textfont: { color: ct.title, size: 11 },
      hoverinfo: 'skip',
      showlegend: false,
    })
    const maxTotal = Math.max(...totals, 100)
    const layout = themedPlotlyLayout({
      title: `Dividend Pipeline - Next 12 Months | Bar total = full monthly projection${pipeline.as_of ? ` | As of ${pipeline.as_of}` : ''}`,
      barmode: 'stack',
      xaxis: { type: 'category', categoryorder: 'array', categoryarray: labels },
      yaxis: { title: 'Dividend Income ($)', tickprefix: '$', range: [0, maxTotal * 1.28] },
      legend: { orientation: 'h', y: 1.12, x: 0.5, xanchor: 'center' },
      margin: { t: 70, b: 60, l: 70, r: 20 },
    }, isDark)

    window.Plotly.newPlot(el, traces, themedPlotlyLayout(layout, isDark), { responsive: true, displayModeBar: false })
    return () => window.Plotly.purge(el)
  }, [pipeline, isDark])

  if (!pipeline?.months?.length) return null

  const details = pipeline.details?.[selectedMonth] || []
  const selectedLabel = pipeline.labels?.[pipeline.months.indexOf(selectedMonth)] || selectedMonth
  const selectedTotals = pipeline.totals?.[selectedMonth] || {}
  const statusColor = {
    Received: '#22c55e',
    'Ex-Date Passed': '#38bdf8',
    'Announced, Ex-Date Upcoming': '#a855f7',
    'Unconfirmed Estimate': '#94a3b8',
  }
  const monthTotal = ['received', 'earned_not_paid', 'declared', 'estimated']
    .reduce((sum, key) => sum + Number(selectedTotals[key] || 0), 0)
  const bucketLabel = {
    received: 'Received',
    earned_not_paid: 'Ex-date passed',
    declared: 'Announced',
    estimated: 'Unconfirmed estimate',
  }

  return (
    <div className="da-chart-panel">
      <div style={{ padding: '0.75rem 1rem 0.25rem' }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-strong)', marginBottom: '0.35rem' }}>
          Dividend Pipeline
        </div>
        <div style={{ color: 'var(--p-9aa8ba)', fontSize: '0.78rem', lineHeight: 1.35 }}>
          Stacked by certainty. The gray segment is only the remaining unconfirmed estimate; the full monthly projection is the total height of all stacked segments.
        </div>
      </div>
      <div ref={chartRef} className="da-chart-div" style={{ height: '420px' }} />
      <div style={{ padding: '0 1rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          <label style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Month</label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{ background: 'var(--border)', color: 'var(--text-strong)', border: '1px solid var(--p-1a2a4a)', borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
          >
            {pipeline.months.map((m, i) => <option key={m} value={m}>{pipeline.labels?.[i] || m}</option>)}
          </select>
          <span style={{ color: 'var(--text-strong)', fontSize: '0.85rem' }}>
            {selectedLabel}: {fmt(monthTotal)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.65rem', color: 'var(--p-9aa8ba)', fontSize: '0.8rem' }}>
          {['received', 'earned_not_paid', 'declared', 'estimated'].map(key => (
            <span key={key}>
              {bucketLabel[key]}: <strong style={{ color: 'var(--text-strong)' }}>{fmt(selectedTotals[key] || 0)}</strong>
            </span>
          ))}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem', color: 'var(--p-b5c5d8)' }}>Ticker</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem', color: 'var(--p-b5c5d8)' }}>Status</th>
                <th style={{ textAlign: 'center', padding: '0.5rem 0.6rem', color: 'var(--p-b5c5d8)' }}>Ex-Date</th>
                <th style={{ textAlign: 'center', padding: '0.5rem 0.6rem', color: 'var(--p-b5c5d8)' }}>Pay Date</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0.6rem', color: 'var(--p-b5c5d8)' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem', color: 'var(--p-b5c5d8)' }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {details.length ? details.map((d, i) => (
                <tr key={`${d.ticker}-${d.status}-${d.pay_date}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-strong)', fontWeight: 600 }}>{d.ticker}</td>
                  <td style={{ padding: '0.5rem 0.6rem', color: statusColor[d.status] || 'var(--text-strong)' }}>{d.status}</td>
                  <td style={{ padding: '0.5rem 0.6rem', textAlign: 'center', color: 'var(--p-cbd5e1)' }}>{d.ex_date || '\u2014'}</td>
                  <td style={{ padding: '0.5rem 0.6rem', textAlign: 'center', color: 'var(--p-cbd5e1)' }}>{d.pay_date || '\u2014'}</td>
                  <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: 'var(--text-strong)' }}>{fmt(d.amount)}</td>
                  <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-dim)' }}>{d.source || '\u2014'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-dim)' }}>
                    No pipeline details for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function DividendAnalysis() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [recalcMsg, setRecalcMsg] = useState(null)
  const [recalcing, setRecalcing] = useState(false)

  useEffect(() => {
    const handler = (e) => { if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchData = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    pf(`/api/dividend-analysis/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [categories, subcategories, selection, pf])

  useEffect(() => { fetchData() }, [fetchData])

  const handleRecalcPayouts = async () => {
    setRecalcing(true)
    setRecalcMsg(null)
    try {
      const res = await pf('/api/payouts/monthly/recalculate', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setRecalcMsg(d.message)
      fetchData()
    } catch (e) {
      setRecalcMsg(`Error: ${e.message}`)
    } finally {
      setRecalcing(false)
    }
  }

  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const cfg = { responsive: true }
    const ids = []

    const chartMap = {
      annual_income: 'da-chart-annual-income',
      projected_monthly: 'da-chart-projected-monthly',
      monthly_received: 'da-chart-monthly-received',
      total_divs_ticker: 'da-chart-total-divs-ticker',
      paid_for_itself: 'da-chart-paid-for-itself',
    }

    Object.entries(chartMap).forEach(([key, elId]) => {
      const el = document.getElementById(elId)
      if (!el || !data.charts[key]) return
      ids.push(elId)
      const fig = JSON.parse(data.charts[key])
      Plotly.newPlot(el, fig.data, themedPlotlyLayout(fig.layout, isDark), cfg)
    })

    return () => {
      ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) Plotly.purge(el)
      })
    }
  }, [data, isDark])

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(a => !a)
    } else {
      setSortCol(col)
      // Default descending for numeric columns
      const numCols = ['quantity', 'ytd_divs', 'total_divs_received', 'paid_for_itself', 'dividend_paid', 'estim_payment_per_year', 'approx_monthly_income', 'annual_yield_on_cost', 'current_annual_yield', 'gain_or_loss', 'safety_score', 'payout_ratio_pct', 'earnings_coverage', 'dividend_streak_years', 'debt_to_equity']
      setSortAsc(!numCols.includes(col))
    }
  }

  const sortedRows = useMemo(() => {
    if (!data?.rows) return []
    if (!sortCol) return data.rows
    const rows = [...data.rows]
    rows.sort((a, b) => {
      let av = a[sortCol] ?? ''
      let bv = b[sortCol] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortAsc ? av - bv : bv - av
      }
      av = String(av).toLowerCase()
      bv = String(bv).toLowerCase()
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return rows
  }, [data, sortCol, sortAsc])

  const sortIcon = (col) => {
    if (sortCol !== col) return ' \u21C5'
    return sortAsc ? ' \u25B2' : ' \u25BC'
  }

  const dividendSafety = data?.totals?.dividend_safety
  const atRiskCount = dividendSafety?.at_risk_holdings?.length ?? 0

  const DIV_FREQ_LABELS = {
    D: 'Daily', W: 'Weekly', M: 'Monthly', Q: 'Quarterly',
    SA: 'Semi-Ann', S: 'Semi-Ann', A: 'Annual',
    DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly', ANNUAL: 'Annual',
  }
  const columns = [
    { key: 'ticker', label: 'Ticker', width: '5%' },
    { key: 'description', label: 'Description', width: '17%' },
    { key: 'category_name', label: 'Category', tip: 'Investment category', width: '7%' },
    // \u2500\u2500 Dividend mechanics \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    { key: 'div_frequency', label: 'Freq', fmt: v => DIV_FREQ_LABELS[v] || v || '\u2014', align: 'center', tip: 'Dividend payment frequency' },
    { key: 'ex_div_date', label: 'Ex-Div Date', align: 'center', tip: 'Ex-dividend date' },
    { key: 'div_pay_date', label: 'Pay Date', align: 'center', tip: 'Dividend payment date' },
    { key: 'quantity', label: 'Shares', fmt: v => v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '\u2014', align: 'right', tip: 'Number of shares held' },
    { key: 'div_per_share', label: '$/Share', fmt: v => v != null ? `$${Number(v).toFixed(4)}` : '\u2014', align: 'right', tip: 'Dividend amount per share' },
    // \u2500\u2500 Income estimates (derived from the above) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    { key: 'approx_monthly_income', label: 'Est. Monthly', fmt: fmt, align: 'right', tip: 'Estimated monthly dividend income (shares \u00d7 $/share \u00d7 frequency)' },
    { key: 'estim_payment_per_year', label: 'Est. Annual', fmt: fmt, align: 'right', tip: 'Estimated annual dividend income' },
    { key: 'annual_yield_on_cost', label: 'Yield on Cost', fmt: fmtPct, align: 'right', tip: 'Annual dividend yield based on your cost basis' },
    { key: 'current_annual_yield', label: 'Current Yield', fmt: fmtPct, align: 'right', tip: 'Current annual dividend yield based on market price' },
    // \u2500\u2500 History \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    { key: 'ytd_divs', label: 'YTD Divs', fmt: fmt, align: 'right', tip: 'Year-to-date dividends received' },
    { key: 'total_divs_received', label: 'Total Divs', fmt: fmt, align: 'right', tip: 'Total dividends received since purchase' },
    { key: 'paid_for_itself', label: 'Paid For Itself', fmt: v => fmtPctRaw(v != null ? v * 100 : null), align: 'right', tip: 'Percentage of original cost recovered through dividends' },
    // \u2500\u2500 Safety \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    { key: 'safety_score', label: 'Safety', align: 'center', tip: 'Composite dividend safety score' },
    { key: 'safety_risk_level', label: 'Risk', align: 'center', tip: 'Estimated dividend cut risk level' },
    { key: 'payout_ratio_pct', label: 'Payout', fmt: v => v != null ? `${Number(v).toFixed(1)}%` : '\u2014', align: 'right', tip: 'Dividend payout ratio' },
    { key: 'earnings_coverage', label: 'EPS Cov.', fmt: v => v != null ? `${Number(v).toFixed(2)}x` : '\u2014', align: 'right', tip: 'EPS coverage of annual dividend' },
    { key: 'dividend_streak_years', label: 'Streak', fmt: v => v != null ? `${Number(v).toFixed(0)}y` : '\u2014', align: 'right', tip: 'Consecutive years with dividend payments' },
    { key: 'debt_to_equity', label: 'D/E', fmt: fmtNum, align: 'right', tip: 'Debt to equity ratio' },
    { key: 'gain_or_loss', label: 'Gain / Loss', fmt: fmt, align: 'right', tip: 'Unrealized gain or loss in dollar amount' },
  ]

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '1rem' }}>Dividend Analysis</h1>

      {/* Category filter — only show when categories are defined */}
      {(data?.categories?.length > 0) && (
        <div className="growth-filters">
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
            <label>Categories</label>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
              onClick={() => setCatOpen(o => !o)}
            >
              {categories.length === 0 && subcategories.length === 0
                ? 'All Holdings'
                : `${categories.length + subcategories.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {catOpen && (
              <div className="growth-cat-dropdown">
                <label className="growth-cat-option" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                  <input
                    type="checkbox"
                    checked={categories.length === 0 && subcategories.length === 0}
                    onChange={() => { setCategories([]); setSubcategories([]) }}
                  />
                  <span>All Holdings</span>
                </label>
                {data.categories.map(c => {
                  const catChecked = categories.includes(String(c.id))
                  const subs = c.subcategories || []
                  return (
                    <React.Fragment key={c.id}>
                      <label className="growth-cat-option">
                        <input
                          type="checkbox"
                          checked={catChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              const subIds = subs.map(s => String(s.id))
                              setCategories(prev => [...prev, String(c.id)])
                              setSubcategories(prev => prev.filter(id => !subIds.includes(id)))
                            } else {
                              setCategories(prev => prev.filter(id => id !== String(c.id)))
                            }
                          }}
                        />
                        <span>{c.name}</span>
                      </label>
                      {subs.map(s => (
                        <label
                          key={s.id}
                          className="growth-cat-option"
                          style={{ paddingLeft: '1.4rem', opacity: catChecked ? 0.5 : 1 }}
                        >
                          <input
                            type="checkbox"
                            disabled={catChecked}
                            checked={catChecked || subcategories.includes(String(s.id))}
                            onChange={e => {
                              if (e.target.checked) {
                                setSubcategories(prev => [...prev, String(s.id)])
                              } else {
                                setSubcategories(prev => prev.filter(id => id !== String(s.id)))
                              }
                            }}
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                    </React.Fragment>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          {/* Summary strip */}
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <div className="summary-card summary-card-grade">
              <div className="summary-label">Portfolio Grade</div>
              <div className="summary-value">
                {data.grade?.overall ? <GradeBadge grade={data.grade.overall} large /> : '—'}
              </div>
              {data.grade?.score != null && <div className="summary-sub">Score: {data.grade.score}</div>}
            </div>
            <MetricCard label="Sharpe Ratio" value={data.grade?.sharpe} />
            <MetricCard label="Sortino Ratio" value={data.grade?.sortino} />
            <MetricCard label="Total Divs YTD" value={fmt(data.totals?.ytd_divs)} />
            <MetricCard label="Total Divs Received" value={fmt(data.totals?.total_divs_received)} />
            <MetricCard label="Est. Monthly Income" value={fmt(data.totals?.approx_monthly_income)} />
            <MetricCard label={`Actual Income (${data.totals?.current_month_label || 'This Month'})`} value={fmt(data.totals?.actual_monthly_income)} />
            <MetricCard label="Est. Annual Income" value={fmt(data.totals?.estim_payment_per_year)} />
            <MetricCard label="Avg. Safety Score" value={dividendSafety?.average_score ?? '\u2014'} />
            <MetricCard label="Holdings At Risk" value={atRiskCount} />
            <MetricCard label="Income At Risk" value={fmt(dividendSafety?.portfolio_income_at_risk)} />
          </div>

          {/* At-Risk Holdings detail */}
          {atRiskCount > 0 && (
            <details className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderLeft: '3px solid var(--neg)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--neg)', fontWeight: 600, fontSize: '0.95rem' }}>
                {atRiskCount} Holding{atRiskCount !== 1 ? 's' : ''} at Risk — {fmt(dividendSafety.portfolio_income_at_risk)} Annual Income at Risk
              </summary>
              <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
                <table style={{ fontSize: '0.85rem', width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Ticker</th>
                      <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Type</th>
                      <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Risk Level</th>
                      <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Safety Score</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Est. Annual Income</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Reason(s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendSafety.at_risk_holdings.map(h => (
                      <tr key={h.ticker} style={{ borderBottom: '1px solid var(--p-0a1628)' }}>
                        <td style={{ padding: '0.4rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{h.ticker}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center', color: 'var(--text-strong)' }}>
                          <SafetyModelLabel model={h.score_model} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                          <SafetyBadge level={h.risk_level} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                          <SafetyScore score={h.safety_score} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--warning-money)' }}>{fmt(h.est_annual_income)}</td>
                        <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-strong)', fontSize: '0.8rem' }}>
                          {h.risk_reasons?.length ? h.risk_reasons.join('; ') : 'No specific reason available'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Yield/Payout interactive chart */}
          <div className="da-chart-grid">
            <YieldPayoutChart rows={data.rows} />
          </div>

          {/* Charts */}
          <div className="da-chart-grid">
            {data.charts.annual_income && <div className="da-chart-panel"><div id="da-chart-annual-income" className="da-chart-div" /></div>}
            {data.charts.projected_monthly && <div className="da-chart-panel"><div id="da-chart-projected-monthly" className="da-chart-div" /></div>}
            <DividendPipelineChart pipeline={data.dividend_pipeline} />
            {data.charts.monthly_received && <div className="da-chart-panel">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
                <button className="btn btn-sm" onClick={handleRecalcPayouts} disabled={recalcing}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>
                  {recalcing ? 'Recalculating...' : 'Recalculate from Holdings'}
                </button>
              </div>
              {recalcMsg && <div style={{ fontSize: '0.8rem', color: 'var(--accent-bright)', marginBottom: '0.25rem' }}>{recalcMsg}</div>}
              <div id="da-chart-monthly-received" className="da-chart-div" />
            </div>}
            {data.charts.total_divs_ticker && <div className="da-chart-panel"><div id="da-chart-total-divs-ticker" className="da-chart-div" /></div>}
            {data.charts.paid_for_itself && <div className="da-chart-panel"><div id="da-chart-paid-for-itself" className="da-chart-div" /></div>}
            <CategoryDividendsChart rows={data.rows} categories={data.categories || []} />
          </div>

          {/* Data table */}
          <p style={{ color: 'var(--text-dim)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Click any column header to sort. Click again to reverse.</p>
          <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
            <table>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col.key} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: col.align || 'left', width: col.width || undefined }} onClick={() => handleSort(col.key)} title={col.tip || ''}>
                      {col.label}{col.tip ? ' \u24D8' : ''}
                      <span style={{ fontSize: '0.7em', marginLeft: '4px', color: sortCol === col.key ? 'var(--accent-bright)' : 'var(--text-dim)' }}>
                        {sortIcon(col.key)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => {
                  const paidPct = (row.paid_for_itself || 0) * 100
                  const riskTitle = row.risk_reasons?.length ? row.risk_reasons.join('; ') : ''
                  return (
                    <tr key={row.ticker} className={row.cut_risk_flag ? 'div-risk-row' : ''} style={paidPct >= 100 ? { background: 'rgba(77,255,145,0.05)' } : {}} title={riskTitle}>
                      {columns.map(col => {
                        const val = row[col.key]
                        let display = col.fmt ? col.fmt(val) : (val ?? '')
                        let style = col.align ? { textAlign: col.align } : {}

                        if (col.key === 'ticker') display = <strong>{val}</strong>
                        if (col.key === 'safety_score') display = <SafetyScore score={val} />
                        if (col.key === 'safety_risk_level') display = <SafetyBadge level={val} />
                        if (col.key === 'total_divs_received') display = <strong>{fmt(val)}</strong>
                        if (col.key === 'paid_for_itself') {
                          const color = paidPct >= 100 ? '#4dff91' : paidPct >= 50 ? '#ffd700' : undefined
                          style = { textAlign: 'right', color, fontWeight: paidPct >= 100 ? 'bold' : undefined }
                        }
                        if (col.key === 'gain_or_loss') {
                          style = { textAlign: 'right', color: (val || 0) >= 0 ? '#4dff91' : '#ff6b6b' }
                        }

                        return <td key={col.key} style={style}>{display}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
              {data.totals && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                    <td colSpan={3}><strong>Totals</strong></td>
                    <td colSpan={5}></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.approx_monthly_income)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.estim_payment_per_year)}</strong></td>
                    <td colSpan={2}></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.ytd_divs)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.total_divs_received)}</strong></td>
                    <td colSpan={8}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}
