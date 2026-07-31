import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import PriceChartModal from '../components/PriceChartModal'
import OptionProbabilityCards from '../components/OptionProbabilityCards'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'
import { findActivePreset } from '../utils/activePreset'

const STORAGE_KEY = 'bear-call-spread-scanner-filters'

const PRESETS = {
  conservative: {
    label: 'Conservative',
    tip: 'Confirmed downtrend, a wall overhead, a strike above it, and a chain you can actually close out of',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: false,
      min_market_cap: 20e9, fund_min_aum: 2e9, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 100e6, lookback_days: 21,
      min_rally_sigma: 0.4, max_rally_sigma: 2.0,
      max_rel_strength_pct: 0, fund_max_rel_strength_pct: 0,
      require_rolled_over: true, require_below_sma50: true, require_downtrend: true,
      require_resistance_overhead: true,
      min_rsi: 38, max_rsi: 62, max_accel_pp: 1, max_run_off_low_pct: 12,
      max_pct_of_52w_range: 80,
      exclude_fresh_highs: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 7,
      target_dte: 35,
      short_delta: 0.20, long_delta: 0.08, delta_tolerance: 0.10,
      min_width_pct: 2, max_width_pct: 12,
      min_credit_pct_of_width: 22, min_cushion_pct: 5, min_otm_pct: 3,
      min_open_interest: 250, max_exec_cost_pct: 18, respect_resistance: true,
    },
  },
  balanced: {
    label: 'Balanced',
    tip: 'A rally that rolled over under overhead supply, and the conventional 25/10-delta credit spread',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      min_market_cap: 5e9, fund_min_aum: 500e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 25e6, lookback_days: 21,
      min_rally_sigma: 0.3, max_rally_sigma: 2.5,
      max_rel_strength_pct: 4, fund_max_rel_strength_pct: 2,
      require_rolled_over: true, require_below_sma50: false, require_downtrend: false,
      require_resistance_overhead: true,
      min_rsi: 35, max_rsi: 68, max_accel_pp: 3, max_run_off_low_pct: 20,
      max_pct_of_52w_range: 92,
      exclude_fresh_highs: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 5,
      target_dte: 35,
      short_delta: 0.25, long_delta: 0.10, delta_tolerance: 0.12,
      min_width_pct: 1, max_width_pct: 15,
      min_credit_pct_of_width: 20, min_cushion_pct: 3, min_otm_pct: 1,
      min_open_interest: 50, max_exec_cost_pct: 30, respect_resistance: true,
    },
  },
  downtrend_rips: {
    label: 'Downtrend rips',
    tip: 'The highest-probability version: only names in a confirmed downtrend that just bounced into a declining average',
    filters: {
      universe: 'large_mid', include_stocks: true, include_index_etfs: false, include_sector_etfs: true,
      min_market_cap: 5e9, fund_min_aum: 500e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 30e6, lookback_days: 14,
      min_rally_sigma: 0.5, max_rally_sigma: 2.2,
      max_rel_strength_pct: 2, fund_max_rel_strength_pct: 1,
      require_rolled_over: true, require_below_sma50: true, require_downtrend: true,
      require_resistance_overhead: true,
      min_rsi: 35, max_rsi: 60, max_accel_pp: 2, max_run_off_low_pct: 18,
      max_pct_of_52w_range: 65,
      exclude_fresh_highs: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 5,
      target_dte: 35,
      short_delta: 0.28, long_delta: 0.10, delta_tolerance: 0.12,
      min_width_pct: 2, max_width_pct: 15,
      min_credit_pct_of_width: 24, min_cushion_pct: 3, min_otm_pct: 1,
      min_open_interest: 100, max_exec_cost_pct: 25, respect_resistance: true,
    },
  },
  aggressive: {
    label: 'Aggressive',
    tip: 'Wider universe including small caps, earlier rejections, and nearer strikes for a fatter credit',
    filters: {
      universe: 'large_mid_small', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      min_market_cap: 2e9, small_cap_min_market_cap: 2e9, fund_min_aum: 200e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 15e6, lookback_days: 21,
      min_rally_sigma: 0.2, max_rally_sigma: 3.0,
      max_rel_strength_pct: 6, fund_max_rel_strength_pct: 4,
      require_rolled_over: false, require_below_sma50: false, require_downtrend: false,
      require_resistance_overhead: false,
      min_rsi: 32, max_rsi: 72, max_accel_pp: 5, max_run_off_low_pct: 28,
      max_pct_of_52w_range: 96,
      exclude_fresh_highs: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 3,
      target_dte: 30,
      short_delta: 0.32, long_delta: 0.12, delta_tolerance: 0.15,
      min_width_pct: 1, max_width_pct: 20,
      min_credit_pct_of_width: 25, min_cushion_pct: 2, min_otm_pct: 0.5,
      min_open_interest: 25, max_exec_cost_pct: 40, respect_resistance: false,
    },
  },
}

