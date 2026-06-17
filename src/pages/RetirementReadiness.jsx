import React, { useEffect, useMemo, useState } from 'react'
import Plot from '../components/ThemedPlot'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'

const fmtMoney = (v, digits = 2) => {
  return formatMoney(v, { digits, zeroIfInvalid: true })
}

const fmtPct = (v, digits = 1) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.0%'
  return n.toFixed(digits) + '%'
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0

function StatTile({ label, value, sub, tone = 'default' }) {
  return (
    <div className={`nep-stat-tile rr-stat-${tone}`}>
      <div className="nep-stat-val">{value}</div>
      <div className="nep-stat-lbl">{label}</div>
      {sub && <div className="nep-stat-sub">{sub}</div>}
    </div>
  )
}

function MetricLine({ label, value, tone }) {
  return (
    <div className="rr-line">
      <span>{label}</span>
      <strong className={tone ? `rr-tone-${tone}` : undefined}>{value}</strong>
    </div>
  )
}

function ReadinessBadge({ status }) {
  const key = String(status || 'Building').toLowerCase()
  return <span className={`rr-status rr-status-${key}`}>{status}</span>
}

const INPUT_HELP = {
  monthlyExpenses: 'How much cash you need every month to live on. This is the baseline income target.',
  nonInvestmentIncome: 'Monthly income that does not come from the portfolio, before taxes. Examples: employment income, pensions, annuities, and other recurring inflows.',
  nonInvestmentTaxPct: 'Estimated tax rate applied to non-investment monthly inflows.',
  incomeIndexPct: 'Annual indexing or cost-of-living increase applied to non-investment inflows.',
  bufferRatio: 'Monthly Expense Protection Buffer multiplier. A ratio of 3 means stressed income should be three times monthly expenses.',
  surplusWithdrawPct: 'Percent of excess portfolio income, after expenses are paid, that is withdrawn and not reinvested.',
  surplusReinvestPct: 'Percent of income above monthly expenses that gets reinvested back into the income portfolio.',
  startingCash: 'Cash already set aside outside the portfolio for shortfalls or emergencies.',
  targetCashMonths: 'How many months of expenses you want in reserve. Monthly expenses times this value equals the cash target.',
  years: 'How far forward the model projects income, expenses, surplus reinvestment, and cash reserve.',
  inflationPct: 'Annual rate at which monthly expenses increase over time.',
  portfolioBookNav: 'Portfolio book value at the start of the model. Leave at 0 to use the current portfolio value from holdings.',
  targetYieldPct: 'Expected annual passive income yield during good markets.',
  navErosionPct: 'Estimated annual reinvestment needed to offset NAV erosion.',
  bearDeclinePct: 'Projected portfolio market decline in a bear market.',
  bearYieldPct: 'Estimated annual passive income yield during a bear market.',
  investmentTaxPct: 'Estimated tax rate applied to passive income before reinvestment or withdrawals.',
  directContribution: 'Monthly outside contribution added directly into the portfolio.',
  incomeCutPct: 'Immediate stress cut applied to current portfolio income.',
  incomeHaircutPct: 'Extra planning discount after the dividend cut for distribution volatility or conservative planning.',
  priceDrawdownPct: 'Stress reduction applied to portfolio value. Used to estimate the yield earned by reinvested surplus during the stressed period.',
}

function InputField({ label, help, children }) {
  return (
    <label className="rr-field" title={help}>
      <span className="rr-field-label">
        {label}
        <span className="rr-help">?</span>
      </span>
      {children}
    </label>
  )
}

function InputSection({ title, children }) {
  return (
    <div className="rr-section">
      <h3 className="rr-section-title">{title}</h3>
      <div className="rr-input-grid">{children}</div>
    </div>
  )
}

function buildHolding(row) {
  const shares = num(row.quantity)
  const price = num(row.current_price || row.price)
  const currentValue = num(row.current_value) || shares * price
  const annualIncome = num(row.estim_payment_per_year) || num(row.approx_monthly_income) * 12
  const monthlyIncome = annualIncome / 12
  const yieldPct = currentValue > 0 ? annualIncome / currentValue * 100 : 0
  return {
    ticker: row.ticker || '',
    description: row.description || '',
    category: row.category || row.classification_type || '',
    currentValue,
    annualIncome,
    monthlyIncome,
    yieldPct,
  }
}

