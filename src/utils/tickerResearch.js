export const CHECKLIST_PATHS = {
  cef: '/cef-buying-checklist-evaluator',
  option_income: '/option-income-etf-evaluator',
  etf: '/etf-buying-checklist-evaluator',
  stock: '/stock-buying-checklist',
}

export function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function checklistHref(kind, ticker) {
  const base = CHECKLIST_PATHS[kind] || CHECKLIST_PATHS.stock
  return `${base}?ticker=${encodeURIComponent(ticker)}`
}

export function navFromSeed(seed) {
  if (!seed) return null
  if (seed.nav) return seed.nav
  const meta = seed.coverageMeta || {}
  if (seed.coverage == null && meta.nav_tested == null && meta.nav_erosion_severity == null) {
    return null
  }
  return {
    coverage_ratio: seed.coverage ?? null,
    ...meta,
  }
}

function toneFromScore(score) {
  if (score == null) return 'muted'
  if (score >= 70) return 'good'
  if (score >= 50) return 'warn'
  return 'bad'
}

export function discountCard(cef) {
  const discount = num(cef?.premium_discount)
  if (discount == null) {
    return {
      label: 'CEF discount',
      value: 'n/a',
      detail: cef ? 'CEF Connect did not report a premium/discount.' : 'Not a closed-end fund.',
      tone: 'muted',
    }
  }
  const isDiscount = discount < 0
  return {
    label: 'CEF discount',
    value: `${discount > 0 ? '+' : ''}${discount.toFixed(2)}%`,
    detail: isDiscount
      ? `Trading below NAV — ${Math.abs(discount).toFixed(2)}% discount.`
      : discount === 0
        ? 'Trading at NAV.'
        : `Trading above NAV — ${discount.toFixed(2)}% premium.`,
    tone: isDiscount ? 'good' : discount <= 5 ? 'warn' : 'bad',
  }
}

export function navTrendCard(nav, loading = false) {
  if (loading && !nav) {
    return {
      label: 'NAV trend',
      value: '…',
      detail: 'Computing benchmark-adjusted NAV coverage for this ticker.',
      tone: 'muted',
    }
  }
  if (!nav || nav.nav_tested === false && nav.coverage_ratio == null && !nav.nav_erosion_severity) {
    return {
      label: 'NAV trend',
      value: 'n/a',
      detail: nav?.warning || 'This ticker is not NAV-tested, or coverage has not been computed.',
      tone: 'muted',
    }
  }
  const severity = nav.nav_erosion_severity
  const ratio = num(nav.coverage_ratio)
  const priceChange = num(nav.price_change_pct)
  const tone = severity === 'High' ? 'bad' : severity === 'Medium' ? 'warn' : severity === 'Low' ? 'good' : 'muted'
  const parts = []
  if (severity) parts.push(`${severity} confirmed price erosion`)
  if (priceChange != null) parts.push(`1Y price ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%`)
  if (nav.benchmark) parts.push(`vs ${nav.benchmark}`)
  return {
    label: 'NAV trend',
    value: ratio == null ? (severity || 'n/a') : ratio.toFixed(2),
    detail: parts.join(' · ') || 'Benchmark-adjusted NAV coverage for this position.',
    tone,
  }
}

export function distributionCoverageCard(cef, research) {
  const eps = num(cef?.earnings_per_share)
  const distAmt = num(cef?.distribution_amount)
  if (eps != null && distAmt > 0) {
    const coverage = eps / distAmt
    return {
      label: 'Distribution coverage',
      value: `${coverage.toFixed(2)}x`,
      detail: `Earnings cover the stated distribution ${coverage.toFixed(2)} times.`,
      tone: coverage >= 1 ? 'good' : coverage >= 0.5 ? 'warn' : 'bad',
    }
  }
  const drNav = num(cef?.distribution_rate_nav)
  const longTerm = num(cef?.return_on_nav_5y) ?? num(cef?.return_on_nav_3y)
  if (drNav != null && longTerm != null) {
    const gap = drNav - longTerm
    const label = num(cef?.return_on_nav_5y) != null ? '5Y NAV return' : '3Y NAV return'
    return {
      label: 'Distribution coverage',
      value: `${gap >= 0 ? '+' : ''}${gap.toFixed(2)} pp`,
      detail: `Distribution on NAV ${drNav.toFixed(2)}% vs ${longTerm.toFixed(2)}% ${label}.`,
      tone: gap <= 1 ? 'good' : gap <= 3 ? 'warn' : 'bad',
    }
  }
  const yieldPct = num(research?.estimated_yield_pct)
  const ret1y = num(research?.return_1y)
  if (yieldPct != null && ret1y != null && yieldPct >= 2) {
    const gap = yieldPct - ret1y
    return {
      label: 'Distribution coverage',
      value: `${gap >= 0 ? '+' : ''}${gap.toFixed(2)} pp`,
      detail: `Yield ${yieldPct.toFixed(2)}% vs 1Y total return ${ret1y.toFixed(2)}%.`,
      tone: gap <= 0 ? 'good' : gap <= 2 ? 'warn' : 'bad',
    }
  }
  return {
    label: 'Distribution coverage',
    value: 'n/a',
    detail: 'No earnings, UNII, or yield-vs-return coverage is available yet.',
    tone: 'muted',
  }
}

export function checklistCard(kind, result) {
  if (!result) {
    return {
      label: 'Checklist score',
      value: '…',
      detail: 'Scoring the matching buying checklist for this ticker.',
      tone: 'muted',
    }
  }
  if (result.error) {
    return {
      label: 'Checklist score',
      value: 'n/a',
      detail: result.error,
      tone: 'muted',
    }
  }
  const composite = num(result.composite)
  const verdict = result.verdict || (composite == null ? 'n/a' : `${composite.toFixed(0)}/100`)
  return {
    label: 'Checklist score',
    value: composite == null ? verdict : `${composite.toFixed(0)}`,
    detail: result.detail || `${result.kindLabel || kind} checklist${composite == null ? '' : ` · ${verdict}`}.`,
    tone: result.tone || toneFromScore(composite),
  }
}

export function closureCard(risk) {
  if (!risk || !risk.tier) {
    return {
      label: 'Closure risk',
      value: 'n/a',
      detail: 'Closure risk is estimated for ETFs from AUM, fees, and age.',
      tone: 'muted',
    }
  }
  const tone = {
    high: 'bad',
    elevated: 'warn',
    watch: 'warn',
    ok: 'good',
  }[risk.tier] || 'muted'
  const label = {
    high: 'High',
    elevated: 'Elevated',
    watch: 'Watch',
    ok: 'OK',
  }[risk.tier] || risk.tier
  return {
    label: 'Closure risk',
    value: label,
    detail: risk.reason || 'Estimated from fund size and expense ratio, not a closure notice.',
    tone,
  }
}