const DEFAULT_FILTERS = {
  ...PRESETS.balanced.filters,
  small_cap_min_market_cap: 2e9,
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
// same convention as the rest of the options family. A strike converted to
// another currency would no longer name a real contract.
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
        ? `Partial score ${score}/100 — no option chain, so the credit and most of the safety points could not be scored`
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
  index: { label: 'Index', color: 'var(--teal)', tip: 'Broad index fund — no takeover risk, and the one underlying that cannot be squeezed' },
  sector: { label: 'Sector', color: 'var(--purple)', tip: 'Sector, commodity, or country fund — concentrated enough to trend, and no single-name gap risk' },
  narrow: { label: 'Fund', color: 'var(--amber)', tip: 'Narrow or thematic fund' },
  leveraged: { label: 'Leveraged', color: 'var(--neg-strong)', tip: 'Leveraged or inverse fund — gaps in ways a premium seller is not paid for' },
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
  'Making fresh 52-week highs': 'Fresh highs',
  'Momentum still accelerating': 'Accelerating',
  'Leading the market — do not sell its calls': 'Leader',
  'Overbought and still rising': 'OB & rising',
  'Sharp run off the recent low — squeeze risk': 'Squeeze risk',
  'Above a rising 50-day average': 'Rising 50d',
  'No overhead resistance identified': 'No ceiling',
  'Credit too small for the defined risk': 'Thin credit',
  'Credit below realized-vol fair value': 'Underpaid',
  'Implied vol cheap — poor time to sell premium': 'IV cheap',
  'Upside calls bid — someone is paying for the rally': 'Upside bid',
  'Dividend invites early assignment': 'Assignment risk',
  'Dividend is a large share of the credit': 'Div vs credit',
  'Two-leg slippage is high': 'Slippage',
  'Thin open interest on one leg': 'Thin OI',
  'Short strike is too close': 'Strike close',
  'No credit after crossing both markets': 'No net credit',
  'Short strike sits below resistance': 'Below the wall',
  'No pair met every spread filter': 'Filters relaxed',
  'Earnings before expiration': 'Earnings in trade',
  'Small underlying — takeover gap risk': 'Gap risk',
  'Thin share liquidity': 'Illiquid',
  'Leveraged or inverse fund': 'Leveraged',
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
    <div id="bear-call-spread-scanner-help" className="help-box" style={{
      marginBottom: '1rem', padding: '1rem', background: 'var(--surface-sunken)',
      border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.83rem',
      color: 'var(--text-muted)', lineHeight: 1.6,
    }}>
      <p style={{ margin: '0 0 0.85rem' }}>
        This screen looks for a <em>rally that has been refused</em> under overhead supply, then prices a specific
        bear call spread on each name &mdash; sell a lower-strike call, buy a higher-strike call, same expiration.
        The credit is your entire reward, the width minus the credit is your entire risk, and down, sideways, or up a
        little all win. Only a rally loses. The quick-start section is open; expand the others when you need the
        scoring math or a definition.
      </p>

      <HelpSection title="Why this is not the Covered Call Scanner without the shares" open>
        <p style={p}>
          The obvious screen &mdash; &ldquo;find the most overbought names, their call premium is fattest&rdquo; &mdash;
          is the Covered Call Scanner&rsquo;s setup, and that screen already warns that overbought alone is a trap. But
          here the failure is <em>categorically</em> worse. A covered call writer who gets run over delivers shares they
          already own: a capped gain, an opportunity cost, an annoyance. This trade owns nothing. A rally through the
          short strike is a realized cash loss up to the full width. The identical setup that merely disappoints a call
          writer genuinely loses money here &mdash; which is why accelerating momentum, fresh highs, market leadership,
          and a hard run off the recent low are all <em>excluded by default</em> rather than just flagged.
        </p>
        <p style={p}>
          The second temptation &mdash; &ldquo;sell calls on whatever just crashed, the implied vol is huge&rdquo;
          &mdash; fails twice over. The sharpest rallies in the market happen inside downtrends, and a short squeeze
          runs to the full width while your credit caps the gain at a nickel. And after a capitulation the <em>call</em>
          {' '}skew flattens or inverts &mdash; puts are bid, calls are cheap &mdash; so you are paid least exactly
          where the realized upside risk is highest. When a name is genuinely breaking down, the Bear Put Spread
          Scanner pays you for the move instead of capping you at a credit.
        </p>
        <p style={{ margin: 0 }}>
          So this screen asks for the awkward middle: a bounce that has <strong>stopped</strong>
          (<strong>Rejection</strong>), with a wall above it for the short strike to hide behind
          (<strong>Ceiling</strong>), a premium that actually pays for the defined risk (<strong>Credit</strong>), and
          two legs that can be filled and closed without giving the credit back (<strong>Safety</strong>). Rally size
          is scored as a <em>band</em>: roughly 0.75&ndash;2&sigma; earns full credit, and credit falls away above
          3&sigma;, because past that you are standing in front of a momentum thrust.
        </p>
      </HelpSection>

      <HelpSection title="How to use it">
        <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li><strong>Pick a preset.</strong> <em>Downtrend rips</em> is the highest-probability version: only names already in a confirmed downtrend that have just bounced into a declining average. Conservative adds a strike above the wall and a chain you can close out of.</li>
          <li><strong>Choose what else to scan</strong> with the Include checkboxes. They are independent, so an ETF-only scan finishes in seconds &mdash; and index funds are the one underlying here with no takeover risk and nothing to squeeze.</li>
          <li><strong>Run Scan.</strong> The first run downloads a year of history for everything selected. Re-running with different filters is much faster while that data stays cached, and the cache &mdash; including the call chains &mdash; is shared with the Covered Call Scanner.</li>
          <li><strong>Read the table top-down.</strong> It is ranked by score, and every candidate that got a live chain sorts above those that did not.</li>
          <li><strong>Click a row</strong> to expand the score breakdown, the full trade with both legs, and the exit plan. <strong>Click the ticker</strong> for its price chart.</li>
        </ol>
      </HelpSection>

      <HelpSection title="What the spread actually pays">
        <p style={p}>
          <strong>Credit</strong> is what you collect and the most you can make. <strong>Max loss</strong> is the width
          between the strikes minus that credit, and you only suffer it if the stock closes at or above the long strike.
          <strong> Breakeven</strong> is the short strike plus the credit &mdash; everything below it wins.
          <strong> Return on risk</strong> is the credit over the max loss; the annualized figure is shown for
          comparison between candidates, not as a forecast of anything.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Cushion</strong> is the distance from today&rsquo;s price up to the breakeven, expressed two ways: as
          a percentage, and as a multiple of the move this name would ordinarily make over the life of the trade. The
          second figure is the one that matters, because 6% is a quiet fortnight for a semiconductor and a long way for
          a utility. Two probabilities are shown and they deliberately disagree: <strong>P(OTM)</strong> comes off the
          short leg&rsquo;s delta, which is the conventional and slightly conservative reading, while
          <strong> Chance of max profit</strong> is the exact terminal probability. Delta always understates how often
          price finishes past a strike, so the gap between them is expected.
        </p>
      </HelpSection>

      <HelpSection title="The ceiling: where the short strike goes">
        <p style={p}>
          Unique to this screen. Rather than mechanically taking whatever strike the target delta lands on, the scanner
          identifies every <strong>overhead level</strong> above the current price &mdash; a flat or declining 20-, 50-,
          or 200-day average, the 20-day or 3-month swing high, the 52-week high &mdash; and prefers strike pairs whose
          short strike sits <em>above</em> the nearest one. Price then has to break something structural before the
          trade starts losing. It is the same idea as the Covered Call Scanner&rsquo;s cost-basis strike floor, applied
          to a technical level instead of a purchase price, and it relaxes the same way when no listed strike clears the
          level.
        </p>
        <p style={{ margin: 0 }}>
          A moving average only counts as resistance when it is flat or <em>falling</em>. A rising average that price
          has just slipped under is support about to be reclaimed, and treating it as a ceiling would put the short
          strike directly in the path of the next leg up &mdash; which is the Bull Put Spread Scanner&rsquo;s setup, not
          this one. That single slope check is what keeps the two credit screens from recommending the same trade in
          opposite directions.
        </p>
      </HelpSection>

      <HelpSection title="Credit versus fair value, and why IV/RV flips sign here">
        <p style={p}>
          <strong>Edge</strong> compares the credit you collect against what the vertical would be worth if the stock
          simply kept moving the way it has actually been moving &mdash; priced off its own <em>realized</em>
          volatility, with no assumed direction at all. A positive edge means the market is paying you more than the
          name&rsquo;s own movement justifies. One honest caveat: pricing a call spread with no drift makes it slightly
          cheaper than its real-world value, which flatters the seller, so the scoring ramp for edge starts at zero
          rather than below it to absorb the bias.
        </p>
        <p style={{ margin: 0 }}>
          <strong>IV/RV</strong> reads the <em>opposite</em> way here than on the Bear Put Spread Scanner. There you are
          the buyer, so implied vol above realized is a cost and it is coloured red. Here you are the seller, so rich
          implied vol is the whole point and it is coloured green. The volatility <em>wing</em> is the same story
          inverted: the bear put screen treats a steep put skew as a gift, because you sell the fatter vol. Here a steep
          upside wing is a <em>warning</em>, because it prices the exact move that costs you the width.
          <strong> Upside tail</strong> is the median implied vol of the far out-of-the-money calls measured against
          at-the-money; above about 1.05 the market is paying for a jump, which is the closest thing to a squeeze or
          takeover warning available from chain data alone.
        </p>
        <p style={p}>
          Three details there are forced by what the data actually looks like rather than by theory. It is measured
          against <em>at-the-money</em> rather than between your two legs, because sampled across live chains the
          leg-to-leg ratio straddles 1.0 with a median near 0.97 on single names &mdash; the equity call wing turns back
          <em> up</em> at far strikes instead of sloping down, so only broad index funds show the clean downward call skew
          the textbooks describe. It is measured off the <em>whole chain</em> rather than off the strike you buy, because
          the width window keeps that strike near the money and a narrow spread could otherwise never trip the warning.
          And it is a <em>median</em> with a minimum of five quoted strikes, because far strikes on thin chains carry
          stale marks &mdash; a maximum-based reading produced 2.4&times; at-the-money on a boring large cap.
        </p>
        <p style={{ margin: 0 }}>
          When fewer than five far strikes are genuinely quoted the figure reads <strong>&mdash;</strong> and nothing is
          charged for it, because a guess would be worse than silence. In practice that is a good share of names: the
          far-OTM end of a chain is often simply not traded. <strong>Call skew (legs)</strong> is still shown as the
          leg-to-leg ratio for context, but it is deliberately not scored.
        </p>
      </HelpSection>

      <HelpSection title="How the score is built (0–100)">
        <p style={p}>
          Four independent axes add to 100 points. Inputs between the thresholds below earn points on a straight-line
          ramp; values beyond a threshold receive that item&rsquo;s minimum or maximum. A letter grade follows:
          A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50, otherwise F. The bands are calibrated to match the other four
          option screens, so a C means the same thing on all five.
        </p>
        <Glossary items={[
          ['Rejection — 30', 'A band on the rally size earns 0–8, full credit from about 0.75σ to 2σ and nothing above 3σ. Structure is worth 7: the last week failing to take out the fortnight’s high (4), and this rally topping below the previous one (3). Momentum rolling over earns 7 — 2–18 points of RSI decline earns 0–4, plus a band on where RSI was two weeks ago for 0–3. Cooling momentum earns 0–4, and lagging the market earns 0–4. Then the penalties: fresh 52-week highs cost 10, acceleration up to 6, market leadership up to 6, a squeeze off the low up to 8, and overbought-and-still-rising costs 5. The axis floors at zero.'],
          ['Ceiling — 20', 'A band on the distance to the nearest overhead level earns 0–8, peaking when the wall is 0.5–6% above. A confirmed downtrend (50-day under the 200-day) earns 4. Sitting under a flat-or-falling 50-day earns 4. A band on position in the 52-week range gives the last 4, peaking mid-range — at the highs there is no wall left, at the lows there is squeeze fuel.'],
          ['Credit — 25', 'Needs a live chain. IV/RV from 0.95 to 1.45 earns 0–8, in the normal direction because you are the seller. Edge over realized-vol fair value from 0% to +35% earns 0–7. Annualized return on risk from 15% to 55% earns 0–6. Credit as a share of width from 15% to 35% earns 0–4.'],
          ['Safety — 25', 'Underlying size (3) and share liquidity (3) need no chain. The rest does: P(OTM) from 65% to 88% earns 0–5, breakeven cushion from 3% to 12% earns 0–4, two-leg slippage from 35% down to 8% of the credit earns 0–3, open interest on the thinner leg earns 0–2, a credit that survives crossing both markets earns 2, and a short strike above the wall earns 3. Then the deductions: earnings before expiry costs 8, a dividend that invites early assignment costs 6 (3 if merely elevated), and an upside wing above 1.05 costs up to 4.'],
        ]} />
        <p style={{ margin: '0.7rem 0 0' }}>
          A grade shown with an asterisk and a dashed outline (for example <strong>B* 72</strong>) had no option chain
          available or was not reached by the live-pricing limit. It is rescaled from the 56 points that could still be
          scored and appears only under <strong>Watchlist Candidates</strong>, because the spread pricing is unknown.
        </p>
      </HelpSection>

      <HelpSection title="The two risks only a short call faces">
        <p style={p}>
          <strong>Early assignment for a dividend.</strong> A call holder exercises early only to capture a dividend,
          and only once the option&rsquo;s remaining extrinsic value is worth less than that dividend &mdash; which
          happens the day before the ex-date. In a covered call that just means delivering shares you already own. In a
          spread it leaves you <em>short 100 shares you never owned</em>, holding a long call, and owing the dividend.
          So the exposure is measured as the dividend against the credit collected, not against today&rsquo;s
          moneyness, and when it is material the exit plan sets a hard <strong>close-before</strong> date rather than
          leaving you to react afterwards. That is the one risk on this screen with an exact calendar answer.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Earnings inside the trade.</strong> A report can gap the stock straight through the short strike
          overnight, and the pre-announcement implied vol is precisely what made the credit look generous. The scanner
          prefers an expiration that closes before the report; with the earnings skip enabled, a stock whose report
          falls inside Target DTE plus the buffer is removed entirely rather than being given a very short expiration
          instead. A third gap risk has no technical signal at all &mdash; a takeover bid &mdash; which is why the
          small-cap floor here is higher than on the Bear Put Spread Scanner and why <em>Gap risk</em> names the
          warning that way.
        </p>
      </HelpSection>

      <HelpSection title="Why two legs change the liquidity maths">
        <p style={{ margin: 0 }}>
          A covered call or a cash-secured put crosses one bid/ask spread. A vertical crosses two, and both come out of
          the credit. <strong>Slippage</strong> adds the width of both quotes and shows it as a share of what you
          collect: at 8% it is noise, at 30% it has quietly turned a decent return on risk into a poor one.
          <strong> Natural credit</strong> is what the spread pays if both legs fill at the wrong side of their quotes
          &mdash; when that is zero or negative the trade does not exist at any realistic fill. The scanner only
          considers strikes where <em>both</em> sides of the market are live and uncrossed, and it scores open interest
          on the thinner leg, since closing the position needs both.
        </p>
      </HelpSection>

      <HelpSection title="Managing the trade">
        <p style={p}>
          <strong>Buy back at</strong> is the debit to close for, set as a share of the credit collected. Strong setups
          target 65%, balanced 60%, and anything carrying a warning 50%. Holding a short vertical to expiry trades the
          last few percent of the credit for pin risk on the short strike, which is a poor exchange.
          <strong> Stop at</strong> is roughly twice the credit &mdash; the conventional risk trigger on a short
          vertical, capped just inside the width because beyond that the spread cannot trade.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Reassess by</strong> is a DTE checkpoint, and <strong>Close before</strong> appears only when an
          ex-dividend date inside the expiration makes early assignment live. <strong>Invalidate above</strong> is the
          level that kills the reason for the trade: a close back above the overhead level the short strike was placed
          behind. That level is reached long before the defined loss is, which is the entire point of watching it.
          Recalculate everything from your actual fill; the figures exclude commissions and cannot guarantee a winning
          trade.
        </p>
      </HelpSection>

      <HelpSection title="If you already own the shares">
        <p style={{ margin: 0 }}>
          <strong>Shares</strong> shows any position you hold in the name and how many contracts it would cover, one per
          100 shares. That changes what this trade <em>is</em>: with 100 shares behind it, the short leg is covered, so
          assignment delivers stock you already hold rather than opening a short position, and the long call simply caps
          the tail. It becomes a covered call with the upside disaster hedged &mdash; a materially safer position than
          the same two legs with no shares behind them. The screen says so on the row rather than leaving you to
          notice.
        </p>
      </HelpSection>

      <HelpSection title="Column glossary">
        <Glossary items={[
          ['Type', 'Stock, a broad Index fund, or a Sector/commodity fund.'],
          ['Score', 'The 0–100 composite and its letter grade. An asterisk means no option chain was available.'],
          ['Shares', 'Shares you hold and how many contracts that would cover, making the short leg covered.'],
          ['Setup', 'Which parts of the rejection are present: rolled over off the 20-day high, a lower high, and a confirmed downtrend.'],
          ['Move', 'The change over the lookback window, and how many standard deviations of this name’s own normal movement that represents.'],
          ['vs Market', 'Beta-adjusted performance against the market. Negative is what this screen wants — positive means leadership, coloured red.'],
          ['RSI', 'Wilder’s 14-day relative strength, and the change over the last two weeks. Falling from an elevated level is the signal; a high flat reading is a trend.'],
          ['Ceiling', 'The nearest overhead level and how far above the current price it sits.'],
          ['IV/RV', 'Implied over realized volatility. Above 1.0 means options are expensive, which on this screen is the point — so it is coloured green, the reverse of the Bear Put Spread Scanner.'],
          ['Sell This Spread', 'The suggested vertical: short strike / long strike, expiration, and the credit per share.'],
          ['Credit / Risk', 'Dollars collected per contract and dollars at risk, with return on risk.'],
          ['Cushion', 'Distance up to the breakeven, as a percentage and as a multiple of the expected move over the life of the trade.'],
          ['Edge', 'The credit against realized-volatility fair value. Positive means you are being paid more than this name’s movement justifies.'],
          ['Exit', 'The suggested debit to buy the spread back for, and what share of the credit that keeps.'],
          ['Warnings', 'Short chips; hover any of them, or expand the row, for the full wording.'],
        ]} />
      </HelpSection>

      <HelpSection title="Warnings">
        <Glossary items={[
          ['Fresh highs', 'Already printing new 52-week highs — no wall left above, and the clearest statement that nothing has been rejected.'],
          ['Accelerating', 'The last five sessions gained more than the five before. The rally has not stopped, which is the one thing this trade needs.'],
          ['Leader', 'Outrunning the beta-adjusted market. Never sell calls against the market’s leader.'],
          ['Squeeze risk', 'A hard run off the recent low. A squeeze runs to the full width while the credit caps you at a nickel.'],
          ['OB & rising', 'RSI at 70 or above and still climbing. Overbought alone is not the trap — overbought and rising is.'],
          ['Rising 50d', 'Price is above a rising 50-day average, which is support rather than resistance.'],
          ['No ceiling', 'No overhead level was identified, so there is nothing between the price and the short strike but hope.'],
          ['Thin credit', 'The credit is under 20% of the width — too little for the risk taken.'],
          ['Underpaid', 'The credit is below what this name’s own realized volatility justifies.'],
          ['IV cheap', 'Implied vol is below realized. A poor time to be selling premium at all.'],
          ['Upside bid', 'The far out-of-the-money calls carry over 5% more implied vol than at-the-money. The market is pricing a jump upward — someone is paying up for the rally you are short.'],
          ['Assignment risk', 'A dividend inside this expiration is large against the credit, so early exercise is live. Check the close-before date.'],
          ['Div vs credit', 'The dividend is over half the credit collected — elevated but not yet acute.'],
          ['Below the wall', 'The short strike sits below the nearest overhead level, so price does not have to break anything to reach it.'],
          ['No net credit', 'Crossing both markets leaves no credit at all. The trade does not exist at a realistic fill.'],
          ['Slippage', 'Crossing both bid/ask spreads costs more than 30% of the credit.'],
          ['Thin OI', 'Low open interest on one leg — hard to get filled, or to close.'],
          ['Strike close', 'Modeled odds of staying below the short strike are under 65%.'],
          ['Filters relaxed', 'No strike pair met every credit, cushion, liquidity, and execution filter. The best available pair is retained in Watchlist Candidates for research, not shown as an actionable trade.'],
          ['Earnings in trade', 'A report conflicts with the requested trade horizon. With the earnings skip enabled, the ticker is excluded.'],
          ['Gap risk', 'A small underlying, where a takeover bid can gap straight through any call strike with no warning.'],
          ['No chain', 'No option chain came back, so the Credit axis could not be scored.'],
          ['Not priced', 'The name passed the directional screen but ranked outside the current live-chain pricing limit.'],
          ['Illiquid', 'Thin average dollar volume in the shares themselves.'],
          ['Leveraged', 'A leveraged or inverse fund; these gap in ways a premium seller is not paid for.'],
        ]} />
      </HelpSection>

      <p style={{ margin: '0.85rem 0 0', color: 'var(--warning-text)' }}>
        Scores rate the setup from public market data. They are not advice. A bear call spread has a defined maximum
        loss that is several times the credit collected, so size the position from the max loss and never from the
        premium. Short calls can be assigned before expiration, and pin risk rises near expiry, so monitoring and an
        early closing plan are part of the setup rather than an afterthought.
      </p>
    </div>
  )
}

