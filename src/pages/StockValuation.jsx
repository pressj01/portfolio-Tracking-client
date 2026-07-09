import React, { useCallback, useEffect, useState } from 'react'
import { API_BASE } from '../config'
import ThemedPlot from '../components/ThemedPlot'
import { formatMoney, formatMoneyCompact } from '../utils/money'
import {
  toneClass,
  formatRowValue,
  formatBenchmark,
  formatPrice,
  formatPct,
  fracToPct,
  pctToFrac,
} from '../utils/valuationGrading'

const fmtCap = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-'
  const v = Number(n)
  return Math.abs(v) >= 1e6 ? formatMoneyCompact(v, { fallback: '-' }) : formatMoney(v, { fallback: '-' })
}

function Badge({ tone, children }) {
  return <span className={`stock-check-badge tone-${toneClass(tone)}`}>{children}</span>
}

// Collapsible "How to read these" explanations, keyed by scorecard section id.
// CVS (a cheap, low-margin healthcare name) is used as a running example.
const SECTION_HELP = {
  valuation: {
    intro: 'These say how much you pay per dollar of earnings, book value, sales and cash, graded against a "fair" multiple for the sector (lower is cheaper). They tell you whether a stock is cheap — not whether it is a good business.',
    items: [
      ['Forward P/E', 'Price ÷ next year’s expected earnings per share. Lower is cheaper. CVS at 12.4× sits below the ~18× healthcare baseline, so it screens cheap on earnings.'],
      ['PEG ratio', 'Forward P/E ÷ expected growth. Around 1.0 is fair; under 1 is cheap for the growth on offer. CVS’s 0.29 looks very cheap, but it leans on a growth estimate measured off today’s depressed earnings, so treat extreme lows with caution.'],
      ['Price / Book', 'Price vs. net assets (book value) per share. Under 1 means it trades below accounting net worth. CVS’s 1.7× is modest.'],
      ['Price / Sales', 'Price vs. revenue per share. Handy when earnings are near zero or noisy. CVS’s 0.33× is very low — typical of thin-margin distribution/insurance models.'],
      ['FCF yield', 'Free cash flow ÷ market cap — the cash the business throws off for the price you pay; higher is cheaper. Compare it to the dividend yield: if FCF yield is higher, cash still covers the dividend. CVS’s ~3.9% sits above its ~2.6% dividend yield, so the payout is cash-covered.'],
      ['Dividend payout', 'Dividends ÷ earnings per share. Under ~60% leaves a cushion. Over 100% (CVS at 116.7%) means it paid out more than it earned — a flag — but check whether earnings are temporarily depressed and whether free cash flow still covers it (for CVS, it does).'],
    ],
  },
  quality: {
    intro: 'Profitability and returns on capital answer "is this a good business?" — separate from whether it is cheap. Higher is better; consistently high figures signal a durable advantage.',
    items: [
      ['Return on equity', 'Net income ÷ shareholder equity — profit earned on each dollar of owners’ capital. CVS’s 3.75% is weak, dragged down by depressed earnings.'],
      ['Return on assets', 'Net income ÷ total assets — how efficiently the whole asset base is put to work.'],
      ['Operating margin', 'Operating profit ÷ revenue — core profitability before financing and taxes. CVS’s 4.1% is thin.'],
      ['Net margin', 'Bottom-line profit per dollar of sales. CVS’s 0.72% is razor-thin, which is exactly why its payout ratio looks so high.'],
      ['Gross margin', 'Revenue minus cost of goods, as a % of revenue. Structurally low for distribution/insurance businesses like CVS, so judge it against peers.'],
    ],
  },
  health: {
    intro: 'Leverage and liquidity answer "can it weather a downturn and service its debt?" Lower debt and higher coverage are safer, though banks and utilities run higher leverage by nature.',
    items: [
      ['Debt / equity', 'Borrowed money vs. shareholder equity. Shown on Yahoo’s percent scale (100 = 1.0×). Higher means more leverage.'],
      ['Debt ratio', 'Total debt ÷ total assets. Under ~0.5 means less than half the asset base is funded by debt.'],
      ['Interest coverage', 'Operating income (EBIT) ÷ interest expense — how many times over earnings cover the interest bill. Above ~5 is comfortable; under ~2 is fragile.'],
      ['Current ratio', 'Current assets ÷ current liabilities. Above ~1.5 means short-term bills are comfortably covered.'],
    ],
  },
  risk: {
    intro: 'These grade the past ~3 years of daily price action: how much return the stock delivered for the bumpiness endured. Higher is better across all four.',
    items: [
      ['Sharpe ratio', 'Excess return per unit of total volatility. Above 1 is good, above 2 is excellent.'],
      ['Sortino ratio', 'Like Sharpe, but penalizes only downside volatility — it doesn’t punish upside swings.'],
      ['Calmar ratio', 'Annualized return ÷ worst peak-to-trough drawdown. Rewards steady gains over deep crashes.'],
      ['Omega ratio', 'Probability-weighted gains ÷ losses. Above 1 means gains outweigh losses; higher is better.'],
    ],
  },
}

