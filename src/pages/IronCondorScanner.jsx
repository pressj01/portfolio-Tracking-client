import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import PriceChartModal from '../components/PriceChartModal'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'
import { findActivePreset } from '../utils/activePreset'

const STORAGE_KEY = 'iron-condor-scanner-filters'

const PRESETS = {
  conservative: {
    label: 'Conservative',
    tip: 'Index funds and mega caps only, tighter neutrality gates, further-out strikes, and more cushion',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: false,
      min_market_cap: 50e9, fund_min_aum: 5e9, min_avg_dollar_volume: 150e6,
      max_efficiency_ratio: 0.32, max_drift_sigma: 1.2, max_variance_ratio: 1.05,
      max_ma_slope_pct: 2.0, min_rsi: 40, max_rsi: 60, max_rel_strength_pct: 4,
      min_range_position_pct: 25, max_range_position_pct: 75,
      exclude_fresh_extremes: true, exclude_earnings_before_expiry: true,
      exclude_leveraged_funds: true, earnings_buffer_days: 7, lookback_days: 21,
      target_dte: 45, short_delta: 0.12, long_delta: 0.05, delta_tolerance: 0.08,
      min_width_pct: 1, max_width_pct: 10, min_credit_pct_of_width: 15,
      min_cushion_sigma: 1.3, min_otm_pct: 3, max_wing_skew_pct: 15,
      max_delta_gap: 0.05, min_open_interest: 250, max_exec_cost_pct: 30,
    },
  },
  balanced: {
    label: 'Balanced',
    tip: 'Range-bound liquid names with 16-delta shorts — the classic one-standard-deviation condor',
    filters: {
      universe: 'large_cap', include_stocks: true, include_index_etfs: true, include_sector_etfs: false,
      min_market_cap: 10e9, fund_min_aum: 1e9, min_avg_dollar_volume: 50e6,
      max_efficiency_ratio: 0.45, max_drift_sigma: 1.75, max_variance_ratio: 1.20,
      max_ma_slope_pct: 3.0, min_rsi: 35, max_rsi: 65, max_rel_strength_pct: 6,
      min_range_position_pct: 15, max_range_position_pct: 85,
      exclude_fresh_extremes: true, exclude_earnings_before_expiry: true,
      exclude_leveraged_funds: true, earnings_buffer_days: 5, lookback_days: 21,
      target_dte: 40, short_delta: 0.16, long_delta: 0.07, delta_tolerance: 0.10,
      min_width_pct: 1, max_width_pct: 12, min_credit_pct_of_width: 15,
      min_cushion_sigma: 1.0, min_otm_pct: 2, max_wing_skew_pct: 25,
      max_delta_gap: 0.08, min_open_interest: 50, max_exec_cost_pct: 45,
    },
  },
  aggressive: {
    label: 'Aggressive',
    tip: 'Adds sector funds and mid caps, tolerates more drift, and sells closer strikes for a bigger credit',
    filters: {
      universe: 'large_mid', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      min_market_cap: 3e9, fund_min_aum: 300e6, min_avg_dollar_volume: 20e6,
      max_efficiency_ratio: 0.55, max_drift_sigma: 2.25, max_variance_ratio: 1.35,
      max_ma_slope_pct: 5.0, min_rsi: 30, max_rsi: 70, max_rel_strength_pct: 10,
      min_range_position_pct: 10, max_range_position_pct: 90,
      exclude_fresh_extremes: true, exclude_earnings_before_expiry: true,
      exclude_leveraged_funds: true, earnings_buffer_days: 3, lookback_days: 42,
      target_dte: 35, short_delta: 0.22, long_delta: 0.10, delta_tolerance: 0.13,
      min_width_pct: 1, max_width_pct: 18, min_credit_pct_of_width: 12,
      min_cushion_sigma: 0.8, min_otm_pct: 1.5, max_wing_skew_pct: 40,
      max_delta_gap: 0.12, min_open_interest: 25, max_exec_cost_pct: 60,
    },
  },
}

const DEFAULT_FILTERS = { ...PRESETS.balanced.filters, custom_tickers: '' }
const FUND_UNIVERSE_IDS = new Set(['index_etf', 'sector_etf', 'etf_all', 'stocks_and_etfs'])

const usd = (value, digits = 2) => value == null
  ? '—'
  : Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: digits })
const pct = (value, digits = 1) => value == null ? '—' : `${Number(value).toFixed(digits)}%`
const num = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits)
const sigma = (value, digits = 1) => value == null ? '—' : `${Number(value).toFixed(digits)}σ`

const GRADE_COLORS = {
  A: 'var(--pos-strong)', B: 'var(--pos)', C: 'var(--amber)', D: 'var(--warning)', F: 'var(--neg-strong)',
}