function DetailRow({ row, colSpan, onShowChart }) {
  const s = row.spread
  const plan = s?.management
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
          <RiskGraphButton kind="bear-call-spread" row={row} source="Bear Call Spread Scanner" />
        </div>
        <div style={{ maxWidth: '1100px', fontSize: '0.88rem', color: 'var(--text-strong)', marginBottom: '0.8rem' }}>
          {row.verdict}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: '1.5rem', alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              Score breakdown
            </div>
            <ScoreBar label="Rejection" value={row.components.rejection} max={row.component_max.rejection}
              tip="Has the rally actually been refused — rolled over, momentum cooling, not leading the market — or is it still running?" />
            <ScoreBar label="Ceiling" value={row.components.ceiling} max={row.component_max.ceiling}
              tip="Overhead supply for the short strike to hide behind: a nearby wall, a downtrend, a falling 50-day, mid-range position" />
            <ScoreBar label="Credit" value={row.components.credit} max={row.component_max.credit}
              tip="Does the premium pay for the defined risk: rich implied vol, edge over realized-vol fair value, return on risk, credit against width" />
            <ScoreBar label="Safety" value={row.components.safety} max={row.component_max.safety}
              tip="Two-leg execution and liquidity, plus the short-call risks: earnings, dividend early assignment, and a fat upside wing" />
            {row.scored_on_partial && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                No option chain available — scored on the 56 points that did not need one.
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              {s ? 'Suggested bear call spread' : 'Option chain unavailable'}
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
                  Sell {row.ticker} {s.expiration} ${s.short_strike} call / buy ${s.long_strike} call
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Collect about {usd(s.credit_dollars, 0)} per contract on a {usd(s.width)}-wide spread. That
                  {' '}{usd(s.credit_dollars, 0)} is the entire reward; the most it can lose is
                  {' '}{usd(s.max_loss_dollars, 0)} &mdash; a {pct(s.return_on_risk_pct, 0)} return on risk over
                  {' '}{s.dte} days.
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Everything below {usd(s.breakeven)} wins ({pct(s.breakeven_cushion_pct)} above today&rsquo;s
                  {' '}{usd(row.price)}, or {sigma(s.breakeven_sigma, 2)} of this name&rsquo;s expected
                  {' '}{pct(s.expected_move_pct_life)} move), and the full credit is kept at or below
                  {' '}{usd(s.short_strike)}.
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                  The naked ${s.short_strike} call alone would collect {usd(s.naked_credit)} per share; the
                  ${s.long_strike} call costs {usd(s.tail_hedge_cost)} of that ({pct(s.tail_hedge_pct_of_credit, 0)})
                  and is what turns an unlimited risk into {usd(s.max_loss_dollars, 0)}.
                </div>
                <div style={{
                  fontSize: '0.78rem', marginTop: '0.35rem',
                  color: (s.premium_edge_pct ?? 0) >= 0 ? 'var(--pos-strong)' : 'var(--neg-strong)',
                }}>
                  {(s.premium_edge_pct ?? 0) >= 0 ? '✓ ' : '⚠ '}
                  Realized-vol fair value is {usd(s.fair_credit)} against a {usd(s.credit)} credit &mdash;
                  {' '}{(s.premium_edge_pct ?? 0) >= 0 ? 'more' : 'less'} than this name&rsquo;s own movement
                  justifies by {pct(Math.abs(s.premium_edge_pct ?? 0), 0)}.
                </div>
                {s.resistance != null && (
                  <div style={{
                    fontSize: '0.78rem', marginTop: '0.25rem',
                    color: s.clears_resistance ? 'var(--pos-strong)' : 'var(--warning-text)',
                  }}>
                    {s.clears_resistance
                      ? `✓ The $${s.short_strike} strike sits ${pct(s.resistance_gap_pct)} above the ${s.resistance_label} at ${usd(s.resistance)} — price has to break that level before this trade starts losing.`
                      : `⚠ The $${s.short_strike} strike is ${pct(Math.abs(s.resistance_gap_pct ?? 0))} below the ${s.resistance_label} at ${usd(s.resistance)}, so no structural level has to give way for price to reach it.`}
                    {s.resistance_floor_binding && s.clears_resistance
                      ? ' The strike was chosen to clear it rather than purely on delta.'
                      : ''}
                  </div>
                )}
                {s.constraints_relaxed && (
                  <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', color: 'var(--warning-text)' }}>
                    ⚠ No pair in this expiration met your credit, cushion, liquidity and execution filters, so the
                    best available pair of {s.pairs_considered} considered is shown instead.
                  </div>
                )}
                {s.ex_dividend_inside && (
                  <div style={{
                    fontSize: '0.78rem', marginTop: '0.25rem',
                    color: ['high', 'elevated'].includes(s.early_assignment?.level) ? 'var(--neg-strong)' : 'var(--text-dim)',
                  }}>
                    {['high', 'elevated'].includes(s.early_assignment?.level)
                      ? `⚠ An ex-dividend date of ${s.ex_dividend_date}${s.ex_dividend_estimated ? ' (estimated)' : ''} falls inside this expiration, and the ${usd(s.dividend_amount)} dividend is ${pct(s.early_assignment?.dividend_vs_premium_pct, 0)} of the credit. Early exercise the day before would leave you short 100 shares plus a long call, owing the dividend.`
                      : `An ex-dividend date of ${s.ex_dividend_date}${s.ex_dividend_estimated ? ' (estimated)' : ''} falls inside this expiration, but the ${usd(s.dividend_amount)} dividend is small against the credit, so early exercise is unlikely.`}
                  </div>
                )}
                {s.earnings_date && (
                  <div style={{
                    fontSize: '0.78rem', marginTop: '0.25rem',
                    color: s.avoids_earnings ? 'var(--pos-strong)' : 'var(--neg-strong)',
                  }}>
                    {s.avoids_earnings
                      ? `✓ Expires ${s.days_earnings_after_expiry}d before earnings on ${s.earnings_date} — the report lands after you are out.`
                      : `⚠ Earnings on ${s.earnings_date} fall inside this trade. No listed expiration clears it, and a gap up runs straight to the width overnight.`}
                  </div>
                )}
                {row.covered_contracts > 0 && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--teal)', marginTop: '0.25rem' }}>
                    You hold {shares(row.shares_held)} shares &mdash; the short leg would be <strong>covered</strong> on
                    up to {row.covered_contracts}{' '}
                    {row.covered_contracts === 1 ? 'contract' : 'contracts'}. Assignment would deliver stock you already
                    own rather than opening a short position, which makes this a covered call with the upside tail
                    hedged.
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
                        ['Sell', s.short_leg, 'var(--amber)'],
                        ['Buy', s.long_leg, 'var(--accent-bright)'],
                      ].map(([action, leg, color]) => (
                        <tr key={action}>
                          <td style={{ color, fontWeight: 600 }}>{action} call</td>
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
                  Net credit at the mids is {usd(s.credit)}; taking the bid on the short leg and paying the ask on the
                  long leg leaves {usd(s.natural_credit)}. Crossing both quotes costs {usd(s.exec_cost)}, or
                  {' '}{pct(s.exec_cost_pct, 0)} of the credit &mdash; work the order as one vertical limit rather
                  than giving that up.
                </div>
              </div>
            )}

            {s && (
              <OptionProbabilityCards
                schedule={s.probability_schedule}
                successHeadline="The complete bear call spread has positive modeled P/L"
                failureHeadline="The complete bear call spread has negative modeled P/L"
              />
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
                  Exit plan &middot; {plan.profile}
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 750, color: 'var(--text-strong)', margin: '0.18rem 0' }}>
                  Buy back near {usd(plan.target_debit)} &middot; stop at {usd(plan.stop_debit)}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Closing the spread at {usd(plan.target_debit)} keeps about
                  {' '}{usd(plan.target_profit_dollars, 0)} of the {usd(s.credit_dollars, 0)} credit
                  ({pct(plan.profit_capture_pct, 0)}). The stop gives back {usd(plan.stop_loss_dollars, 0)} rather than
                  the full {usd(s.max_loss_dollars, 0)} at risk. If neither has triggered, reassess by
                  {' '}{plan.reassess_dte} DTE and close by {plan.close_by_dte} DTE regardless &mdash; the last few
                  percent of the credit is not worth pin risk on the short strike.
                </div>
                {plan.close_before && (
                  <div style={{
                    fontSize: '0.8rem', marginTop: '0.35rem', fontWeight: 600,
                    color: 'var(--neg-strong)',
                  }}>
                    ⚠ Close before {plan.close_before}. {plan.close_before_note}
                  </div>
                )}
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
                {cell('Credit', `${usd(s.credit)} (${pct(s.credit_pct_of_width, 0)} of width)`)}
                {cell('Natural credit', usd(s.natural_credit))}
                {cell('Max profit', usd(s.max_profit_dollars, 0))}
                {cell('Max loss', usd(s.max_loss_dollars, 0))}
                {cell('Return on risk', pct(s.return_on_risk_pct, 0))}
                {cell('Annualized', pct(s.annualized_return_on_risk_pct, 0))}
                {cell('Breakeven', usd(s.breakeven))}
                {cell('Short strike OTM', pct(s.short_otm_pct))}
                {cell('P(OTM) from delta', pct(s.prob_otm, 0))}
                {cell('Chance of profit', pct(s.prob_profit, 0))}
                {cell('Chance of max profit', pct(s.prob_max_profit, 0))}
                {cell('Fair credit', usd(s.fair_credit))}
                {cell('Edge', pct(s.premium_edge_pct, 0))}
                {cell('Upside tail', num(s.upside_tail_ratio, 2))}
                {cell('Call skew (legs)', num(s.call_skew_ratio, 2))}
                {cell('IV / realized vol', num(row.iv_rv_ratio))}
                {cell('Slippage', `${usd(s.exec_cost)} (${pct(s.exec_cost_pct, 0)})`)}
                {cell('Open interest (min leg)', s.open_interest_min ?? '—')}
                {cell('Assignment risk', s.early_assignment?.level ?? '—')}
              </div>
            )}

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              The rejection
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
              {cell('Move in window', pct(row.window_pct))}
              {cell('Normal move', `±${pct(row.expected_move_pct)}`)}
              {cell('Rally size', sigma(row.rally_sigma))}
              {cell('vs market', pct(row.rel_strength_pct))}
              {cell('Beta', num(row.beta))}
              {cell('Nearest ceiling', row.resistance_label
                ? `${row.resistance_label} (${pct(row.resistance_gap_pct)})`
                : 'none identified')}
              {cell('From 52-wk high', pct(row.drawdown_pct))}
              {cell('% of 52-wk range', pct(row.pct_of_52w_range, 0))}
              {cell('52-wk range', `${usd(row.week52_low)} – ${usd(row.week52_high)}`)}
              {cell('RSI (2-wk change)', `${num(row.rsi_14, 0)} (${row.rsi_roll_pp > 0 ? '+' : ''}${num(row.rsi_roll_pp, 1)})`)}
              {cell('RSI 2 weeks ago', num(row.rsi_prior, 0))}
              {cell('Off its 20-day high', pct(row.pullback_from_high_pct))}
              {cell('Sessions since that high', row.days_since_swing_high ?? '—')}
              {cell('Run off 20-day low', pct(row.run_off_low_pct))}
              {cell('5d vs prior 5d', `${num(row.accel_pp, 1)} pp`)}
              {cell('50-day slope (10d)', pct(row.sma50_slope_pct, 2))}
              {cell('vs 50-day', pct(row.above_sma50_pct))}
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
              {cell('Contracts covered', row.covered_contracts || '—')}
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
  { key: 'covered_contracts', label: 'Shares', align: 'right', tip: 'Shares you hold, and how many contracts that would cover — a covered short leg cannot leave you short stock' },
  { key: 'setup', label: 'Setup', align: 'center', tip: 'Which parts of the rejection are present: rolled over off the 20-day high, a lower high, and a confirmed downtrend' },
  { key: 'window_pct', label: 'Move', align: 'right', tip: 'The change over the lookback window, and how many standard deviations of this name’s own normal movement that is' },
  { key: 'rel_strength_pct', label: 'vs Market', align: 'right', tip: 'Beta-adjusted performance against the market. Negative is what this screen wants — positive means leadership, which is the one profile never to sell calls against.' },
  { key: 'rsi_14', label: 'RSI', align: 'right', tip: 'Wilder’s 14-day relative strength, and its change over the last two weeks. Falling from an elevated level is the signal.' },
  { key: 'resistance_gap_pct', label: 'Ceiling', align: 'right', tip: 'The nearest overhead level and how far above the current price it sits' },
  { key: 'iv_rv_ratio', label: 'IV/RV', align: 'right', tip: 'Implied over realized vol. Above 1.0 means options are expensive — which on this screen is the point, since you are the seller.' },
  { key: 'spread_strikes', label: 'Sell This Spread', align: 'center', tip: 'The suggested vertical: short strike / long strike and expiration' },
  { key: 'dte', label: 'DTE', align: 'right', tip: 'Days to expiration for the suggested option chain' },
  { key: 'spread_credit', label: 'Credit / Risk', align: 'right', tip: 'Dollars collected per contract and dollars at risk, with return on risk' },
  { key: 'spread_cushion', label: 'Cushion', align: 'right', tip: 'Distance up to the breakeven, in percent and in expected moves' },
  { key: 'spread_edge', label: 'Edge', align: 'right', tip: 'The credit against realized-volatility fair value. Positive means you are paid more than this name’s movement justifies.' },
  { key: 'spread_exit', label: 'Exit', align: 'right', tip: 'Suggested debit to buy the spread back for, and the share of the credit that keeps' },
  { key: 'flags', label: 'Warnings', align: 'left' },
]

