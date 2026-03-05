import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import './index.css'
import Import from './pages/Import'
import ManageHoldings from './pages/ManageHoldings'

function Home() {
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/holdings')
      .then(res => res.json())
      .then(data => { setHoldings(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const totalValue = holdings.reduce((s, h) => s + (h.current_value || 0), 0)
  const totalGain = holdings.reduce((s, h) => s + (h.gain_or_loss || 0), 0)
  const totalMonthly = holdings.reduce((s, h) => s + (h.approx_monthly_income || 0), 0)
  const totalAnnual = holdings.reduce((s, h) => s + (h.estim_payment_per_year || 0), 0)

  const fmt = (v) => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="page">
      <h1>Portfolio Dashboard</h1>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
      ) : holdings.length === 0 ? (
        <div className="card">
          <p>No holdings yet. Go to <NavLink to="/import">Import</NavLink> to upload your spreadsheet, or <NavLink to="/holdings">Manage Holdings</NavLink> to add manually.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
          <div className="card">
            <h2>Holdings</h2>
            <p style={{ fontSize: '2rem', fontWeight: 700 }}>{holdings.length}</p>
          </div>
          <div className="card">
            <h2>Portfolio Value</h2>
            <p style={{ fontSize: '2rem', fontWeight: 700 }}>{fmt(totalValue)}</p>
          </div>
          <div className="card">
            <h2>Total Gain/Loss</h2>
            <p style={{ fontSize: '2rem', fontWeight: 700, color: totalGain >= 0 ? '#81c784' : '#ef9a9a' }}>{fmt(totalGain)}</p>
          </div>
          <div className="card">
            <h2>Monthly Income</h2>
            <p style={{ fontSize: '2rem', fontWeight: 700, color: '#81c784' }}>{fmt(totalMonthly)}</p>
          </div>
          <div className="card">
            <h2>Annual Income</h2>
            <p style={{ fontSize: '2rem', fontWeight: 700, color: '#81c784' }}>{fmt(totalAnnual)}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <Router>
      <nav className="nav-bar">
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/import">Import</NavLink>
        <NavLink to="/holdings">Holdings</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/import" element={<Import />} />
        <Route path="/holdings" element={<ManageHoldings />} />
      </Routes>
    </Router>
  )
}

export default App
