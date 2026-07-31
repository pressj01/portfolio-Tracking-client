import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import PriceChartModal from '../components/PriceChartModal'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'
import { findActivePreset } from '../utils/activePreset'

const STORAGE_KEY = 'bear-put-spread-scanner-filters'

const PRESETS = {
  conservative: {
    label: 'Conservative',
    tip: 'Confirmed downtrend only, cheap debits, a reachable target and a chain you can actually trade out of',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: false, include_sector_etfs: false,
      min_market_cap: 20e9, fund_min_aum: 2e9, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 100e6, lookback_days: 21,
      min_stretch_sigma: 0.75, max_stretch_sigma: 2.0,
      require_below_sma50: true, require_downtrend: true,
      min_rel_weakness_pct: 2, fund_min_rel_weakness_pct: 0,
      min_rsi: 35, max_rsi: 55, max_drawdown_pct: 30, min_above_52w_low_pct: 10,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 7,
      target_dte: 45,
      long_delta: 0.55, short_delta: 0.25, delta_tolerance: 0.12,
      min_width_pct: 3, max_width_pct: 15,
      max_debit_pct_of_width: 45, min_reward_risk: 1.5, max_required_sigma: 1.5,
    },
  },
  balanced: {
    label: 'Balanced',
    tip: 'A broken 50-day, real relative weakness, and the conventional 50/25-delta vertical',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: false, include_sector_etfs: true,
      min_market_cap: 5e9, fund_min_aum: 500e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 25e6, lookback_days: 21,
      min_stretch_sigma: 0.5, max_stretch_sigma: 2.5,
      require_below_sma50: true, require_downtrend: false,
      min_rel_weakness_pct: 1, fund_min_rel_weakness_pct: 0,
      min_rsi: 32, max_rsi: 60, max_drawdown_pct: 40, min_above_52w_low_pct: 5,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 5,
      target_dte: 45,
      long_delta: 0.50, short_delta: 0.25, delta_tolerance: 0.15,
      min_width_pct: 2, max_width_pct: 20,
      max_debit_pct_of_width: 55, min_reward_risk: 1.0, max_required_sigma: 2.5,
    },
  },
  hedge: {
    label: 'Hedge my holdings',
    tip: 'Scans what you own for breakdowns, so a falling position can be hedged with defined risk instead of sold',
    filters: {
      universe: 'holdings', include_stocks: true, include_index_etfs: false, include_sector_etfs: false,
      min_market_cap: 1e9, fund_min_aum: 200e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 10e6, lookback_days: 21,
      min_stretch_sigma: 0.4, max_stretch_sigma: 3.0,
      require_below_sma50: true, require_downtrend: false,
      min_rel_weakness_pct: 0, fund_min_rel_weakness_pct: 0,
      min_rsi: 28, max_rsi: 62, max_drawdown_pct: 50, min_above_52w_low_pct: 3,
      exclude_fresh_lows: false, exclude_earnings_before_expiry: true, earnings_buffer_days: 5,
      target_dte: 45,
      long_delta: 0.50, short_delta: 0.25, delta_tolerance: 0.18,
      min_width_pct: 2, max_width_pct: 25,
      max_debit_pct_of_width: 60, min_reward_risk: 0.8, max_required_sigma: 3.0,
    },
  },
  aggressive: {
    label: 'Aggressive',
    tip: 'Wider universe including small caps, earlier breaks, and wider cheaper spreads that need a bigger move',
    filters: {
      universe: 'large_mid_small', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      min_market_cap: 2e9, small_cap_min_market_cap: 1e9, fund_min_aum: 200e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 15e6, lookback_days: 42,
      min_stretch_sigma: 0.3, max_stretch_sigma: 3.0,
      require_below_sma50: true, require_downtrend: false,
      min_rel_weakness_pct: 0.5, fund_min_rel_weakness_pct: 0,
      min_rsi: 30, max_rsi: 65, max_drawdown_pct: 50, min_above_52w_low_pct: 3,
      exclude_fresh_lows: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 3,
      target_dte: 60,
      long_delta: 0.45, short_delta: 0.18, delta_tolerance: 0.18,
      min_width_pct: 4, max_width_pct: 30,
      max_debit_pct_of_width: 40, min_reward_risk: 1.5, max_required_sigma: 3.0,
    },
  },
}

const DEFAULT_FILTERS = {
  ...PRESETS.balanced.filters,
  small_cap_min_market_cap: 1e9,
  custom_tickers: '',
}

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
// same convention as the two selling screens. A strike converted to another
// currency would no longer name a real contract.
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

