import React, { useState, useRef, useEffect } from 'react'
import { HashRouter as Router, NavLink, useLocation } from 'react-router-dom'
import './index.css'
import DialogProvider from './components/DialogProvider'
import ProfileProvider, { useProfile } from './context/ProfileContext'
import ThemeProvider, { useTheme } from './context/ThemeContext'
import { chartTheme, themedPlotlyLayout, scalePlotlyLayout, scalePlotlyData, fontSizePaths, currentFontScale } from './utils/chartTheme'
import { convertPlotlyCurrency } from './utils/money'
import MarketRefreshProvider from './context/MarketRefreshContext'
import MenuOrderProvider, { useMenuOrder } from './context/MenuOrderContext'
import TickerResearchProvider from './context/TickerResearchContext'
import CommandPalette from './components/CommandPalette'
import HiddenPageBanner from './components/HiddenPageBanner'
import AdviceAcknowledgement from './components/AdviceAcknowledgement'
import LicenseGate from './components/LicenseGate'
import { NotFinancialAdviceBanner } from './components/NotFinancialAdviceNotice'
import AppRoutes from './pageCatalog'
import { visibleNavigation } from './navigation/menuConfig'
import { openCommandPalette, paletteShortcutLabel } from './utils/commandPalette'

function PlotlyThemeBridge() {
  const { isDark, fontScale } = useTheme()

  useEffect(() => {
    if (!window.Plotly || window.Plotly.__portfolioThemePatched) return
    const originalNewPlot = window.Plotly.newPlot?.bind(window.Plotly)
    const originalReact = window.Plotly.react?.bind(window.Plotly)
    if (originalNewPlot) {
      window.Plotly.newPlot = (el, data, layout, config) => {
        const converted = convertPlotlyCurrency(data, layout)
        el.__fontScale = currentFontScale()
        return originalNewPlot(el, scalePlotlyData(converted.data), scalePlotlyLayout(themedPlotlyLayout(converted.layout, document.documentElement.dataset.theme !== 'light')), config)
      }
    }
    if (originalReact) {
      window.Plotly.react = (el, data, layout, config) => {
        const converted = convertPlotlyCurrency(data, layout)
        el.__fontScale = currentFontScale()
        return originalReact(el, scalePlotlyData(converted.data), scalePlotlyLayout(themedPlotlyLayout(converted.layout, document.documentElement.dataset.theme !== 'light')), config)
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

  // Rescale charts that are already drawn when the text-size setting changes.
  useEffect(() => {
    if (!window.Plotly?.relayout) return
    const k = fontScale / 100
    document.querySelectorAll('.js-plotly-plot').forEach(el => {
      const ratio = k / (el.__fontScale ?? 1)
      if (Math.abs(ratio - 1) < 1e-6 || !el.layout) return
      el.__fontScale = k
      const layoutUpdate = fontSizePaths(el.layout, ratio)
      if (el.layout.font?.size == null) layoutUpdate['font.size'] = 12 * k
      window.Plotly.relayout(el, layoutUpdate).catch(() => {})
      ;(el.data || []).forEach((trace, i) => {
        const paths = fontSizePaths(trace, ratio)
        if (!Object.keys(paths).length) return
        const update = {}
        Object.entries(paths).forEach(([path, v]) => { update[path] = [v] })
        window.Plotly.restyle(el, update, [i]).catch(() => {})
      })
    })
  }, [fontScale])

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
    <TickerResearchProvider>
      <Nav />
      <NotFinancialAdviceBanner />
      <AdviceAcknowledgement />
      <HiddenPageBanner />
      <CommandPalette />
      <AppRoutes />
    </TickerResearchProvider>
  )
}

function App() {
  return (
    <DialogProvider>
    <ThemeProvider>
    <LicenseGate>
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
    </LicenseGate>
    </ThemeProvider>
    </DialogProvider>
  )
}

function ProfileSelector() {
  const { profiles, profileId, isAggregate, aggregateId, setProfileId, currentProfileName, aggregates } = useProfile()
  const visibleProfiles = profiles.filter(profile => !profile.hidden_from_selector)
  const visibleAggregates = aggregates.filter(aggregate => !aggregate.hidden_from_selector)

  // Map the resolved selection back to a value the <select> can match
  const selectValue = isAggregate ? `a:${aggregateId}` : `p:${profileId}`

  return (
    <div className="profile-selector">
      <select
        value={selectValue}
        onChange={(e) => setProfileId(e.target.value)}
        title={`Active portfolio: ${currentProfileName}`}
      >
        {visibleProfiles.map(p => (
          <option key={`p-${p.id}`} value={`p:${p.id}`}>
            {p.name}{p.is_user_owned ? '' : ' [Test / non-owned]'}
          </option>
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
  const { menuOrder, hiddenIds } = useMenuOrder()
  const shortcut = paletteShortcutLabel()
  const menus = visibleNavigation(menuOrder, hiddenIds)

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
          {menu.items.map(renderLink)}
        </NavDropdown>
      )
    }

    return (
      <NavDropdown key={menu.id} label={menu.label}>
        {menu.groups.map(group => (
          <NavMenuGroup key={group.id} title={group.label}>
            {group.items.map(renderLink)}
          </NavMenuGroup>
        ))}
      </NavDropdown>
    )
  }

  return (
    <nav className="nav-bar">
      <button
        type="button"
        className="nav-search-btn"
        onClick={openCommandPalette}
        title={`Search pages, tickers, and actions (${shortcut})`}
      >
        <span className="nav-search-placeholder">Search…</span>
        <kbd>{shortcut}</kbd>
      </button>
      {menus.map(renderMenu)}
      <div className="nav-end">
        <BasisModeSelector />
        <ProfileSelector />
      </div>
    </nav>
  )
}

export default App
