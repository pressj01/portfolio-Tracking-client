export function resizeOptionStructure(legs, { edge, proposedStrike, chain, selectedExpiration }) {
  const included = legs.filter(leg => leg.included && Number(leg.strike) > 0)
  const strikes = [...new Set(included.map(leg => Number(leg.strike)))].sort((a, b) => a - b)
  if (strikes.length < 2) return legs

  const low = strikes[0]
  const high = strikes.at(-1)
  const center = (low + high) / 2
  const halfWidth = (high - low) / 2
  const rawScale = edge === 'low'
    ? (center - Number(proposedStrike)) / halfWidth
    : (Number(proposedStrike) - center) / halfWidth
  if (!Number.isFinite(rawScale)) return legs

  const availableStrikes = [...new Set([
    ...(chain?.calls || []).map(contract => Number(contract.strike)),
    ...(chain?.puts || []).map(contract => Number(contract.strike)),
  ].filter(Number.isFinite))].sort((a, b) => a - b)
  const availableSteps = availableStrikes.slice(1)
    .map((value, index) => value - availableStrikes[index])
    .filter(value => value > 0.0001)
  const strikeStep = availableSteps.length ? Math.min(...availableSteps) : 0.5
  const originalGaps = strikes.slice(1).map((value, index) => value - strikes[index]).filter(value => value > 0)
  const minimumScale = Math.max(0.02, strikeStep / Math.min(...originalGaps))
  const maximumScale = center > 0 ? Math.max(minimumScale, (center / halfWidth) * 0.98) : 100
  const scale = Math.max(minimumScale, Math.min(maximumScale, rawScale))
  const mappedStrikes = new Map(strikes.map(strike => {
    const target = center + (strike - center) * scale
    const snapped = center + Math.round((target - center) / strikeStep) * strikeStep
    return [strike, Number(snapped.toFixed(4))]
  }))

  const contractFor = (leg, strike) => {
    if (leg.expiration !== selectedExpiration) return null
    const contracts = leg.opt_type === 'CALL' ? chain?.calls || [] : chain?.puts || []
    return contracts.find(contract => Math.abs(Number(contract.strike) - strike) < 0.0001) || null
  }

  return legs.map(leg => {
    if (!leg.included) return leg
    const nextStrike = mappedStrikes.get(Number(leg.strike))
    if (!Number.isFinite(nextStrike)) return leg
    const contract = contractFor(leg, nextStrike)
    if (!contract) return { ...leg, strike: nextStrike }
    const marketEntry = leg.side === 'BUY' ? contract.ask : contract.bid
    return {
      ...leg,
      strike: Number(contract.strike),
      entry_price: Number(marketEntry ?? contract.mid ?? contract.last ?? leg.entry_price),
      iv: Number(contract.iv ?? leg.iv),
      delta: contract.delta ?? leg.delta,
    }
  })
}
