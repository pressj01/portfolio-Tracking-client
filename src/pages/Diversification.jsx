import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import ThemedPlot from '../components/ThemedPlot'
import { formatMoney } from '../utils/money'

// Distinct hues that stay legible on both themes. Cycled, so the ranked list
// and the donut always agree on a slice's colour.
const PALETTE = [
  '#7c5cff', '#4ecdc4', '#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff',
  '#ff9f45', '#c780e8', '#38bdf8', '#f472b6', '#a3e635', '#fb923c',
  '#22d3ee', '#e879f9', '#84cc16', '#f87171', '#60a5fa', '#facc15',
]
// Grey = the issuer discloses no more (a ceiling). Amber = we have nothing at
// all for this fund (fixable). They used to share a colour, which made a
// working partially-disclosed fund look identical to a broken one.
const UNDISCLOSED_COLOR = '#6b7280'
const UNDEFINED_COLOR = '#a16207'
const CASH_COLOR = '#94a3b8'
const COLLATERAL_COLOR = '#64748b'
const DERIV_COLOR = '#b45309'

function sliceColor(row, i) {
  if (row.kind === 'undisclosed') return UNDISCLOSED_COLOR
  if (row.kind === 'undefined') return UNDEFINED_COLOR
  if (row.kind === 'cash') return CASH_COLOR
  if (row.kind === 'collateral') return COLLATERAL_COLOR
  if (row.kind === 'derivative') return DERIV_COLOR
  return PALETTE[i % PALETTE.length]
}

const MUTED_KINDS = new Set(['undisclosed', 'undefined'])

const MODE_HELP = {
  economic:
    'Synthetic funds report mapped economic exposure where it can be calculated accurately. Unmapped option collateral remains visibly separate.',
  literal:
    'Every fund reports exactly what it files. Option-income funds will show their Treasury-bill collateral and option legs as-is.',
}

const COLLATERAL_HELP =
  'Fund-level cash, money-market funds, and Treasury bills reported inside derivative or financed funds. It backs those funds’ strategies and is not spendable brokerage cash. Cash-like holdings not identified as collateral appear separately under Cash & equivalents.'

