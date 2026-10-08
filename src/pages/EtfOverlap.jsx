import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { formatMoneyWhole } from '../utils/money'

// One colour per fund, used everywhere a number belongs to that fund so the
// Venn, the drift bars and the over/underweight lists read as one legend.
const COLOR_A = '#6b7bff'
const COLOR_B = '#10b981'
const STORAGE_KEY = 'etfOverlap.lastPair'
const PAGE_SIZE = 20
// A fund this well covered is treated as complete; issuer files land a hair
// either side of 100% because of rounding, cash and short option legs.
const FULL_COVERAGE = 97
// How long to keep re-asking while per-stock sectors and industries are still
// being looked up.
const SECTOR_POLL_MS = 4000
const SECTOR_POLL_LIMIT = 6

const POPULAR_PAIRS = [
  ['SCHD', 'VOO', 'Dividend quality vs S&P 500'],
  ['SCHD', 'VIG', 'Quality vs dividend growth'],
  ['JEPI', 'JEPQ', 'Equity premium income pair'],
  ['VOO', 'QQQ', 'S&P 500 vs Nasdaq-100'],
  ['VTI', 'VOO', 'Total market vs S&P 500'],
  ['SPYI', 'QQQI', 'NEOS S&P 500 vs Nasdaq-100 income'],
]

const TEXT_COLUMNS = new Set(['symbol', 'name', 'sector', 'industry'])

const MIN_WEIGHTS = [[0, 'Any'], [0.5, '≥ 0.5%'], [1, '≥ 1%'], [2, '≥ 2%']]

const SOURCE_LABELS = {
  manual: 'entered manually',
  yahoo: 'Yahoo top holdings',
  sec_nport: 'SEC N-PORT filing',
}

