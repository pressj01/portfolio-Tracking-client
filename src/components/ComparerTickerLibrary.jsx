import { useEffect, useMemo, useState } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import {
  mergeTickerLists,
  normalizePortfolioHoldings,
  readSavedTickers,
  uniqueTickers,
} from '../utils/comparerTickerLibrary'
import { formatMoneyWhole } from '../utils/money'

function formatHoldingValue(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return ''
  return formatMoneyWhole(amount)
}

export default function ComparerTickerLibrary({
  symbols,
  storageKey,
  securityLabel,
  onAddSymbols,
}) {
  const pf = useProfileFetch()
  const { currentProfileName } = useProfile()
  const activeSymbols = useMemo(() => new Set(uniqueTickers(symbols)), [symbols])
  const [savedTickers, setSavedTickers] = useState(() => readSavedTickers(storageKey))
  const [panel, setPanel] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [portfolioHoldings, setPortfolioHoldings] = useState([])
  const [loadingPortfolio, setLoadingPortfolio] = useState(false)
  const [portfolioError, setPortfolioError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(savedTickers))
    } catch {
      // Saved tickers are a convenience; comparison still works if storage is unavailable.
    }
  }, [savedTickers, storageKey])

  useEffect(() => {
    if (panel !== 'portfolio') return undefined

    const controller = new AbortController()
    setLoadingPortfolio(true)
    setPortfolioError('')

    pf('/api/portfolio-tester/holdings', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Could not load portfolio holdings.')
        return response.json()
      })
      .then(data => setPortfolioHoldings(normalizePortfolioHoldings(data?.holdings)))
      .catch(error => {
        if (error.name !== 'AbortError') {
          setPortfolioHoldings([])
          setPortfolioError(error.message || 'Could not load portfolio holdings.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPortfolio(false)
      })

    return () => controller.abort()
  }, [panel, pf])

  const unsavedCount = symbols.filter(symbol => !savedTickers.includes(symbol)).length
  const entries = useMemo(() => {
    if (panel === 'saved') {
      return savedTickers.map(ticker => ({ ticker, description: '', categories: [], current_value: null }))
    }
    return portfolioHoldings
  }, [panel, portfolioHoldings, savedTickers])

  const visibleEntries = useMemo(() => {
    const query = search.trim().toUpperCase()
    if (!query) return entries
    return entries.filter(entry => (
      `${entry.ticker} ${entry.description || ''} ${(entry.categories || []).join(' ')}`
        .toUpperCase()
        .includes(query)
    ))
  }, [entries, search])

  const selectedCount = [...selected].filter(ticker => !activeSymbols.has(ticker)).length

  const togglePanel = (nextPanel) => {
    setPanel(current => current === nextPanel ? '' : nextPanel)
    setSearch('')
    setSelected(new Set())
    setPortfolioError('')
    setStatus('')
  }

  const saveCurrentTickers = () => {
    const next = mergeTickerLists(savedTickers, symbols)
    const added = next.length - savedTickers.length
    setSavedTickers(next)
    setStatus(added ? `${added} ${added === 1 ? 'ticker' : 'tickers'} saved.` : 'All current tickers are already saved.')
  }

  const toggleTicker = (ticker) => {
    if (activeSymbols.has(ticker)) return
    setSelected(current => {
      const next = new Set(current)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  const selectVisible = () => {
    setSelected(current => new Set([
      ...current,
      ...visibleEntries.filter(entry => !activeSymbols.has(entry.ticker)).map(entry => entry.ticker),
    ]))
  }

  const removeSavedTicker = (ticker) => {
    setSavedTickers(current => current.filter(symbol => symbol !== ticker))
    setSelected(current => {
      const next = new Set(current)
      next.delete(ticker)
      return next
    })
  }

  const addSelectedTickers = () => {
    const additions = entries
      .map(entry => entry.ticker)
      .filter(ticker => selected.has(ticker) && !activeSymbols.has(ticker))
    if (!additions.length) return
    onAddSymbols(additions)
    setStatus(`${additions.length} ${additions.length === 1 ? 'ticker' : 'tickers'} added from ${panel === 'saved' ? 'saved tickers' : currentProfileName}.`)
    setPanel('')
    setSelected(new Set())
  }

  const panelTitle = panel === 'saved' ? 'Saved tickers' : `Holdings in ${currentProfileName}`
  const panelDescription = panel === 'saved'
    ? `Choose saved ${securityLabel} to add to this comparison.`
    : 'Select one or more holdings from the portfolio currently active in the app.'

  return (
    <div className="etfc-ticker-library">
      <div className="etfc-library-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={saveCurrentTickers}
          disabled={!symbols.length || unsavedCount === 0}
          title={!symbols.length ? `Add ${securityLabel} before saving` : 'Keep the current tickers for future comparisons'}
        >
          {symbols.length && unsavedCount === 0 ? 'Current Tickers Saved' : 'Save Current Tickers'}
        </button>
        <button
          type="button"
          className={`btn btn-sm${panel === 'saved' ? ' btn-active' : ''}`}
          onClick={() => togglePanel('saved')}
          aria-expanded={panel === 'saved'}
        >
          Saved Tickers ({savedTickers.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm${panel === 'portfolio' ? ' btn-active' : ''}`}
          onClick={() => togglePanel('portfolio')}
          aria-expanded={panel === 'portfolio'}
        >
          From Portfolio
        </button>
        {status && <span className="etfc-library-status" role="status">{status}</span>}
      </div>

      {panel && (
        <div className="etfc-library-panel">
          <div className="etfc-library-head">
            <div>
              <strong>{panelTitle}</strong>
              <span>{panelDescription}</span>
            </div>
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search tickers..."
              aria-label={`Search ${panelTitle.toLowerCase()}`}
            />
          </div>

          <div className="etfc-library-tools">
            <button type="button" className="btn btn-sm" onClick={selectVisible} disabled={!visibleEntries.some(entry => !activeSymbols.has(entry.ticker))}>Select Visible</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())} disabled={!selected.size}>Deselect All</button>
          </div>

          <div className="etfc-library-list">
            {loadingPortfolio && <div className="etfc-library-empty">Loading portfolio holdings...</div>}
            {!loadingPortfolio && portfolioError && <div className="etfc-library-empty etfc-library-error">{portfolioError}</div>}
            {!loadingPortfolio && !portfolioError && visibleEntries.map(entry => {
              const isActive = activeSymbols.has(entry.ticker)
              const description = entry.description || (entry.categories || []).join(', ') || (panel === 'portfolio' ? 'Current portfolio holding' : '')
              return (
                <div className={`etfc-library-row${isActive ? ' is-active' : ''}`} key={entry.ticker}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.ticker)}
                      disabled={isActive}
                      onChange={() => toggleTicker(entry.ticker)}
                    />
                    <strong>{entry.ticker}</strong>
                    {description && <span className="etfc-library-description">{description}</span>}
                  </label>
                  <div className="etfc-library-row-meta">
                    {isActive && <span className="etfc-library-badge">In comparison</span>}
                    {panel === 'portfolio' && <span>{formatHoldingValue(entry.current_value)}</span>}
                    {panel === 'saved' && (
                      <button type="button" onClick={() => removeSavedTicker(entry.ticker)} aria-label={`Remove ${entry.ticker} from saved tickers`}>Remove</button>
                    )}
                  </div>
                </div>
              )
            })}
            {!loadingPortfolio && !portfolioError && !visibleEntries.length && (
              <div className="etfc-library-empty">
                {search
                  ? 'No tickers match that search.'
                  : panel === 'saved'
                    ? 'No saved tickers yet. Add tickers above, then choose Save Current Tickers.'
                    : `No current holdings were found in ${currentProfileName}.`}
              </div>
            )}
          </div>

          <div className="etfc-library-foot">
            <span>{selectedCount} selected</span>
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setPanel('')}>Cancel</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={addSelectedTickers} disabled={!selectedCount}>Add Tickers</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
