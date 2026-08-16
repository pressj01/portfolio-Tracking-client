import React, { useState, useRef, useEffect } from 'react'
import { HashRouter as Router, NavLink, useLocation } from 'react-router-dom'
import './index.css'
import DialogProvider from './components/DialogProvider'
import ProfileProvider, { useProfile } from './context/ProfileContext'
import ThemeProvider, { useTheme } from './context/ThemeContext'
import { chartTheme, themedPlotlyLayout } from './utils/chartTheme'
import { convertPlotlyCurrency } from './utils/money'
import MarketRefreshProvider from './context/MarketRefreshContext'
import MenuOrderProvider, { useMenuOrder } from './context/MenuOrderContext'
import AppRoutes from './pageCatalog'
import {
  groupItemsScopeId,
  groupOrderScopeId,
  NAVIGATION_ITEMS,
  orderMenuItems,
  TOP_LEVEL_SCOPE_ID,
} from './navigation/menuConfig'

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
    <MenuOrderProvider>
    <PlotlyThemeBridge />
    <Router>
      <AppFrame />
    </Router>
    </MenuOrderProvider>
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
  const { menuOrder } = useMenuOrder()

  const renderLink = (item) => (
    <NavLink key={item.id} to={item.path} title={item.title} end={item.end}>
      {item.label}
    </NavLink>
  )

  const renderMenu = (menu) => {
    if (menu.kind === 'link') return renderLink(menu)

    if (menu.kind === 'dropdown') {
      return (
        <NavDropdown key={menu.id} label={menu.label}>
          {orderMenuItems(menu.items, menu.id, menuOrder).map(renderLink)}
        </NavDropdown>
      )
    }

    const groups = orderMenuItems(menu.groups, groupOrderScopeId(menu.id), menuOrder)
    return (
      <NavDropdown key={menu.id} label={menu.label}>
        {groups.map(group => (
          <NavMenuGroup key={group.id} title={group.label}>
            {orderMenuItems(group.items, groupItemsScopeId(menu.id, group.id), menuOrder).map(renderLink)}
          </NavMenuGroup>
        ))}
      </NavDropdown>
    )
  }

  return (
    <nav className="nav-bar">
      {orderMenuItems(NAVIGATION_ITEMS, TOP_LEVEL_SCOPE_ID, menuOrder).map(renderMenu)}
      <BasisModeSelector />
      <ProfileSelector />
    </nav>
  )
}

export default App
