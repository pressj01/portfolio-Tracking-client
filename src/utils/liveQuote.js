// Live price for the Stock and ETF Analysis chart.
//
// The chart's bars are downloaded once. While the chart stays open it polls Yahoo's
// quote (GET /api/etf-screen/quote) and folds the price into the bars here, so the
// last candle, every moving average computed from the closes, and the price tag at
// the chart's right edge move with the market instead of freezing at load time.
//
// A quote is { price, open, day_high, day_low, volume, session: 'YYYY-MM-DD',
// time: 'YYYY-MM-DD HH:MM' } on New York time, the clock the bars are labelled in.

// Poll every 15 s while the regular session trades, once a minute otherwise
// (pre-market, after hours, weekends: the regular-session price is not moving).
export const LIVE_QUOTE_POLL_MS = 15000
export const LIVE_QUOTE_IDLE_MS = 60000

const INTRADAY_MINUTES = { '1m': 1, '2m': 2, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '90m': 90, '1h': 60 }
const SESSION_OPEN_MIN = 9 * 60 + 30
const SESSION_CLOSE_MIN = 16 * 60
const DAY_MS = 86400000

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const pad = (n) => String(n).padStart(2, '0')

/** How often to poll after a quote: fast while the regular session trades. */
export function liveQuotePollMs(quote) {
  const state = quote?.market_state
  return !state || state === 'REGULAR' ? LIVE_QUOTE_POLL_MS : LIVE_QUOTE_IDLE_MS
}

/**
 * The start of the intraday bar a New York time falls in ("YYYY-MM-DD HH:MM"),
 * bars counted from the 09:30 open. A print at or after the 16:00 close belongs
 * to the day's last bar; a pre-market time has no regular-session bar (null).
 */
export function intradayBarStart(time, minutes) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(time ?? ''))
  if (!m || !(minutes > 0)) return null
  const clock = Number(m[2]) * 60 + Number(m[3])
  if (clock < SESSION_OPEN_MIN) return null
  const within = Math.min(clock, SESSION_CLOSE_MIN - 1) - SESSION_OPEN_MIN
  const start = SESSION_OPEN_MIN + Math.floor(within / minutes) * minutes
  return `${m[1]} ${pad(Math.floor(start / 60))}:${pad(start % 60)}`
}

const dayMs = (date) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''))
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN
}

/** Months from one bar date to another ("2026-01-..." to "2026-03-..." is 2). */
const monthsBetween = (from, to) => {
  const a = /^(\d{4})-(\d{2})/.exec(String(from ?? ''))
  const b = /^(\d{4})-(\d{2})/.exec(String(to ?? ''))
  return a && b ? (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) : NaN
}

/**
 * The bar with the live price folded in. `dayRange` lets the quote's session
 * high and low widen it (a daily or longer bar contains the whole session);
 * `volume` replaces its volume (only a daily bar's volume is the session's).
 */
function withPrice(bar, quote, { dayRange, volume }) {
  const price = quote.price
  const highs = [bar.high, price]
  const lows = [bar.low, price]
  if (dayRange && finite(quote.day_high)) highs.push(quote.day_high)
  if (dayRange && finite(quote.day_low)) lows.push(quote.day_low)
  const next = {
    ...bar,
    close: price,
    high: Math.max(...highs.filter(finite)),
    low: Math.min(...lows.filter(finite)),
  }
  if (volume && finite(quote.volume) && quote.volume > 0) next.volume = Math.max(bar.volume || 0, quote.volume)
  return next
}

const sameBar = (a, b) => a.close === b.close && a.high === b.high && a.low === b.low && a.volume === b.volume

/**
 * The loaded bars with a live quote folded into them, by bar size (`interval`):
 *  - daily: the quote's session updates the last bar, or opens a new one when the
 *    session is newer than it (the chart was left open overnight);
 *  - weekly / monthly / quarterly: the quote updates the last bar while its session
 *    falls inside it; a new period's bar waits for a reload, as its open is unknown;
 *  - intraday: the bar the quote's time falls in is updated, or appended when it is
 *    newer than the last one.
 * A quote older than the last bar, or one that changes nothing, returns `records`
 * itself, so memos keyed on the bars do not re-run.
 */