function GradeBadge({ row }) {
  return (
    <span title={row.scored_on_partial ? 'Partial score: no live condor was priced' : 'Full 100-point score'} style={{
      color: GRADE_COLORS[row.grade] || 'var(--text-muted)',
      border: `1px ${row.scored_on_partial ? 'dashed' : 'solid'} ${GRADE_COLORS[row.grade] || 'var(--border)'}`,
      borderRadius: '4px', padding: '0.12rem 0.35rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {row.grade}{row.scored_on_partial ? '*' : ''} {num(row.score, 1)}
    </span>
  )
}

function KindBadge({ row }) {
  const label = row.is_fund
    ? row.fund_kind === 'index' ? 'Index' : row.fund_kind === 'sector' ? 'Sector' : 'Fund'
    : 'Stock'
  return <span style={{
    color: row.is_fund ? 'var(--teal)' : 'var(--text-muted)',
    border: `1px solid ${row.is_fund ? 'var(--teal)' : 'var(--border)'}`,
    borderRadius: '3px', padding: '0.08rem 0.3rem', fontSize: '0.68rem',
  }}>{label}</span>
}

const FLAG_SHORT = {
  'Making fresh 52-week highs': 'Fresh high',
  'Making fresh 52-week lows': 'Fresh low',
  'Trending against the market — not neutral': 'Trending vs mkt',
  'Trending, not ranging': 'Trending',
  'Moves extend rather than revert': 'Momentum',
  'Sitting at the edge of its range': 'Range edge',
  'Implied vol at or below realized — nothing to sell': 'IV cheap',
  'Premium cheap against this name’s own history': 'Low IV pctile',
  'Credit below realized-vol fair value': 'Below fair',
  'A breakeven sits inside the expected move': 'BE inside EM',
  'Credit too small for the defined risk': 'Credit too small',
  'Lopsided — this is a directional trade': 'Lopsided',
  'One wing supplies almost all the credit': 'One-sided credit',
  'Wings are different widths': 'Uneven wings',
  'Four-leg slippage is high': 'Slippage',
  'Thin open interest on one leg': 'Thin OI',
  'No credit after crossing all four markets': 'No natural credit',
  'No structure met every filter': 'Filters missed',
  'Small underlying — gap risk on both wings': 'Gap risk',
  'Thin share liquidity': 'Thin volume',
  'Leveraged or inverse fund': 'Leveraged',
  'Dividend invites early assignment': 'Early assign',
  'Dividend is a large share of the credit': 'Dividend',
  'Earnings before expiration': 'Earnings',
  'Option chain unavailable': 'No chain',
  'Not priced — outside chain limit': 'Not priced',
}

function Flags({ flags = [] }) {
  if (!flags.length) return <span style={{ color: 'var(--pos)' }}>—</span>
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
      {flags.map(flag => <span key={flag} title={flag} style={{
        color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: '3px',
        padding: '0.06rem 0.22rem', fontSize: '0.62rem', whiteSpace: 'nowrap',
      }}>{FLAG_SHORT[flag] || flag}</span>)}
    </span>
  )
}

function ScoreBar({ label, value, max }) {
  const fraction = max ? Math.max(0, Math.min(1, (value || 0) / max)) : 0
  return (
    <div style={{ marginBottom: '0.45rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
        <span>{label}</span><span>{num(value, 1)} / {max}</span>
      </div>
      <div style={{ height: '6px', borderRadius: '3px', background: 'var(--surface-inset)', overflow: 'hidden' }}>
        <div style={{ width: `${fraction * 100}%`, height: '100%', background: 'var(--accent-bright)' }} />
      </div>
    </div>
  )
}

/** Where spot sits inside the profit zone, and how much room each wing has. */
function ProfitZone({ condor, price }) {
  const lower = condor?.lower_breakeven
  const upper = condor?.upper_breakeven
  if (lower == null || upper == null || !price) return null
  // Pad the drawn range past the long strikes so the wings stay visible.
  const left = Math.min(condor.put_long_strike, lower) * 0.985
  const right = Math.max(condor.call_long_strike, upper) * 1.015
  const at = value => `${Math.max(0, Math.min(100, (value - left) / (right - left) * 100))}%`
  const mark = (value, color, label, above) => (
    <div style={{ position: 'absolute', left: at(value), top: 0, bottom: 0, width: 0 }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, borderLeft: `1px dashed ${color}` }} />
      <div style={{
        position: 'absolute', [above ? 'bottom' : 'top']: '100%', transform: 'translateX(-50%)',
        color, fontSize: '0.6rem', whiteSpace: 'nowrap', padding: '0.1rem 0',
      }}>{label}</div>
    </div>
  )
  return (
    <div style={{ margin: '0.9rem 0 0.4rem' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', marginBottom: '0.9rem' }}>
        Profit zone
      </div>
      <div style={{ position: 'relative', height: 26, background: 'var(--surface-inset)', borderRadius: 4 }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: at(lower),
          width: `${(upper - lower) / (right - left) * 100}%`,
          background: 'var(--pos)', opacity: 0.22, borderRadius: 3,
        }} />
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: at(condor.put_short_strike),
          width: `${(condor.call_short_strike - condor.put_short_strike) / (right - left) * 100}%`,
          background: 'var(--pos)', opacity: 0.32,
        }} />
        {mark(lower, 'var(--amber)', `BE ${usd(lower)}`, true)}
        {mark(upper, 'var(--amber)', `BE ${usd(upper)}`, true)}
        {mark(condor.put_short_strike, 'var(--pos-strong)', `${usd(condor.put_short_strike)}P`, false)}
        {mark(condor.call_short_strike, 'var(--pos-strong)', `${usd(condor.call_short_strike)}C`, false)}
        {mark(price, 'var(--accent-bright)', `now ${usd(price)}`, false)}
      </div>
      <div style={{ marginTop: '1.15rem', color: 'var(--text-dim)', fontSize: '0.7rem' }}>
        Full credit anywhere between {usd(condor.put_short_strike)} and {usd(condor.call_short_strike)};
        {' '}profit anywhere between the breakevens, a {pct(condor.profit_zone_width_pct)} band.
        {condor.min_cushion_sigma != null && ` The nearer breakeven is ${sigma(condor.min_cushion_sigma)} away against a ${pct(condor.expected_move_pct_life)} expected move over ${condor.dte} days.`}
      </div>
    </div>
  )
}

function HelpPanel() {
  const [open, setOpen] = useState('construction')
  const section = (id, title, body) => (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button type="button" onClick={() => setOpen(open === id ? null : id)} style={{
        width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer',
        color: 'var(--text-strong)', padding: '0.6rem 0', fontWeight: 700,
      }}>{open === id ? '▾' : '▸'} {title}</button>
      {open === id && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.55, paddingBottom: '0.7rem' }}>{body}</div>}
    </div>
  )
  return (
    <div style={{
      background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: '6px',
      padding: '0.25rem 0.9rem', marginBottom: '0.8rem',
    }}>
      {section('construction', 'What the scanner is selling', <>
        <p>An iron condor is a bull put spread below the market and a bear call spread above it, same underlying and same expiration, opened for one net credit. The credit is the maximum profit, kept in full if the stock finishes between the two short strikes.</p>
        <p><strong>Maximum loss is the wider wing minus the credit — not the sum of both wings.</strong> Price can only finish on one side, so only one wing can ever be breached. This is how brokers margin the position, and adding the wings together would roughly double the apparent risk.</p>
        <p style={{ marginBottom: 0 }}>The thesis is neutral, which is not the average of bullish and bearish. This screen therefore does not combine the Bull Put and Bear Call scanners — intersecting those returns nothing, since no name is both. It measures something neither of them does: whether a name is going nowhere, and whether its options are expensive relative to how far it actually travels.</p>
      </>)}
      {section('range', 'How "going nowhere" is measured', <>
        <p><strong>Efficiency ratio</strong> is net distance travelled divided by the total path length. Near 0 means price covered a lot of ground and arrived nowhere, which is what a condor is paid for; near 1 means every day pointed the same way. This matters because a stock that rises 20% and falls straight back has zero net drift — every simple "is it flat" test calls it quiet, and a condor sold inside that round trip was breached twice.</p>
        <p><strong>Variance ratio</strong> compares the variance of five-day moves against five times the variance of daily moves. Below 1 the name mean-reverts; above 1 its moves compound in one direction. Where the efficiency ratio describes the window just observed, this describes the name's habit across the year.</p>
        <p style={{ marginBottom: 0 }}>Both moving-average slopes are read as magnitudes, and RSI is scored as a band centred on 50. On every other options screen here those read directionally — a falling average is resistance to a call seller. To a condor a falling average is simply a downtrend, and it breaks the put wing.</p>
      </>)}
      {section('premium', 'Why premium is the whole edge', <>
        <p>A directional spread can be right about direction and still make money on ordinary premium. A condor has no direction to be right about, so if implied volatility is not rich against what the stock actually delivers, nothing is paying you.</p>
        <p><strong>IV/RV</strong> is today's at-the-money implied volatility over recent realized volatility. <strong>IV percentile</strong> is the more useful of the two: the share of this name's own past-year realized volatility readings that sit below today's implied. A stock whose volatility swings between 15% and 60% but happens to sit at 20% today shows a flattering 1.3× IV/RV at an implied 26%; against its own distribution that is unremarkable, and the percentile says so.</p>
        <p style={{ marginBottom: 0 }}>Note this reads the opposite way from the Bear Put Spread Scanner, where rich implied volatility is a cost because that screen buys. This one sells, so rich is the point.</p>
      </>)}
      {section('structure', 'Strike selection and balance', <>
        <p>Short strikes default to <strong>16 delta</strong>, approximately the one-standard-deviation strike, which is where the classic condor is sold. Both breakevens are required to sit outside the expected move over the life of the trade, scored on the <em>nearer</em> side — a generous call wing does nothing for a tight put wing.</p>
        <p><strong>Strikes are matched by delta, not by distance.</strong> Equity put skew means the put 5% below spot is a much higher delta than the call 5% above it, so a condor with equidistant strikes is a net short-delta position — a bullish bet wearing four legs, and one that collects most of its credit from the wing carrying most of its risk. The scanner reports the gap between the two short deltas and the whole structure's net delta.</p>
        <p style={{ marginBottom: 0 }}>The long-standing guideline of collecting roughly a third of the wing width is where the credit score peaks. <strong>Execution cost is weighted about twice as heavily as on the two-leg screens</strong>: four markets to cross going in and four coming out, against a credit that is not twice a vertical's. It is the most common quiet killer of an otherwise sound condor.</p>
      </>)}
      {section('management', 'Management, defence, and expiration risk', <>
        <p>The plan targets <strong>50% of the credit</strong> rather than the 60–65% a clean vertical can hold for. A condor's payoff is a high win rate against a fat tail, so the last stretch of credit is bought most expensively in risk — earned only by holding a position short gamma on both sides through the period where gamma is largest.</p>
        <p><strong>Reassess at 21 DTE.</strong> Inside three weeks a short condor's gamma rises sharply and a strike that was comfortably distant becomes one a single session can reach.</p>
        <p>If one side is tested, <strong>roll the untested wing closer rather than widening the tested one</strong>. The untested side is risk that has just become less likely to matter, so it is the only adjustment that collects new credit without adding to the side already in trouble. If both breakevens come into play the range thesis is gone and the position should be closed, not adjusted.</p>
        <p style={{ marginBottom: 0 }}>Open and close all four legs as a single condor order. Earnings inside the expiration remove the name entirely rather than being flagged: the implied volatility that made the credit look generous <em>is</em> the earnings premium, it collapses either way the morning after, and the gap breaks whichever wing it points at. Assignment risk on the short call is live before expiration when a dividend falls inside the trade.
          {' '}Educational references: <a href="https://www.optionseducation.org/strategies/all-strategies/iron-condor" target="_blank" rel="noreferrer">Options Industry Council</a>
          {' · '}<a href="https://www.finra.org/investors/insights/trading-options-understanding-assignment" target="_blank" rel="noreferrer">FINRA assignment guidance</a>
        </p>
      </>)}
      {section('score', 'How the 100-point score works', <>
        <p><strong>Range 30:</strong> efficiency ratio, net drift as a magnitude, variance ratio, moving-average flatness, and RSI near the middle. Fresh 52-week highs <em>and</em> fresh lows are both penalised — this is the only screen here short both tails at once.</p>
        <p><strong>Vol 25:</strong> implied over realized, implied against the name's own past-year volatility distribution, the credit against a realized-vol fair value of all four legs, and whether recent realized volatility is contracting.</p>
        <p style={{ marginBottom: 0 }}><strong>Structure 20:</strong> the nearer breakeven in expected-move terms, delta balance, credit against the wing width, and the odds of finishing between the shorts. <strong>Safety 25:</strong> four-leg slippage, the odds of finishing between the breakevens, open interest on the worst of four legs, whether a natural fill remains a credit, equal wings, size and share liquidity, earnings, and dividend assignment risk.</p>
      </>)}
    </div>
  )
}

