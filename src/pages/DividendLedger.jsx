import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ThemedPlot from '../components/ThemedPlot'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { formatMoney, formatMoneyWhole } from '../utils/money'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const money = v => formatMoney(v)
const wholeMoney = v => formatMoneyWhole(v)

function shiftMonth(ym, delta) {
  const [year, month] = ym.split('-').map(Number)
  const index = year * 12 + (month - 1) + delta
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`
}

function monthLabel(ym) {
  const [year, month] = ym.split('-').map(Number)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

function pctText(pct) {
  if (pct === null || pct === undefined) return null
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

/** A card showing one live figure with its comparison underneath. */
function FigureCard({ label, range, value, tone = 'accent', lines = [], estimated = 0 }) {
  return (
    <div className="summary-card dl-card">
      <div className="dl-card-head">
        <span className="summary-label">{label}</span>
        {range && <span className="dl-card-range">{range}</span>}
      </div>
      <div className={`summary-value dl-card-value dl-tone-${tone}`}>{money(value)}</div>
      {estimated > 0 && (
        <div className="dl-card-est" title="Part of this total is projected by the price refresh, not confirmed by a broker">
          includes {money(estimated)} projected
        </div>
      )}
      {lines.filter(Boolean).map((line, i) => (
        <div key={i} className="summary-sub dl-card-sub">{line}</div>
      ))}
    </div>
  )
}

/** Per-ticker rows for one day, used by both the Today panel and the ledger. */
function PaymentRows({ payments, showAccounts }) {
  return payments.map(p => (
    <div key={p.ticker} className="dl-pay-row">
      <span className="dl-pay-ticker">
        {p.ticker}
        {p.estimated_only && <span className="dl-est-chip" title="Projected by the price refresh — not yet confirmed by a broker">est</span>}
      </span>
      {showAccounts && (
        <span className="dl-pay-accounts">
          {p.accounts.map(a => a.account).filter((a, i, arr) => arr.indexOf(a) === i).join(', ')}
        </span>
      )}
      <span className="dl-pay-amount">{money(p.amount)}</span>
    </div>
  ))
}

export default function DividendLedger() {
  const pf = useProfileFetch()
  const { selection } = useProfile()

  const [month, setMonth] = useState(null)      // null → server picks the current month
  const [weekStart, setWeekStart] = useState(() => localStorage.getItem('divLedger_weekStart') || 'mon')
  const [includeEstimates, setIncludeEstimates] = useState(() => localStorage.getItem('divLedger_includeEstimates') !== '0')
  const [expanded, setExpanded] = useState(() => new Set())
  const [expandAll, setExpandAll] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { localStorage.setItem('divLedger_weekStart', weekStart) }, [weekStart])
  useEffect(() => { localStorage.setItem('divLedger_includeEstimates', includeEstimates ? '1' : '0') }, [includeEstimates])

  const fetchLedger = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ week_start: weekStart, include_estimates: includeEstimates ? '1' : '0' })
    if (month) params.set('month', month)
    pf(`/api/dividend-ledger?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
        setExpanded(new Set())
      })
      .catch(e => setError(e.message || 'Could not load the payment ledger'))
      .finally(() => setLoading(false))
  }, [month, weekStart, includeEstimates, selection, pf])

  useEffect(() => { fetchLedger() }, [fetchLedger])

  const viewMonth = data?.month || month
  const now = data?.now
  const summary = data?.month_summary
  // Owner is a plain profile selection but still reads several accounts, so the
  // per-account split follows the scope the server resolved, not the selector.
  const scope = data?.scope
  const showAccounts = !!scope?.multi_account
  const accountRows = useMemo(
    () => (summary?.by_account || []).filter(a => a.total > 0),
    [summary],
  )
  const weekByStart = useMemo(() => {
    const map = new Map()
    for (const w of data?.weeks || []) map.set(w.start, w)
    return map
  }, [data])

  const inMonthDays = useMemo(() => (data?.days || []).filter(d => d.in_month), [data])
  const hasEstimates = useMemo(() => inMonthDays.some(d => d.estimated > 0), [inMonthDays])

  const chart = useMemo(() => {
    if (!inMonthDays.length) return null
    const labels = inMonthDays.map(d => String(d.dom))
    const hover = inMonthDays.map(d => `${d.dow} ${d.label}`)
    const traces = [{
      name: 'Confirmed',
      x: labels,
      y: inMonthDays.map(d => d.actual),
      customdata: hover,
      type: 'bar',
      marker: { color: '#4dff91' },
      hovertemplate: '<b>%{customdata}</b><br>Confirmed: $%{y:,.2f}<extra></extra>',
    }]
    if (hasEstimates) {
      traces.push({
        name: 'Projected',
        x: labels,
        y: inMonthDays.map(d => d.estimated),
        customdata: hover,
        type: 'bar',
        marker: { color: 'rgba(249, 168, 37, 0.6)' },
        hovertemplate: '<b>%{customdata}</b><br>Projected: $%{y:,.2f}<extra></extra>',
      })
    }
    traces.push({
      name: 'Month to date',
      x: labels,
      y: inMonthDays.map(d => d.month_to_date),
      customdata: hover,
      type: 'scatter',
      mode: 'lines',
      yaxis: 'y2',
      line: { color: '#7ecfff', width: 2 },
      hovertemplate: '<b>%{customdata}</b><br>Month to date: $%{y:,.2f}<extra></extra>',
    })
    return {
      traces,
      layout: {
        barmode: 'stack',
        hovermode: 'x unified',
        xaxis: { title: `Day of ${summary?.short_label || 'month'}`, type: 'category' },
        yaxis: { title: 'Paid ($)', tickprefix: '$', rangemode: 'tozero' },
        yaxis2: {
          title: 'Month to date ($)',
          tickprefix: '$',
          overlaying: 'y',
          side: 'right',
          rangemode: 'tozero',
          showgrid: false,
        },
        margin: { t: 20, b: 55, l: 70, r: 75 },
        legend: { orientation: 'h', y: -0.2 },
        showlegend: true,
      },
    }
  }, [inMonthDays, hasEstimates, summary])

  const toggleDay = useCallback(date => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }, [])

  const isOpen = day => expandAll ? day.total > 0 : expanded.has(day.date)
  const atCurrentMonth = !!(now && viewMonth === now.month.month)

  return (
    <div className="page dashboard dl-page">
      <h1>Daily, Weekly &amp; Monthly Payments</h1>
      <p className="dl-intro">
        What your holdings actually paid, day by day. Each day&apos;s payments push the week-to-date
        and month-to-date totals up; a day with nothing paid leaves both where they were.
        {showAccounts && (
          <> Every figure is the sum of {scope.accounts.length} accounts:{' '}
            {scope.accounts.map(a => a.account).join(', ')}.</>
        )}
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="dl-loading"><span className="spinner" /></div>}

      {now && (
        <>
          {/* ── Live figures, always as of today ─────────────────────────── */}
          <div className="summary-strip dl-strip">
            <FigureCard
              label="Paid today"
              range={`${now.dow}, ${now.label}`}
              value={now.day.total}
              tone={now.day.total > 0 ? 'pos' : 'dim'}
              estimated={now.day.estimated}
              lines={[
                now.day.total > 0
                  ? `${now.day.ticker_count} ${now.day.ticker_count === 1 ? 'holding' : 'holdings'} paid`
                  : 'Nothing paid yet today',
                now.day.prior_week_same_day > 0
                  ? `Same day last week: ${money(now.day.prior_week_same_day)}`
                  : null,
              ]}
            />
            <FigureCard
              label="Week to date"
              range={now.week.label}
              value={now.week.total}
              estimated={now.week.estimated}
              lines={[
                `Day ${now.week.days_elapsed} of 7 · ${now.week.paid_days} paying ${now.week.paid_days === 1 ? 'day' : 'days'}`,
                now.week.prior_to_same_day > 0
                  ? `${pctText(Math.round((now.week.total - now.week.prior_to_same_day) / now.week.prior_to_same_day * 1000) / 10)} vs the same point last week`
                  : `Last week's full total: ${money(now.week.prior_total)}`,
              ]}
            />
            <FigureCard
              label="Month to date"
              range={now.month.label}
              value={now.month.total}
              estimated={now.month.estimated}
              lines={[
                `Day ${now.month.days_elapsed} of ${now.month.days_total} · ${now.month.paid_days} paying ${now.month.paid_days === 1 ? 'day' : 'days'}`,
                now.month.prior_to_same_day > 0
                  ? `${pctText(Math.round((now.month.total - now.month.prior_to_same_day) / now.month.prior_to_same_day * 1000) / 10)} vs ${now.month.prior_label} at this point`
                  : `${now.month.prior_label} total: ${money(now.month.prior_total)}`,
              ]}
            />
            <FigureCard
              label={`${now.year.label} to date`}
              value={now.year.total}
              estimated={now.year.estimated}
              lines={[
                `${now.year.paid_days} paying days · ${now.year.ticker_count} holdings`,
                now.year.prior_to_same_day > 0
                  ? `${money(now.year.prior_to_same_day)} by this date in ${now.year.prior_label}`
                  : null,
              ]}
            />
          </div>

          {/* ── Today in detail ──────────────────────────────────────────── */}
          <div className="card dl-today">
            <div className="dl-today-head">
              <h2>Today &middot; {now.dow}, {now.label}</h2>
              <span className="dl-today-total">{money(now.day.total)}</span>
            </div>
            {now.day.payments.length > 0 ? (
              <div className="dl-pay-list">
                <PaymentRows payments={now.day.payments} showAccounts={showAccounts} />
              </div>
            ) : (
              <p className="dl-empty">
                No dividends recorded today.
                {now.last_paid && (
                  <> Last payment was <strong>{money(now.last_paid.total)}</strong> on {now.last_paid.dow}, {now.last_paid.label}
                    {' '}({now.last_paid.days_ago} {now.last_paid.days_ago === 1 ? 'day' : 'days'} ago) across {now.last_paid.ticker_count}
                    {' '}{now.last_paid.ticker_count === 1 ? 'holding' : 'holdings'}.</>
                )}
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Month browser ──────────────────────────────────────────────── */}
      {data && (
        <div className="dl-controls">
          <div className="dl-month-nav">
            <button className="btn btn-sm" onClick={() => setMonth(shiftMonth(viewMonth, -1))} title="Previous month">‹</button>
            <select
              className="dl-month-select"
              value={viewMonth}
              onChange={e => setMonth(e.target.value)}
            >
              {(() => {
                const options = new Set(data.months_available)
                options.add(viewMonth)
                if (now) options.add(now.month.month)
                return [...options].sort().reverse().map(ym => (
                  <option key={ym} value={ym}>{monthLabel(ym)}</option>
                ))
              })()}
            </select>
            <button className="btn btn-sm" onClick={() => setMonth(shiftMonth(viewMonth, 1))} title="Next month">›</button>
            {!atCurrentMonth && (
              <button className="btn btn-sm btn-secondary" onClick={() => setMonth(null)}>This month</button>
            )}
          </div>

          <div className="dl-control-group">
            <label>Week starts</label>
            <div className="dl-toggle">
              {[['mon', 'Monday'], ['sun', 'Sunday']].map(([value, text]) => (
                <button
                  key={value}
                  className={`btn btn-sm${weekStart === value ? ' btn-active' : ''}`}
                  onClick={() => setWeekStart(value)}
                >{text}</button>
              ))}
            </div>
          </div>

          <label className="dl-check" title="Rows the price refresh projected because no broker feed has confirmed them yet">
            <input type="checkbox" checked={includeEstimates} onChange={e => setIncludeEstimates(e.target.checked)} />
            Include projected payments
          </label>

          <label className="dl-check">
            <input type="checkbox" checked={expandAll} onChange={e => setExpandAll(e.target.checked)} />
            Show every payment
          </label>
        </div>
      )}

      {summary && (
        <>
          {/* ── Selected month at a glance ──────────────────────────────── */}
          <div className="dl-month-summary">
            <div className="dl-ms-main">
              <div className="summary-label">{summary.label} {summary.is_complete ? 'total' : 'so far'}</div>
              <div className="dl-ms-total">{money(summary.total)}</div>
              <div className="dl-ms-meta">
                {summary.paid_days} of {summary.is_complete ? summary.days_in_month : summary.days_elapsed} days paid
                {summary.ticker_count > 0 && ` · ${summary.ticker_count} holdings`}
                {summary.estimated > 0 && ` · ${money(summary.estimated)} projected`}
              </div>
            </div>
            <div className="dl-ms-facts">
              {summary.best_day && (
                <div className="dl-ms-fact">
                  <span className="dl-ms-fact-label">Biggest day</span>
                  <span className="dl-ms-fact-value">{money(summary.best_day.total)}</span>
                  <span className="dl-ms-fact-note">{summary.best_day.dow}, {summary.best_day.label}</span>
                </div>
              )}
              <div className="dl-ms-fact">
                <span className="dl-ms-fact-label">Average paying day</span>
                <span className="dl-ms-fact-value">{money(summary.avg_per_paid_day)}</span>
                <span className="dl-ms-fact-note">{wholeMoney(summary.avg_per_elapsed_day)}/day across the month</span>
              </div>
              <div className="dl-ms-fact">
                <span className="dl-ms-fact-label">vs {summary.prior_month.label}</span>
                <span className={`dl-ms-fact-value ${summary.vs_prior_pct === null ? '' : summary.vs_prior_pct >= 0 ? 'dl-up' : 'dl-down'}`}>
                  {summary.vs_prior_pct === null ? '—' : pctText(summary.vs_prior_pct)}
                </span>
                <span className="dl-ms-fact-note">
                  {money(summary.prior_month.to_same_day)}
                  {summary.prior_month.basis === 'same days' ? ' over the same days' : ' full month'}
                </span>
              </div>
            </div>
          </div>

          {/* ── What each account contributed ──────────────────────────── */}
          {showAccounts && accountRows.length > 0 && (
            <div className="dl-account-strip">
              <span className="dl-account-strip-label">
                {summary.short_label} by account
              </span>
              {accountRows.map(a => (
                <div key={a.profile_id} className="dl-account-chip">
                  <span className="dl-account-name">{a.account}</span>
                  <span className="dl-account-value">{money(a.total)}</span>
                  <span className="dl-account-note">
                    {a.paid_days} paying {a.paid_days === 1 ? 'day' : 'days'}
                    {summary.total > 0 && ` · ${Math.round(a.total / summary.total * 100)}%`}
                    {a.estimated > 0 && ` · ${money(a.estimated)} projected`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Daily shape of the month ────────────────────────────────── */}
          {chart && summary.total > 0 && (
            <div className="card dl-chart-card">
              <ThemedPlot
                data={chart.traces}
                layout={chart.layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: '340px' }}
                useResizeHandler
              />
            </div>
          )}

          {/* ── Week rollup ─────────────────────────────────────────────── */}
          <div className="dl-week-strip">
            {(data.weeks || []).map(w => (
              <div
                key={w.start}
                className={`dl-week-chip${w.is_current ? ' dl-week-current' : ''}${w.total === 0 ? ' dl-week-empty' : ''}`}
                title={w.spans_prior_month || w.spans_next_month
                  ? `Full week total; ${w.days_in_month} of its 7 days fall in ${summary.short_label}`
                  : `${w.paid_days} paying ${w.paid_days === 1 ? 'day' : 'days'}`}
              >
                <span className="dl-week-chip-label">
                  {w.label}
                  {w.is_current && <span className="dl-week-tag">now</span>}
                  {!w.is_current && !w.complete && <span className="dl-week-tag dl-week-tag-future">ahead</span>}
                </span>
                <span className="dl-week-chip-value">{money(w.total)}</span>
                {(w.spans_prior_month || w.spans_next_month) && (
                  <span className="dl-week-chip-note">{money(w.in_month_total)} in {summary.short_label}</span>
                )}
              </div>
            ))}
          </div>

          {/* ── The ledger ──────────────────────────────────────────────── */}
          <div className="dl-table-wrap">
            <table className="dl-table">
              <thead>
                <tr>
                  <th className="dl-col-date">Date</th>
                  <th className="dl-col-payers">Holdings</th>
                  <th className="dl-num">Paid that day</th>
                  <th className="dl-num">Week to date</th>
                  <th className="dl-num">Month to date</th>
                </tr>
              </thead>
              <tbody>
                {(data.days || []).map(day => {
                  const paid = day.total > 0
                  const open = isOpen(day)
                  const week = weekByStart.get(day.week_start)
                  const rowClass = [
                    'dl-day',
                    day.is_today ? 'dl-today-row' : '',
                    !day.in_month ? 'dl-outside' : '',
                    !paid ? 'dl-quiet' : '',
                    day.is_future ? 'dl-future' : '',
                    day.is_weekend ? 'dl-weekend' : '',
                    paid ? 'dl-clickable' : '',
                  ].filter(Boolean).join(' ')

                  return (
                    <React.Fragment key={day.date}>
                      <tr
                        className={rowClass}
                        onClick={paid ? () => toggleDay(day.date) : undefined}
                        onKeyDown={paid ? e => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDay(day.date) }
                        } : undefined}
                        tabIndex={paid ? 0 : undefined}
                        role={paid ? 'button' : undefined}
                        aria-expanded={paid ? open : undefined}
                      >
                        <td className="dl-col-date">
                          <span className="dl-caret">{paid ? (open ? '▾' : '▸') : ''}</span>
                          <span className="dl-dow">{day.dow}</span>
                          <span className="dl-date-label">{day.label}</span>
                          {day.is_today && <span className="dl-today-tag">today</span>}
                          {!day.in_month && <span className="dl-outside-tag">other month</span>}
                        </td>
                        <td className="dl-col-payers">
                          {paid ? (
                            <>
                              {day.ticker_count}
                              {day.estimated > 0 && (
                                <span className="dl-est-chip" title={`${money(day.estimated)} of this day is projected, not confirmed`}>est</span>
                              )}
                            </>
                          ) : <span className="dl-dash">—</span>}
                        </td>
                        <td className="dl-num dl-paid">{paid ? money(day.total) : <span className="dl-dash">—</span>}</td>
                        <td className={`dl-num${paid ? ' dl-running-hit' : ' dl-running-carry'}`}>{money(day.week_to_date)}</td>
                        <td className={`dl-num${!day.in_month ? ' dl-running-none' : paid ? ' dl-running-hit' : ' dl-running-carry'}`}>
                          {day.month_to_date === null ? <span className="dl-dash">—</span> : money(day.month_to_date)}
                        </td>
                      </tr>

                      {open && day.payments.map(p => (
                        <tr key={`${day.date}-${p.ticker}`} className="dl-detail">
                          <td className="dl-col-date dl-detail-ticker">
                            <span className="dl-detail-indent" />
                            {p.ticker}
                            {p.estimated_only && <span className="dl-est-chip" title="Projected by the price refresh">est</span>}
                          </td>
                          <td className="dl-col-payers dl-detail-accounts" colSpan={2}>
                            {showAccounts
                              ? p.accounts.map(a => `${a.account} ${money(a.amount)}`).join(' · ')
                              : (p.sources.join(', ') || '—')}
                          </td>
                          <td className="dl-num dl-detail-amount">{money(p.amount)}</td>
                          <td />
                        </tr>
                      ))}

                      {day.is_week_end && week && (
                        <tr className={`dl-week-row${week.is_current ? ' dl-week-row-current' : ''}`}>
                          <td className="dl-col-date">
                            Week {week.label}
                            {week.is_current && <span className="dl-week-tag">in progress</span>}
                          </td>
                          <td className="dl-col-payers">
                            {week.paid_days} {week.paid_days === 1 ? 'day' : 'days'}
                          </td>
                          <td className="dl-num">{money(week.total)}</td>
                          <td className="dl-num dl-week-row-note">
                            {week.spans_prior_month || week.spans_next_month
                              ? `${money(week.in_month_total)} in ${summary.short_label}`
                              : 'week total'}
                          </td>
                          <td />
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="dl-month-row">
                  <td className="dl-col-date">{summary.label} {summary.is_complete ? 'total' : 'to date'}</td>
                  <td className="dl-col-payers">{summary.paid_days} {summary.paid_days === 1 ? 'day' : 'days'}</td>
                  <td className="dl-num">{money(summary.total)}</td>
                  <td className="dl-num dl-week-row-note" colSpan={2}>
                    {summary.actual > 0 && summary.estimated > 0
                      ? `${money(summary.actual)} confirmed · ${money(summary.estimated)} projected`
                      : summary.estimated > 0 ? 'all projected' : 'all confirmed'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="dl-footnote">
            Week totals always cover a full seven days, so a week straddling a month boundary shows
            the adjacent days too — those rows are marked <em>other month</em> and are left out of the
            month-to-date column.
            {includeEstimates
              ? ' Amounts marked est were projected by Refresh Prices & Divs because no broker feed has confirmed them yet.'
              : ' Projected payments are hidden, so recent days may read low until a broker import lands.'}
          </p>
        </>
      )}

      {data && summary && summary.total === 0 && !loading && (
        <p className="dl-empty dl-empty-month">
          No dividend payments recorded in {summary.label}.
          {!includeEstimates && ' Projected payments are currently hidden.'}
        </p>
      )}
    </div>
  )
}
