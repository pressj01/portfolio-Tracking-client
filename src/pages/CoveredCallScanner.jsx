import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import PriceChartModal from '../components/PriceChartModal'
import RiskGraphButton from '../components/RiskGraphButton'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'call-scanner-filters'

const PRESETS = {
  conservative: {
    label: 'Conservative',
    tip: 'Your own holdings only, must have stalled, strike kept above your cost basis and well out of the money',
    filters: {
      universe: 'holdings', include_stocks: true, include_index_etfs: false, include_sector_etfs: false,
      min_market_cap: 10e9, min_run_pct: 8, min_stretch_sigma: 1.5, min_rsi: 62, min_pct_of_52w_range: 70,
      fund_min_run_pct: 4, fund_min_stretch_sigma: 1.5, fund_min_aum: 1e9, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 50e6, lookback_days: 21,
      exclude_fresh_highs: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 7,
      require_shares_held: true, respect_cost_basis: true,
      target_dte: 35, target_delta: 0.20, min_otm_pct: 5,
    },
  },
  balanced: {
    label: 'Balanced',
    tip: 'Holdings plus index ETFs, a real extension, the conventional 0.30-delta write',
    filters: {
      universe: 'holdings', include_stocks: true, include_index_etfs: true, include_sector_etfs: false,
      min_market_cap: 2e9, min_run_pct: 8, min_stretch_sigma: 1.25, min_rsi: 60, min_pct_of_52w_range: 65,
      fund_min_run_pct: 4, fund_min_stretch_sigma: 1.25, fund_min_aum: 300e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 10e6, lookback_days: 21,
      exclude_fresh_highs: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 5,
      require_shares_held: false, respect_cost_basis: true,
      target_dte: 35, target_delta: 0.30, min_otm_pct: 2,
    },
  },
  smallCap: {
    label: 'Small caps',
    tip: 'Small caps carry the richest premium but gap harder, so this asks for more room above the strike and a lower delta',
    filters: {
      universe: 'large_mid_small', include_stocks: true, include_index_etfs: false, include_sector_etfs: false,
      min_market_cap: 2e9, small_cap_min_market_cap: 300e6,
      min_run_pct: 10, min_stretch_sigma: 1.5, min_rsi: 60, min_pct_of_52w_range: 70,
      fund_min_run_pct: 4, fund_min_stretch_sigma: 1.25, fund_min_aum: 300e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 5e6, lookback_days: 21,
      exclude_fresh_highs: true, exclude_earnings_before_expiry: true, earnings_buffer_days: 5,
      require_shares_held: false, respect_cost_basis: true,
      target_dte: 35, target_delta: 0.25, min_otm_pct: 6,
    },
  },
  aggressive: {
    label: 'Aggressive',
    tip: 'Wider universe, allows names still breaking out and strikes below your basis — more premium, far more chance of losing the shares',
    filters: {
      universe: 'large_mid_small', include_stocks: true, include_index_etfs: true, include_sector_etfs: true,
      min_market_cap: 2e9, small_cap_min_market_cap: 300e6,
      min_run_pct: 5, min_stretch_sigma: 1.0, min_rsi: 55, min_pct_of_52w_range: 55,
      fund_min_run_pct: 3, fund_min_stretch_sigma: 1.0, fund_min_aum: 200e6, exclude_leveraged_funds: true,
      min_avg_dollar_volume: 5e6, lookback_days: 42,
      exclude_fresh_highs: false, exclude_earnings_before_expiry: true, earnings_buffer_days: 3,
      require_shares_held: false, respect_cost_basis: false,
      target_dte: 35, target_delta: 0.35, min_otm_pct: 1,
    },
  },
}

const DEFAULT_FILTERS = { ...PRESETS.balanced.filters, small_cap_min_market_cap: 300e6, custom_tickers: '' }

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
// same convention as the Strategy Lab and the put screen. A strike converted to
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