export default function RetirementReadiness() {
  const pf = useProfileFetch()
  const { selection, currentProfileName, isAggregate } = useProfile()
  const { isDark } = useTheme()
  const ct = chartTheme(isDark)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [monthlyExpenses, setMonthlyExpenses] = useState(4500)
  const [bufferRatio, setBufferRatio] = useState(3)
  const [surplusWithdrawPct, setSurplusWithdrawPct] = useState(0)
  const [surplusReinvestPct, setSurplusReinvestPct] = useState(100)
  const [startingCash, setStartingCash] = useState(0)
  const [targetCashMonths, setTargetCashMonths] = useState(6)
  const [years, setYears] = useState(10)
  const [inflationPct, setInflationPct] = useState(3)
  const [employmentIncome, setEmploymentIncome] = useState(0)
  const [companyPension, setCompanyPension] = useState(0)
  const [govPension, setGovPension] = useState(0)
  const [annuities, setAnnuities] = useState(0)
  const [otherRecurringIncome, setOtherRecurringIncome] = useState(0)
  const [incomeIndexPct, setIncomeIndexPct] = useState(1)
  const [nonInvestmentTaxPct, setNonInvestmentTaxPct] = useState(10)
  const [portfolioBookNav, setPortfolioBookNav] = useState(0)
  const [targetYieldPct, setTargetYieldPct] = useState(20)
  const [navErosionPct, setNavErosionPct] = useState(3)
  const [bearDeclinePct, setBearDeclinePct] = useState(25)
  const [bearYieldPct, setBearYieldPct] = useState(15)
  const [investmentTaxPct, setInvestmentTaxPct] = useState(15)
  const [directContribution, setDirectContribution] = useState(0)
  const [incomeHaircutPct, setIncomeHaircutPct] = useState(10)

  useEffect(() => {
    setLoading(true)
    setError(null)
    pf('/api/holdings')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setRows(Array.isArray(data) ? data : [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf, selection])

  const holdings = useMemo(() => rows.map(buildHolding).filter(h => h.currentValue > 0 || h.annualIncome > 0), [rows])

  const model = useMemo(() => {
    const portfolioValue = holdings.reduce((s, h) => s + h.currentValue, 0)
    const annualIncome = holdings.reduce((s, h) => s + h.annualIncome, 0)
    const currentMonthlyIncome = annualIncome / 12
    const navBase = portfolioBookNav > 0 ? portfolioBookNav : portfolioValue
    const currentYield = portfolioValue > 0 ? annualIncome / portfolioValue : 0
    const targetYield = clamp(targetYieldPct, 0, 100) / 100
    const bearYield = clamp(bearYieldPct, 0, 100) / 100
    const navErosion = clamp(navErosionPct, 0, 100) / 100
    const inflation = inflationPct / 100
    const investmentTax = clamp(investmentTaxPct, 0, 95) / 100
    const bearDecline = clamp(bearDeclinePct, 0, 95) / 100
    const incomeHaircut = clamp(incomeHaircutPct, 0, 95) / 100
    const nonInvestmentGross = employmentIncome + companyPension + govPension + annuities + otherRecurringIncome
    const nonInvestmentAfterTax = nonInvestmentGross * (1 - clamp(nonInvestmentTaxPct, 0, 95) / 100)
    const expensesPortfolioMustPay = Math.max(0, monthlyExpenses - nonInvestmentAfterTax)
    const targetCash = monthlyExpenses * targetCashMonths
    const minReinvestForErosion = navBase * navErosion / 12
    const minReinvestForInflation = navBase * Math.max(0, inflation) / 12
    const minimumMonthlyReinvest = minReinvestForErosion + minReinvestForInflation
    const targetIncomeBeforeTax = navBase * targetYield / 12
    const targetIncomeAfterTax = targetIncomeBeforeTax * (1 - investmentTax)
    const targetIncomeAfterMinimumReinvest = targetIncomeAfterTax - minimumMonthlyReinvest
    const bearNav = navBase * (1 - bearDecline)
    const bearIncomeBeforeTax = bearNav * bearYield / 12
    const bearIncomeAfterTax = bearIncomeBeforeTax * (1 - investmentTax)
    const bearIncomeProtected = bearIncomeAfterTax * (1 - incomeHaircut)
    const bearIncomeAfterMinimumReinvest = bearIncomeProtected - minimumMonthlyReinvest
    const bufferTargetNow = expensesPortfolioMustPay * bufferRatio
    const currentCoverage = monthlyExpenses > 0 ? currentMonthlyIncome / monthlyExpenses : 0
    const goodBufferRatio = expensesPortfolioMustPay > 0 ? targetIncomeAfterTax / expensesPortfolioMustPay : Infinity
    const bearBufferRatio = expensesPortfolioMustPay > 0 ? bearIncomeProtected / expensesPortfolioMustPay : Infinity
    const protectedCoverage = bearBufferRatio
    const bufferGap = Math.max(0, bufferTargetNow - bearIncomeProtected)
    const shortfallNow = Math.max(0, expensesPortfolioMustPay - bearIncomeProtected)
    const cashRunwayMonths = shortfallNow > 0 ? startingCash / shortfallNow : Infinity
    const incomeOverUnderTarget = targetIncomeAfterTax - bufferTargetNow
    const excessAfterExpensesAndReinvestGood = targetIncomeAfterTax - expensesPortfolioMustPay - minimumMonthlyReinvest
    const excessAfterExpensesAndReinvestBear = bearIncomeProtected - expensesPortfolioMustPay - minimumMonthlyReinvest

    const months = Math.max(12, Math.min(50 * 12, Math.round(years * 12)))
    const monthlyInflation = Math.pow(Math.max(0.0001, 1 + inflation), 1 / 12) - 1
    const monthlyIncomeIndex = Math.pow(Math.max(0.0001, 1 + incomeIndexPct / 100), 1 / 12) - 1
    const reinvestShare = clamp(surplusReinvestPct, 0, 100) / 100
    const withdrawShare = clamp(surplusWithdrawPct, 0, 100) / 100

    let bookNav = navBase
    let currentNav = navBase
    let expenses = monthlyExpenses
    let nonInvestment = nonInvestmentAfterTax
    let cash = startingCash
    let firstBufferMonth = bearIncomeProtected >= bufferTargetNow ? 0 : null
    let firstExpenseMonth = bearIncomeProtected >= expensesPortfolioMustPay ? 0 : null
    let depletedMonth = null
    const series = []

    for (let i = 1; i <= months; i += 1) {
      expenses *= (1 + monthlyInflation)
      nonInvestment *= (1 + monthlyIncomeIndex)
      const netExpenses = Math.max(0, expenses - nonInvestment)
      const minReinvestErosion = bookNav * navErosion / 12
      const minReinvestInflation = bookNav * Math.max(0, inflation) / 12
      const minReinvest = minReinvestErosion + minReinvestInflation
      const goodBeforeTax = bookNav * targetYield / 12
      const goodAfterTax = goodBeforeTax * (1 - investmentTax)
      const bearBookNav = bookNav * (1 - bearDecline)
      const bearCurrentNav = currentNav * (1 - bearDecline)
      const bearBeforeTax = bearCurrentNav * bearYield / 12
      const bearAfterTax = bearBeforeTax * (1 - investmentTax) * (1 - incomeHaircut)
      const target = netExpenses * bufferRatio
      const surplus = Math.max(0, goodAfterTax - netExpenses)
      const shortfall = Math.max(0, netExpenses - bearAfterTax)
      const withdrawnToCash = surplus * withdrawShare
      const reinvestableExcess = Math.max(0, surplus - withdrawnToCash)
      const discretionaryReinvest = Math.min(reinvestableExcess, surplus * reinvestShare)
      const reinvested = Math.min(goodAfterTax, minReinvest + discretionaryReinvest)
      const cashUsed = Math.min(cash, shortfall)
      cash = Math.max(0, cash + withdrawnToCash - cashUsed)
      bookNav += directContribution + reinvested
      currentNav = Math.max(0, currentNav + directContribution + reinvested - minReinvestErosion)
      const coverage = netExpenses > 0 ? goodAfterTax / netExpenses : Infinity
      const bearCoverage = netExpenses > 0 ? bearAfterTax / netExpenses : Infinity
      const targetCoverage = target > 0 ? goodAfterTax / target : Infinity
      if (firstExpenseMonth == null && bearAfterTax >= netExpenses) firstExpenseMonth = i
      if (firstBufferMonth == null && bearAfterTax >= target) firstBufferMonth = i
      if (depletedMonth == null && shortfall > 0 && cash <= 0.005) depletedMonth = i
      series.push({
        month: i,
        label: `M${i}`,
        year: Math.ceil(i / 12),
        income: goodAfterTax,
        incomeBeforeTax: goodBeforeTax,
        bearIncome: bearAfterTax,
        bearIncomeBeforeTax: bearBeforeTax,
        expenses,
        nonInvestment,
        netExpenses,
        target,
        excessAfterExpensesGood: goodAfterTax - netExpenses,
        excessAfterExpensesBear: bearAfterTax - netExpenses,
        surplus,
        shortfall,
        minReinvest,
        reinvested,
        bearReinvested: Math.min(Math.max(0, bearAfterTax), minReinvest),
        withdrawnToCash,
        cash,
        bookNav,
        currentNav,
        bearBookNav,
        bearCurrentNav,
        coverage,
        bearCoverage,
        targetCoverage,
      })
    }

    const last = series[series.length - 1] || {}
    let status = 'Building'
    if (expensesPortfolioMustPay <= 0.005) status = 'Covered'
    else if (bearIncomeProtected >= bufferTargetNow && (startingCash >= targetCash || shortfallNow <= 0.005)) status = 'Ready'
    else if (bearIncomeProtected >= bufferTargetNow || goodBufferRatio >= bufferRatio) status = 'Close'
    else if (bearIncomeProtected >= expensesPortfolioMustPay) status = 'Building'
    else if (cashRunwayMonths < 12) status = 'Risky'

    const first36 = series.slice(0, 36)
    const avgAnnual = (key) => first36.length
      ? first36.reduce((s, r) => s + (r[key] || 0), 0) / first36.length * 12
      : 0
    const avgMonthly = (key) => first36.length
      ? first36.reduce((s, r) => s + (r[key] || 0), 0) / first36.length
      : 0
    const avgMonthlyReinvested = avgMonthly('reinvested')
    const avgMonthlyGoodIncome = avgMonthly('income')

    return {
      portfolioValue,
      navBase,
      bearNav,
      annualIncome,
      currentMonthlyIncome,
      nonInvestmentGross,
      nonInvestmentAfterTax,
      expensesPortfolioMustPay,
      targetIncomeBeforeTax,
      targetIncomeAfterTax,
      targetIncomeAfterMinimumReinvest,
      bearIncomeBeforeTax,
      bearIncomeAfterTax,
      bearIncomeProtected,
      bearIncomeAfterMinimumReinvest,
      protectedMonthlyIncome: bearIncomeProtected,
      currentYield,
      targetYield,
      bearYield,
      targetCash,
      minReinvestForErosion,
      minReinvestForInflation,
      minimumMonthlyReinvest,
      bufferTargetNow,
      currentCoverage,
      goodBufferRatio,
      bearBufferRatio,
      protectedCoverage,
      bufferGap,
      shortfallNow,
      cashRunwayMonths,
      incomeOverUnderTarget,
      excessAfterExpensesAndReinvestGood,
      excessAfterExpensesAndReinvestBear,
      avgAnnualWithdrawals: avgAnnual('withdrawnToCash') + avgAnnual('netExpenses'),
      avgAnnualIncomeGood: avgAnnual('income'),
      avgAnnualIncomeBear: avgAnnual('bearIncome'),
      avgAnnualTaxesGood: avgAnnual('income') / Math.max(0.0001, 1 - investmentTax) * investmentTax,
      avgMonthlyReinvested,
      avgMonthlyReinvestedPct: avgMonthlyGoodIncome > 0 ? avgMonthlyReinvested / avgMonthlyGoodIncome * 100 : 0,
      firstBufferMonth,
      firstExpenseMonth,
      depletedMonth,
      finalIncome: last.income ?? targetIncomeAfterTax,
      finalExpenses: last.netExpenses ?? expensesPortfolioMustPay,
      finalCash: last.cash ?? startingCash,
      series,
      status,
    }
  }, [
    holdings,
    monthlyExpenses,
    bufferRatio,
    surplusWithdrawPct,
    surplusReinvestPct,
    startingCash,
    targetCashMonths,
    years,
    inflationPct,
    employmentIncome,
    companyPension,
    govPension,
    annuities,
    otherRecurringIncome,
    incomeIndexPct,
    nonInvestmentTaxPct,
    portfolioBookNav,
    targetYieldPct,
    navErosionPct,
    bearDeclinePct,
    bearYieldPct,
    investmentTaxPct,
    directContribution,
    incomeHaircutPct,
  ])

  const chartData = useMemo(() => {
    const s = model.series
    return [
      {
        x: s.map(r => r.month),
        y: s.map(r => r.expenses),
        type: 'scatter',
        mode: 'lines',
        name: 'Avg monthly expenses',
        line: { color: '#b8d8ea', width: 2, dash: 'dash' },
        hovertemplate: 'Month %{x}<br>Expenses: $%{y:,.2f}<extra></extra>',
      },
      {
        x: s.map(r => r.month),
        y: s.map(r => r.netExpenses),
        type: 'scatter',
        mode: 'lines',
        name: 'Net exp after inflows',
        line: { color: '#315f83', width: 2, dash: 'dot' },
        hovertemplate: 'Month %{x}<br>Net expenses: $%{y:,.2f}<extra></extra>',
      },
      {
        x: s.map(r => r.month),
        y: s.map(r => r.bearIncome),
        type: 'scatter',
        mode: 'lines',
        name: 'Dist. @ bear yield after tax',
        line: { color: '#ff6b6b', width: 3 },
        hovertemplate: 'Month %{x}<br>Bear income: $%{y:,.2f}<extra></extra>',
      },
      {
        x: s.map(r => r.month),
        y: s.map(r => r.income),
        type: 'scatter',
        mode: 'lines',
        name: 'Dist. @ target yield after tax',
        line: { color: '#39c686', width: 3 },
        hovertemplate: 'Month %{x}<br>Good income: $%{y:,.2f}<extra></extra>',
      },
      {
        x: s.map(r => r.month),
        y: s.map(r => r.target),
        type: 'scatter',
        mode: 'lines',
        name: 'Target MEPB $',
        line: { color: '#c57aa8', width: 2, dash: 'dash' },
        hovertemplate: 'Month %{x}<br>Target: $%{y:,.2f}<extra></extra>',
      },
    ]
  }, [model.series])

  const topHoldings = useMemo(() => {
    const stressFactor = model.currentMonthlyIncome > 0 ? model.bearIncomeProtected / model.currentMonthlyIncome : 0
    const totalIncome = holdings.reduce((s, h) => s + h.monthlyIncome, 0)
    return [...holdings]
      .sort((a, b) => b.monthlyIncome - a.monthlyIncome)
      .slice(0, 15)
      .map(h => ({
        ...h,
        stressMonthlyIncome: h.monthlyIncome * stressFactor,
        incomeShare: totalIncome > 0 ? h.monthlyIncome / totalIncome * 100 : 0,
      }))
  }, [holdings, model.currentMonthlyIncome, model.bearIncomeProtected])

  const yearlyRows = useMemo(() => {
    const rowsByYear = []
    for (let y = 1; y <= Math.ceil(model.series.length / 12); y += 1) {
      const slice = model.series.filter(r => r.year === y)
      if (!slice.length) continue
      const last = slice[slice.length - 1]
      rowsByYear.push({
        year: y,
        income: last.income,
        bearIncome: last.bearIncome,
        expenses: last.expenses,
        nonInvestment: last.nonInvestment,
        netExpenses: last.netExpenses,
        target: last.target,
        coverage: last.coverage,
        bearCoverage: last.bearCoverage,
        surplus: slice.reduce((s, r) => s + r.surplus, 0),
        minimumReinvest: slice.reduce((s, r) => s + r.minReinvest, 0),
        reinvested: slice.reduce((s, r) => s + r.reinvested, 0),
        withdrawnToCash: slice.reduce((s, r) => s + r.withdrawnToCash, 0),
        cash: last.cash,
        bookNav: last.bookNav,
        currentNav: last.currentNav,
      })
    }
    return rowsByYear
  }, [model.series])

  const projectionRows = useMemo(() => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const start = new Date()
    const rows = []
    for (let y = 1; y <= Math.ceil(model.series.length / 12); y += 1) {
      const slice = model.series.filter(r => r.year === y)
      slice.forEach(r => {
        const d = new Date(start.getFullYear(), start.getMonth() + r.month - 1, 1)
        rows.push({
          type: 'month',
          key: `m-${r.month}`,
          year: r.year,
          monthLabel: `${monthNames[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`,
          ...r,
        })
      })
      if (slice.length) {
        const last = slice[slice.length - 1]
        const sum = key => slice.reduce((s, r) => s + (Number(r[key]) || 0), 0)
        rows.push({
          type: 'total',
          key: `t-${y}`,
          year: y,
          monthLabel: 'TOTALS',
          expenses: sum('expenses'),
          nonInvestment: sum('nonInvestment'),
          netExpenses: sum('netExpenses'),
          bookNav: last.bookNav,
          currentNav: last.currentNav,
          incomeBeforeTax: sum('incomeBeforeTax'),
          income: sum('income'),
          target: sum('target'),
          coverage: last.coverage,
          excessAfterExpensesGood: sum('excessAfterExpensesGood'),
          minReinvest: sum('minReinvest'),
          reinvested: sum('reinvested'),
          withdrawnToCash: sum('withdrawnToCash'),
          bearBookNav: last.bearBookNav,
          bearCurrentNav: last.bearCurrentNav,
          bearIncomeBeforeTax: sum('bearIncomeBeforeTax'),
          bearIncome: sum('bearIncome'),
          bearCoverage: last.bearCoverage,
          excessAfterExpensesBear: sum('excessAfterExpensesBear'),
          bearReinvested: sum('bearReinvested'),
        })
      }
    }
    return rows
  }, [model.series])

  const monthLabel = m => {
    if (m == null) return 'Not in horizon'
    if (m === 0) return 'Now'
    const years = Math.floor((m - 1) / 12)
    const month = ((m - 1) % 12) + 1
    return years > 0 ? `Year ${years + 1}, month ${month}` : `Month ${month}`
  }

  return (
    <div className="page rr-page">
      <div className="rr-header">
        <div>
          <h1>Retirement Readiness</h1>
          <p className="rr-subtitle">
            {currentProfileName}{isAggregate ? ' aggregate' : ''} income measured against monthly expenses and a monthly expense protection buffer.
          </p>
        </div>
        <ReadinessBadge status={model.status} />
      </div>

      {loading && <p className="rr-loading">Loading holdings...</p>}
      {error && <p className="rr-error">{error}</p>}

      {!loading && !error && (
        <>
          <InputSection title="Critical Monthly Inputs">
            <InputField label="Monthly Expenses" help={INPUT_HELP.monthlyExpenses}>
              <input title={INPUT_HELP.monthlyExpenses} className="rr-input" type="number" min="0" step="100" value={monthlyExpenses} onChange={e => setMonthlyExpenses(num(e.target.value))} />
            </InputField>
            <InputField label="Cash Reserve Months" help={INPUT_HELP.targetCashMonths}>
              <input title={INPUT_HELP.targetCashMonths} className="rr-input" type="number" min="0" max="60" step="1" value={targetCashMonths} onChange={e => setTargetCashMonths(clamp(num(e.target.value), 0, 60))} />
            </InputField>
            <InputField label="MEPB Ratio" help={INPUT_HELP.bufferRatio}>
              <input title={INPUT_HELP.bufferRatio} className="rr-input" type="number" min="1" max="10" step="0.25" value={bufferRatio} onChange={e => setBufferRatio(clamp(num(e.target.value), 1, 10))} />
            </InputField>
            <InputField label="Excess Withdrawn %" help={INPUT_HELP.surplusWithdrawPct}>
              <input title={INPUT_HELP.surplusWithdrawPct} className="rr-input" type="number" min="0" max="100" step="5" value={surplusWithdrawPct} onChange={e => setSurplusWithdrawPct(clamp(num(e.target.value), 0, 100))} />
            </InputField>
            <InputField label="Excess Reinvested %" help={INPUT_HELP.surplusReinvestPct}>
              <input title={INPUT_HELP.surplusReinvestPct} className="rr-input" type="number" min="0" max="100" step="5" value={surplusReinvestPct} onChange={e => setSurplusReinvestPct(clamp(num(e.target.value), 0, 100))} />
            </InputField>
            <InputField label="Expense Inflation %" help={INPUT_HELP.inflationPct}>
              <input title={INPUT_HELP.inflationPct} className="rr-input" type="number" step="0.25" value={inflationPct} onChange={e => setInflationPct(num(e.target.value))} />
            </InputField>
            <InputField label="Cash Reserve $" help={INPUT_HELP.startingCash}>
              <input title={INPUT_HELP.startingCash} className="rr-input" type="number" min="0" step="500" value={startingCash} onChange={e => setStartingCash(num(e.target.value))} />
            </InputField>
            <InputField label="Years" help={INPUT_HELP.years}>
              <input title={INPUT_HELP.years} className="rr-input" type="number" min="1" max="50" step="1" value={years} onChange={e => setYears(clamp(num(e.target.value), 1, 50))} />
            </InputField>
          </InputSection>

          <InputSection title="Non-Investment Monthly Inflows">
            <InputField label="Employment Income" help={INPUT_HELP.nonInvestmentIncome}>
              <input title={INPUT_HELP.nonInvestmentIncome} className="rr-input" type="number" min="0" step="100" value={employmentIncome} onChange={e => setEmploymentIncome(num(e.target.value))} />
            </InputField>
            <InputField label="Company Pension" help={INPUT_HELP.nonInvestmentIncome}>
              <input title={INPUT_HELP.nonInvestmentIncome} className="rr-input" type="number" min="0" step="100" value={companyPension} onChange={e => setCompanyPension(num(e.target.value))} />
            </InputField>
            <InputField label="Gov. Pension" help={INPUT_HELP.nonInvestmentIncome}>
              <input title={INPUT_HELP.nonInvestmentIncome} className="rr-input" type="number" min="0" step="100" value={govPension} onChange={e => setGovPension(num(e.target.value))} />
            </InputField>
            <InputField label="Annuities" help={INPUT_HELP.nonInvestmentIncome}>
              <input title={INPUT_HELP.nonInvestmentIncome} className="rr-input" type="number" min="0" step="100" value={annuities} onChange={e => setAnnuities(num(e.target.value))} />
            </InputField>
            <InputField label="Other Recurring" help={INPUT_HELP.nonInvestmentIncome}>
              <input title={INPUT_HELP.nonInvestmentIncome} className="rr-input" type="number" min="0" step="100" value={otherRecurringIncome} onChange={e => setOtherRecurringIncome(num(e.target.value))} />
            </InputField>
            <InputField label="Indexing Factor %" help={INPUT_HELP.incomeIndexPct}>
              <input title={INPUT_HELP.incomeIndexPct} className="rr-input" type="number" step="0.25" value={incomeIndexPct} onChange={e => setIncomeIndexPct(num(e.target.value))} />
            </InputField>
            <InputField label="Inflows Tax Rate %" help={INPUT_HELP.nonInvestmentTaxPct}>
              <input title={INPUT_HELP.nonInvestmentTaxPct} className="rr-input" type="number" min="0" max="95" step="1" value={nonInvestmentTaxPct} onChange={e => setNonInvestmentTaxPct(clamp(num(e.target.value), 0, 95))} />
            </InputField>
          </InputSection>

          <InputSection title="Passive Income Assumptions">
            <InputField label="Portfolio Book NAV" help={INPUT_HELP.portfolioBookNav}>
              <input title={INPUT_HELP.portfolioBookNav} className="rr-input" type="number" min="0" step="1000" value={portfolioBookNav} onChange={e => setPortfolioBookNav(num(e.target.value))} />
            </InputField>
            <InputField label="Target Yield Good %" help={INPUT_HELP.targetYieldPct}>
              <input title={INPUT_HELP.targetYieldPct} className="rr-input" type="number" min="0" max="100" step="0.25" value={targetYieldPct} onChange={e => setTargetYieldPct(clamp(num(e.target.value), 0, 100))} />
            </InputField>
            <InputField label="NAV Erosion %" help={INPUT_HELP.navErosionPct}>
              <input title={INPUT_HELP.navErosionPct} className="rr-input" type="number" min="0" max="100" step="0.25" value={navErosionPct} onChange={e => setNavErosionPct(clamp(num(e.target.value), 0, 100))} />
            </InputField>
            <InputField label="Bear Decline %" help={INPUT_HELP.bearDeclinePct}>
              <input title={INPUT_HELP.bearDeclinePct} className="rr-input" type="number" min="0" max="95" step="5" value={bearDeclinePct} onChange={e => setBearDeclinePct(clamp(num(e.target.value), 0, 95))} />
            </InputField>
            <InputField label="Bear Yield %" help={INPUT_HELP.bearYieldPct}>
              <input title={INPUT_HELP.bearYieldPct} className="rr-input" type="number" min="0" max="100" step="0.25" value={bearYieldPct} onChange={e => setBearYieldPct(clamp(num(e.target.value), 0, 100))} />
            </InputField>
            <InputField label="Investment Tax %" help={INPUT_HELP.investmentTaxPct}>
              <input title={INPUT_HELP.investmentTaxPct} className="rr-input" type="number" min="0" max="95" step="1" value={investmentTaxPct} onChange={e => setInvestmentTaxPct(clamp(num(e.target.value), 0, 95))} />
            </InputField>
            <InputField label="Income Haircut %" help={INPUT_HELP.incomeHaircutPct}>
              <input title={INPUT_HELP.incomeHaircutPct} className="rr-input" type="number" min="0" max="95" step="5" value={incomeHaircutPct} onChange={e => setIncomeHaircutPct(clamp(num(e.target.value), 0, 95))} />
            </InputField>
            <InputField label="Direct Contribution" help={INPUT_HELP.directContribution}>
              <input title={INPUT_HELP.directContribution} className="rr-input" type="number" min="0" step="100" value={directContribution} onChange={e => setDirectContribution(num(e.target.value))} />
            </InputField>
          </InputSection>

          <div className="rr-stat-grid">
            <StatTile label="Current Monthly Income" value={fmtMoney(model.currentMonthlyIncome)} />
            <StatTile label="Good Market After Tax" value={fmtMoney(model.targetIncomeAfterTax)} tone="good" />
            <StatTile label="Bear Market After Tax" value={fmtMoney(model.bearIncomeProtected)} tone={model.bearIncomeProtected >= model.expensesPortfolioMustPay ? 'warn' : 'bad'} />
            <StatTile label="Non-Investment Inflows" value={fmtMoney(model.nonInvestmentAfterTax)} sub="after tax" />
            <StatTile label="Monthly Expenses" value={fmtMoney(monthlyExpenses)} />
            <StatTile label="Portfolio Must Pay" value={fmtMoney(model.expensesPortfolioMustPay)} />
            <StatTile label="MEPB Target" value={fmtMoney(model.bufferTargetNow)} sub={`${bufferRatio.toFixed(2)}x portfolio-paid expenses`} tone="info" />
            <StatTile label="Bear Buffer Ratio" value={Number.isFinite(model.bearBufferRatio) ? `${model.bearBufferRatio.toFixed(2)}x` : 'Covered'} tone={model.bearBufferRatio >= bufferRatio ? 'good' : model.bearBufferRatio >= 1 ? 'warn' : 'bad'} />
            <StatTile label="Buffer Gap" value={fmtMoney(model.bufferGap)} tone={model.bufferGap <= 0 ? 'good' : 'warn'} />
            <StatTile label="Cash Target" value={fmtMoney(model.targetCash)} sub={`${targetCashMonths} months`} />
            <StatTile label="Cash Runway" value={Number.isFinite(model.cashRunwayMonths) ? `${model.cashRunwayMonths.toFixed(1)} mo` : 'Covered'} tone={model.cashRunwayMonths < 12 ? 'bad' : 'good'} />
          </div>

          <div className="rr-panel-grid">
            <div className="rr-panel">
              <h3 className="rr-panel-title">Passive Income Calculations</h3>
              <MetricLine label="Book NAV Used" value={fmtMoney(model.navBase)} />
              <MetricLine label="Target Yield Income Before Tax" value={fmtMoney(model.targetIncomeBeforeTax)} />
              <MetricLine label="Target Yield Income After Tax" value={fmtMoney(model.targetIncomeAfterTax)} />
              <MetricLine label="Min Reinvest for NAV Erosion" value={fmtMoney(model.minReinvestForErosion)} />
              <MetricLine label="Min Reinvest for Inflation" value={fmtMoney(model.minReinvestForInflation)} />
              <MetricLine label="Est. Minimum Reinvestment" value={fmtMoney(model.minimumMonthlyReinvest)} />
              <MetricLine label="After Tax and Minimum Reinvestment" value={fmtMoney(model.targetIncomeAfterMinimumReinvest)} tone={model.targetIncomeAfterMinimumReinvest >= 0 ? 'good' : 'bad'} />
              <MetricLine label="Bear-Market Income After Tax" value={fmtMoney(model.bearIncomeProtected)} tone={model.bearIncomeProtected >= model.expensesPortfolioMustPay ? 'good' : 'bad'} />
            </div>

            <div className="rr-panel">
              <h3 className="rr-panel-title">Important Monthly Metrics</h3>
              <MetricLine label="Income Needed to Hit MEPB" value={fmtMoney(model.bufferTargetNow)} />
              <MetricLine label="Income Over / Under MEPB" value={fmtMoney(model.incomeOverUnderTarget)} tone={model.incomeOverUnderTarget >= 0 ? 'good' : 'bad'} />
              <MetricLine label="Good-Market Buffer Ratio" value={Number.isFinite(model.goodBufferRatio) ? `${model.goodBufferRatio.toFixed(2)}x` : 'Covered'} tone={model.goodBufferRatio >= bufferRatio ? 'good' : 'warn'} />
              <MetricLine label="Bear-Market Buffer Ratio" value={Number.isFinite(model.bearBufferRatio) ? `${model.bearBufferRatio.toFixed(2)}x` : 'Covered'} tone={model.bearBufferRatio >= bufferRatio ? 'good' : model.bearBufferRatio >= 1 ? 'warn' : 'bad'} />
              <MetricLine label="3Y Avg Annual Withdrawals" value={fmtMoney(model.avgAnnualWithdrawals)} />
              <MetricLine label="3Y Avg Annual Income Good" value={fmtMoney(model.avgAnnualIncomeGood)} />
              <MetricLine label="3Y Avg Annual Income Bear" value={fmtMoney(model.avgAnnualIncomeBear)} />
              <MetricLine label="3Y Avg Annual Taxes" value={fmtMoney(model.avgAnnualTaxesGood)} />
              <MetricLine label="Excess After Expenses & Reinvest Good" value={fmtMoney(model.excessAfterExpensesAndReinvestGood)} tone={model.excessAfterExpensesAndReinvestGood >= 0 ? 'good' : 'bad'} />
              <MetricLine label="Excess After Expenses & Reinvest Bear" value={fmtMoney(model.excessAfterExpensesAndReinvestBear)} tone={model.excessAfterExpensesAndReinvestBear >= 0 ? 'good' : 'bad'} />
              <MetricLine label="3Y Avg Monthly Distributions Reinvested" value={fmtMoney(model.avgMonthlyReinvested)} />
              <MetricLine label="3Y Avg Reinvested % of Distributions" value={fmtPct(model.avgMonthlyReinvestedPct, 0)} />
            </div>
          </div>

          <div className="rr-panel-grid">
            <div className="rr-panel">
              <h3 className="rr-panel-title">Passive Income - MEPB Trend Lines</h3>
              <Plot
                data={chartData}
                layout={{
                  template: ct.template,
                  height: 420,
                  autosize: true,
                  margin: { t: 86, b: 55, l: 75, r: 35 },
                  font: { color: ct.font },
                  xaxis: { title: 'Month', gridcolor: ct.grid, zerolinecolor: ct.zeroline },
                  yaxis: { title: 'Monthly income & expenses', tickprefix: '$', gridcolor: ct.grid, zerolinecolor: ct.zeroline },
                  legend: {
                    orientation: 'h',
                    y: 1.2,
                    x: 0.5,
                    xanchor: 'center',
                    yanchor: 'bottom',
                    font: { color: ct.font },
                  },
                  hovermode: 'x unified',
                  paper_bgcolor: ct.paper,
                  plot_bgcolor: ct.plot,
                }}
                useResizeHandler
                className="rr-chart"
                config={{ responsive: true, displayModeBar: false }}
              />
            </div>

            <div className="rr-panel">
              <h3 className="rr-panel-title">Milestones</h3>
              <div className="rr-milestone">
                <span>Income covers expenses</span>
                <strong>{monthLabel(model.firstExpenseMonth)}</strong>
              </div>
              <div className="rr-milestone">
                <span>Income reaches MEPB target</span>
                <strong>{monthLabel(model.firstBufferMonth)}</strong>
              </div>
              <div className="rr-milestone">
                <span>Cash reserve depletion</span>
                <strong>{model.depletedMonth == null ? 'Not in horizon' : monthLabel(model.depletedMonth)}</strong>
              </div>
              <div className="rr-milestone">
                <span>Final monthly income</span>
                <strong>{fmtMoney(model.finalIncome)}</strong>
              </div>
              <div className="rr-milestone">
                <span>Final monthly expenses</span>
                <strong>{fmtMoney(model.finalExpenses)}</strong>
              </div>
              <div className="rr-milestone">
                <span>Final cash reserve</span>
                <strong>{fmtMoney(model.finalCash)}</strong>
              </div>
            </div>
          </div>

          <div className="rr-panel">
            <h3 className="rr-panel-title">Yearly Projection</h3>
            <div className="rr-scroll">
              <table className="rr-table rr-table-compact">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="rr-num">Book NAV</th>
                    <th className="rr-num">Current NAV</th>
                    <th className="rr-num">Good Income</th>
                    <th className="rr-num">Bear Income</th>
                    <th className="rr-num">Monthly Expenses</th>
                    <th className="rr-num">Non-Inv Inflows</th>
                    <th className="rr-num">Portfolio Pays</th>
                    <th className="rr-num">MEPB Target</th>
                    <th className="rr-num">Good Ratio</th>
                    <th className="rr-num">Bear Ratio</th>
                    <th className="rr-num">Annual Surplus</th>
                    <th className="rr-num">Min Reinvest</th>
                    <th className="rr-num">Reinvested</th>
                    <th className="rr-num">To Cash</th>
                    <th className="rr-num">Cash Reserve</th>
                  </tr>
                </thead>
                <tbody>
                  {yearlyRows.map(r => (
                    <tr key={r.year}>
                      <td>Year {r.year}</td>
                      <td className="rr-num">{fmtMoney(r.bookNav)}</td>
                      <td className="rr-num">{fmtMoney(r.currentNav)}</td>
                      <td className="rr-num">{fmtMoney(r.income)}</td>
                      <td className="rr-num">{fmtMoney(r.bearIncome)}</td>
                      <td className="rr-num">{fmtMoney(r.expenses)}</td>
                      <td className="rr-num">{fmtMoney(r.nonInvestment)}</td>
                      <td className="rr-num">{fmtMoney(r.netExpenses)}</td>
                      <td className="rr-num">{fmtMoney(r.target)}</td>
                      <td className={`rr-num rr-tone-${r.coverage >= bufferRatio ? 'good' : r.coverage >= 1 ? 'warn' : 'bad'}`}>{r.coverage.toFixed(2)}x</td>
                      <td className={`rr-num rr-tone-${r.bearCoverage >= bufferRatio ? 'good' : r.bearCoverage >= 1 ? 'warn' : 'bad'}`}>{r.bearCoverage.toFixed(2)}x</td>
                      <td className="rr-num">{fmtMoney(r.surplus)}</td>
                      <td className="rr-num">{fmtMoney(r.minimumReinvest)}</td>
                      <td className="rr-num">{fmtMoney(r.reinvested)}</td>
                      <td className="rr-num">{fmtMoney(r.withdrawnToCash)}</td>
                      <td className="rr-num">{fmtMoney(r.cash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rr-panel">
            <h3 className="rr-panel-title">Monthly MEPB Projection Table</h3>
            <div className="rr-projection-scroll">
              <table className="rr-table rr-table-projection">
                <thead>
                  <tr>
                    <th colSpan="2" className="rr-sticky-head">Calendar</th>
                    <th colSpan="3" className="rr-sticky-head rr-head-expenses">Expenses & Inflows</th>
                    <th colSpan="11" className="rr-sticky-head rr-head-good">With Good Markets Allowing Target Yield</th>
                    <th colSpan="9" className="rr-sticky-head rr-head-bear">During Major Bear Markets</th>
                  </tr>
                  <tr>
                    <th className="rr-sticky-head">Year</th>
                    <th className="rr-sticky-head">Month</th>
                    <th className="rr-sticky-head">Avg Monthly Expenses</th>
                    <th className="rr-sticky-head">Non-Inv Inflows</th>
                    <th className="rr-sticky-head">Net Exp. After Inflows</th>
                    <th className="rr-sticky-head">Book NAV</th>
                    <th className="rr-sticky-head">Curr NAV</th>
                    <th className="rr-sticky-head">Dist. Before Tax</th>
                    <th className="rr-sticky-head">Dist. After Tax</th>
                    <th className="rr-sticky-head">MEPB Target</th>
                    <th className="rr-sticky-head">MEPB Ratio</th>
                    <th className="rr-sticky-head">Excess After Exp</th>
                    <th className="rr-sticky-head">Minimum Reinvest</th>
                    <th className="rr-sticky-head">Actual Reinvested</th>
                    <th className="rr-sticky-head">To Cash Reserve</th>
                    <th className="rr-sticky-head">Direct Contrib.</th>
                    <th className="rr-sticky-head">Book NAV</th>
                    <th className="rr-sticky-head">Curr NAV</th>
                    <th className="rr-sticky-head">Dist. Before Tax</th>
                    <th className="rr-sticky-head">Dist. After Tax</th>
                    <th className="rr-sticky-head">MEPB Ratio</th>
                    <th className="rr-sticky-head">Excess After Exp</th>
                    <th className="rr-sticky-head">Minimum Reinvest</th>
                    <th className="rr-sticky-head">Amt Reinvested</th>
                    <th className="rr-sticky-head">To Cash Reserve</th>
                  </tr>
                </thead>
                <tbody>
                  {projectionRows.map(r => {
                    const total = r.type === 'total'
                    return (
                      <tr key={r.key} className={total ? 'rr-total-row' : undefined}>
                        <td>{r.year}</td>
                        <td>{r.monthLabel}</td>
                        <td className="rr-num">{fmtMoney(r.expenses, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.nonInvestment, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.netExpenses, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.bookNav, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.currentNav, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.incomeBeforeTax, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.income, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.target, 0)}</td>
                        <td className={`rr-num rr-tone-${r.coverage >= bufferRatio ? 'good' : r.coverage >= 1 ? 'warn' : 'bad'}`}>{Number.isFinite(r.coverage) ? r.coverage.toFixed(1) : '-'}</td>
                        <td className="rr-num">{fmtMoney(r.excessAfterExpensesGood, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.minReinvest, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.reinvested, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.withdrawnToCash, 0)}</td>
                        <td className="rr-num">{total ? '-' : fmtMoney(directContribution, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.bearBookNav, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.bearCurrentNav, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.bearIncomeBeforeTax, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.bearIncome, 0)}</td>
                        <td className={`rr-num rr-tone-${r.bearCoverage >= bufferRatio ? 'good' : r.bearCoverage >= 1 ? 'warn' : 'bad'}`}>{Number.isFinite(r.bearCoverage) ? r.bearCoverage.toFixed(1) : '-'}</td>
                        <td className="rr-num">{fmtMoney(r.excessAfterExpensesBear, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.minReinvest, 0)}</td>
                        <td className="rr-num">{fmtMoney(r.bearReinvested, 0)}</td>
                        <td className="rr-num">-</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rr-panel">
            <h3 className="rr-panel-title">Top Income Sources</h3>
            <div className="rr-scroll">
              <table className="rr-table rr-table-compact">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Description</th>
                    <th className="rr-num">Value</th>
                    <th className="rr-num">Monthly Income</th>
                    <th className="rr-num">Stress Income</th>
                    <th className="rr-num">Yield</th>
                    <th className="rr-num">Income Share</th>
                  </tr>
                </thead>
                <tbody>
                  {topHoldings.map(h => (
                    <tr key={h.ticker}>
                      <td className="rr-ticker">{h.ticker}</td>
                      <td className="rr-description">{h.description}</td>
                      <td className="rr-num">{fmtMoney(h.currentValue)}</td>
                      <td className="rr-num">{fmtMoney(h.monthlyIncome)}</td>
                      <td className="rr-num">{fmtMoney(h.stressMonthlyIncome)}</td>
                      <td className="rr-num">{fmtPct(h.yieldPct)}</td>
                      <td className="rr-num">{fmtPct(h.incomeShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}



