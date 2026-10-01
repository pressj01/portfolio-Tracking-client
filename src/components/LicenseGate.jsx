import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { API_BASE } from '../config'

// Settings dispatches this after a check or deactivation so the gate re-reads
// the license without waiting for its next poll.
export const LICENSE_CHANGED_EVENT = 'portfolio-license-changed'
const POLL_MS = 30 * 60 * 1000

export function formatLicenseDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function licenseRequest(path, body) {
  const response = await fetch(`${API_BASE}/api/license/${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `License request failed (HTTP ${response.status}).`)
  return data
}

export const fetchLicenseStatus = () => licenseRequest('status')
export const checkLicenseNow = () => licenseRequest('check', {})
export const deactivateLicense = () => licenseRequest('deactivate', {})

function LicenseActivation({ status, onStatus }) {
  const titleId = useId()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const activate = async (event) => {
    event.preventDefault()
    if (!key.trim()) {
      setError('Enter the license key from your Gumroad receipt.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      onStatus(await licenseRequest('activate', { license_key: key.trim() }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const checkAgain = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await checkLicenseNow()
      if (next.last_check_error) setError(next.last_check_error)
      onStatus(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const canRetry = status.state === 'expired' || status.state === 'revoked'

  return (
    <div className="license-gate" role="presentation">
      <form className="license-gate-card" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={activate}>
        <h2 id={titleId}>Activate Portfolio Tracker</h2>
        {status.state === 'inactive' && (
          <p>Enter the license key from your Gumroad purchase. It is checked with Gumroad once, then the app works offline and re-checks about once a week.</p>
        )}
        {status.state !== 'inactive' && status.reason && (
          <div className="alert alert-warning" style={{ marginBottom: '0.9rem' }}>{status.reason}</div>
        )}
        {status.state === 'inactive' && status.reason && status.masked_key && (
          <div className="alert alert-info" style={{ marginBottom: '0.9rem' }}>{status.reason}</div>
        )}
        {error && <div className="alert alert-error" style={{ marginBottom: '0.9rem' }}>{error}</div>}

        <label htmlFor="license-key-input" className="license-gate-label">License key</label>
        <input
          id="license-key-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={key}
          onChange={event => { setKey(event.target.value); setError(null) }}
          placeholder={status.masked_key || 'XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX'}
          disabled={busy}
        />

        <div className="license-gate-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
            {busy ? 'Checking with Gumroad…' : 'Activate'}
          </button>
          {canRetry && status.masked_key && (
            <button type="button" className="btn btn-secondary" onClick={checkAgain} disabled={busy}>
              Check saved key again
            </button>
          )}
        </div>

        <p className="license-gate-help">
          Your key is in your Gumroad receipt email and in your{' '}
          <a href={status.library_url || 'https://app.gumroad.com/library'} target="_blank" rel="noreferrer">Gumroad library</a>.
          {status.product_url && (
            <> Don&apos;t have one? <a href={status.product_url} target="_blank" rel="noreferrer">Buy a license</a>.</>
          )}
        </p>
      </form>
    </div>
  )
}

function LicenseOverdueBanner({ status, onStatus }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const checkNow = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await checkLicenseNow()
      if (next.last_check_error) setError(next.last_check_error)
      onStatus(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="alert alert-warning license-overdue-banner">
      <span>
        Your license hasn&apos;t been re-verified with Gumroad since {formatLicenseDate(status.last_verified_at)}.
        The app keeps working offline until {formatLicenseDate(status.grace_ends_at)}; connect to the internet so it can check.
        {error && <> <strong>{error}</strong></>}
      </span>
      <button type="button" className="btn btn-secondary" onClick={checkNow} disabled={busy}>
        {busy ? 'Checking…' : 'Check now'}
      </button>
    </div>
  )
}

export default function LicenseGate({ children }) {
  const [status, setStatus] = useState(null)
  const [unreachable, setUnreachable] = useState(false)
  const wasLicensed = useRef(null)

  const applyStatus = useCallback((next) => {
    // The data providers behind the gate were refused while it was locked,
    // so a fresh load is the reliable way to bring the whole app up.
    if (wasLicensed.current === false && next.licensed) {
      window.location.reload()
      return
    }
    wasLicensed.current = Boolean(next.licensed)
    setStatus(next)
  }, [])

  const refresh = useCallback(() => {
    fetchLicenseStatus()
      .then(next => { setUnreachable(false); applyStatus(next) })
      // The backend being down is a different problem with its own errors;
      // it is not a reason to show the activation screen.
      .catch(() => setUnreachable(true))
  }, [applyStatus])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    window.addEventListener(LICENSE_CHANGED_EVENT, refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(LICENSE_CHANGED_EVENT, refresh)
    }
  }, [refresh])

  if (!status) {
    return unreachable ? children : <div className="license-gate-loading">Checking license…</div>
  }
  if (!status.licensed) {
    return <LicenseActivation status={status} onStatus={applyStatus} />
  }
  return (
    <>
      {status.enforced && status.state === 'overdue' && <LicenseOverdueBanner status={status} onStatus={applyStatus} />}
      {children}
    </>
  )
}
