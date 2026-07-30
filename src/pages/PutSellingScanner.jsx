import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import PriceChartModal from '../components/PriceChartModal'
import RiskGraphButton from '../components/RiskGraphButton'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'put-scanner-filters'

const PRESETS = {
  conservative: {
    label: 'Conservative',
    tip: 'Mega caps only, modest dislocations, must have stopped falling, no earnings inside the trade',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: false,
      fund_min_drop_pct: 4, fund_min_stretch_sigma: 1.5, fund_min_aum: 1e9, exclude_leveraged_funds: true,
      min_market_cap: 50e9, min_drop_pct: 12, min_stretch_sigma: 1.5,
      max_rsi: 45, min_avg_dollar_volume: 100e6, lookback_days: 21, require_profitable: true,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 7,
      target_dte: 35, target_delta: 0.20,
    },
  },
  balanced: {
    label: 'Balanced',
    tip: 'Large caps with a real dislocation and a workable premium',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      fund_min_drop_pct: 5, fund_min_stretch_sigma: 1.5, fund_min_aum: 300e6, exclude_leveraged_funds: true,
      min_market_cap: 10e9, min_drop_pct: 12, min_stretch_sigma: 1.5,
      max_rsi: 45, min_avg_dollar_volume: 20e6, lookback_days: 21, require_profitable: true,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 5,
      target_dte: 35, target_delta: 0.25,
    },
  },
  aggressive: {
    label: 'Aggressive',
    tip: 'Adds mid caps, deeper drops, allows names still making lows — higher premium, higher assignment risk',
    filters: {
      universe: 'large_mid', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      fund_min_drop_pct: 7, fund_min_stretch_sigma: 1.2, fund_min_aum: 200e6, exclude_leveraged_funds: true,
      min_market_cap: 2e9, min_drop_pct: 20, min_stretch_sigma: 1.2,
      max_rsi: 55, min_avg_dollar_volume: 10e6, lookback_days: 42, require_profitable: true,
      exclude_fresh_lows: false, exclude_earnings_before_expiry: true, earnings_buffer_days: 3,
      target_dte: 35, target_delta: 0.30,
    },
  },
}

const DEFAULT_FILTERS = { ...PRESETS.balanced.filters, custom_tickers: '' }

// These come from the Include checkboxes, so they are hidden from the stock dropdown.
const FUND_UNIVERSE_IDS = new Set(['index_etf', 'sector_etf', 'etf_all', 'stocks_and_etfs'])

const GRADE_COLORS = {
  A: 'var(--pos-strong)',
  B: 'var(--pos)',
  C: 'var(--amber)',
  D: 'var(--warning)',
  F: 'var(--neg-strong)',
}

function pct(v, dec = 1) {
  if (v == null) return '—'
  return `${Number(v).toFixed(dec)}%`
}

function num(v, dec = 2) {
  if (v == null) return '—'
  return Number(v).toFixed(dec)
}

// Option contracts are quoted in USD, so this screen stays in USD throughout —
// same convention as the Strategy Lab. A strike converted to another currency
// would no longer name a real contract.
function usd(v, dec = 2) {
  if (v == null) return '—'
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
}

function usdCompact(v) {
  if (v == null) return '—'
  const n = Number(v)
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return usd(n, 0)
}

function GradeBadge({ grade, score, partial }) {
  return (
    <span
      title={partial
        ? `Partial score ${score}/100 — no option chain, so the premium axis could not be scored`
        : `Composite score ${score}/100`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 700,
        fontSize: '0.78rem', color: GRADE_COLORS[grade] || 'var(--text)',
        border: `1px dashed ${GRADE_COLORS[grade] || 'var(--border)'}`,
        borderStyle: partial ? 'dashed' : 'solid',
        background: 'var(--surface-sunken)',
        opacity: partial ? 0.7 : 1,
      }}
    >
      {grade}{partial ? '*' : ''}<span style={{ fontWeight: 500, opacity: 0.8 }}>{score}</span>
    </span>
  )
}

const KIND_STYLES = {
  index: { label: 'Index', color: 'var(--teal)', tip: 'Broad index fund — no single-company risk to be assigned into' },
  sector: { label: 'Sector', color: 'var(--purple)', tip: 'Sector, commodity, or country fund — concentrated but still a basket' },
  narrow: { label: 'Fund', color: 'var(--amber)', tip: 'Narrow or thematic fund' },
  leveraged: { label: 'Leveraged', color: 'var(--neg-strong)', tip: 'Leveraged or inverse fund — decays and gaps' },
}

function KindBadge({ row }) {
  const style = row.is_fund ? (KIND_STYLES[row.fund_kind] || KIND_STYLES.narrow) : null
  if (!style) {
    return <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>Stock</span>
  }
  return (
    <span title={style.tip} style={{
      fontSize: '0.7rem', fontWeight: 600, padding: '0.05rem 0.4rem', borderRadius: '3px',
      color: style.color, border: `1px solid ${style.color}`, background: 'var(--surface-inset)',
      whiteSpace: 'nowrap',
    }}>{style.label}</span>
  )
}

