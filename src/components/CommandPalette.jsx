import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMarketRefresh } from '../context/MarketRefreshContext'
import { useMenuOrder } from '../context/MenuOrderContext'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import {
  PALETTE_EVENT,
  actionCatalogItems,
  isPaletteToggle,
  pageCatalogItems,
  paletteShortcutLabel,
  searchCatalog,
  tickerCatalogItems,
} from '../utils/commandPalette'

export default function CommandPalette() {
  const navigate = useNavigate()
  const pf = useProfileFetch()
  const { profiles, aggregates, basisMode, setProfileId, setBasisMode } = useProfile()
  const { isRefreshing, runMarketRefresh } = useMarketRefresh()
  const { hiddenIds } = useMenuOrder()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [tickers, setTickers] = useState([])
  const inputRef = useRef(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
  }, [])

  useEffect(() => {
    const onToggle = (event) => {
      if (!isPaletteToggle(event)) return
      event.preventDefault()
      setOpen(current => !current)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onToggle)
    window.addEventListener(PALETTE_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onToggle)
      window.removeEventListener(PALETTE_EVENT, onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [close, open])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([
      pf('/api/holdings').then(r => r.json()).catch(() => []),
      pf('/api/watchlist/watching').then(r => r.json()).catch(() => ({})),
    ]).then(([holdings, watching]) => {
      if (cancelled) return
      const rows = []
      ;(Array.isArray(holdings) ? holdings : []).forEach(row => {
        rows.push({
          ticker: row.ticker,
          source: 'holding',
          name: row.name || row.description || '',
        })
      })
      ;(watching.rows || []).forEach(row => {
        rows.push({ ticker: row.ticker, source: 'watchlist', name: row.notes || '' })
      })
      setTickers(rows)
    })
    return () => { cancelled = true }
  }, [open, pf])

  const pages = useMemo(() => pageCatalogItems(hiddenIds), [hiddenIds])
  const actions = useMemo(
    () => actionCatalogItems({ isRefreshing, basisMode, profiles, aggregates }),
    [aggregates, basisMode, isRefreshing, profiles],
  )
  const tickerItems = useMemo(() => tickerCatalogItems(tickers), [tickers])
  const results = useMemo(
    () => searchCatalog(query, { pages, actions, tickers: tickerItems }),
    [actions, pages, query, tickerItems],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query, open])

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1))
  }, [activeIndex, results.length])

  const runItem = useCallback((item) => {
    if (!item) return
    if (item.type === 'page' || item.path) navigate(item.path)
    if (item.action === 'refresh') runMarketRefresh()
    if (item.action === 'basis') setBasisMode(item.basisMode)
    if (item.action === 'profile') setProfileId(item.selection)
    close()
  }, [close, navigate, runMarketRefresh, setBasisMode, setProfileId])

  const onInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(index => Math.min(results.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runItem(results[activeIndex])
    }
  }

  if (!open) return null

  return createPortal(
    <div className="command-palette-overlay" onMouseDown={close} role="presentation">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="command-palette-input-row">
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages, tickers, or actions…"
            aria-label="Search pages, tickers, or actions"
            aria-controls="command-palette-results"
          />
          <kbd>{paletteShortcutLabel()}</kbd>
        </div>
        <ul id="command-palette-results" className="command-palette-results" role="listbox">
          {results.length === 0 && (
            <li className="command-palette-empty">No matches.</li>
          )}
          {results.map((item, index) => (
            <li key={item.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={index === activeIndex ? 'active' : ''}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runItem(item)}
              >
                <span className="command-palette-label">
                  {item.label}
                  {item.hidden && <span className="command-palette-hidden">Hidden</span>}
                </span>
                <span className="command-palette-hint">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
