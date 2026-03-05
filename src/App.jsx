import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'

function Home() {
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/holdings')
      .then(res => res.json())
      .then(data => { setHoldings(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Portfolio Tracker</h1>
      <p>{loading ? 'Loading...' : `${holdings.length} holdings loaded`}</p>
      {holdings.length === 0 && !loading && (
        <p>No holdings yet. Use the Import page to upload your spreadsheet.</p>
      )}
    </div>
  )
}

function App() {
  return (
    <Router>
      <nav style={{ padding: '1rem', borderBottom: '1px solid #ccc' }}>
        <Link to="/" style={{ marginRight: '1rem' }}>Home</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Router>
  )
}

export default App