function ScoreBar({ label, value, max, tip }) {
  const frac = max ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div style={{ marginBottom: '0.4rem' }} title={tip}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <span>{label}</span>
        <span>{num(value, 1)} / {max}</span>
      </div>
      <div style={{ height: '6px', background: 'var(--surface-inset)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${frac * 100}%`, height: '100%', background: 'var(--accent-bright)' }} />
      </div>
    </div>
  )
}

// Short chip labels keep the Warnings column from overflowing the table; the
// full wording stays on hover and in the expanded row.
const FLAG_SHORT = {
  'Option chain unavailable': 'No chain',
  'Wide bid/ask spread': 'Wide spread',
  'Thin open interest': 'Thin OI',
  'Making fresh 52-week lows': 'Fresh lows',
  'Earnings before expiration': 'Earnings in trade',
  'Not profitable on trailing earnings': 'Unprofitable',
  'Heavy debt load': 'High debt',
  'Thin share liquidity': 'Illiquid',
  'Far below the 200-day average': 'Below 200d',
  'Leveraged or inverse fund': 'Leveraged',
  'Small fund': 'Small fund',
}

function shortFlag(f) {
  if (FLAG_SHORT[f]) return FLAG_SHORT[f]
  const near = /^Earnings (\d+)d after expiry$/.exec(f)
  return near ? `Earnings +${near[1]}d` : f
}

function Flags({ flags, full = false }) {
  if (!flags || !flags.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
      {flags.map(f => (
        <span key={f} title={f} style={{
          fontSize: '0.68rem', padding: '0.05rem 0.35rem', borderRadius: '3px',
          background: 'var(--surface-inset)', color: 'var(--warning-text)',
          border: '1px solid var(--warning)', whiteSpace: 'nowrap',
        }}>{full ? f : shortFlag(f)}</span>
      ))}
    </div>
  )
}

/** Collapsible section inside the help panel. Closed unless `open` is set. */
function HelpSection({ title, open = false, children }) {
  return (
    <details open={open} style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-strong)', fontSize: '0.85rem' }}>
        {title}
      </summary>
      <div style={{ padding: '0.5rem 0 0.25rem' }}>{children}</div>
    </details>
  )
}

