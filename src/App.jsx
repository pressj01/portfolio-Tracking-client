import React, { useState, useRef, useEffect } from 'react'
import { HashRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import './index.css'
import DialogProvider from './components/DialogProvider'
import ProfileProvider, { useProfile } from './context/ProfileContext'
import Dashboard from './pages/Dashboard'
import Import from './pages/Import'
import ManageHoldings from './pages/ManageHoldings'
import Settings from './pages/Settings'
import Categories from './pages/Categories'
import Growth from './pages/Growth'
import DividendAnalysis from './pages/DividendAnalysis'
import TotalReturn from './pages/TotalReturn'
import ETFScreen from './pages/ETFScreen'
import DividendCalendar from './pages/DividendCalendar'
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
import DividendHistory from './pages/DividendHistory'
import GainsLosses from './pages/GainsLosses'
import SafeWithdrawal from './pages/SafeWithdrawal'
import Help from './pages/Help'
import TechnicalScanner from './pages/TechnicalScanner'
import GeneralScanner from './pages/GeneralScanner'

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

  const isActive = React.Children.toArray(children).some(
    child => child.props?.to && location.pathname === child.props.to
  )

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

function App() {
  return (
    <DialogProvider>
    <ProfileProvider>
    <Router>
      <Nav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/import" element={<Import />} />
        <Route path="/holdings" element={<ManageHoldings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/growth" element={<Growth />} />
        <Route path="/dividends" element={<DividendAnalysis />} />
        <Route path="/total-return" element={<TotalReturn />} />
        <Route path="/gains-losses" element={<GainsLosses />} />
        <Route path="/safe-withdrawal" element={<SafeWithdrawal />} />
        <Route path="/etf-screen" element={<ETFScreen />} />
        <Route path="/div-calendar" element={<DividendCalendar />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/buy-sell-signals" element={<BuySellSignals />} />
        <Route path="/nav-erosion" element={<NavErosion />} />
        <Route path="/nav-erosion-portfolio" element={<NavErosionPortfolio />} />
        <Route path="/income-sim" element={<PortfolioIncomeSim />} />
        <Route path="/income-growth" element={<IncomeGrowthSim />} />
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
        <Route path="/scanner" element={<TechnicalScanner />} />
        <Route path="/general-scanner" element={<GeneralScanner />} />
        <Route path="/help" element={<Help />} />
      </Routes>
    </Router>
    </ProfileProvider>
    </DialogProvider>
  )
}

function ProfileSelector() {
  const { profiles, selection, setProfileId, currentProfileName, aggregateConfig, aggregateName } = useProfile()

  return (
    <div className="profile-selector">
      <select
        value={selection}
        onChange={(e) => setProfileId(e.target.value)}
        title={`Active portfolio: ${currentProfileName}`}
      >
        {profiles.map(p => (
          <option key={p.id} value={String(p.id)}>{p.name}</option>
        ))}
        {aggregateConfig.length > 0 && <option value="aggregate">{aggregateName}</option>}
      </select>
    </div>
  )
}

function Nav() {
  return (
    <nav className="nav-bar">
      <NavLink to="/">Dashboard</NavLink>
      <NavDropdown label="Portfolio">
        <NavLink to="/holdings">Holdings</NavLink>
        <NavLink to="/categories">Categories</NavLink>
        <NavLink to="/growth">Growth</NavLink>
        <NavLink to="/dividends">Dividends</NavLink>
        <NavLink to="/div-calendar">Dividend Calendar</NavLink>
        <NavLink to="/div-compare">Dividend Compare</NavLink>
        <NavLink to="/dividend-history">Dividend History</NavLink>
        <NavLink to="/total-return">Total Return</NavLink>
        <NavLink to="/gains-losses">Gains & Losses</NavLink>
        <NavLink to="/safe-withdrawal">Safe Withdrawal</NavLink>
      </NavDropdown>
      <NavDropdown label="Analysis">
        <NavLink to="/etf-screen">Stock and ETF Analysis</NavLink>
        <NavLink to="/watchlist">Watchlist</NavLink>
        <NavLink to="/buy-sell-signals">Buy / Sell Signals</NavLink>
        <NavLink to="/nav-erosion">NAV Erosion</NavLink>
        <NavLink to="/nav-erosion-portfolio">NAV Erosion Screener</NavLink>
        <NavLink to="/income-sim">Income Simulator</NavLink>
        <NavLink to="/income-growth">Income Growth</NavLink>
        <NavLink to="/correlation">Correlation Matrix</NavLink>
        <NavLink to="/analytics">Portfolio Analytics</NavLink>
        <NavLink to="/portfolio-builder">Portfolio Builder</NavLink>
        <NavLink to="/dist-compare">Distribution Compare</NavLink>
        <NavLink to="/consolidation">Consolidation Analysis</NavLink>
        <NavLink to="/macro-dashboard">Macro Regime Dashboard</NavLink>
        <NavLink to="/scanner">Technical Scanner</NavLink>
        <NavLink to="/general-scanner">General Scanner</NavLink>
      </NavDropdown>
      <NavDropdown label="Admin">
        <NavLink to="/import">Import</NavLink>
        <NavLink to="/export">Export</NavLink>
        <NavLink to="/portfolios">Portfolios</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <NavLink to="/help">Help</NavLink>
      </NavDropdown>
      <ProfileSelector />
    </nav>
  )
}

export default App
