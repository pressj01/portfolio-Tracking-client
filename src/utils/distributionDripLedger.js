// Value all shares purchased by reinvesting in the selected range at the
// latest available close, even when the last payment was months ago.
export function summarizeReinvestment(rows = [], statuses = []) {
  const latestCloses = new Map(statuses.map(status => [status.ticker, status.latest_close]))
  const out = new Map()
  for (const row of rows) {
    const entry = out.get(row.ticker) || { reinvested: 0, shares: 0 }
    entry.reinvested += Number(row.drip_amount) || 0
    entry.shares += Number(row.shares_bought) || 0
    out.set(row.ticker, entry)
  }
  for (const [ticker, entry] of out) {
    const close = latestCloses.get(ticker)
    entry.value = close == null ? null : entry.shares * close
  }
  return out
}
