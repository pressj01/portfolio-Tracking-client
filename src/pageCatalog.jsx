/**
 * One list of every screen in the app, used for three things:
 *
 *   - `AppRoutes` renders the route table.
 *   - `PAGE_GROUPS` fills the page pickers in Split View. The grouping and the
 *     order deliberately mirror the nav bar, so a page is where the menu
 *     trained you to look for it.
 *   - `pageElement` hands a Split View pane the screen to render.
 *
 * A pane renders the page component directly rather than through its own
 * `<Routes location=…>`: Split View is itself a route, and React Router rejects
 * an overridden location that does not sit under the parent route's path. The
 * cost is that a pane's `useLocation`/`useParams` see the Split View URL, so a
 * pane opens a screen in its default state rather than a deep-linked one —
 * which is what a pane is for.
 *
 * The nav bar stays hand-written: it nests sub-groups and hides a few screens,
 * so deriving it from here would lose more than it saved.
 */
import React from 'react'
import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Import from './pages/Import'
import ManageHoldings from './pages/ManageHoldings'
import CommonInfo from './pages/CommonInfo'
import Settings from './pages/Settings'
import Categories from './pages/Categories'
import Growth from './pages/Growth'
import DividendAnalysis from './pages/DividendAnalysis'
import TotalReturn from './pages/TotalReturn'
import ETFScreen from './pages/ETFScreen'
import DividendCalendar from './pages/DividendCalendar'
import EarningsCalendar from './pages/EarningsCalendar'
import Watchlist from './pages/Watchlist'
import BuySellSignals from './pages/BuySellSignals'
import NavErosion from './pages/NavErosion'
import NavErosionPortfolio from './pages/NavErosionPortfolio'
import DripScore from './pages/DripScore'
import PortfolioIncomeSim from './pages/PortfolioIncomeSim'
import Correlation from './pages/Correlation'
import Analytics from './pages/Analytics'
import PortfolioBuilder from './pages/PortfolioBuilder'
import DistributionCompare from './pages/DistributionCompare'
import ManagePortfolios from './pages/ManagePortfolios'
import Export from './pages/Export'
import DividendCompare from './pages/DividendCompare'
import ConsolidationAnalysis from './pages/ConsolidationAnalysis'
import Diversification from './pages/Diversification'
import FundDefinitions from './pages/FundDefinitions'
import MacroRegimeDashboard from './pages/MacroRegimeDashboard'
import IncomeGrowthSim from './pages/IncomeGrowthSim'
import GrowthIncomeFreedom from './pages/GrowthIncomeFreedom'
import RetirementReadiness from './pages/RetirementReadiness'
import CashFlowSustainability from './pages/CashFlowSustainability'
import DividendHistory from './pages/DividendHistory'
import DividendLedger from './pages/DividendLedger'
import ReinvestmentImpact from './pages/ReinvestmentImpact'
import GainsLosses from './pages/GainsLosses'
import TaxLossHarvest from './pages/TaxLossHarvest'
import BlendedYield from './pages/BlendedYield'
import SafeWithdrawal from './pages/SafeWithdrawal'
import Help from './pages/Help'
import TechnicalScanner from './pages/TechnicalScanner'
import GeneralScanner from './pages/GeneralScanner'
import PortfolioTester from './pages/PortfolioTester'
import SecurityResearch from './pages/SecurityResearch'
import DividendCalculator from './pages/DividendCalculator'
import AnnualTaxReport from './pages/AnnualTaxReport'
import PortfolioGrowth2 from './pages/PortfolioGrowth2'
import ETFProviderUpdate from './pages/ETFProviderUpdate'
import ETFComparer from './pages/ETFComparer'
import StockComparer from './pages/StockComparer'
import StockValuation from './pages/StockValuation'
import RebalanceWizard from './pages/RebalanceWizard'
import HoldingTargets from './pages/HoldingTargets'
import ActionCenter from './pages/ActionCenter'
import ClosedCEFInformation from './pages/ClosedCEFInformation'
import CEFBuyingGuide from './pages/CEFBuyingGuide'
import CEFBuyingChecklistEvaluator from './pages/CEFBuyingChecklistEvaluator'
import CEFvsIncomeETF from './pages/CEFvsIncomeETF'
import ETFBuyingChecklistEvaluator from './pages/ETFBuyingChecklistEvaluator'
import OptionIncomeETFEvaluator from './pages/OptionIncomeETFEvaluator'
import StockBuyingChecklist from './pages/StockBuyingChecklist'
import OptionTradingTools from './pages/OptionTradingTools'
import OptionDashboard from './pages/OptionDashboard'
import OptionProbabilityCalculator from './pages/OptionProbabilityCalculator'
import OptionTrades from './pages/OptionTrades'
import OptionTradeImport from './pages/OptionTradeImport'
import OptionEducation from './pages/OptionEducation'
import PutSellingScanner from './pages/PutSellingScanner'
import CoveredCallScanner from './pages/CoveredCallScanner'
import BearPutSpreadScanner from './pages/BearPutSpreadScanner'
import BullPutSpreadScanner from './pages/BullPutSpreadScanner'
import BearCallSpreadScanner from './pages/BearCallSpreadScanner'
import IronCondorScanner from './pages/IronCondorScanner'
import PutCondorScanner from './pages/PutCondorScanner'
import UnbalancedPutCondorScanner from './pages/UnbalancedPutCondorScanner'
import UnbalancedButterflyScanner from './pages/UnbalancedButterflyScanner'
import DoubleHedgePutButterflyScanner from './pages/FourEightEightScanner'
import RoadTripButterflyScanner from './pages/RoadTripButterflyScanner'
import SixtyFortyTwentyFlyScanner from './pages/SixtyFortyTwentyFlyScanner'
import IronButterflyScanner from './pages/IronButterflyScanner'
import OptionScannerHub from './pages/OptionScannerHub'
import GeneralOptionScanner from './pages/GeneralOptionScanner'
import GreeksGuide from './pages/GreeksGuide'
import SplitScreen from './pages/SplitScreen'