const INTRINSIC_HELP = {
  intro: 'Fair value is estimated up to five ways, then blended (the low–high of the methods is shown as a range). Whichever methods have data are weighted and averaged.',
  items: [
    ['Discounted cash flow', 'Projects the company’s free cash flow forward, adds a terminal value, and discounts it all back to today’s dollars. Carries the most weight when free cash flow is positive; for banks and no-cash-flow names it drops out and the multiples carry the estimate.'],
    ['Fair forward P/E', 'A conservative sector P/E applied to next year’s expected earnings per share.'],
    ['Fair price / book & price / sales', 'Sector-fair book-value and sales multiples applied to CVS’s per-share book value and sales — useful anchors when earnings are depressed.'],
    ['Dividend discount model', 'For dividend payers, values the stock as the present value of its growing future dividends (Gordon model).'],
    ['Outliers & confidence', 'A method that lands wildly out of line with the others (e.g. a sector price/sales multiple applied to a thin-margin distributor like CVS) is flagged "excluded" and dropped from the blend. The Confidence label then reflects how tightly the surviving methods agree — when it reads "low", the methods disagree a lot, so treat the fair value as a rough signal and weigh the ratio scorecard more heavily.'],
    ['Verdict & margin of safety', 'The blended fair value is compared to the current price. More than 15% below fair value reads Undervalued, within ±15% is Fairly Valued, more than 15% above is Overvalued. The margin of safety is the discount to fair value — positive means a cushion, negative means you are paying a premium.'],
  ],
}

function HelpDetails({ help, summary = 'How to read these' }) {
  if (!help) return null
  return (
    <details className="stock-check-details">
      <summary>{summary}</summary>
      {help.intro && <p className="stock-val-help-intro">{help.intro}</p>}
      <ul>
        {help.items.map(([term, text], i) => (
          <li key={i}><strong>{term}</strong> — {text}</li>
        ))}
      </ul>
    </details>
  )
}

const CONFIDENCE_NOTE = {
  low: 'Low confidence — the valuation methods disagree widely (some were excluded as outliers). Treat this verdict as a rough signal, not a precise number, and lean on the ratio scorecard below.',
  medium: 'Moderate confidence — the valuation methods show some spread. Sanity-check against the ratio scorecard below.',
}

function VerdictBanner({ data }) {
  const { verdict, intrinsic, price } = data
  const confNote = CONFIDENCE_NOTE[intrinsic.confidence]
  return (
    <div className={`stock-check-verdict tone-${toneClass(verdict.tone)}`}>
      <span>Verdict: {verdict.label}</span>
      <div className="stock-val-verdict-figures">
        <span><span>Current price: </span><strong>{formatPrice(price)}</strong></span>
        <span><span>Estimated fair value: </span><strong>{formatPrice(intrinsic.value)}</strong></span>
        {verdict.margin_of_safety_pct !== null && (
          <span>
            <span>Margin of safety: </span>
            <strong>{formatPct(verdict.margin_of_safety_pct)}</strong>
          </span>
        )}
        {intrinsic.confidence && (
          <span>
            <span>Confidence: </span>
            <strong style={{ textTransform: 'capitalize' }}>{intrinsic.confidence}</strong>
          </span>
        )}
      </div>
      <p>{verdict.detail}</p>
      {confNote && <p className="stock-val-confidence-note">{confNote}</p>}
    </div>
  )
}

function IntrinsicChart({ methods, price }) {
  const valid = (methods || []).filter(m => Number.isFinite(Number(m.value)))
  if (!valid.length) return null
  const x = [...valid.map(m => m.name), 'Current price']
  const y = [...valid.map(m => Number(m.value)), Number(price)]
  const colors = [...valid.map(() => 'var(--accent, #4c8bf5)'), '#e08a3c']
  // Resolve the CSS var to a literal so Plotly (which can't read CSS vars) colours bars.
  const data = [{
    type: 'bar',
    x,
    y,
    marker: { color: colors.map(c => (c.startsWith('var(') ? '#4c8bf5' : c)) },
    hovertemplate: '%{x}<br>$%{y:,.2f}<extra></extra>',
  }]
  const layout = {
    height: 320,
    margin: { l: 60, r: 20, t: 30, b: 90 },
    yaxis: { tickprefix: '$', title: { text: 'Implied price ($)' } },
    xaxis: { tickangle: -30 },
    showlegend: false,
    title: { text: 'Implied price by method vs current price' },
  }
  return <ThemedPlot data={data} layout={layout} style={{ width: '100%' }} config={{ displayModeBar: false, responsive: true }} themeSurface />
}