function shares(v) {
  if (v == null) return '—'
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function sigma(v, dec = 1) {
  if (v == null) return '—'
  return `${Number(v).toFixed(dec)}σ`
}

function GradeBadge({ grade, score, partial }) {
  return (
    <span
      title={partial
        ? `Partial score ${score}/100 — no option chain, so the structure and most of the executability points could not be scored`
        : `Composite score ${score}/100`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 700,
        fontSize: '0.78rem', color: GRADE_COLORS[grade] || 'var(--text)',
        border: `1px solid ${GRADE_COLORS[grade] || 'var(--border)'}`,
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
  index: { label: 'Index', color: 'var(--teal)', tip: 'Broad index fund — the whole basket has to keep falling' },
  sector: { label: 'Sector', color: 'var(--purple)', tip: 'Sector, commodity, or country fund — concentrated enough to trend' },
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
  'Not priced — outside chain limit': 'Not priced',
  'Making fresh 52-week lows': 'Fresh lows',
  'Already deeply oversold — bounce risk': 'Oversold',
  'Sharp bounce off the recent low': 'Bounced',
  'Downtrend already months old': 'Stale trend',
  'Debit over half the width': 'Debit > half',
  'Short strike needs an outsized move': 'Needs big move',
  'Priced above realized-vol fair value': 'Overpriced',
  'Implied vol rich — expensive to buy': 'IV rich',
  'No pair met the debit and reward filters': 'Filters relaxed',
  'Leg slippage eats the edge': 'Slippage',
  'Thin open interest on one leg': 'Thin OI',
  'Thin share liquidity': 'Illiquid',
  'Earnings before expiration': 'Earnings in trade',
  'Far below the 200-day average': 'Below 200d',
  'Leveraged or inverse fund': 'Leveraged',
  'Small underlying': 'Small',
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
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(130px, max-content) 1fr', gap: '0.3rem 0.9rem' }}>
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
    <div id="bear-put-spread-scanner-help" className="help-box" style={{
      marginBottom: '1rem', padding: '1rem', background: 'var(--surface-sunken)',
      border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.83rem',
      color: 'var(--text-muted)', lineHeight: 1.6,
    }}>
      <p style={{ margin: '0 0 0.85rem' }}>
        This screen looks for names whose <em>breakdown has started but not finished</em>, then prices a specific
        bear put spread on each one &mdash; buy a higher-strike put, sell a lower-strike put, same expiration.
        The debit is your entire risk, the width minus the debit is your entire reward. The quick-start section is
        open; expand the others when you need the scoring math or a definition.
      </p>

      <HelpSection title="Why this is not the Put Selling Scanner run backwards" open>
        <p style={p}>
          The obvious screen &mdash; &ldquo;find whatever just crashed and buy puts&rdquo; &mdash; is exactly the
          Put Selling Scanner&rsquo;s setup. A name down three standard deviations, deeply oversold, printing fresh
          52-week lows, is where put <em>sellers</em> get paid for taking the bounce. Buying downside there means
          paying peak implied volatility for the last leg of a move that has already happened. Crash-chasing is to
          this screen what &ldquo;overbought&rdquo; is to the Covered Call Scanner: the thing that looks like the
          signal and is actually the trap.
        </p>
        <p style={{ margin: 0 }}>
          So the screen asks for the awkward middle instead. Trend structure has genuinely turned
          (<strong>Breakdown</strong>) and the name is underperforming the market with momentum still rolling over
          &mdash; but it is not yet spent. There is still distance to fall before the payoff caps
          (<strong>Room</strong>). The vertical itself is priced well for what it has to achieve
          (<strong>Structure</strong>). And two legs can actually be filled near the mid
          (<strong>Executability</strong>). Names at fresh lows are excluded by default, and the decline size is
          scored as a <em>band</em> &mdash; roughly 1&ndash;2&sigma; earns full credit, and credit falls away above
          2.5&sigma;, because past that you are paying for a move that is behind you.
        </p>
      </HelpSection>

      <HelpSection title="How to use it">
        <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li><strong>Pick a preset.</strong> Conservative wants a confirmed downtrend and a cheap, reachable spread. <em>Hedge my holdings</em> scans what you already own, so a falling position can be hedged with defined risk instead of sold.</li>
          <li><strong>Choose what else to scan</strong> with the Include checkboxes. They are independent, so an ETF-only scan finishes in seconds.</li>
          <li><strong>Run Scan.</strong> The first run downloads a year of history for everything selected. Re-running with different filters is much faster while that data stays cached, and the cache &mdash; including the option chains &mdash; is shared with the Put Selling Scanner.</li>
          <li><strong>Read the table top-down.</strong> It is ranked by score, and every candidate that got a live chain sorts above those that did not.</li>
          <li><strong>Click a row</strong> to expand the score breakdown, the full trade with both legs, and the exit plan. <strong>Click the ticker</strong> for its price chart.</li>
        </ol>
      </HelpSection>

      <HelpSection title="What the spread actually pays">
        <p style={p}>
          <strong>Debit</strong> is what you pay and the most you can lose. <strong>Max profit</strong> is the width
          between the strikes minus that debit, and you only collect it if the stock closes at or below the short
          strike. <strong>Breakeven</strong> is the long strike minus the debit. <strong>R:R</strong> is max profit
          over max loss &mdash; paying 33% of the width gives 2:1, paying half gives 1:1, and paying more than half
          means risking more than you can make.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Needs</strong> is the distance to the short strike expressed two ways: as a percentage, and as a
          multiple of the move this name would ordinarily make over the life of the trade. That second figure is the
          one that matters, because 8% is nothing for a semiconductor and a long way for a utility. Above about
          2&sigma; the target is a lottery ticket regardless of how good the reward-to-risk looks on paper.
        </p>
      </HelpSection>

      <HelpSection title="Edge: what the spread is worth versus what it costs">
        <p style={p}>
          <strong>Edge</strong> compares the debit against what the vertical would be worth if the stock simply kept
          moving the way it has actually been moving &mdash; priced off its own <em>realized</em> volatility, with no
          assumed direction at all. A positive edge means the market is charging less for this spread than the
          name&rsquo;s own movement justifies. A negative edge means you are overpaying, which is the usual state of
          affairs after a scare, when implied volatility is elevated.
        </p>
        <p style={{ margin: 0 }}>
          The comparison is deliberately direction-neutral, so it cannot double-count the bearish thesis that
          Breakdown already scores. It is also why there is no separate implied-versus-realized term in the score:
          a spread priced off inflated implied volatility simply fails to beat the realized-volatility value.
          <strong> IV/RV</strong> is still shown for context, but note that it reads the <em>opposite</em> way here
          than on the two selling screens &mdash; above 1.0 means options are expensive, and on this screen you are
          the buyer, so high is bad and it is coloured accordingly. <strong>Skew</strong> is the one structural gift
          the trade gets: the lower strike you sell usually carries a fatter implied vol than the higher strike you
          buy, and a ratio above 1.0 means that is working for you.
        </p>
      </HelpSection>

      <HelpSection title="How the score is built (0–100)">
        <p style={p}>
          Four independent axes add to 100 points. Inputs between the thresholds below earn points on a straight-line
          ramp; values beyond a threshold receive that item&rsquo;s minimum or maximum. A letter grade follows:
          A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50, otherwise F. The bands are calibrated to match the other two
          option screens, so a C means the same thing on all three.
        </p>
        <Glossary items={[
          ['Breakdown — 30', 'Trend structure is worth 12: below the 50-day (4), 20-day under the 50-day (3), 50-day under the 200-day (3), and a break less than 15 sessions old (2). Relative weakness of 1–12pp earns 0–8. Momentum rolling over earns up to 6 — 3–20 points of RSI decline earns 0–4, plus 2 for a lower high. The remaining 4 come from a band on the decline size: full credit from about 0.9σ to 2.0σ, tapering to nothing by 3.5σ.'],
          ['Room to fall — 20', 'Sitting 5–40% above the 52-week low earns 0–8; 25–80% of the way up the 52-week range earns 0–6; and a band on the drawdown gives the last 6, peaking between 6% and 25% off the high — enough to have started, not so much that it is over.'],
          ['Structure — 30', 'Needs a live chain. Reward-to-risk from 1:1 to 3:1 earns 0–9. A band on the required move earns 0–8, peaking where the short strike sits about 0.65–1.10 expected moves away. Edge from −15% to +40% earns 0–8. A skew ratio from 1.00 to 1.25 earns 0–5. Earnings before expiry subtract 6.'],
          ['Executability — 20', 'Underlying size (4) and share liquidity (4) need no chain. The rest does: combined two-leg slippage from 40% down to 8% of the debit earns 0–7, and open interest on the thinner leg earns 0–5.'],
        ]} />
        <p style={{ margin: '0.7rem 0 0' }}>
          A grade shown with an asterisk and a dashed outline (for example <strong>B* 72</strong>) had no option chain
          available or was not reached by the live-pricing limit. It is rescaled from the 58 points that could still
          be scored and appears only under <strong>Watchlist Candidates</strong>, because the spread pricing is unknown.
        </p>
      </HelpSection>

      <HelpSection title="Why two legs change the liquidity maths">
        <p style={{ margin: 0 }}>
          A covered call or a cash-secured put crosses one bid/ask spread. A vertical crosses two, and both come out
          of the debit. <strong>Slippage</strong> adds the width of both quotes and shows it as a share of what you
          are paying: at 8% it is noise, at 30% it has quietly turned a 2:1 reward-to-risk into something closer to
          1.4:1. <strong>Worst case</strong> is what the spread costs if both legs fill at the wrong side of their
          quotes. The scanner only considers strikes where <em>both</em> sides of the market are live and uncrossed,
          because a one-sided quote makes the whole debit fictional &mdash; and it scores open interest on the thinner
          leg, since closing the position needs both.
        </p>
      </HelpSection>

      <HelpSection title="Strike selection">
        <p style={p}>
          Rather than mechanically taking &ldquo;the 50-delta and the 25-delta&rdquo;, the scanner enumerates every
          plausible pair inside your delta bands and width window, then picks the best one. A vertical has two free
          parameters that trade directly against each other &mdash; pay more for a nearer target, or less for one
          further away &mdash; and which end of that trade-off wins depends on the chain&rsquo;s own skew and
          liquidity, not on a rule of thumb.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Long delta</strong> places the put you buy, near the money by default. <strong>Short delta</strong>
          {' '}places the put you sell, and lowering it widens the spread: cheaper as a share of the width, better
          reward-to-risk, but a bigger move required. If nothing in the chain meets your debit and reward filters,
          the best available pair is retained under <strong>Watchlist Candidates</strong> with a
          <em> Filters relaxed</em> warning rather than being presented as an actionable trade.
        </p>
      </HelpSection>

      <HelpSection title="Managing the trade">
        <p style={p}>
          A debit spread has more exit decisions than a credit trade. <strong>Take profit at</strong> is the price to
          sell the spread back for, set as a share of <em>max profit</em> rather than of a credit &mdash; there is no
          credit here. Holding for the last slice of the payoff requires the stock to sit still through the most
          gamma-sensitive stretch of the trade, which is a poor use of the remaining days. Strong setups aim for 75%
          of max profit, balanced 65%, and anything carrying a warning 50%.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Stop at</strong> is a discipline stop even though the risk is already capped: recovering half the
          debit funds the next attempt, while riding a defined-risk loser to zero does not.
          <strong> Reassess by</strong> is a time stop &mdash; a directional debit spread that has not worked by the
          time decay bites is a wrong thesis, not an early one. <strong>Invalidate above</strong> is the level that
          kills the reason for the trade: a close back above the nearest moving average the stock just lost. Reaching
          it does not breach your defined risk, but it does remove the thesis. Recalculate everything from your actual
          fill; the figures exclude commissions and cannot guarantee a winning trade.
        </p>
      </HelpSection>

      <HelpSection title="Hedging what you already own">
        <p style={{ margin: 0 }}>
          <strong>Shares</strong> shows any position you hold in the name and how many contracts would cover it, one
          per 100 shares. That is the second use of this screen: when a holding breaks down, a bear put spread is a
          way to define the downside for a known, capped cost instead of selling the position and triggering a taxable
          gain. Note that it is a partial hedge only &mdash; protection stops at the short strike, and the debit is
          spent whether or not the stock falls. The <em>Hedge my holdings</em> preset scans your own positions and
          loosens the relative-weakness and fresh-low gates, since with a hedge you care that <em>this</em> position
          is falling, not that it is falling faster than the market.
        </p>
      </HelpSection>

      <HelpSection title="Column glossary">
        <Glossary items={[
          ['Type', 'Stock, a broad Index fund, or a Sector/commodity fund.'],
          ['Score', 'The 0–100 composite and its letter grade. An asterisk means no option chain was available.'],
          ['Shares', 'Shares you hold and how many contracts that would cover (one per 100).'],
          ['Trend', 'Which structural levels have broken: below the 20-day, the 50-day, and whether the 50-day is under the 200-day.'],
          ['Move', 'The change over the lookback window, and how many standard deviations of this name’s own normal movement that represents.'],
          ['vs Market', 'How far it is lagging the beta-adjusted market. More positive is more specific weakness.'],
          ['RSI', 'Wilder’s 14-day relative strength, and the change over the last two weeks. Falling from a neutral level is the signal; a low flat reading is a move already made.'],
          ['% of Range', 'Where the price sits between its 52-week low and high — how much room is left to fall.'],
          ['IV/RV', 'Implied over realized volatility. Above 1.0 means options are expensive, which on this screen is a cost, not a benefit — so it is coloured red, the reverse of the selling screens.'],
          ['Buy This Spread', 'The suggested vertical: long strike / short strike, expiration, days to expiry, and the debit per share.'],
          ['Risk / Reward', 'Dollars at risk per contract and dollars of max profit, with the ratio.'],
          ['Needs', 'The fall required to reach the short strike, as a percentage and as a multiple of the expected move over the life of the trade.'],
          ['Edge', 'The debit against realized-volatility fair value. Positive means the spread is cheap for how much this name moves.'],
          ['Exit', 'The suggested price to sell the spread back for, and what share of max profit that captures.'],
          ['Warnings', 'Short chips; hover any of them, or expand the row, for the full wording.'],
        ]} />
      </HelpSection>

      <HelpSection title="Warnings">
        <Glossary items={[
          ['Fresh lows', 'Already printing new 52-week lows — where put sellers get paid, not put buyers.'],
          ['Oversold', 'RSI at 30 or below. The move is largely made and the next one is as likely to be the bounce.'],
          ['Bounced', 'It has already rallied 8% or more off its recent low, so the breakdown is not clean.'],
          ['Stale trend', 'Below the 50-day for more than 120 sessions — a trend everybody has already priced.'],
          ['Debit > half', 'The debit is more than half the width, so you are risking more than you can make.'],
          ['Needs big move', 'The short strike is more than 2 expected moves away — treat it as a lottery ticket.'],
          ['Overpriced', 'The debit exceeds what this name’s own realized volatility justifies.'],
          ['IV rich', 'Implied volatility is 25% or more above realized. Expensive to be the buyer.'],
          ['Filters relaxed', 'No strike pair met your debit and reward filters. The best available pair is retained in Watchlist Candidates for research, not shown as an actionable trade.'],
          ['Slippage', 'Crossing both bid/ask spreads costs more than a quarter of the debit.'],
          ['Thin OI', 'Low open interest on one leg — hard to get filled, or to close.'],
          ['Earnings in trade', 'A report conflicts with the requested trade horizon. With the earnings skip enabled, the ticker is excluded.'],
          ['No chain', 'No option chain came back, so the Structure axis could not be scored.'],
          ['Not priced', 'The name passed the directional screen but ranked outside the current live-chain pricing limit.'],
          ['Illiquid', 'Thin average dollar volume in the shares themselves.'],
          ['Below 200d', 'Price is far below the 200-day average — the move is well advanced.'],
          ['Leveraged', 'A leveraged or inverse fund; these decay and gap in ways a spread buyer is not paid for.'],
          ['Small', 'A small underlying, where a two-leg option market is usually thin.'],
        ]} />
      </HelpSection>

      <p style={{ margin: '0.85rem 0 0', color: 'var(--warning-text)' }}>
        Scores rate the setup from public market data. They are not advice. A bear put spread is a directional bet
        that expires: unlike selling premium, time works against you every day, and the entire debit is lost if the
        stock simply goes nowhere. Both selling screens can be wrong and still profit; this one cannot.
      </p>
    </div>
  )
}

function DetailRow({ row, colSpan, onShowChart }) {
  const s = row.spread
  const plan = s?.plan
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
          <RiskGraphButton kind="bear-put-spread" row={row} source="Bear Put Spread Scanner" />
        </div>
        <div style={{ maxWidth: '1100px', fontSize: '0.88rem', color: 'var(--text-strong)', marginBottom: '0.8rem' }}>
          {row.verdict}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: '1.5rem', alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              Score breakdown
            </div>
            <ScoreBar label="Breakdown" value={row.components.breakdown} max={row.component_max.breakdown}
              tip="Broken trend structure, relative weakness, momentum rolling over — and not already spent" />
            <ScoreBar label="Room to fall" value={row.components.room} max={row.component_max.room}
              tip="Distance left before the payoff caps: above the 52-week low, position in the range, drawdown not yet extended" />
            <ScoreBar label="Structure" value={row.components.structure} max={row.component_max.structure}
              tip="Reward to risk, how reachable the short strike is, the debit against realized-vol fair value, and the skew" />
            <ScoreBar label="Executability" value={row.components.execution} max={row.component_max.execution}
              tip="Underlying size and liquidity, plus two-leg slippage and open interest on the thinner leg" />
            {row.scored_on_partial && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                No option chain available — scored on the 58 points that did not need one.
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              {s ? 'Suggested bear put spread' : 'Option chain unavailable'}
            </div>
            {s && (
              <div style={{
                padding: '0.6rem 0.8rem', marginBottom: '0.8rem', borderRadius: '5px',
                background: 'var(--surface-inset)', borderLeft: '3px solid var(--accent-bright)',
              }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  The trade
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-bright)', margin: '0.15rem 0' }}>
                  Buy {row.ticker} {s.expiration} ${s.long_strike} put / sell ${s.short_strike} put
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Pay about {usd(s.debit_dollars, 0)} per contract for a {usd(s.width)}-wide spread. That
                  {' '}{usd(s.debit_dollars, 0)} is the entire risk; the most it can make is
                  {' '}{usd(s.max_profit_dollars, 0)} &mdash; a {num(s.reward_risk, 2)}:1 reward to risk.
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Breaks even at {usd(s.breakeven)} ({pct(s.breakeven_move_pct)} below today&rsquo;s
                  {' '}{usd(row.price)}), and reaches maximum profit at or below {usd(s.short_strike)} &mdash;
                  a {pct(s.required_move_pct)} fall, which is {sigma(s.required_move_sigma, 2)} of this
                  name&rsquo;s expected {pct(s.expected_move_pct_life)} move over {s.dte} days.
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                  The outright ${s.long_strike} put alone would cost {usd(s.outright_cost)} per share;
                  selling the ${s.short_strike} put cuts that by {pct(s.cost_saving_pct, 0)}, in exchange for
                  capping everything below {usd(s.short_strike)}.
                </div>
                <div style={{
                  fontSize: '0.78rem', marginTop: '0.35rem',
                  color: (s.edge_pct ?? 0) >= 0 ? 'var(--pos-strong)' : 'var(--neg-strong)',
                }}>
                  {(s.edge_pct ?? 0) >= 0 ? '✓ ' : '⚠ '}
                  Realized-vol fair value is {usd(s.fair_value)} against a {usd(s.debit)} debit &mdash;
                  {' '}{(s.edge_pct ?? 0) >= 0 ? 'cheaper' : 'dearer'} than this name&rsquo;s own movement
                  justifies by {pct(Math.abs(s.edge_pct ?? 0), 0)}.
                </div>
                {s.constraints_relaxed && (
                  <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', color: 'var(--warning-text)' }}>
                    ⚠ No pair in this expiration met your debit and reward-to-risk filters, so the best available
                    pair of {s.pairs_considered} considered is shown instead.
                  </div>
                )}
                {s.earnings_date && (
                  <div style={{
                    fontSize: '0.78rem', marginTop: '0.25rem',
                    color: s.avoids_earnings ? 'var(--pos-strong)' : 'var(--neg-strong)',
                  }}>
                    {s.avoids_earnings
                      ? `✓ Expires ${s.days_earnings_after_expiry}d before earnings on ${s.earnings_date} — the report lands after you are out.`
                      : `⚠ Earnings on ${s.earnings_date} fall inside this trade. No listed expiration clears it, and the pre-report implied vol is part of what makes the debit expensive.`}
                  </div>
                )}
                {row.contracts_to_hedge > 0 && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--teal)', marginTop: '0.25rem' }}>
                    You hold {shares(row.shares_held)} shares &mdash; {row.contracts_to_hedge}{' '}
                    {row.contracts_to_hedge === 1 ? 'contract' : 'contracts'} would cover the position, defining the
                    downside between {usd(s.long_strike)} and {usd(s.short_strike)} for {usd(s.debit_dollars, 0)}
                    {row.contracts_to_hedge > 1 ? ' each' : ''}.
                  </div>
                )}
              </div>
            )}

            {s && (
              <div style={{ marginBottom: '0.8rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                  The two legs
                </div>
                <div className="sst-wrap">
                  <table className="sst" style={{ fontSize: '0.78rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Leg</th>
                        <th style={{ textAlign: 'right' }}>Strike</th>
                        <th style={{ textAlign: 'right' }}>Bid</th>
                        <th style={{ textAlign: 'right' }}>Ask</th>
                        <th style={{ textAlign: 'right' }}>Mid</th>
                        <th style={{ textAlign: 'right' }}>IV</th>
                        <th style={{ textAlign: 'right' }}>Delta</th>
                        <th style={{ textAlign: 'right' }}>OI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Buy', s.long_leg, 'var(--accent-bright)'],
                        ['Sell', s.short_leg, 'var(--amber)'],
                      ].map(([action, leg, color]) => (
                        <tr key={action}>
                          <td style={{ color, fontWeight: 600 }}>{action} put</td>
                          <td style={{ textAlign: 'right' }}>{usd(leg?.strike)}</td>
                          <td style={{ textAlign: 'right' }}>{num(leg?.bid)}</td>
                          <td style={{ textAlign: 'right' }}>{num(leg?.ask)}</td>
                          <td style={{ textAlign: 'right' }}>{num(leg?.mid)}</td>
                          <td style={{ textAlign: 'right' }}>{pct((leg?.iv ?? 0) * 100, 0)}</td>
                          <td style={{ textAlign: 'right' }}>{num(leg?.delta, 3)}</td>
                          <td style={{ textAlign: 'right' }}>{leg?.open_interest ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                  Net debit at the mids is {usd(s.debit)}; paying the ask on the long leg and taking the bid on the
                  short leg costs {usd(s.debit_worst_case)}. Crossing both quotes is {usd(s.exec_cost)}, or
                  {' '}{pct(s.exec_cost_pct, 0)} of the debit &mdash; work the order rather than paying that.
                </div>
              </div>
            )}

            {plan && (
              <div style={{
                padding: '0.7rem 0.85rem', marginBottom: '0.8rem', borderRadius: '5px',
                background: 'color-mix(in srgb, var(--accent-bright) 8%, var(--surface-inset))',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 45%, var(--border))',
              }}>
                <div style={{
                  fontSize: '0.72rem', color: 'var(--accent-bright)', textTransform: 'uppercase',
                  letterSpacing: '0.04em', fontWeight: 700,
                }}>
                  Exit plan · {plan.profile}
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 750, color: 'var(--text-strong)', margin: '0.18rem 0' }}>
                  Take profit near {usd(plan.target_price)} · stop at {usd(plan.stop_price)}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Selling the spread back at {usd(plan.target_price)} banks about
                  {' '}{usd(plan.target_profit_dollars, 0)} of the {usd(s.max_profit_dollars, 0)} maximum
                  ({pct(plan.target_capture_pct, 0)}). The stop gives back {usd(plan.stop_loss_dollars, 0)} of the
                  {' '}{usd(s.max_loss_dollars, 0)} at risk rather than all of it. If neither has triggered,
                  reassess by {plan.reassess_dte} DTE &mdash; a directional debit spread that has not worked by then
                  is a wrong thesis, not an early one.
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {plan.invalidate_note}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                  {plan.rationale} Base the live order on your actual entry fill; commissions and slippage are excluded.
                </div>
              </div>
            )}

            {s && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
                {cell('Days to expiry', s.dte)}
                {cell('Width', usd(s.width))}
                {cell('Debit', `${usd(s.debit)} (${pct(s.debit_pct_of_width, 0)} of width)`)}
                {cell('Worst-case debit', usd(s.debit_worst_case))}
                {cell('Max loss', usd(s.max_loss_dollars, 0))}
                {cell('Max profit', usd(s.max_profit_dollars, 0))}
                {cell('Reward : risk', `${num(s.reward_risk, 2)} : 1`)}
                {cell('Breakeven', usd(s.breakeven))}
                {cell('Chance of profit', pct(s.prob_profit, 0))}
                {cell('Chance of max profit', pct(s.prob_max_profit, 0))}
                {cell('Fair value', usd(s.fair_value))}
                {cell('Edge', pct(s.edge_pct, 0))}
                {cell('Put skew', num(s.skew_ratio, 2))}
                {cell('IV / realized vol', num(row.iv_rv_ratio))}
                {cell('Slippage', `${usd(s.exec_cost)} (${pct(s.exec_cost_pct, 0)})`)}
                {cell('Open interest (min leg)', s.open_interest_min ?? '—')}
              </div>
            )}

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              The breakdown
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
              {cell('Move in window', pct(row.window_pct))}
              {cell('Normal move', `±${pct(row.expected_move_pct)}`)}
              {cell('Stretch', sigma(row.stretch_sigma))}
              {cell('vs market', pct(row.rel_weakness_pct))}
              {cell('Beta', num(row.beta))}
              {cell('From 52-wk high', pct(row.drawdown_pct))}
              {cell('% of 52-wk range', pct(row.pct_of_52w_range, 0))}
              {cell('52-wk range', `${usd(row.week52_low)} – ${usd(row.week52_high)}`)}
              {cell('Above 52-wk low', pct(row.above_52w_low_pct))}
              {cell('RSI (2-wk change)', `${num(row.rsi_14, 0)} (${row.rsi_roll_pp > 0 ? '+' : ''}${num(row.rsi_roll_pp, 1)})`)}
              {cell('Below 50-day', pct(row.below_sma50_pct))}
              {cell('ATRs below 50-day', num(row.atr_below_sma50, 1))}
              {cell('Sessions below 50-day', row.days_below_sma50 ?? '—')}
              {cell('vs 200-day', pct(row.room_to_sma200_pct))}
              {cell('5d vs prior 5d', `${num(row.accel_pp, 1)} pp`)}
              {cell('Realized vol (30d)', pct((row.rv_30 ?? 0) * 100, 0))}
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              The underlying
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem' }}>
              {cell('Sector', row.sector || '—')}
              {cell(row.is_fund ? 'Fund assets' : 'Market cap', row.size ? usdCompact(row.size) : '—')}
              {cell('Avg $ volume', row.avg_dollar_volume ? usdCompact(row.avg_dollar_volume) : '—')}
              {cell('Shares held', row.shares_held ? shares(row.shares_held) : '—')}
              {cell('Contracts to cover', row.contracts_to_hedge || '—')}
              {cell('Your basis', row.cost_basis != null ? usd(row.cost_basis) : '—')}
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
  { key: 'contracts_to_hedge', label: 'Shares', align: 'right', tip: 'Shares you hold, and how many contracts would cover the position (one per 100)' },
  { key: 'trend', label: 'Trend', align: 'center', tip: 'Which structural levels have broken: the 20-day, the 50-day, and whether the 50-day is under the 200-day' },
  { key: 'window_pct', label: 'Move', align: 'right', tip: 'The change over the lookback window, and how many standard deviations of this name’s own normal movement that is' },
  { key: 'rel_weakness_pct', label: 'vs Market', align: 'right', tip: 'How far it is lagging the beta-adjusted market. More positive is more specific weakness.' },
  { key: 'rsi_14', label: 'RSI', align: 'right', tip: 'Wilder’s 14-day relative strength, and its change over the last two weeks. Falling from neutral is the signal.' },
  { key: 'pct_of_52w_range', label: '% of Range', align: 'right', tip: 'Where the price sits between its 52-week low and high — the room left to fall' },
  { key: 'iv_rv_ratio', label: 'IV/RV', align: 'right', tip: 'Implied over realized vol. Above 1.0 means options are expensive — a cost on this screen, since you are the buyer.' },
  { key: 'spread_strikes', label: 'Buy This Spread', align: 'center', tip: 'The suggested vertical: long strike / short strike and expiration' },
  { key: 'dte', label: 'DTE', align: 'right', tip: 'Days to expiration for the suggested option chain' },
  { key: 'spread_rr', label: 'Risk / Reward', align: 'right', tip: 'Dollars at risk per contract and dollars of max profit, with the ratio' },
  { key: 'spread_needs', label: 'Needs', align: 'right', tip: 'The fall required to reach the short strike, in percent and in expected moves' },
  { key: 'spread_edge', label: 'Edge', align: 'right', tip: 'The debit against realized-volatility fair value. Positive means the spread is cheap for how much this name moves.' },
  { key: 'spread_exit', label: 'Exit', align: 'right', tip: 'Suggested price to sell the spread back for, and the share of max profit that captures' },
  { key: 'flags', label: 'Warnings', align: 'left' },
]

const SORT_ACCESSORS = {
  spread_strikes: r => r.spread?.long_strike ?? null,
  dte: r => r.spread?.dte ?? null,
  spread_rr: r => r.spread?.reward_risk ?? null,
  spread_needs: r => r.spread?.required_move_sigma ?? null,
  spread_edge: r => r.spread?.edge_pct ?? null,
  spread_exit: r => r.spread?.plan?.target_price ?? null,
  trend: r => (r.below_sma20 ? 1 : 0) + (r.below_sma50 ? 2 : 0) + (r.sma50_below_sma200 ? 4 : 0),
  flags: r => (r.flags?.length ?? 0),
  kind: r => (r.is_fund ? (r.fund_kind || 'fund') : 'stock'),
}

/** Three dots for the 20-day, 50-day, and 50/200 cross. Filled = broken. */
function TrendDots({ row }) {
  const items = [
    ['20', row.below_sma20, 'Price is below its 20-day average'],
    ['50', row.below_sma50, 'Price is below its 50-day average'],
    ['✖', row.sma50_below_sma200, 'The 50-day average is below the 200-day — a confirmed downtrend'],
  ]
  return (
    <span style={{ display: 'inline-flex', gap: '0.2rem' }}>
      {items.map(([label, on, tip]) => (
        <span key={label} title={`${tip}${on ? '' : ' — not yet'}`} style={{
          fontSize: '0.62rem', fontWeight: 700, lineHeight: 1,
          padding: '0.15rem 0.22rem', borderRadius: '3px', minWidth: '1.1rem',
          textAlign: 'center',
          color: on ? 'var(--neg-strong)' : 'var(--text-dim)',
          border: `1px solid ${on ? 'var(--neg-strong)' : 'var(--border)'}`,
          background: on ? 'var(--surface-inset)' : 'transparent',
          opacity: on ? 1 : 0.45,
        }}>{label}</span>
      ))}
    </span>
  )
}

export default function BearPutSpreadScanner() {
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
  const [cachedScan, saveScan] = useScanCache('bear-put-spread')
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [watchlistRows, setWatchlistRows] = useState(cachedScan?.watchlist_rows || [])
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
    pf('/api/options/bear-put-spread-scan/universes')
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
  const activePreset = useMemo(() => findActivePreset(PRESETS, filters), [filters])

  const anyFunds = !!(filters.include_index_etfs || filters.include_sector_etfs)
  const nothingSelected = !filters.include_stocks && !anyFunds
  const scanningFundsOnly = anyFunds && !filters.include_stocks
  const anySmallCaps = !!filters.include_stocks
    && !!universes.find(u => u.id === filters.universe)?.small_cap

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
    pf('/api/options/bear-put-spread-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        setRows(d.rows || [])
        setWatchlistRows(d.watchlist_rows || [])
        setStats(d.stats || null)
        setAsOf(d.as_of || null)
        setHasScanned(true)
        saveScan({
          rows: d.rows || [], watchlist_rows: d.watchlist_rows || [],
          stats: d.stats || null, as_of: d.as_of || null,
        })
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
        const tier = (a.spread ? 0 : 1) - (b.spread ? 0 : 1)
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

  const numField = (label, key, { step = 1, min = 0, width = 80, suffix = '', scale = 1, tip } = {}) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', color: 'var(--text-dim)' }} title={tip}>
      {label}
      <span>
        <input
          type="number" step={step} min={min}
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
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Bear Put Spread Scanner</h1>
        <button
          type="button"
          className="btn btn-xs btn-outline"
          aria-expanded={showHelp}
          aria-controls="bear-put-spread-scanner-help"
          onClick={() => setShowHelp(h => !h)}
        >
          {showHelp ? 'Hide Help' : 'How this works'}
        </button>
      </div>
      <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        Finds names whose breakdown has <em>started but not finished</em>, then prices a defined-risk put spread on
        each. Whatever just crashed is the wrong answer &mdash; that is the Put Selling Scanner&rsquo;s setup, and
        buying downside into it means paying peak volatility for a move already made.
      </p>
      <ScannerRiskNotice />

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
          ['include_index_etfs', 'Index ETFs', 'SPY, QQQ, IWM, DIA, style and rates funds'],
          ['include_sector_etfs', 'Sector & commodity ETFs', 'XLK, XLE, GLD, SMH, KRE and the rest of the sector complex — concentrated enough to trend'],
        ].map(([key, label, tip]) => (
          <label key={key} title={tip}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', color: filters[key] ? 'var(--text-strong)' : 'var(--text-dim)' }}>
            <input type="checkbox" checked={!!filters[key]} onChange={e => set(key, e.target.checked)} />
            {label}
          </label>
        ))}
        {nothingSelected && (
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
          <button key={key} className={`btn btn-xs ${key === activePreset ? 'btn-scan' : 'btn-outline'}`}
            aria-pressed={key === activePreset} title={p.tip} onClick={() => applyPreset(key)}>
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
              type="text" placeholder="AAPL, NVDA, COST..."
              value={filters.custom_tickers || ''}
              onChange={e => set('custom_tickers', e.target.value.toUpperCase())}
              style={{
                padding: '0.3rem 0.4rem', background: 'var(--surface-inset)', border: '1px solid var(--border)',
                borderRadius: '4px', color: 'var(--text-strong)', fontSize: '0.82rem', width: '100%',
              }}
            />
          </label>
        )}

        {/* The decline band. Both ends matter: a floor so the move has started,
            a ceiling so it is not already over. */}
        {numField('Min stretch', 'min_stretch_sigma', { step: 0.1, suffix: 'σ', width: 60, tip: 'Minimum decline over the window, in standard deviations of this name’s own normal movement' })}
        {numField('Max stretch', 'max_stretch_sigma', { step: 0.1, suffix: 'σ', width: 60, tip: 'Ceiling on the decline. Above this the move being paid for has already happened — this is the gate that stops the screen becoming a crash-chaser.' })}
        {numField('Min RSI', 'min_rsi', { width: 60, tip: 'Floor, not a ceiling: below this the name is washed out and the next move is as likely to be the bounce' })}
        {numField('Max RSI', 'max_rsi', { width: 60, tip: 'Ceiling: above this the name is not rolling over yet' })}
        {numField('Min vs market', 'min_rel_weakness_pct', { step: 0.5, suffix: 'pp', width: 60, tip: 'Stocks: how far it must lag the beta-adjusted market over the window' })}
        {anyFunds && numField('ETF min vs market', 'fund_min_rel_weakness_pct', { step: 0.5, suffix: 'pp', width: 60, tip: 'ETFs track the benchmark by construction — SPY has zero weakness against itself — so funds need their own floor, usually 0' })}
        {numField('Max drawdown', 'max_drawdown_pct', { suffix: '%', width: 60, tip: 'Skip names already this far off their 52-week high — the payoff is capped, so most of the move has to still be available' })}
        {numField('Min above low', 'min_above_52w_low_pct', { suffix: '%', width: 60, tip: 'Minimum room above the 52-week low' })}

        {filters.include_stocks && numField('Min mkt cap', 'min_market_cap', { scale: 1e9, suffix: 'B', width: 60, tip: 'Funds are sized by AUM, and small caps get their own floor' })}
        {anySmallCaps && numField('Small-cap min cap', 'small_cap_min_market_cap', { scale: 1e9, suffix: 'B', width: 60, tip: 'Small caps need their own floor. Stricter here than on the covered call screen — a vertical has to fill on two legs.' })}
        {anyFunds && numField('ETF min AUM', 'fund_min_aum', { scale: 1e6, suffix: 'M', width: 60, tip: 'Funds report assets under management rather than a market cap' })}
        {numField('Min $ volume', 'min_avg_dollar_volume', { scale: 1e6, suffix: 'M', width: 60, tip: 'Average daily dollar volume. Set higher than on the selling screens: two legs to cross means liquidity matters more.' })}
        {numField('Lookback', 'lookback_days', { width: 60, suffix: 'd', tip: 'Trading days in the decline window' })}

        {/* Target DTE alone drives the choice — there is no fixed expiration
            window, so anything from a weekly to a LEAP is reachable. */}
        {numField('Target DTE', 'target_dte', { min: 1, width: 60, tip: 'Preferred days to expiration — set it to anything from a few days to a LEAP and the scanner takes the listed expiration nearest to it. Longer than a credit trade wants: a debit spread needs time for the move to happen, and buying too little of it is the most common way a correct call still loses.' })}
        {numField('Long delta', 'long_delta', { step: 0.05, width: 60, tip: 'Places the put you buy. 0.50 is at the money.' })}
        {numField('Short delta', 'short_delta', { step: 0.05, width: 60, tip: 'Places the put you sell. Lower widens the spread: cheaper as a share of the width, but a bigger move required.' })}
        {numField('Max debit', 'max_debit_pct_of_width', { suffix: '% of width', width: 60, tip: 'Above 50% you risk more than you can make. 33% is a 2:1 spread.' })}
        {numField('Min R:R', 'min_reward_risk', { step: 0.1, suffix: ': 1', width: 60, tip: 'Minimum max-profit to max-loss ratio' })}
        {numField('Max move needed', 'max_required_sigma', { step: 0.1, suffix: 'σ', width: 60, tip: 'Reject spreads whose short strike is further away than this many expected moves' })}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {checkField('Require price below the 50-day', 'require_below_sma50', 'The minimum definition of a broken trend')}
          {checkField('Require 50-day below 200-day', 'require_downtrend', 'A confirmed downtrend, not just a break. Far fewer candidates.')}
          {checkField('Skip fresh 52-wk lows', 'exclude_fresh_lows', 'Exclude names already printing new lows — where put sellers get paid, not put buyers')}
          {filters.include_stocks && checkField('Skip earnings inside trade', 'exclude_earnings_before_expiry', 'Exclude stocks whose next report falls within Target DTE plus the safety buffer; never substitute a very short expiration')}
          {anyFunds && checkField('Skip leveraged / inverse ETFs', 'exclude_leveraged_funds', 'Leveraged and inverse funds decay and gap in ways a spread buyer is not paid for')}
        </div>

        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading || nothingSelected}>
          {loading ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
          Pulling a year of history for the universe, then live option chains for the finalists and every plausible
          strike pair in each. The first run takes about 20&ndash;40 seconds; re-running with different filters is
          much faster while the data is cached (and the price and chain caches are shared with the Put Selling
          Scanner).
        </p>
      )}

      {stats && !loading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.6rem' }}>
          Scanned <strong style={{ color: 'var(--text-muted)' }}>{stats.priced}</strong> of {stats.universe} tickers
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_price}</strong> breaking down
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_fundamentals}</strong> passed size &amp; liquidity
          {' → '}<strong style={{ color: 'var(--pos-strong)' }}>{stats.actionable ?? stats.final}</strong> actionable
          {stats.watchlist ? ` · ${stats.watchlist} watchlist` : ''}
          {stats.chains_fetched ? ` · ${stats.chains_fetched} live spreads found` : ''}
          {stats.positions_known ? ` · ${stats.positions_known} you already hold` : ''}
          {stats.dropped_for_earnings ? ` · ${stats.dropped_for_earnings} excluded for earnings` : ''}
          {asOf ? ` · ${new Date(asOf).toLocaleString()}` : ''}
        </div>
      )}

      {sortedRows.length > 0 && (
        <>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          gap: '1rem', margin: '0.85rem 0 0.45rem',
        }}>
          <h2 style={{ margin: 0, color: 'var(--text-strong)', fontSize: '1.05rem' }}>
            Actionable Spreads
          </h2>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            Live quotes that meet every selected structure limit
          </span>
        </div>
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
                const s = r.spread
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
                      <td style={{ textAlign: 'right' }}>
                        {r.contracts_to_hedge > 0 ? (
                          <>
                            <div style={{ fontWeight: 600, color: 'var(--teal)' }}>
                              {r.contracts_to_hedge}&times;
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {shares(r.shares_held)} sh
                            </div>
                          </>
                        ) : r.shares_held ? (
                          <span title="Fewer than 100 shares, so one contract would over-hedge the position"
                                style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            {shares(r.shares_held)} sh
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}><TrendDots row={r} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ color: (r.window_pct ?? 0) < 0 ? 'var(--neg-strong)' : 'var(--text)' }}>
                          {pct(r.window_pct)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                          {sigma(r.stretch_sigma)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', color: (r.rel_weakness_pct ?? 0) > 0 ? 'var(--neg-strong)' : 'var(--text)' }}>
                        {pct(r.rel_weakness_pct)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div>{num(r.rsi_14, 0)}</div>
                        <div style={{
                          fontSize: '0.68rem', whiteSpace: 'nowrap',
                          color: (r.rsi_roll_pp ?? 0) < 0 ? 'var(--neg-strong)' : 'var(--text-dim)',
                        }}>
                          {r.rsi_roll_pp == null ? '—' : `${r.rsi_roll_pp > 0 ? '+' : ''}${num(r.rsi_roll_pp, 0)}`}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>{pct(r.pct_of_52w_range, 0)}</td>
                      {/* Reverse of the selling screens: rich IV is a cost here. */}
                      <td style={{ textAlign: 'right', color: (r.iv_rv_ratio ?? 0) > 1.15 ? 'var(--neg-strong)' : 'var(--text-muted)' }}>
                        {num(r.iv_rv_ratio)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {s ? (
                          <div style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '4px',
                            background: 'var(--surface-inset)', border: '1px solid var(--accent-bright)',
                            lineHeight: 1.25,
                          }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent-bright)', whiteSpace: 'nowrap' }}>
                              ${s.long_strike} / ${s.short_strike} P
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              exp {s.expiration}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {usd(s.debit)} debit · {pct(s.debit_pct_of_width, 0)} of width
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {s ? `${s.dte}d` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {s ? (
                          <>
                            <div style={{ whiteSpace: 'nowrap' }}>
                              <span style={{ color: 'var(--neg-strong)' }}>{usd(s.max_loss_dollars, 0)}</span>
                              {' / '}
                              <span style={{ color: 'var(--pos-strong)' }}>{usd(s.max_profit_dollars, 0)}</span>
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {num(s.reward_risk, 2)} : 1
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {s ? (
                          <>
                            <div>{pct(s.required_move_pct, 1)}</div>
                            <div style={{
                              fontSize: '0.68rem', whiteSpace: 'nowrap',
                              color: (s.required_move_sigma ?? 0) > 2 ? 'var(--neg-strong)' : 'var(--text-dim)',
                            }}>
                              {sigma(s.required_move_sigma, 2)}
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{
                        textAlign: 'right', fontWeight: 600,
                        color: (s?.edge_pct ?? 0) >= 0 ? 'var(--pos-strong)' : 'var(--neg-strong)',
                      }}>
                        {s ? pct(s.edge_pct, 0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {s?.plan ? (
                          <>
                            <div style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>
                              {usd(s.plan.target_price)}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              take {pct(s.plan.target_capture_pct, 0)}
                            </div>
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
        </>
      )}

      {!loading && watchlistRows.length > 0 && (
        <details open={sortedRows.length === 0} style={{
          marginTop: '1rem', border: '1px solid var(--border)', borderRadius: '6px',
          background: 'var(--surface-sunken)', overflow: 'hidden',
        }}>
          <summary style={{
            cursor: 'pointer', padding: '0.7rem 0.85rem', color: 'var(--text-strong)',
            fontWeight: 700, fontSize: '0.92rem',
          }}>
            Watchlist Candidates ({watchlistRows.length})
            <span style={{ marginLeft: '0.65rem', color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.75rem' }}>
              Directional setup passed, but no fully qualified actionable spread
            </span>
          </summary>
          <p style={{
            margin: 0, padding: '0 0.85rem 0.7rem', color: 'var(--text-dim)',
            fontSize: '0.76rem', lineHeight: 1.45,
          }}>
            These names are research candidates only. A quoted spread missed at least one structure limit,
            the expiration crosses earnings, the chain had no usable two-sided pair, or the name ranked outside
            the live-pricing limit.
          </p>
          <div className="sst-wrap" style={{ maxHeight: '45vh', borderLeft: 0, borderRight: 0, borderBottom: 0 }}>
            <table className="sst">
              <thead>
                <tr>
                  <th style={{ width: '24px' }} />
                  <th>Ticker</th>
                  <th>Type</th>
                  <th>Score</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Move</th>
                  <th style={{ textAlign: 'right' }}>vs Market</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center' }}>Indicative Spread</th>
                  <th style={{ textAlign: 'right' }}>DTE</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {watchlistRows.map(r => {
                  const open = expanded === r.ticker
                  const s = r.spread
                  const status = {
                    earnings: ['Earnings inside trade', 'var(--amber)'],
                    constraints_relaxed: ['Structure limits missed', 'var(--amber)'],
                    unavailable: ['No quotable spread', 'var(--neg-strong)'],
                    not_priced: ['Awaiting live pricing', 'var(--text-muted)'],
                  }[r.chain_status] || ['Not actionable', 'var(--text-muted)']
                  return (
                    <React.Fragment key={r.ticker}>
                      <tr onClick={() => setExpanded(open ? null : r.ticker)} style={{ cursor: 'pointer' }}>
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
                          <div style={{
                            fontSize: '0.7rem', color: 'var(--text-dim)', maxWidth: '190px',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {r.name}
                          </div>
                        </td>
                        <td><KindBadge row={r} /></td>
                        <td><GradeBadge grade={r.grade} score={r.score} partial={r.scored_on_partial} /></td>
                        <td style={{ textAlign: 'right' }}>{usd(r.price)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ color: (r.window_pct ?? 0) < 0 ? 'var(--neg-strong)' : 'var(--text)' }}>
                            {pct(r.window_pct)}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                            {sigma(r.stretch_sigma)}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', color: (r.rel_weakness_pct ?? 0) > 0 ? 'var(--neg-strong)' : 'var(--text)' }}>
                          {pct(r.rel_weakness_pct)}
                        </td>
                        <td style={{ color: status[1], minWidth: '145px' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.74rem' }}>{status[0]}</div>
                          <div style={{
                            marginTop: '0.15rem', color: 'var(--text-dim)', fontSize: '0.68rem',
                            lineHeight: 1.3, maxWidth: '280px',
                          }}>
                            {r.watchlist_reason}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {s ? (
                            <>
                              <div style={{ color: 'var(--amber)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                ${s.long_strike} / ${s.short_strike} P
                              </div>
                              <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                                {usd(s.debit)} debit · {num(s.reward_risk, 2)}:1
                              </div>
                            </>
                          ) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {s ? `${s.dte}d` : '—'}
                        </td>
                        <td style={{ whiteSpace: 'normal', minWidth: '150px', maxWidth: '190px' }}>
                          <Flags flags={r.flags} />
                        </td>
                      </tr>
                      {open && <DetailRow row={r} colSpan={11} onShowChart={setChartTicker} />}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {!loading && hasScanned && sortedRows.length === 0 && watchlistRows.length === 0 && !error && (
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>
          Nothing cleared the filters. That is normal in a rising market, and the gates here are deliberately narrow
          &mdash; try lowering <em>Min vs market</em>, widening the RSI band, unticking
          <em> Require 50-day below 200-day</em>, or widening the universe. If candidates appear but none get a
          spread, loosen <em>Max debit</em> or <em>Min R:R</em>.
        </p>
      )}

      {!loading && hasScanned && sortedRows.length === 0 && watchlistRows.length > 0 && !error && (
        <p style={{
          color: 'var(--amber)', textAlign: 'center', margin: '1rem 0 0',
          padding: '0.7rem', border: '1px solid color-mix(in srgb, var(--amber) 45%, var(--border))',
          borderRadius: '6px', background: 'color-mix(in srgb, var(--amber) 8%, var(--surface))',
        }}>
          No currently actionable spread met every enabled risk gate. Review Watchlist Candidates for the exact
          reason, or adjust the relevant earnings or structure setting.
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
