import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { formatMoney, formatMoneyCompact } from '../utils/money'
import { signalReading } from '../utils/readingLabels'
import NotFinancialAdviceNotice from '../components/NotFinancialAdviceNotice'
import { readHomeWatchlistHidden, writeHomeWatchlistHidden } from '../utils/homeWatchlistPreference'
import {
  GRADING_PREFERENCES_EVENT,
  loadGradingPreferences,
  signalFormulaSearch,
} from '../utils/gradingPreferences'

const ICONS = [
  { id: 'chart', label: 'Chart' },
  { id: 'laptop', label: 'Laptop' },
  { id: 'crown', label: 'Crown' },
  { id: 'rocket', label: 'Rocket' },
  { id: 'shield', label: 'Shield' },
  { id: 'star', label: 'Star' },
  { id: 'bolt', label: 'Bolt' },
  { id: 'globe', label: 'Globe' },
]

const COLORS = ['#7c8cff', '#3ecf8e', '#f5a524', '#ef5350', '#42a5f5', '#ec407a', '#ab47bc', '#26c6da']
const ACTIVE_KEY = 'portfolio_watchlist_active'

const COLUMNS = [
  { key: 'ticker', label: 'Symbol' },
  { key: 'name', label: 'Name', tip: 'Fund or company name' },
  { key: 'price', label: 'Price', tip: 'Latest market price' },
  { key: 'change_1d', label: 'Daily', tip: 'Price change since the previous close' },
  { key: 'div_yield', label: 'Yield', tip: 'Distribution yield. Use Edit to type a manual yield.' },
  { key: 'div_growth_5y', label: '5Y Div Growth', tip: 'Annualized dividend growth across five full years' },
  { key: 'next_ex_date', label: 'Next Ex-Date', tip: 'Next ex-dividend date' },
  { key: 'aum', label: 'AUM', tip: 'Assets under management' },
  { key: 'one_yr_ret', label: '1Y Return', tip: 'Price return over the past year' },
  { key: 'cov_sig', label: 'NAV Signal', tip: 'Bullish, Neutral, or Bearish from the NAV erosion reading' },
  { key: 'nav_erosion_prob', label: 'NAV Erosion', tip: 'Low, Medium, or High reading for NAV erosion' },
  { key: 'notes', label: 'Notes' },
]

