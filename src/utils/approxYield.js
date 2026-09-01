// Approximate a fund's current annualized distribution yield from its recent
// distribution history. Used as a reliable replacement for Yahoo's reported
// dividend yield, which is wrong for option-income ETFs (e.g. SPYI shows
// ~0.5% vs a real ~12%). Returns a percentage (e.g. 12.01), or null.

export function annualDistributionMultiplier(frequency, history) {
  const freq = String(frequency || '').trim().toLowerCase()
  if (['d', 'daily', '252'].includes(freq)) return 252
  if (['w', 'weekly', '52'].includes(freq)) return 52
  if (['m', 'monthly', '12'].includes(freq)) return 12
  if (['q', 'quarterly', '4'].includes(freq)) return 4
  if (['sa', 'semi-annually', 'semiannually', 'semiannual', 'semi-annual', '2'].includes(freq)) return 2
  if (['a', 'annual', 'annually', 'yearly', '1'].includes(freq)) return 1

  const dated = (Array.isArray(history) ? history : [])
    .map(item => ({ ...item, dateValue: new Date(item?.date).getTime() }))
    .filter(item => Number.isFinite(item.dateValue))
    .sort((a, b) => b.dateValue - a.dateValue)
  if (dated.length < 2) return 4
  const gapDays = Math.abs(dated[0].dateValue - dated[1].dateValue) / (24 * 60 * 60 * 1000)
  if (gapDays <= 3) return 252
  if (gapDays <= 10) return 52
  if (gapDays <= 45) return 12
  if (gapDays <= 115) return 4
  if (gapDays <= 240) return 2
  return 1
}

export function annualDistributionEstimate(history, frequency) {
  const distributions = (Array.isArray(history) ? history : [])
    .map(item => ({
      amount: Number(item?.amount),
      dateValue: new Date(item?.date).getTime(),
    }))
    .filter(item => (
      Number.isFinite(item.amount)
      && item.amount > 0
      && Number.isFinite(item.dateValue)
    ))
    .sort((a, b) => b.dateValue - a.dateValue)

  if (!distributions.length) return null

  const multiplier = annualDistributionMultiplier(frequency, history)
  // A fund that recently changed to weekly/monthly should use only the
  // uninterrupted run at its current cadence; older quarterly payments would
  // otherwise dilute the estimate.
  let recentRun = distributions
  if (multiplier === 252 || multiplier === 52 || multiplier === 12) {
    const [minGap, maxGap] = multiplier === 252 ? [0.5, 5] : multiplier === 52 ? [3, 14] : [15, 45]
    recentRun = [distributions[0]]
    for (let idx = 1; idx < distributions.length; idx += 1) {
      const gapDays = Math.abs(
        distributions[idx - 1].dateValue - distributions[idx].dateValue,
      ) / 86400000
      if (gapDays < minGap || gapDays > maxGap) break
      recentRun.push(distributions[idx])
    }
  }

  const fullCycle = recentRun.slice(0, multiplier)
  if (fullCycle.length >= multiplier) {
    return {
      annual: fullCycle.reduce((sum, item) => sum + item.amount, 0),
      basis: `latest ${multiplier} distributions`,
      multiplier,
    }
  }

  const sample = recentRun.slice(0, 10)
  const average = sample.reduce((sum, item) => sum + item.amount, 0) / sample.length
  return {
    annual: average * multiplier,
    basis: `${sample.length} recent distribution${sample.length === 1 ? '' : 's'} annualized (×${multiplier})`,
    multiplier,
  }
}

export function approxYieldFromCurrentDistributions(profile) {
  const price = Number(profile?.price)
  if (!Number.isFinite(price) || price <= 0) return null

  const estimate = annualDistributionEstimate(
    profile?.distribution_history,
    profile?.distribution_frequency,
  )
  return estimate ? (estimate.annual / price) * 100 : null
}
