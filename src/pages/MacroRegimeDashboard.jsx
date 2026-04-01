import React, { useState, useEffect, useCallback } from 'react'
import Plot from 'react-plotly.js'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useNavigate } from 'react-router-dom'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(v) {
  if (v == null) return '—'
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v) {
  if (v == null) return '—'
  return Number(v).toFixed(1) + '%'
}
function fmtNum(v, dec = 2) {
  if (v == null) return '—'
  return Number(v).toFixed(dec)
}

function directionArrow(d) {
  if (d === 'rising') return { symbol: '▲', color: '#4caf50' }
  if (d === 'falling') return { symbol: '▼', color: '#ef5350' }
  return { symbol: '►', color: '#90a4ae' }
}

function scoreBadgeColor(score) {
  if (score == null) return '#555'
  if (score > 0.3) return '#2e7d32'
  if (score > -0.3) return '#f9a825'
  return '#c62828'
}

function labelColor(label) {
  if (!label) return '#aaa'
  if (label === 'Favorable' || label === 'Well Positioned') return '#4caf50'
  if (label === 'Unfavorable' || label === 'Poorly Positioned') return '#ef5350'
  if (label.includes('Slightly Favorable')) return '#81c784'
  if (label.includes('Slightly Unfavorable')) return '#ef9a9a'
  return '#90a4ae'
}

// ─── Tab 1: Macro Conditions ──────────────────────────────────────────────────

