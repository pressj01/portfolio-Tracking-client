import React, { useState, useRef, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import './index.css'
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
        <Route path="/etf-screen" element={<ETFScreen />} />
        <Route path="/div-calendar" element={<DividendCalendar />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/buy-sell-signals" element={<BuySellSignals />} />
        <Route path="/nav-erosion" element={<NavErosion />} />
        <Route path="/nav-erosion-portfolio" element={<NavErosionPortfolio />} />
        <Route path="/income-sim" element={<PortfolioIncomeSim />} />
        <Route path="/correlation" element={<Correlation />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/portfolio-builder" element={<PortfolioBuilder />} />
      </Routes>
    </Router>
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
        <NavLink to="/total-return">Total Return</NavLink>
      </NavDropdown>
      <NavDropdown label="Analysis">
        <NavLink to="/etf-screen">Stock and ETF Analysis</NavLink>
        <NavLink to="/watchlist">Watchlist</NavLink>
        <NavLink to="/buy-sell-signals">Buy / Sell Signals</NavLink>
        <NavLink to="/nav-erosion">NAV Erosion</NavLink>
        <NavLink to="/nav-erosion-portfolio">NAV Erosion Screener</NavLink>
        <NavLink to="/income-sim">Income Simulator</NavLink>
        <NavLink to="/correlation">Correlation Matrix</NavLink>
        <NavLink to="/analytics">Portfolio Analytics</NavLink>
        <NavLink to="/portfolio-builder">Portfolio Builder</NavLink>
      </NavDropdown>
      <NavDropdown label="Admin">
        <NavLink to="/import">Import</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </NavDropdown>
    </nav>
  )
}

export default App
