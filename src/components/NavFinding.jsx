import { useId, useState } from 'react'
import { NAV_LAG_EXPLAINER } from '../utils/navAssessment'

// The one result per fund that the Dashboard, the NAV Erosion page and the
// NAV Erosion Screener all show. The backend decides it (fund_finding), so a
// fund over the same dates and reference reads the same on every screen.
export function NavFindingLabel({ finding, as: Tag = 'strong', className = '', title }) {
  if (!finding) return null
  return (
    <Tag className={`ci-nav-status ci-nav-tone-${finding.tone}${className ? ` ${className}` : ''}`}
      title={(title === undefined ? finding.reason : title) || undefined}>
      {finding.label}
    </Tag>
  )
}

// Says plainly that NAV lag is not erosion, wherever a lagging fund appears.
export function NavLagNote({ compact = false }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (compact) {
    return <small className="nav-lag-note" title={NAV_LAG_EXPLAINER}>Not NAV erosion</small>
  }
  return (
    <span className="nav-lag-note">
      <button type="button" className="nav-lag-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        What is NAV lag?
      </button>
      {open && <span id={id} className="nav-lag-explainer">{NAV_LAG_EXPLAINER}</span>}
    </span>
  )
}
