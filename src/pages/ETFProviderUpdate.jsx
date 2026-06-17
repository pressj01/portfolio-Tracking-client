import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'

const fmtAssets = (v) => {
  if (v == null) return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const compact = (value) => value.toLocaleString(undefined, { maximumSignificantDigits: 4 })
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${compact(n / 1e9)} Billion`
  if (abs >= 1e6) return `$${compact(n / 1e6)} Million`
  return '$' + compact(n)
}

const fmtPct = (v) => v == null ? '-' : `${Number(v).toFixed(2)}%`

export default function ETFProviderUpdate() {
  const [providers, setProviders] = useState([])
  const [selectedProvider, setSelectedProvider] = useState('')
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    setLoadingProviders(true)
    fetch(`${API_BASE}/api/etf-providers`)
      .then(r => r.json())
      .then(data => {
        const rows = Array.isArray(data) ? data : []
        setProviders(rows)
        setSelectedProvider(rows[0]?.provider || '')
      })
      .catch(e => setError(e.message || 'Could not load providers.'))
      .finally(() => setLoadingProviders(false))
  }, [])

  const selectedSummary = useMemo(
    () => providers.find(p => p.provider === selectedProvider),
    [providers, selectedProvider],
  )

  const refreshProvider = async () => {
    if (!selectedProvider) return
    setUpdating(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/etf-providers/${encodeURIComponent(selectedProvider)}/refresh-stockanalysis`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Provider update failed.')
      setResult(data)
      setProviders(prev => prev.map(p => (
        p.provider === data.provider
          ? {
              ...p,
              total_assets: data.total_assets,
              num_funds: data.num_funds,
              avg_expense: data.avg_expense,
            }
          : p
      )))
    } catch (e) {
      setError(e.message || 'Provider update failed.')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="page security-research-page">
      <div className="research-title-row">
        <div>
          <h1>ETF Provider Update</h1>
          <p>Refresh provider fund metrics from StockAnalysis.com.</p>
        </div>
      </div>

      <div className="research-toolbar" style={{ alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <select
          value={selectedProvider}
          onChange={e => { setSelectedProvider(e.target.value); setResult(null); setError('') }}
          disabled={loadingProviders || updating}
          style={{
            minWidth: 260,
            padding: '0.5rem 0.75rem',
            backgroundColor: 'var(--bg)',
            color: 'var(--white)',
            border: '1px solid var(--p-4a5568)',
            borderRadius: 4,
            fontSize: '0.9rem',
          }}
        >
          {providers.map(p => <option key={p.provider} value={p.provider}>{p.provider}</option>)}
        </select>
        <button
          className="btn btn-primary"
          onClick={refreshProvider}
          disabled={!selectedProvider || loadingProviders || updating}
        >
          {updating ? 'Updating...' : 'Update Provider'}
        </button>
      </div>

      {selectedSummary && (
        <section className="research-grid" style={{ marginTop: '1rem' }}>
          <div className="research-field"><span>Provider</span><strong>{selectedSummary.provider}</strong></div>
          <div className="research-field"><span>Funds</span><strong>{selectedSummary.num_funds ?? '-'}</strong></div>
          <div className="research-field"><span>Total Assets</span><strong>{fmtAssets(selectedSummary.total_assets)}</strong></div>
          <div className="research-field"><span>Avg Expense</span><strong>{fmtPct(selectedSummary.avg_expense)}</strong></div>
        </section>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      {result && (
        <div className="alert alert-info" style={{ marginTop: '1rem' }}>
          Updated {result.updated} existing fund{result.updated === 1 ? '' : 's'} and inserted {result.inserted} new fund{result.inserted === 1 ? '' : 's'} from{' '}
          <a href={result.source_url} target="_blank" rel="noreferrer">StockAnalysis.com</a>.
        </div>
      )}
    </div>
  )
}
