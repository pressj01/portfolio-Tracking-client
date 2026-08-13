import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  OPTION_SCANNER_GROUPS,
  OPTION_SCANNERS,
  generalScannerRoute,
  optionScannerForPath,
} from '../utils/optionScannerCatalog'

export default function OptionScannerNavigator() {
  const location = useLocation()
  const navigate = useNavigate()
  const current = optionScannerForPath(location.pathname)
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const closeOnOutsideClick = event => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  if (!current) return null

  const openScanner = route => {
    setOpen(false)
    navigate(route)
  }

  return (
    <div className="osn-shell" aria-label="Option strategy scanner navigation">
      <div className="osn-current">
        <span>Strategy scanner</span>
        <strong>{current.screenLabel}</strong>
        <small>{OPTION_SCANNERS.length} current scanners available</small>
      </div>
      <div className="osn-picker" ref={menuRef}>
        <button
          type="button"
          className="osn-picker-button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(value => !value)}
        >
          <span>{current.label}</span>
          <b>{open ? '\u25B4' : '\u25BE'}</b>
        </button>
        {open && (
          <div className="osn-menu" role="dialog" aria-label="Choose an option scanner">
            {OPTION_SCANNER_GROUPS.map(group => (
              <section key={group.id}>
                <h2>{group.label}</h2>
                {group.scanners.map(scanner => (
                  <button
                    type="button"
                    key={scanner.key}
                    className={scanner.key === current.key ? 'is-active' : ''}
                    aria-current={scanner.key === current.key ? 'page' : undefined}
                    onClick={() => openScanner(generalScannerRoute(scanner.key))}
                  >
                    <strong>{scanner.label}</strong>
                    <small>{scanner.stance}</small>
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
      <p>Switching opens the new General Option Scanner with that strategy&apos;s own editable inputs and defaults.</p>
      <Link className="osn-all-link" to="/option-scanners">View all scanners</Link>
    </div>
  )
}