function GradeBadge({ grade, score, partial }) {
  return (
    <span
      title={partial
        ? `Partial score ${score}/100 — no option chain, so the premium and most of the trade-terms points could not be scored`
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
  index: { label: 'Index', color: 'var(--teal)', tip: 'Broad index fund — the steadiest thing to write calls against' },
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
  'Making fresh 52-week highs': 'Fresh highs',
  'Advance still accelerating': 'Still climbing',
  'Earnings before expiration': 'Earnings in trade',
  'Strike below your cost basis': 'Below basis',
  'Dividend near premium — early assignment risk': 'Div assign risk',
  'Dividend exceeds option premium — likely early assignment': 'Div assign likely',
  'Thin share liquidity': 'Illiquid',
  'Far above the 200-day average': 'Above 200d',
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
    <div id="call-scanner-help" className="help-box" style={{
      marginBottom: '1rem', padding: '1rem', background: 'var(--surface-sunken)',
      border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.83rem',
      color: 'var(--text-muted)', lineHeight: 1.6,
    }}>
      <p style={{ margin: '0 0 0.85rem' }}>
        This screen looks for stocks and ETFs that have <em>already made their move</em> and are starting to stall,
        then rates each one as a candidate for selling a covered call and names a specific contract to sell.
        The quick-start section is open; expand the other sections when you need the scoring math or a definition.
      </p>

      <HelpSection title="Why “overbought” on its own is the wrong screen" open>
        <p style={p}>
          Selling a covered call trades away the upside above the strike for a premium collected today. It wins when
          the stock goes sideways or drifts down, and it loses its whole point when the stock keeps running &mdash; the
          shares get called away and you watch the rest of the move without owning it.
        </p>
        <p style={{ margin: 0 }}>
          That is why hunting purely for overbought names backfires. The strongest momentum names carry the fattest
          premium <em>because</em> they keep going up. So this screen requires three things at once: the move has
          already happened (<strong>Overextension</strong>), the options are genuinely overpriced rather than merely
          expensive-looking (<strong>Premium</strong>), and the advance is cooling rather than accelerating
          (<strong>Stall</strong>). A name printing fresh 52-week highs scores zero on Stall and is excluded by default.
        </p>
      </HelpSection>

      <HelpSection title="How to use it">
        <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li><strong>Start with your own holdings.</strong> That is the default universe, and only a position you actually hold has a share count and a cost basis to check the strike against. Tick <em>Only where I hold 100+ shares</em> to see nothing but writable positions.</li>
          <li><strong>Choose what else to scan</strong> with the Include checkboxes. They are independent, so an ETF-only scan finishes in a few seconds.</li>
          <li><strong>Pick a preset</strong> &mdash; Conservative, Balanced, or Aggressive &mdash; or set the filters yourself.</li>
          <li><strong>Run Scan.</strong> The first run downloads a year of history for everything selected. Re-running with different filters is much faster while that price data stays cached, and it is shared with the Put Selling Scanner.</li>
          <li><strong>Read the table top-down.</strong> It is ranked by score, and every candidate that got a live option chain sorts above those that did not.</li>
          <li><strong>Click a row</strong> to expand the score breakdown, the full trade, the management plan, and the dividend and earnings detail. <strong>Click the ticker</strong> for its price chart.</li>
        </ol>
      </HelpSection>

      <HelpSection title="What “already made its move” means">
        <p style={p}>
          A 15% rally means very different things for a utility and a semiconductor stock, so nothing is ranked on the
          raw advance. Each name is measured against <em>its own</em> normal movement: the scanner takes the daily
          volatility of the period <em>before</em> the run, works out how far that name would ordinarily travel over
          the lookback window, and reports the actual advance as a multiple of it. That is the <strong>Stretch</strong>,
          in standard deviations (&sigma;). 2.5&sigma; means it rose two and a half deviations further than its own
          history calls routine &mdash; so what is left of the expected upside over the next month is unusually small.
        </p>
        <p style={{ margin: 0 }}>
          <strong>vs Market</strong> then subtracts the market&rsquo;s move times the name&rsquo;s beta, isolating the part
          specific to this name. <strong>% of Range</strong> is where the price sits between its 52-week low and high.
        </p>
      </HelpSection>

      <HelpSection title="How the score is built (0–100)">
        <p style={p}>
          Four independent axes add to 100 points. Inputs between the thresholds below earn points on a straight-line
          ramp; values beyond a threshold receive that item&rsquo;s minimum or maximum. A letter grade follows:
          A &ge; 80, B &ge; 70, C &ge; 60, D &ge; 50, otherwise F. The bands are calibrated to match the Put Selling
          Scanner, so a C means the same thing on both screens &mdash; a workable setup, with A and B held back for
          genuinely extreme dislocations.
        </p>
        <Glossary items={[
          ['Overextension — 30', 'Stretch from 1σ to 3σ earns 0–12 points; sitting 60–100% of the way up the 52-week range earns 0–6; standing 0.5–3.0 ATRs above the 50-day average earns 0–6; and a 2–15% beta-unexplained advance earns 0–6.'],
          ['Premium — 25', 'IV/RV from 1.0 to 1.6 earns 0–14 points; the IV-rank proxy from 30 to 80 earns 0–6; and an 8–30% annualized static return earns 0–5. Earnings before expiry subtract 6 premium points.'],
          ['Stall — 20', 'Not making a fresh 52-week high earns 7 points; a 0–4% pullback off the 10-day high earns 0–5; 0–8 percentage points of deceleration earns 0–4; and sitting 1–10% below the 52-week high earns 0–4.'],
          ['Trade terms — 25', 'Underlying size (4) and share liquidity (4) need no option chain. The rest does: a 10–40% annualized if-called return earns 0–6, 2–12% of upside room earns 0–5, the chain’s spread and open interest earn 0–4, and freedom from dividend-driven early assignment earns 0–2.'],
        ]} />
        <p style={{ margin: '0.7rem 0 0' }}>
          A grade shown with an asterisk and a dashed outline (for example <strong>B* 72</strong>) had no option chain
          available. It is rescaled from the 58 points that could still be scored, but partial scores always sort below
          candidates that were fully priced, because the premium edge is still unknown.
        </p>
      </HelpSection>

      <HelpSection title="The two ways you lose the shares">
        <p style={p}>
          <strong>Earnings.</strong> A single report can gap the stock straight through your strike, handing away the
          exact move you hold it for. With <strong>Skip earnings inside trade</strong> on, a stock is removed when its
          next report falls within Target DTE plus the safety buffer. The scanner does not replace the requested trade
          with a near-expiration call merely to get out before the report. ETFs read &ldquo;no earnings&rdquo;.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Ex-dividend early assignment.</strong> This one has no equivalent when selling puts. A call holder
          exercises early only to capture a dividend, and only once the option&rsquo;s remaining <em>extrinsic</em> value
          is worth less than that dividend. So when an ex-dividend date falls inside the trade, the scanner compares the
          dividend against the credit you collected: under a quarter of it is noted, half or more is flagged as a real
          risk, and a dividend larger than the whole premium is flagged as likely assignment. If you would rather keep
          the shares than the credit, close or roll <em>before</em> the ex-date rather than at expiry. Dates Yahoo has
          not yet declared are projected from the payment frequency and marked <em>estimated</em>.
        </p>
      </HelpSection>

      <HelpSection title="Small caps">
        <p style={p}>
          The universe dropdown offers <strong>Small caps only</strong>, <strong>Mid + small caps</strong>, and
          <strong> Large + mid + small caps</strong> &mdash; lists the Put Selling Scanner deliberately does not have.
          Selling a put means agreeing to be assigned into the business, so a small cap has to clear a quality bar
          first. Writing a call means selling upside on shares you already hold, where a small cap&rsquo;s much richer
          implied volatility is the whole attraction.
        </p>
        <p style={{ margin: 0 }}>
          The real risk is <em>option</em> liquidity rather than company size: plenty of small caps list a chain that
          cannot actually be traded. So <strong>Min $ volume</strong> does the important filtering, the chain&rsquo;s
          spread and open interest are scored directly, and thin names collect the <em>Illiquid</em> and <em>Small</em>
          {' '}warnings. Because the large-cap floor would drop every small cap outright, they are measured against a
          separate <strong>Small-cap min cap</strong> figure, the same way funds are measured on AUM. The
          <strong> Small caps</strong> preset also asks for more room above the strike and a lower delta, since these
          names gap harder than a mega cap.
        </p>
      </HelpSection>

      <HelpSection title="Your cost basis and the strike">
        <p style={{ margin: 0 }}>
          Being called away below what you paid turns a premium into a realized loss, so with
          <strong> Keep strike above my cost basis</strong> on (the default) the scanner only considers strikes at or
          above your average cost for positions you hold. If no strike above your basis has a live bid, it falls back to
          the best available contract and flags <em>Below basis</em> rather than hiding the candidate. Basis comes from
          your holdings at the cost-basis mode selected in the header, derived from shares times price per share.
          <strong> Contracts</strong> is how many covered calls the position supports &mdash; one per 100 shares, so a
          60-share position supports none.
        </p>
      </HelpSection>

      <HelpSection title="The suggested trade and how to manage it">
        <p style={p}>
          For the highest-rated candidates the scanner pulls the live chain, takes the expiration closest to your target
          DTE, and picks the call nearest your target delta that is at least your minimum distance out of the money.
          A 0.30 delta is the conventional covered-call target: enough premium to be worth writing, roughly a 70% chance
          of keeping the shares. <strong>Ann. Return</strong> is the credit against the value of the shares committed if
          the stock goes nowhere; <strong>If Called</strong> adds the capital gain up to the strike &mdash; the capped
          best case.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Buy Back At</strong> is a success-oriented exit: a limit to close early, keeping most of the credit
          while removing the assignment risk that the last of the premium pays for. Strong, liquid setups aim to keep
          70% of the quoted credit, balanced setups 65%, and anything carrying a warning 60%. <strong>Defend At</strong>
          {' '}is the strike: reach it with time left and the shares are genuinely in play, so the choice is to roll up
          and out for a net credit or to let them go and bank the capped gain. Recalculate from your actual fill; the
          figures exclude commissions and cannot guarantee a winning trade.
        </p>
      </HelpSection>

      <HelpSection title="Column glossary">
        <Glossary items={[
          ['Type', 'Stock, a broad Index fund, or a Sector/commodity fund.'],
          ['Score', 'The 0–100 composite and its letter grade. An asterisk means no option chain was available.'],
          ['Shares', 'Shares you hold and the number of covered calls that supports (one per 100 shares).'],
          ['% of Range', 'Where the price sits between its 52-week low and high.'],
          ['Run', 'The advance over the lookback window.'],
          ['Stretch', 'How many standard deviations that advance runs beyond this name’s own normal move.'],
          ['vs Market', 'The share of the advance that beta does not explain. More positive means more specific to this name.'],
          ['RSI', 'Wilder’s 14-day relative strength. Higher is more overbought.'],
          ['IV/RV', 'Implied volatility over realized volatility. Above 1.0 means option sellers are being paid above fair value — green in the table.'],
          ['Sell This Call', 'The suggested contract: strike, expiration, days to expiry, how far above spot the strike sits, and the credit per share.'],
          ['Earnings', 'Days until the next report and whether the suggested expiration closes before it.'],
          ['Ann. Return', 'The credit as an annualized return on the shares, if the stock goes nowhere.'],
          ['If Called', 'Total return if the shares are called at the strike — premium plus the gain up to it, annualized.'],
          ['Buy Back At', 'Suggested buy-to-close limit, and how much of the credit that keeps.'],
          ['Warnings', 'Short chips; hover any of them, or expand the row, for the full wording.'],
        ]} />
      </HelpSection>

      <HelpSection title="Warnings">
        <Glossary items={[
          ['Fresh highs', 'Still printing new 52-week highs — the name most likely to run through your strike.'],
          ['Still climbing', 'The last five sessions accelerated over the prior five, so assignment risk is understated.'],
          ['Earnings in trade', 'A report conflicts with the requested trade horizon. With the earnings skip enabled, the ticker is excluded.'],
          ['Earnings +Nd', 'Earnings fall shortly after expiry — only matters if you plan to roll.'],
          ['Below basis', 'No strike above your average cost had a live bid, so being called would realize a loss.'],
          ['Div assign risk', 'An ex-dividend date falls inside the trade and the dividend is half the premium or more.'],
          ['Div assign likely', 'The dividend exceeds the premium collected — expect early exercise if the call goes in the money.'],
          ['Wide spread', 'The bid/ask on the suggested call is wide, so the quoted credit is optimistic.'],
          ['Thin OI', 'Low open interest — harder to get filled, or to roll or close early.'],
          ['No chain', 'No option chain came back, so the Premium axis could not be scored.'],
          ['Illiquid', 'Thin average dollar volume in the shares themselves.'],
          ['Above 200d', 'Price is far above the 200-day average — a powerful trend, which cuts against writing calls on it.'],
          ['Leveraged', 'A leveraged or inverse fund; these decay and gap in ways a call writer is not paid for.'],
          ['Small', 'A small underlying, where the option market is usually thin.'],
        ]} />
      </HelpSection>

      <p style={{ margin: '0.85rem 0 0', color: 'var(--warning-text)' }}>
        Scores rate the setup from public market data. They are not advice. A covered call caps your upside at the
        strike and does almost nothing to protect the downside &mdash; you keep the credit, but you still own every
        dollar of a decline below it. Writing calls on shares you are not willing to sell is the most common way this
        trade goes wrong.
      </p>
    </div>
  )
}

function DetailRow({ row, colSpan, onShowChart }) {
  const c = row.call
  const mgmt = c?.management
  const early = c?.early_assignment
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
          <RiskGraphButton kind="covered-call" row={row} source="Covered Call Scanner" />
        </div>
        <div style={{ maxWidth: '1100px', fontSize: '0.88rem', color: 'var(--text-strong)', marginBottom: '0.8rem' }}>
          {row.verdict}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: '1.5rem', alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              Score breakdown
            </div>
            <ScoreBar label="Overextension" value={row.components.overextension} max={row.component_max.overextension}
              tip="How far the advance exceeds what this name's own volatility and the market's move explain" />
            <ScoreBar label="Premium" value={row.components.premium} max={row.component_max.premium}
              tip="Implied vs realized volatility, IV rank, and the annualized return on the shares" />
            <ScoreBar label="Stall" value={row.components.stall} max={row.component_max.stall}
              tip="Is the advance cooling, or still accelerating into your strike?" />
            <ScoreBar label="Trade terms" value={row.components.terms} max={row.component_max.terms}
              tip="If-called return, upside room, chain liquidity, and freedom from dividend early assignment" />
            {row.scored_on_partial && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                No option chain available — scored on the 58 points that did not need one.
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              {c ? 'Suggested covered call' : 'Option chain unavailable'}
            </div>
            {c && (
              <div style={{
                padding: '0.6rem 0.8rem', marginBottom: '0.8rem', borderRadius: '5px',
                background: 'var(--surface-inset)', borderLeft: '3px solid var(--pos-strong)',
              }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  The trade
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--pos-strong)', margin: '0.15rem 0' }}>
                  Sell {row.contracts_writable > 1 ? `up to ${row.contracts_writable} ` : '1 '}
                  {row.ticker} {c.expiration} ${c.strike} call
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Collect about {usd(c.premium_dollars, 0)} per contract against {usd(c.shares_value, 0)} of shares ·
                  {' '}keep the premium and the shares if {row.ticker} stays below ${c.strike} through {c.expiration}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  If called you sell 100 shares at ${c.strike}, an effective {usd(c.upside_cap)} per share after the
                  premium &mdash; {pct(c.if_called_pct, 1)} above today&rsquo;s {usd(row.price)}
                  {c.called_gain_pct != null && `, or ${pct(c.called_gain_pct, 1)} against your ${usd(c.cost_basis)} basis`}.
                </div>
                {row.contracts_writable > 0 && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                    You hold {shares(row.shares_held)} shares &mdash; enough for {row.contracts_writable}{' '}
                    covered {row.contracts_writable === 1 ? 'call' : 'calls'}.
                  </div>
                )}
                {c.earnings_date && (
                  <div style={{
                    fontSize: '0.78rem', marginTop: '0.35rem',
                    color: c.avoids_earnings ? 'var(--pos-strong)' : 'var(--neg-strong)',
                  }}>
                    {c.avoids_earnings
                      ? `✓ Expires ${c.days_earnings_after_expiry}d before earnings on ${c.earnings_date} — the report lands after you are out.`
                      : `⚠ Earnings on ${c.earnings_date} fall inside this trade. No expiration in the DTE window clears it.`}
                  </div>
                )}
                {c.ex_dividend_inside && (
                  <div style={{
                    fontSize: '0.78rem', marginTop: '0.25rem',
                    color: early?.level === 'high' ? 'var(--neg-strong)'
                      : early?.level === 'elevated' ? 'var(--warning-text)' : 'var(--text-muted)',
                  }}>
                    {early?.level === 'high' ? '⚠ ' : early?.level === 'elevated' ? '⚠ ' : '• '}
                    Goes ex-dividend {c.ex_dividend_date}{c.ex_dividend_estimated ? ' (estimated)' : ''} inside the
                    trade, paying {usd(c.dividend_amount)} &mdash; {pct(early?.dividend_vs_premium_pct, 0)} of the
                    credit. {early?.level === 'high'
                      ? 'Expect early exercise if the call goes in the money; close or roll before the ex-date to keep the shares.'
                      : early?.level === 'elevated'
                        ? 'Large enough to invite early exercise if the call goes in the money.'
                        : 'You collect it as long as you still hold the shares.'}
                  </div>
                )}
                {c.below_basis && (
                  <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', color: 'var(--neg-strong)' }}>
                    ⚠ The ${c.strike} strike is below your {usd(c.cost_basis)} cost basis, so being called away would
                    realize a loss on the shares.
                  </div>
                )}
                {c.basis_floor_binding && !c.below_basis && (
                  <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', color: 'var(--pos-strong)' }}>
                    ✓ Strike lifted to stay at or above your {usd(c.cost_basis)} cost basis.
                  </div>
                )}
              </div>
            )}
            {mgmt && (
              <div style={{
                padding: '0.7rem 0.85rem', marginBottom: '0.8rem', borderRadius: '5px',
                background: 'color-mix(in srgb, var(--pos) 8%, var(--surface-inset))',
                border: '1px solid color-mix(in srgb, var(--pos) 45%, var(--border))',
              }}>
                <div style={{
                  fontSize: '0.72rem', color: 'var(--pos-strong)', textTransform: 'uppercase',
                  letterSpacing: '0.04em', fontWeight: 700,
                }}>
                  Management plan · {mgmt.profile}
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 750, color: 'var(--text-strong)', margin: '0.18rem 0' }}>
                  Buy to close near {usd(mgmt.target_price)} · defend at {usd(mgmt.defend_price)}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  If the buyback fills, keep about {usd(mgmt.premium_kept_dollars, 0)} of the quoted
                  {' '}{usd(c.premium_dollars, 0)} credit ({pct(mgmt.profit_capture_pct, 0)}), while giving back
                  {' '}{usd(mgmt.premium_returned_dollars, 0)} to remove the remaining assignment risk.
                  {' '}If it has not filled, reassess near {mgmt.reassess_dte} DTE.
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {mgmt.defend_note}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                  {mgmt.rationale} Base the live order on your actual entry fill; commissions and slippage are excluded.
                </div>
              </div>
            )}
            {c && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
                {cell('Days to expiry', c.dte)}
                {cell('Bid / Ask', `${num(c.bid)} / ${num(c.ask)}`)}
                {cell('Premium', `${usd(c.premium_dollars, 0)} per contract`)}
                {cell('Shares committed', `100 · ${usd(c.shares_value, 0)}`)}
                {cell('Static return', `${pct(c.premium_yield_pct, 2)} (${pct(c.annualized_pct, 0)} ann.)`)}
                {cell('If called', `${pct(c.if_called_pct, 2)} (${pct(c.if_called_annualized_pct, 0)} ann.)`)}
                {cell('Delta', num(c.delta, 3))}
                {cell('Keep shares', pct(c.prob_keep_shares, 0))}
                {cell('Strike is', `${pct(c.otm_pct, 1)} above spot`)}
                {cell('Effective sale', usd(c.upside_cap))}
                {cell('Downside breakeven', usd(c.downside_breakeven))}
                {cell('Open interest', c.open_interest ?? '—')}
                {cell('Spread', pct(c.spread_pct, 0))}
                {c.cost_basis != null && cell('Your basis', usd(c.cost_basis))}
                {c.called_gain_dollars != null && cell('Gain if called', usd(c.called_gain_dollars, 0))}
              </div>
            )}

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              The extension
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem', marginBottom: '0.9rem' }}>
              {cell('Move in window', pct(row.run_pct))}
              {cell('Normal move', `±${pct(row.expected_move_pct)}`)}
              {cell('Stretch', `${num(row.stretch_sigma, 1)}σ`)}
              {cell('Excess vs market', pct(row.excess_run_pct))}
              {cell('Beta', num(row.beta))}
              {cell('% of 52-wk range', pct(row.pct_of_52w_range, 0))}
              {cell('52-wk range', `${usd(row.week52_low)} – ${usd(row.week52_high)}`)}
              {cell('Below 52-wk high', pct(row.below_52w_high_pct))}
              {cell('Above 50-day', pct(row.above_sma50_pct))}
              {cell('ATRs above 50-day', num(row.atr_above_sma50, 1))}
              {cell('Pullback off high', pct(row.pullback_from_high_pct))}
              {cell('5d vs prior 5d', `${num(row.accel_pp, 1)} pp`)}
              {cell('IV / realized vol', num(row.iv_rv_ratio))}
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
              The underlying
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.7rem' }}>
              {cell('Sector', row.sector || '—')}
              {cell(row.is_fund ? 'Fund assets' : 'Market cap', row.size ? usdCompact(row.size) : '—')}
              {cell('Shares held', row.shares_held ? shares(row.shares_held) : '—')}
              {cell('Contracts', row.contracts_writable || '—')}
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
  { key: 'contracts_writable', label: 'Shares', align: 'right', tip: 'Shares you hold, and how many covered calls that supports (one per 100)' },
  { key: 'pct_of_52w_range', label: '% of Range', align: 'right', tip: 'Where the price sits between its 52-week low and high' },
  { key: 'run_pct', label: 'Run', align: 'right', tip: 'The advance over the lookback window' },
  { key: 'stretch_sigma', label: 'Stretch', align: 'right', tip: 'Standard deviations beyond this name’s own normal move over the window' },
  { key: 'excess_run_pct', label: 'vs Market', align: 'right', tip: 'The part of the advance that beta does not explain' },
  { key: 'rsi_14', label: 'RSI', align: 'right' },
  { key: 'iv_rv_ratio', label: 'IV/RV', align: 'right', tip: 'Implied vol over realized vol — above 1.0 means sellers are paid above fair value' },
  { key: 'call_strike', label: 'Sell This Call', align: 'center', tip: 'The suggested strike and expiration to sell' },
  { key: 'dte', label: 'DTE', align: 'right', tip: 'Days to expiration for the suggested option chain' },
  { key: 'days_to_earnings', label: 'Earnings', align: 'center', tip: 'Days until the next earnings report, and whether the suggested expiration closes before it' },
  { key: 'call_annualized', label: 'Ann. Return', align: 'right', tip: 'Annualized credit against the shares, if the stock goes nowhere' },
  { key: 'call_if_called', label: 'If Called', align: 'right', tip: 'Total return if the shares are called at the strike — premium plus the gain up to it' },
  { key: 'call_buyback', label: 'Buy Back At', align: 'right', tip: 'Suggested buy-to-close limit that retains 60–70% of the quoted entry credit' },
  { key: 'flags', label: 'Warnings', align: 'left' },
]

