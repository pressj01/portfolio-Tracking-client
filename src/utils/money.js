const DEFAULT_LOCALE = 'en-US'
const DEFAULT_CURRENCY = 'USD'

const displayConfig = {
  currency: DEFAULT_CURRENCY,
  usdToCadRate: 1,
}

export function configureMoneyDisplay({ currency, usdToCadRate } = {}) {
  displayConfig.currency = currency === 'CAD' ? 'CAD' : 'USD'
  const rate = Number(usdToCadRate)
  displayConfig.usdToCadRate = Number.isFinite(rate) && rate > 0 ? rate : 1
}

export function getMoneyDisplayConfig() {
  return { ...displayConfig }
}

export function getDisplayCurrency() {
  return displayConfig.currency
}

export function getCurrencySymbol(currency = displayConfig.currency, locale = DEFAULT_LOCALE) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(0).find(part => part.type === 'currency')?.value || '$'
}

export function getCurrencyLabel() {
  return displayConfig.currency
}

export function convertMoneyValue(value, currency = displayConfig.currency) {
  const n = toFiniteNumber(value)
  if (n === null) return value
  return currency === 'CAD' ? n * displayConfig.usdToCadRate : n
}

export function convertMoneySeries(values, currency = displayConfig.currency) {
  return Array.isArray(values) ? values.map(value => convertMoneyValue(value, currency)) : values
}

export function convertMoneyText(value) {
  if (typeof value !== 'string' || displayConfig.currency !== 'CAD') return value
  const symbol = getCurrencySymbol()
  const marker = '__DISPLAY_MONEY_VALUE__'
  const protectedValue = value.replaceAll(symbol, marker)
  const converted = protectedValue.replace(/(-?)\$(\d[\d,]*(?:\.\d+)?)([KMBT])?/g, (match, sign, raw, suffix) => {
    const numeric = Number(raw.replaceAll(',', ''))
    if (!Number.isFinite(numeric)) return match
    const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }
    const usdValue = numeric * (multipliers[suffix] || 1) * (sign === '-' ? -1 : 1)
    if (suffix) return formatMoneyCompact(usdValue)
    const decimals = raw.includes('.') ? Math.min(4, raw.split('.')[1].length) : 0
    return formatMoney(usdValue, { digits: decimals })
  })
  return converted.replaceAll(marker, symbol)
}

export function moneyHoverTemplate(label = '', digits = 2, axis = 'y') {
  const prefix = label ? `${label}: ` : ''
  return `${prefix}${getCurrencySymbol()}%{${axis}:,.${digits}f}<extra></extra>`
}

function plotlyAxisKey(ref, dimension) {
  const raw = String(ref || dimension)
  const suffix = raw === dimension ? '' : raw.slice(dimension.length)
  return `${dimension}axis${suffix}`
}

function plotlyTitleText(title) {
  return typeof title === 'string' ? title : title?.text || ''
}

function hasMoneyToken(template, token) {
  const text = String(template || '')
  return text.includes(`$%{${token}`) || text.includes(`%{${token}:$`)
}

function replacePlotlyCurrencyText(value, symbol, currency) {
  if (typeof value !== 'string') return value
  const marker = '__DISPLAY_CURRENCY_SYMBOL__'
  return convertMoneyText(value)
    .replaceAll(symbol, marker)
    .replace(/%\{([^}:]+):\$/g, `${marker}%{$1:`)
    .replace(/\(\$\)/g, `(${currency})`)
    .replace(/\$/g, symbol)
    .replaceAll(marker, symbol)
}

function convertPlotlyValues(values, rate) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) return values
  return Array.from(values, value => (
    typeof value === 'number' && Number.isFinite(value) ? value * rate : value
  ))
}

