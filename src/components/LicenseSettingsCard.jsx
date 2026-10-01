import { useEffect, useState } from 'react'
import { useDialog } from './DialogProvider'
import {
  LICENSE_CHANGED_EVENT,
  checkLicenseNow,
  deactivateLicense,
  fetchLicenseStatus,
  formatLicenseDate,
} from './LicenseGate'

const STATE_LABELS = {
  active: 'Active',
  overdue: 'Active — weekly check overdue',
  expired: 'Locked — could not re-verify',
  revoked: 'Revoked by Gumroad',
  inactive: 'Not activated',
}

export default function LicenseSettingsCard() {
  const dialog = useDialog()
  const [license, setLicense] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    fetchLicenseStatus().then(setLicense).catch(() => {})
  }, [])

  const announce = (next) => {
    setLicense(next)
    window.dispatchEvent(new Event(LICENSE_CHANGED_EVENT))
  }

  const checkNow = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const next = await checkLicenseNow()
      announce(next)
      if (next.last_check_error) setMessage({ type: 'error', msg: next.last_check_error })
      else if (next.state === 'revoked') setMessage({ type: 'error', msg: next.reason })
      else setMessage({ type: 'success', msg: 'Gumroad confirmed this license.' })
    } catch (error) {
      setMessage({ type: 'error', msg: error.message })
    } finally {
      setBusy(false)
    }
  }

  const deactivate = async () => {
    const lockNote = license?.enforced ? ' The app will lock until a license is activated again.' : ''
    if (!await dialog.confirm(`Remove the license activation from this computer?${lockNote}`)) return
    setBusy(true)
    setMessage(null)
    try {
      announce(await deactivateLicense())
      setMessage({ type: 'success', msg: 'The activation was removed from this computer.' })
    } catch (error) {
      setMessage({ type: 'error', msg: error.message })
    } finally {
      setBusy(false)
    }
  }

  if (!license) return null
  const hasActivation = Boolean(license.masked_key)
  const row = (label, value) => (
    <div style={{ display: 'contents' }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color: 'var(--text-strong)' }}>{value}</span>
    </div>
  )

  return (
    <div className="card">
      <h2>License</h2>
      <p style={{ color: 'var(--text-dim-2)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
        Your Gumroad license is saved on this computer and re-checked with Gumroad about every {license.recheck_days} days.
        If a check can&apos;t reach Gumroad, the app keeps working for {license.grace_days} more days.
      </p>
      {!license.enforced && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          {license.configured
            ? 'License enforcement is off in this build (running from source).'
            : 'License enforcement is off: no Gumroad product ID is configured in this build.'}
        </p>
      )}
      {message && <div className={`alert alert-${message.type}`} style={{ marginBottom: '0.75rem' }}>{message.msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.35rem 1rem', fontSize: '0.86rem', marginBottom: '0.9rem' }}>
        {row('Status', STATE_LABELS[license.state] || license.state)}
        {hasActivation && row('Key', license.masked_key)}
        {license.email && row('Purchased by', license.email)}
        {hasActivation && row('Activated', formatLicenseDate(license.activated_at))}
        {hasActivation && row('Last verified', formatLicenseDate(license.last_verified_at))}
        {license.next_check_at && license.state !== 'revoked' && row('Next check', formatLicenseDate(license.next_check_at))}
        {license.last_check_error && row('Last check', license.last_check_error)}
        {license.reason && license.state !== 'active' && row('Note', license.reason)}
      </div>

      {hasActivation && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={checkNow} disabled={busy}>
            {busy ? 'Working…' : 'Check now'}
          </button>
          <button type="button" className="btn" onClick={deactivate} disabled={busy}>
            Deactivate on this computer
          </button>
        </div>
      )}
    </div>
  )
}