const SORT_ACCESSORS = {
  spread_strikes: r => r.spread?.short_strike ?? null,
  dte: r => r.spread?.dte ?? null,
  spread_credit: r => r.spread?.return_on_risk_pct ?? null,
  spread_cushion: r => r.spread?.breakeven_sigma ?? null,
  spread_edge: r => r.spread?.premium_edge_pct ?? null,
  spread_exit: r => r.spread?.management?.target_debit ?? null,
  setup: r => (r.rolled_over ? 1 : 0) + (r.lower_high ? 2 : 0) + (r.sma50_below_sma200 ? 4 : 0),
  flags: r => (r.flags?.length ?? 0),
  kind: r => (r.is_fund ? (r.fund_kind || 'fund') : 'stock'),
}

/** Three chips for the rejection structure. Filled = present. */
function SetupDots({ row }) {
  const items = [
    ['RO', row.rolled_over, 'Rolled over — the last week failed to take out the 20-day high'],
    ['LH', row.lower_high, 'Lower high — this rally topped out below the previous one'],
    ['DT', row.sma50_below_sma200, 'Downtrend — the 50-day average is below the 200-day'],
  ]
  return (
    <span style={{ display: 'inline-flex', gap: '0.2rem' }}>
      {items.map(([label, on, tip]) => (
        <span key={label} title={`${tip}${on ? '' : ' — not present'}`} style={{
          fontSize: '0.62rem', fontWeight: 700, lineHeight: 1,
          padding: '0.15rem 0.22rem', borderRadius: '3px', minWidth: '1.4rem',
          textAlign: 'center',
          color: on ? 'var(--pos-strong)' : 'var(--text-dim)',
          border: `1px solid ${on ? 'var(--pos-strong)' : 'var(--border)'}`,
          background: on ? 'var(--surface-inset)' : 'transparent',
          opacity: on ? 1 : 0.45,
        }}>{label}</span>
      ))}
    </span>
  )
}

