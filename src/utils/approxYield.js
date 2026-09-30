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

// A payment this close to a neighbour (as a share of the cadence's nominal
// period) is an extra paid alongside the regular one, not another period.
const EXTRA_DISTRIBUTION_GAP_FRACTION = 0.4
const DAY_MS = 86400000

// Year-end capital-gains true-ups and special dividends arrive on top of the
// regular payment, a few weeks apart: SCHG paid $0.0286 on 2021-12-08 and a
// $0.0051 stub on 12-30. Counting the stub as its own period used it up as one
// of the "latest 4" quarters and pushed the real December payment out, so the
// yield read a third too low for a year. Fold each extra into the payment it
// accompanies so a period is counted once, with everything paid in it.
//
// Only cadences slow enough to have no run-detection of their own get this.
// Monthly and faster funds already break their run on a short gap, on purpose,
// so a fund that changed cadence isn't diluted by its old payments — merging
// there would glue a former weekly fund's payments into monthly-sized lumps.
//
// Clusters are anchored on the newest payment rather than chained: a fund that
// was monthly before going quarterly would otherwise collapse into one lump.
function foldExtraDistributions(distributions, multiplier) {
  if (multiplier > 4) return distributions
  const maxGap = (365 / multiplier) * EXTRA_DISTRIBUTION_GAP_FRACTION * DAY_MS
  const periods = []
  let anchor = null
  for (const item of distributions) {
    if (anchor && anchor.dateValue - item.dateValue <= maxGap) {
      anchor.amount += item.amount
      anchor.parts += 1
    } else {
      anchor = { ...item, parts: 1 }
      periods.push(anchor)
    }
  }
  return periods
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
  let recentRun = foldExtraDistributions(distributions, multiplier)
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

  const foldedNote = used => (
    used.some(item => item.parts > 1) ? ', extra payments counted with their period' : ''
  )

  const fullCycle = recentRun.slice(0, multiplier)
  if (fullCycle.length >= multiplier) {
    return {
      annual: fullCycle.reduce((sum, item) => sum + item.amount, 0),
      basis: `latest ${multiplier} distributions${foldedNote(fullCycle)}`,
      multiplier,
    }
  }

  const sample = recentRun.slice(0, 10)
  const average = sample.reduce((sum, item) => sum + item.amount, 0) / sample.length
  return {
    annual: average * multiplier,
    basis: `${sample.length} recent distribution${sample.length === 1 ? '' : 's'} annualized (×${multiplier}${foldedNote(sample)})`,
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
