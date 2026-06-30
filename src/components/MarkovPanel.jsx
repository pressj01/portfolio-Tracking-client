import React, { useState } from 'react'

// Plain-English Markov regime panel for the Stock & ETF Analysis "Markov" tab.
// Default view answers "what regime are we in and what usually comes next?".
// An Advanced expander shows the full transition matrix + long-run base rate
// for users who want the underlying numbers.
//
// Regime index map matches src/utils/markov.js: 0 = Bear, 1 = Sideways, 2 = Bull.

const pct = (v) => `${Math.round((v || 0) * 100)}%`

// Display order Bull → Sideways → Bear, with the matrix index for each and a
// theme color for the label.
const DISP = [
  { idx: 2, label: 'Bull', color: 'var(--pos)' },
  { idx: 1, label: 'Sideways', color: 'var(--text-dim)' },
  { idx: 0, label: 'Bear', color: 'var(--neg)' },
]

const regimeColor = (idx) => (idx === 2 ? 'var(--pos)' : idx === 0 ? 'var(--neg)' : 'var(--text-dim)')

const stickiness = (p) =>
  p >= 0.8 ? { label: 'High', note: 'sticky / trending' }
    : p >= 0.6 ? { label: 'Moderate', note: 'some follow-through' }
      : { label: 'Low', note: 'choppy / mean-reverting' }

const PRESETS = [
  { window: 20, thr: 5, label: '20 / 5%', hint: '≈1 month, ±5% move' },
  { window: 50, thr: 8, label: '50 / 8%', hint: '≈1 quarter, ±8% move' },
  { window: 10, thr: 3, label: '10 / 3%', hint: '≈2 weeks, ±3% move (reactive)' },
]

const cardStyle = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '0.75rem 1rem', marginBottom: '0.75rem',
}

