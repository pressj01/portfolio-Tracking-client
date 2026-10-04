// Whether the Dashboard shows the watchlist card. Per-computer, like the
// Dashboard's other display choices. The card starts hidden: not everyone
// keeps a watchlist, and a hidden card is not rendered and makes none of its
// requests, so it costs the Dashboard no load time until someone opts in.
const HOME_WATCHLIST_SHOWN_KEY = 'dashboard_watchlist_shown_v1'

export function readHomeWatchlistHidden() {
  try {
    return window.localStorage.getItem(HOME_WATCHLIST_SHOWN_KEY) !== '1'
  } catch {
    return true
  }
}

export function writeHomeWatchlistHidden(hidden) {
  try {
    if (hidden) window.localStorage.removeItem(HOME_WATCHLIST_SHOWN_KEY)
    else window.localStorage.setItem(HOME_WATCHLIST_SHOWN_KEY, '1')
  } catch {
    // Storage unavailable: the choice simply lasts until the page reloads.
  }
}