function convertPlotlyCustomData(values, template, rate) {
  if (!Array.isArray(values)) return values
  const matches = [...String(template || '').matchAll(/\$%\{customdata(?:\[(\d+)\])?/g)]
  if (!matches.length) return values
  const indexes = new Set(matches.map(match => match[1]).filter(value => value !== undefined).map(Number))
  return values.map(value => {
    if (typeof value === 'number' && !indexes.size) return value * rate
    if (!Array.isArray(value) || !indexes.size) return value
    return value.map((item, index) => (
      indexes.has(index) && typeof item === 'number' && Number.isFinite(item) ? item * rate : item
    ))
  })
}

export function convertPlotlyCurrency(data, layout) {
  const currency = displayConfig.currency
  if (currency !== 'CAD') return { data, layout }

  const rate = displayConfig.usdToCadRate
  const conversionKey = `${currency}:${rate}`
  if (layout?.meta?.__displayCurrencyConversion === conversionKey) return { data, layout }
  const symbol = getCurrencySymbol(currency)
  const sourceLayout = layout || {}
  const axisKeys = Object.keys(sourceLayout).filter(key => /^(x|y)axis\d*$/.test(key))
  const moneyAxes = new Set(axisKeys.filter(key => {
    const axis = sourceLayout[key] || {}
    const title = plotlyTitleText(axis.title)
    return axis.tickprefix === '$' || title.includes('($)') || title.includes('Dollar')
  }))

  const nextLayout = { ...sourceLayout }
  nextLayout.meta = {
    ...(sourceLayout.meta && typeof sourceLayout.meta === 'object' ? sourceLayout.meta : {}),
    __displayCurrencyConversion: conversionKey,
  }
  for (const key of axisKeys) {
    const axis = sourceLayout[key]
    if (!axis || typeof axis !== 'object') continue
    const isMoney = moneyAxes.has(key)
    const nextAxis = { ...axis }
    if (isMoney) {
      nextAxis.tickprefix = symbol
      if (Array.isArray(axis.range)) nextAxis.range = axis.range.map(value => Number(value) * rate)
    }
    if (axis.title) {
      nextAxis.title = typeof axis.title === 'string'
        ? replacePlotlyCurrencyText(axis.title, symbol, currency)
        : { ...axis.title, text: replacePlotlyCurrencyText(axis.title.text, symbol, currency) }
    }
    nextLayout[key] = nextAxis
  }

  if (sourceLayout.title) {
    nextLayout.title = typeof sourceLayout.title === 'string'
      ? replacePlotlyCurrencyText(sourceLayout.title, symbol, currency)
      : { ...sourceLayout.title, text: replacePlotlyCurrencyText(sourceLayout.title.text, symbol, currency) }
  }

  nextLayout.shapes = Array.isArray(sourceLayout.shapes) ? sourceLayout.shapes.map(shape => {
    const next = { ...shape }
    if (moneyAxes.has(plotlyAxisKey(shape.yref, 'y'))) {
      if (typeof next.y0 === 'number') next.y0 *= rate
      if (typeof next.y1 === 'number') next.y1 *= rate
    }
    if (moneyAxes.has(plotlyAxisKey(shape.xref, 'x'))) {
      if (typeof next.x0 === 'number') next.x0 *= rate
      if (typeof next.x1 === 'number') next.x1 *= rate
    }
    return next
  }) : sourceLayout.shapes

  nextLayout.annotations = Array.isArray(sourceLayout.annotations) ? sourceLayout.annotations.map(annotation => {
    const next = { ...annotation, text: replacePlotlyCurrencyText(annotation.text, symbol, currency) }
    if (moneyAxes.has(plotlyAxisKey(annotation.yref, 'y')) && typeof next.y === 'number') next.y *= rate
    if (moneyAxes.has(plotlyAxisKey(annotation.xref, 'x')) && typeof next.x === 'number') next.x *= rate
    return next
  }) : sourceLayout.annotations

  const nextData = Array.isArray(data) ? data.map(trace => {
    const hovertemplate = trace?.hovertemplate
    const yMoney = moneyAxes.has(plotlyAxisKey(trace?.yaxis, 'y')) || hasMoneyToken(hovertemplate, 'y')
    const xMoney = moneyAxes.has(plotlyAxisKey(trace?.xaxis, 'x')) || hasMoneyToken(hovertemplate, 'x')
    const valueMoney = hasMoneyToken(hovertemplate, 'value')
    return {
      ...trace,
      y: yMoney ? convertPlotlyValues(trace.y, rate) : trace.y,
      open: yMoney ? convertPlotlyValues(trace.open, rate) : trace.open,
      high: yMoney ? convertPlotlyValues(trace.high, rate) : trace.high,
      low: yMoney ? convertPlotlyValues(trace.low, rate) : trace.low,
      close: yMoney ? convertPlotlyValues(trace.close, rate) : trace.close,
      x: xMoney ? convertPlotlyValues(trace.x, rate) : trace.x,
      values: valueMoney ? convertPlotlyValues(trace.values, rate) : trace.values,
      customdata: convertPlotlyCustomData(trace.customdata, hovertemplate, rate),
      text: Array.isArray(trace.text)
        ? trace.text.map(value => replacePlotlyCurrencyText(value, symbol, currency))
        : replacePlotlyCurrencyText(trace.text, symbol, currency),
      hovertemplate: Array.isArray(hovertemplate)
        ? hovertemplate.map(value => replacePlotlyCurrencyText(value, symbol, currency))
        : replacePlotlyCurrencyText(hovertemplate, symbol, currency),
    }
  }) : data

  return { data: nextData, layout: nextLayout }
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function formatMoney(value, options = {}) {
  const {
    currency = displayConfig.currency,
    locale = DEFAULT_LOCALE,
    digits = 2,
    minimumFractionDigits = digits,
    maximumFractionDigits = digits,
    fallback = '—',
    signed = false,
    absolute = false,
    zeroIfInvalid = false,
    convert = true,
  } = options

  let n = toFiniteNumber(value)
  if (n === null) {
    if (!zeroIfInvalid) return fallback
    n = 0
  }

  const conversionRate = convert && currency === 'CAD' ? displayConfig.usdToCadRate : 1
  const convertedValue = n * conversionRate
  const sign = signed ? (convertedValue >= 0 ? '+' : '-') : ''
  const displayValue = signed || absolute ? Math.abs(convertedValue) : convertedValue

  return sign + new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(displayValue)
}

export function formatMoneyWhole(value, options = {}) {
  return formatMoney(value, { digits: 0, ...options })
}

export function formatMoneyDelta(value, options = {}) {
  return formatMoney(value, { signed: true, ...options })
}

export function formatMoneyCompact(value, options = {}) {
  const {
    fallback = '—',
    signed = false,
    zeroIfInvalid = false,
    currency = displayConfig.currency,
    locale = DEFAULT_LOCALE,
    convert = true,
    minCompact = 1e3,
    smallDigits = 0,
  } = options
  let n = toFiniteNumber(value)
  if (n === null) {
    if (!zeroIfInvalid) return fallback
    n = 0
  }

  const conversionRate = convert && currency === 'CAD' ? displayConfig.usdToCadRate : 1
  const convertedValue = n * conversionRate
  const sign = signed && convertedValue >= 0 ? '+' : convertedValue < 0 ? '-' : ''
  const abs = Math.abs(convertedValue)
  const symbol = getCurrencySymbol(currency, locale)
  const units = [
    { value: 1e12, label: 'T', digits: 2 },
    { value: 1e9, label: 'B', digits: 2 },
    { value: 1e6, label: 'M', digits: 1 },
    { value: 1e3, label: 'K', digits: 0 },
  ]
  const unit = units.find(u => abs >= u.value && u.value >= minCompact)
  if (unit) return `${sign}${symbol}${(abs / unit.value).toFixed(unit.digits)}${unit.label}`
  return sign + formatMoney(abs, {
    currency,
    locale,
    digits: smallDigits,
    signed: false,
    fallback,
    zeroIfInvalid,
    convert: false,
  })
}
