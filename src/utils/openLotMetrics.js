const numberOrZero = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const buyCost = transaction => (
  Math.abs(numberOrZero(transaction.shares)) * numberOrZero(transaction.price_per_share)
  + numberOrZero(transaction.fees)
)

/**
 * Build the broker-style view of the BUY lots that are still open.
 *
 * Transaction history owns the remaining shares for each lot. Holdings owns
 * the selected (original or broker-adjusted) aggregate basis. Brokers do not
 * always export their wash-sale adjustment per lot, so when the lot shares
 * reconcile to the holding we allocate any small aggregate basis difference
 * proportionally. That keeps the lot footer identical to the Holdings row.
 */
export function buildOpenLotMetrics(transactions, holding) {
  const currentPrice = numberOrZero(holding?.current_price)
  const holdingShares = numberOrZero(holding?.quantity)
  const selectedBasis = numberOrZero(holding?.purchase_value)
  const selectedCurrentValue = numberOrZero(holding?.current_value)
  const sourceRows = Array.isArray(transactions) ? transactions : []

  const rows = sourceRows
    .filter(transaction => (
      transaction?.record_type !== 'dividend'
      && String(transaction?.transaction_type || 'BUY').toUpperCase() === 'BUY'
      && numberOrZero(transaction?.shares_remaining) > 1e-9
    ))
    .map(transaction => {
      const originalShares = Math.abs(numberOrZero(transaction.shares))
      const shares = numberOrZero(transaction.shares_remaining)
      const rawBasis = originalShares > 0
        ? buyCost(transaction) * (shares / originalShares)
        : 0
      return {
        ...transaction,
        shares,
        raw_basis: rawBasis,
      }
    })
    .sort((left, right) => {
      const dateOrder = String(left.transaction_date || '').localeCompare(String(right.transaction_date || ''))
      if (dateOrder !== 0) return dateOrder
      return numberOrZero(left.id) - numberOrZero(right.id)
    })

  const lotShares = rows.reduce((sum, row) => sum + row.shares, 0)
  const rawBasis = rows.reduce((sum, row) => sum + row.raw_basis, 0)
  const shareTolerance = Math.max(1e-6, Math.abs(holdingShares) * 1e-8)
  const sharesMatchHolding = rows.length > 0 && Math.abs(lotShares - holdingShares) <= shareTolerance
  const canUseSelectedBasis = sharesMatchHolding && selectedBasis > 0 && rawBasis > 0
  const basisScale = canUseSelectedBasis ? selectedBasis / rawBasis : 1
  const basisAdjusted = canUseSelectedBasis && Math.abs(selectedBasis - rawBasis) >= 0.005
  const rawMarketValue = lotShares * currentPrice
  const canUseSelectedCurrentValue = sharesMatchHolding && selectedCurrentValue > 0 && rawMarketValue > 0
  const marketValueScale = canUseSelectedCurrentValue ? selectedCurrentValue / rawMarketValue : 1

  const measuredRows = rows.map(row => {
    const costBasis = row.raw_basis * basisScale
    const marketValue = row.shares * currentPrice * marketValueScale
    const gainLoss = marketValue - costBasis
    return {
      ...row,
      cost_basis: costBasis,
      cost_per_share: row.shares > 0 ? costBasis / row.shares : 0,
      current_price: currentPrice,
      market_value: marketValue,
      gain_loss: gainLoss,
      gain_loss_pct: costBasis > 0 ? (gainLoss / costBasis) * 100 : null,
    }
  })

  const costBasis = measuredRows.reduce((sum, row) => sum + row.cost_basis, 0)
  const marketValue = measuredRows.reduce((sum, row) => sum + row.market_value, 0)
  const gainLoss = marketValue - costBasis

  return {
    rows: measuredRows,
    basis_adjusted: basisAdjusted,
    shares_match_holding: sharesMatchHolding,
    totals: {
      shares: lotShares,
      cost_basis: costBasis,
      market_value: marketValue,
      gain_loss: gainLoss,
      gain_loss_pct: costBasis > 0 ? (gainLoss / costBasis) * 100 : null,
    },
  }
}
