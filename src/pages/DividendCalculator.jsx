import React, { useEffect, useMemo, useState } from 'react'
import Plot from 'react-plotly.js'
import { useProfileFetch } from '../context/ProfileContext'

const FREQ_OPTIONS = [
  { code: 'W',  label: 'Weekly',        per_year: 52 },
  { code: 'M',  label: 'Monthly',       per_year: 12 },
  { code: 'Q',  label: 'Quarterly',     per_year: 4  },
  { code: 'SA', label: 'Semi-Annually', per_year: 2  },
  { code: 'A',  label: 'Annually',      per_year: 1  },
]

function freqPerYear(code) {
  return (FREQ_OPTIONS.find(f => f.code === code) || FREQ_OPTIONS[2]).per_year
}

const fmtMoney = (v) => {
  if (v == null || isNaN(v)) return '-'
  const n = Number(v)
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const fmtMoneyShort = (v) => {
  if (v == null || isNaN(v)) return '-'
  const n = Number(v)
  return '$' + Math.round(n).toLocaleString('en-US')
}

const fmtPct = (v, d = 2) => (v == null || isNaN(v)) ? '-' : Number(v).toFixed(d) + '%'
const fmtShares = (v) => {
  if (v == null || isNaN(v)) return '-'
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0))

function NumberInput({ value, onChange, min, max, step, prefix, suffix, placeholder }) {
  return (
    <div className="dc-input-wrap">
      {prefix && <span className="dc-input-affix dc-input-prefix">{prefix}</span>}
      <input
        type="number"
        value={value === '' || value == null ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        className={`dc-input${prefix ? ' dc-input-with-prefix' : ''}${suffix ? ' dc-input-with-suffix' : ''}`}
      />
      {suffix && <span className="dc-input-affix dc-input-suffix">{suffix}</span>}
    </div>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="dc-toggle">
      <span className="dc-toggle-label">{label}</span>
      <span className={`dc-toggle-track${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="dc-toggle-thumb" />
      </span>
    </label>
  )
}

function projectDividends(input) {
  const {
    initialInvestment, sharePrice, shares, yieldPct, divGrowthPct,
    priceGrowthPct, years, annualContribution, taxRatePct, returnOfCapitalPct, payoutCode, dripPct,
  } = input

  const ppy = freqPerYear(payoutCode)
  const periods = Math.max(1, Math.round(years * ppy))
  const periodPriceGrowth = Math.pow(1 + (priceGrowthPct || 0) / 100, 1 / ppy) - 1
  const periodDivGrowth = Math.pow(1 + (divGrowthPct || 0) / 100, 1 / ppy) - 1
  const periodContribution = (annualContribution || 0) / ppy
  const dividendTaxRate = clampPct(taxRatePct) / 100
  const taxableDividendFactor = 1 - (clampPct(returnOfCapitalPct) / 100)
  const dripRate = clampPct(dripPct) / 100

  let curShares = shares
  let curPrice = sharePrice
  // Annual dividend per share at start
  let annualDivPerShare = sharePrice * (yieldPct / 100)

  let cumGrossDivs = 0
  let cumNetDivs = 0
  let cumTaxes = 0
  let cumReinvestedDivs = 0
  let cumCashDivs = 0
  let cumContributions = 0

  // Yearly snapshots
  const yearly = [{
    year: 0,
    portfolioValue: curShares * curPrice,
    sharesOwned: curShares,
    annualIncome: curShares * annualDivPerShare,
    monthlyIncome: (curShares * annualDivPerShare) / 12,
    cumDividends: 0,
    cumNetDividends: 0,
    cumTaxes: 0,
    cumReinvestedDividends: 0,
    cumCashDividends: 0,
    cumContributions: 0,
    yieldOnCost: yieldPct,
  }]

  for (let p = 1; p <= periods; p++) {
    // Per-period dividend per share
    const perPeriodDivPerShare = annualDivPerShare / ppy
    const grossDiv = curShares * perPeriodDivPerShare
    const tax = grossDiv * taxableDividendFactor * dividendTaxRate
    const netDiv = grossDiv - tax
    cumGrossDivs += grossDiv
    cumNetDivs += netDiv
    cumTaxes += tax
    const reinvestedDiv = netDiv * dripRate
    const cashDiv = netDiv - reinvestedDiv
    cumReinvestedDivs += reinvestedDiv
    cumCashDivs += cashDiv

    // Contribution at end of period
    cumContributions += periodContribution

    // Reinvest selected dividends + contribution at current price
    const cashToInvest = reinvestedDiv + periodContribution
    if (cashToInvest > 0 && curPrice > 0) {
      curShares += cashToInvest / curPrice
    }

    // Grow price and dividend per share
    curPrice = curPrice * (1 + periodPriceGrowth)
    annualDivPerShare = annualDivPerShare * (1 + periodDivGrowth)

    // End-of-year snapshot
    if (p % ppy === 0) {
      const year = p / ppy
      const portfolioValue = curShares * curPrice
      const annualIncome = curShares * annualDivPerShare
      yearly.push({
        year,
        portfolioValue,
        sharesOwned: curShares,
        annualIncome,
        monthlyIncome: annualIncome / 12,
        cumDividends: cumGrossDivs,
        cumNetDividends: cumNetDivs,
        cumTaxes,
        cumReinvestedDividends: cumReinvestedDivs,
        cumCashDividends: cumCashDivs,
        cumContributions,
        yieldOnCost: initialInvestment > 0 ? (annualIncome / initialInvestment) * 100 : 0,
      })
    }
  }

  const initial = yearly[0]
  const final = yearly[yearly.length - 1]
  const totalInvested = initialInvestment + cumContributions
  const endingWealth = final.portfolioValue + cumCashDivs
  return {
    yearly,
    initial,
    final,
    totalInvested,
    endingWealth,
    inputReturnOfCapitalPct: clampPct(returnOfCapitalPct),
    inputDripPct: clampPct(dripPct),
    cumGrossDivs,
    cumNetDivs,
    cumTaxes,
    cumReinvestedDivs,
    cumCashDivs,
    totalReturnPct: totalInvested > 0 ? ((endingWealth / totalInvested) - 1) * 100 : 0,
    capitalGain: final.portfolioValue - totalInvested,
  }
}

function aggregateProjections(rows) {
  if (!rows.length) return null
  const yearCount = rows[0].projection.yearly.length
  const yearly = []
  for (let i = 0; i < yearCount; i++) {
    let portfolioValue = 0
    let sharesOwned = 0
    let annualIncome = 0
    let cumDividends = 0
    let cumNetDividends = 0
    let cumTaxes = 0
    let cumReinvestedDividends = 0
    let cumCashDividends = 0
    let cumContributions = 0
    for (const r of rows) {
      const y = r.projection.yearly[i]
      portfolioValue += y.portfolioValue
      sharesOwned += y.sharesOwned
      annualIncome += y.annualIncome
      cumDividends += y.cumDividends
      cumNetDividends += y.cumNetDividends
      cumTaxes += y.cumTaxes
      cumReinvestedDividends += y.cumReinvestedDividends
      cumCashDividends += y.cumCashDividends
      cumContributions += y.cumContributions
    }
    yearly.push({
      year: rows[0].projection.yearly[i].year,
      portfolioValue,
      sharesOwned,
      annualIncome,
      monthlyIncome: annualIncome / 12,
      cumDividends,
      cumNetDividends,
      cumTaxes,
      cumReinvestedDividends,
      cumCashDividends,
      cumContributions,
    })
  }
  const totalInitial = rows.reduce((s, r) => s + r.initialInvestment, 0)
  for (const y of yearly) {
    y.yieldOnCost = totalInitial > 0 ? (y.annualIncome / totalInitial) * 100 : 0
  }
  const final = yearly[yearly.length - 1]
  const initial = yearly[0]
  const endingWealth = rows.reduce((s, r) => s + r.projection.endingWealth, 0)
  const totalInvested = totalInitial + final.cumContributions
  return {
    yearly,
    initial,
    final,
    totalInvested,
    endingWealth,
    cumGrossDivs: final.cumDividends,
    cumNetDivs: final.cumNetDividends,
    cumTaxes: final.cumTaxes,
    cumReinvestedDivs: final.cumReinvestedDividends,
    cumCashDivs: final.cumCashDividends,
    yieldOnCost: totalInitial > 0 ? (final.annualIncome / totalInitial) * 100 : 0,
    growthPct: totalInvested > 0
      ? ((endingWealth / totalInvested) - 1) * 100
      : 0,
    incomeGrowthPct: initial.annualIncome > 0
      ? ((final.annualIncome / initial.annualIncome) - 1) * 100
      : 0,
  }
}

const DEFAULT_ROW = {
  ticker: '',
  name: '',
  initialInvestment: 10000,
  sharePrice: 0,
  shares: 0,
  yieldPct: 0,
  divGrowthPct: 0,
  returnOfCapitalPct: 0,
  priceGrowthPct: 3,
  annualContribution: 0,
  payoutCode: 'Q',
  source: 'manual', // 'manual' | 'portfolio'
  status: 'empty', // empty | loading | loaded | error
  message: '',
}

const DEFAULT_SETTINGS = {
  years: 10,
  annualContribution: 0,
  taxRatePct: 15,
  dripPct: 100,
  defaultInitialInvestment: 10000,
  defaultPriceGrowthPct: 5,
}

function newRow(overrides = {}) {
  return { ...DEFAULT_ROW, ...overrides }
}

export default function DividendCalculator() {
  const pf = useProfileFetch()
  const [rows, setRows] = useState([newRow()])
  const [years, setYears] = useState(DEFAULT_SETTINGS.years)
  const [annualContribution, setAnnualContribution] = useState(DEFAULT_SETTINGS.annualContribution)
  const [taxRatePct, setTaxRatePct] = useState(DEFAULT_SETTINGS.taxRatePct)
  const [dripPct, setDripPct] = useState(DEFAULT_SETTINGS.dripPct)
  const [defaultInitialInvestment, setDefaultInitialInvestment] = useState(DEFAULT_SETTINGS.defaultInitialInvestment)
  const [defaultPriceGrowthPct, setDefaultPriceGrowthPct] = useState(DEFAULT_SETTINGS.defaultPriceGrowthPct)
  const [tickerInput, setTickerInput] = useState('')
  const [calculation, setCalculation] = useState(null)
  const [currentHoldings, setCurrentHoldings] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())

  useEffect(() => {
    pf('/api/holdings')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : (d.holdings || [])
        setCurrentHoldings(list.filter(h => h && h.ticker))
      })
      .catch(() => {})
  }, [pf])

  // Lookup a ticker by symbol and add a new row (or replace empty default)
  const lookupTicker = async (symbol) => {
    const sym = (symbol || '').trim().toUpperCase()
    if (!sym) return
    if (rows.some(r => r.ticker === sym && r.status === 'loaded')) return
    // mark a placeholder as loading
    const placeholderIdx = rows.length === 1 && rows[0].status === 'empty' ? 0 : -1
    if (placeholderIdx === -1) {
      setRows(prev => [...prev, newRow({ ticker: sym, status: 'loading' })])
    } else {
      setRows(prev => prev.map((r, i) => i === placeholderIdx ? { ...r, ticker: sym, status: 'loading' } : r))
    }

    try {
      const r = await pf(`/api/dividend-calc/lookup/${encodeURIComponent(sym)}`)
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || 'Lookup failed')
      const initialInvestment = Number(defaultInitialInvestment) || DEFAULT_SETTINGS.defaultInitialInvestment
      const price = d.price || 0
      const shares = price > 0 ? initialInvestment / price : 0
      setRows(prev => {
        const loadedCount = prev.filter(r => r.status === 'loaded' || r.ticker === sym).length
        const perTicker = loadedCount > 0 ? (Number(annualContribution) || 0) / loadedCount : 0
        return prev.map(row => {
          if (row.ticker === sym) {
            return {
              ...row,
              ticker: d.ticker,
              name: d.name,
              sharePrice: price,
              shares: shares,
              yieldPct: d.yield_pct || 0,
              divGrowthPct: d.growth_pct || 0,
              priceGrowthPct: Number(defaultPriceGrowthPct) || 0,
              payoutCode: d.frequency_code || 'Q',
              initialInvestment,
              annualContribution: perTicker,
              status: 'loaded',
              message: '',
            }
          }
          if (row.status === 'loaded') return { ...row, annualContribution: perTicker }
          return row
        })
      })
    } catch (e) {
      setRows(prev => prev.map(row => row.ticker === sym ? { ...row, status: 'error', message: e.message } : row))
    }
  }

  // Add multiple tickers atomically, then look each up.
  // holdingsMap: optional { ticker: { quantity, current_price } } from portfolio picker
  const loadTickers = (symbols, holdingsMap) => {
    const sanitized = Array.from(new Set(
      (symbols || []).map(s => (s || '').trim().toUpperCase()).filter(Boolean)
    ))
    if (!sanitized.length) return

    const fallbackInvestment = Number(defaultInitialInvestment) || DEFAULT_SETTINGS.defaultInitialInvestment
    const priceGrowth = Number(defaultPriceGrowthPct) || 0
    const loadedSet = new Set(
      rows.filter(r => r.status === 'loaded' || r.status === 'loading').map(r => r.ticker)
    )
    const toFetch = sanitized.filter(s => !loadedSet.has(s))
    if (!toFetch.length) return
    setRows(prev => {
      const existing = new Set(prev.map(r => r.ticker))
      const placeholders = toFetch
        .filter(sym => !existing.has(sym))
        .map(sym => newRow({ ticker: sym, status: 'loading' }))
      if (!placeholders.length) return prev
      const hasOnlyEmpty = prev.length === 1 && prev[0].status === 'empty'
      return hasOnlyEmpty ? placeholders : [...prev, ...placeholders]
    })

    for (const sym of toFetch) {
      ;(async () => {
        try {
          const r = await pf(`/api/dividend-calc/lookup/${encodeURIComponent(sym)}`)
          const d = await r.json()
          if (!r.ok || d.error) throw new Error(d.error || 'Lookup failed')
          const price = d.price || 0
          const h = holdingsMap?.[sym]
          const isPortfolio = h?.quantity > 0
          const shares = isPortfolio ? h.quantity : (price > 0 ? fallbackInvestment / price : 0)
          const initialInvestment = shares * price
          setRows(prev => {
            const loadedCount = prev.filter(r => r.status === 'loaded' || r.ticker === sym).length
            const perTicker = loadedCount > 0 ? (Number(annualContribution) || 0) / loadedCount : 0
            return prev.map(row => {
              if (row.ticker === sym) {
                return {
                  ...row,
                  ticker: d.ticker,
                  name: d.name,
                  sharePrice: price,
                  shares,
                  yieldPct: d.yield_pct || 0,
                  divGrowthPct: d.growth_pct || 0,
                  priceGrowthPct: priceGrowth,
                  payoutCode: d.frequency_code || 'Q',
                  initialInvestment,
                  annualContribution: perTicker,
                  source: isPortfolio ? 'portfolio' : 'manual',
                  status: 'loaded',
                  message: '',
                }
              }
              if (row.status === 'loaded') return { ...row, annualContribution: perTicker }
              return row
            })
          })
        } catch (e) {
          setRows(prev => prev.map(row =>
            row.ticker === sym ? { ...row, status: 'error', message: e.message } : row
          ))
        }
      })()
    }
  }

  const togglePicked = (t) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  const visiblePickerHoldings = useMemo(() => {
    const q = pickerSearch.trim().toUpperCase()
    return currentHoldings
      .filter(h => !q || (h.ticker || '').toUpperCase().includes(q))
      .sort((a, b) => (a.ticker || '').localeCompare(b.ticker || ''))
  }, [currentHoldings, pickerSearch])

  const togglePicker = () => {
    setPickerOpen(open => {
      if (!open) {
        setPicked(new Set(rows.filter(r => r.status === 'loaded').map(r => r.ticker)))
        setPickerSearch('')
      }
      return !open
    })
  }

  const pickAllVisible = () => setPicked(prev => {
    const next = new Set(prev)
    for (const h of visiblePickerHoldings) next.add(h.ticker)
    return next
  })

  const pickNone = () => setPicked(new Set())

  const pickEntirePortfolio = () => setPicked(new Set(currentHoldings.map(h => h.ticker)))

  const applyPicked = () => {
    const symbols = [...picked]
    setPickerOpen(false)
    if (!symbols.length) return
    const holdingsMap = Object.fromEntries(
      currentHoldings.map(h => [h.ticker, { quantity: h.quantity, current_price: h.current_price }])
    )
    loadTickers(symbols, holdingsMap)
  }

  const removeRow = (idx) => {
    setRows(prev => {
      const next = prev.filter((_, i) => i !== idx)
      return next.length === 0 ? [newRow()] : next
    })
  }

  const resetAll = () => {
    setRows([newRow()])
    setTickerInput('')
    setYears(DEFAULT_SETTINGS.years)
    setAnnualContribution(DEFAULT_SETTINGS.annualContribution)
    setTaxRatePct(DEFAULT_SETTINGS.taxRatePct)
    setDripPct(DEFAULT_SETTINGS.dripPct)
    setDefaultInitialInvestment(DEFAULT_SETTINGS.defaultInitialInvestment)
    setDefaultPriceGrowthPct(DEFAULT_SETTINGS.defaultPriceGrowthPct)
    setCalculation(null)
  }

  const updateRow = (idx, patch) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, ...patch }
      // keep shares <-> initial investment in sync if user edits one
      if ('initialInvestment' in patch && next.sharePrice > 0) {
        next.shares = (Number(next.initialInvestment) || 0) / next.sharePrice
      } else if ('shares' in patch && next.sharePrice > 0) {
        next.initialInvestment = (Number(next.shares) || 0) * next.sharePrice
      } else if ('sharePrice' in patch && next.sharePrice > 0) {
        next.shares = (Number(next.initialInvestment) || 0) / next.sharePrice
      }
      return next
    }))
  }

  const updateDefaultInitialInvestment = (value) => {
    setDefaultInitialInvestment(value)
    setRows(prev => prev.map(r => {
      if (r.status !== 'loaded' || r.source === 'portfolio') return r
      const initialInvestment = Number(value) || 0
      return {
        ...r,
        initialInvestment,
        shares: Number(r.sharePrice) > 0 ? initialInvestment / r.sharePrice : r.shares,
      }
    }))
  }

  const updateGlobalContribution = (value) => {
    setAnnualContribution(value)
    const total = Number(value) || 0
    setRows(prev => {
      const loaded = prev.filter(r => r.status === 'loaded')
      if (!loaded.length) return prev
      const perTicker = total / loaded.length
      return prev.map(r => r.status === 'loaded' ? { ...r, annualContribution: perTicker } : r)
    })
  }

  const updateDefaultPriceGrowth = (value) => {
    setDefaultPriceGrowthPct(value)
    setRows(prev => prev.map(r => (
      r.status === 'loaded' ? { ...r, priceGrowthPct: value } : r
    )))
  }

  const handleAddTicker = (e) => {
    e?.preventDefault()
    const sym = tickerInput.trim().toUpperCase()
    if (!sym) return
    setTickerInput('')
    lookupTicker(sym)
  }

  const handleCalculate = () => {
    const loadedRows = rows.filter(r => r.status === 'loaded' && Number(r.shares) > 0 && Number(r.sharePrice) > 0)
    if (!loadedRows.length) return
    setCalculation({
      rows: loadedRows.map(r => ({ ...r })),
      settings: {
        years: Number(years) || 0,
        annualContribution: Number(annualContribution) || 0,
        taxRatePct: Number(taxRatePct) || 0,
        dripPct: clampPct(dripPct),
      },
    })
  }

  const currentInputsKey = JSON.stringify({
    rows: rows.filter(r => r.status === 'loaded').map(r => ({
      ticker: r.ticker,
      initialInvestment: Number(r.initialInvestment) || 0,
      sharePrice: Number(r.sharePrice) || 0,
      shares: Number(r.shares) || 0,
      yieldPct: Number(r.yieldPct) || 0,
      divGrowthPct: Number(r.divGrowthPct) || 0,
      returnOfCapitalPct: Number(r.returnOfCapitalPct) || 0,
      priceGrowthPct: Number(r.priceGrowthPct) || 0,
      annualContribution: Number(r.annualContribution) || 0,
      payoutCode: r.payoutCode || 'Q',
    })),
    settings: {
      years: Number(years) || 0,
      taxRatePct: Number(taxRatePct) || 0,
      dripPct: clampPct(dripPct),
    },
  })

  const calculatedInputsKey = calculation ? JSON.stringify({
    rows: calculation.rows.map(r => ({
      ticker: r.ticker,
      initialInvestment: Number(r.initialInvestment) || 0,
      sharePrice: Number(r.sharePrice) || 0,
      shares: Number(r.shares) || 0,
      yieldPct: Number(r.yieldPct) || 0,
      divGrowthPct: Number(r.divGrowthPct) || 0,
      returnOfCapitalPct: Number(r.returnOfCapitalPct) || 0,
      priceGrowthPct: Number(r.priceGrowthPct) || 0,
      annualContribution: Number(r.annualContribution) || 0,
      payoutCode: r.payoutCode || 'Q',
    })),
    settings: calculation.settings,
  }) : ''

  const activeRows = rows.filter(r => r.status === 'loaded' || r.status === 'loading' || r.status === 'error')
  const loadedRows = rows.filter(r => r.status === 'loaded')
  const hasLoadedRows = rows.some(r => r.status === 'loaded' && Number(r.shares) > 0 && Number(r.sharePrice) > 0)
  const portfolioRows = loadedRows.filter(r => r.source === 'portfolio')
  const manualRows = loadedRows.filter(r => r.source === 'manual')
  const allPortfolio = loadedRows.length > 0 && manualRows.length === 0
  const mixedSources = portfolioRows.length > 0 && manualRows.length > 0
  const portfolioTotal = portfolioRows.reduce((s, r) => s + (Number(r.initialInvestment) || 0), 0)
  const resultsNeedUpdate = Boolean(calculation && currentInputsKey !== calculatedInputsKey)

  // Build per-row projections from the last explicit calculation.
  const projections = useMemo(() => {
    if (!calculation) return []
    const { settings } = calculation
    return calculation.rows
      .map(r => ({
        ticker: r.ticker,
        name: r.name,
        initialInvestment: Number(r.initialInvestment) || 0,
        projection: projectDividends({
          initialInvestment: Number(r.initialInvestment) || 0,
          sharePrice: Number(r.sharePrice) || 0,
          shares: Number(r.shares) || 0,
          yieldPct: Number(r.yieldPct) || 0,
          divGrowthPct: Number(r.divGrowthPct) || 0,
          returnOfCapitalPct: Number(r.returnOfCapitalPct) || 0,
          priceGrowthPct: Number(r.priceGrowthPct) || 0,
          years: settings.years,
          annualContribution: Number(r.annualContribution) || 0,
          taxRatePct: settings.taxRatePct,
          payoutCode: r.payoutCode || 'Q',
          dripPct: settings.dripPct,
        }),
      }))
  }, [calculation])

  const totals = useMemo(() => aggregateProjections(projections), [projections])
  const chartYearRange = useMemo(() => {
    if (!totals?.yearly?.length) return undefined
    const yearsList = totals.yearly.map(y => y.year)
    return [Math.min(...yearsList) - 0.25, Math.max(...yearsList) + 0.25]
  }, [totals])
  const hasNegativePriceGrowth = rows.some(r => r.status === 'loaded' && Number(r.priceGrowthPct) < 0)
  const negativeGrowthDripNote = hasNegativePriceGrowth && clampPct(dripPct) > 0
    ? 'A negative stock price growth rate can still produce higher ending wealth when DRIP is on, because reinvested dividends buy more shares at lower prices.'
    : ''

  const heroLine = useMemo(() => {
    if (!loadedRows.length) return null
    if (loadedRows.length === 1) {
      const r = loadedRows[0]
      return (
        <span>
          <strong>{r.name}</strong> ({r.ticker}) has a stock price of <strong>{fmtMoney(r.sharePrice)}</strong>,
          dividend yield of <strong>{fmtPct(r.yieldPct, 3)}</strong>, and dividend growth of <strong>{fmtPct(r.divGrowthPct, 2)}</strong>,
          based on current and historical data.
        </span>
      )
    }
    return (
      <span>
        Combined projection across <strong>{loadedRows.length}</strong> tickers
        {allPortfolio
          ? <> using current portfolio values (<strong>{fmtMoneyShort(portfolioTotal)}</strong> total)</>
          : mixedSources
            ? <> ({portfolioRows.length} from portfolio, {manualRows.length} manual)</>
            : null
        }.
        Each ticker uses its own price, yield, growth, and payout frequency.
        <span className="dc-hero-tickers">
          {loadedRows.slice(0, 16).map(r => r.ticker).join(', ')}
          {loadedRows.length > 16 ? `, +${loadedRows.length - 16} more` : ''}
        </span>
      </span>
    )
  }, [loadedRows])

  return (
    <div className="page dc-page">
      <div className="dc-title-row">
        <div>
          <h1>Dividend Calculator</h1>
          <p className="dc-muted">
            Project income and portfolio growth over time across one or more ETFs and stocks, with or without
            dividend reinvestment (DRIP).
          </p>
        </div>
      </div>

      <div className="dc-shared-card dc-setup-card">
        <div className="dc-card-head">
          <div>
            <h3>Calculation Settings</h3>
            <p className="dc-muted">Set your assumptions first, then add a ticker and calculate.</p>
          </div>
          {resultsNeedUpdate && <span className="dc-dirty-badge">Needs recalculation</span>}
        </div>
        <div className="dc-grid">
          <div className="dc-field">
            <label>Years to Invest</label>
            <NumberInput value={years} onChange={setYears} min="1" max="50" step="1" />
          </div>
          <div className="dc-field">
            {allPortfolio ? (
              <>
                <label>Portfolio Value</label>
                <div className="dc-portfolio-summary">
                  {fmtMoneyShort(portfolioTotal)} across {portfolioRows.length} ticker{portfolioRows.length === 1 ? '' : 's'}
                </div>
              </>
            ) : (
              <>
                <label>{mixedSources ? 'Initial Investment (manual tickers only)' : 'Initial Investment Per Ticker'}</label>
                <NumberInput value={defaultInitialInvestment} onChange={updateDefaultInitialInvestment} prefix="$" step="100" />
                {mixedSources && (
                  <div className="dc-field-note">
                    Portfolio tickers use current values ({fmtMoneyShort(portfolioTotal)} across {portfolioRows.length})
                  </div>
                )}
              </>
            )}
          </div>
          <div className="dc-field">
            <label>Annual Investment (split equally)</label>
            <NumberInput value={annualContribution} onChange={updateGlobalContribution} prefix="$" step="100" />
          </div>
          <div className="dc-field">
            <label>Dividend Tax Rate</label>
            <NumberInput value={taxRatePct} onChange={setTaxRatePct} suffix="%" step="0.5" />
          </div>
          <div className="dc-field">
            <label>Stock Price Growth (All Tickers)</label>
            <NumberInput value={defaultPriceGrowthPct} onChange={updateDefaultPriceGrowth} suffix="%" step="0.1" />
            {negativeGrowthDripNote && <div className="dc-field-note">{negativeGrowthDripNote}</div>}
          </div>
          <div className="dc-field">
            <label>Dividends Reinvested (DRIP)</label>
            <NumberInput value={dripPct} onChange={setDripPct} min="0" max="100" suffix="%" step="0.1" />
          </div>
        </div>
      </div>

      <form className="dc-ticker-bar" onSubmit={handleAddTicker}>
        <div className={`dc-chip-input${activeRows.length > 14 ? ' dc-chip-input-dense' : ''}`}>
          {activeRows.length > 0 && (
            <div className="dc-chip-input-head">
              <span>{loadedRows.length} ticker{loadedRows.length === 1 ? '' : 's'} selected</span>
              {activeRows.length > loadedRows.length && <span>{activeRows.length - loadedRows.length} pending</span>}
            </div>
          )}
          {activeRows.map((r, i) => (
            <span key={`${r.ticker}-${i}`} className={`dc-chip dc-chip-${r.status}`}>
              {r.ticker || '...'}
              {r.status === 'loading' && <span className="dc-chip-spinner" />}
              <button type="button" onClick={() => removeRow(rows.indexOf(r))} aria-label={`Remove ${r.ticker}`}>x</button>
            </span>
          ))}
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            placeholder={rows.some(r => r.status === 'loaded') ? 'Add another ticker' : 'Enter a ticker (e.g. SCHD, AAPL)'}
          />
        </div>
        <div className="dc-ticker-actions">
        <button type="submit" className="btn btn-secondary">Add Ticker</button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={togglePicker}
          disabled={currentHoldings.length === 0}
          title={currentHoldings.length === 0 ? 'No portfolio holdings available' : 'Pick from your portfolio holdings'}
        >
          From Portfolio{pickerOpen ? ' ▲' : ' ▼'}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleCalculate} disabled={!hasLoadedRows}>
          {calculation ? 'Recalculate' : 'Calculate'}
        </button>
        <button type="button" className="btn dc-reset" onClick={resetAll}>Reset</button>
        </div>
      </form>

      {pickerOpen && (
        <div style={{
          border: '1px solid #1a4480', borderRadius: 6, marginBottom: '1rem',
          background: '#0f1a33', padding: '0.6rem 0.75rem',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#9bb4d6', fontSize: '0.85rem' }}>
              Test portfolio holdings ({currentHoldings.length} total):
            </span>
            <div style={{ flex: 1 }} />
            <input
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
              placeholder="Search ticker…"
              style={{
                width: 140, padding: '0.3rem 0.5rem', background: '#16213e',
                border: '1px solid #1a4480', borderRadius: 4, color: '#e0e8f5', fontSize: '0.85rem',
              }}
            />
            <button type="button" className="btn btn-sm" onClick={pickEntirePortfolio}>Select All</button>
            <button type="button" className="btn btn-sm" onClick={pickNone}>Deselect All</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #1a2a3e', borderRadius: 4 }}>
            <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#16213e', color: '#9bb4d6' }}>
                  <th style={{ padding: '0.3rem 0.5rem', width: 32 }}></th>
                  <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left' }}>Ticker</th>
                  <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left' }}>Description</th>
                  <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Current Value</th>
                </tr>
              </thead>
              <tbody>
                {visiblePickerHoldings.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '0.6rem', color: '#6b7d99', textAlign: 'center' }}>
                    {currentHoldings.length ? 'No tickers match your search' : 'No portfolio holdings available'}
                  </td></tr>
                )}
                {visiblePickerHoldings.map(h => (
                  <tr
                    key={h.ticker}
                    style={{ borderTop: '1px solid #1a2a3e', cursor: 'pointer' }}
                    onClick={() => togglePicked(h.ticker)}
                  >
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={picked.has(h.ticker)}
                        onChange={() => togglePicked(h.ticker)}
                        onClick={e => e.stopPropagation()}
                      />
                    </td>
                    <td style={{ padding: '0.3rem 0.5rem', color: '#e0e8f5' }}>{h.ticker}</td>
                    <td style={{ padding: '0.3rem 0.5rem', color: '#9bb4d6' }}>{h.description || ''}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#9bb4d6' }}>
                      {h.current_value != null ? fmtMoneyShort(h.current_value) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#9bb4d6', fontSize: '0.85rem' }}>{picked.size} selected</span>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={() => setPickerOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={picked.size === 0}
              onClick={applyPicked}
            >
              Add {picked.size || ''} Ticker{picked.size === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {rows.some(r => r.status === 'error') && (
        <div className="alert alert-error">
          {rows.filter(r => r.status === 'error').map(r => (
            <div key={r.ticker}>{r.ticker}: {r.message}</div>
          ))}
        </div>
      )}

      {heroLine && <div className="dc-hero">{heroLine}</div>}

      {rows.filter(r => r.status === 'loaded').map((r) => {
        const idx = rows.indexOf(r)
        return (
          <div className="dc-row-card" key={`${r.ticker}-${idx}`}>
            <div className="dc-row-head">
              <div>
                <strong>{r.ticker}</strong> <span className="dc-muted">- {r.name}</span>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => removeRow(idx)}>Remove</button>
            </div>
            <div className="dc-grid">
              <div className="dc-field">
                <label>{r.source === 'portfolio' ? 'Current Value' : 'Initial Investment'}</label>
                <NumberInput
                  value={r.initialInvestment}
                  onChange={(v) => updateRow(idx, { initialInvestment: v })}
                  prefix="$"
                  step="100"
                />
              </div>
              <div className="dc-field">
                <label>Stock Price</label>
                <NumberInput
                  value={r.sharePrice}
                  onChange={(v) => updateRow(idx, { sharePrice: v })}
                  prefix="$"
                  step="0.01"
                />
              </div>
              <div className="dc-field">
                <label>Number of Shares</label>
                <NumberInput
                  value={Number(r.shares).toFixed(2)}
                  onChange={(v) => updateRow(idx, { shares: v })}
                  step="0.01"
                />
              </div>
              <div className="dc-field">
                <label>Initial Dividend Yield</label>
                <NumberInput
                  value={r.yieldPct}
                  onChange={(v) => updateRow(idx, { yieldPct: v })}
                  suffix="%"
                  step="0.01"
                />
              </div>
              <div className="dc-field">
                <label>Dividend Growth</label>
                <NumberInput
                  value={r.divGrowthPct}
                  onChange={(v) => updateRow(idx, { divGrowthPct: v })}
                  suffix="%"
                  step="0.1"
                />
              </div>
              <div className="dc-field">
                <label>Return of Capital</label>
                <NumberInput
                  value={r.returnOfCapitalPct}
                  onChange={(v) => updateRow(idx, { returnOfCapitalPct: v })}
                  min="0"
                  max="100"
                  suffix="%"
                  step="0.1"
                />
              </div>
              <div className="dc-field">
                <label>Annual Contribution</label>
                <NumberInput
                  value={r.annualContribution}
                  onChange={(v) => updateRow(idx, { annualContribution: v })}
                  prefix="$"
                  step="100"
                />
              </div>
              <div className="dc-field">
                <label>Stock Price Growth</label>
                <NumberInput
                  value={r.priceGrowthPct}
                  onChange={(v) => updateRow(idx, { priceGrowthPct: v })}
                  suffix="%"
                  step="0.1"
                />
              </div>
              <div className="dc-field">
                <label>Payout Frequency</label>
                <select
                  className="dc-input"
                  value={r.payoutCode}
                  onChange={(e) => updateRow(idx, { payoutCode: e.target.value })}
                >
                  {FREQ_OPTIONS.map(f => (
                    <option key={f.code} value={f.code}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )
      })}

      {totals && (
        <>
          <div className="dc-results-head">
            <div>
              <h2>Results After {Math.round(calculation.settings.years)} Years</h2>
              {resultsNeedUpdate && <div className="dc-muted">Inputs changed since these results were calculated.</div>}
            </div>
            <button type="button" className="btn btn-primary" onClick={handleCalculate} disabled={!hasLoadedRows}>
              Recalculate
            </button>
          </div>

          <div className="dc-stat-row">
            <div className="dc-stat">
              <div className="dc-stat-label">{allPortfolio ? 'Current Portfolio Value' : 'Starting Wealth'}</div>
              <div className="dc-stat-value">{fmtMoneyShort(totals.totalInvested)}</div>
            </div>
            <div className="dc-stat">
              <div className="dc-stat-label">Ending Wealth</div>
              <div className="dc-stat-value">{fmtMoneyShort(totals.endingWealth)}</div>
              <div className={`dc-stat-delta ${totals.growthPct >= 0 ? 'pos' : 'neg'}`}>
                {totals.growthPct >= 0 ? '+' : '-'}{fmtPct(Math.abs(totals.growthPct), 1)}
              </div>
            </div>
            <div className="dc-stat">
              <div className="dc-stat-label">Annual Dividend Income</div>
              <div className="dc-stat-value">{fmtMoney(totals.final.annualIncome)}</div>
              <div className={`dc-stat-delta ${totals.incomeGrowthPct >= 0 ? 'pos' : 'neg'}`}>
                {totals.incomeGrowthPct >= 0 ? '+' : '-'}{fmtPct(Math.abs(totals.incomeGrowthPct), 1)}
              </div>
            </div>
            <div className="dc-stat">
              <div className="dc-stat-label">Monthly Dividend Income</div>
              <div className="dc-stat-value">{fmtMoney(totals.final.monthlyIncome)}</div>
              <div className={`dc-stat-delta ${totals.incomeGrowthPct >= 0 ? 'pos' : 'neg'}`}>
                {totals.incomeGrowthPct >= 0 ? '+' : '-'}{fmtPct(Math.abs(totals.incomeGrowthPct), 1)}
              </div>
            </div>
            <div className="dc-stat">
              <div className="dc-stat-label">Yield on Cost</div>
              <div className="dc-stat-value">{fmtPct(totals.yieldOnCost, 2)}</div>
            </div>
            <div className="dc-stat">
              <div className="dc-stat-label">Current Yield</div>
              <div className="dc-stat-value">{fmtPct(totals.final.portfolioValue > 0 ? (totals.final.annualIncome / totals.final.portfolioValue) * 100 : 0, 2)}</div>
            </div>
            <div className="dc-stat">
              <div className="dc-stat-label">Estimated Dividend Taxes</div>
              <div className="dc-stat-value">{fmtMoneyShort(totals.cumTaxes)}</div>
              <div className="dc-stat-note">After ROC adjustments</div>
            </div>
          </div>

          <div className="dc-section-head">
            <h3>Total Return Breakdown</h3>
            <div className="dc-total-return">{fmtMoneyShort(totals.endingWealth)} <span className="dc-muted">({fmtPct(totals.growthPct, 1)})</span></div>
          </div>

          <div className="dc-chart-card">
            <Plot
              data={[
                {
                  x: totals.yearly.map(y => y.year),
                  y: totals.yearly.map(y => y.portfolioValue),
                  name: 'Portfolio Value',
                  type: 'scatter',
                  mode: 'lines',
                  fill: 'tozeroy',
                  line: { color: '#7ecfff', width: 2 },
                  fillcolor: 'rgba(126, 207, 255, 0.18)',
                  hovertemplate: 'Year %{x}<br>%{y:$,.0f}<extra>Portfolio</extra>',
                },
                {
                  x: totals.yearly.map(y => y.year),
                  y: totals.yearly.map(y => y.cumDividends),
                  name: 'Cumulative Dividends',
                  type: 'scatter',
                  mode: 'lines',
                  line: { color: '#4dff91', width: 2 },
                  hovertemplate: 'Year %{x}<br>%{y:$,.0f}<extra>Dividends</extra>',
                },
                {
                  x: totals.yearly.map(y => y.year),
                  y: totals.yearly.map(y => y.annualIncome),
                  name: 'Annual Income',
                  type: 'scatter',
                  mode: 'lines',
                  line: { color: '#f9a825', width: 2, dash: 'dot' },
                  hovertemplate: 'Year %{x}<br>%{y:$,.0f}<extra>Annual Income</extra>',
                  yaxis: 'y2',
                },
              ]}
              layout={{
                template: 'plotly_dark',
                paper_bgcolor: '#16213e',
                plot_bgcolor: '#16213e',
                font: { color: '#e0e8f5' },
                margin: { l: 70, r: 70, t: 30, b: 50 },
                height: 380,
                xaxis: { title: 'Years', gridcolor: '#1a2a3e' },
                yaxis: { title: 'Portfolio / Cumulative Divs', gridcolor: '#1a2a3e', tickprefix: '$' },
                yaxis2: { title: 'Annual Income', overlaying: 'y', side: 'right', tickprefix: '$', showgrid: false },
                legend: { orientation: 'h', y: 1.12, x: 0.5, xanchor: 'center' },
                hovermode: 'x unified',
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%' }}
              useResizeHandler
            />
          </div>

          <div className="dc-chart-card">
            <Plot
              data={projections.length > 1
                ? projections.map((p) => ({
                    x: p.projection.yearly.map(y => y.year),
                    y: p.projection.yearly.map(y => y.sharesOwned),
                    name: p.ticker,
                    type: 'scatter',
                    mode: 'lines+markers',
                    hovertemplate: `${p.ticker}<br>Year %{x}<br>%{y:,.2f} shares<extra></extra>`,
                  }))
                : [{
                    x: totals.yearly.map(y => y.year),
                    y: totals.yearly.map(y => y.sharesOwned),
                    name: 'Shares Owned',
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { color: '#b388ff', width: 2 },
                    marker: { color: '#b388ff', size: 6 },
                    hovertemplate: 'Year %{x}<br>%{y:,.2f} shares<extra>Shares</extra>',
                  }]}
              layout={{
                template: 'plotly_dark',
                paper_bgcolor: '#16213e',
                plot_bgcolor: '#16213e',
                font: { color: '#e0e8f5' },
                margin: { l: 70, r: 30, t: 55, b: 80 },
                height: 330,
                title: {
                  text: 'Shares Over Time',
                  font: { size: 16, color: '#cfe5ff' },
                  x: 0.5,
                  xanchor: 'center',
                },
                xaxis: { title: 'Years', gridcolor: '#1a2a3e' },
                yaxis: { title: projections.length > 1 ? 'Shares by Ticker' : 'Shares Owned', gridcolor: '#1a2a3e' },
                legend: { orientation: 'h', y: -0.22, x: 0.5, xanchor: 'center', yanchor: 'top' },
                hovermode: 'x unified',
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%' }}
              useResizeHandler
            />
          </div>

          <div className="dc-section-head">
            <h3>Growth Projections</h3>
          </div>

          <div className="dc-chart-grid">
            <div className="dc-chart-card dc-chart-card-compact">
              <Plot
                data={[{
                  x: totals.yearly.map(y => y.year),
                  y: totals.yearly.map(y => y.portfolioValue),
                  name: 'Portfolio Value',
                  type: 'scatter',
                  mode: 'lines+markers',
                  line: { color: '#7ecfff', width: 2 },
                  marker: { color: '#7ecfff', size: 6 },
                  fill: 'tozeroy',
                  fillcolor: 'rgba(126, 207, 255, 0.14)',
                  hovertemplate: 'Year %{x}<br>%{y:$,.0f}<extra></extra>',
                }]}
                layout={{
                  template: 'plotly_dark',
                  paper_bgcolor: '#16213e',
                  plot_bgcolor: '#16213e',
                  font: { color: '#e0e8f5' },
                  margin: { l: 70, r: 28, t: 45, b: 45 },
                  height: 280,
                  title: { text: 'Total Portfolio Value ($)', font: { size: 15, color: '#cfe5ff' } },
                  xaxis: { title: 'Year', gridcolor: '#1a2a3e', range: chartYearRange },
                  yaxis: { tickprefix: '$', gridcolor: '#1a2a3e' },
                  showlegend: false,
                  hovermode: 'x unified',
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            </div>

            <div className="dc-chart-card dc-chart-card-compact">
              <Plot
                data={[{
                  x: totals.yearly.map(y => y.year),
                  y: totals.yearly.map(y => y.annualIncome),
                  name: 'Annual Dividend Income',
                  type: 'bar',
                  marker: { color: '#4dff91' },
                  hovertemplate: 'Year %{x}<br>%{y:$,.0f}<extra></extra>',
                }]}
                layout={{
                  template: 'plotly_dark',
                  paper_bgcolor: '#16213e',
                  plot_bgcolor: '#16213e',
                  font: { color: '#e0e8f5' },
                  margin: { l: 70, r: 28, t: 45, b: 45 },
                  height: 280,
                  title: { text: 'Annual Dividend Income ($)', font: { size: 15, color: '#cfe5ff' } },
                  xaxis: { title: 'Year', gridcolor: '#1a2a3e', range: chartYearRange },
                  yaxis: { tickprefix: '$', gridcolor: '#1a2a3e' },
                  showlegend: false,
                  bargap: 0.35,
                  hovermode: 'x unified',
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            </div>

            <div className="dc-chart-card dc-chart-card-compact">
              <Plot
                data={[{
                  x: totals.yearly.map(y => y.year),
                  y: totals.yearly.map(y => y.monthlyIncome),
                  name: 'Monthly Dividend Income',
                  type: 'bar',
                  marker: { color: '#66d9a6' },
                  hovertemplate: 'Year %{x}<br>%{y:$,.0f}<extra></extra>',
                }]}
                layout={{
                  template: 'plotly_dark',
                  paper_bgcolor: '#16213e',
                  plot_bgcolor: '#16213e',
                  font: { color: '#e0e8f5' },
                  margin: { l: 70, r: 28, t: 45, b: 45 },
                  height: 280,
                  title: { text: 'Monthly Dividend Income ($)', font: { size: 15, color: '#cfe5ff' } },
                  xaxis: { title: 'Year', gridcolor: '#1a2a3e', range: chartYearRange },
                  yaxis: { tickprefix: '$', gridcolor: '#1a2a3e' },
                  showlegend: false,
                  bargap: 0.35,
                  hovermode: 'x unified',
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            </div>

            <div className="dc-chart-card dc-chart-card-compact">
              <Plot
                data={[{
                  x: totals.yearly.map(y => y.year),
                  y: totals.yearly.map(y => y.yieldOnCost),
                  name: 'Yield on Cost',
                  type: 'scatter',
                  mode: 'lines+markers',
                  line: { color: '#f9a825', width: 2 },
                  marker: { color: '#f9a825', size: 6 },
                  hovertemplate: 'Year %{x}<br>%{y:.2f}%<extra></extra>',
                }]}
                layout={{
                  template: 'plotly_dark',
                  paper_bgcolor: '#16213e',
                  plot_bgcolor: '#16213e',
                  font: { color: '#e0e8f5' },
                  margin: { l: 70, r: 28, t: 45, b: 45 },
                  height: 280,
                  title: { text: 'Yield on Cost (%)', font: { size: 15, color: '#cfe5ff' } },
                  xaxis: { title: 'Year', gridcolor: '#1a2a3e', range: chartYearRange },
                  yaxis: { ticksuffix: '%', gridcolor: '#1a2a3e' },
                  showlegend: false,
                  hovermode: 'x unified',
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            </div>
          </div>

          <div className="dc-table-card">
            <h3>Year-by-Year Breakdown</h3>
            <div className="dc-table-wrap">
              <table className="dc-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>{projections.length > 1 ? 'Total Shares' : 'Shares Owned'}</th>
                    <th>Portfolio Value</th>
                    <th>Annual Income</th>
                    <th>Monthly Income</th>
                    <th>Cumulative Dividends</th>
                    <th>Estimated Taxes</th>
                    <th>Net Dividends</th>
                    <th>Reinvested Dividends</th>
                    <th>Cash Dividends</th>
                    <th>Cumulative Contributions</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.yearly.map(y => (
                    <tr key={y.year}>
                      <td>{y.year}</td>
                      <td>{fmtShares(y.sharesOwned)}</td>
                      <td>{fmtMoney(y.portfolioValue)}</td>
                      <td>{fmtMoney(y.annualIncome)}</td>
                      <td>{fmtMoney(y.monthlyIncome)}</td>
                      <td>{fmtMoney(y.cumDividends)}</td>
                      <td>{fmtMoney(y.cumTaxes)}</td>
                      <td>{fmtMoney(y.cumNetDividends)}</td>
                      <td>{fmtMoney(y.cumReinvestedDividends)}</td>
                      <td>{fmtMoney(y.cumCashDividends)}</td>
                      <td>{fmtMoney(y.cumContributions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {projections.length > 1 && (
            <div className="dc-table-card">
              <h3>Per-Ticker Final Values</h3>
              <div className="dc-table-wrap">
                <table className="dc-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Initial Investment</th>
                      <th>Final Shares</th>
                      <th>DRIP %</th>
                      <th>ROC %</th>
                      <th>Final Portfolio Value</th>
                      <th>Final Annual Income</th>
                      <th>Estimated Taxes</th>
                      <th>Cash Dividends</th>
                      <th>Cumulative Dividends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projections.map(p => (
                      <tr key={p.ticker}>
                        <td><strong>{p.ticker}</strong> <span className="dc-muted">{p.name}</span></td>
                        <td>{fmtMoney(p.initialInvestment)}</td>
                        <td>{fmtShares(p.projection.final.sharesOwned)}</td>
                        <td>{fmtPct(p.projection.inputDripPct, 1)}</td>
                        <td>{fmtPct(p.projection.inputReturnOfCapitalPct, 1)}</td>
                        <td>{fmtMoney(p.projection.final.portfolioValue)}</td>
                        <td>{fmtMoney(p.projection.final.annualIncome)}</td>
                        <td>{fmtMoney(p.projection.cumTaxes)}</td>
                        <td>{fmtMoney(p.projection.cumCashDivs)}</td>
                        <td>{fmtMoney(p.projection.cumGrossDivs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
