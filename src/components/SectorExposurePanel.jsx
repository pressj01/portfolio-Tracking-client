import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import ThemedPlot from './ThemedPlot'
import { formatMoney } from '../utils/money'

// Fixed per sector rather than cycled by rank, so a sector keeps its colour as
// weights shift and the donut, the bars and the legend always agree.
const SECTOR_COLORS = {
  'Information Technology': '#7c5cff',
  Financials: '#4ecdc4',
  'Health Care': '#ff6b6b',
  'Consumer Discretionary': '#ffd93d',
  'Communication Services': '#6bcB77',
  Industrials: '#4d96ff',
  'Consumer Staples': '#ff9f45',
  Energy: '#c780e8',
  Utilities: '#38bdf8',
  'Real Estate': '#f472b6',
  Materials: '#a3e635',
}

// Non-equity buckets read in greys and earth tones so they never look like a
// sector on the chart.
const OTHER_COLORS = {
  'Cash & equivalents': '#94a3b8',
  'Cash & T-bill collateral': '#64748b',
  'Fixed Income': '#0ea5e9',
  Commodities: '#d97706',
  'Digital Assets': '#f59e0b',
  'Options & derivatives': '#b45309',
  'Private markets': '#8b5cf6',
  Unclassified: '#6b7280',
}

const CONCENTRATION_TEXT =
  'Concentration risk is the risk that comes from having too much capital in a single company, sector, region, or asset class. Any negative event tied to that sector can affect the whole portfolio at once, because the positions inside it tend to fall together.'

const BASIS_HELP = {
  equity:
    'Sector weights are shown as a share of the equity sleeve, so the eleven sectors add to 100%. Bonds, cash, commodities and anything unclassified are excluded from the denominator and reported separately below.',
  portfolio:
    'Sector weights are shown as a share of the whole portfolio, so the eleven sectors plus the non-equity buckets add to 100%.',
}
const EMPTY_ROWS = []

function colorFor(row) {
  return SECTOR_COLORS[row.name] || OTHER_COLORS[row.name] || '#475569'
}

function pctText(value) {
  if (value === null || value === undefined) return '—'
  if (value > 0 && value < 0.01) return '<0.01%'
  return `${value.toFixed(value < 1 ? 3 : 2)}%`
}

