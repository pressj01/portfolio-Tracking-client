// TR/Und: a fund's total return ÷ its underlying's total return for the
// selected market window. The backend NAV assessment measures both on the same
// dates with distributions reinvested (`row.underlying`), using the fund's own
// documented exposure: never the NAV screen's Include (manual) benchmark, which
// can be a legacy default unrelated to the fund (QQQ for CHPY). When the
// underlying fell or rose less than 2%, a ratio flips sign or explodes, so only
// the gap in points is given. Stocks, BDCs, skipped funds, and funds younger
// than the window leave the cell blank or N/A rather than inventing a number.

function finite(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formatDate(value) {
  const iso = String(value || '').slice(0, 10)
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return iso || null
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`
}

function signedPct(value) {
  const n = finite(value)
  if (n == null) return null
  const pctValue = n * 100
  const sign = pctValue > 0 ? '+' : ''
  return `${sign}${pctValue.toFixed(2)}%`
}

export function formatGapPoints(gap) {
  const n = finite(gap)
  if (n == null) return null
  const points = n * 100
  return `${points > 0 ? '+' : ''}${points.toFixed(1)} pts`
}

function blank(extra = {}) {
  return {
    ratio: null,
    gap: null,
    fundReturn: null,
    underlyingReturn: null,
    reference: null,
    insufficientHistory: false,
    lifetimeRange: false,
    historyStart: null,
    historyEnd: null,
    requestedStart: null,
    periodLabel: null,
    note: 'Fund total return vs its underlying is unavailable for this ticker or range.',
    ...extra,
  }
}

function windowLabel(periodLabel) {
  return periodLabel ? `the ${periodLabel} window` : 'the selected range'
}

function insufficientNote({ periodLabel, historyStart, requestedStart }) {
  const window = windowLabel(periodLabel)
  const start = formatDate(historyStart)
  const requested = formatDate(requestedStart)
  if (start && requested) {
    return `N/A — this ETF has not been around long enough for ${window}. Its history starts ${start}, after the range start ${requested}.`
  }
  if (start) {
    return `N/A — this ETF has not been around long enough for ${window}. Its history starts ${start}.`
  }
  return `N/A — this ETF has not been around long enough for ${window}.`
}

// Why this underlying, in the hover: how close a match it is, and where it came from.
function underlyingNote(und, reference) {
  const fit = String(und.fit || '').trim()
  if (und.source === 'manual') {
    return `${reference} is your Include (manual) benchmark, used because this fund has no documented underlying.`
  }
  if (und.source === 'saved') return `${reference} is the reference you saved for this fund.`
  const why = String(und.why || '').trim()
  const lead = fit ? `${reference}: ${fit.charAt(0).toLowerCase()}${fit.slice(1)}` : reference
  return why ? `${lead}. ${why}` : `${lead}.`
}

export function fundUnderlyingReturn(meta, options = {}) {
  if (options.lifetimeRange) {
    return blank({
      lifetimeRange: true,
      note: 'N/A — TR/Und follows market windows such as YTD, 1Y, or 5Y, not Open G/L.',
    })
  }

  const requestedStart = options.requestedStart || null
  const periodLabel = options.periodLabel || null
  const und = meta?.underlying
  if (!und) {
    return blank({ requestedStart, periodLabel })
  }

  const reference = String(und.selected || '').trim() || null
  const historyStart = und.start || null
  const historyEnd = und.end || null
  const context = { reference, historyStart, historyEnd, requestedStart, periodLabel }

  if (und.status !== 'available') {
    return blank({ ...context, note: und.reason || blank().note })
  }
  if (und.shorter_history) {
    return blank({
      ...context,
      insufficientHistory: true,
      note: insufficientNote({ periodLabel, historyStart, requestedStart }),
    })
  }

  const fundReturn = finite(und.fund_return)
  const underlyingReturn = finite(und.underlying_return)
  if (fundReturn == null || underlyingReturn == null) {
    return blank(context)
  }
  const ratio = finite(und.ratio)
  const gap = fundReturn - underlyingReturn
  const start = formatDate(historyStart)
  const end = formatDate(historyEnd)
  const dates = start && end ? ` (${start} to ${end})` : ''
  const name = reference || 'underlying'
  const measured = `Fund total return ${signedPct(fundReturn)} / ${name} ${signedPct(underlyingReturn)} over ${windowLabel(periodLabel)}${dates}, distributions reinvested.`
  const floor = (finite(und.ratio_floor) ?? 0.02) * 100
  const gapOnly = ratio == null
    ? ` ${name} ${underlyingReturn < 0 ? 'fell' : `rose less than ${floor.toFixed(0)}%`}, so a ratio would mislead; the cell shows the gap instead (${formatGapPoints(gap)}).`
    : ''

  return {
    ratio,
    gap,
    fundReturn,
    underlyingReturn,
    reference,
    insufficientHistory: false,
    lifetimeRange: false,
    historyStart,
    historyEnd,
    requestedStart,
    periodLabel,
    note: `${measured}${gapOnly} ${underlyingNote(und, name)}`,
  }
}