export default function Diversification() {
  const pf = useProfileFetch()
  const { isDark } = useTheme()

  // Opens on the portfolio as actually held. Looking through funds to the
  // companies underneath is what the X-Ray toggle is for -- showing constituent
  // stocks by default buries the positions the user actually owns.
  const [xray, setXray] = useState(false)
  const [mode, setMode] = useState('economic')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [job, setJob] = useState(null)
  const [showFunds, setShowFunds] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    pf(`/api/diversification?xray=${xray ? 1 : 0}&mode=${mode}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setData(d)
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }, [pf, xray, mode])

  useEffect(() => { load() }, [load])

  // Poll while a resolve job is running, then reload the chart once it lands.
  useEffect(() => {
    if (!job?.running) return undefined
    const id = setInterval(() => {
      pf('/api/diversification/refresh/status')
        .then(r => r.json())
        .then(s => {
          setJob(s)
          if (!s.running) { clearInterval(id); load() }
        })
        .catch(() => clearInterval(id))
    }, 1500)
    return () => clearInterval(id)
  }, [job?.running, pf, load])

  const runRefresh = (force) => {
    setError(null)
    pf('/api/diversification/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: !!force }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setError(d.error || 'Could not start refresh.'); return }
        setJob({ running: true, done: 0, total: d.total, current: '' })
      })
      .catch(e => setError('Request failed: ' + e.message))
  }

  const rows = data?.constituents || []
  const shown = useMemo(() => rows.slice(0, 60), [rows])
  const maxPct = shown.length ? Math.max(...shown.map(r => r.weight_pct)) : 1

  const donut = useMemo(() => {
    if (!rows.length) return null
    // Everything past the top 40 becomes one slice so the ring stays readable.
    const top = rows.slice(0, 40)
    const restVal = rows.slice(40).reduce((a, r) => a + r.value, 0)
    const labels = top.map(r => r.symbol || r.name)
    const values = top.map(r => r.value)
    const colors = top.map((r, i) => sliceColor(r, i))
    if (restVal > 0) {
      labels.push(`Other (${rows.length - 40})`)
      values.push(restVal)
      colors.push('#475569')
    }
    return [{
      type: 'pie',
      hole: 0.62,
      labels,
      values,
      marker: { colors, line: { color: isDark ? '#0f1117' : '#ffffff', width: 1 } },
      textinfo: 'none',
      hovertemplate: '<b>%{label}</b><br>%{percent}<br>%{value:$,.0f}<extra></extra>',
      sort: false,
    }]
  }, [rows, isDark])

  const cov = data?.coverage
  const undisclosedPct = cov?.undisclosed_pct ?? 0
  const undefinedPct = cov?.undefined_pct ?? 0
  const collateral = rows.find(r => r.kind === 'collateral')

  return (
    <div className="page">
      <h1>Diversification</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: '-0.5rem', maxWidth: '74ch' }}>
        Your positions as held. Turn on <strong>X-Ray Funds</strong> to look through them
        to the companies underneath — three S&amp;P funds then become one NVDA slice
        rather than three fund slices.
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={xray} onChange={e => setXray(e.target.checked)} />
          <strong>X-Ray Funds</strong>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {xray ? 'looking through to constituents' : 'showing funds as held'}
          </span>
        </label>

        {xray && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Synthetic funds:</span>
            {['economic', 'literal'].map(m => (
              <button
                key={m}
                className={`btn btn-sm ${mode === m ? 'btn-active' : ''}`}
                onClick={() => setMode(m)}
                title={MODE_HELP[m]}
              >
                {m === 'economic' ? 'Economic exposure' : 'Literal holdings'}
              </button>
            ))}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Link to="/fund-definitions" className="btn btn-secondary btn-sm">
            Define funds{cov?.unresolved_funds ? ` (${cov.unresolved_funds})` : ''}
          </Link>
          <button className="btn btn-sm" onClick={() => runRefresh(false)} disabled={job?.running}>
            Resolve gaps
          </button>
          <button className="btn btn-sm" onClick={() => runRefresh(true)} disabled={job?.running}>
            Refresh all
          </button>
        </div>
      </div>

      {job?.running && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
          Resolving fund holdings… {job.done} / {job.total}
          {job.current ? ` — ${job.current}` : ''}
          <div style={{ height: 6, background: 'var(--surface-2, #22252e)', borderRadius: 3, marginTop: '0.5rem' }}>
            <div style={{
              height: '100%', borderRadius: 3, background: 'var(--accent)',
              width: `${job.total ? (100 * job.done / job.total) : 0}%`, transition: 'width .3s',
            }} />
          </div>
        </div>
      )}

      {error && <div className="card" style={{ color: 'var(--neg-strong)' }}>{error}</div>}

      {xray && collateral?.weight_pct >= 0.25 && (
        <div className="card" style={{ borderLeft: '3px solid ' + COLLATERAL_COLOR }}>
          <strong>{collateral.weight_pct.toFixed(1)}% is cash and Treasury collateral inside funds, not account cash.</strong>{' '}
          <span style={{ color: 'var(--text-muted)' }}>
            It backs options, swaps, or fund financing. The amount is kept separate because
            market-value holdings files do not always publish enough option notional or delta
            data to convert it into an accurate economic exposure.
          </span>
          {collateral.contributors?.length > 0 && (
            <div style={{ color: 'var(--text-muted)', marginTop: '0.45rem', fontSize: '0.85rem' }}>
              Largest sources: {collateral.contributors.map(c =>
                `${c.ticker} ${formatMoney(c.value, { decimals: 0 })}`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {xray && cov && (undisclosedPct + undefinedPct) >= 0.5 && (
        <div className="card" style={{ borderLeft: '3px solid ' + UNDEFINED_COLOR }}>
          <div>
            <span style={{
              display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
              background: UNDISCLOSED_COLOR, marginRight: 6,
            }} />
            <strong>{undisclosedPct.toFixed(1)}% not disclosed by the issuer.</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              Some fund families publish only their ten largest positions. Those funds
              <em> are</em> resolved — this is simply everything they choose not to report,
              charted separately instead of being spread across the names we do know.
            </span>
          </div>
          {undefinedPct >= 0.05 && (
            <div style={{ marginTop: '0.5rem' }}>
              <span style={{
                display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                background: UNDEFINED_COLOR, marginRight: 6,
              }} />
              <strong>{undefinedPct.toFixed(1)}% has no holdings data at all.</strong>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                {cov.unresolved_funds} fund{cov.unresolved_funds === 1 ? '' : 's'} — this part
                is fixable: point them at a holdings source or{' '}
                <Link to="/fund-definitions">define them by hand</Link>.
              </span>
            </div>
          )}
          <div style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Either way, every weight on this page is a floor rather than an estimate.
          </div>
        </div>
      )}

      {loading && !data && <div className="card">Loading…</div>}

      {data && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ margin: 0 }}>
              {xray ? 'Look-through holdings' : 'All holdings'}{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.9rem' }}>
                {rows.length} {xray ? 'constituents' : 'positions'} · {formatMoney(data.total_value, { decimals: 0 })}
              </span>
            </h2>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginTop: '1rem' }}>
            <div style={{ flex: '1 1 340px', minWidth: 300, maxWidth: 520 }}>
              {donut && (
                <ThemedPlot
                  data={donut}
                  layout={{
                    height: 420,
                    margin: { l: 10, r: 10, t: 10, b: 10 },
                    showlegend: false,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                />
              )}
            </div>

            <div style={{ flex: '2 1 460px', minWidth: 320 }}>
              {shown.map((r, i) => (
                <div key={r.key} style={{ marginBottom: '0.55rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                      background: sliceColor(r, i),
                    }} />
                    <span style={{
                      fontWeight: 600,
                      color: MUTED_KINDS.has(r.kind) ? 'var(--text-muted)' : 'inherit',
                    }}>
                      {r.symbol || r.name}
                    </span>
                    {r.kind === 'collateral' && (
                      <span className="dv-inline-help">
                        <button
                          type="button"
                          aria-label="What is cash and T-bill collateral?"
                          aria-describedby="dv-collateral-help"
                          title={COLLATERAL_HELP}
                        >
                          ?
                        </button>
                        <span id="dv-collateral-help" role="tooltip">
                          {COLLATERAL_HELP}
                        </span>
                      </span>
                    )}
                    {r.symbol && r.name && r.name !== r.symbol && (
                      <span style={{
                        color: 'var(--text-muted)', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.name}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {r.weight_pct < 0.01 ? '<0.01' : r.weight_pct.toFixed(r.weight_pct < 1 ? 3 : 2)}%
                    </span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 88, textAlign: 'right' }}>
                      {formatMoney(r.value, { decimals: 0 })}
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--surface-2, #22252e)', borderRadius: 2, marginTop: 3 }}>
                    <div style={{
                      height: '100%', borderRadius: 2, background: sliceColor(r, i),
                      width: `${maxPct ? (100 * r.weight_pct / maxPct) : 0}%`,
                    }} />
                  </div>
                </div>
              ))}
              {rows.length > shown.length && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Showing top {shown.length} of {rows.length}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {data?.funds?.length > 0 && (
        <div className="card">
          <button
            className="btn btn-sm"
            onClick={() => setShowFunds(v => !v)}
            style={{ marginBottom: showFunds ? '0.75rem' : 0 }}
          >
            {showFunds ? 'Hide' : 'Show'} per-fund coverage ({data.funds.length})
          </button>
          {showFunds && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Fund</th>
                    <th style={{ textAlign: 'right' }}>Value</th>
                    <th style={{ textAlign: 'left' }}>Source</th>
                    <th style={{ textAlign: 'left' }}>As of</th>
                    <th style={{ textAlign: 'left' }}>Basis</th>
                    <th style={{ textAlign: 'right' }}>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funds.map(f => (
                    <tr key={f.ticker}>
                      <td style={{ fontWeight: 600 }}>{f.ticker}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(f.value, { decimals: 0 })}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{f.source || '—'}</td>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {f.as_of || '—'}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {f.status === 'unresolved' ? 'none' : (f.mode || '—')}
                      </td>
                      <td style={{
                        textAlign: 'right',
                        color: f.coverage_pct >= 95 ? 'var(--pos)'
                          : f.coverage_pct >= 50 ? 'inherit' : 'var(--neg-strong)',
                        fontWeight: 600,
                      }}>
                        {f.status === 'unresolved'
                          ? <Link to="/fund-definitions">no data — define</Link>
                          : `${(f.coverage_pct ?? 0).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
