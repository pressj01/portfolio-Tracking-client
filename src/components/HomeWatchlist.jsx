import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfileFetch } from '../context/ProfileContext'
import { formatMoney } from '../utils/money'
import { readHomeWatchlistHidden, writeHomeWatchlistHidden } from '../utils/homeWatchlistPreference'

function signedPct(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}

export default function HomeWatchlist() {
  const pf = useProfileFetch()
  const [lists, setLists] = useState([])
  const [market, setMarket] = useState({})
  const [hidden, setHidden] = useState(readHomeWatchlistHidden)
  const [loaded, setLoaded] = useState(false)
  // Answers that arrive after the card is hidden or unmounted are dropped.
  const alive = useRef(false)

  const refreshQuotes = useCallback((list) => {
    const tickers = (list?.items || []).map(item => item.ticker).slice(0, 40)
    if (!tickers.length) return
    pf('/api/watchlist/market/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, part: 'quote' }),
    })
      .then(response => response.json())
      .then(refresh => {
        if (alive.current && refresh.market) {
          setMarket(previous => ({ ...previous, ...refresh.market }))
        }
      })
      .catch(() => {})
  }, [pf])

  const load = useCallback(() => (
    pf('/api/watchlists')
      .then(response => response.json())
      .then(data => {
        if (!alive.current) return
        const next = data.lists || []
        setLists(next)
        setMarket(data.market || {})
        setLoaded(true)
        refreshQuotes(next.find(list => list.is_default) || next[0])
      })
      .catch(() => {})
  ), [pf, refreshQuotes])

  useEffect(() => {
    // A hidden card asks for nothing: no list, no quotes.
    if (hidden) return undefined
    alive.current = true
    load()
    return () => { alive.current = false }
  }, [hidden, load])

  const hide = () => {
    writeHomeWatchlistHidden(true)
    setHidden(true)
  }

  const show = () => {
    writeHomeWatchlistHidden(false)
    setLoaded(false)
    setHidden(false)
  }

  // The list shown here is the one marked Home, so choosing another list moves
  // that mark. The Watchlists page and this card then always agree.
  const pick = (id) => {
    const chosen = lists.find(list => list.id === id)
    if (!chosen || chosen.is_default) return
    setLists(previous => previous.map(list => ({ ...list, is_default: list.id === id })))
    refreshQuotes(chosen)
    pf(`/api/watchlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: true }),
    })
      .then(response => { if (!response.ok) throw new Error('save failed') })
      // The choice did not stick, so show what is actually saved.
      .catch(() => { if (alive.current) load() })
  }

  // Hidden is the default, so this link is the only trace of the feature on
  // the Dashboard. It is plain text: no request is made until it is clicked.
  if (hidden) {
    return (
      <div className="home-watchlist-show">
        <button type="button" onClick={show} title="Show your Home watchlist on the Dashboard">
          Show watchlist
        </button>
      </div>
    )
  }

  if (!loaded) return null

  const entry = lists.find(list => list.is_default) || lists[0] || null
  const picker = lists.length > 1 && (
    <select
      className="home-watchlist-picker"
      value={entry.id}
      onChange={event => pick(Number(event.target.value))}
      aria-label="Watchlist shown on the Dashboard"
      title="Choose which watchlist the Dashboard shows"
    >
      {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
    </select>
  )

  // Turned on with nothing to show: say so, or the link would simply vanish.
  if (!entry || !entry.items?.length) {
    return (
      <div className="card home-watchlist">
        <div className="home-watchlist-head">
          <h3>Watchlist{picker && <> · {picker}</>}</h3>
          <span className="home-watchlist-actions">
            <Link to="/watchlist">{entry ? 'Add tickers' : 'Create a watchlist'}</Link>
            <button type="button" className="home-watchlist-hide" onClick={hide}>Hide</button>
          </span>
        </div>
        <p className="home-watchlist-more">
          {entry ? `${entry.name} has no tickers yet.` : 'You have no watchlists yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className="card home-watchlist">
      <div className="home-watchlist-head">
        <h3>Watchlist · {picker || entry.name}</h3>
        <span className="home-watchlist-actions">
          <Link to="/watchlist">Edit list</Link>
          <button
            type="button"
            className="home-watchlist-hide"
            onClick={hide}
            title="Remove the watchlist from the Dashboard. Show watchlist brings it back."
          >
            Hide
          </button>
        </span>
      </div>
      <table className="home-watchlist-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Name</th>
            <th>Price</th>
            <th>Daily</th>
            <th>Yield</th>
          </tr>
        </thead>
        <tbody>
          {entry.items.slice(0, 8).map(item => {
            const quote = market[item.ticker] || {}
            const daily = quote.change_1d
            return (
              <tr key={item.ticker}>
                <td>{item.ticker}</td>
                <td>{quote.name || item.name || '—'}</td>
                <td>{formatMoney(quote.price)}</td>
                <td className={daily == null ? '' : daily >= 0 ? 'pct-up' : 'pct-down'}>{signedPct(daily)}</td>
                <td>{quote.div_yield == null ? '—' : `${Number(quote.div_yield).toFixed(2)}%`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {entry.items.length > 8 && (
        <p className="home-watchlist-more">{entry.items.length - 8} more on the watchlist page.</p>
      )}
    </div>
  )
}