export default function MarkovPanel({ result, windowBars, thr, onChangeWindow, onChangeThr }) {
  const [advanced, setAdvanced] = useState(false)

  if (!result || !result.ok) {
    return (
      <div style={cardStyle}>
        <strong style={{ color: 'var(--accent-2)' }}>Markov Regime</strong>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: '0.4rem 0 0' }}>
          Not enough price history to model regimes. Load a longer period
          (need at least {windowBars + 2} bars for a lookback of {windowBars}).
        </p>
      </div>
    )
  }

  const { matrix, stationary, currentRegime, regimeName } = result
  const row = matrix[currentRegime] || [1 / 3, 1 / 3, 1 / 3]
  const diag = row[currentRegime] || 0
  const stick = stickiness(diag)

  // Dominant next-bar outcome from the current regime's row.
  const domIdx = row.indexOf(Math.max(...row))
  const domLabel = DISP.find(d => d.idx === domIdx)?.label || 'Sideways'

  // Forecast bars in display order (Bull / Sideways / Bear).
  const forecast = DISP.map(d => ({ ...d, p: row[d.idx] }))
  const maxP = Math.max(...forecast.map(f => f.p))

  return (
    <div style={cardStyle}>
      {/* Header: regime badge + plain-English read */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
        <span style={{
          padding: '0.25rem 0.7rem', borderRadius: 6, fontWeight: 800, letterSpacing: '0.04em',
          color: regimeColor(currentRegime),
          border: `1px solid ${regimeColor(currentRegime)}`,
          background: 'var(--surface-sunken)',
        }}>
          {regimeName.toUpperCase()}
        </span>
        <span style={{ color: 'var(--text)', fontSize: '0.88rem' }}>
          Currently <b style={{ color: regimeColor(currentRegime) }}>{regimeName}</b>.
          {' '}Historically, the next bar was most often{' '}
          <b style={{ color: regimeColor(domIdx) }}>{domLabel}</b> ({pct(maxP)}).
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
        }}>
          Trend stickiness:{' '}
          <b style={{ color: 'var(--text)' }}>{stick.label}</b> ({pct(diag)}) · {stick.note}
        </span>
      </div>

      {/* Next-bar forecast bars */}
      <div style={{ marginTop: '0.7rem' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
          What usually comes next (from {regimeName})
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          {forecast.map(f => (
            <div key={f.label} style={{ flex: 1, minWidth: 70 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 2 }}>
                <span style={{ color: f.color, fontWeight: f.p === maxP ? 700 : 500 }}>{f.label}</span>
                <span style={{ color: 'var(--text)', fontWeight: f.p === maxP ? 700 : 400 }}>{pct(f.p)}</span>
              </div>
              <div style={{ height: 8, background: 'var(--surface-sunken)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${(f.p * 100).toFixed(1)}%`, height: '100%', background: f.color, opacity: f.p === maxP ? 1 : 0.55 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Friendly controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          Lookback (bars)
          <input type="number" min={5} max={250} step={5} value={windowBars}
            onChange={e => onChangeWindow(Number(e.target.value))}
            title="How many bars back to measure the move that defines the regime"
            style={{ width: 80, marginTop: 2 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          Move threshold (%)
          <input type="number" min={0.5} max={50} step={0.5} value={thr}
            onChange={e => onChangeThr(Number(e.target.value))}
            title="A move bigger than ±this over the lookback counts as Bull / Bear; smaller is Sideways"
            style={{ width: 80, marginTop: 2 }} />
        </label>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          {PRESETS.map(p => {
            const active = p.window === windowBars && p.thr === thr
            return (
              <button key={p.label} className={`btn btn-sm${active ? ' btn-active' : ''}`}
                title={p.hint}
                onClick={() => { onChangeWindow(p.window); onChangeThr(p.thr) }}>
                {p.label}
              </button>
            )
          })}
        </div>
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdvanced(a => !a)}>
          {advanced ? '▴ Hide details' : '▾ Advanced'}
        </button>
      </div>

      {/* Practical threshold tuning guidance */}
      <div style={{
        marginTop: '0.65rem', padding: '0.55rem 0.7rem',
        background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6,
        fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.45,
      }}>
        <div style={{ color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
          Threshold guide
        </div>
        <div>
          The threshold is the move over the full lookback: above +threshold is{' '}
          <b style={{ color: 'var(--pos)' }}>Bull</b>, below −threshold is{' '}
          <b style={{ color: 'var(--neg)' }}>Bear</b>, and anything between is <b>Sideways</b>.
        </div>
        <div style={{ marginTop: '0.3rem' }}>
          <b>How to read the odds:</b> a high Sideways percentage means the next bar historically
          remained <em>classified</em> Sideways — it does not mean the next price was flat or has that
          probability of being flat. Consecutive rolling lookback windows overlap, so persistence is
          naturally high.
        </div>
        <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
          <li><b>Start with 20 / 5%</b> on a daily chart, then adjust for the ticker&apos;s volatility.</li>
          <li><b>Lower the threshold</b> if Advanced shows 80%+ Sideways or Bull/Bear rarely appears.</li>
          <li><b>Raise the threshold</b> if Sideways is near 0% or the regime flips every few bars.</li>
          <li>Longer lookbacks and more volatile assets generally need higher thresholds.</li>
        </ul>
        <div style={{ marginTop: '0.3rem' }}>
          Use the <b>Long-run base rate</b> under Advanced as the calibration check: aim for a useful mix
          of all three regimes, then keep the setting consistent when comparing tickers.
        </div>
      </div>

      {/* Advanced: full matrix + base rate + explanation */}
      {advanced && (
        <div style={{ marginTop: '0.9rem', borderTop: '1px solid var(--border)', paddingTop: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 440px', minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Transition matrix (Today&nbsp;↓ &nbsp;/&nbsp; Next&nbsp;→)
              </div>
              <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.78rem' }}>
                <colgroup>
                  <col style={{ width: '28%' }} />
                  {DISP.map(c => <col key={c.idx} style={{ width: '24%' }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th />
                    {DISP.map(c => (
                      <th key={c.idx} scope="col" style={{ padding: '2px 10px', textAlign: 'right', color: c.color }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DISP.map(r => (
                    <tr key={r.idx}>
                      <td style={{ padding: '2px 8px', color: r.color, fontWeight: 600 }}>{r.label}</td>
                      {DISP.map(c => {
                        const isDiag = r.idx === c.idx
                        const isCurRow = r.idx === currentRegime
                        return (
                          <td key={c.idx}
                            title={`P(${c.label} next | ${r.label} today) = ${pct(matrix[r.idx][c.idx])}`}
                            style={{
                              padding: '2px 10px', textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: isDiag ? 'var(--text)' : 'var(--text-muted)',
                              fontWeight: isDiag ? 700 : 400,
                              background: isCurRow ? 'var(--surface-sunken)' : 'transparent',
                            }}>
                            {pct(matrix[r.idx][c.idx])}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 4 }}>
                Each row sums to 100%. The highlighted row is today’s regime. The diagonal is persistence.
              </div>
            </div>

            <div style={{ maxWidth: 320 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Long-run base rate
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text)' }}>
                {DISP.map(d => (
                  <span key={d.idx} style={{ marginRight: '0.8rem' }}>
                    <b style={{ color: d.color }}>{d.label}</b> {pct(stationary[d.idx])}
                  </span>
                ))}
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.45, marginTop: '0.6rem' }}>
                Where price spends its time over the long run if these transition odds hold — a base
                rate, <em>not</em> a forecast. Compare it to the “what usually comes next” bars above.
              </p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', lineHeight: 1.45, marginTop: '0.5rem' }}>
                <b>How it works:</b> each bar is labelled Bull / Bear / Sideways by the log-return over
                the lookback vs ±threshold. We count how often each regime follows another to build the
                matrix, then raise it to a high power to get the base rate.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