const SORT_ACCESSORS = {
  call_strike: r => r.call?.strike ?? null,
  dte: r => r.call?.dte ?? null,
  call_annualized: r => r.call?.annualized_pct ?? null,
  call_if_called: r => r.call?.if_called_annualized_pct ?? null,
  call_buyback: r => r.call?.management?.target_price ?? null,
  flags: r => (r.flags?.length ?? 0),
  kind: r => (r.is_fund ? (r.fund_kind || 'fund') : 'stock'),
}

export default function CoveredCallScanner() {
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
  const [cachedScan, saveScan] = useScanCache('covered-call')
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
    pf('/api/options/call-scan/universes')
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
  // Small caps need their own market-cap floor, so only surface that field when
  // the selected universe actually contains them.
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
    pf('/api/options/call-scan', {
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
        const tier = (a.call ? 0 : 1) - (b.call ? 0 : 1)
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
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Covered Call Scanner</h1>
        <button
          type="button"
          className="btn btn-xs btn-outline"
          aria-expanded={showHelp}
          aria-controls="call-scanner-help"
          onClick={() => setShowHelp(h => !h)}
        >
          {showHelp ? 'Hide Help' : 'How this works'}
        </button>
      </div>
      <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        Finds stocks and ETFs that have run further than their own volatility justifies <em>and are starting to
        stall</em>, then rates them as candidates for selling covered calls. Overbought alone is not the signal &mdash;
        a name still breaking out is the one that runs through your strike.
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
          ['include_stocks', 'Stocks', 'Scan the stock universe chosen below — your holdings by default'],
          ['include_index_etfs', 'Index ETFs', 'SPY, QQQ, IWM, DIA, sector-neutral style and rates funds'],
          ['include_sector_etfs', 'Sector & commodity ETFs', 'XLK, XLE, GLD, SLV, SMH, GDX and the rest of the sector complex'],
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

        {filters.include_stocks && numField('Min run', 'min_run_pct', { suffix: '%', width: 65, tip: 'Stocks: minimum advance over the lookback window' })}
        {filters.include_stocks && numField('Min stretch', 'min_stretch_sigma', { step: 0.1, suffix: 'σ', width: 65, tip: 'Stocks: minimum standard deviations beyond the name’s normal move' })}
        {filters.include_stocks && numField('Min mkt cap', 'min_market_cap', { scale: 1e9, suffix: 'B', width: 65, tip: 'Large and mid caps only — funds are sized by AUM, and small caps get their own floor' })}
        {anySmallCaps && numField('Small-cap min cap', 'small_cap_min_market_cap', { scale: 1e6, suffix: 'M', width: 65, tip: 'Small caps need their own floor — the large-cap gate would drop every one of them. Their real risk is option liquidity, which Min $ volume gates.' })}

        {/* Funds need their own floors: an index travels less than a single
            stock, so sharing the stock thresholds would leave ETFs unmatched. */}
        {anyFunds && numField('ETF min run', 'fund_min_run_pct', { suffix: '%', width: 65, tip: 'ETFs: minimum advance over the window. Indexes move less than single stocks, so this floor is lower.' })}
        {anyFunds && numField('ETF min stretch', 'fund_min_stretch_sigma', { step: 0.1, suffix: 'σ', width: 65, tip: 'ETFs: minimum standard deviations beyond the fund’s normal move' })}
        {anyFunds && numField('ETF min AUM', 'fund_min_aum', { scale: 1e6, suffix: 'M', width: 65, tip: 'Funds report assets under management rather than a market cap' })}

        {numField('Min RSI', 'min_rsi', { width: 65, tip: 'Only names this overbought or higher' })}
        {numField('Min % of range', 'min_pct_of_52w_range', { width: 65, suffix: '%', tip: 'How far up the 52-week range the price must sit' })}
        {numField('Min $ volume', 'min_avg_dollar_volume', { scale: 1e6, suffix: 'M', width: 65, tip: 'Average daily dollar volume — a proxy for how tight the option market will be' })}
        {numField('Lookback', 'lookback_days', { width: 65, suffix: 'd', tip: 'Trading days in the advance window' })}
        {numField('Target DTE', 'target_dte', {
          min: 1, max: 1095, width: 65,
          tip: 'Preferred days to expiration for the suggested call (up to 3 years)',
        })}
        {numField('Target delta', 'target_delta', { step: 0.05, width: 65, tip: 'Roughly the assignment probability you are targeting. 0.30 is the conventional covered-call write.' })}
        {numField('Min OTM', 'min_otm_pct', { step: 0.5, suffix: '%', width: 65, tip: 'Minimum distance the strike must sit above the current price' })}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {checkField('Skip fresh 52-wk highs', 'exclude_fresh_highs', 'Exclude names still printing new highs — the ones most likely to run through your strike')}
          {filters.include_stocks && checkField('Skip earnings inside trade', 'exclude_earnings_before_expiry', 'Exclude stocks whose next report falls within Target DTE plus the safety buffer; never substitute a very short expiration')}
          {checkField('Only where I hold 100+ shares', 'require_shares_held', 'A covered call needs 100 shares per contract, so this keeps only positions you can actually write against')}
          {checkField('Keep strike above my cost basis', 'respect_cost_basis', 'Avoid strikes below your average cost, where being called away would realize a loss')}
          {anyFunds && checkField('Skip leveraged / inverse ETFs', 'exclude_leveraged_funds', 'Leveraged and inverse funds decay and gap in ways a call writer is not paid for')}
        </div>

        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading || nothingSelected}>
          {loading ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
          Pulling a year of history for the universe, then live option chains for the finalists. The first run takes
          about 20&ndash;40 seconds; re-running with different filters is much faster while the price data is cached
          (and that cache is shared with the Put Selling Scanner).
        </p>
      )}

      {stats && !loading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.6rem' }}>
          Scanned <strong style={{ color: 'var(--text-muted)' }}>{stats.priced}</strong> of {stats.universe} tickers
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_price}</strong> extended
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.passed_fundamentals}</strong> passed size &amp; liquidity
          {' → '}<strong style={{ color: 'var(--text-muted)' }}>{stats.final}</strong> rated
          {stats.chains_fetched ? ` (${stats.chains_fetched} option chains priced)` : ''}
          {stats.positions_known ? ` · ${stats.positions_known} you can write today` : ''}
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
                      <td style={{ textAlign: 'right' }}>
                        {r.contracts_writable > 0 ? (
                          <>
                            <div style={{ fontWeight: 600, color: 'var(--pos-strong)' }}>
                              {r.contracts_writable}&times;
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {shares(r.shares_held)} sh
                            </div>
                          </>
                        ) : r.shares_held ? (
                          <span title="Fewer than 100 shares, so this position cannot cover a contract"
                                style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            {shares(r.shares_held)} sh
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{pct(r.pct_of_52w_range, 0)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--pos-strong)' }}>{pct(r.run_pct)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(r.stretch_sigma, 1)}&sigma;</td>
                      <td style={{ textAlign: 'right', color: (r.excess_run_pct ?? 0) > 0 ? 'var(--pos-strong)' : 'var(--text)' }}>
                        {pct(r.excess_run_pct)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{num(r.rsi_14, 0)}</td>
                      <td style={{ textAlign: 'right', color: (r.iv_rv_ratio ?? 0) >= 1 ? 'var(--pos-strong)' : 'var(--text-muted)' }}>
                        {num(r.iv_rv_ratio)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {r.call ? (
                          <div style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '4px',
                            background: 'var(--surface-inset)', border: '1px solid var(--pos-strong)',
                            lineHeight: 1.25,
                          }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--pos-strong)', whiteSpace: 'nowrap' }}>
                              ${r.call.strike} CALL
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              exp {r.call.expiration}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {pct(r.call.otm_pct, 0)} above · {usd(r.call.mid)} credit
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {r.call ? `${r.call.dte}d` : '—'}
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
                        {r.call ? pct(r.call.annualized_pct, 0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.call ? (
                          <>
                            <div>{pct(r.call.if_called_pct, 1)}</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {pct(r.call.if_called_annualized_pct, 0)} ann.
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.call?.management ? (
                          <>
                            <div style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>
                              {usd(r.call.management.target_price)}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              keep {pct(r.call.management.profit_capture_pct, 0)}
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
      )}

      {!loading && hasScanned && sortedRows.length === 0 && !error && (
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>
          Nothing cleared the filters. That is normal in a flat or falling market &mdash; try lowering the minimum run,
          stretch, or RSI, widening the universe, or unticking <em>Only where I hold 100+ shares</em>.
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
