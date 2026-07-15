const normalizeOptionDate = (yy, mm, dd) => {
  let year = Number(yy)
  if (!Number.isFinite(year)) return ''
  if (year < 100) year += 2000
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

// Parse human-readable broker descriptions and compact OCC-style symbols.
// A signed quantity is authoritative; unsigned lines can be assigned by an
// import strategy after all related legs have been parsed.
export const parseBrokerOptionDescriptor = (raw, defaultSide = 'BUY') => {
  if (!raw) return null
  let body = String(raw).trim().toUpperCase()
  if (!body) return null
  let qty = 1
  let side = defaultSide === 'SELL' ? 'SELL' : 'BUY'
  let sideExplicit = false
  const qtyMatch = body.match(/^([+-]?\d+)\s+(.+)$/)
  if (qtyMatch && Number(qtyMatch[1]) !== 0) {
    qty = Math.abs(Number(qtyMatch[1]))
    side = Number(qtyMatch[1]) < 0 ? 'SELL' : 'BUY'
    sideExplicit = true
    body = qtyMatch[2].trim()
  }
  const human = body.match(/^([A-Z]{1,6})(?:\s+[A-Z]{2})?\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+([CP])\s*([\d.]+)$/)
  if (human) {
    return {
      underlying: human[1],
      expiration: normalizeOptionDate(human[4], human[2], human[3]),
      optType: human[5] === 'P' ? 'PUT' : 'CALL',
      strike: Number(human[6]),
      qty,
      side,
      sideExplicit,
    }
  }
  const occ = body.match(/^([A-Z]{1,6})\s+(\d{2})(\d{2})(\d{2})([CP])(\d{6,8})$/)
  if (occ) {
    return {
      underlying: occ[1],
      expiration: normalizeOptionDate(occ[2], occ[3], occ[4]),
      optType: occ[5] === 'P' ? 'PUT' : 'CALL',
      strike: Number(occ[6]) / 1000,
      qty,
      side,
      sideExplicit,
    }
  }
  return null
}

// For unsigned income + protection exports, calls are short and covered while
// puts pair from the highest strike down as long/short debit spreads. A lone
// put becomes a long protective put. Explicit + / - quantities always win.
export const assignBrokerImportSides = (legs, mode) => {
  const next = legs.map(leg => ({ ...leg }))
  if (mode !== 'covered-call-protection') return next

  next.forEach(leg => {
    if (!leg.sideExplicit && leg.optType === 'CALL') leg.side = 'SELL'
  })

  const putGroups = new Map()
  next.forEach((leg, index) => {
    if (leg.sideExplicit || leg.optType !== 'PUT') return
    const key = `${leg.underlying}|${leg.expiration}`
    const indexes = putGroups.get(key) || []
    indexes.push(index)
    putGroups.set(key, indexes)
  })
  putGroups.forEach(indexes => {
    indexes
      .sort((a, b) => Number(next[b].strike) - Number(next[a].strike))
      .forEach((index, rank) => { next[index].side = rank % 2 === 0 ? 'BUY' : 'SELL' })
  })
  return next
}
