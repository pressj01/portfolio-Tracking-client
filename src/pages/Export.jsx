import React, { useState, useEffect } from 'react'
import { API_BASE } from '../config'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useCurrency } from '../context/CurrencyContext'

export default function Export() {
  const pf = useProfileFetch()
  const { selection, isAggregate, currentProfileName, profileQueryString } = useProfile()
  const { displayCurrency, usdToCadRate, rateInfo } = useCurrency()
  const [exportCurrency, setExportCurrency] = useState(displayCurrency)
  const [loading, setLoading] = useState(null)   // null | 'excel' | 'csv'
  const [wlLoading, setWlLoading] = useState(null) // null | 'excel' | 'csv'
  const [combinedLoading, setCombinedLoading] = useState(false)
  const [hasData, setHasData] = useState(false)
  const [watchlistCount, setWatchlistCount] = useState(0)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    pf('/api/data/stats')
      .then(r => r.json())
      .then(d => setHasData(d.holdings > 0))
      .catch(() => setHasData(false))
    pf('/api/watchlist/watching')
      .then(r => r.json())
      .then(d => setWatchlistCount((d.rows || []).length))
      .catch(() => setWatchlistCount(0))
  }, [pf, selection])

  const handleExport = async (format) => {
    setLoading(format)
    setError(null)
    setSuccess(null)

    const endpoint = format === 'csv'
      ? '/api/export/holdings/csv'
      : '/api/export/holdings'
    const fallbackName = format === 'csv'
      ? 'portfolio_export.csv'
      : 'portfolio_export.xlsx'

    try {
      const url = `${API_BASE}${endpoint}?${profileQueryString}&currency=${exportCurrency}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Export failed')
      }

      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename=([^;]+)/)
      const filename = match ? match[1].trim() : fallbackName

      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)

      setSuccess(`Exported successfully as ${filename}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(null)
    }
  }

  const handleWatchlistExport = async (format) => {
    setWlLoading(format)
    setError(null)
    setSuccess(null)

    const endpoint = format === 'csv'
      ? '/api/export/watchlist/csv'
      : '/api/export/watchlist'
    const fallbackName = format === 'csv'
      ? 'watchlist_export.csv'
      : 'watchlist_export.xlsx'

    try {
      const url = `${API_BASE}${endpoint}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Export failed')
      }

      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename=([^;]+)/)
      const filename = match ? match[1].trim() : fallbackName

      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)

      setSuccess(`Watchlist exported successfully as ${filename}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setWlLoading(null)
    }
  }

  const handleCombinedExport = async () => {
    setCombinedLoading(true)
    setError(null)
    setSuccess(null)

    const fallbackName = 'portfolio_with_transactions.xlsx'

    try {
      const url = `${API_BASE}/api/export/holdings-transactions?${profileQueryString}&currency=${exportCurrency}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Export failed')
      }

      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename=([^;]+)/)
      const filename = match ? match[1].trim() : fallbackName

      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)

      setSuccess(`Holdings and transactions exported successfully as ${filename}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setCombinedLoading(false)
    }
  }

  return (
    <div className="page">
      <h1>Export Portfolio Data</h1>
      <p style={{ color: 'var(--accent-bright)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Exporting from: <strong>{currentProfileName}</strong>
      </p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>Export Currency</h2>
        <div className="theme-toggle" role="group" aria-label="Export currency">
          <button type="button" className={`theme-toggle-btn${exportCurrency === 'USD' ? ' active' : ''}`}
            onClick={() => setExportCurrency('USD')} aria-pressed={exportCurrency === 'USD'}>
            Source USD
          </button>
          <button type="button" className={`theme-toggle-btn${exportCurrency === 'CAD' ? ' active' : ''}`}
            onClick={() => setExportCurrency('CAD')} aria-pressed={exportCurrency === 'CAD'}>
            Display CAD
          </button>
        </div>
        {exportCurrency === 'USD' ? (
          <p style={{ color: 'var(--text-dim-2)', marginTop: '0.7rem', fontSize: '0.85rem' }}>
            Preserves source values and remains compatible with portfolio reimport.
          </p>
        ) : (
          <p style={{ color: 'var(--warning-money)', marginTop: '0.7rem', fontSize: '0.85rem' }}>
            Converts monetary fields at 1 USD = {usdToCadRate.toFixed(4)} CAD ({rateInfo.mode === 'manual' ? 'manual override' : 'cached live rate'}).
            CAD report exports include rate metadata and are not intended for reimport.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Export Holdings</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
          Download your portfolio data. Source USD exports use the upload-template format and can be reimported.
          Display CAD exports are presentation copies with converted monetary values and exchange-rate metadata.
        </p>

        {isAggregate && (
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
            Aggregate mode: Excel export creates a separate sheet per portfolio.
            CSV combines all portfolios into one file.
            Reimport Excel with <strong>"Import all sheets as separate portfolios"</strong> checked.
          </p>
        )}

        {!hasData ? (
          <div className="alert alert-info">
            No holdings data to export. Import a portfolio first.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              className="btn btn-primary"
              onClick={() => handleExport('excel')}
              disabled={loading}
            >
              {loading === 'excel' ? <><span className="spinner" /> Exporting...</> : 'Export to Excel'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleExport('csv')}
              disabled={loading}
            >
              {loading === 'csv' ? <><span className="spinner" /> Exporting...</> : 'Export to CSV'}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2>Export Watchlist</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
          Download your watchlist (tickers and notes). Watchlist is global &mdash; not tied to the
          selected portfolio. The exported file can be reimported on the Import page under the
          <strong> Generic Upload</strong> tab.
        </p>

        {watchlistCount === 0 ? (
          <div className="alert alert-info">
            No watchlist tickers to export. Add some on the Watchlist page first.
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem', fontSize: '0.9rem' }}>
              {watchlistCount} ticker{watchlistCount === 1 ? '' : 's'} in watchlist.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => handleWatchlistExport('excel')}
                disabled={wlLoading}
              >
                {wlLoading === 'excel' ? <><span className="spinner" /> Exporting...</> : 'Export Watchlist to Excel'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleWatchlistExport('csv')}
                disabled={wlLoading}
              >
                {wlLoading === 'csv' ? <><span className="spinner" /> Exporting...</> : 'Export Watchlist to CSV'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2>Export Holdings with Transactions</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
          Download one Excel workbook containing your holdings plus a Transactions sheet
          for the related ticker activity in the selected portfolio.
        </p>

        {isAggregate && (
          <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
            Aggregate mode: holdings are split by portfolio sheet, and transactions are
            combined into one Transactions sheet with the source portfolio included.
          </p>
        )}

        {!hasData ? (
          <div className="alert alert-info">
            No holdings data to export. Import a portfolio first.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              className="btn btn-primary"
              onClick={handleCombinedExport}
              disabled={combinedLoading}
            >
              {combinedLoading ? <><span className="spinner" /> Exporting...</> : 'Export Holdings + Transactions'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
    </div>
  )
}
