import React, { useState, useEffect } from 'react'

export default function Settings() {
  const [stats, setStats] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchStats = () => {
    fetch('/api/data/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats(null))
  }

  useEffect(() => { fetchStats() }, [])

  const handleClearAll = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const res = await fetch('/api/data/clear-all', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setStatus({ type: 'success', msg: 'All data cleared successfully.' })
        fetchStats()
      } else {
        setStatus({ type: 'error', msg: data.error || 'Failed to clear data.' })
      }
    } catch (e) {
      setStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setLoading(false)
    setConfirming(false)
  }

  return (
    <div className="page" style={{ maxWidth: 700 }}>
      <h1>Settings</h1>

      {/* Data Overview */}
      <div className="card">
        <h2>Data Overview</h2>
        {stats ? (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.8rem' }}>Holdings</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7ecfff' }}>{stats.holdings}</div>
            </div>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.8rem' }}>Dividend Records</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7ecfff' }}>{stats.dividends}</div>
            </div>
            <div>
              <span style={{ color: '#8899aa', fontSize: '0.8rem' }}>Income Tracking</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7ecfff' }}>{stats.income_tracking}</div>
            </div>
          </div>
        ) : (
          <p style={{ color: '#8899aa' }}>Loading...</p>
        )}
      </div>

      {/* Clear Data */}
      <div className="card">
        <h2>Clear All Data</h2>
        <p style={{ color: '#90a4ae', marginBottom: '1rem', fontSize: '0.9rem' }}>
          This will permanently delete all holdings, dividends, income tracking, and payout data.
          You can re-import a spreadsheet after clearing.
        </p>

        {status && (
          <div className={`alert alert-${status.type}`}>{status.msg}</div>
        )}

        {!confirming ? (
          <button
            className="btn btn-danger"
            onClick={() => setConfirming(true)}
            disabled={loading || (stats && stats.holdings === 0)}
          >
            Clear All Data
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: '#ef9a9a', fontWeight: 600 }}>Are you sure? This cannot be undone.</span>
            <button className="btn btn-danger" onClick={handleClearAll} disabled={loading}>
              {loading ? 'Clearing...' : 'Yes, Delete Everything'}
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={loading}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