export const PAGE_GROUPS = [
  {
    group: 'Main',
    pages: [
      { path: '/', label: 'Dashboard', element: <Dashboard /> },
      { path: '/action-center', label: 'Action Center', element: <ActionCenter /> },
    ],
  },
  {
    group: 'Options',
    pages: [
      { path: '/option-dashboard', label: 'Options Dashboard', element: <OptionDashboard /> },
      { path: '/option-probability-calculator', label: 'Probability Calculator', element: <OptionProbabilityCalculator /> },
      { path: '/option-trades', label: 'Option Trades', element: <OptionTrades /> },
      { path: '/option-trades/import', label: 'Import Option Trades', element: <OptionTradeImport /> },
      { path: '/options', label: 'Strategy Lab', element: <OptionTradingTools /> },
      { path: '/option-scanners', label: 'All Strategy Scanners', element: <OptionScannerHub /> },
      { path: '/general-option-scanner', label: 'General Option Scanner', element: <GeneralOptionScanner /> },
      { path: '/put-selling-scanner', label: 'Put Selling Scanner', element: <PutSellingScanner /> },
      { path: '/bull-put-spread-scanner', label: 'Bull Put Spread Scanner', element: <BullPutSpreadScanner /> },
      { path: '/covered-call-scanner', label: 'Covered Call Scanner', element: <CoveredCallScanner /> },
      { path: '/bear-put-spread-scanner', label: 'Bear Put Spread Scanner', element: <BearPutSpreadScanner /> },
      { path: '/bear-call-spread-scanner', label: 'Bear Call Spread Scanner', element: <BearCallSpreadScanner /> },
      { path: '/iron-condor-scanner', label: 'Iron Condor Scanner', element: <IronCondorScanner /> },
      { path: '/put-call-condor-scanner', label: 'Put / Call Condor Scanner', element: <PutCondorScanner /> },
      { path: '/unbalanced-put-condor-scanner', label: 'Unbalanced Put Condor Scanner', element: <UnbalancedPutCondorScanner /> },
      { path: '/unbalanced-butterfly-scanner', label: 'Unbalanced Butterfly Scanner', element: <UnbalancedButterflyScanner /> },
      { path: '/double-hedge-put-butterfly-scanner', label: 'Double-Hedge Put Butterfly Scanner', element: <DoubleHedgePutButterflyScanner /> },
      { path: '/road-trip-butterfly-scanner', label: 'Road Trip Unbalanced Butterfly Scanner', element: <RoadTripButterflyScanner /> },
      { path: '/sixty-forty-twenty-fly-scanner', label: '60/40/20 Fly Scanner', element: <SixtyFortyTwentyFlyScanner /> },
      { path: '/iron-butterfly-scanner', label: 'Iron Butterfly Scanner', element: <IronButterflyScanner /> },
      { path: '/option-education', label: 'Option Strategy Education', element: <OptionEducation /> },
      { path: '/option-greeks', label: 'Understanding the Greeks', element: <GreeksGuide /> },
    ],
  },
  {
    group: 'Portfolio',
    pages: [
      { path: '/holdings', label: 'Holdings', element: <ManageHoldings /> },
      { path: '/common-info', label: 'CommonInfo', element: <CommonInfo /> },
      { path: '/categories', label: 'Categories', element: <Categories /> },
      { path: '/holding-targets', label: 'Holding Targets', element: <HoldingTargets /> },
      { path: '/growth', label: 'Growth', element: <Growth /> },
      { path: '/growth-2', label: 'Portfolio Growth 2', element: <PortfolioGrowth2 /> },
      { path: '/retirement-readiness', label: 'Retirement Readiness', element: <RetirementReadiness /> },
      { path: '/cash-flow', label: 'Cash Flow & Sustainability', element: <CashFlowSustainability /> },
      { path: '/dividends', label: 'Dividends', element: <DividendAnalysis /> },
      { path: '/dividend-ledger', label: 'Daily, Weekly & Monthly Payments', element: <DividendLedger /> },
      { path: '/div-calendar', label: 'Dividend Calendar', element: <DividendCalendar /> },
      { path: '/earnings-calendar', label: 'Earnings Calendar', element: <EarningsCalendar /> },
      { path: '/div-compare', label: 'Dividend Compare', element: <DividendCompare /> },
      { path: '/dividend-history', label: 'Dividend History', element: <DividendHistory /> },
      { path: '/reinvestment-impact', label: 'Reinvestment Impact', element: <ReinvestmentImpact /> },
      { path: '/total-return', label: 'Total Return', element: <TotalReturn /> },
      { path: '/gains-losses', label: 'Gains & Losses', element: <GainsLosses /> },
      { path: '/safe-withdrawal', label: 'Safe Withdrawal', element: <SafeWithdrawal /> },
      { path: '/dividend-calculator', label: 'Dividend Calculator', element: <DividendCalculator /> },
      { path: '/watchlist', label: 'Watchlist', element: <Watchlist /> },
    ],
  },
  {
    group: 'Checklists',
    pages: [
      { path: '/stock-buying-checklist', label: 'Stock Buying Checklist', element: <StockBuyingChecklist /> },
      { path: '/etf-buying-checklist-evaluator', label: 'Non Income ETF Checklist Evaluator', element: <ETFBuyingChecklistEvaluator /> },
      { path: '/option-income-etf-evaluator', label: 'Option-Income ETF Evaluator', element: <OptionIncomeETFEvaluator /> },
    ],
  },
  {
    group: 'Analysis',
    pages: [
      { path: '/security-research', label: 'Security Research', element: <SecurityResearch /> },
      { path: '/etf-screen', label: 'Stock and ETF Analysis', element: <ETFScreen /> },
      { path: '/etf-comparer', label: 'ETF Comparer', element: <ETFComparer /> },
      { path: '/stock-comparer', label: 'Stock Comparer', element: <StockComparer /> },
      { path: '/stock-valuation', label: 'Stock Valuation (DCF)', element: <StockValuation /> },
      { path: '/dist-compare', label: 'Distribution Compare', element: <DistributionCompare /> },
      { path: '/general-scanner', label: 'General Scanner', element: <GeneralScanner /> },
      { path: '/scanner', label: 'Single Strategy Scanner', element: <TechnicalScanner /> },
      { path: '/buy-sell-signals', label: 'Buy / Sell Signals', element: <BuySellSignals /> },
      { path: '/nav-erosion', label: 'NAV Erosion', element: <NavErosion /> },
      { path: '/nav-erosion-portfolio', label: 'NAV Erosion Screener', element: <NavErosionPortfolio /> },
      { path: '/drip-score', label: 'DRIP vs. Cash Analyzer', element: <DripScore /> },
      { path: '/income-sim', label: 'Income Simulator', element: <PortfolioIncomeSim /> },
      { path: '/income-growth', label: 'Income Growth', element: <IncomeGrowthSim /> },
      { path: '/analytics', label: 'Portfolio Analytics', element: <Analytics /> },
      { path: '/diversification', label: 'Diversification', element: <Diversification key="holdings" /> },
      { path: '/diversification/sectors', label: 'Sector Exposure', element: <Diversification key="sectors" initialTab="sectors" /> },
      { path: '/fund-definitions', label: 'Fund Definitions', element: <FundDefinitions /> },
      { path: '/correlation', label: 'Correlation Matrix', element: <Correlation /> },
      { path: '/consolidation', label: 'Consolidation Analysis', element: <ConsolidationAnalysis /> },
      { path: '/macro-dashboard', label: 'Macro Regime Dashboard', element: <MacroRegimeDashboard /> },
      { path: '/growth-income-freedom', label: 'Growth & Income Freedom', element: <GrowthIncomeFreedom /> },
      { path: '/portfolio-builder', label: 'Portfolio Builder', element: <PortfolioBuilder /> },
      { path: '/portfolio-tester', label: 'Portfolio Tester', element: <PortfolioTester /> },
      { path: '/rebalance-wizard', label: 'Rebalance Wizard', element: <RebalanceWizard /> },
    ],
  },
  {
    group: "CEF's",
    pages: [
      { path: '/closed-cef-info', label: 'Closed CEF Information', element: <ClosedCEFInformation /> },
      { path: '/cef-buying-guide', label: 'What to Look For When Buying CEFs', element: <CEFBuyingGuide /> },
      { path: '/cef-buying-checklist-evaluator', label: 'CEF Buying Checklist Evaluator', element: <CEFBuyingChecklistEvaluator /> },
      { path: '/cef-vs-income-etf', label: 'CEFs & Income ETFs: A Guide', element: <CEFvsIncomeETF /> },
    ],
  },
  {
    group: 'Taxes',
    pages: [
      { path: '/tax-report', label: 'Annual Tax Report', element: <AnnualTaxReport /> },
      { path: '/tax-loss', label: 'Tax-Loss Harvest', element: <TaxLossHarvest /> },
      { path: '/blended-yield', label: 'Blended Yield', element: <BlendedYield /> },
    ],
  },
  {
    group: 'Admin',
    pages: [
      { path: '/import', label: 'Import', element: <Import /> },
      { path: '/export', label: 'Export', element: <Export /> },
      { path: '/etf-provider-update', label: 'ETF Provider Update', element: <ETFProviderUpdate /> },
      { path: '/portfolios', label: 'Portfolios', element: <ManagePortfolios /> },
      { path: '/settings', label: 'Settings', element: <Settings /> },
      { path: '/help', label: 'Help', element: <Help /> },
    ],
  },
]