export default function SectorExposurePanel() {
  const pf = useProfileFetch()
  const { isDark } = useTheme()

  const [mode, setMode] = useState('economic')
  const [basis, setBasis] = useState('equity')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [job, setJob] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    pf(`/api/sector-exposure?mode=${mode}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setData(d)
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }, [pf, mode])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!job?.running) return undefined
    const id = setInterval(() => {
      pf('/api/sector-exposure/refresh/status')
        .then(r => r.json())
        .then(s => {
          setJob(s)
          if (!s.running) { clearInterval(id); load() }
        })
        .catch(() => clearInterval(id))
    }, 1500)
    return () => clearInterval(id)
  }, [job?.running, pf, load])

  const runRefresh = useCallback((force) => {
    setError(null)
    pf('/api/sector-exposure/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: !!force }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setError(d.error || 'Could not start refresh.'); return }
        if (!d.total) { load(); return }
        setJob({ running: true, done: 0, total: d.total, current: '' })
      })
      .catch(e => setError('Request failed: ' + e.message))
  }, [pf, load])

  const sectors = data?.sectors || EMPTY_ROWS
  const other = data?.other || EMPTY_ROWS
  const conc = data?.concentration

  // Which number the bars and the ranked list are drawn from. Both come from
  // the backend; this only picks which denominator is on screen.
  const valueOf = useCallback(
    (row) => (basis === 'equity' && row.sector_pct != null ? row.sector_pct : row.portfolio_pct),
    [basis],
  )
  const maxPct = sectors.length ? Math.max(...sectors.map(valueOf)) : 1

  const donut = useMemo(() => {
    // A net-short bucket is a real position and stays in the list, but a pie
    // slice cannot show a negative — Plotly drops it silently, so drop it here
    // where the reason is visible.
    const rows = (basis === 'equity' ? sectors : [...sectors, ...other])
      .filter(r => r.value > 0)
    if (!rows.length) return null
    return [{
      type: 'pie',
      hole: 0.62,
      labels: rows.map(r => r.name),
      values: rows.map(r => r.value),
      marker: {
        colors: rows.map(colorFor),
        line: { color: isDark ? '#0f1117' : '#ffffff', width: 1 },
      },
      textinfo: 'none',
      hovertemplate: '<b>%{label}</b><br>%{percent}<br>%{value:$,.0f}<extra></extra>',
      sort: false,
    }]
  }, [sectors, other, basis, isDark])

  const unclassified = other.find(r => r.name === 'Unclassified')
  const cacheEmpty = !!data?.cache_empty
  const jobErrors = (!job?.running && job?.errors) || []

  return (
    <>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Show weights as:</span>
          {[['equity', 'Share of equities'], ['portfolio', 'Share of portfolio']].map(([key, label]) => (
            <button
              key={key}
              className={`btn btn-sm ${basis === key ? 'btn-active' : ''}`}
              onClick={() => setBasis(key)}
              title={BASIS_HELP[key]}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Synthetic funds:</span>
          {[['economic', 'Economic exposure'], ['literal', 'Literal holdings']].map(([key, label]) => (
            <button
              key={key}
              className={`btn btn-sm ${mode === key ? 'btn-active' : ''}`}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
          Reading sector data… {job.done} / {job.total}
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

      {cacheEmpty && !job?.running && (
        <div className="card" style={{ borderLeft: '3px solid #a16207' }}>
          <strong>Sector data has not been downloaded on this computer yet.</strong>{' '}
          <span style={{ color: 'var(--text-muted)' }}>
            Each holding's sector is read once and then cached. The first pass takes a
            couple of minutes, and funds that publish no sector breakdown are resolved
            through their constituents afterwards.
          </span>
          <div style={{ marginTop: '0.6rem' }}>
            <button className="btn btn-sm" onClick={() => runRefresh(false)}>Resolve now</button>
          </div>
        </div>
      )}

      {jobErrors.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid var(--neg-strong)' }}>
          <strong>
            The last pass could not read {jobErrors.length} securit
            {jobErrors.length === 1 ? 'y' : 'ies'}.
          </strong>
          <ul style={{
            margin: '0.4rem 0 0', paddingLeft: '1.1rem',
            color: 'var(--text-muted)', fontSize: '0.85rem',
          }}>
            {jobErrors.slice(0, 8).map((message, i) => <li key={i}>{message}</li>)}
          </ul>
          {jobErrors.length > 8 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              …and {jobErrors.length - 8} more.
            </div>
          )}
        </div>
      )}

      {loading && !data && <div className="card">Loading…</div>}

      {data && conc && (
        <div className="card">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <span style={{
                display: 'inline-block', padding: '0.15rem 0.6rem', borderRadius: 999,
                fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.7rem',
                background: conc.level === 'high' ? '#b45309'
                  : conc.level === 'moderate' ? '#a16207' : 'var(--surface-2, #22252e)',
                color: conc.level === 'low' ? 'var(--text-muted)' : '#fff',
              }}>
                {conc.level === 'high' ? 'Concentrated'
                  : conc.level === 'moderate' ? 'Somewhat concentrated' : 'Broadly spread'}
              </span>

              <h3 style={{ margin: '0 0 0.5rem' }}>Your current sector allocation</h3>
              <p style={{ color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>
                The equity side of this portfolio touches <strong>{conc.covered} of {conc.universe}</strong>{' '}
                sectors. Spread evenly that would be {conc.even_pct}% each;{' '}
                {conc.top_sector} is the largest at {conc.top_pct}% of equities.
              </p>
              {conc.overweight.length > 0 && (
                <p style={{ color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>
                  {conc.overweight.length} sector{conc.overweight.length === 1 ? ' carries' : 's carry'}{' '}
                  more than double an even share:{' '}
                  {conc.overweight.map(o => `${o.name} (${o.times_even}×)`).join(', ')}.
                </p>
              )}
              <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.88rem' }}>
                {data.equity_pct.toFixed(1)}% of the portfolio is equity and carries a sector.
                The remaining {data.non_equity_pct.toFixed(1)}% is bonds, cash, commodities and
                anything that could not be identified — listed separately below, never folded
                into a sector.
              </p>
            </div>

            <div style={{ flex: '1 1 300px', minWidth: 260, maxWidth: 420 }}>
              {donut && (
                <ThemedPlot
                  data={donut}
                  layout={{ height: 320, margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: false }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="card">
          <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>Concentration risk</strong> {CONCENTRATION_TEXT}
          </p>

          <h3 style={{ margin: '0 0 0.25rem' }}>Sector weights</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
            {BASIS_HELP[basis]} Select a sector to see which holdings put you there.
          </p>

          {sectors.length === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              No sector could be determined yet — run <strong>Resolve gaps</strong> above.
            </p>
          )}

          {sectors.map(row => {
            const isOpen = expanded === row.name
            const shown = valueOf(row)
            return (
              <div key={row.name} style={{ marginBottom: '0.7rem' }}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : row.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'inherit', font: 'inherit', textAlign: 'left',
                  }}
                  aria-expanded={isOpen}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: colorFor(row),
                  }} />
                  <span style={{ fontWeight: 600 }}>{row.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {row.contributors.length} holding{row.contributors.length === 1 ? '' : 's'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {pctText(shown)}
                  </span>
                  <span style={{
                    color: 'var(--text-muted)', whiteSpace: 'nowrap',
                    minWidth: 92, textAlign: 'right',
                  }}>
                    {formatMoney(row.value, { decimals: 0 })}
                  </span>
                  <span style={{ color: 'var(--text-muted)', width: 12, textAlign: 'center' }}>
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>

                <div style={{ height: 5, background: 'var(--surface-2, #22252e)', borderRadius: 2, marginTop: 4 }}>
                  <div style={{
                    height: '100%', borderRadius: 2, background: colorFor(row),
                    width: `${maxPct ? (100 * shown / maxPct) : 0}%`,
                  }} />
                </div>

                {isOpen && (
                  <div style={{
                    marginTop: '0.55rem', paddingLeft: '1.1rem',
                    // Long attribution sentences must wrap; the surrounding row
                    // is a flex line and would otherwise run off the card.
                    whiteSpace: 'normal', color: 'var(--text-muted)', fontSize: '0.85rem',
                    lineHeight: 1.7,
                  }}>
                    <strong style={{ color: 'var(--text)' }}>
                      {row.name} is {pctText(row.portfolio_pct)} of the portfolio
                    </strong>
                    {' — '}
                    {row.direct_pct > 0 && (
                      <span>{pctText(row.direct_pct)} held directly</span>
                    )}
                    {row.direct_pct > 0 && row.contributors.some(c => !c.direct) && ' + '}
                    {row.contributors.filter(c => !c.direct).map((c, i, arr) => (
                      <span key={c.ticker}>
                        {pctText(c.portfolio_pct)} through{' '}
                        <Link to={`/security-research?ticker=${c.ticker}`}>{c.ticker}</Link>
                        {i < arr.length - 1 ? ' + ' : ''}
                      </span>
                    ))}
                    .
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {other.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.25rem' }}>Outside the sector split</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
            {data.non_equity_pct.toFixed(1)}% of the portfolio. These are not sectors — a bond
            fund, a gold position and account cash have no GICS sector, so counting them in the
            sector denominator would overstate every weight above.
            {unclassified && unclassified.portfolio_pct >= 0.5 && (
              <>
                {' '}<strong style={{ color: 'var(--text)' }}>
                  {unclassified.portfolio_pct.toFixed(1)}% is unclassified
                </strong>{' '}
                — mostly the part of a fund its issuer does not disclose. That share is a
                genuine gap, so every sector weight above is a floor rather than an estimate.
              </>
            )}
          </p>

          {other.map(row => (
            <div key={row.name} style={{ marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: colorFor(row),
                }} />
                <span style={{ fontWeight: 600 }}>{row.name}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {pctText(row.portfolio_pct)}
                </span>
                <span style={{
                  color: 'var(--text-muted)', whiteSpace: 'nowrap',
                  minWidth: 92, textAlign: 'right',
                }}>
                  {formatMoney(row.value, { decimals: 0 })}
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--surface-2, #22252e)', borderRadius: 2, marginTop: 3 }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: colorFor(row),
                  width: `${data.non_equity_pct ? (100 * row.portfolio_pct / data.non_equity_pct) : 0}%`,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.unresolved_positions > 0 && (
        <div className="card" style={{ borderLeft: '3px solid #6b7280' }}>
          <strong>
            {data.unresolved_positions} position
            {data.unresolved_positions === 1 ? '' : 's'} could not be placed in any sector.
          </strong>{' '}
          <span style={{ color: 'var(--text-muted)' }}>
            No published sector breakdown, no holdings file, and no economic exposure mapping.
            Defining them on the <Link to="/fund-definitions">Fund Definitions</Link> screen
            feeds this page too.
          </span>
        </div>
      )}
    </>
  )
}
