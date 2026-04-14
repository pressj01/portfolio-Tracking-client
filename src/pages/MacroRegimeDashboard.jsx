import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Plot from 'react-plotly.js'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useNavigate } from 'react-router-dom'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(v) {
  if (v == null) return '--'
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v) {
  if (v == null) return '--'
  return Number(v).toFixed(1) + '%'
}
function fmtNum(v, dec = 2) {
  if (v == null) return '--'
  return Number(v).toFixed(dec)
}

function directionArrow(d) {
  if (d === 'rising') return { symbol: '^', color: '#4caf50' }
  if (d === 'falling') return { symbol: 'v', color: '#ef5350' }
  return { symbol: '->', color: '#90a4ae' }
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
                    (key === 'rates_10y' || key === 'rates_short' || key === 'vix' ? ' pts' : '%')) : '--'}
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
  const [hoveredRow, setHoveredRow] = useState(-1)

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
          Warning: {data.unclassified_warning}
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
              <tr key={i}
                onMouseEnter={() => setHoveredRow(i)}
                onMouseLeave={() => setHoveredRow(-1)}
                style={{
                  borderBottom: '1px solid #1e293b',
                  background: hoveredRow === i
                    ? 'rgba(144,202,249,0.12)'
                    : h.macro_label === 'Unfavorable' ? 'rgba(239,83,80,0.06)'
                    : h.macro_label === 'Favorable' ? 'rgba(76,175,80,0.06)' : 'transparent',
                  cursor: 'default',
                  transition: 'background 0.15s ease',
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
        {data.conditions && (
          <div style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            padding: '0.75rem 1.25rem',
          }}>
            <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>Active Conditions</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ffca28' }}>{data.conditions}</div>
          </div>
        )}
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

      {/* Breakeven Rebalancing Target */}
      {data.breakeven_target?.tags?.length > 0 && (
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '1rem 1.25rem', marginBottom: '1rem',
        }}>
          <h3 style={{ color: '#e0e8f0', margin: '0 0 0.5rem' }}>
            Rebalance to Breakeven
            <span style={{ fontSize: '0.75rem', color: '#90a4ae', fontWeight: 400, marginLeft: 8 }}>
              Shift {fmtPct(data.breakeven_target.total_shift_pct)} ({fmt$(data.breakeven_target.total_shift_needed)}) from unfavorable {'->'} favorable to reach neutral alignment
            </span>
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(239,83,80,0.1)', border: '1px solid #c62828', borderRadius: 6, padding: '0.4rem 0.75rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', color: '#ef9a9a' }}>Unfavorable</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ef5350' }}>{fmtPct(data.breakeven_target.current_unfavorable_pct)}</div>
            </div>
            <div style={{ background: 'rgba(255,202,40,0.08)', border: '1px solid #f9a825', borderRadius: 6, padding: '0.4rem 0.75rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', color: '#fff59d' }}>Neutral</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ffca28' }}>{fmtPct(data.breakeven_target.current_neutral_pct)}</div>
            </div>
            <div style={{ background: 'rgba(76,175,80,0.08)', border: '1px solid #2e7d32', borderRadius: 6, padding: '0.4rem 0.75rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', color: '#a5d6a7' }}>Favorable</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#4caf50' }}>{fmtPct(data.breakeven_target.current_favorable_pct)}</div>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ ...thStyle, width: '30%' }}>Asset Class</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Current %</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Target %</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Underweight</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>$ to Add</th>
              </tr>
            </thead>
            <tbody>
              {data.breakeven_target.tags.map((t, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1a2233' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#81c784' }}>{t.label}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtPct(t.current_pct)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#4caf50' }}>{fmtPct(t.target_pct)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#ffca28', fontWeight: 600 }}>+{fmtPct(t.gap_pct)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#4caf50' }}>{fmt$(t.gap_dollars)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #334155' }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#e0e8f0' }}>Total Shift</td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#ffca28', fontWeight: 700 }}>+{fmtPct(data.breakeven_target.total_shift_pct)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#4caf50', fontWeight: 700 }}>{fmt$(data.breakeven_target.total_shift_needed)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

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
                        {fmtPct(s.current_pct)} {'->'} {fmtPct(s.suggested_pct)}
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
                      View in Consolidation Simulator {'->'}
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

// ─── Income Benchmark Tab ────────────────────────────────────────────────────

function IncomeBenchmarkTab({ pf }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [expandedBucket, setExpandedBucket] = useState(null)
  const [bucketOpts, setBucketOpts] = useState([])
  const [saving, setSaving] = useState({})
  const [ibSort, setIbSort] = useState({ col: null, asc: true })
  const expandedRowRef = useRef(null)

  // Target editing state
  const [editingTargets, setEditingTargets] = useState(false)
  const [draftTargets, setDraftTargets] = useState({})
  const [defaults, setDefaults] = useState({})
  const [isCustom, setIsCustom] = useState(false)
  const [targetSaving, setTargetSaving] = useState(false)

  // Auto-scroll to expanded bucket after sort changes
  useEffect(() => {
    if (expandedBucket && expandedRowRef.current) {
      expandedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [ibSort, expandedBucket])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      pf('/api/macro/income-benchmark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(r => r.json()),
      pf('/api/income/overrides').then(r => r.json()),
      pf('/api/income/targets').then(r => r.json()),
    ])
      .then(([d, ovr, tgt]) => {
        if (d.error) { setError(d.error); return }
        setData(d)
        setBucketOpts(ovr.bucket_options || [])
        if (tgt.targets) {
          setDraftTargets(tgt.targets)
          setDefaults(tgt.defaults || {})
          setIsCustom(tgt.is_custom || false)
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf])

  useEffect(() => { load() }, [load])

  const handleBucketChange = useCallback((ticker, newBucket) => {
    setSaving(s => ({ ...s, [ticker]: true }))
    const isRevert = newBucket === '__revert__'
    const endpoint = '/api/income/overrides'
    const opts = isRevert
      ? { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker }) }
      : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker, bucket: newBucket }) }

    pf(endpoint, opts)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          // Refresh data
          pf('/api/macro/income-benchmark', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).then(r => r.json()).then(fresh => { if (!fresh.error) setData(fresh) })
        } else { alert(d.error || 'Save failed') }
      })
      .catch(e => alert(e.message))
      .finally(() => setSaving(s => ({ ...s, [ticker]: false })))
  }, [pf])

  const draftTotal = Object.values(draftTargets).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  const handleSaveTargets = useCallback(() => {
    if (Math.abs(draftTotal - 100) > 0.5) { alert(`Targets must sum to 100% (currently ${draftTotal.toFixed(1)}%)`); return }
    setTargetSaving(true)
    pf('/api/income/targets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: draftTargets }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setEditingTargets(false); setIsCustom(true); load() }
        else alert(d.error || 'Save failed')
      })
      .catch(e => alert(e.message))
      .finally(() => setTargetSaving(false))
  }, [pf, draftTargets, draftTotal, load])

  const handleResetTargets = useCallback(() => {
    setTargetSaving(true)
    pf('/api/income/targets', { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setEditingTargets(false); setIsCustom(false); setDraftTargets(d.targets || defaults); load() }
        else alert(d.error || 'Reset failed')
      })
      .catch(e => alert(e.message))
      .finally(() => setTargetSaving(false))
  }, [pf, defaults, load])

  if (loading) return <p style={{ color: '#90caf9' }}>Analyzing portfolio against income benchmark...</p>
  if (error) return <p style={{ color: '#ef5350' }}>{error}</p>
  if (!data) return null

  const { comparison, holdings_detail, summary } = data
  const barColors = ['#42a5f5', '#66bb6a', '#ab47bc', '#ff7043', '#ffca28', '#26a69a', '#ec407a', '#78909c']

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        {[
          { label: 'Portfolio Value', value: fmt$(summary.total_value) },
          { label: 'Annual Income', value: fmt$(summary.total_annual_income) },
          { label: 'Monthly Income', value: fmt$(summary.total_monthly_income) },
          { label: 'Blended Yield', value: fmtPct(summary.blended_yield) },
          { label: 'Diversification', value: summary.diversification_score + '/100' },
        ].map((c, i) => (
          <div key={i} style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            padding: '0.6rem 1rem', minWidth: 130,
          }}>
            <div style={{ fontSize: '0.65rem', color: '#90a4ae', marginBottom: 3 }}>{c.label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e0e8f0' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Edit Targets */}
      {!editingTargets ? (
        <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={() => setEditingTargets(true)}
            style={{ background: '#334155', color: '#90caf9', border: '1px solid #475569', borderRadius: 6,
              padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer' }}>
            Edit Targets
          </button>
          {isCustom && <span style={{ fontSize: '0.7rem', color: '#ffca28' }}>Custom targets active</span>}
        </div>
      ) : (
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '0.75rem 1rem', marginBottom: '0.75rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 600, color: '#e0e8f0', fontSize: '0.85rem' }}>Target Allocations</span>
            <span style={{
              fontSize: '0.75rem', fontWeight: 600,
              color: Math.abs(draftTotal - 100) > 0.5 ? '#ef5350' : '#4caf50',
            }}>
              Total: {draftTotal.toFixed(1)}%
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.4rem' }}>
            {Object.entries(draftTargets).map(([bucket, pct]) => (
              <div key={bucket} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.72rem', color: '#b0bec5', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bucket}</span>
                <input type="number" min="0" max="100" step="1" value={pct}
                  onChange={e => setDraftTargets(prev => ({ ...prev, [bucket]: parseFloat(e.target.value) || 0 }))}
                  style={{
                    width: 56, textAlign: 'right', background: '#0f172a', color: '#e0e0e0',
                    border: '1px solid #475569', borderRadius: 4, padding: '3px 6px', fontSize: '0.78rem',
                  }}
                />
                <span style={{ fontSize: '0.72rem', color: '#667' }}>%</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button onClick={handleSaveTargets} disabled={targetSaving || Math.abs(draftTotal - 100) > 0.5}
              style={{
                background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6,
                padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer',
                opacity: (targetSaving || Math.abs(draftTotal - 100) > 0.5) ? 0.5 : 1,
              }}>
              {targetSaving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setEditingTargets(false); load() }}
              style={{ background: '#455a64', color: '#ccc', border: 'none', borderRadius: 6,
                padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer' }}>
              Cancel
            </button>
            {isCustom && (
              <button onClick={handleResetTargets} disabled={targetSaving}
                style={{ background: 'transparent', color: '#ef5350', border: '1px solid #ef5350', borderRadius: 6,
                  padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer',
                  opacity: targetSaving ? 0.5 : 1 }}>
                Reset to Defaults
              </button>
            )}
          </div>
        </div>
      )}

      {/* Horizontal bar comparison chart */}
      <div style={{ marginBottom: '1rem' }}>
        <Plot
          data={[
            {
              type: 'bar',
              y: comparison.map(c => c.bucket),
              x: comparison.map(c => c.actual_pct),
              orientation: 'h',
              name: 'Actual %',
              marker: { color: '#42a5f5' },
              text: comparison.map(c => fmtPct(c.actual_pct)),
              textposition: 'auto',
              textfont: { color: '#fff', size: 11 },
              hovertemplate: '%{y}: %{x:.1f}%<extra>Actual</extra>',
            },
            {
              type: 'bar',
              y: comparison.map(c => c.bucket),
              x: comparison.map(c => c.target_pct),
              orientation: 'h',
              name: 'Target %',
              marker: { color: 'rgba(255,255,255,0.15)', line: { color: '#ffca28', width: 2 } },
              text: comparison.map(c => c.target_pct + '%'),
              textposition: 'auto',
              textfont: { color: '#ffca28', size: 11 },
              hovertemplate: '%{y}: %{x:.1f}%<extra>Target</extra>',
            },
          ]}
          layout={{
            height: 340, barmode: 'group',
            margin: { t: 10, b: 30, l: 200, r: 30 },
            paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
            font: { color: '#ccc' },
            xaxis: { title: '% of Portfolio', gridcolor: '#1a2233', ticksuffix: '%' },
            yaxis: { autorange: 'reversed', gridcolor: '#1a2233' },
            legend: { orientation: 'h', y: 1.1, x: 0.5, xanchor: 'center', font: { color: '#ccc' } },
          }}
          config={{ displayModeBar: false }}
          style={{ width: '100%' }}
        />
      </div>

      {/* Comparison table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #334155' }}>
              {[
                { key: 'bucket', label: 'Income Bucket', align: 'left', width: '20%' },
                { key: 'target_pct', label: 'Target %', align: 'right' },
                { key: 'actual_pct', label: 'Actual %', align: 'right' },
                { key: 'diff_pct', label: 'Over/Under', align: 'right' },
                { key: 'quantity', label: 'Shares', align: 'right' },
                { key: 'actual_value', label: 'Actual Value', align: 'right' },
                { key: 'monthly_income', label: 'Monthly Income', align: 'right' },
                { key: 'bucket_yield', label: 'Yield', align: 'right' },
                { key: 'gap_dollars', label: '$ to Target', align: 'right' },
              ].map(col => (
                <th key={col.key}
                  onClick={() => setIbSort(prev => ({ col: col.key, asc: prev.col === col.key ? !prev.asc : col.key === 'bucket' }))}
                  style={{ ...ibTh, textAlign: col.align, width: col.width, cursor: 'pointer', userSelect: 'none' }}
                >
                  {col.label} {ibSort.col === col.key ? (ibSort.asc ? '^' : 'v') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...comparison].sort((a, b) => {
              if (!ibSort.col) return 0
              const av = a[ibSort.col], bv = b[ibSort.col]
              if (typeof av === 'string') return ibSort.asc ? av.localeCompare(bv) : bv.localeCompare(av)
              return ibSort.asc ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0)
            }).map((c, i) => {
              const diff = c.diff_pct || 0
              const diffColor = diff > 2 ? '#4caf50' : diff < -2 ? '#ef5350' : '#ffca28'
              const isExpanded = expandedBucket === c.bucket
              const bucketHoldings = holdings_detail?.filter(h => h.bucket === c.bucket) || []

              return (
                <React.Fragment key={i}>
                  <tr
                    ref={isExpanded ? expandedRowRef : null}
                    style={{ borderBottom: '1px solid #1a2233', cursor: bucketHoldings.length > 0 ? 'pointer' : 'default' }}
                    onClick={() => bucketHoldings.length > 0 && setExpandedBucket(isExpanded ? null : c.bucket)}
                  >
                    <td style={{ ...ibTd, fontWeight: 600, color: barColors[i % barColors.length] }}>
                      {bucketHoldings.length > 0 && <span style={{ fontSize: '0.7rem', marginRight: 4 }}>{isExpanded ? 'v' : '>'}</span>}
                      {c.bucket}
                      <span style={{ color: '#666', fontSize: '0.7rem', marginLeft: 4 }}>({c.tickers?.length || 0})</span>
                    </td>
                    <td style={{ ...ibTd, textAlign: 'right' }}>{c.target_pct}%</td>
                    <td style={{ ...ibTd, textAlign: 'right' }}>{fmtPct(c.actual_pct)}</td>
                    <td style={{ ...ibTd, textAlign: 'right', color: diffColor, fontWeight: 600 }}>
                      {diff > 0 ? '+' : ''}{fmtPct(diff)}
                    </td>
                    <td style={{ ...ibTd, textAlign: 'right' }}>{c.quantity != null ? c.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                    <td style={{ ...ibTd, textAlign: 'right' }}>{fmt$(c.actual_value)}</td>
                    <td style={{ ...ibTd, textAlign: 'right' }}>{fmt$(c.monthly_income)}</td>
                    <td style={{ ...ibTd, textAlign: 'right' }}>{fmtPct(c.bucket_yield)}</td>
                    <td style={{ ...ibTd, textAlign: 'right', color: (c.gap_dollars || 0) > 0 ? '#ef5350' : '#4caf50', fontWeight: 600 }}>
                      {(c.gap_dollars || 0) > 0 ? '-' : '+'}{fmt$(Math.abs(c.gap_dollars || 0))}
                    </td>
                  </tr>
                  {isExpanded && bucketHoldings
                    .sort((a, b) => (b.current_value || 0) - (a.current_value || 0))
                    .map((h, hi) => (
                    <tr key={`${i}-${hi}`} style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid #111' }}>
                      <td style={{ ...ibTd, paddingLeft: 28, fontSize: '0.78rem' }}>
                        <span style={{ color: '#90caf9', fontWeight: 600 }}>{h.ticker}</span>
                        <span style={{ color: '#667', marginLeft: 6, fontSize: '0.72rem' }}>{h.description?.substring(0, 30)}</span>
                        {h.is_overridden && <span style={{ color: '#64b5f6', marginLeft: 6, fontSize: '0.65rem', fontWeight: 600 }}>OVERRIDE</span>}
                      </td>
                      <td style={{ ...ibTd, textAlign: 'right', color: '#667' }}></td>
                      <td style={{ ...ibTd, textAlign: 'right', fontSize: '0.78rem' }}>{fmtPct(h.pct_of_portfolio)}</td>
                      <td style={{ ...ibTd, textAlign: 'right' }}></td>
                      <td style={{ ...ibTd, textAlign: 'right', fontSize: '0.78rem' }}>{h.quantity != null ? h.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                      <td style={{ ...ibTd, textAlign: 'right', fontSize: '0.78rem' }}>{fmt$(h.current_value)}</td>
                      <td style={{ ...ibTd, textAlign: 'right', fontSize: '0.78rem' }}>{fmt$(h.monthly_income)}</td>
                      <td style={{ ...ibTd, textAlign: 'right', fontSize: '0.78rem' }}>{fmtPct(h.annual_yield)}</td>
                      <td style={{ ...ibTd, textAlign: 'right' }}>
                        <select
                          value={h.bucket}
                          disabled={saving[h.ticker]}
                          onClick={e => e.stopPropagation()}
                          onChange={e => handleBucketChange(h.ticker, e.target.value)}
                          style={{
                            background: '#0f172a', color: '#e0e0e0', border: '1px solid #334155',
                            borderRadius: 4, padding: '2px 4px', fontSize: '0.7rem', cursor: 'pointer',
                            opacity: saving[h.ticker] ? 0.5 : 1,
                          }}
                        >
                          {bucketOpts.map(b => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                          {h.is_overridden && <option value="__revert__">Reset to Auto-detect</option>}
                        </select>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Excluded holdings */}
      {(() => {
        const excluded = holdings_detail?.filter(h => h.bucket === 'Excluded') || []
        if (!excluded.length) return null
        return (
          <div style={{
            background: 'rgba(97,97,97,0.08)', border: '1px solid #424242',
            borderRadius: 8, padding: '0.75rem 1rem', marginTop: '1rem',
          }}>
            <div style={{ color: '#90a4ae', fontWeight: 600, marginBottom: 8 }}>
              Excluded Holdings ({excluded.length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {excluded.map((h, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #263238' }}>
                    <td style={{ ...ibTd, fontSize: '0.78rem' }}>
                      <span style={{ color: '#90caf9', fontWeight: 600 }}>{h.ticker}</span>
                      <span style={{ color: '#667', marginLeft: 6, fontSize: '0.72rem' }}>{h.description?.substring(0, 30)}</span>
                    </td>
                    <td style={{ ...ibTd, textAlign: 'right', fontSize: '0.78rem' }}>{fmt$(h.current_value)}</td>
                    <td style={{ ...ibTd, textAlign: 'right', fontSize: '0.78rem' }}>{fmt$(h.monthly_income)}</td>
                    <td style={{ ...ibTd, textAlign: 'right' }}>
                      <select
                        value="Excluded"
                        disabled={saving[h.ticker]}
                        onChange={e => handleBucketChange(h.ticker, e.target.value)}
                        style={{
                          background: '#0f172a', color: '#e0e0e0', border: '1px solid #334155',
                          borderRadius: 4, padding: '2px 4px', fontSize: '0.7rem', cursor: 'pointer',
                          opacity: saving[h.ticker] ? 0.5 : 1,
                        }}
                      >
                        {bucketOpts.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                        <option value="__revert__">Reset to Auto-detect</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* Unclassified warning */}
      {(data.unclassified_pct || 0) > 0 && (
        <div style={{
          background: 'rgba(255,202,40,0.08)', border: '1px solid #f9a825',
          borderRadius: 8, padding: '0.75rem 1rem', marginTop: '1rem',
        }}>
          <div style={{ color: '#ffca28', fontWeight: 600, marginBottom: 4 }}>
            {fmtPct(data.unclassified_pct)} Unclassified
          </div>
          <div style={{ color: '#b0bec5', fontSize: '0.8rem' }}>
            These holdings couldn't be auto-classified: {(data.unclassified_tickers || []).join(', ')}.
            Use the bucket dropdown when expanding a row to reclassify, or assign pillar types in Manage Holdings.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab 5: Classifications ───────────────────────────────────────────────────

function ClassificationsTab({ pf }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [holdings, setHoldings] = useState([])       // from exposure endpoint
  const [overrides, setOverrides] = useState({})      // ticker -> [tags]
  const [sensOpts, setSensOpts] = useState({})         // tag -> display name
  const [saving, setSaving] = useState({})             // ticker -> true while saving
  const [editTicker, setEditTicker] = useState(null)   // which ticker is being edited
  const [editTags, setEditTags] = useState([])         // tags being edited
  const [filter, setFilter] = useState('all')          // all | overridden | auto | excluded

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    // Fetch exposure data and overrides in parallel
    Promise.all([
      pf('/api/macro/exposure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(r => r.json()),
      pf('/api/macro/overrides').then(r => r.json()),
    ])
      .then(([exp, ovr]) => {
        if (exp.error) { setError(exp.error); return }
        setHoldings((exp.holdings_detail || []).sort((a, b) => a.ticker.localeCompare(b.ticker)))
        setOverrides(ovr.overrides || {})
        setSensOpts(ovr.sensitivity_options || {})
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf])

  useEffect(() => { load() }, [load])

  const handleSave = useCallback((ticker, tags) => {
    setSaving(s => ({ ...s, [ticker]: true }))
    pf('/api/macro/overrides', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, sensitivity_tags: tags }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setOverrides(prev => ({ ...prev, [ticker]: tags }))
          setEditTicker(null)
          setEditTags([])
          // Refresh exposure data so scores update
          pf('/api/macro/exposure', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).then(r => r.json()).then(exp => {
            if (!exp.error) setHoldings((exp.holdings_detail || []).sort((a, b) => a.ticker.localeCompare(b.ticker)))
          })
        } else {
          alert(d.error || 'Save failed')
        }
      })
      .catch(e => alert(e.message))
      .finally(() => setSaving(s => ({ ...s, [ticker]: false })))
  }, [pf])

  const handleRevert = useCallback((ticker) => {
    setSaving(s => ({ ...s, [ticker]: true }))
    pf('/api/macro/overrides', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setOverrides(prev => { const n = { ...prev }; delete n[ticker]; return n })
          if (editTicker === ticker) { setEditTicker(null); setEditTags([]) }
          // Refresh
          pf('/api/macro/exposure', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).then(r => r.json()).then(exp => {
            if (!exp.error) setHoldings((exp.holdings_detail || []).sort((a, b) => a.ticker.localeCompare(b.ticker)))
          })
        }
      })
      .catch(e => alert(e.message))
      .finally(() => setSaving(s => ({ ...s, [ticker]: false })))
  }, [pf, editTicker])

  if (loading) return <p style={{ color: '#90caf9' }}>Loading classifications...</p>
  if (error) return <p style={{ color: '#ef5350' }}>{error}</p>
  if (!holdings.length) return <p style={{ color: '#90a4ae' }}>No holdings found.</p>

  const tagKeys = Object.keys(sensOpts).filter(k => k !== 'excluded').sort()

  const filtered = holdings.filter(h => {
    if (filter === 'overridden') return h.sensitivity_source === 'Override'
    if (filter === 'auto') return h.sensitivity_source !== 'Override' && h.macro_label !== 'Excluded'
    if (filter === 'excluded') return h.macro_label === 'Excluded'
    return true
  })

  const overrideCount = holdings.filter(h => h.sensitivity_source === 'Override').length
  const excludedCount = holdings.filter(h => h.macro_label === 'Excluded').length

  const barColors = {
    inflation_benefiting: '#4caf50', inflation_negative: '#ef5350', inflation_neutral: '#90a4ae',
    rate_sensitive_positive: '#66bb6a', rate_sensitive_negative: '#e57373', rate_sensitive_mild: '#ffb74d',
    commodity_linked: '#ffca28', safe_haven: '#42a5f5', growth_equity: '#ab47bc',
    excluded: '#616161', unclassified: '#555',
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '0.6rem 1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae' }}>Total Holdings</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e0e8f0' }}>{holdings.length}</div>
        </div>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '0.6rem 1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae' }}>Overridden</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#64b5f6' }}>{overrideCount}</div>
        </div>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '0.6rem 1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae' }}>Excluded</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#616161' }}>{excludedCount}</div>
        </div>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem' }}>
        {[['all', 'All'], ['overridden', 'Overridden'], ['auto', 'Auto-classified'], ['excluded', 'Excluded']].map(([val, lbl]) => (
          <button key={val}
            onClick={() => setFilter(val)}
            style={{
              background: filter === val ? '#1a237e' : '#1e293b',
              color: filter === val ? '#90caf9' : '#90a4ae',
              border: `1px solid ${filter === val ? '#3949ab' : '#334155'}`,
              borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: '0.78rem',
            }}
          >{lbl}</button>
        ))}
      </div>

      <p style={{ color: '#8899aa', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
        Override the auto-detected sensitivity classification for any holding, or exclude it from macro analysis entirely.
      </p>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #334155' }}>
              <th style={thStyle}>Ticker</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Current Classification</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Score</th>
              <th style={{ ...thStyle, textAlign: 'center', minWidth: 260 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h, i) => {
              const isEditing = editTicker === h.ticker
              const hasOverride = h.sensitivity_source === 'Override'
              const isSaving = saving[h.ticker]

              return (
                <tr key={i} style={{
                  borderBottom: '1px solid #1e293b',
                  background: hasOverride ? 'rgba(100,181,246,0.06)' :
                    h.macro_label === 'Excluded' ? 'rgba(97,97,97,0.08)' : 'transparent',
                }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#90caf9' }}>{h.ticker}</td>
                  <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.description}
                  </td>
                  <td style={{ ...tdStyle }}>
                    <span style={{
                      background: hasOverride ? '#1a237e' : h.sensitivity_source === 'Unclassified' ? '#c62828' : '#263238',
                      color: hasOverride ? '#90caf9' : h.sensitivity_source === 'Unclassified' ? '#ffcdd2' : '#b0bec5',
                      borderRadius: 4, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 600,
                    }}>{h.sensitivity_source}</span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {h.sensitivity_tags?.map((tag, ti) => (
                        <span key={ti} style={{
                          background: barColors[tag] || '#555', color: '#000',
                          borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600,
                        }}>{(sensOpts[tag] || tag.replace(/_/g, ' '))}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {h.macro_score != null ? (
                      <span style={{
                        background: scoreBadgeColor(h.macro_score), color: '#fff',
                        borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: '0.8rem',
                      }}>{fmtNum(h.macro_score)}</span>
                    ) : (
                      <span style={{ color: '#616161', fontSize: '0.8rem' }}>--</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <select
                          multiple
                          value={editTags}
                          onChange={e => setEditTags(Array.from(e.target.selectedOptions, o => o.value))}
                          style={{
                            background: '#0f172a', color: '#e0e0e0', border: '1px solid #334155',
                            borderRadius: 4, padding: '2px 4px', fontSize: '0.75rem', minWidth: 140, minHeight: 60,
                          }}
                        >
                          {tagKeys.map(k => (
                            <option key={k} value={k}>{sensOpts[k]}</option>
                          ))}
                        </select>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <button
                            disabled={!editTags.length || isSaving}
                            onClick={() => handleSave(h.ticker, editTags)}
                            style={{
                              background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4,
                              padding: '3px 10px', cursor: 'pointer', fontSize: '0.72rem',
                              opacity: (!editTags.length || isSaving) ? 0.5 : 1,
                            }}
                          >{isSaving ? '...' : 'Save'}</button>
                          <button
                            onClick={() => handleSave(h.ticker, ['excluded'])}
                            disabled={isSaving}
                            style={{
                              background: '#424242', color: '#bbb', border: 'none', borderRadius: 4,
                              padding: '3px 10px', cursor: 'pointer', fontSize: '0.72rem',
                              opacity: isSaving ? 0.5 : 1,
                            }}
                          >Exclude</button>
                          <button
                            onClick={() => { setEditTicker(null); setEditTags([]) }}
                            style={{
                              background: 'transparent', color: '#90a4ae', border: '1px solid #334155',
                              borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: '0.72rem',
                            }}
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          onClick={() => { setEditTicker(h.ticker); setEditTags(h.sensitivity_tags || []) }}
                          style={{
                            background: '#1a237e', color: '#90caf9', border: '1px solid #3949ab',
                            borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: '0.72rem',
                          }}
                        >Edit</button>
                        {hasOverride && (
                          <button
                            disabled={isSaving}
                            onClick={() => handleRevert(h.ticker)}
                            style={{
                              background: '#4a1c1c', color: '#ef9a9a', border: '1px solid #6d2c2c',
                              borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: '0.72rem',
                              opacity: isSaving ? 0.5 : 1,
                            }}
                          >{isSaving ? '...' : 'Revert'}</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ibTh = {
  textAlign: 'left', padding: '8px 10px', color: '#90a4ae',
  fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
}
const ibTd = {
  padding: '8px 10px', color: '#e0e0e0', fontSize: '0.82rem',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const thStyle = {
  textAlign: 'left', padding: '6px 8px', color: '#90a4ae',
  fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '6px 8px', color: '#e0e0e0', fontSize: '0.82rem',
}

// ─── Tab 6: Regime Quadrants (Markov Chain) ─────────────────────────────────

const QUAD_COLORS = { 1: '#4caf50', 2: '#ff9800', 3: '#ef5350', 4: '#42a5f5' }
const QUAD_BG     = { 1: 'rgba(76,175,80,0.08)', 2: 'rgba(255,152,0,0.08)', 3: 'rgba(239,83,80,0.08)', 4: 'rgba(66,165,245,0.08)' }
const QUAD_LABELS = { 1: 'Q1 Goldilocks', 2: 'Q2 Reflation', 3: 'Q3 Stagflation', 4: 'Q4 Deflation' }
const TILT_COLORS = { Best: '#4caf50', Good: '#81c784', Neutral: '#90a4ae', Avoid: '#ef5350', Underperform: '#ff9800' }
const QUAD_IDS = [1, 2, 3, 4]
const PROJECTION_KEYS = ['1_week', '2_week', '4_week', '8_week', '13_week']
const PROJECTION_LABELS = ['1 Week', '2 Weeks', '4 Weeks', '8 Weeks', '13 Weeks']
const FRED_CATEGORIES = [
  { key: 'growth', label: 'Growth', color: '#4caf50' },
  { key: 'inflation', label: 'Inflation', color: '#ff9800' },
  { key: 'financial', label: 'Financial Conditions', color: '#42a5f5' },
  { key: 'sentiment', label: 'Sentiment', color: '#b39ddb' },
]
const BRIER_HORIZONS = [
  { key: '1_week', label: '1-Week Forecast' },
  { key: '4_week', label: '1-Month Forecast' },
  { key: '8_week', label: '2-Month Forecast' },
]
const RESPONSIVE_PLOT_CONFIG = { responsive: true, displayModeBar: false }

function classifyQuadrant(growth, inflation) {
  if (growth > 0 && inflation <= 0) return 1
  if (growth > 0 && inflation > 0) return 2
  if (growth <= 0 && inflation > 0) return 3
  return 4
}

function getQuadrantShortName(q) {
  return QUAD_LABELS[q]?.split(' ').slice(1).join(' ') || `Q${q}`
}

function getMaxProjectionQuadrant(projection = {}) {
  return QUAD_IDS.reduce((best, q) => (
    (projection[`Q${q}`] || 0) > (projection[`Q${best}`] || 0) ? q : best
  ), 1)
}

function QuadrantTab({ pf }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    pf('/api/macro/quadrant', {
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

  const safeData = data || {}
  const h = safeData.history || {}
  const gScores = h.growth_scores || []
  const iScores = h.inflation_scores || []
  const quads = h.quadrants || []
  const dates = h.dates || []
  const tm = safeData.transition_matrix || []       // adjusted (current-week-specific)
  const stm = safeData.static_transition_matrix || tm // historical baseline
  const tc = safeData.transition_counts || []
  const proj = safeData.projections || {}
  const currentQuadrant = safeData.current_quadrant || 1
  const transitionAnchorQuadrant = safeData.transition_anchor_quadrant || currentQuadrant
  const transitionAnchorName = safeData.transition_anchor_name || safeData.current_quadrant_name || QUAD_LABELS[transitionAnchorQuadrant]
  const statesAligned = safeData.states_aligned !== false
  const quadLabels = useMemo(() => QUAD_IDS.map(q => QUAD_LABELS[q]), [])
  const currentTransitionRow = tm[transitionAnchorQuadrant - 1] || []
  const maxAdjustedTransitionProb = useMemo(
    () => Math.max(0, ...currentTransitionRow.map(v => (v || 0) * 100)),
    [currentTransitionRow]
  )

  const scatterMeta = useMemo(() => {
    const allG = gScores.filter(v => v != null)
    const allI = iScores.filter(v => v != null)
    const currentMarketGrowth = safeData.market_growth_score ?? safeData.growth_score ?? 0
    const currentMarketInflation = safeData.market_inflation_score ?? safeData.inflation_score ?? 0
    const paddedGrowth = [...allG, currentMarketGrowth]
    const paddedInflation = [...allI, currentMarketInflation]
    const gMin = Math.min(...paddedGrowth) - 2
    const gMax = Math.max(...paddedGrowth) + 2
    const iMin = Math.min(...paddedInflation) - 2
    const iMax = Math.max(...paddedInflation) + 2
    const marketCurrentQuadrant = classifyQuadrant(currentMarketGrowth, currentMarketInflation)

    return {
      currentMarketGrowth,
      currentMarketInflation,
      marketCurrentQuadrant,
      gMin,
      gMax,
      iMin,
      iMax,
      traces: [
        {
          x: gScores,
          y: iScores,
          mode: 'markers',
          marker: { size: 5, color: quads.map(q => QUAD_COLORS[q]), opacity: 0.35 },
          text: dates.map((d, i) => `${d}<br>${QUAD_LABELS[quads[i]]}<br>Growth: ${gScores[i]?.toFixed(2)}%<br>Inflation: ${iScores[i]?.toFixed(2)}%`),
          hoverinfo: 'text',
          name: 'Historical',
        },
        {
          x: [currentMarketGrowth],
          y: [currentMarketInflation],
          mode: 'markers+text',
          marker: { size: 18, color: QUAD_COLORS[marketCurrentQuadrant], symbol: 'diamond', line: { width: 2, color: '#fff' } },
          text: ['NOW'],
          textposition: 'top center',
          textfont: { color: '#fff', size: 12, family: 'monospace' },
          hoverinfo: 'text',
          hovertext: `Current market-proxy state: ${QUAD_LABELS[marketCurrentQuadrant]}<br>Growth: ${currentMarketGrowth.toFixed(2)}%<br>Inflation: ${currentMarketInflation.toFixed(2)}%`,
          name: 'Current Market Proxy',
        },
      ],
      annotations: [
        { x: gMax * 0.7, y: iMin * 0.7, text: 'Q1 Goldilocks', showarrow: false, font: { color: QUAD_COLORS[1], size: 13, family: 'monospace' }, opacity: 0.7 },
        { x: gMax * 0.7, y: iMax * 0.7, text: 'Q2 Reflation', showarrow: false, font: { color: QUAD_COLORS[2], size: 13, family: 'monospace' }, opacity: 0.7 },
        { x: gMin * 0.7, y: iMax * 0.7, text: 'Q3 Stagflation', showarrow: false, font: { color: QUAD_COLORS[3], size: 13, family: 'monospace' }, opacity: 0.7 },
        { x: gMin * 0.7, y: iMin * 0.7, text: 'Q4 Deflation', showarrow: false, font: { color: QUAD_COLORS[4], size: 13, family: 'monospace' }, opacity: 0.7 },
      ],
    }
  }, [safeData.growth_score, safeData.inflation_score, safeData.market_growth_score, safeData.market_inflation_score, dates, gScores, iScores, quads])

  const fredDisplay = useMemo(() => {
    if (!safeData.fred_indicators) return null
    const entries = Object.entries(safeData.fred_indicators)
    return {
      entries,
      growthCount: entries.filter(([, value]) => value.category === 'growth').length,
      inflationCount: entries.filter(([, value]) => value.category === 'inflation').length,
      groupedEntries: FRED_CATEGORIES.map(category => ({
        ...category,
        entries: entries.filter(([, value]) => value.category === category.key),
      })).filter(category => category.entries.length > 0),
    }
  }, [safeData.fred_indicators])
  const entries = fredDisplay?.entries || []
  const growthCount = fredDisplay?.growthCount || 0
  const inflationCount = fredDisplay?.inflationCount || 0
  const categories = fredDisplay?.groupedEntries || []

  const adjustedTransitionCards = useMemo(() => (
    QUAD_IDS.map(q => {
      const adjustedProb = (tm[transitionAnchorQuadrant - 1]?.[q - 1] || 0) * 100
      const historicalProb = (stm[transitionAnchorQuadrant - 1]?.[q - 1] || 0) * 100
      return {
        q,
        adjustedProb,
        historicalProb,
        delta: adjustedProb - historicalProb,
        isSelf: q === transitionAnchorQuadrant,
        isMax: adjustedProb === maxAdjustedTransitionProb,
      }
    })
  ), [maxAdjustedTransitionProb, stm, tm, transitionAnchorQuadrant])

  const heatmapAnnotations = useMemo(() => (
    stm.flatMap((row, ri) => row.map((value, ci) => ({
      x: quadLabels[ci],
      y: ri === transitionAnchorQuadrant - 1 ? `> ${quadLabels[ri]}` : quadLabels[ri],
      text: ri === transitionAnchorQuadrant - 1
        ? `<b>${(value * 100).toFixed(1)}%</b><br><span style="font-size:9px">(${tc[ri]?.[ci] || 0})</span>`
        : `${(value * 100).toFixed(1)}%<br><span style="font-size:9px">(${tc[ri]?.[ci] || 0})</span>`,
      showarrow: false,
      font: {
        color: ri === transitionAnchorQuadrant - 1 ? '#fff' : '#b0bec5',
        size: ri === transitionAnchorQuadrant - 1 ? 13 : 11,
      },
    })))
  ), [quadLabels, stm, tc, transitionAnchorQuadrant])

  const projectionDisplay = useMemo(() => ({
    eightWeekMaxQ: getMaxProjectionQuadrant(proj['8_week']),
    fourWeekMaxQ: getMaxProjectionQuadrant(proj['4_week']),
    projectionSeries: QUAD_IDS.map(q => ({
      x: PROJECTION_LABELS,
      y: PROJECTION_KEYS.map(key => (proj[key]?.[`Q${q}`] || 0) * 100),
      type: 'bar',
      name: QUAD_LABELS[q],
      marker: { color: QUAD_COLORS[q] },
      hovertemplate: `${QUAD_LABELS[q]}: %{y:.1f}%<extra></extra>`,
    })),
  }), [proj])

  const marketHistoryNote = safeData.classification_source === 'FRED'
    ? `Quadrant classification currently uses FRED Z-scores, but this map stays in market-proxy momentum space for apples-to-apples comparison with the 5-year Markov history. Current market-proxy state: Q${scatterMeta.marketCurrentQuadrant} ${getQuadrantShortName(scatterMeta.marketCurrentQuadrant)}.`
    : 'This map and the current classification are both using market-proxy momentum data.'
  const transitionEngineNote = statesAligned
    ? `Transition engine is anchored to Q${transitionAnchorQuadrant} ${getQuadrantShortName(transitionAnchorQuadrant)} using market-proxy history.`
    : `FRED classifies the current macro state as Q${currentQuadrant} ${getQuadrantShortName(currentQuadrant)}, while the transition engine is anchored to market-proxy Q${transitionAnchorQuadrant} ${getQuadrantShortName(transitionAnchorQuadrant)} for consistency with the Markov training data.`

  if (loading) return <p style={{ color: '#90caf9' }}>Loading quadrant analysis (fetching 5 years of data)...</p>
  if (error) return <p style={{ color: '#ef5350' }}>{error}</p>
  if (!data) return null

  return (
    <div>
      {/* Header: Current Quadrant */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{
          background: `linear-gradient(135deg, ${QUAD_COLORS[data.current_quadrant]}22, ${QUAD_COLORS[data.current_quadrant]}44)`,
          border: `2px solid ${QUAD_COLORS[data.current_quadrant]}`,
          borderRadius: 10, padding: '0.75rem 1.5rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Current Quadrant</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: QUAD_COLORS[data.current_quadrant] }}>
            Q{data.current_quadrant} - {data.current_quadrant_name}
          </div>
        </div>
        <div style={{ background: '#16213e', border: '1px solid #0f3460', borderRadius: 8, padding: '0.75rem 1.25rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>Confidence (Self-Transition)</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: data.confidence_pct >= 50 ? '#4caf50' : data.confidence_pct >= 30 ? '#ff9800' : '#ef5350' }}>
            {data.confidence_pct}%
          </div>
        </div>
        <div style={{ background: '#16213e', border: '1px solid #0f3460', borderRadius: 8, padding: '0.75rem 1.25rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>
            Growth {data.classification_source === 'FRED' ? 'Z-Score' : 'Momentum'}
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: data.growth_score > 0 ? '#4caf50' : '#ef5350' }}>
            {data.growth_score > 0 ? 'Up' : 'Down'} {data.growth_score.toFixed(2)}{data.classification_source !== 'FRED' ? '%' : ''}
          </div>
        </div>
        <div style={{ background: '#16213e', border: '1px solid #0f3460', borderRadius: 8, padding: '0.75rem 1.25rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#90a4ae', marginBottom: 4 }}>
            Inflation {data.classification_source === 'FRED' ? 'Z-Score' : 'Momentum'}
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: data.inflation_score > 0 ? '#ef5350' : '#4caf50' }}>
            {data.inflation_score > 0 ? 'Up' : 'Down'} {data.inflation_score.toFixed(2)}{data.classification_source !== 'FRED' ? '%' : ''}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200, background: '#16213e', border: '1px solid #0f3460', borderRadius: 8, padding: '0.75rem 1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#b0bec5' }}>{data.current_quadrant_description}</div>
        </div>
      </div>

      <div className="card" style={{ padding: '0.7rem 1rem', marginBottom: '1rem', background: '#10192b', border: '1px solid #1d3357' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.68rem', color: '#90a4ae', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Macro Classification</div>
            <div style={{ fontSize: '0.9rem', color: '#e0e8f5', fontWeight: 600 }}>
              Q{currentQuadrant} {data.current_quadrant_name} via {data.classification_source}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', color: '#90a4ae', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Transition Engine</div>
            <div style={{ fontSize: '0.9rem', color: '#e0e8f5', fontWeight: 600 }}>
              Q{transitionAnchorQuadrant} {getQuadrantShortName(transitionAnchorQuadrant)} market anchor
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', color: '#90a4ae', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>State Alignment</div>
            <div style={{ fontSize: '0.9rem', color: statesAligned ? '#4caf50' : '#ff9800', fontWeight: 600 }}>
              {statesAligned ? 'Aligned' : 'Mixed Signal'}
            </div>
          </div>
        </div>
      </div>

      {/* FRED Economic Indicators */}
      {fredDisplay && (() => {
        return (
          <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ color: '#90caf9', margin: 0, fontSize: '1rem' }}>FRED Economic Indicators (Z-Scores)</h3>
              <span style={{ fontSize: '0.7rem', color: '#666', background: '#0e1525', padding: '2px 8px', borderRadius: 4 }}>
                Source: {data.classification_source || 'FRED'} | {entries.length} indicators via FRED API
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem', padding: '0.4rem 0.6rem', background: '#0e1525', borderRadius: 6, fontSize: '0.65rem', color: '#90a4ae', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: '#e0e8f5' }}>Z-Score Guide:</span>
              <span>A Z-score measures how far a value is from its historical average in standard deviations.</span>
              <span style={{ color: '#4caf50' }}>* Normal (&lt;1.0)</span>
              <span style={{ color: '#ff9800' }}>* Elevated (1.0-2.0)</span>
              <span style={{ color: '#ef5350' }}>* Extreme (&gt;2.0)</span>
              <span style={{ color: '#90a4ae' }}>| + positive = above avg | - negative = below avg</span>
            </div>
            {categories.map(cat => {
              const catEntries = entries.filter(([, v]) => v.category === cat.key)
              if (catEntries.length === 0) return null
              return (
                <div key={cat.key} style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', color: cat.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: '0.35rem', borderBottom: `1px solid ${cat.color}33`, paddingBottom: 3 }}>
                    {cat.label}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {catEntries.map(([name, info]) => {
                      const extColor = info.extremity === 'Extreme' ? '#ef5350' : info.extremity === 'Elevated' ? '#ff9800' : '#4caf50'
                      const zChg = info.z_change || 0
                      const zArrow = zChg > 0.01 ? '^' : zChg < -0.01 ? 'v' : '->'
                      const zChgColor = zChg > 0.01 ? '#4caf50' : zChg < -0.01 ? '#ef5350' : '#666'
                      return (
                        <div key={name} style={{
                          flex: '1 1 210px', background: '#0e1525', borderRadius: 8, padding: '0.55rem 0.75rem',
                          border: `1px solid ${extColor}33`,
                        }}>
                          <div style={{ fontSize: '0.72rem', color: '#90a4ae', marginBottom: 3 }}>{name}</div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {info.previous_value != null && (
                              <span style={{ fontSize: '0.72rem', color: '#666', textDecoration: 'line-through' }}>
                                {info.previous_value}
                              </span>
                            )}
                            {info.previous_value != null && (
                              <span style={{ fontSize: '0.72rem', color: '#666' }}>-&gt;</span>
                            )}
                            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#e0e8f5' }}>
                              {info.current_value}
                            </span>
                            <span style={{
                              fontSize: '0.72rem', fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                              background: `${extColor}22`, color: extColor,
                            }}>
                              Z: {info.z_score?.toFixed(2)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.65rem', color: '#666', marginTop: 2 }}>
                            <span>{info.direction} | {info.extremity}</span>
                            {info.previous_z != null && (
                              <span style={{ color: zChgColor, fontWeight: 600 }}>
                                {zArrow} {Math.abs(zChg).toFixed(2)}
                              </span>
                            )}
                            <span>| {info.latest_date}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {/* Composite Z-scores */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem', borderTop: '1px solid #1a2233', paddingTop: '0.5rem' }}>
              {data.fred_growth_z != null && (
                <div style={{
                  flex: '1 1 200px', background: '#0e1525', borderRadius: 8, padding: '0.55rem 0.75rem',
                  border: '1px solid #4caf5033',
                }}>
                  <div style={{ fontSize: '0.72rem', color: '#90a4ae', marginBottom: 3 }}>Composite Growth Z</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: data.fred_growth_z > 0 ? '#4caf50' : '#ef5350' }}>
                    {data.fred_growth_z.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#666', marginTop: 2 }}>
                    Average of {growthCount} growth indicators
                  </div>
                </div>
              )}
              {data.fred_inflation_z != null && (
                <div style={{
                  flex: '1 1 200px', background: '#0e1525', borderRadius: 8, padding: '0.55rem 0.75rem',
                  border: '1px solid #ff980033',
                }}>
                  <div style={{ fontSize: '0.72rem', color: '#90a4ae', marginBottom: 3 }}>Composite Inflation Z</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: data.fred_inflation_z > 0 ? '#ef5350' : '#4caf50' }}>
                    {data.fred_inflation_z.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#666', marginTop: 2 }}>
                    Average of {inflationCount} inflation indicators
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Interpretation & Likely Direction */}
      {data.interpretation && (() => {
        const interp = data.interpretation
        const flagColors = { GREEN: '#4caf50', YELLOW: '#ff9800', RED: '#ef5350' }
        const flagBg = { GREEN: 'rgba(76,175,80,0.12)', YELLOW: 'rgba(255,152,0,0.12)', RED: 'rgba(239,83,80,0.12)' }
        return (
          <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderLeft: `4px solid ${flagColors[interp.regime_flag]}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{
                background: flagBg[interp.regime_flag], border: `1px solid ${flagColors[interp.regime_flag]}`,
                borderRadius: 6, padding: '0.4rem 0.75rem', fontWeight: 700,
                color: flagColors[interp.regime_flag], fontSize: '0.85rem',
              }}>
                {interp.regime_flag === 'GREEN' ? 'OK' : interp.regime_flag === 'YELLOW' ? 'WATCH' : 'ALERT'} Regime Change: {interp.regime_flag}
              </div>
              <span style={{ color: '#b0bec5', fontSize: '0.82rem' }}>{interp.regime_flag_text}</span>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ background: '#0e1525', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>
                <span style={{ color: '#90a4ae' }}>Growth Trend: </span>
                <span style={{ color: interp.growth_trend === 'accelerating' ? '#4caf50' : interp.growth_trend === 'decelerating' ? '#ef5350' : '#ff9800', fontWeight: 600 }}>
                  {interp.growth_trend.charAt(0).toUpperCase() + interp.growth_trend.slice(1)}
                </span>
                <span style={{ color: '#666', marginLeft: 6 }}>({interp.growth_delta_4w >= 0 ? '+' : ''}{interp.growth_delta_4w.toFixed(2)}% / 4wk)</span>
              </div>
              <div style={{ background: '#0e1525', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>
                <span style={{ color: '#90a4ae' }}>Inflation Trend: </span>
                <span style={{ color: interp.inflation_trend === 'accelerating' ? '#ef5350' : interp.inflation_trend === 'decelerating' ? '#4caf50' : '#ff9800', fontWeight: 600 }}>
                  {interp.inflation_trend.charAt(0).toUpperCase() + interp.inflation_trend.slice(1)}
                </span>
                <span style={{ color: '#666', marginLeft: 6 }}>({interp.inflation_delta_4w >= 0 ? '+' : ''}{interp.inflation_delta_4w.toFixed(2)}% / 4wk)</span>
              </div>
              <div style={{ background: '#0e1525', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>
                <span style={{ color: '#90a4ae' }}>Primary Risk: </span>
                <span style={{ color: QUAD_COLORS[interp.primary_risk_quad], fontWeight: 600 }}>
                  Q{interp.primary_risk_quad} {interp.primary_risk_name} ({interp.primary_risk_pct}%)
                </span>
              </div>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#90caf9', marginBottom: '0.35rem' }}>Likely Direction of Change</div>
              <p style={{ color: '#cfd8dc', fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>
                {interp.direction_narrative}
              </p>
            </div>
          </div>
        )
      })()}

      {/* 2x2 Quadrant Scatter Chart */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '1rem' }}>Regime Quadrant Map (5-Year History)</h3>
        <p style={{ color: '#8899aa', fontSize: '0.75rem', margin: '0 0 0.75rem' }}>
          {marketHistoryNote}
        </p>
        <Plot
          data={scatterMeta.traces}
          layout={{
            template: 'plotly_dark',
            paper_bgcolor: 'transparent', plot_bgcolor: '#0e1525',
            margin: { l: 60, r: 30, t: 10, b: 50 },
            height: 420,
            xaxis: { title: 'Market Proxy Growth Momentum (%)', zeroline: true, zerolinecolor: '#556', zerolinewidth: 2, gridcolor: '#1a2233', range: [scatterMeta.gMin, scatterMeta.gMax] },
            yaxis: { title: 'Market Proxy Inflation Momentum (%)', zeroline: true, zerolinecolor: '#556', zerolinewidth: 2, gridcolor: '#1a2233', range: [scatterMeta.iMin, scatterMeta.iMax] },
            shapes: [
              { type: 'rect', x0: 0, x1: scatterMeta.gMax + 10, y0: scatterMeta.iMin - 10, y1: 0, fillcolor: QUAD_BG[1], line: { width: 0 }, layer: 'below' },
              { type: 'rect', x0: 0, x1: scatterMeta.gMax + 10, y0: 0, y1: scatterMeta.iMax + 10, fillcolor: QUAD_BG[2], line: { width: 0 }, layer: 'below' },
              { type: 'rect', x0: scatterMeta.gMin - 10, x1: 0, y0: 0, y1: scatterMeta.iMax + 10, fillcolor: QUAD_BG[3], line: { width: 0 }, layer: 'below' },
              { type: 'rect', x0: scatterMeta.gMin - 10, x1: 0, y0: scatterMeta.iMin - 10, y1: 0, fillcolor: QUAD_BG[4], line: { width: 0 }, layer: 'below' },
            ],
            annotations: scatterMeta.annotations,
            showlegend: false,
          }}
          config={RESPONSIVE_PLOT_CONFIG}
          style={{ width: '100%' }}
        />
      </div>

      {/* This Week's Outlook - current-week-specific probabilities */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '1rem' }}>
          This Week's Outlook - Next Week Probabilities
        </h3>
        <p style={{ color: '#8899aa', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
          {transitionEngineNote}
        </p>
        <p style={{ color: '#8899aa', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
          Adjusted for current momentum, FRED Z-scores, and conditional matching
          {data.conditional_observations != null && ` (${data.conditional_observations} similar historical weeks, weight ${(safeData.conditional_weight || 0).toFixed(2)})`}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {adjustedTransitionCards.map(({ q, adjustedProb: adjProb, historicalProb: histProb, delta, isSelf, isMax }) => {
            return (
              <div key={q} style={{
                flex: '1 1 180px', padding: '0.75rem 1rem', borderRadius: 8,
                background: isMax ? `${QUAD_COLORS[q]}20` : '#0e1525',
                border: isMax ? `2px solid ${QUAD_COLORS[q]}` : '1px solid #1a2233',
                textAlign: 'center', position: 'relative',
              }}>
                {isSelf && (
                  <div style={{ position: 'absolute', top: 4, right: 8, fontSize: '0.6rem', color: '#90a4ae', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Stay
                  </div>
                )}
                <div style={{ fontSize: '0.8rem', color: QUAD_COLORS[q], fontWeight: 600, marginBottom: 4 }}>
                  {isSelf ? `Stay Q${q}` : `-> Q${q}`} {QUAD_LABELS[q]?.split(' ').slice(1).join(' ')}
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: isMax ? '#fff' : '#b0bec5' }}>
                  {adjProb.toFixed(1)}%
                </div>
                 <div style={{ fontSize: '0.75rem', color: '#90a4ae', marginTop: 4 }}>
                   Baseline: {histProb.toFixed(1)}%
                 </div>
                {Math.abs(delta) >= 0.1 && (
                  <div style={{
                    fontSize: '0.75rem', fontWeight: 600, marginTop: 2,
                    color: delta > 0 ? (isSelf ? '#4caf50' : '#ff9800') : (isSelf ? '#ef5350' : '#4caf50'),
                  }}>
                    {delta > 0 ? '^' : 'v'} {Math.abs(delta).toFixed(1)}pp
                  </div>
                )}
                {/* Mini bar */}
                <div style={{ marginTop: 6, height: 6, background: '#16213e', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${adjProb}%`, height: '100%', background: QUAD_COLORS[q],
                    borderRadius: 3, opacity: 0.8,
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Transition Matrix Heatmap + Forward Projections side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        {/* Transition Matrix (Historical Baseline) */}
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '1rem' }}>
            Historical Transition Matrix (Weekly Probabilities)
          </h3>
          <p style={{ color: '#8899aa', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
            Based on {data.total_observations} weekly observations - {'>'} indicates the transition anchor state
          </p>
          <Plot
            data={[{
              z: stm.map(row => row.map(v => v * 100)),
              x: quadLabels,
              y: quadLabels.map((l, i) => i === transitionAnchorQuadrant - 1 ? `> ${l}` : l),
              type: 'heatmap',
              colorscale: [[0, '#0e1525'], [0.5, '#1a5276'], [1, '#4caf50']],
              xgap: 3, ygap: 3,
              hovertemplate: '%{z:.1f}%<extra></extra>',
              showscale: false,
            }]}
            layout={{
              template: 'plotly_dark',
              paper_bgcolor: 'transparent', plot_bgcolor: '#0e1525',
              margin: { l: 120, r: 20, t: 10, b: 80 },
              height: 340,
              xaxis: { title: 'To', side: 'bottom', tickangle: -30 },
              yaxis: { title: 'From', autorange: 'reversed' },
              annotations: heatmapAnnotations,
            }}
            config={RESPONSIVE_PLOT_CONFIG}
            style={{ width: '100%' }}
          />
        </div>

        {/* Forward Projections */}
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '1rem' }}>
            Forward Projections (from Q{transitionAnchorQuadrant})
          </h3>
          {/* 2-Month Forecast Hero */}
          {proj['8_week'] && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#b0bec5', fontWeight: 600, marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                2-Month Forecast (8 Weeks)
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {QUAD_IDS.map(q => {
                  const pct8 = ((proj['8_week']?.[`Q${q}`] || 0) * 100)
                  const pct1 = ((proj['1_week']?.[`Q${q}`] || 0) * 100)
                  const delta = pct8 - pct1
                  const isMax = q === projectionDisplay.eightWeekMaxQ
                  return (
                    <div key={q} style={{
                      flex: 1, minWidth: 140, padding: '0.6rem 0.75rem', borderRadius: 8,
                      background: isMax ? `${QUAD_COLORS[q]}30` : '#0e1525',
                      border: isMax ? `2px solid ${QUAD_COLORS[q]}` : '1px solid #1a2233',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '0.72rem', color: QUAD_COLORS[q], fontWeight: 600, marginBottom: 4 }}>
                        Q{q} {getQuadrantShortName(q)}
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: isMax ? '#fff' : '#90a4ae' }}>
                        {pct8.toFixed(0)}%
                      </div>
                      <div style={{ fontSize: '0.65rem', color: delta > 0.5 ? '#ff9800' : delta < -0.5 ? '#4caf50' : '#666', marginTop: 2 }}>
                        {delta > 0.5 ? `^ ${delta.toFixed(1)}pp from 1wk` : delta < -0.5 ? `v ${Math.abs(delta).toFixed(1)}pp from 1wk` : `-> stable vs 1wk`}
                      </div>
                    </div>
                  )
                })}
              </div>
              {(() => {
                const maxQ = projectionDisplay.eightWeekMaxQ
                const maxPct = ((proj['8_week']?.[`Q${maxQ}`] || 0) * 100).toFixed(0)
                const stagPct = ((proj['8_week']?.Q3 || 0) * 100).toFixed(0)
                return (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#b0bec5', background: '#0e1525', padding: '0.4rem 0.75rem', borderRadius: 6 }}>
                    Most likely regime in 2 months: <strong style={{ color: QUAD_COLORS[maxQ] }}>Q{maxQ} {getQuadrantShortName(maxQ)}</strong> at {maxPct}%
                    {maxQ !== 3 && Number(stagPct) >= 20 && (
                      <span> | <span style={{ color: '#ef5350' }}>Stagflation risk: {stagPct}%</span></span>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
          {/* 4-Week Outlook Summary */}
          {proj['4_week'] && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#90a4ae', fontWeight: 600, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                1-Month Outlook (4 Weeks)
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {QUAD_IDS.map(q => {
                  const pct = ((proj['4_week']?.[`Q${q}`] || 0) * 100).toFixed(0)
                  const isMax = q === projectionDisplay.fourWeekMaxQ
                  return (
                    <div key={q} style={{
                      flex: 1, minWidth: 90, padding: '0.4rem 0.5rem', borderRadius: 6,
                      background: isMax ? `${QUAD_COLORS[q]}30` : '#0e1525',
                      border: isMax ? `2px solid ${QUAD_COLORS[q]}` : '1px solid #1a2233',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '0.7rem', color: QUAD_COLORS[q], fontWeight: 600, marginBottom: 2 }}>
                        Q{q} {getQuadrantShortName(q)}
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: isMax ? '#fff' : '#90a4ae' }}>
                        {pct}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <Plot
            data={projectionDisplay.projectionSeries}
            layout={{
              template: 'plotly_dark',
              paper_bgcolor: 'transparent', plot_bgcolor: '#0e1525',
              margin: { l: 50, r: 20, t: 10, b: 50 },
              height: 340,
              barmode: 'stack',
              yaxis: { title: 'Probability (%)', range: [0, 100], gridcolor: '#1a2233' },
              xaxis: { gridcolor: '#1a2233' },
              legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 11 } },
            }}
            config={RESPONSIVE_PLOT_CONFIG}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Current Transition Probabilities + Asset Tilts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        {/* Where We're Headed */}
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <h3 style={{ color: '#90caf9', margin: '0 0 0.75rem', fontSize: '1rem' }}>
            Markov Chain Transition (from Q{transitionAnchorQuadrant} {transitionAnchorName})
          </h3>
          {QUAD_IDS.map(q => {
            const prob = (tm[transitionAnchorQuadrant - 1]?.[q - 1] || 0) * 100
            const count = tc[transitionAnchorQuadrant - 1]?.[q - 1] || 0
            const isMax = prob === maxAdjustedTransitionProb
            const isSelf = q === transitionAnchorQuadrant
            return (
              <div key={q} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.5rem 0.75rem', marginBottom: '0.35rem',
                background: isSelf ? `${QUAD_COLORS[q]}18` : 'transparent',
                borderLeft: `4px solid ${QUAD_COLORS[q]}`,
                borderRadius: 4,
              }}>
                <div style={{ width: 140, fontWeight: 600, color: QUAD_COLORS[q], fontSize: '0.85rem' }}>
                  {isSelf ? `Stay in Q${q}` : `-> Q${q} ${QUAD_LABELS[q].split(' ').slice(1).join(' ')}`}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ background: '#0e1525', borderRadius: 4, height: 20, position: 'relative', overflow: 'hidden' }}>
                    <div style={{
                      width: `${prob}%`, height: '100%', background: QUAD_COLORS[q],
                      opacity: 0.7, borderRadius: 4, transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
                <div style={{ width: 60, textAlign: 'right', fontWeight: 700, color: isMax && !isSelf ? '#ff9800' : '#e0e0e0', fontSize: '0.95rem' }}>
                  {prob.toFixed(1)}%
                </div>
                <div style={{ width: 50, textAlign: 'right', color: '#666', fontSize: '0.75rem' }}>
                  ({count})
                </div>
                {isMax && !isSelf && prob > 25 && (
                  <span style={{ fontSize: '0.7rem', background: '#ff980033', color: '#ff9800', padding: '2px 6px', borderRadius: 4 }}>
                    Primary Risk
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Asset Class Tilts - All Quadrants */}
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <h3 style={{ color: '#90caf9', margin: '0 0 0.75rem', fontSize: '1rem' }}>Asset Class Performance by Quadrant</h3>
          <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1a2233' }}>
                <th style={{ ...thStyle, textAlign: 'left' }}>Asset Class</th>
                {[1, 2, 3, 4].map(q => (
                  <th key={q} style={{
                    ...thStyle, textAlign: 'center',
                    color: q === currentQuadrant ? QUAD_COLORS[q] : '#90a4ae',
                    fontWeight: q === currentQuadrant ? 700 : 600,
                  }}>
                    Q{q}{q === data.current_quadrant ? ' *' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(data.all_asset_tilts?.[1] || {}).map(asset => (
                <tr key={asset} style={{ borderBottom: '1px solid #0a1628' }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{asset}</td>
                  {[1, 2, 3, 4].map(q => {
                    const rating = data.all_asset_tilts?.[q]?.[asset] || '--'
                    const isCurrentQ = q === currentQuadrant
                    return (
                      <td key={q} style={{
                        ...tdStyle, textAlign: 'center',
                        color: TILT_COLORS[rating] || '#90a4ae',
                        fontWeight: isCurrentQ ? 700 : 400,
                        background: isCurrentQ ? `${QUAD_COLORS[q]}10` : 'transparent',
                      }}>
                        {rating}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Regime Distribution */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '1rem' }}>Historical Regime Distribution</h3>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {QUAD_IDS.map(q => {
            const d = data.regime_distribution?.[`Q${q}`] || {}
            return (
              <div key={q} style={{
                flex: 1, minWidth: 150, background: `${QUAD_COLORS[q]}12`,
                border: `1px solid ${QUAD_COLORS[q]}44`, borderRadius: 8, padding: '0.75rem',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '0.75rem', color: '#90a4ae', marginBottom: 4 }}>{QUAD_LABELS[q]}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: QUAD_COLORS[q] }}>{d.pct || 0}%</div>
                <div style={{ fontSize: '0.75rem', color: '#666' }}>{d.count || 0} weeks</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Brier Score - Model Accuracy Tracker */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '1rem' }}>
          Model Accuracy - Brier Score
        </h3>
        <div style={{ fontSize: '0.75rem', color: '#90a4ae', marginBottom: '0.75rem', lineHeight: 1.5, background: '#0e1525', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
          <p style={{ margin: '0 0 0.4rem' }}>
            The <strong style={{ color: '#e0e8f5' }}>Brier Score</strong> measures how accurate the model's probability forecasts are over time.
            Each week, the model predicts the probability of landing in each of the 4 quadrants. When the target date arrives,
            we compare the prediction to what actually happened.
          </p>
          <p style={{ margin: '0 0 0.4rem' }}>
            <strong style={{ color: '#e0e8f5' }}>How it works:</strong> For each prediction, we compute (predicted probability - actual outcome)^2
            across all 4 quadrants, then average over all predictions. A perfect forecast scores <strong style={{ color: '#4caf50' }}>0.0</strong>,
            and a completely wrong forecast scores close to <strong style={{ color: '#ef5350' }}>2.0</strong>.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
            <span><span style={{ color: '#4caf50', fontWeight: 600 }}>* Excellent (&lt;0.10)</span> - Very well calibrated</span>
            <span><span style={{ color: '#66bb6a', fontWeight: 600 }}>* Good (&lt;0.25)</span> - Useful predictions</span>
            <span><span style={{ color: '#ff9800', fontWeight: 600 }}>* Fair (&lt;0.50)</span> - Some predictive value</span>
            <span><span style={{ color: '#ef5350', fontWeight: 600 }}>* Poor (&gt;=0.50)</span> - No better than random</span>
          </div>
        </div>
        {data.brier_scores ? (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {BRIER_HORIZONS.map(({ key, label }) => {
              const bs = data.brier_scores[key]
              if (!bs) return (
                <div key={key} style={{
                  flex: 1, minWidth: 180, background: '#0e1525', borderRadius: 8,
                  padding: '0.75rem', border: '1px solid #1a2233', textAlign: 'center',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#90a4ae', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: '1rem', color: '#666' }}>Collecting data...</div>
                  <div style={{ fontSize: '0.65rem', color: '#555', marginTop: 4 }}>Needs {'>='}2 resolved predictions</div>
                </div>
              )
              const scoreColor = bs.rating === 'Excellent' ? '#4caf50' : bs.rating === 'Good' ? '#66bb6a' : bs.rating === 'Fair' ? '#ff9800' : '#ef5350'
              return (
                <div key={key} style={{
                  flex: 1, minWidth: 180, background: '#0e1525', borderRadius: 8,
                  padding: '0.75rem', border: `1px solid ${scoreColor}44`, textAlign: 'center',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#90a4ae', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: scoreColor }}>{bs.score.toFixed(3)}</div>
                  <div style={{ fontSize: '0.72rem', color: scoreColor, fontWeight: 600, marginTop: 2 }}>{bs.rating}</div>
                  <div style={{ fontSize: '0.65rem', color: '#666', marginTop: 4 }}>{bs.n_predictions} predictions scored</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>
            <div style={{ fontSize: '1rem', marginBottom: '0.3rem' }}>Tracking started - collecting predictions</div>
            <div style={{ fontSize: '0.75rem' }}>
              Brier scores will appear once enough time has passed for predictions to be verified against actual outcomes.
              The 1-week score will populate first (after ~2 weeks), followed by 1-month and 2-month scores.
            </div>
          </div>
        )}
      </div>
    </div>
  )
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
        <button className={`tab ${activeTab === 'income' ? 'active' : ''}`}
          onClick={() => setActiveTab('income')}>
          Income Benchmark
        </button>
        <button className={`tab ${activeTab === 'classifications' ? 'active' : ''}`}
          onClick={() => setActiveTab('classifications')}>
          Classifications
        </button>
        <button className={`tab ${activeTab === 'quadrants' ? 'active' : ''}`}
          onClick={() => setActiveTab('quadrants')}>
          Regime Quadrants
        </button>
      </div>

      {activeTab === 'conditions' && <ConditionsTab pf={pf} key={selection?.id || 'cond'} />}
      {activeTab === 'exposure' && <ExposureTab pf={pf} key={selection?.id || 'exp'} />}
      {activeTab === 'tilts' && <TiltsTab pf={pf} key={selection?.id || 'tilts'} />}
      {activeTab === 'income' && <IncomeBenchmarkTab pf={pf} key={selection?.id || 'income'} />}
      {activeTab === 'classifications' && <ClassificationsTab pf={pf} key={selection?.id || 'class'} />}
      {activeTab === 'quadrants' && <QuadrantTab pf={pf} key={selection?.id || 'quad'} />}
    </div>
  )
}