export function mergeLiveQuote(records, quote, interval) {
  if (!Array.isArray(records) || !records.length || !quote || !finite(quote.price) || quote.price <= 0) return records
  const n = records.length
  const last = records[n - 1]
  if (!last || !last.date) return records
  const replaceLast = (bar) => (sameBar(bar, last) ? records : [...records.slice(0, -1), bar])

  const minutes = INTRADAY_MINUTES[interval]
  if (minutes) {
    const start = intradayBarStart(quote.time, minutes)
    if (!start || start < last.date) return records
    if (start === last.date) return replaceLast(withPrice(last, quote, { dayRange: false, volume: false }))
    const p = quote.price
    return [...records, { date: start, open: p, high: p, low: p, close: p, volume: 0 }]
  }

  const session = String(quote.session ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) return records
  const lastDay = String(last.date).slice(0, 10)

  if (interval === '1wk' || interval === '1mo' || interval === '3mo') {
    const inside = interval === '1wk'
      ? dayMs(session) - dayMs(lastDay) >= 0 && dayMs(session) - dayMs(lastDay) < 7 * DAY_MS
      : (() => {
        const months = monthsBetween(lastDay, session)
        return session >= lastDay && months >= 0 && months < (interval === '3mo' ? 3 : 1)
      })()
    return inside ? replaceLast(withPrice(last, quote, { dayRange: true, volume: false })) : records
  }

  // Daily bars (and anything unrecognised, which the backend sends as daily).
  if (session < lastDay) return records
  if (session === lastDay) return replaceLast(withPrice(last, quote, { dayRange: true, volume: true }))
  const p = quote.price
  const open = finite(quote.open) ? quote.open : p
  return [...records, {
    date: session,
    open,
    high: Math.max(open, p, finite(quote.day_high) ? quote.day_high : -Infinity),
    low: Math.min(open, p, finite(quote.day_low) ? quote.day_low : Infinity),
    close: p,
    volume: finite(quote.volume) ? quote.volume : 0,
  }]
}

/**
 * Where the tags at the chart's edge go, in axis units. The price tag sits at the
 * price. Each other tag (a moving average) sits at its own value unless that would
 * overlap a neighbour, in which case it moves away from the price one tag height
 * (`gap`) at a time: a tag for a value above the price stays above the price tag
 * and one below stays below. `lo` / `hi` keep each stack inside the pane where it
 * fits. Returns the other tags' positions in input order.
 */
export function stackAxisTags(priceY, values, gap, lo = -Infinity, hi = Infinity) {
  const out = values.slice()
  const anchored = finite(priceY)
  const idx = values.map((v, i) => i).filter(i => finite(values[i]))
  const above = idx.filter(i => !anchored || values[i] >= priceY).sort((a, b) => values[a] - values[b])
  const below = idx.filter(i => anchored && values[i] < priceY).sort((a, b) => values[b] - values[a])

  let cursor = anchored ? priceY : -Infinity
  above.forEach(i => { out[i] = Math.max(values[i], cursor + gap); cursor = out[i] })
  for (let k = above.length - 1; k >= 0; k -= 1) {
    const cap = k === above.length - 1 ? hi - gap / 2 : out[above[k + 1]] - gap
    out[above[k]] = Math.min(out[above[k]], cap)
  }

  cursor = priceY
  below.forEach(i => { out[i] = Math.min(values[i], cursor - gap); cursor = out[i] })
  for (let k = below.length - 1; k >= 0; k -= 1) {
    const floor = k === below.length - 1 ? lo + gap / 2 : out[below[k + 1]] + gap
    out[below[k]] = Math.max(out[below[k]], floor)
  }
  return out
}

/** Black or white, whichever reads better on a #rrggbb tag fill. */
export function tagTextColor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? ''))
  if (!m) return '#ffffff'
  const lin = (c) => {
    const s = parseInt(c, 16) / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const lum = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3])
  // Contrast against black is (L + 0.05) / 0.05 and against white 1.05 / (L + 0.05).
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#000000' : '#ffffff'
}

/** The last finite value of a series, or null. */
export function lastFinite(values) {
  if (!Array.isArray(values)) return null
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (finite(values[i])) return values[i]
  }
  return null
}
