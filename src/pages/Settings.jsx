import React, { useState, useEffect } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

export default function Settings() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [stats, setStats] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  // Single-stock ETF state
  const [builtinEtfs, setBuiltinEtfs] = useState([])
  const [userEtfs, setUserEtfs] = useState([])
  const [etfInput, setEtfInput] = useState('')
  const [etfStatus, setEtfStatus] = useState(null)
  const [etfSaving, setEtfSaving] = useState(false)

  const fetchStats = () => {
    pf('/api/data/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats(null))
  }

  const fetchSingleStockEtfs = () => {
    pf('/api/single-stock-etfs')
      .then(r => r.json())
      .then(data => {
        setBuiltinEtfs(data.builtin || [])
        setUserEtfs(data.user_added || [])
      })
      .catch(() => {})
  }

  useEffect(() => { fetchStats(); fetchSingleStockEtfs() }, [selection])

  const handleClearAll = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const res = await pf('/api/data/clear-all', { method: 'POST' })
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

  const handleAddEtf = async () => {
    const newTickers = etfInput.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    if (!newTickers.length) return
    const merged = [...new Set([...userEtfs, ...newTickers])]
    setEtfSaving(true)
    setEtfStatus(null)
    try {
      const res = await pf('/api/single-stock-etfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: merged }),
      })
      if (res.ok) {
        const data = await res.json()
        setUserEtfs(data.user_added || merged)
        setEtfInput('')
        setEtfStatus({ type: 'success', msg: `Added ${newTickers.join(', ')}` })
      } else {
        setEtfStatus({ type: 'error', msg: 'Failed to save.' })
      }
    } catch (e) {
      setEtfStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setEtfSaving(false)
  }

  const handleRemoveEtf = async (ticker) => {
    const updated = userEtfs.filter(t => t !== ticker)
    setEtfSaving(true)
    setEtfStatus(null)
    try {
      const res = await pf('/api/single-stock-etfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: updated }),
      })
      if (res.ok) {
        const data = await res.json()
        setUserEtfs(data.user_added || updated)
        setEtfStatus({ type: 'success', msg: `Removed ${ticker}` })
      }
    } catch (e) {
      setEtfStatus({ type: 'error', msg: 'Server error: ' + e.message })
    }
    setEtfSaving(false)
  }

  const tagStyle = (removable) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: removable ? '#1a3a4a' : '#1a2a3a', color: removable ? '#7ecfff' : '#8899aa',
    borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem', margin: 2,
    border: removable ? '1px solid #2a5a6a' : '1px solid #2a3a4a',
  })

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

      {/* Single-Stock ETFs */}
      <div className="card">
        <h2>Single-Stock ETFs</h2>
        <p style={{ color: '#90a4ae', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          These tickers are excluded from BUY recommendations in Optimize Returns and Balanced mode
          (unless the slider is at 100%). They are still allowed in Optimize Income.
        </p>

        {etfStatus && (
          <div className={`alert alert-${etfStatus.type}`} style={{ marginBottom: '0.75rem' }}>{etfStatus.msg}</div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <span style={{ color: '#8899aa', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Built-in ({builtinEtfs.length})</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {builtinEtfs.map(t => <span key={t} style={tagStyle(false)}>{t}</span>)}
          </div>
        </div>

        {userEtfs.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ color: '#8899aa', fontSize: '0.75rem', display: 'block', marginBottom: 4 }}>Your additions ({userEtfs.length})</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {userEtfs.map(t => (
                <span key={t} style={tagStyle(true)}>
                  {t}
                  <button
                    onClick={() => handleRemoveEtf(t)}
                    disabled={etfSaving}
                    style={{
                      background: 'none', border: 'none', color: '#ff6b6b',
                      cursor: 'pointer', padding: '0 2px', fontSize: '0.9rem', lineHeight: 1,
                    }}
                    title={`Remove ${t}`}
                  >&times;</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={etfInput}
            onChange={e => setEtfInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddEtf()}
            placeholder="Add tickers (e.g. XXXY, ZZZY)"
            style={{ flex: 1 }}
            disabled={etfSaving}
          />
          <button className="btn btn-primary" onClick={handleAddEtf} disabled={etfSaving || !etfInput.trim()}>
            Add
          </button>
        </div>
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
