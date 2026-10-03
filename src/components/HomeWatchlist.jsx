import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfileFetch } from '../context/ProfileContext'
import { formatMoney } from '../utils/money'

function signedPct(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}

export default function HomeWatchlist() {
  const pf = useProfileFetch()
  const [entry, setEntry] = useState(null)
  const [market, setMarket] = useState({})

  useEffect(() => {
    let cancelled = false
    pf('/api/watchlists')
      .then(response => response.json())
      .then(data => {
        if (cancelled) return
        const lists = data.lists || []
        const home = lists.find(list => list.is_default) || lists[0] || null
        setEntry(home)
        setMarket(data.market || {})
        const tickers = (home?.items || []).map(item => item.ticker).slice(0, 40)
        if (!tickers.length) return
        pf('/api/watchlist/market/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers, part: 'quote' }),
        })
          .then(response => response.json())
          .then(refresh => {
            if (!cancelled && refresh.market) {
              setMarket(previous => ({ ...previous, ...refresh.market }))
            }
          })
          .catch(() => {})
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pf])

  if (!entry || !entry.items?.length) return null

  return (
    <div className="card home-watchlist">
      <div className="home-watchlist-head">
        <h3>Watchlist · {entry.name}</h3>
        <Link to="/watchlist">Edit list</Link>
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
