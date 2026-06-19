import React, { useState, useEffect, useMemo } from 'react'
import { useProfileFetch } from '../../context/ProfileContext'
import { formatMoneyWhole } from '../../utils/money'

function metricColor(val, thresholds, lowerBetter = false) {
  if (val == null) return '#8899aa'
  const [a, b, c] = thresholds
  if (lowerBetter) return val <= a ? '#4dff91' : val <= b ? '#7ecfff' : val <= c ? '#ffb74d' : '#ff6b6b'
  return val >= a ? '#4dff91' : val >= b ? '#7ecfff' : val >= c ? '#ffb74d' : '#ff6b6b'
}

export default function ToolsPanel({ tickers, result, onAddTicker }) {
  const pf = useProfileFetch()
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
    pf('/api/analytics/peers', {
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

    // Risk is modeled over the tickers with usable return/correlation data.
    // Normalize that modeled sleeve so missing-history holdings do not make the
    // covariance weights sum to less than 100%.
    const modeledWeight = metrics.reduce((s, x) => s + (Number(x.weight) || 0), 0)
    if (modeledWeight <= 0) return null

    const currentWeights = metrics.map(x => (Number(x.weight) || 0) / modeledWeight)
    const idx = metrics.findIndex(x => x.ticker === whatIfTicker)
    const newTarget = whatIfWeight / 100
    const oldPortfolioWeight = (Number(m.weight) || 0) / 100

    // Convert the whole-portfolio target to a weight within the modeled sleeve.
    // All other holdings are scaled proportionally, then the available risk
    // rows are renormalized for the covariance calculation.
    const otherScale = oldPortfolioWeight < 1
      ? (1 - newTarget) / (1 - oldPortfolioWeight)
      : 0
    const rawNewWeights = currentWeights.map((w, i) => (
      i === idx ? newTarget : w * otherScale
    ))
    const rawNewTotal = rawNewWeights.reduce((s, w) => s + w, 0)

    // Build new weights
    const newWeights = rawNewTotal > 0
      ? rawNewWeights.map(w => w / rawNewTotal)
      : currentWeights

    // Estimate income from the whole-portfolio baseline. The selected holding
    // keeps its current yield; every other holding is resized proportionally.
    // This avoids comparing whole-portfolio current income with an analyzed-
    // tickers-only projection when one holding lacks enough price history.
    const currentIncome = Number(result.portfolio_metrics?.est_annual_income) || 0
    const selectedIncome = Number(m.annual_income) || 0
    let newIncome = currentIncome
    if (oldPortfolioWeight > 0) {
      const selectedAtTarget = selectedIncome * newTarget / oldPortfolioWeight
      const otherCurrentIncome = Math.max(0, currentIncome - selectedIncome)
      newIncome = selectedAtTarget + otherCurrentIncome * otherScale
    } else if (newTarget > 0) {
      // There is no holding value from which to infer this ticker's yield.
      newIncome = null
    }

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
      newIncome: newIncome == null ? null : Math.round(newIncome),
      currentVol: Math.sqrt(Math.max(currentVar, 0)) * 100,
      newVol: Math.sqrt(Math.max(newVar, 0)) * 100,
      currentWeight: (oldPortfolioWeight * 100).toFixed(1),
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
          <span style={{ color: 'var(--text-strong)', fontWeight: 600, fontSize: '0.9rem' }}>Peer Comparison</span>
          <select value={peerTicker} onChange={e => { setPeerTicker(e.target.value); setPeerData(null) }}
            style={{ background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4, color: 'var(--text)', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}>
            {(tickers || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={fetchPeers} disabled={peerLoading} className="btn btn-primary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.82rem' }}>
            {peerLoading ? 'Loading...' : 'Find Peers'}
          </button>
        </div>

        {peerData?.peers?.length > 0 ? (
          <>
            {peerData.category && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                Category: <span style={{ color: 'var(--accent)' }}>{peerData.category}</span>
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
                  <tr key={p.ticker} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                    <td style={{ padding: '0.35rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{p.ticker}</td>
                    <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{p.name || '—'}</td>
                    <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--pos)' }}>
                      {p.yield_pct != null ? p.yield_pct.toFixed(2) + '%' : '—'}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: (p.return_1y || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                      {p.return_1y != null ? p.return_1y.toFixed(1) + '%' : '—'}
                    </td>
                    <td style={{ padding: '0.35rem 0.5rem' }}>
                      {!tickers.includes(p.ticker) && (
                        <button onClick={() => onAddTicker(p.ticker)} style={{
                          background: 'none', border: '1px solid var(--p-3a5a8c)', borderRadius: 4, color: 'var(--accent)',
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
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No peers found for {peerTicker}.</div>
        ) : null}
      </div>

      {/* What-If Slider */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ color: 'var(--text-strong)', fontWeight: 600, fontSize: '0.9rem' }}>What-If Analysis</span>
          <select value={whatIfTicker} onChange={e => setWhatIfTicker(e.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4, color: 'var(--text)', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}>
            {(tickers || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {result?.metrics?.length > 1 && result?.correlation ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem', width: 30 }}>0%</span>
              <input type="range" min="0" max="50" value={whatIfWeight}
                aria-label={`${whatIfTicker} target portfolio weight`}
                onChange={e => setWhatIfWeight(Number(e.target.value))}
                style={{ flex: 1 }} />
              <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem', width: 35 }}>50%</span>
              <span style={{ color: 'var(--accent)', fontSize: '0.9rem', fontWeight: 600, width: 50, textAlign: 'right' }}>{whatIfWeight}%</span>
            </div>

            {whatIfResult && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="card" style={{ padding: '0.6rem', background: 'var(--p-0a1628)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Est. Annual Income</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>Current: <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{formatMoneyWhole(whatIfResult.currentIncome)}</span></div>
                  <div style={{ fontSize: '0.82rem', color: whatIfResult.newIncome == null ? 'var(--text-dim)' : whatIfResult.newIncome >= whatIfResult.currentIncome ? 'var(--pos)' : 'var(--neg)' }}>
                    Projected: <span style={{ fontWeight: 600 }}>{whatIfResult.newIncome == null ? 'Unavailable' : formatMoneyWhole(whatIfResult.newIncome)}</span>
                  </div>
                </div>
                <div className="card" style={{ padding: '0.6rem', background: 'var(--p-0a1628)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Portfolio Volatility</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>Current: <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{whatIfResult.currentVol.toFixed(1)}%</span></div>
                  <div style={{ fontSize: '0.82rem', color: whatIfResult.newVol <= whatIfResult.currentVol ? 'var(--pos)' : 'var(--neg)' }}>
                    Projected: <span style={{ fontWeight: 600 }}>{whatIfResult.newVol.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="card" style={{ padding: '0.6rem', background: 'var(--p-0a1628)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Weight Change</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>Current: <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{whatIfResult.currentWeight}%</span></div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--accent)' }}>
                    Target: <span style={{ fontWeight: 600 }}>{whatIfResult.newWeight}%</span>
                  </div>
                </div>
              </div>
            )}

            <details style={{ marginTop: '0.75rem', borderTop: '1px solid var(--p-2a3a4e)', paddingTop: '0.6rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent-2)', fontSize: '0.8rem', fontWeight: 600 }}>
                How does this What-If analysis work? {'ⓘ'}
              </summary>
              <div style={{ marginTop: '0.55rem', color: 'var(--text-dim)', fontSize: '0.78rem', lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 0.45rem' }}>
                  Choose a holding and move the slider to a target share of the <strong style={{ color: 'var(--text-strong)' }}>entire portfolio</strong>.
                  The model holds the portfolio's total value constant and increases or reduces every other holding proportionally.
                </p>
                <ul style={{ margin: '0 0 0.45rem', paddingLeft: '1.1rem' }}>
                  <li><strong style={{ color: 'var(--text-strong)' }}>Annual income</strong> assumes each holding keeps its current income yield. It is an estimate, not a dividend forecast.</li>
                  <li><strong style={{ color: 'var(--text-strong)' }}>Volatility</strong> uses annualized historical volatility and the displayed correlation matrix. Holdings without enough shared price history cannot be included, so this is a modeled estimate.</li>
                  <li><strong style={{ color: 'var(--text-strong)' }}>Weight change</strong> compares the holding's actual current portfolio weight with your slider target.</li>
                </ul>
                <div style={{ margin: '0.55rem 0', padding: '0.55rem 0.7rem', background: 'var(--p-0b0b1c)', border: '1px solid var(--p-2a3a4e)', borderRadius: 4 }}>
                  <strong style={{ color: 'var(--text-strong)' }}>Concrete example.</strong>{' '}
                  Suppose AIPI is 5% of a $100,000 portfolio and you move the slider to 10%. The model raises AIPI from $5,000 to $10,000
                  and reduces the combined value of every other holding from $95,000 to $90,000. Each other position is multiplied by
                  90/95, or about 94.7%—so a $9,500 holding becomes about $9,000. It then recalculates annual income using the holdings'
                  current yields and recalculates volatility using their historical risk and correlations. No cash is added and no trade is placed.
                </div>
                <p style={{ margin: 0 }}>
                  This does not place trades or change saved holdings. A target above 0% cannot estimate income for a ticker that is not currently held because there is no portfolio income yield to carry forward.
                </p>
              </div>
            </details>
          </>
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', padding: '0.5rem' }}>
            What-If analysis requires 2+ tickers with correlation data. Run analysis with your portfolio loaded.
          </div>
        )}
      </div>
    </>
  )
}

const th = {
  padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)',
  color: 'var(--text-dim)', fontSize: '0.78rem', textAlign: 'left',
}