function DetailRow({ row, colSpan }) {
  const condor = row.spread
  const plan = condor?.management
  const cell = (label, value) => (
    <div style={{ background: 'var(--surface-inset)', borderRadius: '4px', padding: '0.5rem' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{value}</div>
    </div>
  )
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '0.8rem', background: 'var(--surface-sunken)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <RiskGraphButton kind="iron-condor" row={row} source="Iron Condor Scanner" />
        </div>
        <p style={{ maxWidth: '1100px', margin: '0 0 0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{row.verdict}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 0.7fr) minmax(420px, 2fr)', gap: '1rem' }}>
          <div>
            <ScoreBar label="Range" value={row.components?.range} max={30} />
            <ScoreBar label="Vol" value={row.components?.vol} max={25} />
            <ScoreBar label="Structure" value={row.components?.structure} max={20} />
            <ScoreBar label="Safety" value={row.components?.safety} max={25} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(110px, 1fr))', gap: '0.45rem' }}>
            {cell('Efficiency ratio', num(row.efficiency_ratio, 2))}
            {cell('Variance ratio', num(row.variance_ratio, 2))}
            {cell('Net drift', `${sigma(row.drift_sigma)} ${row.drift_direction || ''}`)}
            {cell('Range', `${usd(row.range_low)} – ${usd(row.range_high)}`)}
            {cell('Position in range', pct(row.range_position_pct, 0))}
            {cell('52-week range', `${usd(row.week52_low)} – ${usd(row.week52_high)}`)}
            {cell('SMA 20 / 50', `${usd(row.sma_20)} / ${usd(row.sma_50)}`)}
            {cell('MA slope', pct(row.ma_slope_abs, 2))}
            {cell('Market cap / AUM', row.size ? usd(row.size, 0) : '—')}
            {cell('Next earnings', row.next_earnings || 'None')}
            {condor && <>
              {cell('Short put quote', `${usd(condor.put_leg_short?.bid)} × ${usd(condor.put_leg_short?.ask)} · Δ ${num(condor.put_leg_short?.delta, 2)}`)}
              {cell('Long put quote', `${usd(condor.put_leg_long?.bid)} × ${usd(condor.put_leg_long?.ask)} · Δ ${num(condor.put_leg_long?.delta, 2)}`)}
              {cell('Short call quote', `${usd(condor.call_leg_short?.bid)} × ${usd(condor.call_leg_short?.ask)} · Δ ${num(condor.call_leg_short?.delta, 2)}`)}
              {cell('Long call quote', `${usd(condor.call_leg_long?.bid)} × ${usd(condor.call_leg_long?.ask)} · Δ ${num(condor.call_leg_long?.delta, 2)}`)}
              {cell('Mid / natural credit', `${usd(condor.credit)} / ${usd(condor.natural_credit)}`)}
              {cell('Put / call credit', `${usd(condor.put_credit)} / ${usd(condor.call_credit)}`)}
              {cell('Wings', `${usd(condor.put_width, 0)} / ${usd(condor.call_width, 0)} · risk on ${usd(condor.max_wing, 0)}`)}
              {cell('Max profit / loss', `${usd(condor.max_profit_dollars, 0)} / ${usd(condor.max_loss_dollars, 0)}`)}
              {cell('Credit / wing', `${pct(condor.credit_pct_of_width)} · ${pct(condor.return_on_risk_pct)} ROR`)}
              {cell('Annualized ROR', pct(condor.annualized_return_on_risk_pct))}
              {cell('Delta gap / net Δ', `${num(condor.delta_gap, 3)} / ${num(condor.structure_delta, 3)}`)}
              {cell('IV / RV', row.iv_rv_ratio == null ? '—' : `${num(row.iv_rv_ratio, 2)}×`)}
              {cell('IV percentile', row.iv_percentile_vs_rv == null ? '—' : `${num(row.iv_percentile_vs_rv, 0)}th`)}
              {cell('Fair credit / edge', `${usd(condor.fair_credit)} / ${pct(condor.premium_edge_pct)}`)}
              {cell('Four-leg slippage', `${usd(condor.exec_cost)} · ${pct(condor.exec_cost_pct)}`)}
              {cell('Worst-leg OI', Number(condor.open_interest_min || 0).toLocaleString())}
              {cell('Max / any profit odds', `${pct(condor.prob_max_profit, 0)} / ${pct(condor.prob_profit, 0)}`)}
            </>}
          </div>
        </div>
        {condor && <ProfitZone condor={condor} price={row.price} />}
        {plan && <div style={{
          marginTop: '0.75rem', padding: '0.65rem', border: '1px solid var(--accent)',
          borderRadius: '5px', color: 'var(--text-muted)', lineHeight: 1.45,
        }}>
          <strong style={{ color: 'var(--accent-bright)' }}>{plan.profile}:</strong>
          {' '}buy the condor back near <strong>{usd(plan.target_debit)}</strong> to capture
          {' '}{pct(plan.profit_capture_pct, 0)} ({usd(plan.target_profit_dollars, 0)}).
          Treat <strong>{usd(plan.stop_debit)}</strong> as a risk trigger, reassess at
          {' '}{plan.reassess_dte} DTE, and close by {plan.close_by_dte} DTE rather than accepting pin risk.
          {' '}{plan.rationale}
          {plan.defence_note && <div style={{ marginTop: '0.5rem' }}>
            <strong style={{ color: 'var(--text-strong)' }}>Defence:</strong> {plan.defence_note}
          </div>}
          {plan.close_before_note && <div style={{ marginTop: '0.5rem', color: 'var(--amber)' }}>
            <strong>Dividend deadline:</strong> {plan.close_before_note}
          </div>}
        </div>}
        {row.watchlist_reason && <div style={{ marginTop: '0.6rem', color: 'var(--amber)' }}>
          <strong>Watchlist only:</strong> {row.watchlist_reason}
        </div>}
      </td>
    </tr>
  )
}