function MethodTable({ intrinsic }) {
  return (
    <div className="stock-check-table-wrap">
      <table className="stock-check-table">
        <thead>
          <tr>
            <th className="stock-check-align-left">Method</th>
            <th className="stock-check-align-right">Implied price</th>
            <th className="stock-check-align-right">Weight</th>
          </tr>
        </thead>
        <tbody>
          {intrinsic.methods.map(m => (
            <tr key={m.name} className={m.excluded ? 'stock-val-method-excluded' : ''}>
              <td>{m.name}{m.excluded && <small className="stock-val-row-note">excluded — outlier vs. other methods</small>}</td>
              <td className="stock-check-num">{formatPrice(m.value)}</td>
              <td className="stock-check-num stock-check-muted">{m.excluded ? '—' : formatPct(m.weight_pct)}</td>
            </tr>
          ))}
          <tr>
            <td><strong>Blended fair value</strong></td>
            <td className="stock-check-num stock-check-strong">{formatPrice(intrinsic.value)}</td>
            <td className="stock-check-num stock-check-muted">
              {intrinsic.low !== null && intrinsic.high !== null
                ? `${formatPrice(intrinsic.low)} – ${formatPrice(intrinsic.high)}`
                : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function DcfPanel({ dcf, draft, setDraft, onRecompute, loading }) {
  const field = (key, label, suffix) => (
    <label className="stock-val-field">
      <span>{label}</span>
      <span className="stock-val-input-wrap">
        <input
          className="stock-check-input"
          type="number"
          step={key === 'years' ? '1' : '0.1'}
          value={draft[key]}
          onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
        />
        {suffix && <span className="stock-val-suffix">{suffix}</span>}
      </span>
    </label>
  )
  return (
    <section className="stock-check-card stock-val-dcf-card">
      <div className="stock-check-criterion-head">
        <span className="stock-check-criterion-question">Discounted cash flow assumptions</span>
        {dcf.value !== null && <span className="stock-check-score-label">DCF: {formatPrice(dcf.value)}</span>}
      </div>
      {dcf.note && <p className="stock-check-rationale tone-warn">{dcf.note}</p>}
      <div className="stock-val-fields">
        {field('growth', 'Stage-1 growth', '%')}
        {field('discount', 'Discount rate', '%')}
        {field('terminal', 'Terminal growth', '%')}
        {field('years', 'Projection years', 'yr')}
        <button type="button" className="btn btn-primary" onClick={onRecompute} disabled={loading}>
          Recompute
        </button>
      </div>
      <div className="stock-check-meta">
        <span><span>Base free cash flow: </span><strong>{fmtCap(dcf.base_fcf)}</strong></span>
        <span><span>Net cash (cash − debt): </span><strong>{fmtCap(dcf.net_cash)}</strong></span>
      </div>
      <p className="stock-check-rationale">
        Auto-filled defaults: growth {fracToPct(dcf.defaults.growth)}%, discount {fracToPct(dcf.defaults.discount)}% (CAPM cost of equity),
        terminal {fracToPct(dcf.defaults.terminal)}%, {dcf.defaults.years} years. Edit any input and recompute to stress-test the valuation.
      </p>
    </section>
  )
}

function ScorecardSection({ section }) {
  return (
    <article className="stock-check-card stock-check-criterion-card">
      <div className="stock-check-criterion-head">
        <span className="stock-check-criterion-question">{section.title}</span>
        {section.grade.score !== null && (
          <span className="stock-check-score-label">{section.grade.label} · {section.grade.score}/100</span>
        )}
        <Badge tone={section.grade.tone}>{section.grade.label}</Badge>
      </div>
      <div className="stock-val-rows">
        {section.rows.map((row, i) => {
          const bench = formatBenchmark(row)
          return (
            <div className="stock-val-row" key={i}>
              <span className="stock-val-row-label">
                {row.label}
                {row.note && <small className="stock-val-row-note">{row.note}</small>}
              </span>
              <span className="stock-val-row-values">
                <strong className={`stock-check-metric-value tone-${toneClass(row.badge)}`}>
                  {formatRowValue(row)}
                </strong>
                {bench && <span className="stock-check-muted"> vs {bench}</span>}
              </span>
            </div>
          )
        })}
      </div>
      <HelpDetails help={SECTION_HELP[section.id]} />
    </article>
  )
}

export default function StockValuation() {
  const [inputTicker, setInputTicker] = useState('')
  const [activeTicker, setActiveTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({ growth: '', discount: '', terminal: '', years: '' })

  const analyze = useCallback((ticker, overrides) => {
    if (!ticker) return
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (overrides) {
      const g = pctToFrac(overrides.growth)
      const d = pctToFrac(overrides.discount)
      const t = pctToFrac(overrides.terminal)
      if (g !== null) params.set('growth', g)
      if (d !== null) params.set('discount', d)
      if (t !== null) params.set('terminal', t)
      if (overrides.years) params.set('years', overrides.years)
    }
    const qs = params.toString()
    const url = `${API_BASE}/api/stock-valuation/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ''}`
    fetch(url, { cache: 'no-store' })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Could not value this ticker.')
        setData(payload)
        setActiveTicker(ticker)
        if (payload.dcf?.assumptions) {
          const a = payload.dcf.assumptions
          setDraft({
            growth: fracToPct(a.growth),
            discount: fracToPct(a.discount),
            terminal: fracToPct(a.terminal),
            years: String(a.years),
          })
        }
      })
      .catch(e => { setError(e.message); setData(null) })
      .finally(() => setLoading(false))
  }, [])

  const submit = (e) => {
    e?.preventDefault?.()
    const t = inputTicker.trim().toUpperCase()
    if (t) { setData(null); analyze(t) }
  }

  const recompute = () => { if (activeTicker) analyze(activeTicker, draft) }

  return (
    <div className="page cef-page stock-check-page">
      <div className="cef-title-row stock-check-title-row">
        <div>
          <h1>Stock Valuation (DCF)</h1>
          <p>
            Estimate what a stock is worth from a discounted cash flow blended with
            fair-multiple and dividend-discount models, then see whether today's price
            is undervalued, fair, or overvalued — alongside a full ratio scorecard for
            valuation, profitability, financial health, and risk-adjusted returns.
          </p>
        </div>
      </div>

      <form className="stock-check-search" onSubmit={submit}>
        <input
          className="stock-check-input stock-check-ticker-input"
          value={inputTicker}
          onChange={e => setInputTicker(e.target.value.toUpperCase())}
          placeholder="e.g. AAPL, MSFT, KO, JPM..."
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>Analyze</button>
      </form>

      {loading && <div className="cef-loading"><span className="spinner" /> Valuing {activeTicker || 'stock'} from Yahoo Finance...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data?.is_fund && (
        <div className="stock-check-callout tone-warn">{data.message}</div>
      )}

      {data && !data.is_fund && (
        <>
          <section className="stock-check-card stock-check-security-card">
            <div className="stock-check-security-title">
              <h2>{data.ticker}</h2>
              <span>{data.name}</span>
            </div>
            <div className="stock-check-meta">
              <span><span>Sector: </span><strong>{data.sector || 'n/a'}</strong></span>
              <span><span>Industry: </span><strong>{data.industry || 'n/a'}</strong></span>
              <span><span>Price: </span><strong>{formatPrice(data.price)}</strong></span>
              <span><span>Market cap: </span><strong>{fmtCap(data.market_cap)}</strong></span>
            </div>
          </section>

          <VerdictBanner data={data} />

          <h3 className="stock-check-section-title">Intrinsic value</h3>
          <div className="stock-val-intrinsic">
            <MethodTable intrinsic={data.intrinsic} />
            <IntrinsicChart methods={data.intrinsic.methods} price={data.price} />
          </div>
          <HelpDetails summary="How fair value & the verdict are calculated" help={INTRINSIC_HELP} />

          <DcfPanel
            dcf={data.dcf}
            draft={draft}
            setDraft={setDraft}
            onRecompute={recompute}
            loading={loading}
          />

          <h3 className="stock-check-section-title stock-check-section-title-spaced">Ratio scorecard</h3>
          <div className="stock-check-card-list">
            {data.sections.map(s => <ScorecardSection key={s.id} section={s} />)}
          </div>

          <div className="stock-check-notes">
            <strong>Notes:</strong> Data is fetched live from Yahoo Finance. The DCF treats free cash flow as
            firm-level and bridges to equity value with net cash; the discount rate defaults to a CAPM cost of
            equity. Fair multiples are sector baselines. Risk ratios use ~3 years of daily prices.
            This is decision support, not investment advice.
          </div>
        </>
      )}
    </div>
  )
}
