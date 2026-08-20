import { useCallback, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import GainsLosses from './GainsLosses'
import Growth from './Growth'
import PortfolioGrowth2 from './PortfolioGrowth2'
import {
  DEFAULT_GROWTH_TAB,
  GROWTH_TABS,
  parseGrowthTab,
  persistGrowthTab,
  readStoredGrowthTab,
  resolveGrowthTab,
} from '../utils/growthWorkspace'

const TAB_PANELS = {
  dollars: PortfolioGrowth2,
  'vs-market': Growth,
  lots: GainsLosses,
}

export default function GrowthWorkspace() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const onGrowthRoute = location.pathname === '/growth'
  const urlTab = parseGrowthTab(searchParams.get('tab'))
  const [storedTab, setStoredTab] = useState(() => resolveGrowthTab({
    searchTab: searchParams.get('tab'),
    storedTab: readStoredGrowthTab(),
  }))
  const tab = (onGrowthRoute && urlTab) || storedTab
  const active = GROWTH_TABS.find(item => item.id === tab) || GROWTH_TABS[0]
  const Panel = TAB_PANELS[active.id] || PortfolioGrowth2

  const selectTab = useCallback((id) => {
    persistGrowthTab(id)
    setStoredTab(id)
    if (!onGrowthRoute) return
    const next = new URLSearchParams(searchParams)
    if (id === DEFAULT_GROWTH_TAB) next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }, [onGrowthRoute, searchParams, setSearchParams])

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '0.4rem' }}>Growth</h1>
      <p className="tr-note" style={{ marginTop: 0, marginBottom: '0.85rem' }}>
        <strong>Tracker Total Return %</strong> uses the same transaction-aware calculation as
        Total Return and Gains &amp; Losses. With the same account, date range, and holdings
        scope it should match after the close; separately read live quotes can differ
        intraday. Dollar value, cash, and open options answer a different question than the
        percentage. Broker Positions Gain/Loss (Schwab/Fidelity) is cost-to-current on the
        Lots tab, not this percentage.
      </p>
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        {GROWTH_TABS.map(item => (
          <button
            key={item.id}
            type="button"
            className={`tab${item.id === active.id ? ' active' : ''}`}
            title={item.title}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="tr-note" style={{ marginTop: 0 }}>
        {active.title}
      </p>
      <Panel embedded />
    </div>
  )
}
