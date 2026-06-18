// Approximate a fund's current annualized distribution yield from its recent
// distribution history. Used as a reliable replacement for Yahoo's reported
// dividend yield, which is wrong for option-income ETFs (e.g. SPYI shows
// ~0.5% vs a real ~12%). Returns a percentage (e.g. 12.01), or null.

export function annualDistributionMultiplier(frequency, history) {
  const freq = String(frequency || '').trim().toLowerCase()
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
  if (gapDays <= 10) return 52
  if (gapDays <= 45) return 12
  if (gapDays <= 115) return 4
  if (gapDays <= 240) return 2
  return 1
}

export function approxYieldFromCurrentDistributions(profile) {
  const price = Number(profile?.price)
  if (!Number.isFinite(price) || price <= 0) return null

  const latest = (Array.isArray(profile?.distribution_history) ? profile.distribution_history : [])
    .map(item => ({
      amount: Number(item?.amount),
      dateValue: new Date(item?.date).getTime(),
    }))
    .filter(item => Number.isFinite(item.amount) && item.amount > 0)
    .sort((a, b) => {
      const aDate = Number.isFinite(a.dateValue) ? a.dateValue : 0
      const bDate = Number.isFinite(b.dateValue) ? b.dateValue : 0
      return bDate - aDate
    })
    .slice(0, 10)

  if (!latest.length) return null
  const avgDistribution = latest.reduce((sum, item) => sum + item.amount, 0) / latest.length
  const multiplier = annualDistributionMultiplier(profile?.distribution_frequency, profile?.distribution_history)
  return (avgDistribution * multiplier / price) * 100
}