function pct(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`
}

function signedPct(value, digits = 1) {
  const n = Number(value || 0)
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function loadLastPair() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && typeof saved.a === 'string' && typeof saved.b === 'string') return saved
  } catch {
    // An unreadable saved pair is the same as none.
  }
  return { a: '', b: '' }
}

// A step for the drift axis that keeps the tick labels round.
function niceCeil(value) {
  if (value <= 0) return 1
  for (const step of [1, 2, 4, 5, 10, 20, 30, 40, 50, 100]) {
    if (value <= step) return step
  }
  return Math.ceil(value / 50) * 50
}

function Venn({ a, b, onlyA, shared, onlyB }) {
  return (
    <svg viewBox="0 0 220 150" width="220" height="150" role="img"
      aria-label={`${onlyA} holdings only in ${a}, ${shared} shared, ${onlyB} only in ${b}`}>
      <circle cx="80" cy="62" r="56" fill={COLOR_A} fillOpacity="0.32" stroke={COLOR_A} strokeOpacity="0.8" />
      <circle cx="140" cy="62" r="56" fill={COLOR_B} fillOpacity="0.32" stroke={COLOR_B} strokeOpacity="0.8" />
      <g fill="var(--text-strong, var(--text))" fontWeight="700" fontSize="15" textAnchor="middle">
        <text x="48" y="67">{onlyA}</text>
        <text x="110" y="67">{shared}</text>
        <text x="172" y="67">{onlyB}</text>
      </g>
      <g fill="var(--text-muted)" fontSize="11" textAnchor="middle">
        <text x="48" y="140">{a}</text>
        <text x="110" y="140" fill="var(--text)" fontWeight="600">Shared</text>
        <text x="172" y="140">{b}</text>
      </g>
    </svg>
  )
}

// Diverging bars: left of centre is heavier in fund A, right is heavier in B.
function SectorDrift({ a, b, sectors }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)

  const scale = useMemo(
    () => niceCeil(Math.max(0, ...sectors.map(s => Math.abs(s.diff)))),
    [sectors],
  )
  const ticks = [-scale, -scale / 2, 0, scale / 2, scale]

  const onMove = (index, event) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) return
    setHover({ index, x: event.clientX - box.left, y: event.clientY - box.top, width: box.width })
  }

  const hovered = hover ? sectors[hover.index] : null
  // Keep the readout inside the card: flip it to the cursor's left near the
  // right edge, where it would otherwise be clipped.
  const tipLeft = hover && hover.x > hover.width - 240

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
        <span />
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <span style={{ color: COLOR_A }}>{a}</span>
          <span style={{ color: COLOR_B }}>{b}</span>
        </div>
      </div>

      {sectors.map((s, i) => {
        const width = Math.min(50, (Math.abs(s.diff) / scale) * 50)
        // diff is A minus B, so a positive value belongs on A's (left) side.
        const heavierA = s.diff > 0
        return (
          <div
            key={s.sector}
            onMouseMove={e => onMove(i, e)}
            style={{
              display: 'grid', gridTemplateColumns: '190px 1fr', alignItems: 'center',
              height: 34, borderRadius: 4,
              background: hover?.index === i ? 'var(--surface-2, rgba(127,127,127,0.18))' : 'transparent',
            }}
          >
            <span style={{ textAlign: 'right', paddingRight: '0.75rem', fontSize: '0.88rem', fontWeight: 600 }}>
              {s.sector}
            </span>
            <div style={{ position: 'relative', height: '100%' }}>
              {ticks.map(t => (
                <span key={t} style={{
                  position: 'absolute', top: 0, bottom: 0, left: `${50 + (t / scale) * 50}%`,
                  borderLeft: t === 0 ? '1px solid var(--text-muted)' : '1px dashed var(--border)',
                }} />
              ))}
              <span style={{
                position: 'absolute', top: 9, bottom: 9, borderRadius: 2,
                background: heavierA ? COLOR_A : COLOR_B,
                width: `${width}%`,
                left: heavierA ? `${50 - width}%` : '50%',
              }} />
            </div>
          </div>
        )
      })}

      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', marginTop: '0.25rem' }}>
        <span />
        <div style={{ position: 'relative', height: 18, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {ticks.map(t => (
            <span key={t} style={{
              position: 'absolute', left: `${50 + (t / scale) * 50}%`,
              transform: t === -scale ? 'none' : t === scale ? 'translateX(-100%)' : 'translateX(-50%)',
            }}>
              {t === 0 ? '0' : `${Math.abs(t)}%`}
            </span>
          ))}
        </div>
      </div>

      {hovered && (
        <div style={{
          position: 'absolute', zIndex: 5, pointerEvents: 'none',
          left: tipLeft ? undefined : hover.x + 14,
          right: tipLeft ? hover.width - hover.x + 14 : undefined,
          top: hover.y + 12,
          minWidth: 210, padding: '0.6rem 0.8rem', borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)', fontSize: '0.85rem',
        }}>
          <div style={{ fontWeight: 700, paddingBottom: '0.4rem', marginBottom: '0.4rem', borderBottom: '1px solid var(--border)' }}>
            {hovered.sector}
          </div>
          {[[a, hovered.a, COLOR_A], [b, hovered.b, COLOR_B]].map(([name, value, color]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: '1.5rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, marginRight: 6 }} />
                {name}
              </span>
              <span>{pct(value)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1.5rem', marginTop: '0.3rem', fontWeight: 700 }}>
            <span>{b} − {a}</span>
            <span style={{ color: hovered.diff > 0 ? COLOR_A : COLOR_B }}>{signedPct(-hovered.diff)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function TiltList({ title, subtitle, rows, a, b, color, sign }) {
  const max = rows.length ? Math.max(...rows.map(r => Math.abs(r.diff))) : 1
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.6rem' }}>{subtitle}</div>
      {rows.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nothing differs by a meaningful amount.</div>
      )}
      {rows.map(r => (
        <div key={r.key} style={{ marginBottom: '0.55rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', fontWeight: 600 }}>
            <span title={r.name}>{r.symbol || r.name}</span>
            <span style={{ color }}>{sign}{pct(Math.abs(r.diff))}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', margin: '0.25rem 0', display: 'flex', justifyContent: sign === '+' ? 'flex-start' : 'flex-end' }}>
            <div style={{ height: '100%', borderRadius: 3, background: color, width: `${(100 * Math.abs(r.diff)) / max}%` }} />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            {a} {pct(r.weight_a)} · {b} {pct(r.weight_b)}
          </div>
        </div>
      ))}
    </div>
  )
}

// A ticker box that also offers the current portfolio's funds. What is typed is
// always kept as typed: the list narrows to match it but never has to contain it.
function FundPicker({ label, color, value, placeholder, funds, portfolioName, exclude, onChange }) {
  const [open, setOpen] = useState(false)
  // Opening the list on a box that already holds a ticker shows every fund;
  // it only narrows once the user starts typing.
  const [narrow, setNarrow] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef(null)

  const options = useMemo(() => {
    const needle = narrow ? value.trim().toUpperCase() : ''
    return funds.filter(f => f.ticker !== exclude
      && (!needle || `${f.ticker} ${f.description}`.toUpperCase().includes(needle)))
  }, [funds, exclude, narrow, value])

  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const close = () => { setOpen(false); setNarrow(false); setActive(-1) }
  const choose = (ticker) => { onChange(ticker); close() }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (!options.length) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive(i => (i + step + options.length) % options.length)
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      // Enter on a highlighted fund picks it; otherwise it submits the form.
      e.preventDefault()
      choose(options[active].ticker)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  return (
    <div
      style={{ flex: '1 1 220px', position: 'relative' }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) close() }}
    >
      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, marginRight: 6 }} />
        {label}
      </span>
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true); setNarrow(true); setActive(-1) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={10}
          spellCheck={false}
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, fontSize: '1.05rem', fontWeight: 600 }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={`${label} ticker`}
        />
        <button
          type="button"
          className="btn btn-secondary"
          // Keep focus in the box so the list does not close under the click.
          onMouseDown={e => e.preventDefault()}
          onClick={e => {
            if (open) close()
            else { setOpen(true); e.currentTarget.previousSibling.focus() }
          }}
          title={`Choose from the funds in ${portfolioName}`}
          aria-label={`Choose ${label} from ${portfolioName}`}
          style={{ padding: '0 0.7rem' }}
        >
          ▾
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
          <div style={{ padding: '0.4rem 0.7rem', fontSize: '0.72rem', letterSpacing: '0.04em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            FUNDS IN {String(portfolioName || 'this portfolio').toUpperCase()}
          </div>
          <div ref={listRef} role="listbox" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {options.map((f, i) => (
              <div
                key={f.ticker}
                role="option"
                aria-selected={i === active}
                onMouseDown={e => e.preventDefault()}
                onClick={() => choose(f.ticker)}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: '0.6rem', padding: '0.4rem 0.7rem', cursor: 'pointer',
                  background: i === active ? 'var(--surface-2, rgba(127,127,127,0.18))' : 'transparent',
                }}
              >
                <strong style={{ minWidth: '4.2rem' }}>{f.ticker}</strong>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.description}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{formatMoneyWhole(f.current_value)}</span>
              </div>
            ))}
            {options.length === 0 && (
              <div style={{ padding: '0.6rem 0.7rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {funds.length === 0
                  ? `No funds found in ${portfolioName}. Type any ticker instead.`
                  : `Nothing in ${portfolioName} matches “${value.trim()}”. It can still be compared — any fund ticker works.`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function coverageNote(fund) {
  const coverage = Number(fund.coverage_pct || 0)
  if (coverage >= FULL_COVERAGE) return null
  const source = SOURCE_LABELS[fund.source] || fund.source || 'its published list'
  return `${fund.ticker}: only ${pct(coverage)} of the fund is disclosed (${source}), across ${fund.holdings_count} holdings.`
}

export default function EtfOverlap() {
  const pf = useProfileFetch()
  const { currentProfileName } = useProfile()
  const [inputs, setInputs] = useState(loadLastPair)
  const [portfolioFunds, setPortfolioFunds] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [tab, setTab] = useState('shared')
  const [search, setSearch] = useState('')
  const [minWeight, setMinWeight] = useState(0)
  const [sector, setSector] = useState('')
  const [industry, setIndustry] = useState('')
  const [sort, setSort] = useState({ key: 'overlap', dir: -1 })
  const [limit, setLimit] = useState(PAGE_SIZE)

  // Only the newest request may write to the page: switching pairs quickly
  // would otherwise let a slow earlier answer land on top of the current one.
  const requestId = useRef(0)
  const sectorPolls = useRef(0)

  // The active portfolio's funds, offered in both ticker boxes. Re-read when
  // the portfolio changes; a failure just leaves the boxes as plain inputs.
  useEffect(() => {
    const controller = new AbortController()
    pf('/api/etf-overlap/portfolio-funds', { signal: controller.signal })
      .then(r => r.json())
      .then(d => setPortfolioFunds(Array.isArray(d?.funds) ? d.funds : []))
      .catch(e => { if (e.name !== 'AbortError') setPortfolioFunds([]) })
    return () => controller.abort()
  }, [pf])

  const fetchPair = useCallback((a, b, quiet = false) => {
    const id = ++requestId.current
    if (!quiet) { setLoading(true); setError(null) }
    fetch(`${API_BASE}/api/etf-overlap?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then(r => r.json())
      .then(d => {
        if (id !== requestId.current) return
        if (d.error) {
          if (!quiet) { setError(d.error); setData(null) }
          return
        }
        setData(d)
      })
      .catch(e => {
        if (id === requestId.current && !quiet) setError('Request failed: ' + e.message)
      })
      .finally(() => {
        if (id === requestId.current && !quiet) setLoading(false)
      })
  }, [])

  // Per-stock sectors and industries are looked up in the background the first
  // time a fund is compared; re-ask a few times, quietly, so those columns fill in.
  useEffect(() => {
    if (!data?.sectors_pending || sectorPolls.current >= SECTOR_POLL_LIMIT) return undefined
    const timer = setTimeout(() => {
      sectorPolls.current += 1
      fetchPair(data.a.ticker, data.b.ticker, true)
    }, SECTOR_POLL_MS)
    return () => clearTimeout(timer)
  }, [data, fetchPair])

  const compare = useCallback((rawA, rawB) => {
    const a = (rawA || '').trim().toUpperCase()
    const b = (rawB || '').trim().toUpperCase()
    setInputs({ a, b })
    if (!a || !b) { setError('Enter two fund tickers to compare.'); return }
    if (a === b) { setError('Pick two different funds.'); return }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ a, b }))
    } catch {
      // Remembering the pair is a convenience; the comparison still runs.
    }
    setTab('shared')
    setSort({ key: 'overlap', dir: -1 })
    setLimit(PAGE_SIZE)
    setSector('')
    setIndustry('')
    setSearch('')
    sectorPolls.current = 0
    fetchPair(a, b)
  }, [fetchPair])

  const a = data?.a?.ticker
  const b = data?.b?.ticker
  const holdings = data?.holdings

  const byTab = useMemo(() => {
    const out = { shared: [], onlyA: [], onlyB: [] }
    for (const r of holdings || []) {
      if (r.weight_a > 0 && r.weight_b > 0) out.shared.push(r)
      else if (r.weight_a > 0) out.onlyA.push(r)
      else out.onlyB.push(r)
    }
    return out
  }, [holdings])

  // The weight a row is judged by depends on the tab: the common weight for a
  // shared name, the holding fund's own weight for a name only one fund has.
  const tabWeight = tab === 'shared' ? 'overlap' : tab === 'onlyA' ? 'weight_a' : 'weight_b'

  const sectorOptions = useMemo(() => {
    const seen = new Set()
    for (const r of byTab[tab]) if (r.sector) seen.add(r.sector)
    return [...seen].sort()
  }, [byTab, tab])

  // Narrowed by the chosen sector, so the list only offers industries that can
  // still match something.
  const industryOptions = useMemo(() => {
    const seen = new Set()
    for (const r of byTab[tab]) {
      if (r.industry && (!sector || r.sector === sector)) seen.add(r.industry)
    }
    return [...seen].sort()
  }, [byTab, tab, sector])

  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase()
    const rows = byTab[tab].filter(r => {
      if (r[tabWeight] < minWeight) return false
      if (sector && r.sector !== sector) return false
      if (industry && r.industry !== industry) return false
      if (needle && !(`${r.symbol} ${r.name}`.toUpperCase().includes(needle))) return false
      return true
    })
    const { key, dir } = sort
    return rows.sort((x, y) => {
      const vx = x[key] ?? ''
      const vy = y[key] ?? ''
      if (typeof vx === 'number' && typeof vy === 'number') return (vx - vy) * dir
      // A blank sector or industry sorts last in either direction, so sorting
      // the column never leads with a page of dashes.
      if (!vx !== !vy) return vx ? -1 : 1
      return String(vx).localeCompare(String(vy)) * dir
    })
  }, [byTab, tab, tabWeight, minWeight, sector, industry, search, sort])

  const overweight = useMemo(
    () => (holdings || []).filter(r => r.diff >= 0.05).sort((x, y) => y.diff - x.diff).slice(0, 8),
    [holdings],
  )
  const underweight = useMemo(
    () => (holdings || []).filter(r => r.diff <= -0.05).sort((x, y) => x.diff - y.diff).slice(0, 8),
    [holdings],
  )

  const switchTab = (next) => {
    setTab(next)
    setSort({ key: next === 'shared' ? 'overlap' : next === 'onlyA' ? 'weight_a' : 'weight_b', dir: -1 })
    setLimit(PAGE_SIZE)
    setSector('')
    setIndustry('')
  }

  const sortBy = (key) => {
    setSort(prev => (prev.key === key
      ? { key, dir: -prev.dir }
      : { key, dir: TEXT_COLUMNS.has(key) ? 1 : -1 }))
  }

  const sortMark = (key) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '')

  const notes = data ? [coverageNote(data.a), coverageNote(data.b)].filter(Boolean) : []
  const collateralNotes = data
    ? [data.a, data.b]
      .filter(f => Math.abs(f.cash_pct) + Math.abs(f.derivatives_pct) >= 5)
      .map(f => `${f.ticker} files ${pct(f.cash_pct)} cash and Treasury bills and ${pct(f.derivatives_pct)} option positions`)
    : []
  const mixedSectorBasis = data && (data.a.sector_basis !== 'fund' || data.b.sector_basis !== 'fund')

  const columns = [
    ['symbol', 'Stock', 'left'],
    ['name', 'Name', 'left'],
    ['sector', 'Sector', 'left'],
    ['industry', 'Industry', 'left'],
    ['weight_a', `Wt ${a}`, 'right'],
    ['weight_b', `Wt ${b}`, 'right'],
    ['overlap', 'Overlap', 'right'],
  ]

  return (
    <div className="page">
      <h1>ETF Holdings Overlap</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: '-0.5rem', maxWidth: '78ch' }}>
        Compare two funds by <strong>weighted holdings overlap</strong> — how much of each
        portfolio is the same investment by weight, not just how many tickers appear on both
        lists. Useful before buying two funds that might simply duplicate each other's risk.
      </p>

      {/* Collapsed by default; shares the Blended Yield help styling. */}
      <details className="by-help">
        <summary>What everything on this screen means</summary>
        <div className="by-help-grid">
          <section className="by-help-wide">
            <h3>Picking the two funds</h3>
            <ul>
              <li><strong>Fund A / Fund B</strong> — type any fund ticker, or click the box (or its <strong>▾</strong>) to choose from the funds held in {currentProfileName}. The list narrows as you type and shows each holding's current value; single stocks and money-market funds are left out because they have no holdings to compare. A ticker that is not in the list is still compared.</li>
              <li><strong>⇄ Swap</strong> — exchanges the two funds. The overlap is the same either way; only which fund is "left" and "right" changes.</li>
              <li><strong>Compare</strong> — runs the comparison. The first time a fund is read it can take several seconds; afterwards it is remembered.</li>
              <li><strong>Popular pairs</strong> — one click fills both boxes and compares.</li>
              <li><strong>Colours</strong> — <span style={{ color: COLOR_A, fontWeight: 700 }}>blue</span> is always Fund A and <span style={{ color: COLOR_B, fontWeight: 700 }}>green</span> is always Fund B, in every chart and list.</li>
            </ul>
          </section>
          <section>
            <h3>The summary</h3>
            <ul>
              <li><strong>Circles</strong> — a count of holdings: only in Fund A, in both (Shared), only in Fund B. Counts, not weights.</li>
              <li><strong>Overlap by weight</strong> — the headline. For each shared holding the smaller of the two weights is taken, and those are added up. 40% means about two-fifths of each fund is the same investment at similar size.</li>
              <li><strong>"…of its weight is in names the other also holds"</strong> — how much of each fund sits in shared companies, whatever size the other fund holds them at. Always at least as large as the overlap, and usually different for the two funds.</li>
              <li><strong># Overlapping holdings</strong> — how many holdings appear in both, out of each fund's total.</li>
            </ul>
          </section>
          <section>
            <h3>Notes under the summary</h3>
            <ul>
              <li><strong>"The overlap is a minimum"</strong> — shown when a fund publishes only part of its portfolio. Undisclosed holdings cannot be matched, so the real overlap may be higher.</li>
              <li><strong>Cash, Treasury bills and option positions</strong> — reported for option-income funds but kept out of the comparison: two funds holding T-bills do not share an investment.</li>
            </ul>
          </section>
          <section>
            <h3>Sector drift</h3>
            <p>
              One bar per sector, sized by the difference between the two funds' sector weights.
              A bar to the <strong>left</strong> means Fund A is heavier there; to the <strong>right</strong>,
              Fund B. Hover a row for both weights and the gap. <strong>Unclassified</strong> is
              weight whose sector is not known yet.
            </p>
          </section>
          <section>
            <h3>Overweight / underweight</h3>
            <p>
              The eight individual holdings where the funds differ most. <strong>Overweight</strong>:
              Fund A holds more than Fund B. <strong>Underweight</strong>: Fund A holds less. The
              figure is the gap in percentage points; the line beneath gives both weights, so
              0.0% means that fund does not hold it.
            </p>
          </section>
          <section className="by-help-wide">
            <h3>Holdings table</h3>
            <ul>
              <li><strong>Shared / Only A / Only B</strong> — which holdings to list. The number on each tab is the count.</li>
              <li><strong>Wt</strong> — the holding's weight in that fund, as a percent of the fund. A dash means the fund does not hold it.</li>
              <li><strong>Overlap</strong> — the smaller of the two weights: what this one holding adds to the headline number.</li>
              <li><strong>Sector / Industry</strong> — looked up in the background for each fund's 60 largest holdings, so they fill in shortly after a first comparison. Smaller holdings show a dash.</li>
              <li><strong>Search, Min weight, Sector, Industry</strong> — filters on the current tab. Min weight uses Overlap on the Shared tab and the fund's own weight on the other two. <strong>Shown</strong> is how many rows pass.</li>
              <li><strong>Column headings</strong> — click to sort; click again to reverse.</li>
            </ul>
          </section>
        </div>
      </details>

      <form className="card" onSubmit={e => { e.preventDefault(); compare(inputs.a, inputs.b) }}>
        <h2>Pick two funds</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          {[['a', 'Fund A', COLOR_A], ['b', 'Fund B', COLOR_B]].map(([key, label, color]) => (
            <FundPicker
              key={key}
              label={label}
              color={color}
              value={inputs[key]}
              placeholder={key === 'a' ? 'SPYI' : 'VOO'}
              funds={portfolioFunds}
              portfolioName={currentProfileName}
              exclude={inputs[key === 'a' ? 'b' : 'a'].trim()}
              onChange={next => setInputs(prev => ({ ...prev, [key]: next }))}
            />
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setInputs(prev => ({ a: prev.b, b: prev.a }))}
            title="Swap the two funds"
          >
            ⇄ Swap
          </button>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.04em', margin: '1.1rem 0 0.5rem' }}>
          POPULAR PAIRS
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {POPULAR_PAIRS.map(([pa, pb, blurb]) => (
            <button
              key={`${pa}-${pb}`}
              type="button"
              className="btn-sm"
              onClick={() => compare(pa, pb)}
              disabled={loading}
              style={{ textAlign: 'left', padding: '0.45rem 0.75rem' }}
            >
              <div style={{ fontWeight: 700 }}>{pa} vs {pb}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{blurb}</div>
            </button>
          ))}
        </div>
      </form>

      {loading && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
          Reading each fund's published holdings… the first comparison of a fund can take
          several seconds; it is cached afterwards.
        </div>
      )}

      {error && (
        <div className="card" style={{ color: 'var(--neg-strong)' }}>
          {error}{' '}
          {/holdings data/i.test(error) && <Link to="/fund-definitions">Open Fund Definitions</Link>}
        </div>
      )}

      {data && !loading && (
        <div className="card">
          <h2 style={{ marginBottom: '0.25rem' }}>{a} vs {b} overlap</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1rem' }}>
            Ticker overlap by weight, sector tilts, and where one fund is overweight.
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'center',
            border: '1px solid var(--border)', borderRadius: 8, padding: '1rem 1.25rem',
          }}>
            <Venn a={a} b={b} onlyA={data.only_a_count} shared={data.shared_count} onlyB={data.only_b_count} />
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>OVERLAP BY WEIGHT</div>
              <div style={{ fontSize: '2.8rem', fontWeight: 800, lineHeight: 1.1 }}>{pct(data.overlap_pct, 0)}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '36ch' }}>
                Share of portfolio weight that sits in the same holdings in both funds.
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                <strong style={{ color: COLOR_A }}>{a}</strong>: {pct(data.a_weight_in_shared, 0)} of its weight is in names {b} also holds
                <br />
                <strong style={{ color: COLOR_B }}>{b}</strong>: {pct(data.b_weight_in_shared, 0)} of its weight is in names {a} also holds
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}># OVERLAPPING HOLDINGS</div>
              <div style={{ fontSize: '2rem', fontWeight: 800 }}>{data.shared_count}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                of {data.a.holdings_count} in {a} and {data.b.holdings_count} in {b}
              </div>
            </div>
          </div>

          {notes.length > 0 && (
            <div style={{ margin: '0.9rem 0 0', padding: '0.7rem 0.9rem', borderLeft: '3px solid var(--warning, #d97706)', background: 'var(--surface-2, transparent)', fontSize: '0.85rem' }}>
              <strong>The overlap is a minimum, not an estimate.</strong>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                {notes.join(' ')} A holding that is not disclosed cannot be matched, so the
                true overlap may be higher.
              </span>
            </div>
          )}
          {collateralNotes.length > 0 && (
            <div style={{ margin: '0.9rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {collateralNotes.join('; ')}. Collateral and option legs are left out of the
              comparison — two funds holding Treasury bills do not share an investment.
            </div>
          )}

          {data.sectors.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem 1.25rem', marginTop: '1.25rem' }}>
              <div style={{ fontWeight: 700 }}>Sector drift ({a} vs {b})</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                Left = heavier in {a}. Right = heavier in {b}. Hover a sector for both weights.
              </div>
              <SectorDrift a={a} b={b} sectors={data.sectors} />
              {mixedSectorBasis && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.6rem' }}>
                  {[data.a, data.b].filter(f => f.sector_basis !== 'fund').map(f => f.ticker).join(' and ')}{' '}
                  publishes no sector breakdown, so its mix is built from the holdings above.
                  Anything not yet classified shows as Unclassified
                  {data.sectors_pending > 0 ? ' and is still being looked up.' : '.'}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
            <TiltList
              title={`${a} overweight`} subtitle={`${a} holds more than ${b}.`}
              rows={overweight} a={a} b={b} color={COLOR_A} sign="+"
            />
            <TiltList
              title={`${a} underweight`} subtitle={`${a} holds less than ${b}.`}
              rows={underweight} a={a} b={b} color={COLOR_B} sign="-"
            />
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end',
            border: '1px solid var(--border)', borderRadius: 8, padding: '0.8rem 1rem', marginTop: '1.25rem',
          }}>
            <label style={{ flex: '1 1 220px', margin: 0 }}>
              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Search ticker or name</span>
              <input
                type="text" value={search} placeholder="AAPL…" style={{ width: '100%' }}
                onChange={e => { setSearch(e.target.value); setLimit(PAGE_SIZE) }}
              />
            </label>
            <div>
              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Min weight</span>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                {MIN_WEIGHTS.map(([value, label]) => (
                  <button
                    key={value} type="button"
                    className={`btn-sm ${minWeight === value ? 'btn-active' : ''}`}
                    onClick={() => { setMinWeight(value); setLimit(PAGE_SIZE) }}
                    aria-pressed={minWeight === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label style={{ margin: 0 }}>
              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Sector</span>
              <select value={sector} onChange={e => { setSector(e.target.value); setIndustry(''); setLimit(PAGE_SIZE) }}>
                <option value="">All sectors</option>
                {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ margin: 0 }}>
              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Industry</span>
              <select value={industry} onChange={e => { setIndustry(e.target.value); setLimit(PAGE_SIZE) }}>
                <option value="">All industries</option>
                {industryOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {filtered.length} shown
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', margin: '1rem 0 0.75rem' }}>
            {[
              ['shared', `Shared (${byTab.shared.length})`],
              ['onlyA', `Only ${a} (${byTab.onlyA.length})`],
              ['onlyB', `Only ${b} (${byTab.onlyB.length})`],
            ].map(([key, label]) => (
              <button
                key={key} type="button" style={{ flex: 1, padding: '0.5rem' }}
                className={`btn-sm ${tab === key ? 'btn-active' : ''}`}
                onClick={() => switchTab(key)} aria-pressed={tab === key}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map(([key, label, align]) => (
                    <th
                      key={key} onClick={() => sortBy(key)}
                      style={{ textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    >
                      {label}{sortMark(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map(r => (
                  <tr key={r.key}>
                    <td style={{ fontWeight: 700 }}>{r.symbol || '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.sector || '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.industry || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.weight_a > 0 ? pct(r.weight_a, 2) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.weight_b > 0 ? pct(r.weight_b, 2) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.overlap > 0 ? pct(r.overlap, 2) : '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                      No holdings match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > limit && (
            <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <button type="button" className="btn-sm" onClick={() => setLimit(n => n + 50)}>
                Show {Math.min(50, filtered.length - limit)} more
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ maxWidth: '78ch', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        <h3 style={{ color: 'var(--text)', marginBottom: '0.5rem' }}>How weighted overlap works</h3>
        <p>
          For every holding both funds own, the smaller of the two weights is taken and those
          values are added up. A 40% overlap means roughly two-fifths of each fund, by weight,
          sits in the same names at similar concentration. Counting shared tickers alone can
          overstate the similarity when one fund is 8% Apple and the other is 0.5%.
        </p>
        <p style={{ marginTop: '0.6rem' }}>
          Holdings come from the same look-through data as the{' '}
          <Link to="/diversification">Diversification</Link> page — the issuer's own file where
          one is published — and share classes spelled differently by different issuers
          (BRK.B, BRK/B, BRK-B) are matched as one holding. A fund that is a wrapper around
          another ETF is compared on what that ETF holds. Missing or wrong holdings can be
          corrected on <Link to="/fund-definitions">Fund Definitions</Link>.
        </p>
      </div>
    </div>
  )
}
