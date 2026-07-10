import React, { useState, useRef, useEffect } from 'react'
import { HashRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import './index.css'
import DialogProvider from './components/DialogProvider'
import ProfileProvider, { useProfile } from './context/ProfileContext'
import ThemeProvider, { useTheme } from './context/ThemeContext'
import { chartTheme, themedPlotlyLayout } from './utils/chartTheme'
import { convertPlotlyCurrency } from './utils/money'
import MarketRefreshProvider from './context/MarketRefreshContext'
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
import PortfolioIncomeSim from './pages/PortfolioIncomeSim'
import Correlation from './pages/Correlation'
import Analytics from './pages/Analytics'
import PortfolioBuilder from './pages/PortfolioBuilder'
import DistributionCompare from './pages/DistributionCompare'
import ManagePortfolios from './pages/ManagePortfolios'
import Export from './pages/Export'
import DividendCompare from './pages/DividendCompare'
import ConsolidationAnalysis from './pages/ConsolidationAnalysis'
import MacroRegimeDashboard from './pages/MacroRegimeDashboard'
import IncomeGrowthSim from './pages/IncomeGrowthSim'
import GrowthIncomeFreedom from './pages/GrowthIncomeFreedom'
import RetirementReadiness from './pages/RetirementReadiness'
import CashFlowSustainability from './pages/CashFlowSustainability'
import DividendHistory from './pages/DividendHistory'
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
// Option Education remains in development and is excluded from deployment.
// import OptionEducation from './pages/OptionEducation'

function PlotlyThemeBridge() {
  const { isDark } = useTheme()

  useEffect(() => {
    if (!window.Plotly || window.Plotly.__portfolioThemePatched) return
    const originalNewPlot = window.Plotly.newPlot?.bind(window.Plotly)
    const originalReact = window.Plotly.react?.bind(window.Plotly)
    if (originalNewPlot) {
      window.Plotly.newPlot = (el, data, layout, config) => {
        const converted = convertPlotlyCurrency(data, layout)
        return originalNewPlot(el, converted.data, themedPlotlyLayout(converted.layout, document.documentElement.dataset.theme !== 'light'), config)
      }
    }
    if (originalReact) {
      window.Plotly.react = (el, data, layout, config) => {
        const converted = convertPlotlyCurrency(data, layout)
        return originalReact(el, converted.data, themedPlotlyLayout(converted.layout, document.documentElement.dataset.theme !== 'light'), config)
      }
    }
    window.Plotly.__portfolioThemePatched = true
  }, [])

  useEffect(() => {
    if (!window.Plotly?.relayout) return
    const ct = chartTheme(isDark)
    document.querySelectorAll('.js-plotly-plot').forEach(el => {
      window.Plotly.relayout(el, {
        template: ct.template,
        paper_bgcolor: ct.paper,
        plot_bgcolor: ct.plot,
        'font.color': ct.font,
        'xaxis.gridcolor': ct.grid,
        'xaxis.zerolinecolor': ct.zeroline,
        'yaxis.gridcolor': ct.grid,
        'yaxis.zerolinecolor': ct.zeroline,
      }).catch(() => {})
    })
  }, [isDark])

  return null
}

function NavDropdown({ label, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const location = useLocation()

  // Close on route change
  useEffect(() => { setOpen(false) }, [location.pathname])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const childHasActiveRoute = (child) => {
    if (!React.isValidElement(child)) return false
    if (child.props?.to && location.pathname === child.props.to) return true
    return React.Children.toArray(child.props?.children).some(childHasActiveRoute)
  }

  const isActive = React.Children.toArray(children).some(childHasActiveRoute)

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        className={`nav-dropdown-toggle${isActive ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {label} <span className="nav-arrow">{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && <div className="nav-dropdown-menu">{children}</div>}
    </div>
  )
}

function NavMenuGroup({ title, children }) {
  return (
    <div className="nav-dropdown-group">
      <div className="nav-dropdown-group-title">{title}</div>
      {children}
    </div>
  )
}

function App() {
  return (
    <DialogProvider>
    <ThemeProvider>
    <ProfileProvider>
    <MarketRefreshProvider>
    <PlotlyThemeBridge />
    <Router>
      <Nav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/action-center" element={<ActionCenter />} />
        <Route path="/import" element={<Import />} />
        <Route path="/holdings" element={<ManageHoldings />} />
        <Route path="/common-info" element={<CommonInfo />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/growth" element={<Growth />} />
        <Route path="/dividends" element={<DividendAnalysis />} />
        <Route path="/total-return" element={<TotalReturn />} />
        <Route path="/gains-losses" element={<GainsLosses />} />
        <Route path="/safe-withdrawal" element={<SafeWithdrawal />} />
        <Route path="/etf-screen" element={<ETFScreen />} />
        <Route path="/div-calendar" element={<DividendCalendar />} />
        <Route path="/earnings-calendar" element={<EarningsCalendar />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/buy-sell-signals" element={<BuySellSignals />} />
        <Route path="/nav-erosion" element={<NavErosion />} />
        <Route path="/nav-erosion-portfolio" element={<NavErosionPortfolio />} />
        <Route path="/income-sim" element={<PortfolioIncomeSim />} />
        <Route path="/income-growth" element={<IncomeGrowthSim />} />
        <Route path="/growth-income-freedom" element={<GrowthIncomeFreedom />} />
        <Route path="/retirement-readiness" element={<RetirementReadiness />} />
        <Route path="/cash-flow" element={<CashFlowSustainability />} />
        <Route path="/correlation" element={<Correlation />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/portfolio-builder" element={<PortfolioBuilder />} />
        <Route path="/dist-compare" element={<DistributionCompare />} />
        <Route path="/portfolios" element={<ManagePortfolios />} />
        <Route path="/export" element={<Export />} />
        <Route path="/div-compare" element={<DividendCompare />} />
        <Route path="/consolidation" element={<ConsolidationAnalysis />} />
        <Route path="/macro-dashboard" element={<MacroRegimeDashboard />} />
        <Route path="/dividend-history" element={<DividendHistory />} />
        <Route path="/reinvestment-impact" element={<ReinvestmentImpact />} />
        <Route path="/scanner" element={<TechnicalScanner />} />
        <Route path="/general-scanner" element={<GeneralScanner />} />
        <Route path="/portfolio-tester" element={<PortfolioTester />} />
        <Route path="/security-research" element={<SecurityResearch />} />
        <Route path="/dividend-calculator" element={<DividendCalculator />} />
        <Route path="/growth-2" element={<PortfolioGrowth2 />} />
        <Route path="/etf-provider-update" element={<ETFProviderUpdate />} />
        <Route path="/etf-comparer" element={<ETFComparer />} />
        <Route path="/stock-comparer" element={<StockComparer />} />
        <Route path="/stock-valuation" element={<StockValuation />} />
        <Route path="/rebalance-wizard" element={<RebalanceWizard />} />
        <Route path="/holding-targets" element={<HoldingTargets />} />
        <Route path="/tax-report" element={<AnnualTaxReport />} />
        <Route path="/tax-loss" element={<TaxLossHarvest />} />
        <Route path="/blended-yield" element={<BlendedYield />} />
        <Route path="/closed-cef-info" element={<ClosedCEFInformation />} />
        <Route path="/closed-cef-info/:ticker" element={<ClosedCEFInformation />} />
        <Route path="/cef-buying-guide" element={<CEFBuyingGuide />} />
        <Route path="/cef-buying-checklist-evaluator" element={<CEFBuyingChecklistEvaluator />} />
        <Route path="/cef-vs-income-etf" element={<CEFvsIncomeETF />} />
        <Route path="/etf-buying-checklist-evaluator" element={<ETFBuyingChecklistEvaluator />} />
        <Route path="/option-income-etf-evaluator" element={<OptionIncomeETFEvaluator />} />
        <Route path="/stock-buying-checklist" element={<StockBuyingChecklist />} />
        <Route path="/options" element={<OptionTradingTools />} />
        {/* Option Education remains excluded from deployment. */}
        <Route path="/help" element={<Help />} />
      </Routes>
    </Router>
    </MarketRefreshProvider>
    </ProfileProvider>
    </ThemeProvider>
    </DialogProvider>
  )
}

function ProfileSelector() {
  const { profiles, selection, isAggregate, aggregateId, setProfileId, currentProfileName, aggregates } = useProfile()

  // Map the resolved selection back to a value the <select> can match
  const selectValue = isAggregate ? `a:${aggregateId}` : (selection.startsWith('p:') ? selection : `p:${selection}`)

  return (
    <div className="profile-selector">
      <select
        value={selectValue}
        onChange={(e) => setProfileId(e.target.value)}
        title={`Active portfolio: ${currentProfileName}`}
      >
        {profiles.map(p => (
          <option key={`p-${p.id}`} value={`p:${p.id}`}>{p.name}</option>
        ))}
        {aggregates.length > 0 && (
          <optgroup label="Aggregates">
            {aggregates.map(agg => (
              <option key={`a-${agg.id}`} value={`a:${agg.id}`}>{agg.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  )
}

function BasisModeSelector() {
  const { basisMode, setBasisMode } = useProfile()

  return (
    <div className="basis-selector">
      <span>Basis</span>
      <select
        value={basisMode}
        onChange={(e) => setBasisMode(e.target.value)}
        title="Cost basis mode"
      >
        <option value="original">Original cost</option>
        <option value="broker_adjusted">Broker adjusted cost</option>
      </select>
    </div>
  )
}

function Nav() {
  return (
    <nav className="nav-bar">
      <NavLink to="/">Dashboard</NavLink>
      <NavLink to="/action-center">Action Center</NavLink>
      <NavLink to="/options">Options</NavLink>
      <NavDropdown label="Portfolio">
        <NavLink to="/holdings">Holdings</NavLink>
        <NavLink to="/common-info">CommonInfo</NavLink>
        <NavLink to="/categories">Categories</NavLink>
        <NavLink to="/holding-targets">Holding Targets</NavLink>
        <NavLink to="/growth">Growth</NavLink>
        <NavLink to="/growth-2">Portfolio Growth 2</NavLink>
        <NavLink to="/retirement-readiness">Retirement Readiness</NavLink>
        <NavLink to="/cash-flow">Cash Flow &amp; Sustainability</NavLink>
        <NavLink to="/dividends">Dividends</NavLink>
        <NavLink to="/div-calendar">Dividend Calendar</NavLink>
        <NavLink to="/earnings-calendar">Earnings Calendar</NavLink>
        <NavLink to="/div-compare">Dividend Compare</NavLink>
        <NavLink to="/dividend-history">Dividend History</NavLink>
        <NavLink to="/reinvestment-impact">Reinvestment Impact</NavLink>
        <NavLink to="/total-return">Total Return</NavLink>
        <NavLink to="/gains-losses">Gains & Losses</NavLink>
        <NavLink to="/safe-withdrawal">Safe Withdrawal</NavLink>
        <NavLink to="/dividend-calculator">Dividend Calculator</NavLink>
        <NavLink to="/watchlist">Watchlist</NavLink>
      </NavDropdown>
      <NavDropdown label="Checklists">
        <NavLink to="/stock-buying-checklist">Stock Buying Checklist</NavLink>
        <NavLink to="/etf-buying-checklist-evaluator">Non Income ETF Checklist Evaluator</NavLink>
        <NavLink to="/option-income-etf-evaluator">Option-Income ETF Evaluator</NavLink>
      </NavDropdown>
      <NavDropdown label="Analysis">
        <NavMenuGroup title="Research & Compare">
          <NavLink to="/security-research">Security Research</NavLink>
          <NavLink to="/etf-screen">Stock and ETF Analysis</NavLink>
          <NavLink to="/etf-comparer">ETF Comparer</NavLink>
          <NavLink to="/stock-comparer">Stock Comparer</NavLink>
          <NavLink to="/stock-valuation">Stock Valuation (DCF)</NavLink>
          <NavLink to="/dist-compare">Distribution Compare</NavLink>
        </NavMenuGroup>
        <NavMenuGroup title="Screeners & Signals">
          <NavLink to="/general-scanner">General Scanner</NavLink>
          <NavLink to="/scanner">Single Strategy Scanner</NavLink>
          <NavLink to="/buy-sell-signals">Buy / Sell Signals</NavLink>
        </NavMenuGroup>
        <NavMenuGroup title="Income & NAV Risk">
          <NavLink to="/nav-erosion">NAV Erosion</NavLink>
          <NavLink to="/nav-erosion-portfolio">NAV Erosion Screener</NavLink>
          <NavLink to="/income-sim">Income Simulator</NavLink>
          <NavLink to="/income-growth">Income Growth</NavLink>
        </NavMenuGroup>
        <NavMenuGroup title="Portfolio Diagnostics">
          <NavLink to="/analytics">Portfolio Analytics</NavLink>
          <NavLink to="/correlation">Correlation Matrix</NavLink>
          <NavLink to="/consolidation">Consolidation Analysis</NavLink>
          <NavLink to="/macro-dashboard">Macro Regime Dashboard</NavLink>
        </NavMenuGroup>
        <NavMenuGroup title="Planning & Optimization">
          <NavLink to="/growth-income-freedom">Growth &amp; Income Freedom</NavLink>
          <NavLink to="/portfolio-builder">Portfolio Builder</NavLink>
          <NavLink to="/portfolio-tester">Portfolio Tester</NavLink>
          <NavLink to="/rebalance-wizard">Rebalance Wizard</NavLink>
        </NavMenuGroup>
      </NavDropdown>
      <NavDropdown label="CEF's">
        <NavLink to="/closed-cef-info">Closed CEF Information</NavLink>
        <NavLink to="/cef-buying-guide">What to Look For When Buying CEFs</NavLink>
        <NavLink to="/cef-buying-checklist-evaluator">CEF Buying Checklist Evaluator</NavLink>
        <NavLink to="/cef-vs-income-etf">CEFs &amp; Income ETFs: A Guide</NavLink>
      </NavDropdown>
      <NavDropdown label="Taxes">
        <NavLink to="/tax-report">Annual Tax Report</NavLink>
        <NavLink to="/tax-loss">Tax-Loss Harvest</NavLink>
        <NavLink to="/blended-yield">Blended Yield</NavLink>
      </NavDropdown>
      {/* Option Education remains hidden while in development. */}
      <NavDropdown label="Admin">
        <NavLink to="/import">Import</NavLink>
        <NavLink to="/export">Export</NavLink>
        <NavLink to="/etf-provider-update">ETF Provider Update</NavLink>
        <NavLink to="/portfolios">Portfolios</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <NavLink to="/help">Help</NavLink>
      </NavDropdown>
      <BasisModeSelector />
      <ProfileSelector />
    </nav>
  )
}

export default App
