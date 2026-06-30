import React, { useEffect, useState } from 'react'

// Plain-English Markov regime panel for the Stock & ETF Analysis "Markov" tab.
// Default view answers "what regime are we in and what usually comes next?".
// An Advanced expander shows the full transition matrix + long-run base rate
// for users who want the underlying numbers.
//
// Regime index map matches src/utils/markov.js: 0 = Bear, 1 = Sideways, 2 = Bull.

const pct = (v) => `${Math.round((v || 0) * 100)}%`
const signedPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const WINDOW_MIN = 5
const WINDOW_MAX = 250
const THRESHOLD_MIN = 0.5
const THRESHOLD_MAX = 50
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

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
  const [windowInput, setWindowInput] = useState(String(windowBars))
  const [thresholdInput, setThresholdInput] = useState(String(thr))

  useEffect(() => { setWindowInput(String(windowBars)) }, [windowBars])
  useEffect(() => { setThresholdInput(String(thr)) }, [thr])

  // Debounce valid typed values so replacing "5" with "50" does not briefly
  // recalculate the model at the intermediate value. Blur/Enter clamps values.
  useEffect(() => {
    const parsed = Number(windowInput)
    if (!Number.isInteger(parsed) || parsed < WINDOW_MIN || parsed > WINDOW_MAX || parsed === windowBars) return undefined
    const timer = setTimeout(() => onChangeWindow(parsed), 300)
    return () => clearTimeout(timer)
  }, [windowInput, windowBars, onChangeWindow])

  useEffect(() => {
    const parsed = Number(thresholdInput)
    if (!Number.isFinite(parsed) || parsed < THRESHOLD_MIN || parsed > THRESHOLD_MAX || parsed === thr) return undefined
    const timer = setTimeout(() => onChangeThr(parsed), 300)
    return () => clearTimeout(timer)
  }, [thresholdInput, thr, onChangeThr])

  const commitWindowInput = () => {
    const parsed = Number(windowInput)
    const next = Number.isFinite(parsed)
      ? clamp(Math.round(parsed), WINDOW_MIN, WINDOW_MAX)
      : windowBars
    setWindowInput(String(next))
    if (next !== windowBars) onChangeWindow(next)
  }

  const commitThresholdInput = () => {
    const parsed = Number(thresholdInput)
    const next = Number.isFinite(parsed)
      ? clamp(parsed, THRESHOLD_MIN, THRESHOLD_MAX)
      : thr
    setThresholdInput(String(next))
    if (next !== thr) onChangeThr(next)
  }

  if (!result || !result.ok) {
    return (
      <div style={cardStyle}>
        <strong style={{ color: 'var(--accent-2)' }}>Markov Regime</strong>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: '0.4rem 0 0' }}>
          Not enough price history to model regimes. Load a longer period
          Check that the lookback and threshold are valid and load at least {windowBars + 2} price bars.
        </p>
      </div>
    )
  }

  const {
    matrix, stationary, transitionSamples = [], currentRegime, regimeName,
    currentLogReturnPct,
  } = result
  const row = matrix[currentRegime] || [1 / 3, 1 / 3, 1 / 3]
  const diag = row[currentRegime] || 0
  const stick = stickiness(diag)
  const currentSamples = transitionSamples[currentRegime] || 0

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
          Currently <b style={{ color: regimeColor(currentRegime) }}>{regimeName}</b>.{' '}
          {currentSamples > 0 ? (
            <>
              Across {currentSamples} observed {regimeName} transition{currentSamples === 1 ? '' : 's'}, the
              smoothed next-bar estimate was most often{' '}
              <b style={{ color: regimeColor(domIdx) }}>{domLabel}</b> ({pct(maxP)}).
            </>
          ) : (
            <>No observed transitions from {regimeName}; the bars show a neutral prior.</>
          )}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
        }}>
          Estimated stickiness:{' '}
          <b style={{ color: 'var(--text)' }}>{stick.label}</b> ({pct(diag)}) · {stick.note}
        </span>
      </div>

      {/* Next-bar forecast bars */}
      <div style={{ marginTop: '0.7rem' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
          Smoothed next-bar estimate (from {regimeName}, n={currentSamples})
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
        {currentSamples < 20 && (
          <div style={{ color: 'var(--warning-text)', fontSize: '0.68rem', marginTop: '0.35rem' }}>
            Limited sample: only {currentSamples} observed transition{currentSamples === 1 ? '' : 's'} from
            the current regime. Treat this estimate as low confidence.
          </div>
        )}
      </div>

      {/* Show the exact quantity being compared with the hard regime boundary. */}
      {Number.isFinite(currentLogReturnPct) && (
        <div style={{
          marginTop: '0.65rem', padding: '0.35rem 0.55rem', borderRadius: 5,
          background: 'var(--surface-sunken)', color: 'var(--text-dim)', fontSize: '0.72rem',
        }}>
          Current {windowBars}-bar log move:{' '}
          <b style={{ color: regimeColor(currentRegime) }}>{signedPct(currentLogReturnPct)}</b>
          {' '}vs ±{Number(thr).toFixed(1)}% threshold →{' '}
          <b style={{ color: regimeColor(currentRegime) }}>{regimeName}</b>.
          {Math.abs(Math.abs(currentLogReturnPct) - Number(thr)) <= Math.max(0.25, Number(thr) * 0.1) && (
            <span style={{ color: 'var(--warning-text)' }}>
              {' '}Near the boundary—small lookback or threshold changes can flip the classification.
            </span>
          )}
        </div>
      )}

      {/* Friendly controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          Lookback (bars)
          <input type="number" min={WINDOW_MIN} max={WINDOW_MAX} step={5} value={windowInput}
            onChange={e => setWindowInput(e.target.value)}
            onBlur={commitWindowInput}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setWindowInput(String(windowBars))
            }}
            title="How many bars back to measure the move that defines the regime"
            style={{ width: 80, marginTop: 2 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          Move threshold (%)
          <input type="number" min={THRESHOLD_MIN} max={THRESHOLD_MAX} step={0.5} value={thresholdInput}
            onChange={e => setThresholdInput(e.target.value)}
            onBlur={commitThresholdInput}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setThresholdInput(String(thr))
            }}
            title="A move bigger than ±this over the lookback counts as Bull / Bear; smaller is Sideways"
            style={{ width: 80, marginTop: 2 }} />
        </label>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          {PRESETS.map(p => {
            const active = p.window === windowBars && p.thr === thr
            return (
              <button key={p.label} className={`btn btn-sm${active ? ' btn-active' : ''}`}
                title={p.hint}
                onClick={() => {
                  setWindowInput(String(p.window))
                  setThresholdInput(String(p.thr))
                  onChangeWindow(p.window)
                  onChangeThr(p.thr)
                }}>
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
          The threshold is the log-return over the full lookback: above +threshold is{' '}
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
          of all three regimes, then keep the setting consistent when comparing tickers. Watch the current
          log-move readout above—hard classifications can flip when it sits near the threshold.
        </div>
      </div>

      {/* Advanced: full matrix + base rate + explanation */}
      {advanced && (
        <div style={{ marginTop: '0.9rem', borderTop: '1px solid var(--border)', paddingTop: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 440px', minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Smoothed transition matrix (Today&nbsp;↓ &nbsp;/&nbsp; Next&nbsp;→)
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
                      <td style={{ padding: '2px 8px', color: r.color, fontWeight: 600 }}>
                        {r.label}{' '}
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.66rem', fontWeight: 400 }}>
                          n={transitionSamples[r.idx] || 0}
                        </span>
                      </td>
                      {DISP.map(c => {
                        const isDiag = r.idx === c.idx
                        const isCurRow = r.idx === currentRegime
                        const sampleCount = transitionSamples[r.idx] || 0
                        return (
                          <td key={c.idx}
                            title={`Smoothed P(${c.label} next | ${r.label} today) = ${pct(matrix[r.idx][c.idx])}; n=${sampleCount} observed transitions`}
                            style={{
                              padding: '2px 10px', textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: isDiag ? 'var(--text)' : 'var(--text-muted)',
                              fontWeight: isDiag ? 700 : 400,
                              background: isCurRow ? 'var(--surface-sunken)' : 'transparent',
                              opacity: sampleCount === 0 ? 0.65 : 1,
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
                Each row sums to 100%. n is the observed transition count. A Jeffreys prior (+0.5 per
                outcome) stabilizes sparse rows; n=0 is prior-only. The diagonal is persistence.
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
                Where price spends its time over the long run if these smoothed transition odds hold — a base
                rate, <em>not</em> a forecast. Compare it to the “what usually comes next” bars above.
              </p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', lineHeight: 1.45, marginTop: '0.5rem' }}>
                <b>How it works:</b> each bar is labelled Bull / Bear / Sideways by the log-return over
                the lookback vs ±threshold. We count how often each regime follows another, apply a small
                sparse-sample adjustment, then solve the matrix’s stationary distribution for the base rate.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
