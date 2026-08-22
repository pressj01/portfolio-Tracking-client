import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMenuOrder } from '../context/MenuOrderContext'
import { MENU_LINKS, menuIdForPath } from '../navigation/menuConfig'
import { openCommandPalette, paletteShortcutLabel } from '../utils/commandPalette'

export default function HiddenPageBanner() {
  const { pathname } = useLocation()
  const { hiddenIds, loading, unhidePage } = useMenuOrder()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const menuId = menuIdForPath(pathname)

  if (loading || !menuId || !hiddenIds.includes(menuId)) return null

  const label = MENU_LINKS.find(link => link.id === menuId)?.label || 'This page'

  const showInMenu = async () => {
    setBusy(true)
    setError('')
    try {
      await unhidePage(menuId)
    } catch (err) {
      setError(err.message || 'Could not show this page in the menu.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hidden-page-banner" role="status">
      <span>
        <strong>{label}</strong> is hidden from the menu. Open it anytime with the command palette
        ({paletteShortcutLabel()}).
      </span>
      <div className="hidden-page-banner-actions">
        <button className="btn btn-secondary" type="button" onClick={openCommandPalette}>
          Search
        </button>
        <button className="btn btn-primary" type="button" onClick={showInMenu} disabled={busy}>
          {busy ? 'Showing…' : 'Show in menu'}
        </button>
      </div>
      {error && <div className="hidden-page-banner-error">{error}</div>}
    </div>
  )
}
