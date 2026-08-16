import React, { useState, useRef, useEffect } from 'react'
import { HashRouter as Router, NavLink, useLocation } from 'react-router-dom'
import './index.css'
import DialogProvider from './components/DialogProvider'
import ProfileProvider, { useProfile } from './context/ProfileContext'
import ThemeProvider, { useTheme } from './context/ThemeContext'
import { chartTheme, themedPlotlyLayout } from './utils/chartTheme'
import { convertPlotlyCurrency } from './utils/money'
import MarketRefreshProvider from './context/MarketRefreshContext'
import AppRoutes from './pageCatalog'

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

function AppFrame() {
  return (
    <>
      <Nav />
      <AppRoutes />
    </>
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
      <AppFrame />
    </Router>
    </MarketRefreshProvider>
    </ProfileProvider>
    </ThemeProvider>
    </DialogProvider>
  )
}

function ProfileSelector() {
  const { profiles, selection, isAggregate, aggregateId, setProfileId, currentProfileName, aggregates } = useProfile()
  const visibleProfiles = profiles.filter(profile => !profile.hidden_from_selector)
  const visibleAggregates = aggregates.filter(aggregate => !aggregate.hidden_from_selector)

  // Map the resolved selection back to a value the <select> can match
  const selectValue = isAggregate ? `a:${aggregateId}` : (selection.startsWith('p:') ? selection : `p:${selection}`)

  return (
    <div className="profile-selector">
      <select
        value={selectValue}
        onChange={(e) => setProfileId(e.target.value)}
        title={`Active portfolio: ${currentProfileName}`}
      >
        {visibleProfiles.map(p => (
          <option key={`p-${p.id}`} value={`p:${p.id}`}>{p.name}</option>
        ))}
        {visibleAggregates.length > 0 && (
          <optgroup label="Aggregates">
            {visibleAggregates.map(agg => (
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
      <NavDropdown label="Options">
        <NavLink to="/option-dashboard">Options Dashboard</NavLink>
        <NavLink to="/option-probability-calculator">Probability Calculator</NavLink>
        <NavLink to="/option-trades">Option Trades</NavLink>
        <NavLink to="/option-trades/import">Import Option Trades</NavLink>
        <NavLink to="/options">Strategy Lab</NavLink>
        <NavLink to="/general-option-scanner">General Option Scanner</NavLink>
        <NavLink to="/option-education">Option Strategy Education</NavLink>
        <NavLink to="/option-greeks">Understanding the Greeks</NavLink>
      </NavDropdown>
      <NavDropdown label="Portfolio">
        <NavLink to="/split-screen" title="Show two pages side by side, sharing one date range">Split View</NavLink>
        <NavLink to="/holdings">Holdings</NavLink>
        <NavLink to="/common-info">CommonInfo</NavLink>
        <NavLink to="/categories">Categories</NavLink>
        <NavLink to="/holding-targets">Holding Targets</NavLink>
        <NavLink to="/growth">Growth</NavLink>
        <NavLink to="/growth-2">Portfolio Growth 2</NavLink>
        <NavLink to="/retirement-readiness">Retirement Readiness</NavLink>
        <NavLink to="/cash-flow">Cash Flow &amp; Sustainability</NavLink>
        <NavLink to="/dividends">Dividends</NavLink>
        <NavLink to="/dividend-ledger">Daily, Weekly &amp; Monthly Payments</NavLink>
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
          <NavLink to="/drip-score">DRIP vs. Cash Analyzer</NavLink>
          <NavLink to="/income-sim">Income Simulator</NavLink>
          <NavLink to="/income-growth">Income Growth</NavLink>
        </NavMenuGroup>
        <NavMenuGroup title="Portfolio Diagnostics">
          <NavLink to="/analytics">Portfolio Analytics</NavLink>
          {/* `end` so the parent does not stay lit on /diversification/sectors —
              without it react-router matches by prefix and both entries
              highlight at once. */}
          <NavLink to="/diversification" end>Diversification</NavLink>
          <NavLink to="/diversification/sectors">Sector Exposure</NavLink>
          <NavLink to="/fund-definitions">Fund Definitions</NavLink>
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
