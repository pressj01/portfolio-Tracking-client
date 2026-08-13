export const OPTION_SCANNER_GROUPS = [
  {
    id: 'single-leg',
    label: 'Single-Leg',
    description: 'Income trades built around one option position and its collateral.',
    scanners: [
      {
        key: 'covered-call',
        label: 'Covered Call',
        screenLabel: 'Covered Call Scanner',
        route: '/covered-call-scanner',
        stance: 'Neutral to bullish',
        risk: 'Shares can be called away',
        description: 'Find calls to sell against shares you own or would be willing to hold.',
      },
      {
        key: 'cash-secured-put',
        label: 'Cash-Secured Put',
        screenLabel: 'Put Selling Scanner',
        route: '/put-selling-scanner',
        stance: 'Neutral to bullish',
        risk: 'Assignment into shares',
        description: 'Find puts whose premium compensates for taking assignment risk.',
      },
      { key: 'naked-call', label: 'Naked Call', screenLabel: 'Naked Call Scanner', stance: 'Neutral to bearish', risk: 'Unlimited upside risk', description: 'Sell an uncovered call when the selected risk and probability rules are satisfied.' },
      { key: 'long-call', label: 'Long Call', screenLabel: 'Long Call Scanner', stance: 'Bullish', risk: 'Debit paid', description: 'Buy a call for defined-risk upside exposure.' },
      { key: 'long-put', label: 'Long Put', screenLabel: 'Long Put Scanner', stance: 'Bearish', risk: 'Debit paid', description: 'Buy a put for defined-risk downside exposure.' },
      { key: 'married-put', label: 'Married Put', screenLabel: 'Married Put Scanner', stance: 'Bullish with protection', risk: 'Stock less put protection', description: 'Pair long shares with a protective put.' },
      { key: 'married-call', label: 'Married Call', screenLabel: 'Married Call Scanner', stance: 'Bearish with protection', risk: 'Short stock less call protection', description: 'Pair short shares with a protective call.' },
    ],
  },
  {
    id: 'vertical-spreads',
    label: 'Vertical Spreads',
    description: 'Two-leg directional structures with expiration risk defined by their width.',
    scanners: [
      {
        key: 'bull-put-spread',
        label: 'Bull Put Spread (credit)',
        screenLabel: 'Bull Put Spread Scanner',
        route: '/bull-put-spread-scanner',
        stance: 'Neutral to bullish',
        risk: 'Defined risk',
        description: 'Sell downside premium while a farther put caps the maximum loss.',
      },
      {
        key: 'bear-call-spread',
        label: 'Bear Call Spread (credit)',
        screenLabel: 'Bear Call Spread Scanner',
        route: '/bear-call-spread-scanner',
        stance: 'Neutral to bearish',
        risk: 'Defined risk',
        description: 'Sell upside premium while a farther call caps the maximum loss.',
      },
      {
        key: 'bear-put-spread',
        label: 'Bear Put Spread (debit)',
        screenLabel: 'Bear Put Spread Scanner',
        route: '/bear-put-spread-scanner',
        stance: 'Bearish',
        risk: 'Debit paid',
        description: 'Buy downside exposure and reduce its cost by selling a lower-strike put.',
      },
      { key: 'bull-call-spread', label: 'Bull Call Spread (debit)', screenLabel: 'Bull Call Spread Scanner', stance: 'Bullish', risk: 'Debit paid', description: 'Buy a call and sell a higher-strike call to define both risk and reward.' },
    ],
  },
  {
    id: 'volatility',
    label: 'Volatility',
    description: 'Multi-leg structures whose edge depends on range, volatility, and payoff geometry.',
    scanners: [
      {
        key: 'iron-condor',
        label: 'Iron Condor',
        screenLabel: 'Iron Condor Scanner',
        route: '/iron-condor-scanner',
        stance: 'Range-bound',
        risk: 'Defined risk',
        description: 'Combine put and call credit spreads around an expected trading range.',
      },
      { key: 'long-straddle', label: 'Long Straddle', screenLabel: 'Long Straddle Scanner', stance: 'Large move either way', risk: 'Debit paid', description: 'Buy an at-the-money call and put to seek a large move.' },
      { key: 'long-strangle', label: 'Long Strangle', screenLabel: 'Long Strangle Scanner', stance: 'Large move either way', risk: 'Debit paid', description: 'Buy an out-of-the-money call and put for lower-cost volatility exposure.' },
      { key: 'short-straddle', label: 'Short Straddle', screenLabel: 'Short Straddle Scanner', stance: 'Range-bound', risk: 'Unlimited upside risk', description: 'Sell an at-the-money call and put when a narrow range is expected.' },
      { key: 'short-strangle', label: 'Short Strangle', screenLabel: 'Short Strangle Scanner', stance: 'Range-bound', risk: 'Unlimited upside risk', description: 'Sell an out-of-the-money call and put around an expected range.' },
      {
        key: 'iron-butterfly',
        label: 'Iron Butterfly',
        screenLabel: 'Iron Butterfly Scanner',
        route: '/iron-butterfly-scanner',
        stance: 'Pin or range-bound',
        risk: 'Defined risk',
        description: 'Center short premium at one body strike with protection on both sides.',
      },
      {
        key: 'unbalanced-butterfly',
        label: 'Unbalanced Butterfly',
        screenLabel: 'Unbalanced Butterfly Scanner',
        route: '/unbalanced-butterfly-scanner',
        stance: 'Directional hedge',
        risk: 'Defined by structure',
        description: 'Scan asymmetric butterfly geometry for a directional payoff and hedge.',
      },
      { key: 'call-butterfly', label: 'Call Butterfly', screenLabel: 'Call Butterfly Scanner', stance: 'Targeted range', risk: 'Debit paid', description: 'Build a three-strike long call butterfly around a target price.' },
      { key: 'put-butterfly', label: 'Put Butterfly', screenLabel: 'Put Butterfly Scanner', stance: 'Targeted range', risk: 'Debit paid', description: 'Build a three-strike long put butterfly around a target price.' },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Specialized condor and butterfly structures already supported by the app.',
    scanners: [
      {
        key: 'put-call-condor',
        label: 'Put / Call Condor',
        screenLabel: 'Put / Call Condor Scanner',
        route: '/put-call-condor-scanner',
        aliases: ['/put-condor-scanner'],
        stance: 'Directional or combined',
        risk: 'Risk-budgeted',
        description: 'Screen put condors, call condors, or an eight-leg combined package.',
      },
      {
        key: 'unbalanced-put-condor',
        label: 'Unbalanced Put Condor',
        screenLabel: 'Unbalanced Put Condor Scanner',
        route: '/unbalanced-put-condor-scanner',
        stance: 'Downside-aware',
        risk: 'Defined by structure',
        description: 'Build an asymmetric put condor around explicit risk and payoff constraints.',
      },
      {
        key: 'double-hedge-put-butterfly',
        label: 'Double-Hedge Put Butterfly',
        screenLabel: 'Double-Hedge Put Butterfly Scanner',
        route: '/double-hedge-put-butterfly-scanner',
        stance: 'Crash hedge',
        risk: 'Campaign-sized debit',
        description: 'Find the 4/-8/+8 downside hedge structure and its campaign sizing.',
      },
      {
        key: 'road-trip-butterfly',
        label: 'Road Trip Unbalanced Butterfly',
        screenLabel: 'Road Trip Unbalanced Butterfly Scanner',
        route: '/road-trip-butterfly-scanner',
        stance: 'Directional hedge',
        risk: 'Defined by structure',
        description: 'Scan the Road Trip variation with its dedicated placement and exit rules.',
      },
      {
        key: 'sixty-forty-twenty-fly',
        label: '60/40/20 Fly',
        screenLabel: '60/40/20 Fly Scanner',
        route: '/sixty-forty-twenty-fly-scanner',
        stance: 'Directional hedge',
        risk: 'Defined by structure',
        description: 'Match listed contracts to the 60/40/20 delta targets and payoff rules.',
      },
      { key: 'long-call-calendar', label: 'Long Call Calendar', screenLabel: 'Long Call Calendar Scanner', stance: 'Neutral to bullish', risk: 'Net debit', description: 'Sell a nearer call and buy a later call at the same strike.' },
      { key: 'long-put-calendar', label: 'Long Put Calendar', screenLabel: 'Long Put Calendar Scanner', stance: 'Neutral to bearish', risk: 'Net debit', description: 'Sell a nearer put and buy a later put at the same strike.' },
      { key: 'long-call-diagonal', label: 'Long Call Diagonal', screenLabel: 'Long Call Diagonal Scanner', stance: 'Bullish', risk: 'Net debit', description: 'Combine different call strikes and expirations for directional time-spread exposure.' },
      { key: 'long-put-diagonal', label: 'Long Put Diagonal', screenLabel: 'Long Put Diagonal Scanner', stance: 'Bearish', risk: 'Net debit', description: 'Combine different put strikes and expirations for directional time-spread exposure.' },
      { key: 'collar', label: 'Collar', screenLabel: 'Collar Scanner', stance: 'Protective', risk: 'Defined stock range', description: 'Protect long shares with a put while financing it with a short call.' },
      { key: 'call-ratio-spread', label: 'Call Ratio Spread', screenLabel: 'Call Ratio Spread Scanner', stance: 'Moderately bullish', risk: 'Unlimited upside risk', description: 'Buy one call and sell multiple higher-strike calls.' },
      { key: 'put-ratio-spread', label: 'Put Ratio Spread', screenLabel: 'Put Ratio Spread Scanner', stance: 'Moderately bearish', risk: 'Downside assignment risk', description: 'Buy one put and sell multiple lower-strike puts.' },
    ],
  },
]

export const OPTION_SCANNERS = OPTION_SCANNER_GROUPS.flatMap(group => (
  group.scanners.map(scanner => ({ ...scanner, groupId: group.id, groupLabel: group.label }))
))

const normalizePath = path => String(path || '').split('?')[0].split('#')[0]

const SCANNER_BY_PATH = new Map()
for (const scanner of OPTION_SCANNERS) {
  if (scanner.route) SCANNER_BY_PATH.set(scanner.route, scanner)
  for (const alias of scanner.aliases || []) SCANNER_BY_PATH.set(alias, scanner)
}

export function optionScannerForPath(path) {
  return SCANNER_BY_PATH.get(normalizePath(path)) || null
}

export function isOptionScannerPath(path) {
  return optionScannerForPath(path) !== null
}

export function generalScannerRoute(strategyKey) {
  return `/general-option-scanner?strategy=${encodeURIComponent(strategyKey)}`
}
