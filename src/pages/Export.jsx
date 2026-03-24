import React, { useState, useEffect } from 'react'
import { API_BASE } from '../config'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

export default function Export() {
  const pf = useProfileFetch()
  const { selection, isAggregate, currentProfileName, profileQueryString } = useProfile()
  const [loading, setLoading] = useState(null)   // null | 'excel' | 'csv'
  const [hasData, setHasData] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    pf('/api/data/stats')
      .then(r => r.json())
      .then(d => setHasData(d.holdings > 0))
      .catch(() => setHasData(false))
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
      const url = `${API_BASE}${endpoint}?${profileQueryString}`
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

  return (
    <div className="page">
      <h1>Export Portfolio Data</h1>
      <p style={{ color: '#7ecfff', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Exporting from: <strong>{currentProfileName}</strong>
      </p>

      <div className="card">
        <h2>Export Holdings</h2>
        <p style={{ color: '#90a4ae', marginBottom: '1rem' }}>
          Download your portfolio data. The exported file uses the same column format
          as the upload template, so it can be reimported using either
          the <strong>Generic Upload</strong> or <strong>My Spreadsheet</strong> import tabs.
        </p>

        {isAggregate && (
          <p style={{ color: '#90a4ae', marginBottom: '1rem' }}>
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

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
    </div>
  )
}