function Glossary({ items }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', gap: '0.3rem 0.9rem' }}>
      {items.map(([term, desc]) => (
        <React.Fragment key={term}>
          <dt style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{term}</dt>
          <dd style={{ margin: 0 }}>{desc}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function HelpPanel() {
  const p = { margin: '0 0 0.7rem' }
  return (
    <div id="put-scanner-help" className="help-box" style={{
      marginBottom: '1rem', padding: '1rem', background: 'var(--surface-sunken)',
      border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.83rem',
      color: 'var(--text-muted)', lineHeight: 1.6,
    }}>
      <p style={{ margin: '0 0 0.85rem' }}>
        This screen looks for stocks and ETFs that have fallen <em>further than their own volatility justifies</em>,
        then rates each one as a candidate for selling a cash-secured put and names a specific contract to sell.
        The quick-start section is open; expand the other sections when you need the scoring math or a definition.
      </p>

      <HelpSection title="How to use it" open>
        <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li><strong>Choose what to scan</strong> with the Include checkboxes: Stocks, Index ETFs, Sector &amp; commodity ETFs. They are independent, so unchecking Stocks makes an ETF-only scan that finishes in a few seconds.</li>
          <li><strong>Pick a preset</strong> &mdash; Conservative, Balanced, or Aggressive &mdash; or set the filters yourself.</li>
          <li><strong>Run Scan.</strong> The first run downloads a year of history for everything selected (roughly 20&ndash;40 seconds with stocks included). Re-running with different filters is much faster while that price data stays cached.</li>
          <li><strong>Read the table top-down.</strong> It is ranked by score, and every candidate that got a live option chain sorts above those that did not.</li>
          <li><strong>Click a row</strong> to expand the score breakdown, the full trade, the dislocation numbers, and the business behind it.</li>
          <li><strong>Click the ticker</strong> to open its price chart with the 50/200-day moving averages, MACD, and RSI.</li>
        </ol>
      </HelpSection>

      <HelpSection title="What “fallen more than reasonable” means">
        <p style={p}>
          A 20% drop means very different things for a utility and a semiconductor stock, so nothing is ranked on the
          raw decline. Each name is measured against <em>its own</em> normal movement: the scanner takes the daily
          volatility of the period <em>before</em> the selloff, works out how far that name would ordinarily travel over
          the lookback window, and reports the actual drop as a multiple of it. That is the <strong>Stretch</strong>,
          in standard deviations (σ). 2.5σ means it fell two and a half deviations further than its own history calls
          routine.
        </p>
        <p style={{ margin: 0 }}>
          The <strong>vs Market</strong> column then subtracts the market&rsquo;s move times the name&rsquo;s beta. A stock that
          merely fell alongside everything else is not dislocated &mdash; this isolates the part specific to it.
        </p>
      </HelpSection>

      <HelpSection title="How the score is built (0–100)">
        <p style={p}>
          Four independent axes add to 100 points. Inputs between the thresholds below earn points on a straight-line
          ramp; values beyond a threshold receive that item&rsquo;s minimum or maximum. A letter grade follows:
          A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50, otherwise F.
        </p>
        <Glossary items={[
          ['Dislocation — 30', 'Stretch from 1σ to 3σ earns 0–15 points; a 10–35% drawdown earns 0–8; and a 3–20% beta-unexplained drop earns 0–7.'],
          ['Premium — 25', 'IV/RV from 1.0 to 1.6 earns 0–14 points; the IV-rank proxy from 30 to 80 earns 0–6; and an 8–30% annualized return earns 0–5. Earnings before expiry subtract 6 premium points.'],
          ['Quality — 25', 'Stocks: size (7), profitability (7), balance sheet (6), and share liquidity (5). Funds: AUM (8), diversification (9), and liquidity (8).'],
          ['Stabilization — 20', 'Not making a fresh 52-week low earns 7 points; a 0–6% bounce earns 0–5; 0–8 percentage points of deceleration earns 0–4; and sitting 2–15% above the 52-week low earns 0–4.'],
        ]} />
        <p style={{ margin: '0.7rem 0 0' }}>
          A grade shown with an asterisk and a dashed outline (for example <strong>B* 72</strong>) had no option chain
          available. The other three axes are rescaled from 75 points to 100 for a provisional grade, but partial
          scores always sort below candidates that were fully priced because the premium edge is still unknown.
        </p>
      </HelpSection>

      <HelpSection title="Stocks vs ETFs">
        <p style={p}>
          Funds are scored on the same 100-point scale but judged differently where it matters. They report
          <strong> assets under management</strong> rather than a market cap, and they have no earnings, margins, or
          balance sheet &mdash; so the profitability and earnings filters never apply to them. On the Quality axis,
          <strong> breadth of holdings</strong> replaces profitability: a broad <em>Index</em> fund scores highest
          because no single company can sink it, a <em>Sector</em> or commodity fund a little lower, and a leveraged or
          inverse fund scores zero there (those are excluded by default).
        </p>
        <p style={{ margin: 0 }}>
          Funds also get their own drop and stretch floors, because SPY almost never falls 12% from its high and would
          otherwise never appear. The stretch still does the real work: a 6% decline in a low-volatility index can be
          as many standard deviations as a 25% decline in a semiconductor name.
        </p>
      </HelpSection>

      <HelpSection title="Earnings handling">
        <p style={{ margin: 0 }}>
          A single earnings report can gap a stock straight through your strike, so earnings are avoided rather than
          merely flagged. With <strong>Skip earnings inside trade</strong> on, a stock is removed when its next report
          falls within the requested Target DTE plus the preset safety buffer. The scanner will not substitute a
          near-expiration contract just to get out before the announcement. The Earnings column shows the next known
          report for candidates that remain. ETFs read &ldquo;no earnings&rdquo; because a fund has none.
        </p>
      </HelpSection>

      <HelpSection title="The suggested trade and when to buy it back">
        <p style={p}>
          For the highest-rated candidates the scanner pulls the live chain, takes the expiration closest to your target
          DTE, and picks the put nearest your target delta. <strong>Basis if Assigned</strong> is the strike minus the
          premium &mdash; your real cost per share if the stock is put to you.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Buy Back At</strong> is a success-oriented exit: a limit to close the position early, keeping most of
          the credit while removing the assignment and late-expiration risk that the last of the premium pays for.
          Strong, liquid setups aim to keep 70% of the quoted credit, balanced setups 65%, and anything carrying a
          warning 60%. Recalculate from your actual fill; the figure excludes commissions and cannot guarantee a
          winning trade.
        </p>
      </HelpSection>

      <HelpSection title="Column glossary">
        <Glossary items={[
          ['Type', 'Stock, a broad Index fund, or a Sector/commodity fund.'],
          ['Score', 'The 0–100 composite and its letter grade. An asterisk means no option chain was available.'],
          ['% Off High', 'Decline from the 52-week high.'],
          ['Stretch', 'How many standard deviations the drop runs beyond this name’s own normal move.'],
          ['vs Market', 'The share of the decline that beta does not explain. More negative means more specific to this name.'],
          ['RSI', 'Wilder’s 14-day relative strength. Lower is more oversold.'],
          ['IV/RV', 'Implied volatility over realized volatility. Above 1.0 means option sellers are being paid above fair value — green in the table.'],
          ['Sell This Put', 'The suggested contract: strike, expiration, days to expiry, how far below spot the strike sits, and the credit per share.'],
          ['Earnings', 'Days until the next report and whether the suggested expiration closes before it.'],
          ['Ann. Return', 'The credit as an annualized return on the cash securing the put.'],
          ['Buy Back At', 'Suggested buy-to-close limit, and how much of the credit that keeps.'],
          ['Basis if Assigned', 'Strike minus premium, and its discount to the current price.'],
          ['Warnings', 'Short chips; hover any of them, or expand the row, for the full wording.'],
        ]} />
      </HelpSection>

      <HelpSection title="Warnings">
        <Glossary items={[
          ['Fresh lows', 'Still printing new 52-week lows — the classic falling knife.'],
          ['Earnings in trade', 'A report conflicts with the requested trade horizon. With the earnings skip enabled, the ticker is excluded.'],
          ['Earnings +Nd', 'Earnings fall shortly after expiry — only matters if you plan to roll.'],
          ['Wide spread', 'The bid/ask on the suggested put is wide, so the quoted credit is optimistic.'],
          ['Thin OI', 'Low open interest — harder to get filled or to close early.'],
          ['No chain', 'No option chain came back, so the Premium axis could not be scored.'],
          ['Unprofitable', 'No positive trailing earnings or margin.'],
          ['High debt', 'Debt-to-equity above 300%.'],
          ['Illiquid', 'Thin average dollar volume in the shares themselves.'],
          ['Below 200d', 'Price is far under the 200-day average — a structural downtrend, not just a dip.'],
          ['Leveraged', 'A leveraged or inverse fund; these decay and gap in ways a put seller is not paid for.'],
          ['Small fund', 'Fund assets under $300M.'],
        ]} />
      </HelpSection>

      <p style={{ margin: '0.85rem 0 0', color: 'var(--warning-text)' }}>
        Scores rate the setup from public market data. They are not advice, and assignment risk is real &mdash; a
        cash-secured put obliges you to buy 100 shares per contract at the strike no matter how far the underlying has
        fallen.
      </p>
    </div>
  )
}

function DetailRow({ row, colSpan, onShowChart }) {
  const p = row.put
  const cell = (label, value) => (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-strong)' }}>{value}</div>
    </div>
  )

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--surface-sunken)', padding: '0.9rem 1.1rem', whiteSpace: 'normal' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <button
            className="btn btn-xs btn-outline"
            onClick={(e) => { e.stopPropagation(); onShowChart(row.ticker) }}
          >
            &#128200; Price chart
          </button>
          <RiskGraphButton kind="cash-secured-put" row={row} source="Put Selling Scanner" />
        </div>
        <div style={{ maxWidth: '1100px', fontSize: '0.88rem', color: 'var(--text-strong)', marginBottom: '0.8rem' }}>
          {row.verdict}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: '1.5rem', alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              Score breakdown
            </div>
            <ScoreBar label="Dislocation" value={row.components.dislocation} max={row.component_max.dislocation}
              tip="How far the drop exceeds what this stock's own volatility and the market's move explain" />
            <ScoreBar label="Premium" value={row.components.premium} max={row.component_max.premium}
              tip="Implied vs realized volatility, IV rank, and the annualized return on cash" />
            <ScoreBar label="Quality" value={row.components.quality} max={row.component_max.quality}
              tip="Size, profitability, balance sheet, and share liquidity — would you want to be assigned?" />
            <ScoreBar label="Stabilization" value={row.components.stabilization} max={row.component_max.stabilization}
              tip="Has the decline stopped, or is this still a falling knife?" />
            {row.scored_on_partial && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                No option chain available — scored on the other three axes.
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              {p ? 'Suggested cash-secured put' : 'Option chain unavailable'}
            </div>
            {p && (
              <div style={{
                padding: '0.6rem 0.8rem', marginBottom: '0.8rem', borderRadius: '5px',
                background: 'var(--surface-inset)', borderLeft: '3px solid var(--pos-strong)',
              }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  The trade
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--pos-strong)', margin: '0.15rem 0' }}>
                  Sell 1 {row.ticker} {p.expiration} ${p.strike} put
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Collect about {usd(p.premium_dollars, 0)} now · set aside {usd(p.cash_required, 0)} ·
                  {' '}keep it all if {row.ticker} stays above ${p.strike} through {p.expiration}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  If assigned you buy 100 shares at ${p.strike}, an effective {usd(p.effective_basis)} per share
                  after the premium &mdash; {pct(p.discount_to_spot_pct, 1)} below today&rsquo;s {usd(row.price)}.
                </div>
                {p.earnings_date && (
                  <div style={{
                    fontSize: '0.78rem', marginTop: '0.35rem',
                    color: p.avoids_earnings ? 'var(--pos-strong)' : 'var(--neg-strong)',
                  }}>
                    {p.avoids_earnings
                      ? `✓ Expires ${p.days_earnings_after_expiry}d before earnings on ${p.earnings_date} — the report lands after you are out.`
                      : `⚠ Earnings on ${p.earnings_date} fall inside this trade. No expiration in the ${row.dte_window || 'selected'} window clears it.`}
                  </div>
                )}
              </div>
            )}
            {p?.buyback && (
              <div style={{
                padding: '0.7rem 0.85rem', marginBottom: '0.8rem', borderRadius: '5px',
                background: 'color-mix(in srgb, var(--pos) 8%, var(--surface-inset))',
                border: '1px solid color-mix(in srgb, var(--pos) 45%, var(--border))',
              }}>
                <div style={{
                  fontSize: '0.72rem', color: 'var(--pos-strong)', textTransform: 'uppercase',
                  letterSpacing: '0.04em', fontWeight: 700,
                }}>
                  Suggested exit · {p.buyback.profile}
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 750, color: 'var(--text-strong)', margin: '0.18rem 0' }}>
                  Enter a buy-to-close limit near {usd(p.buyback.target_price)}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  If filled, keep about {usd(p.buyback.premium_kept_dollars, 0)} of the quoted
                  {' '}{usd(p.premium_dollars, 0)} credit ({pct(p.buyback.profit_capture_pct, 0)}),
                  while giving back {usd(p.buyback.premium_returned_dollars, 0)} to remove the remaining risk.
                  {' '}If the target has not filled, reassess near {p.buyback.reassess_dte} DTE.
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                  {p.buyback.rationale} Base the live order on your actual entry fill; commissions and slippage are excluded.
                </div>
              </div>
            )}
            {p && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
                {cell('Days to expiry', p.dte)}
                {cell('Bid / Ask', `${num(p.bid)} / ${num(p.ask)}`)}
                {cell('Premium', `${usd(p.premium_dollars, 0)} per contract`)}
                {cell('Cash secured', usd(p.cash_required, 0))}
                {cell('Return on cash', `${pct(p.premium_yield_pct, 2)} (${pct(p.annualized_pct, 0)} ann.)`)}
                {cell('Delta', num(p.delta, 3))}
                {cell('Prob. OTM', pct(p.prob_otm, 0))}
                {cell('Strike is', `${pct(p.otm_pct, 1)} below spot`)}
                {cell('Basis if assigned', usd(p.effective_basis))}
                {cell('Discount to spot', pct(p.discount_to_spot_pct, 1))}
                {cell('Open interest', p.open_interest ?? '—')}
                {p.buyback && cell('Buy back near', usd(p.buyback.target_price))}
                {p.buyback && cell('Premium retained', `${usd(p.buyback.premium_kept_dollars, 0)} · ${pct(p.buyback.profit_capture_pct, 0)}`)}
              </div>
            )}

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              The dislocation
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
              {cell('Move in window', pct(row.window_pct))}
              {cell('Normal move', `±${pct(row.expected_move_pct)}`)}
              {cell('Stretch', `${num(row.stretch_sigma, 1)}σ`)}
              {cell('Excess vs market', pct(row.excess_drop_pct))}
              {cell('Beta', num(row.beta))}
              {cell('52-wk range', `${usd(row.week52_low)} – ${usd(row.week52_high)}`)}
              {cell('Above 52-wk low', pct(row.above_52w_low_pct))}
              {cell('IV / realized vol', num(row.iv_rv_ratio))}
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              The business
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem' }}>
              {cell('Sector', row.sector || '—')}
              {cell(row.is_fund ? 'Fund assets' : 'Market cap', row.size ? usdCompact(row.size) : '—')}
              {cell('Trailing EPS', num(row.trailing_eps))}
              {cell('Profit margin', row.profit_margin == null ? '—' : pct(row.profit_margin * 100))}
              {cell('Debt / equity', num(row.debt_to_equity, 0))}
              {cell('Forward P/E', num(row.forward_pe, 1))}
              {cell('Analyst target', row.target_mean_price ? usd(row.target_mean_price) : '—')}
              {cell('Next earnings', row.next_earnings || '—')}
            </div>

            {row.flags?.length > 0 && (
              <div style={{ marginTop: '0.9rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>
                  Watch out for
                </div>
                <Flags flags={row.flags} full />
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', align: 'left' },
  { key: 'kind', label: 'Type', align: 'left', tip: 'Stock, broad index fund, or sector/commodity fund' },
  { key: 'score', label: 'Score', align: 'left' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'drawdown_pct', label: '% Off High', align: 'right', tip: 'Decline from the 52-week high' },
  { key: 'stretch_sigma', label: 'Stretch', align: 'right', tip: 'Standard deviations beyond this stock’s own normal move over the window' },
  { key: 'excess_drop_pct', label: 'vs Market', align: 'right', tip: 'The part of the drop that beta does not explain' },
  { key: 'rsi_14', label: 'RSI', align: 'right' },
  { key: 'iv_rv_ratio', label: 'IV/RV', align: 'right', tip: 'Implied vol over realized vol — above 1.0 means sellers are paid above fair value' },
  { key: 'put_strike', label: 'Sell This Put', align: 'center', tip: 'The suggested strike and expiration to sell' },
  { key: 'dte', label: 'DTE', align: 'right', tip: 'Days to expiration for the suggested option chain' },
  { key: 'days_to_earnings', label: 'Earnings', align: 'center', tip: 'Days until the next earnings report, and whether the suggested expiration closes before it' },
  { key: 'put_annualized', label: 'Ann. Return', align: 'right', tip: 'Annualized return on the cash securing the put' },
  { key: 'put_buyback', label: 'Buy Back At', align: 'right', tip: 'Suggested buy-to-close limit that retains 60–70% of the quoted entry credit' },
  { key: 'put_basis', label: 'Basis if Assigned', align: 'right', tip: 'Strike minus premium — your effective cost if put to you' },
  { key: 'flags', label: 'Warnings', align: 'left' },
]

const SORT_ACCESSORS = {
  put_strike: r => r.put?.strike ?? null,
  dte: r => r.put?.dte ?? null,
  put_annualized: r => r.put?.annualized_pct ?? null,
  put_buyback: r => r.put?.buyback?.target_price ?? null,
  put_basis: r => r.put?.effective_basis ?? null,
  flags: r => (r.flags?.length ?? 0),
  kind: r => (r.is_fund ? (r.fund_kind || 'fund') : 'stock'),
}

export default function PutSellingScanner() {
  const pf = useProfileFetch()
  const [filters, setFilters] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      return saved ? { ...DEFAULT_FILTERS, ...saved } : DEFAULT_FILTERS
    } catch {
      return DEFAULT_FILTERS
    }
  })
  const [universes, setUniverses] = useState([])
  const [cachedScan, saveScan] = useScanCache('put-selling')
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [stats, setStats] = useState(cachedScan?.stats || null)
  const [asOf, setAsOf] = useState(cachedScan?.as_of || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [chartTicker, setChartTicker] = useState(null)
  const [sortCol, setSortCol] = useState('score')
  const [sortAsc, setSortAsc] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [hasScanned, setHasScanned] = useState(Boolean(cachedScan))

  useEffect(() => {
    pf('/api/options/put-scan/universes')
      .then(r => r.json())
      .then(d => setUniverses(d.universes || []))
      .catch(() => {})
  }, [pf])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  const set = (key, value) => setFilters(f => ({ ...f, [key]: value }))

  const applyPreset = (key) => {
    setFilters(f => ({ ...f, ...PRESETS[key].filters }))
  }

  const anyFunds = !!(filters.include_index_etfs || filters.include_sector_etfs)
  const nothingSelected = !filters.include_stocks && !anyFunds
  const scanningFundsOnly = anyFunds && !filters.include_stocks

  const runScan = useCallback(() => {
    setLoading(true)
    setError(null)
    setExpanded(null)
    const body = { ...filters }
    if (body.universe === 'custom') {
      body.custom_tickers = String(filters.custom_tickers || '')
        .split(/[\s,]+/).filter(Boolean)
    } else {
      delete body.custom_tickers
    }
    pf('/api/options/put-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        setRows(d.rows || [])
        setStats(d.stats || null)
        setAsOf(d.as_of || null)
        setHasScanned(true)
        saveScan({ rows: d.rows || [], stats: d.stats || null, as_of: d.as_of || null })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf, filters, saveScan])

  const toggleSort = (key) => {
    if (sortCol === key) setSortAsc(a => !a)
    else { setSortCol(key); setSortAsc(false) }
  }

  const sortedRows = useMemo(() => {
    const accessor = SORT_ACCESSORS[sortCol] || (r => r[sortCol])
    return [...rows].sort((a, b) => {
      // A score computed without an option chain uses a smaller denominator, so
      // it is not comparable — keep those below every priced candidate.
      if (sortCol === 'score') {
        const tier = (a.put ? 0 : 1) - (b.put ? 0 : 1)
        if (tier) return tier
      }
      const av = accessor(a), bv = accessor(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? av - bv : bv - av
    })
  }, [rows, sortCol, sortAsc])

  const arrow = (key) => sortCol === key ? (sortAsc ? ' ▴' : ' ▾') : ''

  const numField = (label, key, { step = 1, min = 0, max, width = 80, suffix = '', scale = 1, tip } = {}) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--text-dim)' }} title={tip}>
      {label}
      <span>
        <input
          type="number" step={step} min={min} max={max}
          value={filters[key] == null ? '' : filters[key] / scale}
          onChange={e => set(key, e.target.value === '' ? null : Number(e.target.value) * scale)}
          style={{
            width: `${width}px`, padding: '0.3rem 0.4rem', background: 'var(--surface-inset)',
            border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-strong)', fontSize: '0.82rem',
          }}
        />
        {suffix && <span style={{ marginLeft: '0.25rem', color: 'var(--text-dim)' }}>{suffix}</span>}
      </span>
    </label>
  )

  const checkField = (label, key, tip) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-dim)', cursor: 'pointer' }} title={tip}>
      <input type="checkbox" checked={!!filters[key]} onChange={e => set(key, e.target.checked)} />
      {label}
    </label>
  )

  return (
    <div className="page-container" style={{ maxWidth: 1800, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.4rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Put Selling Scanner</h1>
        <button
          type="button"
          className="btn btn-xs btn-outline"
          aria-expanded={showHelp}
          aria-controls="put-scanner-help"
          onClick={() => setShowHelp(h => !h)}
        >
          {showHelp ? 'Hide Help' : 'How this works'}
        </button>
      </div>
      <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        Finds stocks and ETFs that have fallen further than their own volatility justifies, then rates
        them as candidates for selling cash-secured puts.
      </p>

      {showHelp && <HelpPanel />}

      {/* What to scan. Each group is independent — unchecking Stocks skips the
          stock universe entirely rather than filtering it out afterwards. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1.1rem', flexWrap: 'wrap',
        padding: '0.6rem 0.9rem', marginBottom: '0.6rem', borderRadius: '6px',
        background: 'var(--surface-sunken)', border: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Include:</span>
        {[
          ['include_stocks', 'Stocks', 'Scan the stock universe chosen below'],
          ['include_index_etfs', 'Index ETFs', 'SPY, QQQ, IWM, DIA, sector-neutral style and rates funds'],
          ['include_sector_etfs', 'Sector & commodity ETFs', 'XLK, XLE, GLD, SLV, SMH, GDX and the rest of the sector complex'],
        ].map(([key, label, tip]) => (
          <label key={key} title={tip}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', color: filters[key] ? 'var(--text-strong)' : 'var(--text-dim)' }}>
            <input type="checkbox" checked={!!filters[key]} onChange={e => set(key, e.target.checked)} />
            {label}
          </label>
        ))}
        {!filters.include_stocks && !filters.include_index_etfs && !filters.include_sector_etfs && (
          <span style={{ fontSize: '0.78rem', color: 'var(--neg-strong)' }}>Pick at least one.</span>
        )}
        {scanningFundsOnly && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            ETFs only &mdash; the stock universe is skipped, so this scan is quick.
          </span>
        )}
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Preset:</span>
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} className="btn btn-xs btn-outline" title={p.tip} onClick={() => applyPreset(key)}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end',
        padding: '0.9rem', background: 'var(--surface-sunken)', border: '1px solid var(--border)',
        borderRadius: '6px', marginBottom: '0.75rem',
      }}>
        <label
          title={filters.include_stocks ? 'Which stock list to scan' : 'Enable Stocks above to choose a stock universe'}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--text-dim)', opacity: filters.include_stocks ? 1 : 0.45 }}
        >
          Stock universe
          <select
            value={filters.universe}
            disabled={!filters.include_stocks}
            onChange={e => set('universe', e.target.value)}
            style={{
              padding: '0.3rem 0.4rem', background: 'var(--surface-inset)', border: '1px solid var(--border)',
              borderRadius: '4px', color: 'var(--text-strong)', fontSize: '0.82rem', minWidth: '160px',
            }}
          >
            {universes.filter(u => !FUND_UNIVERSE_IDS.has(u.id)).map(u => (
              <option key={u.id} value={u.id}>{u.label}{u.count ? ` (${u.count})` : ''}</option>
            ))}
          </select>
        </label>

        {filters.include_stocks && filters.universe === 'custom' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--text-dim)', flex: '1 1 260px' }}>
            Tickers
            <input
              type="text" placeholder="AAPL, NKE, PFE..."
              value={filters.custom_tickers || ''}
              onChange={e => set('custom_tickers', e.target.value.toUpperCase())}
              style={{
                padding: '0.3rem 0.4rem', background: 'var(--surface-inset)', border: '1px solid var(--border)',
                borderRadius: '4px', color: 'var(--text-strong)', fontSize: '0.82rem', width: '100%',
              }}
            />
          </label>
        )}

        {filters.include_stocks && numField('Min drop', 'min_drop_pct', { suffix: '%', width: 65, tip: 'Stocks: minimum decline from the 52-week high' })}
        {filters.include_stocks && numField('Min stretch', 'min_stretch_sigma', { step: 0.1, suffix: 'σ', width: 65, tip: 'Stocks: minimum standard deviations beyond the name’s normal move' })}
        {filters.include_stocks && numField('Min mkt cap', 'min_market_cap', { scale: 1e9, suffix: 'B', width: 65, tip: 'Stocks only — funds are sized by AUM instead' })}

        {/* Funds need their own floors: SPY almost never falls 12% from its
            high, so sharing the stock thresholds would leave ETFs unmatched. */}
        {anyFunds && numField('ETF min drop', 'fund_min_drop_pct', { suffix: '%', width: 65, tip: 'ETFs: minimum decline from the 52-week high. Indexes move less than single stocks, so this floor is lower.' })}
        {anyFunds && numField('ETF min stretch', 'fund_min_stretch_sigma', { step: 0.1, suffix: 'σ', width: 65, tip: 'ETFs: minimum standard deviations beyond the fund’s normal move' })}
        {anyFunds && numField('ETF min AUM', 'fund_min_aum', { scale: 1e6, suffix: 'M', width: 65, tip: 'Funds report assets under management rather than a market cap' })}

        {numField('Max RSI', 'max_rsi', { width: 65, tip: 'Only names this oversold or lower' })}
        {numField('Min $ volume', 'min_avg_dollar_volume', { scale: 1e6, suffix: 'M', width: 65, tip: 'Average daily dollar volume — a proxy for how tight the option market will be' })}
        {numField('Lookback', 'lookback_days', { width: 65, suffix: 'd', tip: 'Trading days in the decline window' })}
        {numField('Target DTE', 'target_dte', {
          min: 1, max: 1095, width: 65,
          tip: 'Preferred days to expiration for the suggested put (up to 3 years)',
        })}
        {numField('Target delta', 'target_delta', { step: 0.05, width: 65, tip: 'Roughly the assignment probability you are targeting' })}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {filters.include_stocks && checkField('Profitable only', 'require_profitable', 'Stocks only — a fund has no earnings, so this never excludes ETFs')}
          {checkField('Skip fresh 52-wk lows', 'exclude_fresh_lows', 'Exclude names still printing new lows — the classic falling knife')}
          {filters.include_stocks && checkField('Skip earnings inside trade', 'exclude_earnings_before_expiry', 'Exclude stocks whose next report falls within Target DTE plus the safety buffer; never substitute a very short expiration')}
          {anyFunds && checkField('Skip leveraged / inverse ETFs', 'exclude_leveraged_funds', 'Leveraged and inverse funds decay and gap in ways a put seller is not paid for')}
        </div>

        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading || nothingSelected}>
          {loading ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
          Pulling a year of history for the universe, then live option chains for the finalists. The first run takes
          about 20&ndash;40 seconds; re-running with different filters is much faster while the price data is cached.
        </p>
      )}

      {stats && !loading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.6rem' }}>
          Scanned <strong style={{ color: 'var(--text-muted)' }}>{stats.priced}</strong> of {stats.universe} tickers
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_price}</strong> dislocated
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_fundamentals}</strong> passed quality
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.final}</strong> rated
          {stats.chains_fetched ? ` (${stats.chains_fetched} option chains priced)` : ''}
          {asOf ? ` · ${new Date(asOf).toLocaleString()}` : ''}
        </div>
      )}

      {sortedRows.length > 0 && (
        <div className="sst-wrap" style={{ maxHeight: '70vh' }}>
          <table className="sst">
            <thead>
              <tr>
                <th style={{ width: '24px' }} />
                {COLUMNS.map(c => (
                  <th key={c.key} title={c.tip} onClick={() => toggleSort(c.key)}
                      style={{ cursor: 'pointer', textAlign: c.align }}>
                    {c.label}{arrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => {
                const open = expanded === r.ticker
                return (
                  <React.Fragment key={r.ticker}>
                    <tr
                      onClick={() => setExpanded(open ? null : r.ticker)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ color: 'var(--text-dim)' }}>{open ? '▾' : '▸'}</td>
                      <td>
                        <a
                          href="#"
                          title={`Price chart for ${r.ticker} with SMA 50/200, MACD, and RSI`}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setChartTicker(r.ticker) }}
                          style={{ fontWeight: 600, color: 'var(--accent-bright)', textDecoration: 'none' }}
                        >
                          {r.ticker} <span style={{ fontSize: '0.7rem', opacity: 0.75 }}>&#128200;</span>
                        </a>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', maxWidth: '190px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.name}
                        </div>
                      </td>
                      <td><KindBadge row={r} /></td>
                      <td><GradeBadge grade={r.grade} score={r.score} partial={r.scored_on_partial} /></td>
                      <td style={{ textAlign: 'right' }}>{usd(r.price)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--neg-strong)' }}>{pct(r.drawdown_pct)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(r.stretch_sigma, 1)}&sigma;</td>
                      <td style={{ textAlign: 'right', color: (r.excess_drop_pct ?? 0) < 0 ? 'var(--neg-strong)' : 'var(--text)' }}>
                        {pct(r.excess_drop_pct)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{num(r.rsi_14, 0)}</td>
                      <td style={{ textAlign: 'right', color: (r.iv_rv_ratio ?? 0) >= 1 ? 'var(--pos-strong)' : 'var(--text-muted)' }}>
                        {num(r.iv_rv_ratio)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {r.put ? (
                          <div style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '4px',
                            background: 'var(--surface-inset)', border: '1px solid var(--pos-strong)',
                            lineHeight: 1.25,
                          }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--pos-strong)', whiteSpace: 'nowrap' }}>
                              ${r.put.strike} PUT
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              exp {r.put.expiration}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {pct(r.put.otm_pct, 0)} below · {usd(r.put.mid)} credit
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {r.put ? `${r.put.dte}d` : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {r.is_fund ? (
                          <span title="A fund has no earnings report — there is no announcement to trade around"
                                style={{ color: 'var(--pos-strong)', fontSize: '0.75rem' }}>
                            no earnings
                          </span>
                        ) : r.days_to_earnings == null ? (
                          <span style={{ color: 'var(--text-dim)' }}>unknown</span>
                        ) : (
                          <>
                            <div style={{ color: r.earnings_before_expiry ? 'var(--neg-strong)' : 'var(--text)' }}>
                              {r.days_to_earnings}d
                            </div>
                            <div style={{ fontSize: '0.68rem', color: r.earnings_before_expiry ? 'var(--neg-strong)' : 'var(--pos-strong)' }}>
                              {r.earnings_before_expiry ? 'inside trade' : 'clear'}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--pos-strong)', fontWeight: 600 }}>
                        {r.put ? pct(r.put.annualized_pct, 0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.put?.buyback ? (
                          <>
                            <div style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>
                              {usd(r.put.buyback.target_price)}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              keep {pct(r.put.buyback.profit_capture_pct, 0)}
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.put ? (
                          <>
                            <div>{usd(r.put.effective_basis)}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{pct(r.put.discount_to_spot_pct, 0)} off</div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'normal', minWidth: '150px', maxWidth: '190px' }}><Flags flags={r.flags} /></td>
                    </tr>
                    {open && <DetailRow row={r} colSpan={COLUMNS.length + 1} onShowChart={setChartTicker} />}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && hasScanned && sortedRows.length === 0 && !error && (
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>
          Nothing cleared the filters. In a market near its highs that is normal &mdash; try lowering the minimum
          drop or stretch, or widen the universe.
        </p>
      )}

      {!hasScanned && !loading && (
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>
          Pick a preset or set your own filters, then run the scan.
        </p>
      )}

      {chartTicker && (
        <PriceChartModal ticker={chartTicker} onClose={() => setChartTicker(null)} />
      )}
    </div>
  )
}