const COLUMNS = [
  ['ticker', 'Ticker', 'left'], ['kind', 'Type', 'left'], ['score', 'Score', 'left'],
  ['price', 'Price', 'right'], ['range', 'Range', 'right'], ['rsi_14', 'RSI', 'right'],
  ['iv', 'IV/RV', 'right'], ['spread', 'Sell This Condor', 'center'], ['dte', 'DTE', 'right'],
  ['risk', 'Credit / Risk', 'right'], ['zone', 'Profit Zone', 'right'],
  ['cushion', 'Cushion', 'right'], ['prob', 'Prob. Profit', 'right'],
  ['ror', 'Ann. ROR', 'right'], ['manage', 'Manage', 'right'], ['flags', 'Warnings', 'left'],
]

const SORT_ACCESSORS = {
  kind: row => row.is_fund ? (row.fund_kind || 'fund') : 'stock',
  range: row => row.efficiency_ratio ?? null,
  iv: row => row.iv_rv_ratio ?? null,
  spread: row => row.spread?.put_short_strike ?? null,
  dte: row => row.spread?.dte ?? null,
  risk: row => row.spread?.return_on_risk_pct ?? null,
  zone: row => row.spread?.profit_zone_width_pct ?? null,
  cushion: row => row.spread?.min_cushion_sigma ?? null,
  prob: row => row.spread?.prob_profit ?? null,
  ror: row => row.spread?.annualized_return_on_risk_pct ?? null,
  manage: row => row.spread?.management?.target_debit ?? null,
  flags: row => row.flags?.length ?? 0,
}

