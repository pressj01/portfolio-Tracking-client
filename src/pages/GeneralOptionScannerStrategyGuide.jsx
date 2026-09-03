import { Link } from 'react-router-dom'
import { DefinitionList, HelpSection, helpImage } from '../components/GosHelpKit'
import { OPTION_SCANNER_GROUPS, generalScannerRoute } from '../utils/optionScannerCatalog'
import { fieldsForGeneralStrategy, helpForGeneralField } from '../utils/generalOptionScannerConfig'

// Fields common to every strategy, transcribed from the five filter groups in
// GeneralOptionScanner.jsx's summaryGroups that do not change with the chosen
// trade (everything except "Strategy specific"). Kept here rather than
// imported because those help strings are written inline in that component,
// not exported -- this is documentation of stable, already-shipped copy, not
// a second source of truth for scan behavior.
const COMMON_FIELD_GROUPS = [
  {
    title: 'Descriptive data',
    help: 'Select the stock and ETF symbols to scan. An exact symbol list takes precedence over the universe selections.',
    rows: [
      ['Include symbols', 'Choose stocks, index ETFs, sector ETFs, and commodity ETFs from the scan-universe selector, or enter an exact comma-separated symbol list that overrides every universe choice until it is cleared.'],
      ['Opening cash flow', 'Index-only long-dated structures only. Risk Averse accepts a debit or zero credit, Moderate accepts zero through a small credit, and Aggressive requires a positive opening credit.'],
    ],
  },
  {
    title: 'Fundamental data',
    help: 'Filters individual stocks using the app\'s Fundamental and Growth scores. ETFs do not require these company-level scores.',
    rows: [
      ['Stock Score Fundamental', 'A transparent 1–10 app score for company quality and value: valuation (forward or trailing P/E), profit margin, return on equity, current ratio, and lower debt-to-equity. Higher is better; missing inputs are excluded. Applies only to individual stocks.'],
      ['Stock Score Growth', 'A transparent 1–10 app score from Yahoo revenue growth, earnings growth, and whether trailing EPS is positive. Higher is better; missing inputs are excluded. Applies only to individual stocks.'],
      ['Stock Score Technical', 'A transparent 1–10 app score using price versus the 20-, 50-, and 200-day moving averages, 14-day RSI, and relative strength. Strong trends score well; overbought RSI is penalized. Works for stocks and ETFs.'],
    ],
  },
  {
    title: 'Technical market conditions',
    help: 'Filters the broad market and each underlying by trend, recent price movement, lookback period, and RSI.',
    rows: [
      ['Market trend (SPY)', 'Classifies the broad market using SPY. Uptrend means price is above its 50-day average and the 50-day is above the 200-day; Downtrend is the reverse; Mixed covers all other arrangements.'],
      ['Stock / ETF trend', 'Applies the same price/50-day/200-day trend test to each stock or ETF being scanned.'],
      ['Recent stock / ETF move', 'Requires the underlying to have declined or rallied over the selected lookback. Combining Uptrend with Down/pullback finds an established uptrend experiencing a short-term decline.'],
      ['Move lookback', 'Number of trading sessions used to measure the recent move. Five sessions is roughly one trading week; 21 is roughly one month.'],
      ['Minimum move', 'Requires the recent rise or decline to be at least this large. Zero requires only the selected direction.'],
      ['RSI range', 'Limits the 14-day Relative Strength Index. Near 30 is commonly considered oversold and near 70 overbought, but the range is fully user-controlled.'],
    ],
  },
  {
    title: 'Consolidated options data',
    help: 'Filters the option chain by total trading volume, IV Rank, IV−RV, RV Rank, and Volatility score.',
    rows: [
      ['Total Option Volume', 'Requires at least this much option-contract volume in the chain or expiration evaluated by the strategy scanner. Higher thresholds favor liquid names but may remove otherwise valid trades.'],
      ['IV Rank', 'A percentile: the share of prior daily ATM IV prints in the past year that were below today. Front-month prints are preferred and one-day spikes are ignored.'],
      ['IV − RV', 'Today’s at-the-money implied volatility minus the past month’s realized volatility, in volatility points. Positive means options look expensive versus recent realized movement.'],
      ['IV − RV Rank', 'A 0–100 percentile of today’s IV − RV versus the same spread over the past year. Mean-reverting.'],
      ['RV Rank', 'A 0–100 percentile of the past month’s realized volatility versus the previous year.'],
      ['Volatility score', 'The average of IV Rank and IV − RV Rank. A smoother read on whether options look overpriced (high) or underpriced (low).'],
      ['Put / Call Skew Rank', 'For short puts and covered calls, compares 25-delta option IV with same-side ATM IV and ranks that gap versus the ticker’s trailing-year history.'],
      ['Skew Rank', 'Ranks the roughly 30-DTE 25-delta put-IV minus 25-delta call-IV gap. High means puts are unusually expensive; low means calls are unusually expensive.'],
    ],
  },
  {
    title: 'Option data',
    help: 'Sets the expiration window, price-fill assumption, and primary option-leg delta used to construct each trade.',
    rows: [
      ['Expiration (DTE)', 'Days to expiration. The scanner evaluates listed expirations inside the Minimum–Maximum DTE range and prefers the Target DTE where the strategy supports it.'],
      ['Bid/Ask level', 'The quote assumption used to estimate entry price: Conservative (bid/ask), Mid (midpoint), or 25% price improvement (one quarter of the way from conservative toward mid).'],
      ['Reference option delta', 'The absolute delta of the strategy’s primary risk-defining leg — normally the short leg for income/credit trades, the long leg for directional debit trades. 10 means 0.10 delta.'],
    ],
  },
]

