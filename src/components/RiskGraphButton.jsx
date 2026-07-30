import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'
import {
  buildScannerStrategyPayload,
  hasScannerTrade,
  stageScannerTrade,
} from '../utils/optionTradeHandoff'

async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error(`Request failed (${response.status})`)
  }
  if (!response.ok || data?.error) {
    const error = new Error(data?.error || `Request failed (${response.status})`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

/**
 * Sends one scanner row's suggested trade to the Options page, which draws its
 * risk profile and marks the strikes on the underlying's price chart.
 *
 * `kind` selects the builder in optionTradeHandoff for that scanner's row shape.
 */
export default function RiskGraphButton({ kind, row, source, label = 'Risk graph', className = 'btn btn-xs btn-outline', style }) {
  const navigate = useNavigate()
  const location = useLocation()
  const available = hasScannerTrade(kind, row)
  const payload = useMemo(
    () => buildScannerStrategyPayload(kind, row, source),
    [kind, row, source],
  )
  const [savedId, setSavedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!payload?.scanner_key) return undefined
    let cancelled = false
    fetchJson(`/api/options/strategies?origin=scanner&scanner_key=${encodeURIComponent(payload.scanner_key)}`)
      .then(items => {
        if (!cancelled) {
          const saved = items[0]
          setSavedId(saved?.id || null)
          setStatus(saved ? `Saved · expires ${saved.expires_on}` : '')
        }
      })
      .catch(error => {
        if (!cancelled) setStatus(error.message)
      })
    return () => { cancelled = true }
  }, [payload?.scanner_key])

  const saveTrade = async event => {
    event.stopPropagation()
    if (!payload || busy) return
    setBusy(true)
    setStatus(savedId ? 'Updating…' : 'Saving…')
    try {
      const data = await fetchJson(
        savedId ? `/api/options/strategies/${savedId}` : '/api/options/strategies',
        {
          method: savedId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (data.id) setSavedId(data.id)
      setStatus(`${savedId ? 'Updated' : 'Saved'} · expires ${data.expires_on}`)
    } catch (error) {
      if (error.status === 409 && error.data?.id) {
        setSavedId(error.data.id)
        setStatus('Already saved')
      } else if (error.status === 404) {
        setSavedId(null)
        setStatus('No longer saved — click Save trade')
      } else {
        setStatus(error.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const deleteTrade = async event => {
    event.stopPropagation()
    if (!savedId || busy || !window.confirm(`Delete the saved ${payload?.name || 'scanner trade'}?`)) return
    setBusy(true)
    setStatus('Deleting…')
    try {
      await fetchJson(`/api/options/strategies/${savedId}`, { method: 'DELETE' })
      setSavedId(null)
      setStatus('Deleted')
    } catch (error) {
      if (error.status === 404) setSavedId(null)
      setStatus(error.status === 404 ? 'Already deleted' : error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
      <button
        type="button"
        className={className}
        style={style}
        disabled={!available}
        title={available
          ? `Open ${row?.ticker}'s suggested trade on the risk graph with the strikes drawn on the price chart`
          : 'No option trade was suggested for this row'}
        onClick={event => {
          event.stopPropagation()
          if (stageScannerTrade(kind, row, source, location.pathname)) navigate('/options')
        }}
      >
        &#128202; {label}
      </button>
      <button
        type="button"
        className="btn btn-xs btn-outline"
        disabled={!payload || busy}
        title={savedId
          ? 'Replace the saved trade with this scanner’s latest strikes, expiration, and pricing'
          : 'Save this trade in Strategy Lab until its DTE has passed'}
        onClick={saveTrade}
      >
        {busy ? 'Working…' : savedId ? '↻ Update saved' : '💾 Save trade'}
      </button>
      {savedId && (
        <button
          type="button"
          className="btn btn-xs btn-outline"
          disabled={busy}
          title="Delete this saved scanner trade"
          onClick={deleteTrade}
        >
          Delete saved
        </button>
      )}
      {status && (
        <small
          aria-live="polite"
          title={status}
          style={{
            color: /error|failed|required|cannot|no longer/i.test(status)
              ? 'var(--neg-strong)'
              : 'var(--text-muted)',
            maxWidth: 220,
          }}
        >
          {status}
        </small>
      )}
    </span>
  )
}