export default function IronCondorScanner() {
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
  const [cachedScan, saveScan] = useScanCache('iron-condor')
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
    pf('/api/options/iron-condor-scan/universes')
      .then(response => response.json())
      .then(data => setUniverses(data.universes || []))
      .catch(() => {})
  }, [pf])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)) }, [filters])

  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const activePreset = useMemo(() => findActivePreset(PRESETS, filters), [filters])
  const anyFunds = !!(filters.include_index_etfs || filters.include_sector_etfs)
  const nothingSelected = !filters.include_stocks && !anyFunds

  const runScan = useCallback(() => {
    setLoading(true)
    setError(null)
    setExpanded(null)
    const body = { ...filters }
    if (body.universe === 'custom') {
      body.custom_tickers = String(filters.custom_tickers || '').split(/[\s,]+/).filter(Boolean)
    } else {
      delete body.custom_tickers
    }
    pf('/api/options/iron-condor-scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
      .then(response => response.json())
      .then(data => {
        if (data.error) setError(data.error)
        setRows(data.rows || [])
        setWatchlistRows(data.watchlist_rows || [])
        setStats(data.stats || null)
        setAsOf(data.as_of || null)
        setHasScanned(true)
        saveScan({
          rows: data.rows || [], watchlist_rows: data.watchlist_rows || [],
          stats: data.stats || null, as_of: data.as_of || null,
        })
      })
      .catch(scanError => setError(scanError.message))
      .finally(() => setLoading(false))
  }, [pf, filters, saveScan])

  const sortedRows = useMemo(() => {
    const accessor = SORT_ACCESSORS[sortCol] || (row => row[sortCol])
    return [...rows].sort((a, b) => {
      const av = accessor(a), bv = accessor(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? av - bv : bv - av
    })
  }, [rows, sortCol, sortAsc])
  const toggleSort = key => {
    if (sortCol === key) setSortAsc(value => !value)
    else { setSortCol(key); setSortAsc(false) }
  }
  const arrow = key => sortCol === key ? (sortAsc ? ' ▴' : ' ▾') : ''

  const numField = (label, key, { step = 1, min = 0, max, width = 64, suffix = '', scale = 1, tip } = {}) => (
    <label title={tip} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
      {label}
      <span><input type="number" step={step} min={min} max={max}
        value={filters[key] == null ? '' : filters[key] / scale}
        onChange={event => set(key, event.target.value === '' ? null : Number(event.target.value) * scale)}
        style={{ width, padding: '0.3rem 0.4rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-strong)' }}
      />{suffix && <span style={{ marginLeft: '0.2rem' }}>{suffix}</span>}</span>
    </label>
  )
  const checkField = (label, key, tip) => <label title={tip} style={{
    display: 'flex', gap: '0.35rem', alignItems: 'center', color: 'var(--text-dim)', fontSize: '0.76rem', cursor: 'pointer',
  }}><input type="checkbox" checked={!!filters[key]} onChange={event => set(key, event.target.checked)} />{label}</label>

  const renderCondorCells = row => {
    const condor = row.spread
    return <>
      <td style={{ textAlign: 'center' }}>{condor ? <div style={{
        display: 'inline-block', padding: '0.15rem 0.45rem', border: '1px solid var(--pos)', borderRadius: 4,
        background: 'var(--surface-inset)', lineHeight: 1.25,
      }}>
        <div style={{ color: 'var(--pos-strong)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          ${condor.put_long_strike}/${condor.put_short_strike}P — ${condor.call_short_strike}/${condor.call_long_strike}C
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
          exp {condor.expiration}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
          {usd(condor.credit)} credit · {pct(condor.credit_pct_of_width, 0)} of wing
        </div>
      </div> : '—'}</td>
      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {condor ? `${condor.dte}d` : '—'}
      </td>
      <td style={{ textAlign: 'right' }}>{condor ? <>
        <div><span style={{ color: 'var(--pos-strong)' }}>{usd(condor.max_profit_dollars, 0)}</span>
          {' / '}<span style={{ color: 'var(--neg-strong)' }}>{usd(condor.max_loss_dollars, 0)}</span></div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(condor.return_on_risk_pct)} ROR</div>
      </> : '—'}</td>
      <td style={{ textAlign: 'right' }}>{condor ? <>
        <div style={{ whiteSpace: 'nowrap' }}>{usd(condor.lower_breakeven)} – {usd(condor.upper_breakeven)}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(condor.profit_zone_width_pct)} wide</div>
      </> : '—'}</td>
      <td style={{ textAlign: 'right' }} title="Nearer breakeven, in the name's own expected move over the trade">
        {condor ? <>
          <div style={{ color: condor.min_cushion_sigma >= 1 ? 'var(--pos)' : 'var(--amber)' }}>
            {sigma(condor.min_cushion_sigma)}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
            {pct(Math.min(condor.lower_cushion_pct ?? 0, condor.upper_cushion_pct ?? 0), 0)} min
          </div>
        </> : '—'}</td>
      <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{condor ? <>
        <div>{pct(condor.prob_profit, 0)}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(condor.prob_max_profit, 0)} max</div>
      </> : '—'}</td>
      <td style={{ textAlign: 'right' }}>{condor ? pct(condor.annualized_return_on_risk_pct, 0) : '—'}</td>
      <td style={{ textAlign: 'right' }}>{condor?.management ? <>
        <div style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>{usd(condor.management.target_debit)}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
          take {pct(condor.management.profit_capture_pct, 0)} · {condor.management.reassess_dte}d
        </div>
      </> : '—'}</td>
      <td style={{ minWidth: 145, maxWidth: 190, whiteSpace: 'normal' }}><Flags flags={row.flags} /></td>
    </>
  }

  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.35rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Iron Condor Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)}>
          {showHelp ? 'Hide Help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Finds range-bound stocks and ETFs whose options are expensive relative to how far they actually travel, then
        sells a four-leg condor with defined risk, both breakevens outside the expected move, and a balanced
        pair of short strikes.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}

      <div style={{
        display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.6rem 0.85rem',
        background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: '0.6rem',
      }}>
        <strong style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Include:</strong>
        {[
          ['include_stocks', 'Stocks'], ['include_index_etfs', 'Index ETFs'], ['include_sector_etfs', 'Sector & commodity ETFs'],
        ].map(([key, label]) => <label key={key} style={{ color: filters[key] ? 'var(--text-strong)' : 'var(--text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!filters[key]} onChange={event => set(key, event.target.checked)} /> {label}
        </label>)}
        <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>
          Broad index funds are the classic condor underlying — they mean-revert, cannot be taken over, and never report earnings.
        </span>
        {nothingSelected && <span style={{ color: 'var(--neg-strong)' }}>Pick at least one.</span>}
      </div>

      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.76rem' }}>Preset:</span>
        {Object.entries(PRESETS).map(([key, preset]) => <button key={key}
          className={`btn btn-xs ${key === activePreset ? 'btn-scan' : 'btn-outline'}`}
          aria-pressed={key === activePreset}
          title={preset.tip} onClick={() => setFilters(current => ({ ...current, ...preset.filters }))}>
          {preset.label}
        </button>)}
      </div>

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.85rem', alignItems: 'flex-end', padding: '0.85rem',
        background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: '0.7rem',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.75rem', opacity: filters.include_stocks ? 1 : 0.45 }}>
          Stock universe
          <select value={filters.universe} disabled={!filters.include_stocks} onChange={event => set('universe', event.target.value)}
            style={{ minWidth: 155, padding: '0.3rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-strong)' }}>
            {universes.filter(item => !FUND_UNIVERSE_IDS.has(item.id)).map(item =>
              <option key={item.id} value={item.id}>{item.label}{item.count ? ` (${item.count})` : ''}</option>)}
          </select>
        </label>
        {filters.include_stocks && filters.universe === 'custom' && <label style={{ flex: '1 1 230px', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
          Tickers<input value={filters.custom_tickers || ''} onChange={event => set('custom_tickers', event.target.value.toUpperCase())}
            placeholder="SPY, QQQ, IWM..." style={{ width: '100%', display: 'block', padding: '0.3rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-strong)' }} />
        </label>}
        {numField('Max efficiency', 'max_efficiency_ratio', { step: 0.05, max: 1, tip: 'Net distance travelled over total path length. Lower is more range-bound; above ~0.5 the name is trending' })}
        {numField('Max drift', 'max_drift_sigma', { step: 0.25, suffix: 'σ', tip: 'Net move over the lookback, as a magnitude — direction is irrelevant to a condor' })}
        {numField('Max variance ratio', 'max_variance_ratio', { step: 0.05, width: 72, tip: 'Below 1 the name mean-reverts; above 1 its moves compound in one direction' })}
        {numField('Max MA slope', 'max_ma_slope_pct', { step: 0.5, suffix: '%', tip: 'Steepest of the 20- and 50-day slopes, as a magnitude' })}
        {numField('Min RSI', 'min_rsi')}
        {numField('Max RSI', 'max_rsi')}
        {numField('Max rel. strength', 'max_rel_strength_pct', { step: 0.5, suffix: '%', width: 72, tip: 'Beta-adjusted out- or under-performance. Leadership in either direction is a trend' })}
        {numField('Min range pos', 'min_range_position_pct', { suffix: '%', width: 72, tip: '0 is the bottom of the observed range, 100 the top. A condor wants the middle' })}
        {numField('Max range pos', 'max_range_position_pct', { suffix: '%', width: 72 })}
        {filters.include_stocks && numField('Min mkt cap', 'min_market_cap', { scale: 1e9, suffix: 'B' })}
        {anyFunds && numField('ETF min AUM', 'fund_min_aum', { scale: 1e6, suffix: 'M' })}
        {numField('Min $ volume', 'min_avg_dollar_volume', { scale: 1e6, suffix: 'M' })}
        {numField('Lookback', 'lookback_days', { suffix: 'd' })}
        {numField('Target DTE', 'target_dte', { min: 1, max: 1095, tip: '30-45 days is where a condor’s theta is worth its gamma' })}
        {numField('Short delta', 'short_delta', { step: 0.02, tip: '0.16 is approximately the one-standard-deviation strike, where the classic condor is sold' })}
        {numField('Long delta', 'long_delta', { step: 0.02 })}
        {numField('Min width', 'min_width_pct', { step: 0.5, suffix: '% spot' })}
        {numField('Max width', 'max_width_pct', { step: 0.5, suffix: '% spot' })}
        {numField('Min credit', 'min_credit_pct_of_width', { suffix: '% wing', tip: 'Collecting about a third of the wing width is the long-standing guideline' })}
        {numField('Min cushion', 'min_cushion_sigma', { step: 0.1, suffix: 'σ', tip: 'The nearer breakeven must sit this far outside the expected move' })}
        {numField('Min OTM', 'min_otm_pct', { step: 0.5, suffix: '%' })}
        {numField('Max wing skew', 'max_wing_skew_pct', { suffix: '%', width: 72, tip: 'How much the two wing widths may differ' })}
        {numField('Max delta gap', 'max_delta_gap', { step: 0.01, width: 72, tip: 'Difference between the two short deltas. Near zero is a genuinely neutral condor' })}
        {numField('Min leg OI', 'min_open_interest', { width: 72, tip: 'Applied to the worst of all four legs' })}
        {numField('Max slippage', 'max_exec_cost_pct', { suffix: '% credit', tip: 'All four bid/ask spreads against the net credit' })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {checkField('Skip fresh 52-week extremes', 'exclude_fresh_extremes', 'A condor is short both tails, so highs and lows are both disqualifying')}
          {filters.include_stocks && checkField('Skip earnings inside trade', 'exclude_earnings_before_expiry', 'The implied vol that makes the credit look generous is the earnings premium itself, and the gap breaks whichever wing it points at')}
          {anyFunds && checkField('Skip leveraged / inverse ETFs', 'exclude_leveraged_funds', 'Avoid path-dependent leveraged products')}
        </div>
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading || nothingSelected}>
          {loading ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p style={{ color: 'var(--text-dim)' }}>
        Screening for range-bound behaviour first, then pulling both the put and call chains for the finalists and
        pairing every plausible four-leg structure.
      </p>}
      {stats && !loading && <div style={{ color: 'var(--text-dim)', fontSize: '0.77rem', marginBottom: '0.55rem' }}>
        Scanned <strong>{stats.priced}</strong> of {stats.universe}
        {' → '}<strong>{stats.passed_price}</strong> range-bound
        {' → '}<strong>{stats.passed_fundamentals}</strong> passed size &amp; liquidity
        {' → '}<strong style={{ color: 'var(--pos-strong)' }}>{stats.actionable}</strong> actionable
        {stats.watchlist ? ` · ${stats.watchlist} watchlist` : ''}
        {stats.chains_fetched ? ` · ${stats.chains_fetched} live condors found` : ''}
        {stats.dropped_for_earnings ? ` · ${stats.dropped_for_earnings} excluded for earnings` : ''}
        {asOf ? ` · ${new Date(asOf).toLocaleString()}` : ''}
      </div>}

      {sortedRows.length > 0 && <>
        <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0.8rem 0 0.4rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-strong)' }}>Actionable Condors</h2>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>Live four-leg structures meeting every enabled risk gate</span>
        </div>
        <div className="sst-wrap" style={{ maxHeight: '70vh' }}>
          <table className="sst">
            <thead><tr><th style={{ width: 24 }} />{COLUMNS.map(([key, label, align]) =>
              <th key={key} onClick={() => toggleSort(key)} style={{ cursor: 'pointer', textAlign: align }}>{label}{arrow(key)}</th>)}</tr></thead>
            <tbody>{sortedRows.map(row => {
              const open = expanded === row.ticker
              return <React.Fragment key={row.ticker}>
                <tr onClick={() => setExpanded(open ? null : row.ticker)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--text-dim)' }}>{open ? '▾' : '▸'}</td>
                  <td><a href="#" onClick={event => { event.preventDefault(); event.stopPropagation(); setChartTicker(row.ticker) }}
                    style={{ color: 'var(--accent-bright)', fontWeight: 700, textDecoration: 'none' }}>{row.ticker} 📈</a>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div></td>
                  <td><KindBadge row={row} /></td><td><GradeBadge row={row} /></td>
                  <td style={{ textAlign: 'right' }}>{usd(row.price)}</td>
                  <td style={{ textAlign: 'right' }} title="Efficiency ratio (net distance / path length) and net drift">
                    <div style={{ color: row.efficiency_ratio <= 0.3 ? 'var(--pos)' : 'var(--text-muted)' }}>
                      {num(row.efficiency_ratio, 2)}
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{sigma(row.drift_sigma)} drift</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>{num(row.rsi_14, 0)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ color: row.iv_rv_ratio >= 1.1 ? 'var(--pos)' : 'var(--text-muted)' }}>
                      {row.iv_rv_ratio == null ? '—' : `${num(row.iv_rv_ratio, 2)}×`}
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                      {row.iv_percentile_vs_rv == null ? '' : `${num(row.iv_percentile_vs_rv, 0)}th pct`}
                    </div>
                  </td>
                  {renderCondorCells(row)}
                </tr>
                {open && <DetailRow row={row} colSpan={COLUMNS.length + 1} />}
              </React.Fragment>
            })}</tbody>
          </table>
        </div>
      </>}

      {!loading && watchlistRows.length > 0 && <details open={sortedRows.length === 0} style={{
        marginTop: '1rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-sunken)', overflow: 'hidden',
      }}>
        <summary style={{ cursor: 'pointer', padding: '0.7rem 0.85rem', color: 'var(--text-strong)', fontWeight: 700 }}>
          Watchlist Candidates ({watchlistRows.length})
          <span style={{ marginLeft: '0.6rem', color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.74rem' }}>
            The range passed, but the trade is not currently actionable
          </span>
        </summary>
        <div className="sst-wrap" style={{ maxHeight: '45vh', borderLeft: 0, borderRight: 0, borderBottom: 0 }}>
          <table className="sst">
            <thead><tr><th /><th>Ticker</th><th>Type</th><th>Score</th><th>Range</th><th>Status</th><th>Indicative Condor</th><th style={{ textAlign: 'right' }}>DTE</th><th>Warnings</th></tr></thead>
            <tbody>{watchlistRows.map(row => {
              const open = expanded === row.ticker
              const status = {
                earnings: 'Earnings inside trade', constraints_relaxed: 'Structure limits missed',
                unavailable: 'No quotable condor', not_priced: 'Awaiting live pricing',
              }[row.chain_status] || 'Not actionable'
              return <React.Fragment key={row.ticker}>
                <tr onClick={() => setExpanded(open ? null : row.ticker)} style={{ cursor: 'pointer' }}>
                  <td>{open ? '▾' : '▸'}</td>
                  <td><strong style={{ color: 'var(--accent-bright)' }}>{row.ticker}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{row.name}</div></td>
                  <td><KindBadge row={row} /></td><td><GradeBadge row={row} /></td>
                  <td>{num(row.efficiency_ratio, 2)} · {sigma(row.drift_sigma)}</td>
                  <td style={{ color: 'var(--amber)', maxWidth: 300 }}><strong>{status}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{row.watchlist_reason}</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row.spread
                    ? `$${row.spread.put_long_strike}/$${row.spread.put_short_strike}P — $${row.spread.call_short_strike}/$${row.spread.call_long_strike}C · ${usd(row.spread.credit)}`
                    : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.spread ? `${row.spread.dte}d` : '—'}</td>
                  <td><Flags flags={row.flags} /></td>
                </tr>
                {open && <DetailRow row={row} colSpan={9} />}
              </React.Fragment>
            })}</tbody>
          </table>
        </div>
      </details>}

      {!loading && hasScanned && !sortedRows.length && !watchlistRows.length && !error && <p style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: '2rem' }}>
        Nothing passed the neutrality filters. Try the Balanced preset, raise the efficiency-ratio or drift ceilings, or include index ETFs — broad funds range far more often than single names.
      </p>}
      {!loading && hasScanned && !sortedRows.length && watchlistRows.length > 0 && !error && <p style={{ textAlign: 'center', color: 'var(--amber)', marginTop: '1rem' }}>
        No currently actionable condor met every enabled risk gate. The watchlist above shows the exact reason for each candidate.
      </p>}
      {!hasScanned && !loading && <p style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: '2rem' }}>
        Pick a preset or adjust the filters, then run the scan.
      </p>}
      {chartTicker && <PriceChartModal ticker={chartTicker} onClose={() => setChartTicker(null)} />}
    </div>
  )
}
