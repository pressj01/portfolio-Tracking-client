import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useProfileFetch } from '../context/ProfileContext'
import { formatMoney } from '../utils/money'

const STATUS_LABEL = {
  resolved: 'Resolved',
  manual: 'Defined by hand',
  self: 'Individual security',
  cash: 'Cash / money market',
  unresolved: 'Needs definition',
}

const STATUS_COLOR = {
  resolved: 'var(--pos)',
  manual: 'var(--accent)',
  self: 'var(--text-muted)',
  cash: 'var(--text-muted)',
  unresolved: 'var(--neg-strong)',
}

const ASSET_CLASSES = [
  'Equity', 'Fixed Income', 'Commodities', 'Digital Assets',
  'Real Estate', 'Cash & Equivalents', 'Private', 'Other',
]

function blankRow() {
  return { symbol: '', name: '', weight_pct: '' }
}

/** Editor for one fund: either its constituents, or its economic exposure. */
function FundEditor({ ticker, onClose, onSaved }) {
  const pf = useProfileFetch()
  const [tab, setTab] = useState('holdings')
  const [holdings, setHoldings] = useState([blankRow()])
  const [exposure, setExposure] = useState([{ symbol: '', name: '', exposure_pct: '', asset_class: 'Equity' }])
  const [meta, setMeta] = useState(null)
  const [suggested, setSuggested] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    setLoading(true)
    pf(`/api/diversification/fund/${ticker}`)
      .then(r => r.json())
      .then(d => {
        setMeta(d.meta)
        const manual = (d.holdings || []).filter(h => h.source === 'manual')
        const seedRows = manual.length ? manual : (d.holdings || [])
        setHoldings(seedRows.length
          ? seedRows.map(h => ({ symbol: h.symbol || '', name: h.name || '', weight_pct: h.weight_pct ?? '' }))
          : [blankRow()])
        setExposure((d.exposure || []).length
          ? d.exposure.map(e => ({
              symbol: e.symbol || '', name: e.name || '',
              exposure_pct: e.exposure_pct ?? '', asset_class: e.asset_class || 'Equity',
            }))
          : [{ symbol: '', name: '', exposure_pct: '', asset_class: 'Equity' }])
        if ((d.exposure || []).length && !manual.length) setTab('exposure')
        // Nothing on file at all: start from the index the fund's name names
        // (OVS "Small Cap Equity" -> a small-cap ETF). Filled in, not saved.
        if (seedRows.length || (d.exposure || []).length) return null
        return pf(`/api/diversification/suggest/${ticker}`)
          .then(r => r.json())
          .then(s => {
            if (!s.suggestion?.rows?.length) return
            setHoldings(s.suggestion.rows.map(h => ({
              symbol: h.symbol || '', name: h.name || '', weight_pct: h.weight_pct ?? '',
            })))
            setSuggested(s.suggestion)
          })
          .catch(() => {})
      })
      .catch(() => setMsg('Could not load this fund.'))
      .finally(() => setLoading(false))
  }, [pf, ticker])

  const rows = tab === 'holdings' ? holdings : exposure
  const setRows = tab === 'holdings' ? setHoldings : setExposure
  const pctKey = tab === 'holdings' ? 'weight_pct' : 'exposure_pct'

  const total = useMemo(
    () => rows.reduce((a, r) => a + (parseFloat(r[pctKey]) || 0), 0),
    [rows, pctKey],
  )

  const update = (i, key, val) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(prev => [...prev, tab === 'holdings'
    ? blankRow()
    : { symbol: '', name: '', exposure_pct: '', asset_class: 'Equity' }])
  const removeRow = (i) => setRows(prev => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))

  const save = () => {
    setSaving(true); setMsg(null)
    const url = tab === 'holdings'
      ? `/api/diversification/fund/${ticker}`
      : `/api/diversification/exposure/${ticker}`
    const body = tab === 'holdings'
      ? { holdings: rows.filter(r => r.name || r.symbol) }
      : { exposure: rows.filter(r => r.name || r.symbol) }
    pf(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setMsg(d.error || 'Save failed.'); return }
        setMsg(`Saved ${d.saved} row${d.saved === 1 ? '' : 's'}.`)
        setSuggested(null)
        onSaved?.()
      })
      .catch(e => setMsg('Save failed: ' + e.message))
      .finally(() => setSaving(false))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '3vh 1rem',
    }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 780, width: '100%', margin: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>{ticker}</h2>
          {meta?.status && (
            <span style={{ color: STATUS_COLOR[meta.status], fontSize: '0.8rem' }}>
              {STATUS_LABEL[meta.status] || meta.status}
              {meta.source ? ` · ${meta.source}` : ''}
            </span>
          )}
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', margin: '0.9rem 0' }}>
          <button className={`btn btn-sm ${tab === 'holdings' ? 'btn-active' : ''}`} onClick={() => setTab('holdings')}>
            Constituents
          </button>
          <button className={`btn btn-sm ${tab === 'exposure' ? 'btn-active' : ''}`} onClick={() => setTab('exposure')}>
            Economic exposure
          </button>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          {tab === 'holdings'
            ? 'What this fund holds, as percentages of the fund. Anything you leave unaccounted for stays in the Undisclosed slice. Hand-entered rows are never overwritten by a refresh.'
            : 'Use this when the filed holdings misrepresent the fund — an option-income fund holding Treasury bills plus gold options is economically Gold, not cash. This is what the Diversification page uses in Economic exposure mode.'}
        </p>

        {loading ? <div>Loading…</div> : (
          <>
            {suggested && tab === 'holdings' && (
              <div className="alert alert-info" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                <strong>Suggested from the fund&apos;s name.</strong> &ldquo;{suggested.from_name}&rdquo;
                reads as a {suggested.index} fund, so{' '}
                {suggested.rows.map(r => r.symbol).join(', ')} stands in for it at 100%. Nothing is
                saved until you press Save. If the fund&apos;s fact sheet shows it holds something
                else, change the symbol or percentage first.
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              {/* Fixed layout: the column widths are honoured and Name absorbs
                  any squeeze. Auto layout took the room out of Symbol instead,
                  so in a narrower window QQQM was cut off. */}
              <table className="table" style={{
                width: '100%', fontSize: '0.85rem', tableLayout: 'fixed',
                minWidth: tab === 'exposure' ? 600 : 420,
              }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', width: 125 }}>Symbol</th>
                    <th style={{ textAlign: 'left' }}>Name</th>
                    {tab === 'exposure' && <th style={{ textAlign: 'left', width: 150 }}>Asset class</th>}
                    <th style={{ textAlign: 'right', width: 110 }}>%</th>
                    <th style={{ width: 52 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          value={r.symbol}
                          onChange={e => update(i, 'symbol', e.target.value.toUpperCase())}
                          placeholder="NVDA"
                          title={r.symbol || undefined}
                          style={{ width: '100%', padding: '0.5rem' }}
                        />
                      </td>
                      <td>
                        <input
                          value={r.name}
                          onChange={e => update(i, 'name', e.target.value)}
                          placeholder={tab === 'holdings' ? 'NVIDIA Corp' : 'Gold'}
                          style={{ width: '100%' }}
                        />
                      </td>
                      {tab === 'exposure' && (
                        <td>
                          <select
                            value={r.asset_class}
                            onChange={e => update(i, 'asset_class', e.target.value)}
                            style={{ width: '100%' }}
                          >
                            {ASSET_CLASSES.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </td>
                      )}
                      <td>
                        {/* Text, not number: the spinner arrows ate half the box,
                            and wrappers legitimately run past 100 (IJR 100.26). */}
                        <input
                          type="text" inputMode="decimal"
                          value={r[pctKey]}
                          onChange={e => update(i, pctKey, e.target.value)}
                          placeholder="100"
                          style={{ width: '100%', textAlign: 'right', padding: '0.5rem' }}
                        />
                      </td>
                      <td>
                        <button className="btn-del" onClick={() => removeRow(i)} title="Remove">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={addRow}>+ Add row</button>
              <span style={{
                color: total > 100.5 ? 'var(--neg-strong)' : 'var(--text-muted)',
                fontSize: '0.85rem',
              }}>
                Total {total.toFixed(2)}%
                {total > 100.5 && ' — over 100%'}
                {total < 99.5 && total > 0 && tab === 'holdings' &&
                  ` — remaining ${(100 - total).toFixed(2)}% stays Undisclosed`}
              </span>
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {msg && <p style={{ marginBottom: 0, color: 'var(--text-muted)' }}>{msg}</p>}
          </>
        )}
      </div>
    </div>
  )
}

/** The issuer lookup table: where each fund family publishes its holdings. */
function IssuerTable({ funds }) {
  const pf = useProfileFetch()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({})
  const [msg, setMsg] = useState(null)
  const [testing, setTesting] = useState(null)
  const [assign, setAssign] = useState({ tickers: '', issuer_key: '' })

  const load = useCallback(() => {
    pf('/api/diversification/issuers')
      .then(r => r.json())
      .then(setData)
      .catch(e => setMsg('Load failed: ' + e.message))
  }, [pf])

  useEffect(() => { load() }, [load])

  const edit = (key, field, val) =>
    setDraft(p => ({ ...p, [key]: { ...(p[key] || {}), [field]: val } }))

  const rowFor = (i) => ({ ...i, ...(draft[i.issuer_key] || {}) })

  const save = (i) => {
    const row = rowFor(i)
    setMsg(null)
    pf(`/api/diversification/issuers/${i.issuer_key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: row.label, url_template: row.url_template, parser: row.parser,
        website: row.website, enabled: row.enabled, note: row.note,
      }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setMsg(d.error || 'Save failed.'); return }
        setMsg(`Saved ${i.label}.`)
        setDraft(p => { const n = { ...p }; delete n[i.issuer_key]; return n })
        load()
      })
      .catch(e => setMsg('Save failed: ' + e.message))
  }

  // Pick a real ticker from this issuer so the test hits a fund you own.
  const testIssuer = (issuerKey) => {
    const mapped = (data?.map || []).filter(m => m.issuer_key === issuerKey).map(m => m.ticker)
    const owned = funds.find(f => mapped.includes(f.ticker))
    const ticker = owned?.ticker || mapped[0]
    if (!ticker) { setMsg('No tickers mapped to this issuer yet.'); return }
    setTesting(issuerKey); setMsg(null)
    pf(`/api/diversification/issuer-test/${ticker}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => setMsg(d.ok
        ? `${ticker}: ${d.rows} holdings, ${d.coverage_pct}% covered via ${d.parser}.`
        : `${ticker}: ${d.error || 'no data'}`))
      .catch(e => setMsg('Test failed: ' + e.message))
      .finally(() => setTesting(null))
  }

  const saveAssign = () => {
    const tickers = assign.tickers.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    if (!tickers.length) { setMsg('Enter at least one ticker.'); return }
    pf('/api/diversification/issuer-map', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, issuer_key: assign.issuer_key }),
    })
      .then(r => r.json())
      .then(d => {
        setMsg(d.ok
          ? `${assign.issuer_key ? 'Mapped' : 'Cleared'} ${d.updated} ticker(s).`
          : (d.error || 'Failed.'))
        setAssign({ tickers: '', issuer_key: '' })
        load()
      })
      .catch(e => setMsg('Failed: ' + e.message))
  }

  if (!data) return <div className="card">Loading issuers…</div>

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Holdings sources by fund family</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.87rem', maxWidth: '78ch' }}>
          Where each family publishes its holdings. Nothing here is compiled in — add a
          family or fix a URL and the next refresh uses it. Use <code>{'{ticker}'}</code> or{' '}
          <code>{'{ticker_lower}'}</code> in the URL. <strong>Test</strong> fetches a fund you
          actually own and reports what came back, so you can validate a URL before running a
          full refresh. Rows with no URL are families whose sites render holdings in
          JavaScript — those need a published file, or hand entry on the Funds tab.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Family</th>
                <th style={{ textAlign: 'left', minWidth: 300 }}>Holdings URL template</th>
                <th style={{ textAlign: 'left' }}>Format</th>
                <th style={{ textAlign: 'right' }}>Tickers</th>
                <th style={{ textAlign: 'center' }}>On</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.issuers.map(i => {
                const row = rowFor(i)
                const dirty = !!draft[i.issuer_key]
                return (
                  <tr key={i.issuer_key}>
                    <td style={{ fontWeight: 600 }}>
                      {i.label}
                      <div style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>
                        {i.issuer_key}
                      </div>
                    </td>
                    <td>
                      <input
                        value={row.url_template || ''}
                        onChange={e => edit(i.issuer_key, 'url_template', e.target.value)}
                        placeholder="https://issuer.com/holdings/{ticker}.csv"
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.76rem' }}
                      />
                      {i.note && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 2 }}>
                          {i.note}
                        </div>
                      )}
                    </td>
                    <td>
                      <select
                        value={row.parser}
                        onChange={e => edit(i.issuer_key, 'parser', e.target.value)}
                        style={{ fontSize: '0.78rem' }}
                      >
                        {data.parsers.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>{i.ticker_count}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!row.enabled}
                        onChange={e => edit(i.issuer_key, 'enabled', e.target.checked)}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => testIssuer(i.issuer_key)}
                        disabled={testing === i.issuer_key}
                      >
                        {testing === i.issuer_key ? '…' : 'Test'}
                      </button>{' '}
                      <button
                        className={`btn btn-sm ${dirty ? 'btn-primary' : ''}`}
                        onClick={() => save(i)}
                        disabled={!dirty}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {msg && <p style={{ marginBottom: 0, color: 'var(--text-muted)' }}>{msg}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Assign tickers to a family</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          Paste one or more tickers and pick the family that publishes them. Leave the family
          blank to unmap.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={assign.tickers}
            onChange={e => setAssign(a => ({ ...a, tickers: e.target.value }))}
            placeholder="TDAQ, TSPY, TMGN"
            style={{ flex: '1 1 260px' }}
          />
          <select
            value={assign.issuer_key}
            onChange={e => setAssign(a => ({ ...a, issuer_key: e.target.value }))}
          >
            <option value="">— unmap —</option>
            {data.issuers.map(i => (
              <option key={i.issuer_key} value={i.issuer_key}>{i.label}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={saveAssign}>Apply</button>
        </div>
      </div>
    </>
  )
}

/** The page's hidden help, opened from "How this works". */
function FundDefinitionsQuickHelp() {
  return (
    <div className="alert alert-info" style={{ marginBottom: '1rem', lineHeight: 1.55, fontSize: '0.88rem' }}>
      <h3 style={{ marginTop: 0 }}>How Fund Definitions works</h3>
      <p>
        The <Link to="/diversification">Diversification</Link> X-Ray looks through every fund to the
        companies inside it. It finds those holdings by itself, from the fund issuer&apos;s own site
        first, then public holdings tables, Yahoo and the fund&apos;s SEC filings. This page shows what
        it found for each position, and lets you fill in the funds nothing could open.
      </p>
      <ul style={{ paddingLeft: '1.35rem', marginBottom: '0.75rem' }}>
        <li><strong>New positions are looked up for you.</strong> A fund bought since the last lookup
          shows <em>Looking up…</em> while this page asks its sources. Only a fund that still has no
          data afterwards lands in <em>Needs definition</em>.</li>
        <li><strong>Filters:</strong> <em>Needs definition</em> means no holdings data at all.{' '}
          <em>Partial coverage</em> means found, but under 90% of the fund is named, usually an issuer
          that publishes only a top 10. <em>Hand-defined</em> is everything you entered.
          The list runs largest position first, so the top rows move the chart most.</li>
        <li><strong>Define</strong> opens the editor. On <em>Constituents</em>, enter one row per
          holding as a percentage of the fund. If the fund simply holds another ETF (OVS holds IJR,
          OVQ holds QQQM), enter that ETF&apos;s symbol at its weight. The look-through then opens that
          ETF into its companies, so the definition stays current by itself.</li>
        <li><strong>Suggested definitions:</strong> when nothing is on file and the fund&apos;s name
          names an index (Nasdaq-100, S&amp;P 500, small-cap…), the editor fills in an ETF that
          tracks that index at 100%. That is only a starting point. It is not saved until you press
          Save, so check it against the fund&apos;s fact sheet first. Names that signal a tilt or a
          multiple (value, dividend, a sector, 2x) get no suggestion.</li>
        <li><strong>Leaving part of a fund out is fine.</strong> Whatever your rows do not account for
          stays in the Undisclosed slice. It is never spread across the rest, so entering only a top
          10 still helps.</li>
        <li><strong>Economic exposure</strong> is for funds whose filed holdings misstate what they do.
          An option-income fund that holds T-bills plus gold options is economically gold, not cash.
          The Diversification page uses this in its Economic exposure mode.</li>
        <li><strong>Your entries always win.</strong> A refresh never overwrites a hand definition.
          To hand a fund back to the automatic sources, clear its rows and press Save.</li>
        <li><strong>Holdings sources</strong> (the second tab) lists where each fund family publishes
          its holdings. Fix a URL or assign tickers to a family there, and use Test to check it.</li>
      </ul>
    </div>
  )
}

export default function FundDefinitions() {
  const pf = useProfileFetch()
  const [funds, setFunds] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filter, setFilter] = useState('needs')
  const [tab, setTab] = useState('funds')
  const [error, setError] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  // The resolve job's status while positions never looked up are being looked up.
  const [lookup, setLookup] = useState(null)
  const lookupTried = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    pf('/api/diversification/funds')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setFunds(d.funds || [])
        setTotal(d.total_value || 0)
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }, [pf])

  useEffect(() => { load() }, [load])

  // A position with no lookup on file was bought since the last resolve, so
  // "Needs definition" would be premature: OVS and OVQ sat there although
  // their issuer publishes complete holdings. Look them up once per visit.
  useEffect(() => {
    if (loading || lookupTried.current || lookup?.running) return
    const unchecked = funds.filter(f => f.never_checked).map(f => f.ticker)
    if (!unchecked.length) return
    lookupTried.current = true
    pf('/api/diversification/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false, tickers: unchecked }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setLookup({ running: true, done: 0, total: d.total }); return }
        // Another resolve is already running (the Diversification page's):
        // wait for it, then try again for anything it did not cover.
        if (d.job?.running) {
          lookupTried.current = false
          setLookup({ ...d.job, running: true })
        }
      })
      .catch(() => {})
  }, [funds, loading, lookup?.running, pf])

  useEffect(() => {
    if (!lookup?.running) return undefined
    const id = setInterval(() => {
      pf('/api/diversification/refresh/status')
        .then(r => r.json())
        .then(s => {
          setLookup(s)
          if (!s.running) { clearInterval(id); load() }
        })
        .catch(() => clearInterval(id))
    }, 1500)
    return () => clearInterval(id)
  }, [lookup?.running, pf, load])

  const visible = useMemo(() => {
    if (filter === 'needs') return funds.filter(f => f.status === 'unresolved')
    if (filter === 'partial') return funds.filter(f => f.status === 'resolved' && (f.coverage_pct ?? 0) < 90)
    if (filter === 'manual') return funds.filter(f => f.is_manual || f.has_exposure)
    return funds
  }, [funds, filter])

  const needsValue = useMemo(
    () => funds.filter(f => f.status === 'unresolved' && !f.never_checked)
      .reduce((a, f) => a + f.value, 0),
    [funds],
  )
  const lookingUp = !!lookup?.running

  return (
    <div className="page">
      <h1>Fund Definitions</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: '-0.5rem', maxWidth: '72ch' }}>
        Funds the automatic sources cannot open up — mutual funds and newer ETFs mostly.
        Define what they hold here and they join the{' '}
        <Link to="/diversification">Diversification</Link> look-through. Hand-entered
        definitions are never overwritten by a refresh.
      </p>
      <button
        type="button"
        className="btn btn-sm"
        style={{ marginBottom: '1rem' }}
        onClick={() => setShowHelp(v => !v)}
        aria-expanded={showHelp}
      >
        {showHelp ? 'Hide help' : 'How this works'}
      </button>

      {showHelp && <FundDefinitionsQuickHelp />}

      {error && <div className="card" style={{ color: 'var(--neg-strong)' }}>{error}</div>}

      <div className="card" style={{ display: 'flex', gap: '0.4rem' }}>
        <button className={`btn btn-sm ${tab === 'funds' ? 'btn-active' : ''}`} onClick={() => setTab('funds')}>
          Funds
        </button>
        <button className={`btn btn-sm ${tab === 'issuers' ? 'btn-active' : ''}`} onClick={() => setTab('issuers')}>
          Holdings sources
        </button>
      </div>

      {tab === 'issuers' && <IssuerTable funds={funds} />}

      {tab === 'funds' && (
      <>
      <div className="card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {[
            ['needs', 'Needs definition'],
            ['partial', 'Partial coverage'],
            ['manual', 'Hand-defined'],
            ['all', 'All'],
          ].map(([k, label]) => (
            <button
              key={k}
              className={`btn btn-sm ${filter === k ? 'btn-active' : ''}`}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginLeft: 'auto' }}>
          {formatMoney(needsValue, { decimals: 0 })} undefined
          {total ? ` · ${(100 * needsValue / total).toFixed(1)}% of portfolio` : ''}
        </span>
      </div>

      {lookingUp && (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: '0.87rem' }}>
          Looking up holdings for positions bought since the last lookup
          {lookup.total ? ` — ${lookup.done || 0} of ${lookup.total}` : ''}
          {lookup.current ? ` (${lookup.current})` : ''}…
        </div>
      )}

      {loading && <div className="card">Loading…</div>}

      {!loading && (
        <div className="card">
          {visible.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nothing in this view.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.87rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Ticker</th>
                    <th style={{ textAlign: 'right' }}>Value</th>
                    <th style={{ textAlign: 'right' }}>% of portfolio</th>
                    <th style={{ textAlign: 'left' }}>Type</th>
                    <th style={{ textAlign: 'left' }}>Status</th>
                    <th style={{ textAlign: 'right' }}>Coverage</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(f => (
                    <tr key={f.ticker}>
                      <td style={{ fontWeight: 700 }}>{f.ticker}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(f.value, { decimals: 0 })}</td>
                      <td style={{ textAlign: 'right' }}>{f.portfolio_pct.toFixed(2)}%</td>
                      <td style={{ color: 'var(--text-muted)' }}>{f.security_type || '—'}</td>
                      <td style={{
                        color: f.never_checked ? 'var(--text-muted)' : (STATUS_COLOR[f.status] || 'inherit'),
                      }}>
                        {f.never_checked
                          ? (lookingUp ? 'Looking up…' : 'Not looked up yet')
                          : (STATUS_LABEL[f.status] || f.status)}
                        {f.has_exposure && (
                          <span style={{ color: 'var(--accent)', fontSize: '0.75rem' }}> · exposure set</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {f.status === 'unresolved' ? '—' : `${(f.coverage_pct ?? 0).toFixed(1)}%`}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {/* Defining a fund mid-lookup would pin a guess over the
                            issuer's real holdings: hand entries always win. */}
                        <button
                          className="btn btn-sm"
                          onClick={() => setEditing(f.ticker)}
                          disabled={f.never_checked && lookingUp}
                        >
                          {f.status === 'unresolved' ? 'Define' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {editing && (
        <FundEditor
          ticker={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