// One representative strategy per distinct "Strategy specific" field set,
// matched to the screenshot captured for it. Grouping strategies by field set
// (not by name) is what keeps this page from showing 30 near-duplicate
// pictures: several strategies below share one image because the scanner
// gives them the exact same construction inputs.
const ARCHETYPE_SHOT_BY_KEY = {
  'covered-call': 'general-scanner-strategy-income',
  'long-call': 'general-scanner-strategy-directional',
  'bull-put-spread': 'general-scanner-strategy-vertical',
  'long-strangle': 'general-scanner-strategy-range',
  'call-butterfly': 'general-scanner-strategy-butterfly',
  'unbalanced-butterfly': 'general-scanner-strategy-unbalanced-butterfly',
  'iron-condor': 'general-scanner-strategy-iron-condor',
  'long-call-calendar': 'general-scanner-strategy-calendar',
  'put-call-condor': 'general-scanner-strategy-put-call-condor',
  'unbalanced-put-condor': 'general-scanner-strategy-unbalanced-put-condor',
  'double-hedge-put-butterfly': 'general-scanner-strategy-double-hedge',
  'road-trip-butterfly': 'general-scanner-strategy-road-trip',
  'sixty-forty-twenty-fly': 'general-scanner-strategy-sixty-forty-twenty',
  'fourteen-day-aic': 'general-scanner-strategy-iron-condor',
  'monthly-aic': 'general-scanner-strategy-iron-condor',
}

// The grouping key: strategies that resolve to the identical sequence of
// field keys render an identical "Strategy specific" panel, whatever their
// name. Comparing field *keys* (not array identity) survives strategies that
// build their fields via [...RANGE_FIELDS, oneMoreField] -- a fresh array
// each time the config module loads, so `===` would wrongly split Call
// Butterfly, Put Butterfly, and Iron Butterfly into three separate groups
// even though every one of their fields is identical.
const structKeyFor = strategyKey => fieldsForGeneralStrategy(strategyKey).map(f => f.key).join('|')

const STRUCT_KEY_TO_SHOT = Object.fromEntries(
  Object.entries(ARCHETYPE_SHOT_BY_KEY).map(([key, shot]) => [structKeyFor(key), shot])
)

function fieldExtra(fieldDef) {
  if (fieldDef.type === 'select') return `Choices: ${fieldDef.options.map(([, label]) => label).join(' · ')}.`
  if (fieldDef.type === 'text') return null
  const unit = fieldDef.prefix === '$' ? 'dollars' : fieldDef.suffix ? fieldDef.suffix.trim() : null
  return unit ? `Entered in ${unit}.` : null
}

function fieldRow(fieldDef) {
  const help = helpForGeneralField(fieldDef)
  const extra = fieldExtra(fieldDef)
  return [fieldDef.label, extra ? `${help} ${extra}` : help]
}

function groupByStructKey(scanners) {
  const order = []
  const byKey = new Map()
  for (const scanner of scanners) {
    const structKey = structKeyFor(scanner.key)
    if (!byKey.has(structKey)) {
      byKey.set(structKey, [])
      order.push(structKey)
    }
    byKey.get(structKey).push(scanner)
  }
  return order.map(structKey => ({ structKey, scanners: byKey.get(structKey) }))
}

// Page layout, computed once at module load. Doing this here rather than by
// mutating a "have we shown this image yet" Set during render matters under
// React 18 StrictMode: it double-invokes every component function, so a
// shared Set mutated mid-render sees its own first pass's write and reports
// an image's first appearance as a repeat.
const FAMILY_ARCHETYPE_GROUPS = OPTION_SCANNER_GROUPS.map(family => ({
  family,
  groups: groupByStructKey(family.scanners),
}))

// Keyed by "familyId:structKey", not structKey alone -- every occurrence of
// a shared shape has the identical structKey string, so comparing structKey
// to itself would call every occurrence "first". The family qualifier gives
// each occurrence a distinct identity to compare against.
const FIRST_OWNER_FOR_SHOT = new Map()
for (const { family, groups } of FAMILY_ARCHETYPE_GROUPS) {
  for (const { structKey } of groups) {
    const shot = STRUCT_KEY_TO_SHOT[structKey]
    if (shot && !FIRST_OWNER_FOR_SHOT.has(shot)) FIRST_OWNER_FOR_SHOT.set(shot, `${family.id}:${structKey}`)
  }
}