export default function BearCallSpreadScanner() {
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
  const [cachedScan, saveScan] = useScanCache('bear-call-spread')
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
    pf('/api/options/bear-call-spread-scan/universes')
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
    pf('/api/options/bear-call-spread-scan', {
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
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Bear Call Spread Scanner</h1>
        <button
          type="button"
          className="btn btn-xs btn-outline"
          aria-expanded={showHelp}
          aria-controls="bear-call-spread-scanner-help"
          onClick={() => setShowHelp(h => !h)}
        >
          {showHelp ? 'Hide Help' : 'How this works'}
        </button>
      </div>
      <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        Finds rallies that have been <em>refused</em> under overhead supply, then prices a defined-risk call credit
        spread on each. Whatever is most overbought is the wrong answer &mdash; that is the Covered Call
        Scanner&rsquo;s setup, and without the shares behind it a rally through the strike is a cash loss rather than
        a capped gain.
      </p>
      <ScannerRiskNotice />

      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="bear-call-spread" />

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
          ['include_index_etfs', 'Index ETFs', 'SPY, QQQ, IWM, DIA, style and rates funds — no takeover risk and nothing to squeeze'],
          ['include_sector_etfs', 'Sector & commodity ETFs', 'XLK, XLE, GLD, SMH, KRE and the rest of the sector complex — concentrated enough to trend, with no single-name gap risk'],
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

        {/* The rally band. Both ends matter: a floor so there was something to
            reject, a ceiling so it is not a thrust still in progress. */}
        {numField('Min rally', 'min_rally_sigma', { step: 0.1, suffix: 'σ', width: 60, tip: 'Minimum bounce over the window, in standard deviations of this name’s own normal movement. Below this nothing has been rejected.' })}
        {numField('Max rally', 'max_rally_sigma', { step: 0.1, suffix: 'σ', width: 60, tip: 'Ceiling on the bounce. Above this it is a momentum thrust, not a rejected rally — this is the gate that stops the screen from fading strength.' })}
        {numField('Max vs market', 'max_rel_strength_pct', { step: 0.5, suffix: 'pp', width: 60, tip: 'Stocks: a MAXIMUM, not a minimum. How far it may outperform the beta-adjusted market before it counts as a leader — and you never sell calls against the market’s leader.' })}
        {anyFunds && numField('ETF max vs market', 'fund_max_rel_strength_pct', { step: 0.5, suffix: 'pp', width: 60, tip: 'ETFs track the benchmark by construction, so they need their own ceiling — usually tighter than the stock one' })}
        {numField('Min RSI', 'min_rsi', { width: 60, tip: 'Floor: below this the name is already broken and you are selling calls into a name the Bear Put Spread Scanner would buy puts on' })}
        {numField('Max RSI', 'max_rsi', { width: 60, tip: 'Ceiling: above this the name is trending, not rolling over' })}
        {numField('Max acceleration', 'max_accel_pp', { step: 0.5, suffix: 'pp', width: 60, tip: 'Reject names whose last 5 sessions gained this much more than the prior 5. Accelerating momentum is the one condition that loses the whole width.' })}
        {numField('Max run off low', 'max_run_off_low_pct', { suffix: '%', width: 60, tip: 'Reject names already up this much from their 20-day low — that is the shape of a short squeeze, and a squeeze runs to the full width' })}
        {numField('Max % of range', 'max_pct_of_52w_range', { suffix: '%', width: 60, tip: 'Skip names this far up their 52-week range — near the highs there is no overhead supply left' })}

        {filters.include_stocks && numField('Min mkt cap', 'min_market_cap', { scale: 1e9, suffix: 'B', width: 60, tip: 'Funds are sized by AUM, and small caps get their own floor' })}
        {anySmallCaps && numField('Small-cap min cap', 'small_cap_min_market_cap', { scale: 1e9, suffix: 'B', width: 60, tip: 'Higher than on the Bear Put Spread Scanner — not for liquidity, but because a takeover bid gaps a short call straight through any strike, and those land on small companies' })}
        {anyFunds && numField('ETF min AUM', 'fund_min_aum', { scale: 1e6, suffix: 'M', width: 60, tip: 'Funds report assets under management rather than a market cap' })}
        {numField('Min $ volume', 'min_avg_dollar_volume', { scale: 1e6, suffix: 'M', width: 60, tip: 'Average daily dollar volume. Two legs to cross means liquidity matters more than on the single-leg screens.' })}
        {numField('Lookback', 'lookback_days', { width: 60, suffix: 'd', tip: 'Trading days in the rally window' })}

        {numField('Target DTE', 'target_dte', { min: 1, width: 60, tip: 'Preferred days to expiration. Shorter than the debit screens want: a seller is paid by time, and 30–45 days is where theta is worth the gamma. Buying more time as a seller just means more chances to be wrong.' })}
        {numField('Short delta', 'short_delta', { step: 0.05, width: 60, tip: 'Places the call you sell. Lower is further out of the money: safer, but a thinner credit.' })}
        {numField('Long delta', 'long_delta', { step: 0.05, width: 60, tip: 'Places the call you buy to cap the tail. Lower widens the spread: more credit, but more at risk.' })}
        {numField('Min strike OTM', 'min_otm_pct', { step: 0.5, suffix: '%', width: 60, tip: 'Minimum distance of the short strike above the current price, so a normal week does not put it in play immediately' })}
        {numField('Min credit', 'min_credit_pct_of_width', { suffix: '% of width', width: 60, tip: 'Minimum credit as a share of the width. Below about 20% you are not paid enough for the defined risk.' })}
        {numField('Min cushion', 'min_cushion_pct', { step: 0.5, suffix: '%', width: 60, tip: 'Minimum distance from today’s price up to the breakeven' })}
        {numField('Min open interest', 'min_open_interest', { width: 60, tip: 'Minimum open interest on the thinner leg — closing the spread needs both' })}
        {numField('Max slippage', 'max_exec_cost_pct', { suffix: '% of credit', width: 60, tip: 'Reject pairs where crossing both bid/ask spreads costs more than this share of the credit' })}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {checkField('Require a rolled-over high', 'require_rolled_over', 'The minimum definition of a refused rally: the last week failed to take out the 20-day high')}
          {checkField('Require resistance overhead', 'require_resistance_overhead', 'Skip names with no identifiable overhead level — nothing has to break for price to reach your strike')}
          {checkField('Place the strike above resistance', 'respect_resistance', 'Prefer strike pairs whose short strike clears the nearest overhead level, rather than taking whatever the target delta lands on')}
          {checkField('Require price below the 50-day', 'require_below_sma50', 'Sell rips from below a broken 50-day rather than pullbacks inside an uptrend')}
          {checkField('Require 50-day below 200-day', 'require_downtrend', 'A confirmed downtrend — the highest-probability home for this trade. Far fewer candidates.')}
          {checkField('Skip fresh 52-wk highs', 'exclude_fresh_highs', 'Exclude names printing new highs — no wall left above, and the clearest sign nothing was rejected')}
          {filters.include_stocks && checkField('Skip earnings inside trade', 'exclude_earnings_before_expiry', 'Exclude stocks whose next report falls within Target DTE plus the safety buffer; never substitute a very short expiration')}
          {anyFunds && checkField('Skip leveraged / inverse ETFs', 'exclude_leveraged_funds', 'Leveraged and inverse funds gap in ways a premium seller is not paid for')}
        </div>

        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading || nothingSelected}>
          {loading ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
          Pulling a year of history for the universe, then live call chains for the finalists and every plausible
          strike pair in each. The first run takes about 20&ndash;40 seconds; re-running with different filters is
          much faster while the data is cached (and the price and chain caches are shared with the Covered Call
          Scanner).
        </p>
      )}

      {stats && !loading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.6rem' }}>
          Scanned <strong style={{ color: 'var(--text-muted)' }}>{stats.priced}</strong> of {stats.universe} tickers
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_price}</strong> rallies rejected
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_fundamentals}</strong> passed size &amp; liquidity
          {' → '}<strong style={{ color: 'var(--pos-strong)' }}>{stats.actionable ?? stats.final}</strong> actionable
          {stats.watchlist ? ` · ${stats.watchlist} watchlist` : ''}
          {stats.chains_fetched ? ` · ${stats.chains_fetched} live spreads found` : ''}
          {stats.resistance_bound ? ` · ${stats.resistance_bound} strikes placed above resistance` : ''}
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
            Live quotes that meet every selected credit, cushion, liquidity and execution limit
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
                        {r.covered_contracts > 0 ? (
                          <>
                            <div style={{ fontWeight: 600, color: 'var(--teal)' }}
                                 title="The short leg would be covered on this many contracts, so assignment delivers stock you own instead of opening a short">
                              {r.covered_contracts}&times; covered
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {shares(r.shares_held)} sh
                            </div>
                          </>
                        ) : r.shares_held ? (
                          <span title="Fewer than 100 shares, so the short leg would not be fully covered"
                                style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            {shares(r.shares_held)} sh
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}><SetupDots row={r} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ color: (r.window_pct ?? 0) > 0 ? 'var(--pos)' : 'var(--text)' }}>
                          {pct(r.window_pct)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                          {sigma(r.rally_sigma)}
                        </div>
                      </td>
                      {/* Reverse of every other screen: outperformance is the
                          warning here, not the signal. */}
                      <td style={{ textAlign: 'right', color: (r.rel_strength_pct ?? 0) > 0 ? 'var(--neg-strong)' : 'var(--text-muted)' }}>
                        {pct(r.rel_strength_pct)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div>{num(r.rsi_14, 0)}</div>
                        <div style={{
                          fontSize: '0.68rem', whiteSpace: 'nowrap',
                          color: (r.rsi_roll_pp ?? 0) < 0 ? 'var(--pos)' : 'var(--text-dim)',
                        }}>
                          {r.rsi_roll_pp == null ? '—' : `${r.rsi_roll_pp > 0 ? '+' : ''}${num(r.rsi_roll_pp, 0)}`}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.resistance_gap_pct != null ? (
                          <>
                            <div>{pct(r.resistance_gap_pct)}</div>
                            <div style={{ fontSize: '0.66rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {r.resistance_label}
                            </div>
                          </>
                        ) : (
                          <span title="No overhead level identified" style={{ color: 'var(--warning-text)', fontSize: '0.7rem' }}>
                            none
                          </span>
                        )}
                      </td>
                      {/* Reverse of the Bear Put Spread Scanner: rich IV is the
                          point here, because this screen sells it. */}
                      <td style={{ textAlign: 'right', color: (r.iv_rv_ratio ?? 0) > 1.15 ? 'var(--pos-strong)' : 'var(--text-muted)' }}>
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
                              ${s.short_strike} / ${s.long_strike} C
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              exp {s.expiration}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {usd(s.credit)} credit · {pct(s.credit_pct_of_width, 0)} of width
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
                              <span style={{ color: 'var(--pos-strong)' }}>{usd(s.credit_dollars, 0)}</span>
                              {' / '}
                              <span style={{ color: 'var(--neg-strong)' }}>{usd(s.max_loss_dollars, 0)}</span>
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {pct(s.return_on_risk_pct, 0)} on risk
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {s ? (
                          <>
                            <div>{pct(s.breakeven_cushion_pct, 1)}</div>
                            <div style={{
                              fontSize: '0.68rem', whiteSpace: 'nowrap',
                              color: (s.breakeven_sigma ?? 0) < 0.5 ? 'var(--neg-strong)' : 'var(--text-dim)',
                            }}>
                              {sigma(s.breakeven_sigma, 2)}
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{
                        textAlign: 'right', fontWeight: 600,
                        color: (s?.premium_edge_pct ?? 0) >= 0 ? 'var(--pos-strong)' : 'var(--neg-strong)',
                      }}>
                        {s ? pct(s.premium_edge_pct, 0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {s?.management ? (
                          <>
                            <div style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>
                              {usd(s.management.target_debit)}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              keep {pct(s.management.profit_capture_pct, 0)}
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
            These names are research candidates only. A quoted spread missed at least one credit, cushion, liquidity or
            execution limit, the expiration crosses earnings, the chain had no usable two-sided pair, or the name ranked
            outside the live-pricing limit.
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
                          <div style={{ color: (r.window_pct ?? 0) > 0 ? 'var(--pos)' : 'var(--text)' }}>
                            {pct(r.window_pct)}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                            {sigma(r.rally_sigma)}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', color: (r.rel_strength_pct ?? 0) > 0 ? 'var(--neg-strong)' : 'var(--text-muted)' }}>
                          {pct(r.rel_strength_pct)}
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
                                ${s.short_strike} / ${s.long_strike} C
                              </div>
                              <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                                {usd(s.credit)} credit · {pct(s.return_on_risk_pct, 0)} on risk
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
          Nothing cleared the filters. That is normal in a strong market, and the gates here are deliberately narrow
          &mdash; try raising <em>Max vs market</em>, widening the RSI band, unticking
          <em> Require 50-day below 200-day</em> or <em>Require resistance overhead</em>, or widening the universe. If
          candidates appear but none get a spread, lower <em>Min credit</em> or <em>Min cushion</em>.
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