function ConditionsTab({ pf }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    pf('/api/macro/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ color: '#90caf9' }}>Loading macro conditions...</p>
  if (error) return <p style={{ color: '#ef5350' }}>{error}</p>
  if (!data) return null

  const indicators = data.indicators || {}
  const history = data.indicator_history || {}
  const dates = history.dates || []

  const indicatorKeys = ['inflation_proxy', 'oil', 'rates_10y', 'rates_short', 'usd', 'gold', 'vix', 'spy']
  const historyKeys = {
    inflation_proxy: 'inflation_proxy', oil: 'oil', rates_10y: 'rates_10y',
    rates_short: 'rates_short', usd: 'usd', gold: 'gold', vix: 'vix', spy: 'spy',
  }

  return (
    <div>
      {/* Regime badge */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{
          background: 'linear-gradient(135deg, #1a237e, #283593)',
          border: '1px solid #3949ab',
          borderRadius: 8, padding: '0.75rem 1.25rem',
        }}>
          <div style={{ fontSize: '0.75rem', color: '#90a4ae', marginBottom: 4 }}>Current Regime</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e0e8f0' }}>{data.current_regime}</div>
        </div>
        {data.overlays?.length > 0 && data.overlays.map((o, i) => (
          <div key={i} style={{
            background: o.includes('High Volatility') ? '#4a1010' : '#1a3a1a',
            border: `1px solid ${o.includes('High Volatility') || o.includes('Rising') ? '#c62828' : '#2e7d32'}`,
            borderRadius: 8, padding: '0.5rem 1rem', fontSize: '0.9rem', fontWeight: 600,
            color: o.includes('High Volatility') || o.includes('Rising Vol') ? '#ef5350' : '#4caf50',
          }}>{o}</div>
        ))}
      </div>
      <p style={{ color: '#8899aa', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{data.regime_description}</p>

      {/* Indicator cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {indicatorKeys.map(key => {
          const ind = indicators[key]
          if (!ind) return null
          const arrow = directionArrow(ind.direction)
          const histData = history[historyKeys[key]] || []

          return (
            <div key={key} style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
              padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#e0e8f0', fontSize: '0.9rem' }}>{ind.label}</span>
                <span style={{ color: arrow.color, fontWeight: 700, fontSize: '0.85rem' }}>
                  {arrow.symbol} {ind.direction}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff' }}>
                  {key === 'oil' || key === 'gold' ? fmt$(ind.value) : fmtNum(ind.value)}
                </span>
                <span style={{
                  fontSize: '0.8rem', fontWeight: 600,
                  color: ind.change_3m > 0 ? '#4caf50' : ind.change_3m < 0 ? '#ef5350' : '#90a4ae',
                }}>
                  {ind.change_3m != null ? ((ind.change_3m > 0 ? '+' : '') + fmtNum(ind.change_3m) +
                    (key === 'rates_10y' || key === 'rates_short' || key === 'vix' ? ' pts' : '%')) : '—'}
                  <span style={{ color: '#607d8b', marginLeft: 4 }}>3mo</span>
                </span>
              </div>
              {/* Sparkline */}
              {dates.length > 0 && histData.length > 0 && (
                <Plot
                  data={[{
                    x: dates, y: histData, type: 'scatter', mode: 'lines',
                    line: { color: arrow.color, width: 1.5 },
                    hoverinfo: 'x+y',
                  }]}
                  layout={{
                    height: 60, margin: { t: 2, b: 2, l: 2, r: 2 },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                    xaxis: { visible: false }, yaxis: { visible: false },
                  }}
                  config={{ displayModeBar: false, staticPlot: true }}
                  style={{ width: '100%' }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tab 2: Portfolio Exposure ────────────────────────────────────────────────

function ExposureTab({ pf }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    pf('/api/macro/exposure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ color: '#90caf9' }}>Analyzing portfolio exposure...</p>
  if (error) return <p style={{ color: '#ef5350' }}>{error}</p>
  if (!data) return null

  const by_sens = data.by_sensitivity || {}
  const holdings = data.holdings_detail || []

  // Build bar chart data for sensitivity breakdown
  const sensKeys = Object.keys(by_sens).filter(k => k !== 'unclassified').sort((a, b) => (by_sens[b].pct || 0) - (by_sens[a].pct || 0))
  const barColors = {
    inflation_benefiting: '#4caf50', inflation_negative: '#ef5350', inflation_neutral: '#90a4ae',
    rate_sensitive_positive: '#66bb6a', rate_sensitive_negative: '#e57373', rate_sensitive_mild: '#ffb74d',
    commodity_linked: '#ffca28', safe_haven: '#42a5f5', growth_equity: '#ab47bc', unclassified: '#555',
  }

  return (
    <div>
      {/* Regime + Alignment header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '0.75rem 1.25rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>Current Regime</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e0e8f0' }}>{data.current_regime}</div>
        </div>

        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '0.75rem 1.25rem', textAlign: 'center', minWidth: 180,
        }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>Portfolio Alignment</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: labelColor(data.alignment_label) }}>
            {fmtNum(data.portfolio_alignment_score)}
          </div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: labelColor(data.alignment_label) }}>
            {data.alignment_label}
          </div>
        </div>

        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '0.75rem 1.25rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>Total Value</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e0e8f0' }}>{fmt$(data.total_value)}</div>
        </div>
      </div>

      {/* Unclassified warning */}
      {data.unclassified_warning && (
        <div style={{
          background: '#4a3510', border: '1px solid #f9a825', borderRadius: 6,
          padding: '0.6rem 1rem', marginBottom: '1rem', color: '#ffca28', fontSize: '0.85rem',
        }}>
          ⚠ {data.unclassified_warning}
        </div>
      )}

      {/* Alignment gauge */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ flex: '1 1 350px', minWidth: 300 }}>
          <Plot
            data={[{
              type: 'indicator', mode: 'gauge+number',
              value: data.portfolio_alignment_score,
              gauge: {
                axis: { range: [-1, 1], tickcolor: '#aaa', dtick: 0.5 },
                bar: { color: labelColor(data.alignment_label) },
                bgcolor: '#1e293b',
                bordercolor: '#334155',
                steps: [
                  { range: [-1, -0.3], color: 'rgba(239,83,80,0.15)' },
                  { range: [-0.3, 0.3], color: 'rgba(144,164,174,0.1)' },
                  { range: [0.3, 1], color: 'rgba(76,175,80,0.15)' },
                ],
              },
              number: { font: { color: '#e0e8f0', size: 28 }, valueformat: '.2f' },
            }]}
            layout={{
              height: 200, margin: { t: 30, b: 0, l: 30, r: 30 },
              paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              font: { color: '#aaa' },
            }}
            config={{ displayModeBar: false }}
            style={{ width: '100%' }}
          />
        </div>

        {/* Sensitivity breakdown bar */}
        <div style={{ flex: '1 1 400px', minWidth: 300 }}>
          <Plot
            data={[{
              type: 'bar', orientation: 'h',
              y: sensKeys.map(k => by_sens[k].label || k),
              x: sensKeys.map(k => by_sens[k].pct || 0),
              marker: { color: sensKeys.map(k => barColors[k] || '#555') },
              text: sensKeys.map(k => fmtPct(by_sens[k].pct)),
              textposition: 'outside',
              textfont: { color: '#ccc', size: 11 },
              hovertemplate: '%{y}: %{x:.1f}%<br>%{customdata}<extra></extra>',
              customdata: sensKeys.map(k => fmt$(by_sens[k].value)),
            }]}
            layout={{
              height: 280, margin: { t: 10, b: 30, l: 170, r: 60 },
              paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              xaxis: { title: '% of Portfolio', color: '#aaa', gridcolor: '#334155' },
              yaxis: { color: '#ccc', automargin: true },
              font: { color: '#aaa' },
            }}
            config={{ displayModeBar: false }}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Holdings table */}
      <h3 style={{ color: '#e0e8f0', marginBottom: '0.5rem' }}>Holdings Detail</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #334155' }}>
              <th style={thStyle}>Ticker</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Pillar</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Value</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>% Port</th>
              <th style={thStyle}>Sensitivity</th>
              <th style={thStyle}>Source</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Score</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Label</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => (
              <tr key={i} style={{
                borderBottom: '1px solid #1e293b',
                background: h.macro_label === 'Unfavorable' ? 'rgba(239,83,80,0.06)' :
                  h.macro_label === 'Favorable' ? 'rgba(76,175,80,0.06)' : 'transparent',
              }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#90caf9' }}>{h.ticker}</td>
                <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.description}
                </td>
                <td style={tdStyle}>{h.pillar_name}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt$(h.current_value)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtPct(h.pct_of_portfolio)}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {h.sensitivity_tags?.map((tag, ti) => (
                      <span key={ti} style={{
                        background: barColors[tag] || '#555', color: '#000',
                        borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600,
                      }}>{tag.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                </td>
                <td style={{ ...tdStyle, color: '#90a4ae', fontSize: '0.75rem' }}>{h.sensitivity_source}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <span style={{
                    background: scoreBadgeColor(h.macro_score), color: '#fff',
                    borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: '0.8rem',
                  }}>{fmtNum(h.macro_score)}</span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: labelColor(h.macro_label) }}>
                  {h.macro_label}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {h.macro_label === 'Unfavorable' && (
                    <button
                      style={{
                        background: '#1a237e', color: '#90caf9', border: '1px solid #3949ab',
                        borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: '0.72rem',
                      }}
                      onClick={() => navigate(`/consolidation?tab=simulator&sell=${h.ticker}`)}
                      title="Simulate consolidation for this ticker"
                    >Consolidate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tab 3: Rebalancing Tilts ─────────────────────────────────────────────────

function TiltsTab({ pf }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    pf('/api/macro/rebalance-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ color: '#90caf9' }}>Generating rebalancing suggestions...</p>
  if (error) return <p style={{ color: '#ef5350' }}>{error}</p>
  if (!data) return null

  const suggestions = data.suggestions || []
  const nextDollar = data.next_dollar_allocation || {}
  const pieLabels = Object.keys(nextDollar)
  const pieValues = Object.values(nextDollar)
  const pieColors = ['#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9', '#ffca28', '#42a5f5', '#ab47bc']

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '0.75rem 1.25rem',
        }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>Current Regime</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e0e8f0' }}>{data.current_regime}</div>
        </div>
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '0.75rem 1.25rem',
        }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>Alignment Score</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: labelColor(data.alignment_score > 0.3 ? 'Favorable' : data.alignment_score < -0.3 ? 'Unfavorable' : 'Neutral') }}>
            {fmtNum(data.alignment_score)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
        {/* Next dollar pie chart */}
        {pieLabels.length > 0 && (
          <div style={{ flex: '0 1 380px' }}>
            <h3 style={{ color: '#e0e8f0', marginBottom: '0.5rem' }}>Where Your Next Dollar Should Go</h3>
            <Plot
              data={[{
                type: 'pie',
                labels: pieLabels,
                values: pieValues,
                marker: { colors: pieColors.slice(0, pieLabels.length) },
                textinfo: 'label+percent',
                textfont: { color: '#fff', size: 11 },
                hovertemplate: '%{label}: %{value}%<extra></extra>',
                hole: 0.4,
              }]}
              layout={{
                height: 320, margin: { t: 10, b: 10, l: 10, r: 10 },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                legend: { font: { color: '#ccc', size: 11 }, orientation: 'h', y: -0.1 },
                showlegend: true,
              }}
              config={{ displayModeBar: false }}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {/* Suggestion cards */}
        <div style={{ flex: '1 1 400px' }}>
          <h3 style={{ color: '#e0e8f0', marginBottom: '0.5rem' }}>Suggestions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {suggestions.map((s, i) => {
              const isIncrease = s.action === 'increase'
              const isReduce = s.action === 'reduce'
              const isHold = s.action === 'hold'
              const borderColor = isIncrease ? '#2e7d32' : isReduce ? '#c62828' : '#546e7a'
              const bgColor = isIncrease ? 'rgba(76,175,80,0.08)' : isReduce ? 'rgba(239,83,80,0.08)' : 'rgba(84,110,122,0.08)'
              const actionLabel = isIncrease ? 'INCREASE' : isReduce ? 'REDUCE' : 'HOLD'
              const actionColor = isIncrease ? '#4caf50' : isReduce ? '#ef5350' : '#90a4ae'

              return (
                <div key={i} style={{
                  background: bgColor, border: `1px solid ${borderColor}`,
                  borderRadius: 8, padding: '0.75rem 1rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: actionColor }}>
                      {actionLabel}: {s.target_label || 'Current Allocation'}
                    </span>
                    {s.current_pct != null && (
                      <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>
                        {fmtPct(s.current_pct)} → {fmtPct(s.suggested_pct)}
                      </span>
                    )}
                  </div>
                  <p style={{ color: '#b0bec5', fontSize: '0.82rem', margin: '4px 0 8px' }}>{s.reason}</p>

                  {/* Tickers */}
                  {(s.tickers_in_portfolio?.length > 0 || s.tickers_to_consider_reducing?.length > 0) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {(s.tickers_in_portfolio || s.tickers_to_consider_reducing || []).map((t, ti) => (
                        <span key={ti} style={{
                          background: '#263238', border: '1px solid #455a64',
                          borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem',
                          color: '#90caf9', fontWeight: 600,
                        }}>{t}</span>
                      ))}
                    </div>
                  )}

                  {/* Candidate ETFs for categories user lacks exposure */}
                  {isIncrease && s.candidate_etfs?.length > 0 && (
                    <div style={{ marginTop: 6, marginBottom: 6 }}>
                      <div style={{ fontSize: '0.75rem', color: '#90a4ae', marginBottom: 4, fontWeight: 600 }}>
                        Consider adding:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {s.candidate_etfs.map((c, ci) => (
                          <span key={ci} style={{
                            background: '#1a3a1a', border: '1px solid #2e7d32',
                            borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem',
                            color: '#81c784', fontWeight: 600,
                          }} title={c.name}>{c.ticker}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Consolidation link */}
                  {isReduce && s.consolidation_link && s.tickers_to_consider_reducing?.length > 0 && (
                    <button
                      style={{
                        background: '#1a237e', color: '#90caf9', border: '1px solid #3949ab',
                        borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: '0.78rem',
                        marginTop: 4,
                      }}
                      onClick={() => navigate(`/consolidation?tab=simulator&sell=${s.tickers_to_consider_reducing[0]}`)}
                    >
                      View in Consolidation Simulator →
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const thStyle = {
  textAlign: 'left', padding: '6px 8px', color: '#90a4ae',
  fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '6px 8px', color: '#e0e0e0', fontSize: '0.82rem',
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MacroRegimeDashboard() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [activeTab, setActiveTab] = useState('conditions')

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.3rem' }}>Macro Regime Dashboard</h1>
      <p style={{ color: '#8899aa', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Current macro conditions, portfolio exposure analysis, and rebalancing tilt suggestions.
      </p>

      <div className="tabs">
        <button className={`tab ${activeTab === 'conditions' ? 'active' : ''}`}
          onClick={() => setActiveTab('conditions')}>
          Macro Conditions
        </button>
        <button className={`tab ${activeTab === 'exposure' ? 'active' : ''}`}
          onClick={() => setActiveTab('exposure')}>
          Portfolio Exposure
        </button>
        <button className={`tab ${activeTab === 'tilts' ? 'active' : ''}`}
          onClick={() => setActiveTab('tilts')}>
          Rebalancing Tilts
        </button>
      </div>

      {activeTab === 'conditions' && <ConditionsTab pf={pf} key={selection?.id || 'cond'} />}
      {activeTab === 'exposure' && <ExposureTab pf={pf} key={selection?.id || 'exp'} />}
      {activeTab === 'tilts' && <TiltsTab pf={pf} key={selection?.id || 'tilts'} />}
    </div>
  )
}