function StrategyRow({ scanner }) {
  return <div className="gos-help-strategy-row">
    <div className="gos-help-strategy-row-head">
      <b>{scanner.label}</b>
      <span className="gos-help-tag">{scanner.stance}</span>
      <span className="gos-help-tag gos-help-tag-risk">{scanner.risk}</span>
    </div>
    <p>{scanner.description}</p>
    <Link className="gos-help-strategy-link" to={generalScannerRoute(scanner.key)}>Open {scanner.label} in the scanner →</Link>
  </div>
}

function ArchetypeBlock({ group, familyId }) {
  const fields = fieldsForGeneralStrategy(group.scanners[0].key)
  const anchorId = `fields-${familyId}-${group.structKey.slice(0, 24).replace(/[^a-z0-9]+/gi, '-')}`
  const shot = STRUCT_KEY_TO_SHOT[group.structKey]
  const isFirstAppearance = shot ? FIRST_OWNER_FOR_SHOT.get(shot) === `${familyId}:${group.structKey}` : false

  return <div className="gos-help-archetype" id={anchorId}>
    <div className="gos-help-archetype-strategies">
      {group.scanners.map(scanner => <StrategyRow key={scanner.key} scanner={scanner} />)}
    </div>
    <div className="gos-help-archetype-fields">
      {shot && isFirstAppearance && <figure className="gos-help-figure">
        <img src={helpImage(`${shot}.png`)} alt={`General Option Scanner Strategy specific panel for ${group.scanners[0].label}`} />
        <figcaption>The Strategy specific panel for {group.scanners.map(s => s.label).join(', ')} — {group.scanners.length > 1 ? 'these trades share the exact same construction inputs.' : 'this trade’s own construction inputs.'}</figcaption>
      </figure>}
      {shot && !isFirstAppearance && <p className="gos-help-note">Pictured earlier on this page under an earlier strategy — same panel, same fields.</p>}
      <h4>Strategy specific inputs</h4>
      <DefinitionList rows={fields.map(fieldRow)} />
    </div>
  </div>
}

export default function GeneralOptionScannerStrategyGuide() {
  return <main className="page gos-help-page">
    <header className="gos-help-hero">
      <div>
        <span>GENERAL OPTION SCANNER · STRATEGY FIELD REFERENCE</span>
        <h1>Every input, for every trade</h1>
        <p>Six filter groups work identically no matter which strategy is selected. The seventh, <strong>Strategy specific</strong>, changes completely — it holds that trade’s own construction, payoff, and risk rules. This page documents every field in every group, for all 30 supported strategies.</p>
      </div>
      <div className="gos-help-hero-actions">
        <Link className="btn btn-sm btn-primary" to="/general-option-scanner">Open the scanner</Link>
        <Link className="btn btn-sm btn-outline" to="/general-option-scanner/help">Back to the scanner guide</Link>
      </div>
    </header>

    <nav className="gos-help-jumps" aria-label="Strategy reference topics">
      <button type="button" onClick={() => document.getElementById('common')?.scrollIntoView({ behavior: 'smooth' })}>Common to every strategy</button>
      {OPTION_SCANNER_GROUPS.map(group => <button type="button" key={group.id} onClick={() => document.getElementById(group.id)?.scrollIntoView({ behavior: 'smooth' })}>{group.label}</button>)}
    </nav>

    <HelpSection id="common" eyebrow="EVERY STRATEGY" title="The five groups that never change">
      <p className="gos-help-lead">These fields work the same for a Covered Call as they do for a Double-Hedge Put Butterfly. Only the underlyings you choose and the values you set differ — the meaning of each field does not.</p>
      {COMMON_FIELD_GROUPS.map(group => <div key={group.title} className="gos-help-common-group">
        <h3>{group.title}</h3>
        <p className="gos-help-lead">{group.help}</p>
        <DefinitionList rows={group.rows} />
      </div>)}
    </HelpSection>

    {FAMILY_ARCHETYPE_GROUPS.map(({ family, groups }) => <HelpSection key={family.id} id={family.id} eyebrow="STRATEGY SPECIFIC" title={family.label}>
      <p className="gos-help-lead">{family.description}</p>
      {groups.map(group => <ArchetypeBlock key={group.structKey} group={group} familyId={family.id} />)}
    </HelpSection>)}

    <HelpSection id="footer" eyebrow="MORE" title="Related reading">
      <div className="gos-help-footer-actions">
        <Link className="btn btn-primary" to="/general-option-scanner">Open the scanner</Link>
        <Link className="btn btn-outline" to="/general-option-scanner/help">Universe, filters, presets, and results</Link>
        <Link className="btn btn-outline" to="/general-option-scanner/help#condors">Iron Condor construction variants</Link>
      </div>
    </HelpSection>
  </main>
}