// Routes that are reachable but are not their own entry in the picker: a detail
// route that needs a ticker to mean anything, and the older path kept working
// for links that were saved before the menu label changed.
const EXTRA_ROUTES = [
  { path: '/closed-cef-info/:ticker', element: <ClosedCEFInformation /> },
  { path: '/put-condor-scanner', element: <PutCondorScanner /> },
  // Split view is reachable from the menu but deliberately not offered inside a
  // pane: a pane showing the split page would nest panes inside panes.
  { path: '/split-screen', element: <SplitScreen /> },
]

const ALL_PAGES = PAGE_GROUPS.flatMap(section => section.pages)

const PAGE_BY_PATH = new Map(ALL_PAGES.map(page => [page.path, page]))

export const pathnameOf = (path) => String(path || '/').split('?')[0].split('#')[0]

export const pageLabel = (path) => PAGE_BY_PATH.get(pathnameOf(path))?.label || ''

/**
 * A pane path is only usable if it still resolves to a screen. Stored paths
 * outlive renames, and a path that matches nothing renders an empty pane with
 * no way to tell that from a page that is merely still loading.
 */
export const isKnownPagePath = (path) => {
  // Not just tidiness: `pathnameOf` reports a missing path as "/", so without
  // this a stored pane with no page at all would validate as the Dashboard and
  // then render as `undefined`, which falls back to the address bar's page.
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  const pathname = pathnameOf(path)
  if (PAGE_BY_PATH.has(pathname)) return true
  // Detail routes (/closed-cef-info/AGD) are known by their parent.
  return ALL_PAGES.some(page => page.path !== '/' && pathname.startsWith(`${page.path}/`))
}

/** The screen a Split View pane should render, or null if the path is stale. */
export const pageElement = (path) => PAGE_BY_PATH.get(pathnameOf(path))?.element || null

export default function AppRoutes() {
  return (
    <Routes>
      {ALL_PAGES.map(page => (
        <Route key={page.path} path={page.path} element={page.element} />
      ))}
      {EXTRA_ROUTES.map(route => (
        <Route key={route.path} path={route.path} element={route.element} />
      ))}
    </Routes>
  )
}