function tint(hex, alpha) {
  const raw = String(hex || '').replace('#', '')
  if (raw.length !== 6) return `rgba(124, 140, 255, ${alpha})`
  const red = parseInt(raw.slice(0, 2), 16)
  const green = parseInt(raw.slice(2, 4), 16)
  const blue = parseInt(raw.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function WatchlistGlyph({ name }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  const paths = {
    chart: <path d="M4 16V9M8 16V5M12 16V11M16 16V3" />,
    laptop: <><rect x="3" y="4" width="14" height="9" rx="1.2" /><path d="M2 16h16" /></>,
    crown: <path d="M3 15h14L16 7l-4 3L10 5 8 10 4 7z" />,
    rocket: <path d="M10 18c4-2 6-6 6-11-4 0-8 2-10 6 2 1 3 3 4 5zM8 14l-3 3M12 8h.01" />,
    shield: <path d="M10 2 4 5v5c0 4 2.6 6.4 6 8 3.4-1.6 6-4 6-8V5z" />,
    star: <path d="m10 2.8 2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 13.6 5.8 15.8l.8-4.7L3.2 7.8l4.7-.7z" />,
    bolt: <path d="M11 2 4 12h6l-1 6 7-10h-6z" />,
    globe: <><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2.2 2 11.8 0 14M10 3c-2 2.2-2 11.8 0 14" /></>,
  }
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" {...common}>
      {paths[name] || paths.chart}
    </svg>
  )
}

function SignalBadge({ signal }) {
  if (!signal || signal === '—') return <span>—</span>
  const cls = { BUY: 'sig-BUY', SELL: 'sig-SELL', NEUTRAL: 'sig-NEUTRAL' }
  return <span className={`sig ${cls[signal] || ''}`}>{signalReading(signal)}</span>
}

function fmtSigned(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}

function fmtPercent(value, digits = 2) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number.toFixed(digits)}%`
}

function erosionStyle(level) {
  if (level === 'Low') return { color: 'var(--pos-strong)' }
  if (level === 'High') return { color: 'var(--neg-strong)' }
  if (level === 'Medium') return { color: 'var(--warning)' }
  return { color: 'var(--text-dim)' }
}

function SymbolSearch({ pf, picked, onAdd }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setHits([])
      setSearching(false)
      return undefined
    }
    let cancelled = false
    setSearching(true)
    const handle = setTimeout(() => {
      pf(`/api/watchlist/lookup?q=${encodeURIComponent(text)}`)
        .then(response => response.json())
        .then(data => {
          if (!cancelled) setHits(data.results || [])
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, pf])

  const addHit = (hit) => {
    onAdd({ ticker: hit.symbol, name: hit.name || '' })
    setQuery('')
    setHits([])
  }

  return (
    <div className="wl-search">
      <label className="wl-label" htmlFor="wl-symbol-search">Find a symbol</label>
      <div className="wl-search-box">
        <span aria-hidden="true">⌕</span>
        <input
          id="wl-symbol-search"
          value={query}
          placeholder="Search by symbol or name"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && hits[0]) {
              event.preventDefault()
              addHit(hits[0])
            }
          }}
        />
      </div>
      {searching && query.trim() && <p className="wl-search-status">Searching…</p>}
      {!!hits.length && (
        <ul className="wl-hits">
          {hits.map(hit => {
            const added = picked.includes(hit.symbol)
            return (
              <li key={hit.symbol}>
                <span className="wl-hit-symbol">{hit.symbol}</span>
                <span>
                  <strong>{hit.symbol}</strong>
                  <small>{hit.name || 'Name loads with the quote'}</small>
                </span>
                {hit.issuer && <em>{hit.issuer}</em>}
                <button type="button" onClick={() => addHit(hit)} disabled={added}>
                  {added ? 'Added' : '+ Add'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {!searching && query.trim() && hits.length === 0 && (
        <p className="wl-search-status">No matching symbol.</p>
      )}
    </div>
  )
}

function WatchlistTickerModal({ ticker, onClose }) {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    const loadChart = async () => {
      let lastError = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await pf(`/api/ticker-return-1y/${encodeURIComponent(ticker)}`)
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || payload.error) {
            throw new Error(payload.error || `Could not load return data for ${ticker}`)
          }
          return payload
        } catch (err) {
          lastError = err
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 700))
        }
      }
      throw lastError
    }
    loadChart()
      .then(payload => {
        if (!cancelled) setData(payload)
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [ticker, pf])

  useEffect(() => {
    const handleEsc = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (!data || !window.Plotly) return undefined
    const el = document.getElementById('wl-ticker-chart')
    if (!el) return undefined
    const ct = chartTheme(isDark)
    const traces = [
      {
        x: data.dates, y: data.price_return,
        mode: 'lines', name: 'Price Return %',
        line: { color: '#7ecfff', width: 2 },
      },
      {
        x: data.dates, y: data.total_return,
        mode: 'lines', name: 'Total Return %',
        line: { color: '#4dff91', width: 2 },
      },
    ]
    window.Plotly.newPlot(el, traces, {
      template: ct.template,
      paper_bgcolor: ct.paper,
      plot_bgcolor: ct.plot,
      font: { color: ct.font },
      title: { text: `${data.ticker} — 1 Year Return`, font: { size: 16, color: ct.title } },
      margin: { l: 50, r: 20, t: 60, b: 40 },
      hovermode: 'x unified',
    }, { responsive: true })
    return () => { window.Plotly.purge(el) }
  }, [data, isDark])

  if (!ticker) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={event => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose}>&times;</button>
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
        {error && <div className="alert alert-error">{error}</div>}
        {data && (
          <>
            <h2 style={{ color: 'var(--accent-bright)', marginBottom: '0.25rem' }}>{data.ticker} — {data.description}</h2>
            <div id="wl-ticker-chart" style={{ height: '400px' }} />
          </>
        )}
      </div>
    </div>
  )
}

export default function Watchlist() {
  const pf = useProfileFetch()
  const dialog = useDialog()
  const [lists, setLists] = useState([])
  const [market, setMarket] = useState({})
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [showOnDashboard, setShowOnDashboard] = useState(() => !readHomeWatchlistHidden())
  const [updating, setUpdating] = useState(false)
  const [activeId, setActiveId] = useState(() => {
    try { return Number(sessionStorage.getItem(ACTIVE_KEY)) || null } catch { return null }
  })
  const [sortKey, setSortKey] = useState('ticker')
  const [sortAsc, setSortAsc] = useState(true)
  const [wizard, setWizard] = useState(null)
  const [adderFor, setAdderFor] = useState(null)
  const [listEditor, setListEditor] = useState(null)
  const [itemEditor, setItemEditor] = useState(null)
  const [chartTicker, setChartTicker] = useState(null)
  const [preferences, setPreferences] = useState(loadGradingPreferences)
  const formula = signalFormulaSearch(preferences).toString()

  const reload = useCallback(async () => {
    const response = await pf('/api/watchlists')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not load watchlists')
    setLists(data.lists || [])
    setMarket(previous => ({ ...previous, ...(data.market || {}) }))
    setReady(true)
    return data.lists || []
  }, [pf])

  useEffect(() => {
    let cancelled = false
    reload().catch(err => {
      if (!cancelled) {
        setReady(true)
        setLoadError(err.message)
      }
    })
    return () => { cancelled = true }
  }, [reload])

  useEffect(() => {
    const refresh = event => setPreferences(event.detail || loadGradingPreferences())
    window.addEventListener(GRADING_PREFERENCES_EVENT, refresh)
    return () => window.removeEventListener(GRADING_PREFERENCES_EVENT, refresh)
  }, [])

  const active = lists.find(list => list.id === activeId) || lists.find(list => list.is_default) || lists[0] || null

  useEffect(() => {
    if (!active) return
    try { sessionStorage.setItem(ACTIVE_KEY, String(active.id)) } catch { /* ignore */ }
  }, [active])

  const tickerKey = (active?.items || []).map(item => item.ticker).join(',')

  useEffect(() => {
    const tickers = tickerKey ? tickerKey.split(',') : []
    if (!tickers.length) return undefined
    let cancelled = false
    setUpdating(true)
    const post = (part, search) => pf(`/api/watchlist/market/refresh${search || ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, part }),
    }).then(response => response.json())

    post('quote')
      .then(data => {
        if (!cancelled && data.market) setMarket(previous => ({ ...previous, ...data.market }))
      })
      .catch(() => {})
      .then(() => post('history', `?${formula}`))
      .then(data => {
        if (!cancelled && data?.market) setMarket(previous => ({ ...previous, ...data.market }))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setUpdating(false)
      })
    return () => { cancelled = true }
  }, [tickerKey, formula, pf])

  const rows = useMemo(() => {
    const source = (active?.items || []).map(item => {
      const quote = market[item.ticker] || {}
      const override = item.div_yield_override
      const overridden = override !== null && override !== undefined && override !== ''
      return {
        ...item,
        name: quote.name || item.name || '',
        price: quote.price,
        change_1d: quote.change_1d,
        div_yield: overridden ? Number(override) : quote.div_yield,
        yield_overridden: overridden,
        div_growth_5y: quote.div_growth_5y,
        next_ex_date: quote.next_ex_date,
        aum: quote.aum,
        one_yr_ret: quote.one_yr_ret,
        cov_sig: quote.cov_sig,
        nav_erosion_prob: quote.nav_erosion_prob,
      }
    })
    const signalOrder = { BUY: 0, NEUTRAL: 1, SELL: 2 }
    const erosionOrder = { High: 0, Medium: 1, Low: 2 }
    const sorted = [...source]
    sorted.sort((left, right) => {
      let a = left[sortKey]
      let b = right[sortKey]
      if (sortKey === 'cov_sig') {
        a = signalOrder[a] ?? 9
        b = signalOrder[b] ?? 9
      } else if (sortKey === 'nav_erosion_prob') {
        a = erosionOrder[a] ?? 9
        b = erosionOrder[b] ?? 9
      }
      if (a == null || a === '') return 1
      if (b == null || b === '') return -1
      if (typeof a === 'number' && typeof b === 'number') return sortAsc ? a - b : b - a
      return sortAsc ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a))
    })
    return sorted
  }, [active, market, sortKey, sortAsc])

  const chooseSort = (key) => {
    if (sortKey === key) setSortAsc(value => !value)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const openWizard = () => setWizard({
    step: 1,
    name: '',
    description: '',
    icon: 'chart',
    color: COLORS[0],
    picks: [],
  })

  const createList = async (includePicks) => {
    const name = wizard.name.trim()
    if (!name) {
      await dialog.alert('Enter a watchlist name.')
      setWizard(current => ({ ...current, step: 1 }))
      return
    }
    const response = await pf('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: wizard.description.trim(),
        icon: wizard.icon,
        color: wizard.color,
        tickers: includePicks ? wizard.picks : [],
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      await dialog.alert(data.error || 'Could not create the watchlist.')
      return
    }
    setWizard(null)
    const next = await reload()
    const created = next.find(list => list.id === data.list?.id) || data.list
    if (created) setActiveId(created.id)
  }

  const saveListEditor = async () => {
    const name = listEditor.name.trim()
    if (!name) {
      await dialog.alert('Enter a watchlist name.')
      return
    }
    const response = await pf(`/api/watchlists/${listEditor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: listEditor.description,
        icon: listEditor.icon,
        color: listEditor.color,
        is_default: !!listEditor.is_default,
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      await dialog.alert(data.error || 'Could not save the watchlist.')
      return
    }
    setListEditor(null)
    await reload()
  }

  const removeList = async (list) => {
    const ok = await dialog.confirm(`Delete "${list.name}"? Symbols on this list will be removed.`)
    if (!ok) return
    await pf(`/api/watchlists/${list.id}`, { method: 'DELETE' })
    const next = await reload()
    if (!next.some(entry => entry.id === activeId)) setActiveId(next[0]?.id || null)
  }

  const addSymbol = async (listId, hit) => {
    const response = await pf(`/api/watchlists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hit),
    })
    const data = await response.json()
    if (!response.ok) {
      await dialog.alert(data.error || 'Could not add that symbol.')
      return false
    }
    await reload()
    return true
  }

  const saveItem = async () => {
    const notes = itemEditor.notes.slice(0, 500)
    const yieldText = String(itemEditor.div_yield_override ?? '').trim()
    let divYield = null
    if (yieldText !== '') {
      divYield = Number(yieldText)
      if (!Number.isFinite(divYield)) {
        await dialog.alert('Yield override must be a number, or blank to use the calculated yield.')
        return
      }
    }
    const response = await pf(`/api/watchlists/${active.id}/items/${encodeURIComponent(itemEditor.ticker)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes,
        div_yield_override: divYield,
        nav_erosion_scope: itemEditor.nav_erosion_scope,
        nav_benchmark_override: itemEditor.nav_benchmark_override,
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      await dialog.alert(data.error || 'Could not save this symbol.')
      return
    }
    setItemEditor(null)
    await reload()
  }

  const removeSymbol = async (ticker) => {
    await pf(`/api/watchlists/${active.id}/items/${encodeURIComponent(ticker)}`, { method: 'DELETE' })
    await reload()
  }

  const renderCell = (row, key) => {
    if (key === 'ticker') {
      return (
        <button type="button" className="wl-symbol" onClick={() => setChartTicker(row.ticker)}>
          {row.ticker}
        </button>
      )
    }
    if (key === 'name') return <span className="wl-name" title={row.name}>{row.name || '—'}</span>
    if (key === 'price') return formatMoney(row.price)
    if (key === 'change_1d') {
      return <span className={row.change_1d == null ? '' : row.change_1d >= 0 ? 'pct-up' : 'pct-down'}>{fmtSigned(row.change_1d)}</span>
    }
    if (key === 'div_yield') {
      return <span title={row.yield_overridden ? 'Manual yield' : ''}>{fmtPercent(row.div_yield)}{row.yield_overridden ? ' *' : ''}</span>
    }
    if (key === 'div_growth_5y') return fmtPercent(row.div_growth_5y, 1)
    if (key === 'next_ex_date') return row.next_ex_date || '—'
    if (key === 'aum') return formatMoneyCompact(row.aum)
    if (key === 'one_yr_ret') {
      return <span className={row.one_yr_ret == null ? '' : row.one_yr_ret >= 0 ? 'pct-up' : 'pct-down'}>{fmtSigned(row.one_yr_ret)}</span>
    }
    if (key === 'cov_sig') return <SignalBadge signal={row.cov_sig} />
    if (key === 'nav_erosion_prob') {
      return (
        <span style={erosionStyle(row.nav_erosion_prob)}>
          {row.nav_erosion_prob ? `${row.nav_erosion_prob} Probability` : '—'}
        </span>
      )
    }
    if (key === 'notes') {
      return (
        <button type="button" className={`wl-note${row.notes ? '' : ' wl-note-empty'}`} onClick={() => setItemEditor({ ...row })}>
          {row.notes || 'Add note'}
        </button>
      )
    }
    return '—'
  }

  return (
    <div className="wl-page">
      <NotFinancialAdviceNotice />
      <header className="wl-top">
        <div>
          <h1>Watchlists</h1>
          <p>Your default list can be shown on the Dashboard. It is off until you turn it on here.</p>
          <label className="wl-home-toggle">
            <input
              type="checkbox"
              checked={showOnDashboard}
              onChange={event => {
                writeHomeWatchlistHidden(!event.target.checked)
                setShowOnDashboard(event.target.checked)
              }}
            />
            Show the watchlist on the Dashboard
          </label>
        </div>
        <button type="button" className="btn btn-primary" onClick={openWizard}>+ New Watchlist</button>
      </header>

      {loadError && <div className="wl-error">{loadError}</div>}

      {ready && lists.length === 0 && (
        <section className="wl-empty-card">
          <button type="button" className="wl-empty-plus" onClick={openWizard} aria-label="New watchlist">+</button>
          <h2>No watchlists yet</h2>
          <p>Create a list here. You can then choose to show it on the Dashboard.</p>
          <button type="button" className="btn btn-primary" onClick={openWizard}>+ New Watchlist</button>
        </section>
      )}

      {active && (
        <>
          <div className="wl-pills" role="tablist" aria-label="Watchlists">
            {lists.map(list => (
              <button
                key={list.id}
                type="button"
                role="tab"
                aria-selected={list.id === active.id}
                className={`wl-pill${list.id === active.id ? ' wl-pill-active' : ''}`}
                onClick={() => setActiveId(list.id)}
              >
                <span className="wl-pill-icon" style={{ color: list.color, background: tint(list.color, 0.16) }}>
                  <WatchlistGlyph name={list.icon} />
                </span>
                {list.name}
                {list.is_default && <span className="wl-home-tag">Home</span>}
                <span className="wl-count">{list.items.length}</span>
              </button>
            ))}
          </div>

          <section className="wl-card">
            <header className="wl-card-head">
              <div className="wl-card-title">
                <span className="wl-pill-icon wl-pill-icon-lg" style={{ color: active.color, background: tint(active.color, 0.16) }}>
                  <WatchlistGlyph name={active.icon} />
                </span>
                <div>
                  <h2>{active.name}</h2>
                  <p>
                    {active.items.length} {active.items.length === 1 ? 'item' : 'items'}
                    {updating ? ' · updating prices' : ''}
                  </p>
                  {active.description && <p className="wl-card-desc">{active.description}</p>}
                </div>
              </div>
              <div className="wl-card-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setAdderFor(active)}>+ Add Stocks</button>
                <button type="button" className="wl-icon-btn" aria-label={`Edit ${active.name}`} onClick={() => setListEditor({ ...active })}>✎</button>
                <button type="button" className="wl-icon-btn wl-icon-danger" aria-label={`Delete ${active.name}`} onClick={() => removeList(active)}>🗑</button>
              </div>
            </header>

            {active.items.length === 0 ? (
              <div className="wl-card-empty">
                <p>This list has no symbols yet.</p>
                <button type="button" className="btn btn-primary" onClick={() => setAdderFor(active)}>+ Add Stocks</button>
              </div>
            ) : (
              <div className="wl-table-scroll">
                <table className="sst wl-table">
                  <thead>
                    <tr>
                      {COLUMNS.map((column, index) => (
                        <th
                          key={column.key}
                          className={index < 2 ? `wl-sticky wl-sticky-${index}` : undefined}
                          title={column.tip || ''}
                          onClick={() => chooseSort(column.key)}
                        >
                          {column.label}{sortKey === column.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.ticker}>
                        {COLUMNS.map((column, index) => (
                          <td key={column.key} className={index < 2 ? `wl-sticky wl-sticky-${index}` : undefined}>
                            {renderCell(row, column.key)}
                          </td>
                        ))}
                        <td className="wl-actions">
                          <button type="button" onClick={() => setItemEditor({ ...row, div_yield_override: row.div_yield_override ?? '' })}>Edit</button>
                          <button type="button" onClick={() => removeSymbol(row.ticker)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {wizard && (
        <div className="modal-overlay" onClick={() => setWizard(null)}>
          <div className="modal-content wl-modal" role="dialog" aria-modal="true" aria-labelledby="wl-wizard-title" onClick={event => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setWizard(null)} aria-label="Close">&times;</button>
            <h2 id="wl-wizard-title">{wizard.step === 1 ? 'Create Watchlist' : wizard.step === 2 ? 'Customize' : 'Add Stocks'}</h2>
            <div className="wl-steps" aria-hidden="true">
              {[1, 2, 3].map(step => <span key={step} className={step === wizard.step ? 'wl-step-on' : step < wizard.step ? 'wl-step-done' : ''} />)}
            </div>

            {wizard.step === 1 && (
              <>
                <label className="wl-label" htmlFor="wl-new-name">Watchlist Name</label>
                <input id="wl-new-name" className="wl-input wl-input-wide" value={wizard.name} onChange={event => setWizard({ ...wizard, name: event.target.value })} autoFocus />
                <label className="wl-label" htmlFor="wl-new-desc">Description (optional)</label>
                <input id="wl-new-desc" className="wl-input wl-input-wide" placeholder="Optional description" value={wizard.description} onChange={event => setWizard({ ...wizard, description: event.target.value })} />
                <div className="wl-modal-actions">
                  <button type="button" className="btn btn-primary" onClick={() => wizard.name.trim() ? setWizard({ ...wizard, step: 2 }) : dialog.alert('Enter a watchlist name.')}>Next</button>
                </div>
              </>
            )}

            {wizard.step === 2 && (
              <>
                <p className="wl-label">Icon</p>
                <div className="wl-icon-grid">
                  {ICONS.map(icon => (
                    <button
                      key={icon.id}
                      type="button"
                      aria-label={icon.label}
                      aria-pressed={wizard.icon === icon.id}
                      className={wizard.icon === icon.id ? 'wl-choice wl-choice-on' : 'wl-choice'}
                      onClick={() => setWizard({ ...wizard, icon: icon.id })}
                    >
                      <WatchlistGlyph name={icon.id} />
                    </button>
                  ))}
                </div>
                <p className="wl-label">Accent Color</p>
                <div className="wl-color-row">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      className={wizard.color === color ? 'wl-swatch wl-swatch-on' : 'wl-swatch'}
                      style={{ background: color }}
                      onClick={() => setWizard({ ...wizard, color })}
                    />
                  ))}
                </div>
                <div className="wl-preview">
                  <span className="wl-pill-icon" style={{ color: wizard.color, background: tint(wizard.color, 0.18) }}>
                    <WatchlistGlyph name={wizard.icon} />
                  </span>
                  <span>
                    <strong>{wizard.name || 'Watchlist'}</strong>
                    <small>0 stocks</small>
                  </span>
                </div>
                <div className="wl-modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setWizard({ ...wizard, step: 1 })}>Back</button>
                  <button type="button" className="btn btn-primary" onClick={() => setWizard({ ...wizard, step: 3 })}>Next</button>
                </div>
              </>
            )}

            {wizard.step === 3 && (
              <>
                <p className="wl-help">Add stocks now or skip — you can always add more later.</p>
                <SymbolSearch
                  pf={pf}
                  picked={wizard.picks.map(pick => pick.ticker)}
                  onAdd={hit => setWizard(current => (
                    current.picks.some(pick => pick.ticker === hit.ticker)
                      ? current
                      : { ...current, picks: [...current.picks, hit] }
                  ))}
                />
                {!!wizard.picks.length && (
                  <p className="wl-picked">{wizard.picks.map(pick => pick.ticker).join(', ')}</p>
                )}
                <div className="wl-modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setWizard({ ...wizard, step: 2 })}>Back</button>
                  {wizard.picks.length === 0 && (
                    <button type="button" className="btn btn-secondary" onClick={() => createList(false)}>Skip</button>
                  )}
                  <button type="button" className="btn btn-primary" onClick={() => createList(true)}>Create</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {adderFor && (
        <div className="modal-overlay" onClick={() => setAdderFor(null)}>
          <div className="modal-content wl-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setAdderFor(null)} aria-label="Close">&times;</button>
            <h2>Add Stocks to "{adderFor.name}"</h2>
            <SymbolSearch
              pf={pf}
              picked={(lists.find(list => list.id === adderFor.id)?.items || []).map(item => item.ticker)}
              onAdd={async hit => { await addSymbol(adderFor.id, hit) }}
            />
            <div className="wl-modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setAdderFor(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {listEditor && (
        <div className="modal-overlay" onClick={() => setListEditor(null)}>
          <div className="modal-content wl-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setListEditor(null)} aria-label="Close">&times;</button>
            <h2>Edit Watchlist</h2>
            <label className="wl-label" htmlFor="wl-edit-name">Watchlist Name</label>
            <input id="wl-edit-name" className="wl-input wl-input-wide" value={listEditor.name} onChange={event => setListEditor({ ...listEditor, name: event.target.value })} />
            <label className="wl-label" htmlFor="wl-edit-desc">Description (optional)</label>
            <input id="wl-edit-desc" className="wl-input wl-input-wide" value={listEditor.description || ''} onChange={event => setListEditor({ ...listEditor, description: event.target.value })} />
            <p className="wl-label">Icon</p>
            <div className="wl-icon-grid">
              {ICONS.map(icon => (
                <button key={icon.id} type="button" aria-label={icon.label} aria-pressed={listEditor.icon === icon.id} className={listEditor.icon === icon.id ? 'wl-choice wl-choice-on' : 'wl-choice'} onClick={() => setListEditor({ ...listEditor, icon: icon.id })}>
                  <WatchlistGlyph name={icon.id} />
                </button>
              ))}
            </div>
            <p className="wl-label">Accent Color</p>
            <div className="wl-color-row">
              {COLORS.map(color => (
                <button key={color} type="button" aria-label={color} className={listEditor.color === color ? 'wl-swatch wl-swatch-on' : 'wl-swatch'} style={{ background: color }} onClick={() => setListEditor({ ...listEditor, color })} />
              ))}
            </div>
            <label className="wl-check">
              <input type="checkbox" checked={!!listEditor.is_default} onChange={event => setListEditor({ ...listEditor, is_default: event.target.checked })} />
              Show this list on Home
            </label>
            <div className="wl-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setListEditor(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveListEditor}>Save</button>
            </div>
          </div>
        </div>
      )}

      {itemEditor && active && (
        <div className="modal-overlay" onClick={() => setItemEditor(null)}>
          <div className="modal-content wl-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setItemEditor(null)} aria-label="Close">&times;</button>
            <h2>Edit {itemEditor.ticker}</h2>
            <p className="wl-help">{itemEditor.name || itemEditor.ticker}</p>
            <label className="wl-label" htmlFor="wl-item-note">Note</label>
            <textarea id="wl-item-note" className="wl-input wl-input-wide" rows={3} maxLength={500} value={itemEditor.notes || ''} onChange={event => setItemEditor({ ...itemEditor, notes: event.target.value })} />
            <label className="wl-label" htmlFor="wl-item-yield">Yield override (blank uses the calculated yield)</label>
            <input id="wl-item-yield" className="wl-input" type="number" step="0.01" min="0" value={itemEditor.div_yield_override ?? ''} onChange={event => setItemEditor({ ...itemEditor, div_yield_override: event.target.value })} />
            <label className="wl-label" htmlFor="wl-item-nav">NAV erosion</label>
            <select id="wl-item-nav" className="wl-input" value={itemEditor.nav_erosion_scope || 'auto'} onChange={event => setItemEditor({ ...itemEditor, nav_erosion_scope: event.target.value })}>
              <option value="auto">Auto</option>
              <option value="test">Test</option>
              <option value="skip">Skip</option>
            </select>
            <label className="wl-label" htmlFor="wl-item-bench">Benchmark override</label>
            <input id="wl-item-bench" className="wl-input wl-input-wide" placeholder="QQQ, SPY, or BTC-USD+GLD" value={itemEditor.nav_benchmark_override || ''} onChange={event => setItemEditor({ ...itemEditor, nav_benchmark_override: event.target.value.toUpperCase() })} />
            <div className="wl-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setItemEditor(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveItem}>Save</button>
            </div>
          </div>
        </div>
      )}

      {chartTicker && <WatchlistTickerModal ticker={chartTicker} onClose={() => setChartTicker(null)} />}
    </div>
  )
}
