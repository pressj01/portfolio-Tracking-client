import React, { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../../config'

function metricColor(val, thresholds, lowerBetter = false) {
  if (val == null) return '#8899aa'
  const [a, b, c] = thresholds
  if (lowerBetter) return val <= a ? '#4dff91' : val <= b ? '#7ecfff' : val <= c ? '#ffb74d' : '#ff6b6b'
  return val >= a ? '#4dff91' : val >= b ? '#7ecfff' : val >= c ? '#ffb74d' : '#ff6b6b'
}

export default function ToolsPanel({ tickers, result, onAddTicker }) {
  // Peer comparison
  const [peerTicker, setPeerTicker] = useState('')
  const [peerData, setPeerData] = useState(null)
  const [peerLoading, setPeerLoading] = useState(false)

  // What-if
  const [whatIfTicker, setWhatIfTicker] = useState('')
  const [whatIfWeight, setWhatIfWeight] = useState(0)

  useEffect(() => { if (tickers?.length && !peerTicker) setPeerTicker(tickers[0]) }, [tickers, peerTicker])
  useEffect(() => { if (tickers?.length && !whatIfTicker) setWhatIfTicker(tickers[0]) }, [tickers, whatIfTicker])

  const fetchPeers = () => {
    if (!peerTicker) return
    setPeerLoading(true)
    fetch(`${API_BASE}/api/analytics/peers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: peerTicker }),
    }).then(r => r.json()).then(setPeerData).catch(() => {}).finally(() => setPeerLoading(false))
  }

  // What-If computation (frontend-only)
  const whatIfResult = useMemo(() => {
    if (!result?.metrics?.length || !result?.correlation || !whatIfTicker) return null
    const metrics = result.metrics
    const m = metrics.find(x => x.ticker === whatIfTicker)
    if (!m) return null

    // Current weights
    const totalWeight = metrics.reduce((s, x) => s + (x.weight || 0), 0)
    if (totalWeight === 0) return null

    const currentWeights = metrics.map(x => (x.weight || 0) / totalWeight)
    const idx = metrics.findIndex(x => x.ticker === whatIfTicker)
    const newTarget = whatIfWeight / 100
    const oldWeight = currentWeights[idx]
    const remaining = 1 - oldWeight

    // Build new weights
    const newWeights = currentWeights.map((w, i) => {
      if (i === idx) return newTarget
      return remaining > 0 ? w * (1 - newTarget) / remaining : 0
    })

    // Estimate income
    const currentIncome = metrics.reduce((s, x, i) => s + (x.annual_income || 0) * currentWeights[i] / (x.weight / totalWeight || 1), 0)
    const newIncome = metrics.reduce((s, x, i) => {
      const incPerUnit = (x.annual_income || 0) / (x.weight / totalWeight || 1)
      return s + incPerUnit * newWeights[i]
    }, 0)

    // Estimate portfolio vol from correlation matrix
    const { labels, matrix } = result.correlation
    const vols = metrics.map(x => (x.annual_vol || 0) / 100)
    const n = metrics.length

    let currentVar = 0, newVar = 0
    for (let i = 0; i < n; i++) {
      const li = labels.indexOf(metrics[i].ticker)
      for (let j = 0; j < n; j++) {
        const lj = labels.indexOf(metrics[j].ticker)
        if (li < 0 || lj < 0) continue
        const corr = matrix[li]?.[lj] ?? 0
        const cov = corr * vols[i] * vols[j]
        currentVar += currentWeights[i] * currentWeights[j] * cov
        newVar += newWeights[i] * newWeights[j] * cov
      }
    }

    return {
      currentIncome: result.portfolio_metrics?.est_annual_income || 0,
      newIncome: Math.round(newIncome),
      currentVol: Math.sqrt(Math.max(currentVar, 0)) * 100,
      newVol: Math.sqrt(Math.max(newVar, 0)) * 100,
      currentWeight: (oldWeight * 100).toFixed(1),
      newWeight: whatIfWeight.toFixed(1),
    }
  }, [result, whatIfTicker, whatIfWeight])

  // Set what-if slider to current weight on ticker change
  useEffect(() => {
    if (!result?.metrics?.length || !whatIfTicker) return
    const m = result.metrics.find(x => x.ticker === whatIfTicker)
    if (m) setWhatIfWeight(Math.round(m.weight || 0))
  }, [whatIfTicker, result])

  return (
    <>
      {/* Peer Comparison */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ color: '#e0e8f5', fontWeight: 600, fontSize: '0.9rem' }}>Peer Comparison</span>
          <select value={peerTicker} onChange={e => { setPeerTicker(e.target.value); setPeerData(null) }}
            style={{ background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 4, color: '#e0e0e0', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}>
            {(tickers || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={fetchPeers} disabled={peerLoading} className="btn btn-primary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.82rem' }}>
            {peerLoading ? 'Loading...' : 'Find Peers'}
          </button>
        </div>

        {peerData?.peers?.length > 0 ? (
          <>
            {peerData.category && (
              <div style={{ fontSize: '0.78rem', color: '#8899aa', marginBottom: '0.5rem' }}>
                Category: <span style={{ color: '#64b5f6' }}>{peerData.category}</span>
              </div>
            )}
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Ticker</th>
                  <th style={th}>Name</th>
                  <th style={{ ...th, textAlign: 'right' }}>Yield %</th>
                  <th style={{ ...th, textAlign: 'right' }}>1Y Return</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {peerData.peers.map(p => (
                  <tr key={p.ticker} style={{ borderBottom: '1px solid #1a2a3e' }}>
                    <td style={{ padding: '0.35rem 0.5rem', color: '#7ecfff', fontWeight: 600 }}>{p.ticker}</td>
                    <td style={{ padding: '0.35rem 0.5rem', color: '#b0bec5', fontSize: '0.78rem' }}>{p.name || '—'}</td>
                    <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: '#4dff91' }}>
                      {p.yield_pct != null ? p.yield_pct.toFixed(2) + '%' : '—'}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: (p.return_1y || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}>
                      {p.return_1y != null ? p.return_1y.toFixed(1) + '%' : '—'}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem' }}>
                      {!tickers.includes(p.ticker) && (
                        <button onClick={() => onAddTicker(p.ticker)} style={{
                          background: 'none', border: '1px solid #3a5a8c', borderRadius: 4, color: '#64b5f6',
                          fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                        }}>Add</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : peerData && !peerLoading ? (
          <div style={{ color: '#8899aa', fontSize: '0.85rem' }}>No peers found for {peerTicker}.</div>
        ) : null}
      </div>

      {/* What-If Slider */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ color: '#e0e8f5', fontWeight: 600, fontSize: '0.9rem' }}>What-If Analysis</span>
          <select value={whatIfTicker} onChange={e => setWhatIfTicker(e.target.value)}
            style={{ background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 4, color: '#e0e0e0', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}>
            {(tickers || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {result?.metrics?.length > 1 && result?.correlation ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ color: '#8899aa', fontSize: '0.82rem', width: 30 }}>0%</span>
              <input type="range" min="0" max="50" value={whatIfWeight}
                onChange={e => setWhatIfWeight(Number(e.target.value))}
                style={{ flex: 1 }} />
              <span style={{ color: '#8899aa', fontSize: '0.82rem', width: 35 }}>50%</span>
              <span style={{ color: '#64b5f6', fontSize: '0.9rem', fontWeight: 600, width: 50, textAlign: 'right' }}>{whatIfWeight}%</span>
            </div>

            {whatIfResult && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="card" style={{ padding: '0.6rem', background: '#0a1628' }}>
                  <div style={{ fontSize: '0.72rem', color: '#8899aa', marginBottom: '0.2rem' }}>Est. Annual Income</div>
                  <div style={{ fontSize: '0.82rem', color: '#8899aa' }}>Current: <span style={{ color: '#e0e8f5', fontWeight: 600 }}>${whatIfResult.currentIncome.toLocaleString()}</span></div>
                  <div style={{ fontSize: '0.82rem', color: whatIfResult.newIncome >= whatIfResult.currentIncome ? '#4dff91' : '#ff6b6b' }}>
                    Projected: <span style={{ fontWeight: 600 }}>${whatIfResult.newIncome.toLocaleString()}</span>
                  </div>
                </div>
                <div className="card" style={{ padding: '0.6rem', background: '#0a1628' }}>
                  <div style={{ fontSize: '0.72rem', color: '#8899aa', marginBottom: '0.2rem' }}>Portfolio Volatility</div>
                  <div style={{ fontSize: '0.82rem', color: '#8899aa' }}>Current: <span style={{ color: '#e0e8f5', fontWeight: 600 }}>{whatIfResult.currentVol.toFixed(1)}%</span></div>
                  <div style={{ fontSize: '0.82rem', color: whatIfResult.newVol <= whatIfResult.currentVol ? '#4dff91' : '#ff6b6b' }}>
                    Projected: <span style={{ fontWeight: 600 }}>{whatIfResult.newVol.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="card" style={{ padding: '0.6rem', background: '#0a1628' }}>
                  <div style={{ fontSize: '0.72rem', color: '#8899aa', marginBottom: '0.2rem' }}>Weight Change</div>
                  <div style={{ fontSize: '0.82rem', color: '#8899aa' }}>Current: <span style={{ color: '#e0e8f5', fontWeight: 600 }}>{whatIfResult.currentWeight}%</span></div>
                  <div style={{ fontSize: '0.82rem', color: '#64b5f6' }}>
                    Target: <span style={{ fontWeight: 600 }}>{whatIfResult.newWeight}%</span>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ color: '#8899aa', fontSize: '0.85rem', padding: '0.5rem' }}>
            What-If analysis requires 2+ tickers with correlation data. Run analysis with your portfolio loaded.
          </div>
        )}
      </div>
    </>
  )
}

const th = {
  padding: '0.4rem 0.5rem', borderBottom: '1px solid #2a3a4e',
  color: '#8899aa', fontSize: '0.78rem', textAlign: 'left',
}
